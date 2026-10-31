"""Engine boot-log tailer: turns the serving engine's own stdout into a structured
launch sequence for the dashboard.

The GPU process is found by the sniffer (host pid). From the pid we locate its
log source — a docker container (via /proc/<pid>/cgroup) or a regular file on
fd 1/2 — tail it, strip tqdm/ANSI noise, and parse the vLLM / SGLang milestone
lines into a `boot` dict: flight plan, shard progress, CUDA-graph capture,
KV budget, API-up, warnings/errors, a short log tail, and per-stage timings.

Boot history (per model) is persisted to boot_history.json so the UI can show
"last boot" durations as ETAs and a boot-time trend. A one-shot TTFT probe is
fired when the API comes up.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HIST_FILE = Path(__file__).resolve().parent / "boot_history.json"
HIST_MAX = 60
TAIL_MAX = 10
TRACK_TTL_S = 900

_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_PFX = re.compile(r"^(?:\(([A-Za-z_]+\d*)\s+pid=\d+\)\s*)?(INFO|WARNING|ERROR|DEBUG|CRITICAL)\s+(\d\d-\d\d \d\d:\d\d:\d\d)\s+\[([^\]]+)\]\s?(.*)$")
_TQDM = re.compile(r"(Loading safetensors checkpoint shards|Capturing CUDA graphs(?: \(([A-Z_]+)\))?):\s*(\d+)%\|[^|]*\|\s*(\d+)/(\d+)\s*\[([^<\]]*)<([^,\]]*),\s*([\d.]+)\s*(s/it|it/s)\]")
_NUM = r"([\d,]+(?:\.\d+)?)"
# any other tqdm-style bar: "<label>: 12%|█ | 1/8 [..]" (JIT kernel warmup, Parallel Compiling, ...)
_TQDM_ANY = re.compile(r"([A-Za-z][^|\r\n:]{2,70}?)(?:\s*\([^)]*\))?:\s*(\d+)%\|[^|]*\|\s*(\d+)/(\d+)")

STAGES = ["init", "weights", "warmup", "api"]


def _f(s: str) -> float:
    return float(s.replace(",", ""))


def _hms_to_s(t: str) -> float | None:
    try:
        parts = [int(p) for p in t.strip().split(":")]
    except ValueError:
        return None
    s = 0
    for p in parts:
        s = s * 60 + p
    return float(s)


# ──────────────────────────── history ────────────────────────────

_hist_lock = threading.Lock()


def _load_hist() -> list:
    try:
        return json.loads(HIST_FILE.read_text())
    except Exception:
        return []


def _save_hist(h: list) -> None:
    try:
        tmp = HIST_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(h[-HIST_MAX:], indent=0))
        tmp.replace(HIST_FILE)
    except Exception:
        pass


def history_for(name: str, limit: int = 6) -> list:
    with _hist_lock:
        h = [r for r in _load_hist() if r.get("name") == name]
    return h[-limit:]


def last_ok_for(name: str) -> dict | None:
    for r in reversed(history_for(name, 40)):
        if r.get("outcome") == "ok":
            return r
    return None


def _record(rec: dict) -> None:
    with _hist_lock:
        h = _load_hist()
        h = [r for r in h if r.get("boot_id") != rec.get("boot_id")]
        h.append(rec)
        _save_hist(h)


# ──────────────────────────── sources ────────────────────────────

def _source_for_pids(pids: list) -> tuple[str, str] | None:
    for pid in pids:
        try:
            cg = Path(f"/proc/{pid}/cgroup").read_text()
        except Exception:
            continue
        m = re.search(r"docker-([0-9a-f]{12,64})\.scope", cg) or re.search(r"/docker/([0-9a-f]{12,64})", cg)
        if m:
            return ("docker", m.group(1)[:12])
    for pid in pids:
        for fd in ("1", "2"):
            try:
                tgt = os.readlink(f"/proc/{pid}/fd/{fd}")
            except Exception:
                continue
            if tgt.startswith("/") and os.path.isfile(tgt) and os.access(tgt, os.R_OK):
                return ("file", tgt)
    return None


class _Tail:
    """Incremental reader for a docker container or a log file."""

    def __init__(self, kind: str, ref: str):
        self.kind, self.ref = kind, ref
        self.pos = 0
        self.since: str | None = None
        self.seen_at_since: set[str] = set()
        self.first = True
        self.name = ref

    def read(self) -> list[tuple[float | None, str]]:
        out: list[tuple[float | None, str]] = []
        if self.kind == "file":
            try:
                with open(self.ref, "rb") as fh:
                    if self.first:
                        size = os.path.getsize(self.ref)
                        self.pos = max(0, size - 512 * 1024)
                        self.first = False
                    fh.seek(self.pos)
                    data = fh.read(4 * 1024 * 1024)
                    self.pos += len(data)
            except Exception:
                return out
            for ln in re.split(rb"[\r\n]+", data):
                if ln.strip():
                    out.append((None, ln.decode("utf-8", "replace")))
            return out
        # docker
        cmd = ["docker", "logs", "--timestamps"]
        if self.since:
            cmd += ["--since", self.since]
        else:
            cmd += ["--tail", "4000"]
        cmd.append(self.ref)
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=8)
        except Exception:
            return out
        if self.first:
            try:
                nm = subprocess.run(["docker", "inspect", "-f", "{{.Name}}", self.ref], capture_output=True, timeout=5)
                self.name = nm.stdout.decode().strip().lstrip("/") or self.ref
            except Exception:
                pass
            self.first = False
        raw = r.stdout + b"\n" + r.stderr
        new_since = self.since
        new_seen: set[str] = set()
        for chunk in raw.split(b"\n"):
            line = chunk.decode("utf-8", "replace")
            # docker prefixes each *line* with a timestamp; tqdm \r-updates share one timestamp
            m = re.match(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z)\s?(.*)$", line)
            if not m:
                continue
            ts, body = m.group(1), m.group(2)
            if self.since and ts == self.since and body in self.seen_at_since:
                continue
            try:
                epoch = datetime.strptime(ts[:26].rstrip("Z")[:26], "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=timezone.utc).timestamp()
            except Exception:
                epoch = None
            for piece in body.split("\r"):
                if piece.strip():
                    out.append((epoch, piece))
            if new_since is None or ts >= new_since:
                if ts != new_since:
                    new_seen = set()
                new_since = ts
                new_seen.add(body)
        if new_since:
            self.since = new_since
            self.seen_at_since = new_seen
        return out


# ──────────────────────────── parser ────────────────────────────

def _new_boot(src_label: str) -> dict:
    return {
        "src": src_label, "engine": None, "version": None, "arch": None, "max_model_len": None,
        "kv_dtype": None, "tp": None, "world": None, "ckpt_gib": None, "ram_avail_gib": None,
        "quant": None, "moe_backend": None, "attn_backend": None, "nccl": None,
        "init_s": None, "weights_s": None, "load_total_s": None, "load_gib": None,
        "shards": None, "graphs": {}, "graph_s": None, "graph_gib": None,
        "kv_gib": None, "kv_tokens": None, "max_conc": None, "max_conc_len": None,
        "compile_s": None, "dynamo_s": None, "engine_init_s": None,
        "api_up": False, "ready": False, "ttft_ms": None, "ttft_err": None,
        "warnings": 0, "errors": 0, "last_error": None, "tail": [],
        "stage": "init", "substage": "spawning workers", "stage_ts": {}, "t0": None, "last_ts": None,
        "failed": False, "progress": {},
    }


def _ts_from_line(body: str, fallback: float | None, prev: float | None = None) -> float:
    if fallback:
        return fallback
    m = _PFX.match(body)
    if m:
        try:
            yr = datetime.now().year
            return datetime.strptime(f"{yr} {m.group(3)}", "%Y %m-%d %H:%M:%S").timestamp()
        except Exception:
            pass
    return prev or time.time()


def _set_stage(b: dict, stage: str, ts: float) -> None:
    order = STAGES + ["ready"]
    if order.index(stage) <= order.index(b["stage"]) and stage != b["stage"]:
        return
    if stage != b["stage"]:
        b["stage"] = stage
        b["stage_ts"].setdefault(stage, ts)


def _feed(b: dict, epoch: float | None, raw: str) -> None:
    line = _ANSI.sub("", raw).rstrip()
    if not line.strip():
        return
    ts = _ts_from_line(line, epoch, b.get("last_ts"))
    if b["t0"] is None or ts < b["t0"]:
        b["t0"] = ts
        b["stage_ts"].setdefault("init", ts)
    b["last_ts"] = max(b["last_ts"] or 0, ts)

    # tqdm progress (shards / cuda graphs)
    tq = _TQDM.search(line)
    if tq:
        kind, mode, pct, done, total, elapsed, remain, rate, unit = tq.groups()
        rec = {"done": int(done), "total": int(total), "pct": int(pct),
               "rate": float(rate), "unit": unit, "elapsed_s": _hms_to_s(elapsed), "eta_s": _hms_to_s(remain)}
        if kind.startswith("Loading safetensors"):
            b["shards"] = rec
            _set_stage(b, "weights", ts)
            b["substage"] = f"shard {done}/{total}"
        else:
            b["graphs"][mode or "GRAPHS"] = rec
            _set_stage(b, "warmup", ts)
            b["substage"] = f"cuda graphs {mode.lower() if mode else ''} {done}/{total}".replace("  ", " ")
        return

    ta = _TQDM_ANY.search(line)
    if ta:
        label, pct, done, total = ta.group(1).strip(), int(ta.group(2)), int(ta.group(3)), int(ta.group(4))
        b.setdefault("progress", {})[label] = {"pct": pct, "done": done, "total": total, "ts": ts}
        if b["stage"] in ("weights", "warmup") and not b["api_up"]:
            b["substage"] = f"{label.lower()} {done}/{total}"
        return
    m = _PFX.match(line)
    level, tag, msg = (m.group(2), m.group(4), m.group(5)) if m else ("", "", line)
    rank_dup = bool(m and m.group(1) and not m.group(1).endswith("0") and "TP" in m.group(1))

    if level == "WARNING":
        b["warnings"] += 1
    elif level in ("ERROR", "CRITICAL") or (level == "" and re.search(r"^\s*(Traceback|\w+(Error|Exception)\b)", line)):
        b["errors"] += 1
        # root cause = first specific "<X>Error: ..." line; generic wrappers only if nothing better
        body = (msg if m else line).strip()
        rc = re.match(r"^(?:[\w.]+\.)?(\w+(?:Error|Exception)|AssertionError|Assertion error)\s*[:(]\s*(.+)$", body)
        generic = bool(re.search(r"initialization failed|See root cause|Traceback|exited with|Worker failed", body))
        if rc and (b["last_error"] is None or b.get("_err_generic")):
            b["last_error"] = body[:240]
            b["_err_generic"] = generic
        elif re.search(r"out of memory|CUDA error|OOM", body, re.I) and b["last_error"] is None:
            b["last_error"] = body[:240]
            b["_err_generic"] = False

    low = msg if m else line

    def grab(pattern: str, flags: int = 0):
        return re.search(pattern, low, flags)

    g = grab(r"\bversion\s+(\d+\.\d+\.\d+\S*)")
    if g:
        if b["version"] and (b["stage"] != "init" or b["api_up"] or b["errors"]):
            # a second banner = the container was restarted: docker logs span
            # restarts, so everything before this line belongs to a previous boot
            fresh = _new_boot(b["src"])
            fresh["t0"] = ts
            fresh["stage_ts"]["init"] = ts
            fresh["last_ts"] = ts
            b.clear()
            b.update(fresh)
        b["engine"], b["version"] = b["engine"] or "vLLM", g.group(1)
    if "sglang" in low.lower() and not b["engine"]:
        b["engine"] = "SGLang"
    g = grab(r"Resolved architecture:\s*(\S+)")
    if g:
        b["arch"] = g.group(1)
    g = grab(r"Using max model len\s+(\d+)")
    if g:
        b["max_model_len"] = int(g.group(1))
    if "to store kv cache" in low:
        g = grab(r"Using (\S+) data type to store kv cache")
        if g:
            b["kv_dtype"] = g.group(1)
    g = grab(r"world_size=(\d+)")
    if g and not b["world"]:
        b["world"] = int(g.group(1))
    g = grab(r"tensor_parallel_size=(\d+)")
    if g:
        b["tp"] = int(g.group(1))
    g = grab(r"Checkpoint size:\s*" + _NUM + r"\s*GiB\.?\s*Available RAM:\s*" + _NUM + r"\s*GiB")
    if g:
        b["ckpt_gib"], b["ram_avail_gib"] = _f(g.group(1)), _f(g.group(2))
    g = grab(r"expert_dtype resolved to '(\w+)'")
    if g:
        b["quant"] = g.group(1)
    g = grab(r"quantization[_ ](?:method|config)\S*[=:]\s*'?(\w+)")
    if g and not b["quant"]:
        b["quant"] = g.group(1)
    g = grab(r"Using '(\w+)' NvFp4 MoE backend")
    if g:
        b["moe_backend"] = g.group(1)
    g = grab(r"Using (\S+?) (?:KV cache format|attention backend|backend for attention)")
    if g and not b["attn_backend"]:
        b["attn_backend"] = g.group(1)
    g = grab(r"nccl==(\S+)")
    if g:
        b["nccl"] = g.group(1)
    g = grab(r"Initializing model took\s*" + _NUM + r"\s*seconds")
    if g:
        b["init_s"] = round(_f(g.group(1)), 1)
    if "Loading model from scratch" in low or "Loading weights" in low and "took" not in low:
        _set_stage(b, "weights", ts)
        b["substage"] = "opening checkpoint"
    g = grab(r"Loading weights took\s*" + _NUM + r"\s*seconds")
    if g:
        b["weights_s"] = round(_f(g.group(1)), 1)
    g = grab(r"Model loading took\s*" + _NUM + r"\s*GiB memory and\s*" + _NUM + r"\s*seconds")
    if g:
        b["load_gib"], b["load_total_s"] = _f(g.group(1)), round(_f(g.group(2)), 1)
        _set_stage(b, "warmup", ts)
        b["substage"] = "memory profiling"
    g = grab(r"Available KV cache memory:\s*" + _NUM + r"\s*GiB")
    if g:
        b["kv_gib"] = _f(g.group(1))
        _set_stage(b, "warmup", ts)
        b["substage"] = "allocating kv cache"
    g = grab(r"GPU KV cache size:\s*" + _NUM + r"\s*tokens")
    if g:
        b["kv_tokens"] = int(_f(g.group(1)))
    g = grab(r"Maximum concurrency for\s*" + _NUM + r"\s*tokens per request:\s*" + _NUM + r"x")
    if g:
        b["max_conc_len"], b["max_conc"] = int(_f(g.group(1))), _f(g.group(2))
    g = grab(r"Dynamo bytecode transform time:\s*" + _NUM + r"\s*s")
    if g:
        b["dynamo_s"] = (b["dynamo_s"] or 0) + _f(g.group(1)) if not rank_dup else b["dynamo_s"]
        b["substage"] = "torch.compile"
    g = grab(r"torch\.compile takes\s*" + _NUM + r"\s*s")
    if g and not rank_dup:
        b["compile_s"] = _f(g.group(1))
    g = grab(r"Graph capturing finished in\s*" + _NUM + r"\s*secs?,?\s*took\s*" + _NUM + r"\s*GiB")
    if g:
        b["graph_s"], b["graph_gib"] = _f(g.group(1)), _f(g.group(2))
        b["substage"] = "graphs captured"
    g = grab(r"init engine .*took\s*" + _NUM + r"\s*seconds")
    if g:
        b["engine_init_s"] = round(_f(g.group(1)), 1)
    # NB: "Starting vLLM API server" is printed before the engine even loads — not readiness
    if re.search(r"Application startup complete|Uvicorn running on|The server is fired up and ready", low):
        b["api_up"] = True
        _set_stage(b, "api", ts)
        b["substage"] = "api listening · probing"

    # keep a short human tail (skip rank duplicates and traceback frames)
    frame = (not m) and line[:1].isspace() and not re.match(r"^\s*\w+(Error|Exception)\b", line)
    if not rank_dup and not frame and not low.lstrip().startswith(("File ", "^", "return ", "self.", "Traceback")):
        if level or len(line) < 400:
            b["tail"].append({"lv": level or "LOG", "t": datetime.fromtimestamp(ts).strftime("%H:%M:%S"),
                              "tag": tag.split(":")[0] if tag else "", "msg": (msg if m else line).strip()[:200]})
            if len(b["tail"]) > TAIL_MAX:
                del b["tail"][: len(b["tail"]) - TAIL_MAX]


# ──────────────────────────── TTFT probe ────────────────────────────

def _probe_ttft(b: dict, port: int) -> None:
    base = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(base + "/v1/models", timeout=10) as r:
            models = json.loads(r.read().decode()).get("data") or []
        model = models[0]["id"] if models else None
        if not model:
            b["ttft_err"] = "no model id"
            return
        body = json.dumps({"model": model, "prompt": "Hi", "max_tokens": 1, "stream": True, "temperature": 0}).encode()
        req = urllib.request.Request(base + "/v1/completions", data=body, headers={"Content-Type": "application/json"})
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=120) as r:
            r.readline()
        b["ttft_ms"] = round((time.perf_counter() - t0) * 1000, 0)
    except Exception as exc:  # noqa: BLE001
        b["ttft_err"] = str(exc)[:80]


# ──────────────────────────── tracker ────────────────────────────

class _Track:
    def __init__(self, eid: str, name: str, path: str, pids: list, ports: list):
        self.eid, self.name, self.path = eid, name, path
        self.pids, self.ports = list(pids), list(ports)
        self.tail: _Tail | None = None
        self.boot: dict | None = None
        self.started = time.time()
        self.last_seen = self.started
        self.probe_thread: threading.Thread | None = None
        self.probe_at, self.probes = 0.0, 0
        self.recorded = False
        self.boot_id = f"{int(self.started)}-{eid}"
        self.last_poll = 0.0

    def poll(self) -> None:
        now = time.time()
        if now - self.last_poll < 0.9:
            return
        self.last_poll = now
        if self.tail is None:
            src = _source_for_pids(self.pids)
            if not src:
                return
            self.tail = _Tail(*src)
            self.boot = _new_boot(f"{src[0]}:{src[1]}")
        b = self.boot
        assert b is not None
        for epoch, line in self.tail.read():
            _feed(b, epoch, line)
        b["src"] = f"{self.tail.kind}:{self.tail.name}"
        if b["api_up"] and self.ports and (self.probe_thread is None
                or (not self.probe_thread.is_alive() and b.get("ttft_err") and b["ttft_ms"] is None
                    and now - self.probe_at > 30 and self.probes < 6)):
            b["ttft_err"] = None
            self.probe_at, self.probes = now, self.probes + 1
            self.probe_thread = threading.Thread(target=_probe_ttft, args=(b, self.ports[0]), daemon=True)
            self.probe_thread.start()
        if b["ttft_ms"] is not None and not b["ready"]:
            b["ready"] = True
            b["stage_ts"].setdefault("ready", time.time())
            b["substage"] = f"ready · first token {b['ttft_ms']:.0f} ms"
            self.record("ok")

    def record(self, outcome: str) -> None:
        if self.recorded or not self.boot:
            return
        b = self.boot
        st = b["stage_ts"]
        t0 = b.get("t0") or self.started
        end = st.get("ready") or st.get("api") or b.get("last_ts") or time.time()
        order = STAGES + ["ready"]
        durs = {}
        for i, s in enumerate(STAGES):
            a = st.get(s)
            nxt = next((st[n] for n in order[i + 1:] if st.get(n)), None)
            if a is not None and nxt is not None:
                durs[s] = round(nxt - a, 1)
        rec = {
            "boot_id": self.boot_id, "name": self.name, "path": self.path, "engine": b.get("engine"), "version": b.get("version"),
            "started": t0, "ended": end, "outcome": outcome, "total_s": round(end - t0, 1), "stages": durs,
            "kv_tokens": b.get("kv_tokens"), "kv_gib": b.get("kv_gib"), "ttft_ms": b.get("ttft_ms"),
            "load_total_s": b.get("load_total_s"), "warnings": b.get("warnings"), "errors": b.get("errors"),
            "last_error": b.get("last_error") if outcome != "ok" else None,
            "max_model_len": b.get("max_model_len"), "quant": b.get("quant"),
        }
        _record(rec)
        self.recorded = True


_tracks: dict[str, _Track] = {}
_lock = threading.Lock()


def _stage_durations(b: dict, now: float) -> dict:
    st = b["stage_ts"]
    order = STAGES + ["ready"]
    out = {}
    for i, s in enumerate(STAGES):
        a = st.get(s)
        if a is None:
            out[s] = None
            continue
        nxt = next((st[n] for n in order[i + 1:] if st.get(n)), None)
        out[s] = round((nxt if nxt is not None else now) - a, 1)
    return out


def enrich(entries: list) -> None:
    """Attach `boot` (live launch sequence) to loading entries and `boot_last`
    (history summary) to every sniffed model. Call once per LLM poll tick."""
    now = time.time()
    with _lock:
        live_ids = set()
        for e in entries:
            eid = e.get("id")
            if not eid:
                continue
            is_loading = e.get("state") == "loading"
            tr = _tracks.get(eid)
            if is_loading:
                if tr is None:
                    tr = _Track(eid, e.get("name") or "?", e.get("path") or "", e.get("pids") or [], e.get("ports") or [])
                    _tracks[eid] = tr
                tr.pids = e.get("pids") or tr.pids
                tr.ports = e.get("ports") or tr.ports
                tr.last_seen = now
                live_ids.add(eid)
                try:
                    tr.poll()
                except Exception as exc:  # noqa: BLE001
                    print("bootlog poll err:", exc)
                if tr.boot:
                    b = dict(tr.boot)
                    b["durations"] = _stage_durations(b, now)
                    b["elapsed_s"] = round(now - (b.get("t0") or tr.started), 1)
                    last = last_ok_for(tr.name)
                    b["last_boot"] = {"total_s": last.get("total_s"), "stages": last.get("stages"), "ttft_ms": last.get("ttft_ms")} if last else None
                    if last and not b["ready"]:
                        b["eta_total_s"] = max(0.0, round((last.get("total_s") or 0) - b["elapsed_s"], 0))
                    e.setdefault("loading", {})
                    if e["loading"] is None:
                        e["loading"] = {}
                    e["loading"]["boot"] = b
            else:
                # model went live: a tracker for the same id/name finalises
                if tr and tr.boot and not tr.recorded:
                    if tr.boot.get("api_up") or e.get("served_names"):
                        tr.boot["ready"] = True
                        tr.boot["stage_ts"].setdefault("ready", now)
                        tr.record("ok")
            hist = history_for(e.get("name") or "")
            if hist:
                lastr = hist[-1]
                e["boot_last"] = {"total_s": lastr.get("total_s"), "outcome": lastr.get("outcome"), "ttft_ms": lastr.get("ttft_ms"),
                                  "ended": lastr.get("ended"), "n": len(hist),
                                  "trend": [r.get("total_s") for r in hist if r.get("outcome") == "ok"][-6:]}
        # trackers whose entry vanished: the load died (or finished under a new id)
        for eid, tr in list(_tracks.items()):
            if eid in live_ids:
                continue
            if now - tr.last_seen > 6 and not tr.recorded and tr.boot:
                outcome = "ok" if tr.boot.get("api_up") else "failed"
                if outcome == "failed":
                    tr.boot["failed"] = True
                tr.record(outcome)
            if now - tr.last_seen > TRACK_TTL_S:
                _tracks.pop(eid, None)


# ──────────────────────────── demo replay ────────────────────────────

class Demo:
    """Replays a captured server.log as a synthetic loading model (NVTOP_DEMO_BOOT=/path/server.log)."""

    def __init__(self, path: str, lps: float = 6.0):
        self.path, self.lps = path, lps
        self.lines = [ln for ln in re.split(r"[\r\n]+", Path(path).read_text(errors="replace")) if ln.strip()]
        self.t0 = time.time()
        self.boot = _new_boot(f"demo:{os.path.basename(path)}")
        self.fed = 0

    def entry(self) -> dict:
        n = min(len(self.lines), int((time.time() - self.t0) * self.lps))
        while self.fed < n:
            _feed(self.boot, self.t0 + self.fed / self.lps, self.lines[self.fed])
            self.fed += 1
        b = dict(self.boot)
        now = time.time()
        b["durations"] = _stage_durations(b, now)
        b["elapsed_s"] = round(now - self.t0, 1)
        b["last_boot"] = {"total_s": 312.0, "stages": {"init": 47.0, "weights": 248.0, "warmup": 62.0, "api": 4.0}, "ttft_ms": 190}
        b["eta_total_s"] = max(0.0, 312.0 - b["elapsed_s"])
        if self.fed >= len(self.lines) and b["errors"]:
            b["failed"] = True
        return {
            "id": "sniff-load-demo", "name": "DeepSeek-V4.1-Flash (replay)", "path": self.path, "app": "vllm",
            "state": "loading", "files": [], "n_files": 0, "pids": [], "gpu_indices": [0, 1, 2, 3],
            "vram_mib": None, "disk_gb": 399.5, "ports": [], "served_names": [], "uptime_s": b["elapsed_s"],
            "intel": {"family": "DeepSeek", "creator": "DeepSeek AI", "origin": "Hangzhou", "license": "mit", "quant": "NVFP4", "params": "552B"},
            "loading": {"stages": STAGES, "stage": b["stage"], "stage_idx": STAGES.index(b["stage"]) if b["stage"] in STAGES else 3,
                        "pct": b["shards"]["pct"] if b.get("shards") else None, "detail": b["substage"], "eta_s": None,
                        "cpu_pct": 180.0, "disk_read_mbps": 1650.0, "vram_rate_mibps": 980.0, "rss_mib": 33000.0, "boot": b},
        }


_demo: Demo | None = None
if os.environ.get("NVTOP_DEMO_BOOT"):
    try:
        _demo = Demo(os.environ["NVTOP_DEMO_BOOT"], float(os.environ.get("NVTOP_DEMO_LPS", "6")))
    except Exception as exc:  # noqa: BLE001
        print("bootlog demo disabled:", exc)


def demo_entry() -> dict | None:
    return _demo.entry() if _demo else None
