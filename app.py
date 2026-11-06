#!/usr/bin/env python3
"""nvtop-web — animated nvtop-style web dashboard with LLM throughput telemetry.

Uses NVML (with an nvidia-smi fallback) for per-GPU/process telemetry, probes
OpenAI-compatible model servers, and serves a snapshot JSON + delta SSE stream.
"""
from __future__ import annotations

import asyncio
import importlib.util
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.request
import warnings
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bootlog

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

APP_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = APP_ROOT / "static"
POLL_SECONDS = float(os.environ.get("NVTOP_POLL_SECONDS", "1.0"))
# Fast GPU poll. NVML keeps this inexpensive; a subprocess-based nvidia-smi
# fallback preserves telemetry if the Python binding or driver is unavailable.
# LLM endpoint probes run on their own slower cadence so they never block it.
GPU_POLL_SECONDS = float(os.environ.get("NVTOP_GPU_POLL_SECONDS", str(min(POLL_SECONDS, 0.25))))
LLM_POLL_SECONDS = float(os.environ.get("NVTOP_LLM_POLL_SECONDS", "1.0"))
# Display name for this machine (brand, title, footer). Defaults to the hostname.
HOST_LABEL = os.environ.get("NVTOP_HOST_LABEL") or os.uname().nodename
# Demo/privacy mode: generic model + process identities in the stream (screenshots, kiosks)
MASK_NAMES = os.environ.get("NVTOP_MASK_NAMES") == "1"
# History (chart) sampling cadence — kept ~1s independent of the GPU push rate
# so the chart time-window and per-snapshot payload size stay constant even
# when the live tiles refresh several times per second.
HISTORY_INTERVAL = float(os.environ.get("NVTOP_HISTORY_INTERVAL", "1.0"))
HISTORY_POINTS = int(os.environ.get("NVTOP_HISTORY_POINTS", "180"))

# LLM endpoints we probe. Each entry: scrape metrics for TPS, list served models.
# Accents mapped per-model in the UI.
LLM_ENDPOINTS: list[dict[str, Any]] = [
    {
        "id": "sglang-5001",
        "endpoint": "http://127.0.0.1:5001",
        "label": "GLM-5.3 · SGLang",
        "gpu_indices": [0, 1, 2, 3],
        "accent": "#45d1ff",
        "accent2": "#8b7cff",
    },
]

GPU_QUERY = (
    "index,name,uuid,utilization.gpu,utilization.memory,memory.used,memory.total,"
    "temperature.gpu,power.draw,power.limit,fan.speed,clocks.gr,clocks.mem,"
    "encoder.stats.averageFps,pstate,"
    "pcie.link.gen.current,pcie.link.gen.max,pcie.link.width.current,pcie.link.width.max,"
    "pci.bus_id"
)
PROC_QUERY = "gpu_uuid,pid,process_name,used_memory"

METRIC_RE = re.compile(r"^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)(?P<labels>\{[^}]*\})?\s+(?P<value>[-+0-9.eE]+)\s*$")
LABEL_RE = re.compile(r'(\w+)="((?:[^"\\]|\\.)*)"')


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def f(v: Any, d: float = 0.0) -> float:
    if v in (None, "", "N/A", "[N/A]", "[Not Supported]"):
        return d
    try:
        return float(str(v).strip().split()[0])
    except Exception:
        return d


def run_smi(query: str, mode: str = "gpu") -> list[list[str]]:
    flag = "--query-gpu" if mode == "gpu" else "--query-compute-apps"
    try:
        out = subprocess.run(
            ["nvidia-smi", f"{flag}={query}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=4, check=False,
        )
        if out.returncode != 0:
            return []
        rows = []
        for line in out.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append([c.strip() for c in line.split(",")])
        return rows
    except Exception:
        return []


# NVML avoids spawning eight nvidia-smi processes per second at the default
# cadence. Arch installs the pure-Python binding for its system Python, while
# this service uses an isolated Python; load that binding directly when needed.
# Every path retains the subprocess implementation as a driver-safe fallback.
_NVML: Any = None
_NVML_HANDLES: tuple = ()
_NVML_POOL: ThreadPoolExecutor | None = None
_NVML_RETRY_AT = 0.0
_NVML_STATIC: dict[int, dict[str, Any]] = {}
_NVML_PROC_NAMES: dict[int, str] = {}
_NVML_SLOW: dict[int, tuple[float, dict[str, Any]]] = {}


def _load_nvml():
    global _NVML, _NVML_HANDLES, _NVML_POOL, _NVML_RETRY_AT
    if _NVML is not None:
        return _NVML
    if time.monotonic() < _NVML_RETRY_AT:
        return None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            try:
                import pynvml as nvml
            except ImportError:
                nvml = None
                paths = sorted(
                    Path("/usr/lib").glob("python*/site-packages/pynvml.py"),
                    reverse=True,
                )
                for path in paths:
                    spec = importlib.util.spec_from_file_location("_nvtop_pynvml", path)
                    if spec and spec.loader:
                        nvml = importlib.util.module_from_spec(spec)
                        sys.modules[spec.name] = nvml
                        try:
                            spec.loader.exec_module(nvml)
                        except Exception:
                            sys.modules.pop(spec.name, None)
                            raise
                        break
                if nvml is None:
                    raise ImportError("pynvml binding not found")
        nvml.nvmlInit()
        _NVML_HANDLES = tuple(
            nvml.nvmlDeviceGetHandleByIndex(i)
            for i in range(nvml.nvmlDeviceGetCount())
        )
        _NVML_POOL = ThreadPoolExecutor(
            max_workers=max(1, len(_NVML_HANDLES)),
            thread_name_prefix="nvml",
        )
        _NVML = nvml
        return nvml
    except Exception:
        _NVML_RETRY_AT = time.monotonic() + 30.0
        return None


def _drop_nvml() -> None:
    global _NVML, _NVML_HANDLES, _NVML_POOL, _NVML_RETRY_AT
    if _NVML_POOL is not None:
        _NVML_POOL.shutdown(wait=False, cancel_futures=True)
    if _NVML is not None:
        try:
            _NVML.nvmlShutdown()
        except Exception:
            pass
    _NVML = None
    _NVML_HANDLES = ()
    _NVML_POOL = None
    _NVML_STATIC.clear()
    _NVML_SLOW.clear()
    _NVML_PROC_NAMES.clear()
    _NVML_RETRY_AT = time.monotonic() + 30.0


def _nvml_call(call, default):
    try:
        return call()
    except Exception:
        return default


def _nvml_static_info(nvml, index: int, handle) -> dict[str, Any]:
    cached = _NVML_STATIC.get(index)
    if cached is not None:
        return cached
    pci = _nvml_call(lambda: nvml.nvmlDeviceGetPciInfo(handle), None)
    cached = {
        "index": index,
        "name": str(_nvml_call(lambda: nvml.nvmlDeviceGetName(handle), f"GPU {index}")).replace("NVIDIA ", ""),
        "uuid": str(_nvml_call(lambda: nvml.nvmlDeviceGetUUID(handle), f"GPU-{index}")),
        "pcie_gen_max": int(_nvml_call(lambda: nvml.nvmlDeviceGetMaxPcieLinkGeneration(handle), 0)),
        "pcie_width_max": int(_nvml_call(lambda: nvml.nvmlDeviceGetMaxPcieLinkWidth(handle), 0)),
        "bus_id": str(getattr(pci, "busId", "")),
    }
    _NVML_STATIC[index] = cached
    return cached


def _nvml_device(nvml, index: int, handle) -> dict[str, Any]:
    static = _nvml_static_info(nvml, index, handle)
    util = _nvml_call(lambda: nvml.nvmlDeviceGetUtilizationRates(handle), None)
    memory = _nvml_call(lambda: nvml.nvmlDeviceGetMemoryInfo(handle), None)
    mem_used = float(getattr(memory, "used", 0)) / 2**20
    mem_total = float(getattr(memory, "total", 0)) / 2**20 or 1.0
    power_draw = float(_nvml_call(lambda: nvml.nvmlDeviceGetPowerUsage(handle), 0)) / 1000.0

    now = time.monotonic()
    cached_slow = _NVML_SLOW.get(index)
    if cached_slow is not None and now - cached_slow[0] < 1.0:
        slow = cached_slow[1]
    else:
        pstate = int(_nvml_call(lambda: nvml.nvmlDeviceGetPerformanceState(handle), -1))
        processes = []
        for proc in _nvml_call(lambda: nvml.nvmlDeviceGetComputeRunningProcesses(handle), ()):
            pid = int(proc.pid)
            name = _NVML_PROC_NAMES.get(pid)
            if name is None:
                raw_name = str(_nvml_call(lambda p=pid: nvml.nvmlSystemGetProcessName(p), f"pid {pid}"))
                executable = raw_name.split("\0", 1)[0].split(" ", 1)[0]
                name = (os.path.basename(executable) or raw_name)[:128]
                _NVML_PROC_NAMES[pid] = name
            used = getattr(proc, "usedGpuMemory", 0) or 0
            if used > 2**60:
                used = 0
            processes.append({
                "pid": pid,
                "process_name": name,
                "used_memory_mib": float(used) / 2**20,
            })
        slow = {
            "power_limit_w": float(_nvml_call(lambda: nvml.nvmlDeviceGetPowerManagementLimit(handle), 0)) / 1000.0 or 1.0,
            "temperature_c": float(_nvml_call(lambda: nvml.nvmlDeviceGetTemperature(handle, nvml.NVML_TEMPERATURE_GPU), 0)),
            "fan_pct": float(_nvml_call(lambda: nvml.nvmlDeviceGetFanSpeed(handle), 0)),
            "graphics_clock_mhz": float(_nvml_call(lambda: nvml.nvmlDeviceGetClockInfo(handle, nvml.NVML_CLOCK_GRAPHICS), 0)),
            "memory_clock_mhz": float(_nvml_call(lambda: nvml.nvmlDeviceGetClockInfo(handle, nvml.NVML_CLOCK_MEM), 0)),
            "pstate": f"P{pstate}" if pstate >= 0 else "",
            "pcie_gen": int(_nvml_call(lambda: nvml.nvmlDeviceGetCurrPcieLinkGeneration(handle), 0)),
            "pcie_width": int(_nvml_call(lambda: nvml.nvmlDeviceGetCurrPcieLinkWidth(handle), 0)),
            "pcie_aer": read_pcie_aer(static["bus_id"]),
            "processes": sorted(processes, key=lambda p: -p["used_memory_mib"])[:10],
            # bus traffic (NVML samples ~20 ms per call) + lifetime energy counter
            "pcie_tx_mbps": float(_nvml_call(lambda: nvml.nvmlDeviceGetPcieThroughput(handle, nvml.NVML_PCIE_UTIL_TX_BYTES), 0)) / 1000.0,
            "pcie_rx_mbps": float(_nvml_call(lambda: nvml.nvmlDeviceGetPcieThroughput(handle, nvml.NVML_PCIE_UTIL_RX_BYTES), 0)) / 1000.0,
            "energy_j": float(_nvml_call(lambda: nvml.nvmlDeviceGetTotalEnergyConsumption(handle), 0)) / 1000.0,
        }
        # per-direction link capacity at the *current* link state (Gen × width), MB/s
        lane = {1: 250.0, 2: 500.0, 3: 984.6, 4: 1969.2, 5: 3938.4, 6: 7563.0}.get(slow["pcie_gen"], 0.0)
        slow["pcie_cap_mbps"] = lane * (slow["pcie_width"] or 0)
        _NVML_SLOW[index] = (now, slow)

    power_limit = slow["power_limit_w"]
    return {
        **static,
        **slow,
        "utilization_gpu_pct": float(getattr(util, "gpu", 0)),
        "utilization_memory_pct": float(getattr(util, "memory", 0)),
        "memory_used_mib": mem_used,
        "memory_total_mib": mem_total,
        "memory_pct": (mem_used / mem_total) * 100.0,
        "power_draw_w": power_draw,
        "power_pct": (power_draw / power_limit) * 100.0,
    }

_aer_port_cache: dict[str, str] = {}


def _root_port_for(bdf: str) -> str:
    """Map a GPU PCI BDF to its parent root-port BDF (cached; stable per boot)."""
    if bdf in _aer_port_cache:
        return _aer_port_cache[bdf]
    port = ""
    try:
        port = os.path.basename(os.path.realpath(f"/sys/bus/pci/devices/{bdf}/.."))
    except Exception:
        port = ""
    _aer_port_cache[bdf] = port
    return port


def _read_aer_file(path: str) -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        with open(path) as fh:
            for line in fh:
                key, _, val = line.partition(" ")
                key = key.strip()
                if key:
                    out[key] = int(val.strip() or "0")
    except Exception:
        pass
    return out


def read_pcie_aer(bus_id: str) -> dict[str, Any]:
    """Per-card PCIe AER error counters, read from the GPU's parent root port."""
    bdf = bus_id.strip().lower()
    parts = bdf.split(":")
    if len(parts) == 3 and len(parts[0]) > 4:
        bdf = f"{parts[0][-4:]}:{parts[1]}:{parts[2]}"
    port = _root_port_for(bdf)
    if not port:
        return {}
    base = f"/sys/bus/pci/devices/{port}"
    cor = _read_aer_file(f"{base}/aer_dev_correctable")
    fatal = _read_aer_file(f"{base}/aer_dev_fatal")
    nonfatal = _read_aer_file(f"{base}/aer_dev_nonfatal")
    return {
        "port": port,
        "correctable": cor,
        "total_correctable": cor.get("TOTAL_ERR_COR", 0),
        "total_nonfatal": nonfatal.get("TOTAL_ERR_NONFATAL", 0),
        "total_fatal": fatal.get("TOTAL_ERR_FATAL", 0),
    }

def http_get(url: str, timeout: float = 1.5) -> tuple[int, str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "nvtop-web/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as exc:
        return 0, f"__error__ {exc}"


def parse_prom(text: str) -> list[dict[str, Any]]:
    samples = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = METRIC_RE.match(line)
        if not m:
            continue
        name = m.group("name")
        labels = {}
        raw = m.group("labels")
        if raw:
            for k, v in LABEL_RE.findall(raw[1:-1]):
                labels[k] = v
        try:
            value = float(m.group("value"))
        except Exception:
            continue
        samples.append({"name": name, "labels": labels, "value": value})
    return samples


# ---------- Model intelligence ----------
# Everything we can learn about a served model beyond raw TPS: identity (family /
# creator / origin blurb), architecture facts from its on-disk config.json, weight
# footprint, README model-card summary, engine + version, worker uptime and VRAM.

MODEL_KB: list[tuple[re.Pattern, dict[str, str]]] = [(re.compile(p), d) for p, d in [
    (r"deepseek[-_/ ]?v4(?:\.?1)?[-_/ ]?flash|ds4\.?1f|ds41f|warmind",
     {"family": "DeepSeek", "creator": "DeepSeek AI", "origin": "Hangzhou · CN",
      "blurb": "DeepSeek V4.1 Flash is a sparse-MoE, MLA-family long-context model spanning text and vision."}),
    (r"glm", {"family": "GLM", "creator": "Z.ai (Zhipu AI)", "origin": "Beijing · CN",
              "blurb": "Z.ai's flagship open-weight MoE reasoning line — GLM descends from Tsinghua's General Language Model research."}),
    (r"qwen|qwq|qvq", {"family": "Qwen", "creator": "Alibaba Cloud", "origin": "Hangzhou · CN",
              "blurb": "Alibaba's Tongyi Qianwen family — open-weight dense and MoE models spanning chat, coding, math and vision."}),
    (r"deepseek", {"family": "DeepSeek", "creator": "DeepSeek AI", "origin": "Hangzhou · CN",
              "blurb": "DeepSeek's MoE + MLA pioneers — frontier reasoning at breakthrough training cost."}),
    (r"kimi", {"family": "Kimi", "creator": "Moonshot AI", "origin": "Beijing · CN",
              "blurb": "Moonshot AI's Kimi line — trillion-parameter-class MoE tuned for long context and agentic work."}),
    (r"llama", {"family": "Llama", "creator": "Meta AI", "origin": "Menlo Park · US",
              "blurb": "Meta's Llama herd — the open-weight family that kicked off the local-LLM era."}),
    (r"mixtral|mistral|codestral|devstral|magistral|ministral", {"family": "Mistral", "creator": "Mistral AI", "origin": "Paris · FR",
              "blurb": "Mistral AI's efficient European models — Apache-licensed dense workhorses and sparse MoE."}),
    (r"gemma", {"family": "Gemma", "creator": "Google DeepMind", "origin": "London · UK",
              "blurb": "Google DeepMind's open-weight siblings of Gemini, built for efficient serving."}),
    (r"phi-?\d", {"family": "Phi", "creator": "Microsoft Research", "origin": "Redmond · US",
              "blurb": "Microsoft's small-but-mighty Phi series — textbook-quality data over parameter count."}),
    (r"gpt-oss|gpt", {"family": "GPT", "creator": "OpenAI", "origin": "San Francisco · US",
              "blurb": "OpenAI's GPT lineage — gpt-oss brings the o-series reasoning stack to open weights."}),
    (r"nemotron", {"family": "Nemotron", "creator": "NVIDIA", "origin": "Santa Clara · US",
              "blurb": "NVIDIA's Nemotron models — hybrid-architecture, distillation-heavy, tuned for enterprise agents."}),
    (r"granite", {"family": "Granite", "creator": "IBM Research", "origin": "Yorktown Heights · US",
              "blurb": "IBM's Granite family — enterprise-focused, Apache-licensed, clean data provenance."}),
    (r"command", {"family": "Command", "creator": "Cohere", "origin": "Toronto · CA",
              "blurb": "Cohere's Command series — RAG-first enterprise models with strong tool use."}),
    (r"minimax", {"family": "MiniMax", "creator": "MiniMax", "origin": "Shanghai · CN",
              "blurb": "MiniMax's open MoE line — lightning attention and million-token context ambitions."}),
    (r"hunyuan", {"family": "Hunyuan", "creator": "Tencent", "origin": "Shenzhen · CN",
              "blurb": "Tencent's Hunyuan models — the WeChat giant's open-weight MoE line."}),
    (r"ernie", {"family": "ERNIE", "creator": "Baidu", "origin": "Beijing · CN",
              "blurb": "Baidu's ERNIE family — one of China's longest-running LLM programs, now open-weight."}),
    (r"internlm|intern-?vl", {"family": "InternLM", "creator": "Shanghai AI Lab", "origin": "Shanghai · CN",
              "blurb": "Shanghai AI Laboratory's open research models spanning language and vision."}),
    (r"falcon", {"family": "Falcon", "creator": "TII", "origin": "Abu Dhabi · AE",
              "blurb": "The Technology Innovation Institute's Falcon models — the Gulf's open-weight flagship."}),
    (r"exaone", {"family": "EXAONE", "creator": "LG AI Research", "origin": "Seoul · KR",
              "blurb": "LG's EXAONE — Korea's leading open-weight bilingual model line."}),
    (r"olmo|tulu", {"family": "OLMo", "creator": "Allen Institute for AI", "origin": "Seattle · US",
              "blurb": "AI2's fully-open models — weights, data and training code all published."}),
    (r"hermes", {"family": "Hermes", "creator": "Nous Research", "origin": "US · distributed",
              "blurb": "Nous Research's Hermes fine-tunes — community-driven and maximally steerable."}),
    (r"smollm", {"family": "SmolLM", "creator": "Hugging Face", "origin": "Paris · FR",
              "blurb": "Hugging Face's fully-open small models — trained in the open on curated data."}),
    (r"starcoder", {"family": "StarCoder", "creator": "BigCode (HF × ServiceNow)", "origin": "open consortium",
              "blurb": "The BigCode project's open code models with permissive, opt-out-respecting data."}),
]]


def kb_lookup(text: str) -> dict[str, str]:
    t = text.lower()
    for pat, d in MODEL_KB:
        if pat.search(t):
            return d
    return {}


_boot_ts: float = 0.0


def _boot_time() -> float:
    global _boot_ts
    if not _boot_ts:
        try:
            with open("/proc/stat") as fh:
                for ln in fh:
                    if ln.startswith("btime"):
                        _boot_ts = float(ln.split()[1])
                        break
        except Exception:
            _boot_ts = time.time() - uptime_seconds()
    return _boot_ts


_pid_start_cache: dict[int, float] = {}


def _pid_started(pid: int) -> float | None:
    """Epoch timestamp the process started (cached — it never changes)."""
    hit = _pid_start_cache.get(pid)
    if hit:
        return hit
    try:
        with open(f"/proc/{pid}/stat") as fh:
            parts = fh.read().rsplit(")", 1)[1].split()
        t = _boot_time() + float(parts[19]) / os.sysconf("SC_CLK_TCK")
    except Exception:
        return None
    if len(_pid_start_cache) > 4096:
        _pid_start_cache.clear()
    _pid_start_cache[pid] = t
    return t


_engine_cache: dict[str, dict[str, Any]] = {}


def probe_engine(cfg: dict[str, Any], prefix: str, signature: str = "") -> dict[str, Any]:
    """Engine name/version + native model facts.

    The current API identity is part of the cache key: a new server or model
    behind a reused port must not inherit the prior engine or model path.
    """
    ep = cfg["endpoint"].rstrip("/")
    now = time.time()
    cache_signature = f"{prefix}\0{signature}"
    hit = _engine_cache.get(ep)
    if hit and hit.get("signature", "") == cache_signature \
            and now - hit["ts"] < (600 if hit["engine"] else 20):
        return hit
    info: dict[str, Any] = {
        "ts": now, "signature": cache_signature, "engine": "", "engine_version": "",
        "srv_model_path": "", "srv_ctx": None,
    }
    # Flare exposes a vLLM-compatible /version response. Its native marker is
    # the `flare` object in /v1/models and/or flare_* Prometheus metrics, both
    # detected by scrape_endpoint before this compatibility probe.
    if prefix == "flare":
        info["engine"] = "Flare"
    elif prefix != "vllm":  # SGLang, or unknown: cheap native probe
        code, body = http_get(ep + "/get_model_info", timeout=1.0)
        if code == 200:
            try:
                j = json.loads(body)
                info["engine"] = "SGLang"
                info["srv_model_path"] = str(j.get("model_path") or "")
            except Exception:
                pass
        if info["engine"] == "SGLang":
            code, body = http_get(ep + "/get_server_info", timeout=1.5)
            if code == 200:
                try:
                    j = json.loads(body)
                    info["engine_version"] = str(j.get("version") or "")
                    info["srv_ctx"] = j.get("context_len") or (j.get("model_config") or {}).get("context_len")
                except Exception:
                    pass
    if not info["engine"]:
        code, body = http_get(ep + "/version", timeout=1.0)
        if code == 200:
            try:
                v = json.loads(body).get("version")
                if v:
                    info["engine"] = "vLLM"
                    info["engine_version"] = str(v)
            except Exception:
                pass
    if not info["engine"] and prefix:
        info["engine"] = {"vllm": "vLLM", "sglang": "SGLang", "flare": "Flare"}.get(prefix, "")
    _engine_cache[ep] = info
    return info


def _fmt_params(n: float) -> str:
    if n >= 1e12:
        return f"{n / 1e12:.2f}".rstrip("0").rstrip(".") + "T"
    if n >= 1e9:
        v = n / 1e9
        return (f"{v:.0f}" if v >= 100 else f"{v:.1f}") + "B"
    return f"{n / 1e6:.0f}M"


def _strip_md(s: str) -> str:
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = s.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", s).strip()


def _readme_intel(path: str) -> dict[str, Any]:
    """license / base_model front matter, first substantive paragraph as a short
    summary, and a stated parameter count ("753B") if the card leads with one."""
    try:
        with open(os.path.join(path, "README.md"), encoding="utf-8", errors="replace") as fh:
            text = fh.read(24576)
    except OSError:
        return {}
    out: dict[str, Any] = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            fm, body = text[3:end], text[end + 4:]
            lm = re.search(r"^license(?:_name)?:\s*(\S[^\n]*)", fm, re.M)
            if lm:
                out["license"] = lm.group(1).strip().strip("\"'")
            bm = re.search(r"^base_model:\s*\n((?:\s*-\s*\S+\n?)+)", fm, re.M)
            if bm:
                out["base_model"] = [x.strip("- ").strip() for x in bm.group(1).strip().splitlines()][:3]
            else:
                bm1 = re.search(r"^base_model:\s*(\S+)", fm, re.M)
                if bm1:
                    out["base_model"] = [bm1.group(1)]
    for para in re.split(r"\n\s*\n", body):
        s = para.strip()
        if not s or s.startswith(("#", ">", "|", "![", "<", "```", "---")):
            continue
        s = _strip_md(s)
        if len(s) < 60:
            continue
        if len(s) > 300:
            s = s[:300].rsplit(" ", 1)[0] + " …"
        out["summary"] = s
        break
    sm = re.search(r"\b(\d{1,4}(?:\.\d+)?)\s?B\b", _strip_md(body)[:1500])
    if sm and 0.1 <= float(sm.group(1)) <= 5000:
        out["params"] = sm.group(1) + "B"
    return out


def _safetensor_params(path: str) -> int:
    """Exact logical tensor-element count for ordinary safetensors shards.

    Flare containers are byte archives represented as opaque U8 tensors; their
    shapes are payload byte counts, never model parameter counts.
    """
    total = 0
    try:
        for name in os.listdir(path):
            if not name.endswith(".safetensors"):
                continue
            with open(os.path.join(path, name), "rb") as fh:
                hlen = int.from_bytes(fh.read(8), "little")
                if not 0 < hlen < 50_000_000:
                    return 0
                hdr = json.loads(fh.read(hlen))
            metadata = hdr.get("__metadata__") or {}
            if str(metadata.get("format") or "").lower().startswith("flare"):
                continue
            for k, v in hdr.items():
                if k == "__metadata__" or not isinstance(v, dict):
                    continue
                p = 1
                for s in v.get("shape") or []:
                    p *= s
                total += p
    except Exception:
        return 0
    return total


_disk_cache: dict[str, dict[str, Any]] = {}


def disk_intel(path: str) -> dict[str, Any]:
    """Architecture / quant / context / weight facts from a local model dir.
    Cached by config.json mtime; the safetensors header scan runs once."""
    cfg_p = os.path.join(path, "config.json")
    try:
        mtime = os.stat(cfg_p).st_mtime
    except OSError:
        return {}
    hit = _disk_cache.get(path)
    if hit is not None and hit.get("_mtime") == mtime:
        return hit
    out: dict[str, Any] = {"_mtime": mtime}
    try:
        with open(cfg_p) as fh:
            cfg = json.load(fh)
    except Exception:
        cfg = {}
    text_cfg = cfg.get("text_config")
    if not isinstance(text_cfg, dict):
        text_cfg = {}

    def cv(*names: str):
        for source in (text_cfg, cfg):
            for name in names:
                value = source.get(name)
                if value is not None:
                    return value
        return None

    arch = (cfg.get("architectures") or text_cfg.get("architectures") or [""])[0]
    out["arch"] = re.sub(r"For(CausalLM|ConditionalGeneration)$", "", arch)
    out["model_type"] = cfg.get("model_type") or text_cfg.get("model_type") or ""
    out["layers"] = cv("num_hidden_layers")
    out["hidden"] = cv("hidden_size")
    out["heads"] = cv("num_attention_heads")
    out["kv_heads"] = cv("num_key_value_heads")
    out["vocab"] = cv("vocab_size")
    out["ctx_native"] = cv("max_position_embeddings")
    out["dtype"] = str(cv("dtype", "torch_dtype") or "")
    deepseek_mla = "deepseek" in str(out["model_type"]).lower() and text_cfg.get("q_lora_rank")
    out["attn"] = "MLA" if cv("kv_lora_rank") or deepseek_mla else ""
    experts = cv("n_routed_experts", "num_local_experts", "num_experts")
    if experts:
        out["moe"] = {
            "experts": experts,
            "active": cv("num_experts_per_tok", "moe_top_k"),
            "shared": cv("n_shared_experts") or 0,
        }
    qc = cfg.get("quantization_config") or text_cfg.get("quantization_config") or {}
    if not isinstance(qc, dict):
        qc = {}
    quant_method = str(qc.get("quant_algo") or qc.get("quant_method") or "")
    expert_dtype = str(qc.get("expert_dtype") or "")
    bits = qc.get("bits")
    quant = quant_method
    if bits and quant:
        quant = f"{quant} {bits}-bit"
    if expert_dtype and quant:
        quant = f"{quant} + {expert_dtype} experts"
    out["quant"] = quant.upper()[:32]
    out["_quant_method"] = quant_method.lower()
    out["_expert_dtype"] = expert_dtype.lower()
    total = 0
    try:
        with os.scandir(path) as it:
            for e in it:
                if e.is_file() and e.name.endswith((".safetensors", ".bin", ".gguf", ".pt")):
                    total += e.stat().st_size
    except OSError:
        pass
    out["weights_gb"] = round(total / 1e9, 1) if total else None
    out.update(_readme_intel(path))
    # Packed/quantized tensors encode bytes and scales rather than one logical
    # element per parameter. Only surface a count stated by the model card.
    if not out.get("params") and not quant_method:
        n = _safetensor_params(path)
        if n:
            out["params"] = _fmt_params(n)
    _disk_cache[path] = out
    return out


def _flag(text: str, *flags: str) -> str:
    for fl in flags:
        mt = re.search(rf"(?:^|\s){re.escape(fl)}(?:[= ]\s*)(\S+)", text)
        if mt:
            return mt.group(1)
    return ""


def _int_flag(text: str, *flags: str) -> int | None:
    try:
        return int(_flag(text, *flags))
    except (TypeError, ValueError):
        return None


_FLARE_RUN_RE = re.compile(
    r"(?:^|\s)(?:[^\s\"']*/)?flare\s+run\s+(?P<package>\"[^\"]+\"|'[^']+'|\S+)",
    re.I,
)


def _flare_run_package(cmd: str) -> str:
    """Return Flare's positional PACKAGE argument, without inferring identity."""
    for match in _FLARE_RUN_RE.finditer(cmd or ""):
        package = match.group("package").strip().strip("'\"")
        if package and not package.startswith("-") and "$" not in package:
            return package
    return ""


def _model_roots(m: dict[str, Any]) -> list[str]:
    return [
        str(meta.get("root") or "")
        for meta in m.get("model_meta") or []
        if meta.get("root")
    ]


def _resolve_model_path(m: dict[str, Any], anc: str) -> str:
    """Resolve the authoritative config/model-card directory.

    An exact runtime root is stronger than an engine path or served alias. A
    loose name is accepted only when it identifies one local checkpoint.
    """
    roots = _model_roots(m)
    for root in roots:
        if root.startswith("/") and os.path.isdir(root) \
                and os.path.exists(os.path.join(root, "config.json")):
            return root
        exact = _match_local_dir(root, allow_partial=False)
        if exact:
            return exact
    cands: list[str] = []
    if m.get("srv_model_path"):
        cands.append(str(m["srv_model_path"]))
    for fl in ("--model-path", "--model_path", "--model"):
        value = _flag(anc, fl)
        if value:
            cands.append(value)
    for candidate in cands:
        if candidate.startswith("/") and os.path.isdir(candidate) \
                and os.path.exists(os.path.join(candidate, "config.json")):
            return candidate
    if any(os.path.basename(root.rstrip("/")).lower() not in
           {"model", "models", "checkpoint", "weights"} for root in roots):
        return ""  # An unavailable explicit checkpoint must not borrow alias metadata.
    # Container paths and repository IDs may not exist in the host namespace.
    # Retain ambiguity rather than selecting the first similarly named variant.
    for name in roots + cands + list(m.get("model_names") or []):
        match = _match_local_dir(name)
        if match:
            return match
    return ""


def _runtime_artifact_path(m: dict[str, Any], anc: str, config_path: str) -> str:
    package = _flare_run_package(anc) if m.get("engine") == "Flare" else ""
    if package:
        return package
    for value in (
        m.get("srv_model_path"),
        _flag(anc, "--model-path", "--model_path", "--model", "--ckpt", "--gguf"),
    ):
        if value:
            return str(value)
    for root in _model_roots(m):
        if root.startswith("/"):
            return root
    return config_path


def _package_name(runtime_path: str, engine: str) -> str:
    if engine != "Flare" or not runtime_path:
        return ""
    path = runtime_path.rstrip("/")
    if path.lower().endswith((".safetensors", ".gguf", ".bin", ".pt", ".pth",
                              ".onnx", ".ckpt", ".engine")):
        return os.path.basename(os.path.dirname(path))
    return os.path.basename(path)


def _deepseek_v41_details(source_identity: str, alias: str, disk: dict[str, Any]) -> dict[str, str]:
    """Describe explicit V4.1 Flash lineage without guessing from the engine."""
    source_leaf = os.path.basename((source_identity or "").rstrip("/"))
    source = source_leaf.lower()
    alias_l = (alias or "").lower()
    if not re.search(r"deepseek[-_ ]?v4[._]?1[-_ ]?flash|ds4\.?1f|ds41f|warmind", source or alias_l):
        return {}

    # API root/config identity is authoritative. A served alias fills gaps only
    # when no source identity exists; it cannot relabel stock weights as a
    # derivative or imply a package precision.
    identity_text = source or alias_l
    checkpoint_match = re.search(
        r"(?:flash|checkpoint|ckpt|warmind)[-_ ]*(\d{4})(?:\D|$)", identity_text
    )
    checkpoint = checkpoint_match.group(1) if checkpoint_match else ""
    explicit_abliterated = "abliterat" in identity_text
    known_warmind_root = (
        "deepseek-v4.1-flash-1017-abliterated-native-overnight" in source
        or "deepseek-v4.1-flash-1017-abliterated-lossless-csf" in source
        or bool(re.fullmatch(r"warmind[-_ ]1017(?:[-_ ](?:nvfp4|lossless|csf|native))*", source))
    )
    warmind = "warmind" in identity_text or known_warmind_root
    explicit_abliterated = explicit_abliterated or known_warmind_root
    quant_text = str(disk.get("quant") or "").lower()
    csf = "csf" in source or "csf" in quant_text
    quant_method = str(disk.get("_quant_method") or "").lower()
    nvidia_nvfp4 = ("nvfp4" in source or quant_method == "nvfp4") and not csf
    expert_dtype = str(disk.get("_expert_dtype") or "").lower()
    mixed_fp8_fp4 = quant_method == "fp8" and expert_dtype == "fp4"
    native_mixed = mixed_fp8_fp4 and "native" in source

    canonical = source.replace("_", "-").replace(" ", "-")
    canonical_match = re.fullmatch(
        r"deepseek-v4\.1-flash(?:-1017)?"
        r"(?:-(?:stock|native|mixed|overnight|lossless|csf|fp4|fp8|mxfp4|experts?|nvidia|nvfp4))*",
        canonical,
    )
    stock = bool(source and canonical_match and not explicit_abliterated and not warmind)
    if not checkpoint and canonical_match and not re.search(r"flash-\d{4}", canonical):
        checkpoint = "Original"

    variant_parts: list[str] = []
    if explicit_abliterated:
        variant_parts.append("WARMIND abliterated" if warmind else "Abliterated")
    elif warmind:
        variant_parts.append("WARMIND")
    elif stock:
        variant_parts.append("Stock")
    if csf:
        variant_parts.append("Lossless FP4-CSF")
    elif nvidia_nvfp4:
        variant_parts.append("NVIDIA NVFP4")
    elif native_mixed:
        variant_parts.append("Native mixed FP8/FP4")
    elif mixed_fp8_fp4:
        variant_parts.append("Mixed FP8/FP4")

    if checkpoint == "1017":
        prose = (
            "DeepSeek V4.1 Flash 1017 updates the sparse-MoE/MLA original with "
            "documented gains in reasoning, coding, agentic and visual tasks."
        )
    elif checkpoint == "Original":
        prose = (
            "DeepSeek V4.1 Flash is DeepSeek AI's original sparse-MoE/MLA "
            "long-context release spanning text and vision."
        )
    elif checkpoint:
        prose = (
            f"DeepSeek V4.1 Flash checkpoint {checkpoint} retains its exact runtime "
            "identity; it is not relabelled as the original or 1017 checkpoint."
        )
    else:
        prose = (
            "DeepSeek V4.1 Flash is DeepSeek AI's sparse-MoE/MLA long-context "
            "model spanning text and vision."
        )
    if explicit_abliterated:
        lineage = "WARMIND abliterated" if warmind else "abliterated"
        prose += (
            f" This {lineage} derivative applies a targeted refusal-direction "
            "weight edit; it is not the stock checkpoint."
        )
    elif warmind and not source:
        prose += (
            " WARMIND identifies the local model family; no checkpoint or weight "
            "precision is inferred from that alias alone."
        )
    elif stock:
        prose += " This identity denotes the stock DeepSeek checkpoint."
    if csf:
        prose += (
            " LiL's lossless CSF packaging compresses routed-expert scales while "
            "preserving dense tensors; it is distinct from NVIDIA NVFP4."
        )
    elif nvidia_nvfp4:
        prose += (
            " This identity explicitly denotes NVIDIA NVFP4 weights, not LiL "
            "lossless CSF or native mixed FP8/FP4."
        )
    elif mixed_fp8_fp4:
        dtype = str(disk.get("dtype") or "").lower()
        dtype_label = {
            "bfloat16": "BF16", "bf16": "BF16", "float16": "FP16",
            "float32": "FP32",
        }.get(dtype, dtype.upper())
        dtype_clause = f"{dtype_label} model dtype, " if dtype_label else ""
        precision = "native mixed precision" if native_mixed else "mixed precision"
        prose += (
            f" Config records {dtype_clause}FP8 quantization and FP4 experts—"
            f"{precision}, not NVIDIA whole-model NVFP4."
        )

    quant = str(disk.get("quant") or "")
    if csf:
        quant = "LOSSLESS FP4-CSF"
    elif nvidia_nvfp4:
        quant = "NVIDIA NVFP4"
    display_name = ""
    if checkpoint in ("Original", "1017") and (canonical_match or known_warmind_root):
        display_name = "DeepSeek V4.1 Flash" + (f" {checkpoint}" if checkpoint != "Original" else "")
        if warmind:
            display_name += " · WARMIND"
    return {
        "display_name": display_name,
        "variant": " · ".join(variant_parts),
        "checkpoint": checkpoint,
        "blurb": prose,
        "quant": quant,
    }


def enrich_models(models: list[dict[str, Any]], now: float) -> None:
    """Attach identity, architecture, provenance and serving facts."""
    for m in models:
        pids = m.get("worker_pids") or []
        anc = "\n".join(_ancestor_cmdlines(p) for p in pids[:3])
        config_path = _resolve_model_path(m, anc)
        disk = disk_intel(config_path) if config_path else {}
        served = next(iter(m.get("model_names") or []), "")
        roots = _model_roots(m)
        weight_identity = roots[0] if roots else (
            os.path.basename(config_path.rstrip("/")) if config_path else served
        )
        display_name = (
            os.path.basename(weight_identity.rstrip("/"))
            if "/" in weight_identity else weight_identity
        )
        runtime_path = _runtime_artifact_path(m, anc, config_path)
        distinct_config = ""
        if config_path and runtime_path:
            if os.path.realpath(config_path) != os.path.realpath(runtime_path):
                distinct_config = config_path
        source_identity = roots[0] if roots else (
            os.path.basename(config_path.rstrip("/")) if config_path else ""
        )
        kb = kb_lookup(weight_identity) or kb_lookup(served)
        details = _deepseek_v41_details(source_identity, served, disk)
        meta = next(iter(m.get("model_meta") or []), {})
        ctx_srv = meta.get("max_model_len") or m.get("srv_ctx") or _int_flag(anc, "--max-model-len")
        tp = _int_flag(anc, "--tensor-parallel-size", "--tp-size", "--tp", "-tp") \
            or (len(m.get("gpu_indices") or []) or None)
        starts = [t for t in (_pid_started(p) for p in pids) if t]
        summary = disk.get("summary", "")
        if details:
            facts = []
            if m.get("engine"):
                runtime = f"Served by {m['engine']}"
                if tp:
                    runtime += f" across {tp} GPU{'s' if tp != 1 else ''}"
                if ctx_srv:
                    runtime += f" with a {int(ctx_srv):,}-token context window"
                facts.append(runtime + ".")
            moe = disk.get("moe") or {}
            if moe.get("experts") and moe.get("active"):
                routing = f"{moe['experts']} routed experts, {moe['active']} selected per token"
                if moe.get("shared"):
                    routing += f" plus {moe['shared']} shared"
                facts.append(routing + ".")
            draft_tokens = _int_flag(anc, "--mtp-draft-tokens") if m.get("engine") == "Flare" else None
            if draft_tokens:
                facts.append(f"MTP uses up to {draft_tokens} draft tokens per step.")
            summary = " ".join(facts)
        m["intel"] = {
            "display_name": details.get("display_name") or display_name,
            "weight_identity": weight_identity,
            "package": _package_name(runtime_path, m.get("engine", "")),
            "variant": details.get("variant", ""),
            "checkpoint": details.get("checkpoint", ""),
            "path": runtime_path,
            "config_path": distinct_config,
            "family": kb.get("family", ""),
            "creator": kb.get("creator", ""),
            "origin": kb.get("origin", ""),
            "blurb": details.get("blurb") or kb.get("blurb", ""),
            "summary": summary,
            "license": disk.get("license", ""),
            "base_model": disk.get("base_model") or [],
            "arch": disk.get("arch", ""),
            "model_type": disk.get("model_type", ""),
            "attn": disk.get("attn", ""),
            "params": disk.get("params", ""),
            "layers": disk.get("layers"),
            "hidden": disk.get("hidden"),
            "heads": disk.get("heads"),
            "kv_heads": disk.get("kv_heads"),
            "vocab": disk.get("vocab"),
            "moe": disk.get("moe"),
            "quant": details.get("quant", disk.get("quant", "")),
            "dtype": disk.get("dtype", ""),
            "ctx_native": disk.get("ctx_native"),
            "ctx_serving": ctx_srv,
            "weights_gb": disk.get("weights_gb"),
            "engine": m.get("engine", ""),
            "engine_version": m.get("engine_version", ""),
            "tp": tp,
            "uptime_s": (now - min(starts)) if starts else None,
            "vram_mib": m.get("vram_mib"),
        }


# ---------- Universal model sniffer ----------
# Endpoint-agnostic detection: any GPU compute process holding model weights
# (mmap'd or open .safetensors/.gguf/.pt/... >= 64 MB) is reported, with the
# owning app, VRAM, GPUs, weight files, discovered API ports and — when the
# weights live in a local HF-style dir — full disk_intel enrichment.

_WEIGHT_MIN_BYTES = 64 * 1024 * 1024


def _is_weight_file(path: str) -> bool:
    if path.endswith((".safetensors", ".gguf", ".pt", ".pth", ".onnx", ".ckpt", ".engine")):
        return not path.startswith(("/tmp/torchinductor", "/dev", "/proc"))
    if path.endswith(".bin"):
        b = os.path.basename(path).lower()
        return "model" in b or "weight" in b or "consolidated" in b
    return False


_fsize_cache: dict[str, float] = {}


def _fsize(path: str) -> float:
    v = _fsize_cache.get(path)
    if v is None:
        try:
            v = float(os.stat(path).st_size)
        except OSError:
            v = 0.0
        if len(_fsize_cache) > 8192:
            _fsize_cache.clear()
        _fsize_cache[path] = v
    return v


_maps_cache: dict[int, tuple[float, frozenset]] = {}


def _pid_weight_files(pid: int) -> frozenset:
    """Weight files a process holds: mmap'd regions (survive fd close — how
    safetensors loads) plus open fds. Cached 10 s per pid."""
    now = time.time()
    hit = _maps_cache.get(pid)
    if hit and now - hit[0] < 10:
        return hit[1]
    found: set[str] = set()
    try:
        with open(f"/proc/{pid}/maps") as fh:
            for ln in fh:
                i = ln.find("/")
                if i < 0:
                    continue
                path = ln[i:].strip()
                if path.endswith(" (deleted)"):
                    path = path[:-10]
                if _is_weight_file(path):
                    found.add(path)
    except OSError:
        pass
    try:
        for fd in os.listdir(f"/proc/{pid}/fd"):
            try:
                tgt = os.readlink(f"/proc/{pid}/fd/{fd}")
            except OSError:
                continue
            if tgt.startswith("/") and _is_weight_file(tgt):
                found.add(tgt)
    except OSError:
        pass
    fs = frozenset(p for p in found if _fsize(p) >= _WEIGHT_MIN_BYTES)
    if len(_maps_cache) > 512:
        _maps_cache.clear()
    _maps_cache[pid] = (now, fs)
    return fs


def _cmdline_model_paths(anc: str) -> set:
    out: set[str] = set()
    for fl in ("--model-path", "--model_path", "--model", "--checkpoint-path", "--distilled-checkpoint-path",
               "--spatial-upsampler-path", "--gemma-root", "--ckpt", "--weights", "--lora-path"):
        v = _flag(anc, fl)
        if v:
            out.add(v)
    for mt in re.finditer(r"(/\S+\.(?:safetensors|gguf|bin|pt|pth|onnx|ckpt))(?=\s|$)", anc):
        out.add(mt.group(1))
    return {p for p in out if p.startswith("/") and os.path.exists(p)}


_APP_SIGS = [
    ("flare", "Flare"), ("vllm", "vLLM"), ("sglang", "SGLang"),
    ("llama-server", "llama.cpp"), ("llama.cpp", "llama.cpp"),
    ("ollama", "Ollama"), ("comfyui", "ComfyUI"), ("ComfyUI", "ComfyUI"), ("ltx", "LTX-2"),
    ("text-generation", "TGI"), ("exllama", "ExLlama"), ("ktransformers", "KTransformers"),
    ("diffusers", "Diffusers"), ("whisper", "Whisper"), ("torchrun", "torchrun"), ("accelerate", "Accelerate"),
]


def _detect_app(anc: str) -> str:
    for sig, name in _APP_SIGS:
        if sig in anc or sig.lower() in anc.lower():
            return name
    mt = re.search(r"-m\s+([\w\.]+)", anc)
    if mt:
        return mt.group(1).split(".")[0]
    mt = re.search(r"(\S+\.py)\b", anc)
    if mt:
        return os.path.basename(mt.group(1))
    return ""


def _model_key_name(path: str) -> tuple:
    """Map a weight path to a stable (group_key, display_name): sharded/HF
    checkpoints group under their directory."""
    p = path.rstrip("/")
    if os.path.isdir(p):
        return p, os.path.basename(p)
    d = os.path.dirname(p)
    base = os.path.basename(p)
    if re.search(r"-\d{5}-of-\d{5}", base) or os.path.exists(os.path.join(d, "config.json")):
        return d, os.path.basename(d)
    if base == "model.safetensors" and os.path.basename(d):
        return p, os.path.basename(d)
    return p, re.sub(r"\.(safetensors|gguf|bin|pt|pth|onnx|ckpt|engine)$", "", base)


def _listen_ports(pids: set) -> dict:
    """pid -> sorted listening TCP ports, via socket-inode matching."""
    inodes: dict[str, int] = {}
    for f in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(f) as fh:
                next(fh)
                for ln in fh:
                    parts = ln.split()
                    if len(parts) > 9 and parts[3] == "0A":
                        inodes[parts[9]] = int(parts[1].rsplit(":", 1)[1], 16)
        except OSError:
            continue
    out: dict[int, list] = {}
    for pid in pids:
        ports = set()
        try:
            for fd in os.listdir(f"/proc/{pid}/fd"):
                try:
                    tgt = os.readlink(f"/proc/{pid}/fd/{fd}")
                except OSError:
                    continue
                if tgt.startswith("socket:["):
                    port = inodes.get(tgt[8:-1])
                    if port:
                        ports.add(port)
        except OSError:
            continue
        if ports:
            out[pid] = sorted(ports)
    return out


_port_probe_cache: dict[int, tuple[float, list]] = {}


def _probe_port_models(port: int) -> list:
    """Served model ids if the port speaks OpenAI /v1/models. Cached 2 min."""
    now = time.time()
    hit = _port_probe_cache.get(port)
    if hit and now - hit[0] < 120:
        return hit[1]
    names: list[str] = []
    code, body = http_get(f"http://127.0.0.1:{port}/v1/models", timeout=0.8)
    if code == 200:
        try:
            names = [d.get("id", "") for d in json.loads(body).get("data", []) if d.get("id")]
        except Exception:
            pass
    if len(_port_probe_cache) > 256:
        _port_probe_cache.clear()
    _port_probe_cache[port] = (now, names)
    return names


_SERVE_SIG_RE = re.compile(
    r"(vllm(?:\.entrypoints\S*)?\s+serve|-m\s+vllm\.entrypoints|sglang\.launch_server|"
    r"(?:^|\s)(?:\S*/)?flare\s+run\b|llama-server|ollama\s+(?:serve|runner)|"
    r"text-generation-launcher|lmdeploy\s+serve)", re.I)

_ENGINE_SIGS = [("flare", "Flare"), ("vllm", "vLLM"), ("sglang", "SGLang"),
                ("llama-server", "llama.cpp"), ("ollama", "Ollama"),
                ("text-generation", "TGI"), ("lmdeploy", "LMDeploy")]


def _clean_arg(v: str) -> str:
    """Drop garbage scraped from wrapper-script argv (docker-init/bash hold the
    raw script text, so flags can surface as unexpanded '"${served_name}"')."""
    v = (v or "").strip().strip("'\"")
    return "" if "$" in v else v


def _scan_serving_procs() -> list:
    """System-wide sweep for model-serving processes by cmdline signature.
    Catches servers during weight load (before any CUDA context exists) and
    root / containerized servers whose /proc/<pid>/maps we can't read —
    /proc/<pid>/cmdline is world-readable either way."""
    out = []
    try:
        pids = [int(d) for d in os.listdir("/proc") if d.isdigit()]
    except OSError:
        return out
    for pid in pids:
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as fh:
                cmd = fh.read(8192).replace(b"\0", b" ").decode("utf-8", "replace").strip()
        except OSError:
            continue
        if not cmd or not _SERVE_SIG_RE.search(cmd):
            continue
        engine = "Flare" if _FLARE_RUN_RE.search(cmd) else next(
            (n for s, n in _ENGINE_SIGS if s != "flare" and s in cmd.lower()), ""
        )
        mpath = _flare_run_package(cmd) if engine == "Flare" else ""
        for fl in ("--model-path", "--model_path", "--model", "--ckpt", "--gguf"):
            if mpath:
                break
            v = _flag(cmd, fl)
            if v and not v.startswith("-"):
                mpath = v
                break
        if not mpath and engine == "llama.cpp":
            mpath = _flag(cmd, "-m")
        if not mpath:
            mt = re.search(r"\bserve\s+([^-\s]\S*)", cmd)
            if mt:
                mpath = mt.group(1)
        port = _int_flag(cmd, "--port")
        if port is None and engine == "Flare":
            port = 8000
        out.append({
            "pid": pid,
            "engine": engine,
            "port": port,
            "name": _clean_arg(_flag(cmd, "--served-model-name", "--served_model_name", "--model-name", "--alias")),
            "mpath": _clean_arg(mpath),
        })
    return out


_local_dirs_cache: dict[str, Any] = {"ts": 0.0, "dirs": []}


def _local_model_dirs() -> list:
    """Model dirs (containing config.json) under NVTOP_MODEL_ROOTS, cached 5 min."""
    now = time.time()
    if now - _local_dirs_cache["ts"] < 300:
        return _local_dirs_cache["dirs"]
    dirs: list[str] = []
    for root in os.environ.get("NVTOP_MODEL_ROOTS", "/mnt/2king/models").split(":"):
        for pat in ("*", "*/*"):
            try:
                import glob as _glob
                for d in _glob.glob(os.path.join(root, pat)):
                    if os.path.isdir(d) and os.path.exists(os.path.join(d, "config.json")):
                        dirs.append(d)
            except OSError:
                continue
    _local_dirs_cache.update(ts=now, dirs=dirs)
    return dirs


def _resolve_serving_path(sp: dict) -> str:
    """Best-effort host artifact: direct path, container path, then local config."""
    mp = sp.get("mpath") or ""
    if mp and (os.path.isdir(mp) or os.path.isfile(mp)):
        return mp
    if mp.startswith("/"):
        alt = f"/proc/{sp['pid']}/root{mp}"
        try:
            if os.path.isfile(alt) or (
                os.path.isdir(alt) and os.path.exists(os.path.join(alt, "config.json"))
            ):
                return alt
        except OSError:
            pass
    return _match_local_dir(sp.get("name") or os.path.basename(mp.rstrip("/")))


def _match_local_dir(name: str, allow_partial: bool = True) -> str:
    """Match a checkpoint basename exactly, or uniquely when partial."""
    leaf = os.path.basename((name or "").rstrip("/")).casefold().strip()
    if not leaf:
        return ""
    dirs = _local_model_dirs()
    exact = [d for d in dirs if os.path.basename(d).casefold() == leaf]
    if exact:
        return exact[0]

    def normalized(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", value.casefold())

    needle = normalized(leaf)
    canonical = [d for d in dirs if normalized(os.path.basename(d)) == needle]
    if canonical:
        return canonical[0]
    if not allow_partial or not needle:
        return ""
    matches = {
        d for d in dirs
        if needle in normalized(os.path.basename(d))
        or normalized(os.path.basename(d)) in needle
    }
    return next(iter(matches)) if len(matches) == 1 else ""


def _intel_lite(kb: dict, disk: dict) -> dict:
    return {
        "family": kb.get("family", ""),
        "creator": kb.get("creator", ""),
        "origin": kb.get("origin", ""),
        "blurb": kb.get("blurb", ""),
        "summary": disk.get("summary", ""),
        "license": disk.get("license", ""),
        "arch": disk.get("arch", ""),
        "params": disk.get("params", ""),
        "quant": disk.get("quant", ""),
        "dtype": disk.get("dtype", ""),
        "ctx_native": disk.get("ctx_native"),
        "moe": disk.get("moe"),
        "layers": disk.get("layers"),
        "hidden": disk.get("hidden"),
        "heads": disk.get("heads"),
        "attn": disk.get("attn", ""),
    }


# ---------- Model-load telemetry ----------
# Realtime progress for a model being loaded, from world-readable /proc only
# (works for root / containerized loaders): VRAM fill vs expected weights,
# disk read rate of the volume feeding the load, loader CPU, RAM staging, ETA.

_dev_cache: dict[str, str] = {}


def _dev_for_path(path: str) -> str:
    """maj:min of the block device backing path (for /proc/diskstats lookup).
    Anonymous-device filesystems (btrfs/bcachefs multi-device: st_dev major 0)
    resolve via /proc/mounts source; '*' = sum all physical disks."""
    dev = _dev_cache.get(path)
    if dev is not None:
        return dev
    dev = ""
    try:
        st = os.stat(path)
        if os.major(st.st_dev):
            dev = f"{os.major(st.st_dev)}:{os.minor(st.st_dev)}"
        else:
            best = ("", "")
            with open("/proc/mounts") as fh:
                for ln in fh:
                    parts = ln.split()
                    if len(parts) > 1 and parts[0].startswith("/dev/") \
                            and path.startswith(parts[1]) and len(parts[1]) > len(best[0]):
                        best = (parts[1], parts[0])
            if best[1]:
                rst = os.stat(best[1])
                dev = f"{os.major(rst.st_rdev)}:{os.minor(rst.st_rdev)}"
            else:
                dev = "*"
    except OSError:
        dev = ""
    _dev_cache[path] = dev
    return dev


_PHYS_DISK_RE = re.compile(r"^(nvme\d+n\d+|sd[a-z]+)$")


def _disk_read_bytes(dev: str):
    if not dev:
        return None
    try:
        with open("/proc/diskstats") as fh:
            if dev == "*":
                return sum(int(f[5]) * 512 for f in (ln.split() for ln in fh)
                           if len(f) > 5 and _PHYS_DISK_RE.match(f[2]))
            maj, minor = dev.split(":")
            for ln in fh:
                f = ln.split()
                if f[0] == maj and f[1] == minor:
                    return int(f[5]) * 512  # sectors read
    except (OSError, ValueError, IndexError):
        pass
    return None


def _pids_cpu_ticks(pids: list) -> float:
    total = 0.0
    for pid in pids:
        try:
            with open(f"/proc/{pid}/stat") as fh:
                parts = fh.read().rsplit(")", 1)[1].split()
            total += float(parts[11]) + float(parts[12])  # utime + stime
        except (OSError, IndexError, ValueError):
            continue
    return total


def _pids_rss_mib(pids: list) -> float:
    total = 0
    page = os.sysconf("SC_PAGE_SIZE")
    for pid in pids:
        try:
            with open(f"/proc/{pid}/statm") as fh:
                total += int(fh.read().split()[1]) * page
        except (OSError, IndexError, ValueError):
            continue
    return total / 2**20


_LOAD_STAGES = ["init", "weights", "warmup", "api"]
_load_track: dict[str, dict[str, Any]] = {}


def _loading_telemetry(eid: str, pids: list, on_gpu: bool, vram_mib: float, path: str, weights_gb) -> dict:
    now = time.time()
    cpu_ticks = _pids_cpu_ticks(pids)
    dev = _dev_for_path(path) if path else ""
    disk_bytes = _disk_read_bytes(dev)
    tel: dict[str, Any] = {
        "stages": _LOAD_STAGES,
        "cpu_pct": None, "disk_read_mbps": None, "vram_rate_mibps": None,
        "rss_mib": round(_pids_rss_mib(pids), 1),
        "eta_s": None, "pct": None,
    }
    prev = _load_track.get(eid)
    if prev and now - prev["ts"] > 0.2:
        dt = now - prev["ts"]
        tel["cpu_pct"] = round(max(0.0, (cpu_ticks - prev["cpu"]) / os.sysconf("SC_CLK_TCK") / dt * 100.0), 1)
        if disk_bytes is not None and prev.get("disk") is not None:
            tel["disk_read_mbps"] = round(max(0.0, (disk_bytes - prev["disk"]) / dt / 1e6), 1)
        tel["vram_rate_mibps"] = round(max(0.0, (vram_mib - prev["vram"]) / dt), 1)
    _load_track[eid] = {"ts": now, "cpu": cpu_ticks, "disk": disk_bytes, "vram": vram_mib}
    if len(_load_track) > 64:
        for k in [k for k, v in _load_track.items() if now - v["ts"] > 600]:
            _load_track.pop(k, None)
    target_mib = weights_gb * 1e9 / 2**20 if weights_gb else None
    if not on_gpu:
        tel["stage"] = "init"
        tel["stage_idx"] = 0
        tel["detail"] = "spawning workers · staging weights"
    elif target_mib and vram_mib < target_mib * 0.92:
        tel["stage"] = "weights"
        tel["stage_idx"] = 1
        tel["pct"] = round(min(100.0, vram_mib / target_mib * 100.0), 1)
        tel["detail"] = f"{vram_mib / 953.7:.0f} / {weights_gb:.0f} GB into VRAM"
        rate = tel["vram_rate_mibps"]
        if rate and rate > 1:
            tel["eta_s"] = round((target_mib - vram_mib) / rate, 1)
    else:
        tel["stage"] = "warmup"
        tel["stage_idx"] = 2
        tel["pct"] = 100.0 if target_mib else None
        tel["detail"] = "kv cache · cuda graphs · api warmup"
    tel["vram_target_mib"] = round(target_mib, 1) if target_mib else None
    return tel


def sniff_models(gpus: list, models: list) -> list:
    """Detect every model on (or headed for) the GPUs, regardless of stack:
    weight files held by GPU procs, plus serving processes still in their
    weight-loading phase, plus root/container servers via cmdline evidence."""
    claimed_pids: set[int] = set()
    known_ports = {m.get("port") for m in models}
    healthy_ports = {m.get("port") for m in models if m.get("healthy")}
    for m in models:
        if m.get("healthy"):
            claimed_pids.update(m.get("worker_pids") or [])
    scan_by_pid = {sp["pid"]: sp for sp in _scan_serving_procs()}
    groups: dict[str, dict] = {}
    seen_pairs: dict[str, set] = {}
    all_pids: set[int] = set()
    for g in gpus:
        for p in g.get("processes") or []:
            pid = p["pid"]
            all_pids.add(pid)
            anc = _ancestor_cmdlines(pid)
            files = set(_pid_weight_files(pid)) | _cmdline_model_paths(anc)
            if not files:
                # unreadable /proc internals (root / container) — fall back to
                # cmdline evidence: this pid's own scan entry, or a scanned
                # server found in its ancestor chain (TP/spawned workers)
                sp = scan_by_pid.get(pid) or next(
                    (x for x in scan_by_pid.values()
                     if (x.get("name") and x["name"] in anc) or (x.get("mpath") and x["mpath"] in anc)),
                    None)
                if sp:
                    path = _resolve_serving_path(sp)
                    if path:
                        files = {path}
                        scan_by_pid.setdefault(pid, sp)
            if not files:
                continue
            for f in files:
                key, name = _model_key_name(f)
                if pid in scan_by_pid and scan_by_pid[pid].get("name"):
                    name = scan_by_pid[pid]["name"] if not os.path.isdir(f) else name
                grp = groups.setdefault(key, {
                    "key": key, "name": name, "path": key, "app": "",
                    "files": set(), "pids": set(), "gpu_indices": set(),
                    "vram_mib": 0.0, "claimed": False,
                })
                grp["files"].add(f)
                grp["pids"].add(pid)
                grp["gpu_indices"].add(g["index"])
                pair = (g["index"], pid)
                pairs = seen_pairs.setdefault(key, set())
                if pair not in pairs:
                    pairs.add(pair)
                    grp["vram_mib"] += p["used_memory_mib"]
                if not grp["app"]:
                    grp["app"] = (scan_by_pid.get(pid) or {}).get("engine") or _detect_app(anc)
                if pid in claimed_pids:
                    grp["claimed"] = True
    ports_by_pid = _listen_ports(all_pids)
    out = []
    for grp in groups.values():
        raw_ports = {pt for pid in grp["pids"] for pt in ports_by_pid.get(pid, [])} \
                  | {scan_by_pid[pid]["port"] for pid in grp["pids"]
                     if pid in scan_by_pid and scan_by_pid[pid].get("port")}
        if grp["claimed"] or (raw_ports & healthy_ports):
            continue  # already shown as a (configured or dynamic) endpoint card
        path = grp["path"]
        disk = disk_intel(path) if os.path.isdir(path) else {}
        kb = kb_lookup(grp["name"] + " " + os.path.basename(path))
        ports = sorted({pt for pid in grp["pids"] for pt in ports_by_pid.get(pid, []) if pt not in known_ports})
        for pid in grp["pids"]:
            sp = scan_by_pid.get(pid)
            if sp and sp.get("port") and sp["port"] not in known_ports:
                ports.append(sp["port"])
        ports = sorted(set(ports))
        served = []
        for pt in ports[:3]:
            served += _probe_port_models(pt)
        disk_gb = disk.get("weights_gb") or (round(sum(_fsize(f) for f in grp["files"] if os.path.isfile(f)) / 1e9, 1) or None)
        starts = [t for t in (_pid_started(p) for p in grp["pids"]) if t]
        out.append({
            "id": "sniff-" + hashlib.md5(grp["key"].encode()).hexdigest()[:10],
            "name": grp["name"],
            "path": path,
            "app": grp["app"],
            "state": "memory",
            "files": sorted(grp["files"])[:24],
            "n_files": len([f for f in grp["files"] if os.path.isfile(f)]),
            "pids": sorted(grp["pids"])[:16],
            "gpu_indices": sorted(grp["gpu_indices"]),
            "vram_mib": round(grp["vram_mib"], 1),
            "disk_gb": disk_gb,
            "ports": ports[:4],
            "served_names": served[:4],
            "uptime_s": (time.time() - min(starts)) if starts else None,
            "intel": _intel_lite(kb, disk),
        })
    # serving processes with no GPU presence yet = weight-loading phase.
    # Require actual model evidence (name / path) so idle daemons like a bare
    # `ollama serve` don't render as phantom loads; merge duplicate pids of the
    # same model+port (e.g. a container shim and the server inside it).
    loading: dict[tuple, dict] = {}
    for sp in scan_by_pid.values():
        if sp["pid"] in all_pids:
            continue
        if sp.get("port") and sp["port"] in healthy_ports:
            continue
        path = _resolve_serving_path(sp)
        if path and path in groups:
            continue  # its workers are already visible as an in-memory group
        name = sp.get("name") or (os.path.basename((sp.get("mpath") or "").rstrip("/"))) \
            or (os.path.basename(path.rstrip("/")) if path else "")
        if not name:
            continue  # no model evidence — an idle serving daemon, not a load
        lkey = (path or name.lower(), sp.get("port"))
        ent = loading.get(lkey)
        if ent:
            ent["pids"].append(sp["pid"])
            continue
        disk = disk_intel(path) if path else {}
        kb = kb_lookup(f"{name} {os.path.basename(path)}")
        started = _pid_started(sp["pid"])
        loading[lkey] = {
            "id": "sniff-load-" + hashlib.md5(f"{lkey}".encode()).hexdigest()[:10],
            "name": name,
            "path": path,
            "app": sp.get("engine", ""),
            "state": "loading",
            "files": [],
            "n_files": 0,
            "pids": [sp["pid"]],
            "gpu_indices": [],
            "vram_mib": None,
            "disk_gb": disk.get("weights_gb"),
            "ports": [sp["port"]] if sp.get("port") else [],
            "served_names": [],
            "uptime_s": (time.time() - started) if started else None,
            "intel": _intel_lite(kb, disk),
        }
    out.extend(loading.values())
    # attach realtime load telemetry: explicit loading entries, plus on-GPU
    # groups that expose an API port which isn't serving yet (still warming up)
    for e in out:
        api_pending = bool(e.get("ports")) and not e.get("served_names")
        if e["state"] == "loading" or api_pending:
            e["state"] = "loading"
            e["loading"] = _loading_telemetry(
                e["id"], e.get("pids") or [], bool(e.get("gpu_indices")),
                float(e.get("vram_mib") or 0.0), e.get("path") or "", e.get("disk_gb"))
    # one process = one boot: a loader that touches many weight files would
    # otherwise appear as a card per file group (seen with export/quant jobs)
    seen_pids: set = set()
    dedup = []
    for e in out:
        key = tuple(sorted(e.get("pids") or []))
        if e.get("state") == "loading" and key and key in seen_pids:
            continue
        if e.get("state") == "loading" and key:
            seen_pids.add(key)
        dedup.append(e)
    out = dedup
    bootlog.enrich(out)
    # boots first (they are the live story), then by resident VRAM
    out.sort(key=lambda x: (x.get("state") != "loading", -(x["vram_mib"] or 0)))
    out = out[:10]
    demo = bootlog.demo_entry()
    if demo:
        bootlog.enrich([demo])
        out.insert(0, demo)
    if MASK_NAMES:
        for e in out:
            it = e.get("intel") or {}
            e["name"] = it.get("display_name") or it.get("family") or "model"
            e["path"] = ""
            e["served_names"] = [e["name"]] if e.get("served_names") else []
    return out


# Dynamic endpoints: any sniffed port that speaks OpenAI /v1/models gets scraped
# like a configured endpoint (TPS, kv-cache, queue) with zero configuration.
_DYN_ACCENTS = [("#4de6a8", "#57c8ff"), ("#ff8c2e", "#ffc96b"), ("#8b7cff", "#45d1ff"), ("#fcee0a", "#ff8c2e")]


def update_dynamic_endpoints(sniffed: list) -> None:
    now = time.time()
    static_ports = set()
    for c in LLM_ENDPOINTS:
        try:
            static_ports.add(int(c["endpoint"].rstrip("/").rsplit(":", 1)[1]))
        except Exception:
            pass
    cand: set[int] = set()
    for s in sniffed:
        cand.update(s.get("ports") or [])
    for pt in cand:
        if pt in static_ports:
            continue
        names = _probe_port_models(pt)
        if not names:
            continue
        cfg = STATE.dynamic_endpoints.get(pt)
        if cfg is None:
            acc = _DYN_ACCENTS[pt % len(_DYN_ACCENTS)]
            STATE.dynamic_endpoints[pt] = {
                "id": f"auto-{pt}", "endpoint": f"http://127.0.0.1:{pt}",
                "label": f"{names[0]} · auto", "gpu_indices": [],
                "accent": acc[0], "accent2": acc[1], "_dyn_ok": now,
            }
        else:
            cfg["_dyn_ok"] = now
    for m in STATE.models_cache:
        if str(m.get("id", "")).startswith("auto-") and m.get("healthy"):
            cfg = STATE.dynamic_endpoints.get(m.get("port"))
            if cfg:
                cfg["_dyn_ok"] = now
    for pt in list(STATE.dynamic_endpoints):
        if now - STATE.dynamic_endpoints[pt].get("_dyn_ok", 0) > 900:
            del STATE.dynamic_endpoints[pt]


# ---------- Polling state ----------

class State:
    def __init__(self):
        self.snapshot: dict[str, Any] = {"generated_at": utc_iso(), "gpus": [], "models": [], "history": {}}
        self.history: dict[int, dict[str, deque]] = {}
        self.global_hist: dict[str, deque] = {
            "total_tps": deque(maxlen=HISTORY_POINTS),
            "gpu_util_avg": deque(maxlen=HISTORY_POINTS),
            "mem_pct_avg": deque(maxlen=HISTORY_POINTS),
            "power_total": deque(maxlen=HISTORY_POINTS),
        }
        self.prev_counters: dict[str, dict[str, float]] = {}  # endpoint -> {prompt_total, gen_total, ts}
        self.subscribers: set[asyncio.Queue] = set()
        # Cache of the last LLM-endpoint scrape (refreshed on the slower
        # LLM_POLL_SECONDS cadence by its own background task). The fast GPU
        # poll reads this instead of doing blocking HTTP every tick.
        self.models_cache: list[dict[str, Any]] = []
        # Universal model sniffer output (refreshed by llm_poller off the fast path).
        self.sniffed_cache: list[dict[str, Any]] = []
        # Auto-discovered OpenAI-compatible endpoints (port -> endpoint cfg),
        # registered by the sniffer and scraped alongside LLM_ENDPOINTS.
        self.dynamic_endpoints: dict[int, dict[str, Any]] = {}
        # Revisions let the stream send model changes and one-point history
        # appends instead of repeating every 180-point series four times/second.
        self.last_history_ts: float = 0.0
        self.models_revision = 0
        self.history_revision = 0
        self.stream_models_revision = -1
        self.stream_history_revision = -1
        self.stream_snapshot: dict[str, Any] = {}

    def gpu_hist(self, idx: int) -> dict[str, deque]:
        h = self.history.get(idx)
        if h is None:
            h = {
                "util": deque(maxlen=HISTORY_POINTS),
                "mem": deque(maxlen=HISTORY_POINTS),
                "power": deque(maxlen=HISTORY_POINTS),
                "temp": deque(maxlen=HISTORY_POINTS),
                "pcie": deque(maxlen=HISTORY_POINTS),
            }
            self.history[idx] = h
        return h


STATE = State()


def scrape_endpoint(cfg: dict[str, Any], now: float) -> dict[str, Any]:
    try:
        ep_port = int(cfg["endpoint"].rstrip("/").rsplit(":", 1)[1])
    except Exception:
        ep_port = 0
    out = {
        "id": cfg["id"],
        "endpoint": cfg["endpoint"],
        "label": cfg["label"],
        "port": ep_port,
        "gpu_indices": list(cfg.get("gpu_indices") or []),
        "cfg_gpu_indices": list(cfg.get("gpu_indices") or []),
        "accent": cfg["accent"],
        "accent2": cfg["accent2"],
        "healthy": False,
        "error": "",
        "model_names": [],
        "max_model_len": None,
        "running": 0,
        "waiting": 0,
        "kv_cache_pct": 0.0,
        "prompt_tokens_total": 0,
        "generation_tokens_total": 0,
        "requests_total": 0,
        "input_tps": 0.0,
        "output_tps": 0.0,
        "total_tps": 0.0,
        "ttft_ms": None,
        "inter_token_ms": None,
        "request_rate": 0.0,
        "model_meta": [],
        "engine": "",
        "engine_version": "",
        "srv_model_path": "",
        "srv_ctx": None,
    }
    api_prefix = ""
    code, body = http_get(cfg["endpoint"].rstrip("/") + "/v1/models")
    if code == 200:
        try:
            j = json.loads(body)
            data = j.get("data", [])
            out["model_names"] = [m.get("id", "") for m in data]
            out["model_meta"] = [
                {
                    "id": d.get("id", ""),
                    "root": d.get("root") or "",
                    "max_model_len": d.get("max_model_len"),
                    "created": d.get("created"),
                    "flare": isinstance(d.get("flare"), dict),
                }
                for d in data
            ]
            if any(meta["flare"] for meta in out["model_meta"]):
                api_prefix = "flare"
            if out["model_names"]:
                out["healthy"] = True
                if str(cfg.get("id") or "").startswith("auto-"):
                    out["label"] = f"{out['model_names'][0]} · auto"
                    cfg["label"] = out["label"]
        except Exception:
            pass
    else:
        out["error"] = body
    model_signature = json.dumps(out["model_meta"], sort_keys=True, separators=(",", ":"))
    prefix = api_prefix
    code2, body2 = http_get(cfg["endpoint"].rstrip("/") + "/metrics")
    if code2 == 200:
        out["healthy"] = True
        samples = parse_prom(body2)
        metric_prefix = (
            "flare" if any(s["name"].startswith("flare_") for s in samples)
            else "vllm" if any(s["name"].startswith("vllm:") for s in samples)
            else "sglang" if any(s["name"].startswith("sglang:") for s in samples)
            else ""
        )
        if not prefix:
            prefix = metric_prefix
        prompt_total = 0.0
        gen_total = 0.0
        req_total = 0.0
        running = 0.0
        waiting = 0.0
        kv = 0.0
        flare_total_kv_pages = 0.0
        flare_free_kv_pages = 0.0
        # SGLang live telemetry: realtime token counters increment per forward
        # batch (unlike *_tokens_total, which only bump at request completion),
        # and latency histograms yield windowed TTFT / inter-token averages.
        rt_in: float | None = None
        rt_out: float | None = None
        ttft_sum = 0.0
        ttft_cnt = 0.0
        itl_sum = 0.0
        itl_cnt = 0.0
        ttft_b: dict[float, float] = {}
        itl_b: dict[float, float] = {}
        pc_q = 0.0
        pc_h = 0.0
        preempt = 0.0
        for s in samples:
            n = s["name"]
            v = s["value"]
            if n.endswith("_bucket") and (n.startswith("vllm:time_to_first_token_seconds") or n.startswith("vllm:time_per_output_token_seconds") or n.startswith("vllm:inter_token_latency_seconds")):
                le = s["labels"].get("le", "")
                try:
                    lef = float("inf") if le == "+Inf" else float(le)
                except ValueError:
                    continue
                tgt = ttft_b if "first_token" in n else itl_b
                tgt[lef] = tgt.get(lef, 0.0) + v
                continue
            if n in ("vllm:time_to_first_token_seconds_sum",):
                ttft_sum += v
            elif n in ("vllm:time_to_first_token_seconds_count",):
                ttft_cnt += v
            elif n in ("vllm:time_per_output_token_seconds_sum", "vllm:inter_token_latency_seconds_sum"):
                itl_sum += v
            elif n in ("vllm:time_per_output_token_seconds_count", "vllm:inter_token_latency_seconds_count"):
                itl_cnt += v
            elif n in ("vllm:prefix_cache_queries_total", "vllm:gpu_prefix_cache_queries_total", "vllm:gpu_prefix_cache_queries"):
                pc_q += v
            elif n in ("vllm:prefix_cache_hits_total", "vllm:gpu_prefix_cache_hits_total", "vllm:gpu_prefix_cache_hits"):
                pc_h += v
            elif n in ("vllm:num_preemptions_total",):
                preempt += v
            # Token, queue and request counters across supported engines.
            if n in ("vllm:prompt_tokens_total", "sglang:prompt_tokens_total",
                     "flare_prefill_tokens_total"):
                prompt_total += v
            elif n in ("vllm:generation_tokens_total", "sglang:generation_tokens_total",
                       "flare_generated_tokens_total"):
                gen_total += v
            elif n in ("vllm:num_requests_running", "sglang:num_running_reqs",
                       "flare_active_requests"):
                running = max(running, v)
            elif n in ("vllm:num_requests_waiting", "sglang:num_queue_reqs",
                       "flare_pending_requests"):
                waiting = max(waiting, v)
            elif n in ("vllm:gpu_cache_usage_perc", "vllm:kv_cache_usage_perc", "sglang:token_usage"):
                kv = max(kv, v * (100.0 if v <= 1.0 else 1.0))
            elif n in ("vllm:request_success_total", "flare_requests_completed_total"):
                req_total += v
            elif n == "flare_total_kv_pages":
                flare_total_kv_pages = max(flare_total_kv_pages, v)
            elif n == "flare_free_kv_pages":
                flare_free_kv_pages = max(flare_free_kv_pages, v)
            elif n == "sglang:realtime_tokens_total":
                # max across rank samples: only rank 0 reports unless
                # --enable-metrics-for-all-schedulers duplicates the counters.
                mode = s["labels"].get("mode", "")
                if mode == "decode":
                    rt_out = v if rt_out is None else max(rt_out, v)
                elif mode == "prefill_compute":
                    rt_in = v if rt_in is None else max(rt_in, v)
            elif n == "sglang:time_to_first_token_seconds_sum":
                ttft_sum += v
            elif n == "sglang:time_to_first_token_seconds_count":
                ttft_cnt += v
            elif n == "sglang:inter_token_latency_seconds_sum":
                itl_sum += v
            elif n == "sglang:inter_token_latency_seconds_count":
                itl_cnt += v
        if flare_total_kv_pages > 0:
            used_pages = max(0.0, min(flare_total_kv_pages,
                                      flare_total_kv_pages - flare_free_kv_pages))
            kv = used_pages / flare_total_kv_pages * 100.0
        out["prompt_tokens_total"] = int(prompt_total)
        out["generation_tokens_total"] = int(gen_total)
        accumulate_served(str(cfg.get("endpoint") or ""), prompt_total, gen_total)
        out["requests_total"] = int(req_total)
        out["running"] = int(running)
        out["waiting"] = int(waiting)
        out["kv_cache_pct"] = float(kv)
        # Delta telemetry is valid only within one exact served-model identity.
        prev = STATE.prev_counters.get(cfg["id"])
        if prev and prev.get("model_signature") == model_signature:
            dt = max(now - prev["ts"], 1e-3)
            d_in = max(prompt_total - prev["prompt"], 0.0)
            d_out = max(gen_total - prev["gen"], 0.0)
            # counters appearing for the first time (endpoint just became healthy, or a
            # restarted server replaying its lifetime totals) are not throughput
            if prev["prompt"] + prev["gen"] == 0 and d_in + d_out > 5000:
                d_in = d_out = 0.0
            out["input_tps"] = d_in / dt
            out["output_tps"] = d_out / dt
            out["request_rate"] = max(req_total - prev.get("req", 0.0), 0.0) / dt
            out["total_tps"] = out["input_tps"] + out["output_tps"]
            if rt_out is not None:
                out["input_tps"] = max((rt_in or 0.0) - prev.get("rt_in", 0.0), 0.0) / dt
                out["output_tps"] = max(rt_out - prev.get("rt_out", 0.0), 0.0) / dt
                out["total_tps"] = out["input_tps"] + out["output_tps"]
            d_ttft_cnt = ttft_cnt - prev.get("ttft_cnt", 0.0)
            if d_ttft_cnt > 0:
                out["ttft_ms"] = (ttft_sum - prev.get("ttft_sum", 0.0)) / d_ttft_cnt * 1000.0
            elif prev.get("ttft_ms") is not None:
                out["ttft_ms"] = prev["ttft_ms"]
            d_itl_cnt = itl_cnt - prev.get("itl_cnt", 0.0)
            if d_itl_cnt > 0:
                out["inter_token_ms"] = (itl_sum - prev.get("itl_sum", 0.0)) / d_itl_cnt * 1000.0
            elif prev.get("inter_token_ms") is not None:
                out["inter_token_ms"] = prev["inter_token_ms"]
            # windowed percentiles from histogram bucket deltas (linear interpolation within bucket)
            def _pct(cur: dict, before: dict, q: float):
                if not cur:
                    return None
                edges = sorted(cur)
                deltas = [max(0.0, cur[e] - before.get(e, 0.0)) for e in edges]
                total = deltas[-1] if deltas else 0.0
                if total <= 0:
                    return None
                target = total * q
                lo_edge, lo_cum = 0.0, 0.0
                for e, cum in zip(edges, deltas):
                    if cum >= target:
                        if e == float("inf"):
                            return lo_edge * 1000.0
                        frac = (target - lo_cum) / max(cum - lo_cum, 1e-9)
                        return (lo_edge + (e - lo_edge) * frac) * 1000.0
                    lo_edge, lo_cum = e, cum
                return None
            pb = prev.get("ttft_b", {})
            for q, key in ((0.5, "ttft_p50_ms"), (0.95, "ttft_p95_ms")):
                val = _pct(ttft_b, pb, q)
                out[key] = val if val is not None else prev.get(key)
            pb = prev.get("itl_b", {})
            for q, key in ((0.5, "itl_p50_ms"), (0.95, "itl_p95_ms")):
                val = _pct(itl_b, pb, q)
                out[key] = val if val is not None else prev.get(key)
            d_q = pc_q - prev.get("pc_q", 0.0)
            if d_q > 0:
                out["prefix_hit_pct"] = max(0.0, pc_h - prev.get("pc_h", 0.0)) / d_q * 100.0
            elif prev.get("prefix_hit_pct") is not None:
                out["prefix_hit_pct"] = prev["prefix_hit_pct"]
            out["preemptions_delta"] = max(0.0, preempt - prev.get("preempt", 0.0))
        STATE.prev_counters[cfg["id"]] = {
            "prompt": prompt_total, "gen": gen_total, "req": req_total, "ts": now,
            "model_signature": model_signature,
            "ttft_b": ttft_b, "itl_b": itl_b, "pc_q": pc_q, "pc_h": pc_h, "preempt": preempt,
            "ttft_p50_ms": out.get("ttft_p50_ms"), "ttft_p95_ms": out.get("ttft_p95_ms"),
            "itl_p50_ms": out.get("itl_p50_ms"), "itl_p95_ms": out.get("itl_p95_ms"),
            "prefix_hit_pct": out.get("prefix_hit_pct"), "preemptions_total": preempt,
            "rt_in": rt_in or 0.0, "rt_out": rt_out or 0.0,
            "ttft_sum": ttft_sum, "ttft_cnt": ttft_cnt,
            "itl_sum": itl_sum, "itl_cnt": itl_cnt,
            "ttft_ms": out["ttft_ms"], "inter_token_ms": out["inter_token_ms"],
        }
    elif not out["healthy"]:
        if not out["error"]:
            out["error"] = body2
    if out["healthy"]:
        extras = probe_engine(cfg, prefix, model_signature)
        lbl = (cfg.get("label") or "").lower()
        out["engine"] = extras["engine"] or (
            "Flare" if "flare" in lbl else "vLLM" if "vllm" in lbl
            else "SGLang" if "sglang" in lbl else ""
        )
        out["engine_version"] = extras["engine_version"]
        out["srv_model_path"] = extras["srv_model_path"]
        out["srv_ctx"] = extras["srv_ctx"]
    return out


def _collect_gpus_smi() -> list[dict[str, Any]]:
    # Fallback for hosts without a usable NVML Python binding.
    with ThreadPoolExecutor(max_workers=2) as ex:
        fut_rows = ex.submit(run_smi, GPU_QUERY, "gpu")
        fut_procs = ex.submit(run_smi, PROC_QUERY, "proc")
        rows = fut_rows.result()
        procs = fut_procs.result()
    by_uuid: dict[str, list[dict[str, Any]]] = {}
    for r in procs:
        if len(r) < 4:
            continue
        uuid, pid, name, mem = r[0], r[1], r[2], r[3]
        by_uuid.setdefault(uuid, []).append({
            "pid": int(f(pid)),
            "process_name": name,
            "used_memory_mib": f(mem),
        })
    gpus = []
    for r in rows:
        if len(r) < 13:
            continue
        idx = int(f(r[0]))
        uuid = r[2]
        mem_used = f(r[5])
        mem_total = f(r[6]) or 1.0
        power_draw = f(r[8])
        power_limit = f(r[9]) or 1.0
        gpus.append({
            "index": idx,
            "name": r[1].replace("NVIDIA ", ""),
            "uuid": uuid,
            "utilization_gpu_pct": f(r[3]),
            "utilization_memory_pct": f(r[4]),
            "memory_used_mib": mem_used,
            "memory_total_mib": mem_total,
            "memory_pct": (mem_used / mem_total) * 100.0,
            "temperature_c": f(r[7]),
            "power_draw_w": power_draw,
            "power_limit_w": power_limit,
            "power_pct": (power_draw / power_limit) * 100.0,
            "fan_pct": f(r[10]),
            "graphics_clock_mhz": f(r[11]),
            "memory_clock_mhz": f(r[12]),
            "pstate": r[14] if len(r) > 14 else "",
            "pcie_gen": int(f(r[15])) if len(r) > 15 else 0,
            "pcie_gen_max": int(f(r[16])) if len(r) > 16 else 0,
            "pcie_width": int(f(r[17])) if len(r) > 17 else 0,
            "pcie_width_max": int(f(r[18])) if len(r) > 18 else 0,
            "pcie_aer": read_pcie_aer(r[19] if len(r) > 19 else ""),
            "processes": sorted(by_uuid.get(uuid, []), key=lambda p: -p["used_memory_mib"])[:10],
        })
    gpus.sort(key=lambda g: g["index"])
    return gpus


def collect_gpus() -> list[dict[str, Any]]:
    nvml = _load_nvml()
    if nvml is not None and _NVML_POOL is not None:
        try:
            futures = [
                _NVML_POOL.submit(_nvml_device, nvml, index, handle)
                for index, handle in enumerate(_NVML_HANDLES)
            ]
            gpus = [future.result() for future in futures]
            if gpus:
                gpus.sort(key=lambda g: g["index"])
                return gpus
        except Exception:
            _drop_nvml()
    return _collect_gpus_smi()


# ---------- GPU ↔ endpoint attribution ----------

_anc_cache: dict[int, tuple[float, str]] = {}


def _ancestor_cmdlines(pid: int, max_depth: int = 12) -> str:
    """Joined cmdlines of pid and its ancestors (world-readable even for root procs)."""
    now = time.time()
    hit = _anc_cache.get(pid)
    if hit and now - hit[0] < 60:
        return hit[1]
    parts: list[str] = []
    cur = pid
    for _ in range(max_depth):
        if cur <= 1:
            break
        try:
            with open(f"/proc/{cur}/cmdline", "rb") as fh:
                parts.append(fh.read().replace(b"\0", b" ").decode("utf-8", "replace"))
        except Exception:
            pass
        try:
            with open(f"/proc/{cur}/stat") as fh:
                cur = int(fh.read().rsplit(")", 1)[1].split()[1])
        except Exception:
            break
    text = "\n".join(parts)
    _anc_cache[pid] = (now, text)
    return text


def resolve_model_gpus(models: list[dict[str, Any]], gpus: list[dict[str, Any]]) -> None:
    """Set m['gpu_indices'] / m['worker_pids'] / m['vram_mib'] from the GPUs and
    compute processes actually running each endpoint's workers.

    nvidia-smi gives us each GPU's compute PIDs; the serving stack's launch args
    (--port / --served-model-name) live on an ancestor of those workers. Match
    order per endpoint: port in ancestor cmdline → served model name → engine
    keyword on the worker (only when that engine has a single healthy endpoint)
    → static config fallback. VRAM is the sum over matched (gpu, pid) entries,
    so a TP master with contexts on all cards is counted once per card.
    """
    gpu_procs = {
        g["index"]: [(p["pid"], p["process_name"] or "", p["used_memory_mib"], _ancestor_cmdlines(p["pid"]))
                     for p in g["processes"]]
        for g in gpus
    }

    def collect(pred) -> list[tuple[int, int, float]]:
        return [(i, pid, mem) for i, procs in gpu_procs.items()
                for pid, nm, mem, anc in procs if pred(nm, anc)]

    for m in models:
        matched: list[tuple[int, int, float]] = []
        if m.get("healthy"):
            port = m.get("port") or 0
            port_re = re.compile(rf"(?:--port[= ]\s*|:){port}(?!\d)") if port else None
            names = [n for n in (m.get("model_names") or []) if len(n) >= 3]
            if port_re:
                matched = collect(lambda nm, anc: port_re.search(anc))
            if not matched and names:
                matched = collect(lambda nm, anc: any(n in anc for n in names))
            if not matched:
                engine_text = f"{m.get('engine') or ''} {m.get('label') or ''}".lower()
                kw = next((k for k in ("vllm", "sglang", "flare") if k in engine_text), None)
                rivals = [
                    x for x in models
                    if x is not m and x.get("healthy") and kw
                    and kw in f"{x.get('engine') or ''} {x.get('label') or ''}".lower()
                ]
                if kw and not rivals:
                    matched = collect(lambda nm, anc: kw in nm.lower() or kw in anc.lower())
        idxs = sorted({i for i, _, _ in matched})
        m["gpu_indices"] = idxs if idxs else list(m.get("cfg_gpu_indices") or [])
        m["worker_pids"] = sorted({pid for _, pid, _ in matched})
        m["vram_mib"] = sum(mem for _, _, mem in matched) or None


# ---------- Official API list price (reference economics) ----------
# DeepSeek V4.1 Flash, published list price per 1M tokens, peak / off-peak.
# Source: api-docs.deepseek.com/quick_start/pricing (checked 2026-11-05).
OFFICIAL_PRICING = {
    "model": "deepseek-v4.1-flash",
    "in_usd_mtok": float(os.environ.get("NVTOP_API_IN_PRICE", "0.30")),
    "out_usd_mtok": float(os.environ.get("NVTOP_API_OUT_PRICE", "1.20")),
    "offpeak_in_usd_mtok": 0.15,
    "offpeak_out_usd_mtok": 0.60,
    "unit": "USD per 1M tokens",
    "note": "peak list price, cache-miss inputs; off-peak halves",
    "source": "api-docs.deepseek.com/quick_start/pricing",
    "checked": "2026-11-05",
}

SERVED_LEDGER_FILE = APP_ROOT / "served_ledger.json"
_served_ledger: dict[str, Any] = {}


def _load_served_ledger() -> dict[str, Any]:
    global _served_ledger
    if _served_ledger:
        return _served_ledger
    try:
        _served_ledger = json.loads(SERVED_LEDGER_FILE.read_text())
    except Exception:
        _served_ledger = {}
    _served_ledger.setdefault("since", time.time())
    _served_ledger.setdefault("in", 0)
    _served_ledger.setdefault("out", 0)
    _served_ledger.setdefault("endpoints", {})
    _served_ledger.setdefault("saved", 0.0)
    return _served_ledger


def accumulate_served(endpoint: str, prompt_total: float, gen_total: float) -> None:
    """Fold per-endpoint Prometheus counters into a volume that survives reloads.

    Counters reset whenever an engine reloads weights, so a drop re-bases to the
    new value instead of subtracting: the ledger only ever grows."""
    led = _load_served_ledger()
    ent = led["endpoints"].setdefault(endpoint, {"in": 0.0, "out": 0.0, "last_in": 0.0, "last_out": 0.0})
    for key, last_key, val in (("in", "last_in", prompt_total), ("out", "last_out", gen_total)):
        d = val - float(ent.get(last_key) or 0.0)
        if d < 0:            # engine reloaded: the partial new counter is the delta
            d = val
        if d > 0:
            led[key] += d
            ent[key] = float(ent.get(key) or 0.0) + d
        ent[last_key] = val


def _flush_served_ledger(now: float) -> None:
    led = _served_ledger
    if not led or now - float(led.get("saved") or 0.0) < 30:
        return
    led["saved"] = now
    try:
        SERVED_LEDGER_FILE.write_text(json.dumps(led))
    except Exception:
        pass


def served_alltime() -> dict[str, Any]:
    led = _load_served_ledger()
    total = float(led.get("in") or 0.0) + float(led.get("out") or 0.0)
    return {"in": float(led.get("in") or 0.0), "out": float(led.get("out") or 0.0),
            "total": total, "since": datetime.fromtimestamp(float(led.get("since") or time.time()), timezone.utc).isoformat()}


ENERGY_FILE = APP_ROOT / "energy_day.json"
ENERGY_MONTH_FILE = APP_ROOT / "energy_month.json"
TARIFF_FILE = APP_ROOT / "energy_tariff.json"
_energy_day: dict[str, Any] = {}
_energy_month: dict[str, Any] = {}
_eff_window: deque = deque(maxlen=120)   # (ts, tokens_total, energy_j)


def _load_tariff() -> dict[str, Any]:
    """Electricity price for this site, editable without touching the app.

    Single-rate household tariff with monthly volume bands (≤3900 / ≤6000 /
    above kWh). Env override `NVTOP_ELECTRICITY_RATES` wins: three comma- or
    semicolon-separated ₽/kWh values, low→high band."""
    tariff: dict[str, Any] = {
        "place": "Подмосковье · сельская местность",
        "category": "сельское население",
        "period": "2026 · II полугодие",
        "currency": "RUB",
        "symbol": "₽",
        "band_limits_kwh": [3900.0, 6000.0],
        "rates_rub_kwh": [7.46, 8.04, 10.86],
        "night_rate_rub_kwh": 4.12,
        "usd_rub": 82.92,
        "fx_date": "2026-11-04 CBR",
        "tz": "Europe/Moscow",
    }
    try:
        loaded = json.loads(TARIFF_FILE.read_text())
        if isinstance(loaded, dict):
            tariff.update({k: v for k, v in loaded.items() if not k.startswith("_")})
    except Exception:
        pass
    raw = os.environ.get("NVTOP_ELECTRICITY_RATES", "")
    vals = [v for v in re.split(r"[;, ]+", raw.strip()) if v]
    if len(vals) == 3:
        try:
            tariff["rates_rub_kwh"] = [float(v) for v in vals]
        except ValueError:
            pass
    rates = tariff.get("rates_rub_kwh") or [0.0, 0.0, 0.0]
    if len(rates) < 3:
        rates = list(rates) + [rates[-1] if rates else 0.0] * (3 - len(rates))
    tariff["rates_rub_kwh"] = [float(r) for r in rates[:3]]
    lim = tariff.get("band_limits_kwh") or [3900.0, 6000.0]
    tariff["band_limits_kwh"] = [float(x) for x in lim][:2] or [3900.0, 6000.0]
    return tariff


TARIFF = _load_tariff()


def _tariff_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(str(TARIFF.get("tz") or "Europe/Moscow"))
    except Exception:
        return timezone.utc


ENERGY_TZ = _tariff_tz()


def _rate_for(month_kwh: float) -> float:
    """Marginal ₽/kWh: the band the next kilowatt-hour falls into."""
    rates = TARIFF["rates_rub_kwh"]
    limits = TARIFF["band_limits_kwh"]
    if month_kwh <= limits[0]:
        return rates[0]
    if month_kwh <= limits[1]:
        return rates[1]
    return rates[2]


def _stamp(fmt: str, now: float) -> str:
    return datetime.fromtimestamp(now, ENERGY_TZ).strftime(fmt)


def _blank_period(stamp: str, total_j: float, now: float) -> dict[str, Any]:
    return {"stamp": stamp, "base_j": total_j, "acc_j": 0.0, "last_j": total_j,
            "cost_rub": 0.0, "saved": 0.0}


def _advance_period(state: dict, path: Path, stamp: str, total_j: float, now: float) -> tuple[float, float]:
    """Roll one billing period forward; return (kWh consumed this tick, kWh so far).

    The driver's lifetime joule counter is absolute while it lives, so
    consumption = accrued + (total − counter-at-period-start). A counter that
    drops below the baseline means the driver reset it — re-base and keep the
    amount already accrued.
    """
    reset = False
    if not state or state.get("stamp") != stamp:
        state.clear()
        state.update(_blank_period(stamp, total_j, now))
        return 0.0, 0.0
    if total_j < float(state.get("base_j") or 0.0) - 1.0:
        state["acc_j"] = float(state.get("acc_j") or 0.0) + max(
            0.0, float(state.get("last_j") or 0.0) - float(state.get("base_j") or 0.0))
        state["base_j"] = total_j
        state["last_j"] = total_j
        reset = True
    delta_j = 0.0 if reset else max(0.0, total_j - float(state.get("last_j") or 0.0))
    state["last_j"] = total_j
    kwh = float(state.get("acc_j") or 0.0) + max(
        0.0, float(state.get("last_j") or 0.0) - float(state.get("base_j") or 0.0))
    return delta_j / 3.6e6, kwh


def _charge(delta_kwh: float, month_kwh_before: float) -> float:
    """Split one tick's kWh across tariff bands and return its ₽ cost."""
    if delta_kwh <= 0:
        return 0.0
    limits = TARIFF["band_limits_kwh"]
    rates = TARIFF["rates_rub_kwh"]
    pos = month_kwh_before
    remaining = delta_kwh
    cost = 0.0
    for idx in range(3):
        rate = rates[idx]
        if idx < 2:
            take = min(remaining, max(0.0, limits[idx] - pos))
        else:
            take = remaining
        cost += take * rate
        remaining -= take
        pos += take
        if remaining <= 1e-12:
            break
    return cost


def _seed_cost(state: dict) -> None:
    """Give periods that predate cost tracking a starting ₽ figure.

    Upgrades and the first boot after this feature lands arrive with kWh already
    accrued but no accrued cost. Those kWh are priced at the entry band so the
    tile never shows energy without money; the result is marked approximate."""
    if not state or state.get("cost_seeded"):
        return
    kwh = (float(state.get("acc_j") or 0.0) + max(
        0.0, float(state.get("last_j") or 0.0) - float(state.get("base_j") or 0.0))) / 3.6e6
    expected = kwh * TARIFF["rates_rub_kwh"][0]
    # Accrued money far below what the accrued kWh are worth means the period
    # started before this feature (or after a crash without a flush): top it up
    # so the tile never reads "9 kWh today, ₽3".
    if kwh > 0.2 and float(state.get("cost_rub") or 0.0) < expected * 0.55:
        state["cost_rub"] = expected
        state["cost_seeded"] = True
        state["seed_kwh"] = kwh
    elif kwh <= 0.2:
        state["cost_seeded"] = True


def _still_approximate() -> bool:
    """True only while the day still leans on the seeded estimate.

    Once a quarter of the seeded volume has been metered live, the accumulated
    cost is dominated by real ticks, so the ≈ marker drops away."""
    if not _energy_day.get("cost_seeded"):
        return bool(_energy_month.get("cost_seeded"))
    seed = float(_energy_day.get("seed_kwh") or 0.0)
    if seed <= 0:
        return True
    grown = (float(_energy_day.get("acc_j") or 0.0) + max(
        0.0, float(_energy_day.get("last_j") or 0.0) - float(_energy_day.get("base_j") or 0.0))) / 3.6e6 - seed
    return grown < seed * 0.25


def _account_energy(total_j: float, now: float) -> dict[str, float]:
    """Advance day + month energy/cost accumulators for one GPU poll tick."""
    global _energy_day, _energy_month
    day = _stamp("%Y-%m-%d", now)
    month = _stamp("%Y-%m", now)
    if not _energy_day:
        try:
            _energy_day = json.loads(ENERGY_FILE.read_text())
        except Exception:
            _energy_day = {}
    if _energy_day and "stamp" not in _energy_day and _energy_day.get("day"):
        _energy_day["stamp"] = _energy_day.pop("day")   # pre-2.3 saves
    had_month_state = bool(_energy_month)
    if not _energy_month:
        try:
            _energy_month = json.loads(ENERGY_MONTH_FILE.read_text())
        except Exception:
            _energy_month = {}
    if not _energy_month and _energy_day.get("stamp", "")[:7] == month:
        # First boot after this feature (or after a lost month file) mid-month:
        # adopt the day's accumulators instead of pretending the month starts now.
        _energy_month = {"stamp": month, "base_j": _energy_day.get("base_j", total_j),
                         "acc_j": _energy_day.get("acc_j", 0.0), "last_j": _energy_day.get("last_j", total_j),
                         "cost_rub": _energy_day.get("cost_rub", 0.0), "saved": 0.0,
                         "cost_seeded": _energy_day.get("cost_seeded", False)}

    # Month first: its position decides the marginal price for this tick.
    m_kwh_before = 0.0
    if _energy_month.get("stamp") == month:
        m_kwh_before = (float(_energy_month.get("acc_j") or 0.0) + max(
            0.0, float(_energy_month.get("last_j") or 0.0) - float(_energy_month.get("base_j") or 0.0))) / 3.6e6
    if _energy_month.get("stamp") != month:
        _energy_month.clear()
    _seed_cost(_energy_day)
    _seed_cost(_energy_month)
    m_delta, _ = _advance_period(_energy_month, ENERGY_MONTH_FILE, month, total_j, now)
    tick_cost = _charge(m_delta, m_kwh_before)
    _energy_month["cost_rub"] = float(_energy_month.get("cost_rub") or 0.0) + tick_cost

    _advance_period(_energy_day, ENERGY_FILE, day, total_j, now)
    _energy_day["cost_rub"] = float(_energy_day.get("cost_rub") or 0.0) + tick_cost

    for state, path in ((_energy_day, ENERGY_FILE), (_energy_month, ENERGY_MONTH_FILE)):
        if now - float(state.get("saved") or 0.0) > 60:
            state["saved"] = now
            try:
                path.write_text(json.dumps(state))
            except Exception:
                pass

    day_kwh = (float(_energy_day.get("acc_j") or 0.0) + max(
        0.0, float(_energy_day.get("last_j") or 0.0) - float(_energy_day.get("base_j") or 0.0))) / 3.6e6
    month_kwh = (float(_energy_month.get("acc_j") or 0.0) + max(
        0.0, float(_energy_month.get("last_j") or 0.0) - float(_energy_month.get("base_j") or 0.0))) / 3.6e6
    return {
        "day_kwh": day_kwh,
        "day_cost_rub": float(_energy_day.get("cost_rub") or 0.0),
        "month_kwh": month_kwh,
        "month_cost_rub": float(_energy_month.get("cost_rub") or 0.0),
        "rate_rub": _rate_for(month_kwh),
        "seeded": _still_approximate(),
    }


# ---------- Load averages (uptime-style 1/5/15 min) ----------

LAVG_WINDOWS = (60.0, 300.0, 900.0)


class LoadAvg:
    """Fixed-decay exponential averages, the way uptime's load average works.

    Seeded on first sample (so a fresh process starts AT the current value
    instead of crawling up from zero), then decayed with
    α = 1 − exp(−Δ/τ) per window. Fed from the 1 Hz history tick."""

    __slots__ = ("channels", "last_ts")

    def __init__(self) -> None:
        self.channels: dict[str, list[float] | None] = {
            "tps": None, "util": None, "power": None, "output": None, "input": None,
        }
        self.last_ts = 0.0

    def update(self, now: float, **values: float) -> None:
        dt = max(1e-3, min(120.0, now - self.last_ts)) if self.last_ts else 0.0
        self.last_ts = now
        alphas = [1.0 - pow(2.718281828459045, -dt / tau) for tau in LAVG_WINDOWS]
        for key, val in values.items():
            cur = self.channels.get(key)
            if cur is None:
                self.channels[key] = [float(val)] * 3
                continue
            for i, a in enumerate(alphas):
                cur[i] = cur[i] + (float(val) - cur[i]) * a

    def snapshot(self) -> dict[str, list[float] | None]:
        return {k: ([round(x, 3) for x in v] if v else None) for k, v in self.channels.items()}


LAVG = LoadAvg()



def _mask_snapshot(snap: dict) -> None:
    for m in snap.get("models") or []:
        it = m.get("intel") or {}
        nm = it.get("family") or "model"
        it["display_name"] = nm
        for key in ("weight_identity", "package", "variant", "checkpoint", "path", "config_path"):
            it[key] = ""
        for meta in m.get("model_meta") or []:
            meta["id"] = nm
            meta["root"] = ""
        m["srv_model_path"] = ""
        m["model_names"] = [nm] if m.get("model_names") else []
        m["label"] = nm
        m["endpoint"] = "http://127.0.0.1:" + str(m.get("port") or "8000")
    for g in snap.get("gpus") or []:
        for p in g.get("processes") or []:
            p["process_name"] = "engine-worker"
            p["pid"] = 10000 + g["index"]
        g["uuid"] = f"GPU-{g['index']:08X}-0000-0000-0000-000000000000"
        for mm in (g.get("tps") or {}).get("models") or []:
            mm["label"] = mm.get("label") or "model"
            mm["names"] = [mm["label"]]


def build_snapshot() -> dict[str, Any]:
    now = time.time()
    _flush_served_ledger(now)
    gpus = collect_gpus()
    # Read the cached LLM-endpoint scrape (refreshed by the slower llm_poller).
    # This keeps the fast GPU tick free of blocking HTTP to the serving stacks.
    models = STATE.models_cache
    resolve_model_gpus(models, gpus)
    enrich_models(models, now)
    # histories — gated to HISTORY_INTERVAL so the chart window and payload
    # size stay constant regardless of how fast the GPU tiles refresh.
    record_history = (now - STATE.last_history_ts) >= HISTORY_INTERVAL
    for g in gpus:
        h = STATE.gpu_hist(g["index"])
        if record_history:
            h["util"].append(g["utilization_gpu_pct"])
            h["mem"].append(g["memory_pct"])
            h["power"].append(g["power_pct"])
            h["temp"].append(g["temperature_c"])
            cap = g.get("pcie_cap_mbps") or 0.0
            h["pcie"].append(((g.get("pcie_tx_mbps") or 0.0) + (g.get("pcie_rx_mbps") or 0.0)) / (2 * cap) * 100.0 if cap else 0.0)
        g["history"] = {k: list(v) for k, v in h.items()}
    total_tps = sum(m["total_tps"] for m in models)
    total_out_tps = sum(m["output_tps"] for m in models)
    total_in_tps = sum(m["input_tps"] for m in models)
    avg_util = sum(g["utilization_gpu_pct"] for g in gpus) / max(len(gpus), 1)
    avg_mem = sum(g["memory_pct"] for g in gpus) / max(len(gpus), 1)
    tot_power = sum(g["power_draw_w"] for g in gpus)
    tot_power_limit = sum(g["power_limit_w"] for g in gpus)
    # energy + cost + efficiency: kWh since midnight, ₽ accrued at the site tariff
    tot_energy_j = sum(g.get("energy_j") or 0.0 for g in gpus)
    energy = _account_energy(tot_energy_j, now) if tot_energy_j > 0 else {
        "day_kwh": 0.0, "day_cost_rub": 0.0, "month_kwh": 0.0, "month_cost_rub": 0.0, "rate_rub": _rate_for(0.0)}
    energy_today_j = energy["day_kwh"] * 3.6e6
    tokens_total = sum((m.get("prompt_tokens_total") or 0) + (m.get("generation_tokens_total") or 0) for m in models)
    tok_per_kj = None
    if tot_energy_j > 0:
        _eff_window.append((now, tokens_total, tot_energy_j))
        old = _eff_window[0]
        # old[1] > 0 guards the step when a model's counters first appear
        if now - old[0] >= 20 and tot_energy_j > old[2] and old[1] > 0:
            d_tok = max(0, tokens_total - old[1])
            tok_per_kj = d_tok / ((tot_energy_j - old[2]) / 1000.0)
    pcie_tx = sum(g.get("pcie_tx_mbps") or 0.0 for g in gpus)
    pcie_rx = sum(g.get("pcie_rx_mbps") or 0.0 for g in gpus)
    if record_history:
        STATE.global_hist["total_tps"].append(total_tps)
        STATE.global_hist["gpu_util_avg"].append(avg_util)
        STATE.global_hist["mem_pct_avg"].append(avg_mem)
        STATE.global_hist["power_total"].append(tot_power)
        # uptime-style 1/5/15 min load averages, fed at the history cadence
        LAVG.update(now, tps=total_tps, output=total_out_tps, input=total_in_tps,
                    util=avg_util, power=tot_power)
        STATE.last_history_ts = now
        STATE.history_revision += 1
    # per-GPU TPS share: divide model TPS evenly across its gpu_indices
    per_gpu_tps = {g["index"]: {"input": 0.0, "output": 0.0, "total": 0.0, "models": []} for g in gpus}
    for m in models:
        idxs = [i for i in m["gpu_indices"] if i in per_gpu_tps]
        if not idxs or not m["healthy"]:
            continue
        n = len(idxs)
        for i in idxs:
            per_gpu_tps[i]["input"] += m["input_tps"] / n
            per_gpu_tps[i]["output"] += m["output_tps"] / n
            per_gpu_tps[i]["total"] += m["total_tps"] / n
            per_gpu_tps[i]["models"].append({"id": m["id"], "label": m["label"], "names": m["model_names"], "accent": m["accent"]})
    for g in gpus:
        g["tps"] = per_gpu_tps.get(g["index"], {"input": 0.0, "output": 0.0, "total": 0.0, "models": []})
    _now_m = datetime.fromtimestamp(now, ENERGY_TZ)
    _y2 = _now_m.year + (1 if _now_m.month == 12 else 0)
    _m2 = 1 if _now_m.month == 12 else _now_m.month + 1
    _days_in_month = (datetime(_y2, _m2, 1) - datetime(_now_m.year, _now_m.month, 1)).days
    _elapsed_days = (_now_m.day - 1) + (_now_m.hour * 3600 + _now_m.minute * 60 + _now_m.second) / 86400.0
    _month_proj = (energy["month_cost_rub"] / max(_elapsed_days, 0.25)) * _days_in_month
    snap = {
        "generated_at": utc_iso(),
        "host": HOST_LABEL,
        "driver": get_driver(),
        "cuda": get_cuda(),
        "uptime_seconds": uptime_seconds(),
        "poll_seconds": GPU_POLL_SECONDS,
        "llm_poll_seconds": LLM_POLL_SECONDS,
        "gpus": gpus,
        "models": models,
        "sniffed": STATE.sniffed_cache,
        "totals": {
            "input_tps": total_in_tps,
            "output_tps": total_out_tps,
            "total_tps": total_tps,
            "gpu_util_avg": avg_util,
            "memory_pct_avg": avg_mem,
            "power_draw_w": tot_power,
            "power_limit_w": tot_power_limit,
            "power_pct": (tot_power / tot_power_limit * 100.0) if tot_power_limit else 0.0,
            "energy_today_kwh": energy_today_j / 3.6e6,
            "tok_per_kj": tok_per_kj,
            "tokens_total": tokens_total,
            "pcie_tx_mbps": pcie_tx,
            "pcie_rx_mbps": pcie_rx,
            "lavg": {"windows": [60, 300, 900], **LAVG.snapshot()},
            "cost": {
                "rub_today": energy["day_cost_rub"],
                "rub_hour": tot_power / 1000.0 * energy["rate_rub"],
                "rub_month": energy["month_cost_rub"],
                "rub_month_projected": _month_proj,
                "kwh_today": energy["day_kwh"],
                "kwh_month": energy["month_kwh"],
                "rate_rub": energy["rate_rub"],
                "approximate": energy.get("seeded", False),
                "rates": TARIFF["rates_rub_kwh"],
                "usd_rub": float(TARIFF.get("usd_rub") or 82.92),
                "fx_date": TARIFF.get("fx_date") or "",
                "band_limits": TARIFF["band_limits_kwh"],
                "place": TARIFF.get("place"),
                "category": TARIFF.get("category"),
                "period": TARIFF.get("period"),
                "symbol": TARIFF.get("symbol", "₽"),
                "currency": TARIFF.get("currency", "RUB"),
            },
            "alltime": served_alltime(),
            "official_api": OFFICIAL_PRICING,
            "history": {k: list(v) for k, v in STATE.global_hist.items()},
        },
    }
    if MASK_NAMES:
        _mask_snapshot(snap)
    return snap


def build_stream_update(snap: dict[str, Any]) -> dict[str, Any]:
    """Build a keyed delta; new subscribers still receive a full snapshot."""
    previous = STATE.stream_snapshot
    frame: dict[str, Any] = {
        "type": "update",
        "generated_at": snap["generated_at"],
        "uptime_seconds": snap["uptime_seconds"],
    }
    for key in ("host", "driver", "cuda", "poll_seconds", "llm_poll_seconds"):
        if previous.get(key) != snap.get(key):
            frame[key] = snap.get(key)

    previous_gpus = {g["index"]: g for g in previous.get("gpus", [])}
    current_indices = set()
    gpu_updates = []
    for gpu in snap["gpus"]:
        index = gpu["index"]
        current_indices.add(index)
        old = previous_gpus.get(index, {})
        changed = {"index": index}
        changed.update({
            key: value
            for key, value in gpu.items()
            if key != "history" and old.get(key) != value
        })
        if len(changed) > 1:
            gpu_updates.append(changed)
    if gpu_updates:
        frame["gpus"] = gpu_updates
    removed = sorted(set(previous_gpus) - current_indices)
    if removed:
        frame["gpu_remove"] = removed

    previous_totals = previous.get("totals", {})
    totals = {
        key: value
        for key, value in snap["totals"].items()
        if key != "history" and previous_totals.get(key) != value
    }
    if totals:
        frame["totals"] = totals

    if STATE.stream_models_revision != STATE.models_revision:
        frame["models"] = snap["models"]
        frame["sniffed"] = snap["sniffed"]
        STATE.stream_models_revision = STATE.models_revision

    if STATE.stream_history_revision != STATE.history_revision:
        frame["history"] = {
            "max_points": HISTORY_POINTS,
            "gpus": {
                str(gpu["index"]): {
                    key: values[-1]
                    for key, values in gpu.get("history", {}).items()
                    if values
                }
                for gpu in snap["gpus"]
            },
            "totals": {
                key: values[-1]
                for key, values in snap["totals"].get("history", {}).items()
                if values
            },
        }
        STATE.stream_history_revision = STATE.history_revision

    STATE.stream_snapshot = snap
    return frame


_driver_cache: dict[str, Any] = {"ts": 0, "value": ""}


def get_driver() -> str:
    if time.time() - _driver_cache["ts"] < 3600 and _driver_cache["value"]:
        return _driver_cache["value"]
    nvml = _load_nvml()
    if nvml is not None:
        v = str(_nvml_call(nvml.nvmlSystemGetDriverVersion, ""))
    else:
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=2, check=False,
            )
            v = out.stdout.strip().splitlines()[0] if out.stdout.strip() else ""
        except Exception:
            v = ""
    _driver_cache.update(ts=time.time(), value=v)
    return v


_cuda_cache: dict[str, Any] = {"ts": 0, "value": ""}


def get_cuda() -> str:
    if time.time() - _cuda_cache["ts"] < 3600 and _cuda_cache["value"]:
        return _cuda_cache["value"]
    nvml = _load_nvml()
    if nvml is not None:
        get_version = getattr(
            nvml,
            "nvmlSystemGetCudaDriverVersion_v2",
            nvml.nvmlSystemGetCudaDriverVersion,
        )
        raw = int(_nvml_call(get_version, 0))
        v = f"{raw // 1000}.{(raw % 1000) // 10}" if raw else ""
    else:
        try:
            out = subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=2, check=False)
            m = re.search(r"CUDA Version:\s*([0-9.]+)", out.stdout or "")
            v = m.group(1) if m else ""
        except Exception:
            v = ""
    _cuda_cache.update(ts=time.time(), value=v)
    return v


def uptime_seconds() -> float:
    try:
        with open("/proc/uptime") as fp:
            return float(fp.read().split()[0])
    except Exception:
        return 0.0


# ---------- Auth ----------

# Credentials live outside the repo: .auth.json {"user": ..., "pass_sha256": ...} next to app.py,
# or NVTOP_AUTH_USER / NVTOP_PASS_SHA256 in the environment. Multi-user supported via {"users": {user: pass_sha256, ...}}.
def _auth_cfg() -> dict:
    try:
        return json.loads((APP_ROOT / ".auth.json").read_text())
    except Exception:
        return {}


def _load_auth_users(cfg: dict) -> dict[str, list[str]]:
    users: dict[str, list[str]] = {}

    def _add(u: Any, p: Any):
        if not u:
            return
        u_norm = str(u).strip().lower()
        if u_norm not in users:
            users[u_norm] = []
        if isinstance(p, list):
            for item in p:
                if item:
                    val = str(item).strip().lower()
                    if val not in users[u_norm]:
                        users[u_norm].append(val)
        elif p:
            val = str(p).strip().lower()
            if val not in users[u_norm]:
                users[u_norm].append(val)

    raw_users = cfg.get("users")
    if isinstance(raw_users, dict):
        for u, p in raw_users.items():
            _add(u, p)
    elif isinstance(raw_users, list):
        for entry in raw_users:
            if isinstance(entry, dict) and entry.get("user"):
                _add(entry.get("user"), entry.get("pass_sha256") or entry.get("hashes"))

    single_u = str(cfg.get("user") or "").strip()
    single_p = str(cfg.get("pass_sha256") or "").strip().lower()
    if single_u and single_p:
        _add(single_u, single_p)

    env_u = str(os.environ.get("NVTOP_AUTH_USER") or "").strip()
    env_p = str(os.environ.get("NVTOP_PASS_SHA256") or "").strip().lower()
    if env_u and env_p:
        _add(env_u, env_p)

    return users


_AUTH = _auth_cfg()
AUTH_USERS = _load_auth_users(_AUTH)
AUTH_USER = os.environ.get("NVTOP_AUTH_USER") or str(_AUTH.get("user") or (next(iter(AUTH_USERS.keys()), "") if AUTH_USERS else ""))
AUTH_PASS_SHA256 = os.environ.get("NVTOP_PASS_SHA256") or str(_AUTH.get("pass_sha256") or ((AUTH_USERS.get(AUTH_USER) or [""])[0] if AUTH_USERS else ""))
SESSION_TTL = 60 * 60 * 24 * 30  # 30 days
COOKIE_NAME = "nvtop_session"
SECRET_FILE = APP_ROOT / ".session-secret"


def _session_secret() -> bytes:
    try:
        s = SECRET_FILE.read_text().strip()
        if s:
            return s.encode()
    except Exception:
        pass
    s = secrets.token_hex(32)
    SECRET_FILE.write_text(s)
    try:
        SECRET_FILE.chmod(0o600)
    except Exception:
        pass
    return s.encode()


SESSION_SECRET = _session_secret()


def sign_session(user: str, exp: int) -> str:
    msg = f"{user}.{exp}"
    sig = hmac.new(SESSION_SECRET, msg.encode(), hashlib.sha256).hexdigest()
    return f"{msg}.{sig}"


def verify_session(token: str) -> bool:
    global AUTH_USERS
    try:
        user, exp, sig = token.rsplit(".", 2)
        expect = hmac.new(SESSION_SECRET, f"{user}.{exp}".encode(), hashlib.sha256).hexdigest()
        if not (hmac.compare_digest(sig, expect) and int(exp) > time.time()):
            return False
        user_norm = user.strip().lower()
        if user_norm not in AUTH_USERS:
            AUTH_USERS = _load_auth_users(_auth_cfg())
        return user_norm in AUTH_USERS
    except Exception:
        return False


PUBLIC_PREFIXES = ("/login", "/api/auth", "/healthz", "/static/themes/", "/static/login",
                   "/static/manifest", "/static/icon", "/favicon")


# ---------- FastAPI ----------

app = FastAPI()


@app.middleware("http")
async def auth_gate(request, call_next):
    path = request.url.path
    if not any(path == p.rstrip("/") or path.startswith(p) for p in PUBLIC_PREFIXES):
        token = request.cookies.get(COOKIE_NAME, "")
        if not verify_session(token):
            if path.startswith("/api/"):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            from urllib.parse import quote
            return RedirectResponse(f"/login?redirect={quote(path)}", status_code=302)
    return await call_next(request)


# Version token for immutable static assets; bump when shipping UI changes.
# HTML is always no-cache (ETag revalidation), so a bump here propagates on
# the next page load through every layer (nginx, CDN, browser, direct :8801).
ASSET_VERSION = "20261105a"


@app.middleware("http")
async def cache_headers(request, call_next):
    resp = await call_next(request)
    path = request.url.path
    if path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    elif path.startswith("/static/"):
        if request.query_params.get("v"):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp.headers["Cache-Control"] = "no-cache"
    else:
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.on_event("startup")
async def _start():
    loop = asyncio.get_event_loop()

    def _scrape_all():
        now = time.time()
        cfgs = LLM_ENDPOINTS + list(STATE.dynamic_endpoints.values())
        return [scrape_endpoint(cfg, now) for cfg in cfgs]

    async def llm_poller():
        # Slow cadence: probe the LLM serving stacks over HTTP and cache the
        # result. Runs off-thread so a slow/hung endpoint can never stall the
        # fast GPU feed. TPS deltas stay accurate because scrape_endpoint
        # timestamps against its own previous counters.
        while True:
            try:
                models = await loop.run_in_executor(None, _scrape_all)
                sniffed = await loop.run_in_executor(
                    None, sniff_models, STATE.snapshot.get("gpus") or [], models)
                await loop.run_in_executor(None, update_dynamic_endpoints, sniffed)
                STATE.models_cache = models
                STATE.sniffed_cache = sniffed
                STATE.models_revision += 1
            except Exception as exc:
                print("llm poll err:", exc)
            await asyncio.sleep(LLM_POLL_SECONDS)

    async def gpu_poller():
        # Fast cadence: NVML with an nvidia-smi fallback. Reads the cached LLM
        # scrape, so model endpoint latency never delays GPU telemetry.
        # Sleep is debited by the build time so the loop targets GPU_POLL_SECONDS
        # as the actual cadence rather than (build + interval).
        while True:
            t0 = time.time()
            try:
                snap = await loop.run_in_executor(None, build_snapshot)
                STATE.snapshot = snap
                frame = build_stream_update(snap)
                payload = f"data:{json.dumps(frame, separators=(',', ':'))}\n\n".encode()
                for q in list(STATE.subscribers):
                    try:
                        q.put_nowait(payload)
                    except asyncio.QueueFull:
                        # Slow client: drop its oldest frame and keep the newest.
                        # NEVER unsubscribe a live connection here — its generator
                        # blocks on q.get() forever while the socket stays open, so
                        # the browser freezes on stale data (e.g. 100% util) with no
                        # error event to trigger a reconnect. Dead connections are
                        # cleaned up by gen()'s finally on disconnect.
                        try:
                            q.get_nowait()
                            q.put_nowait(payload)
                        except (asyncio.QueueEmpty, asyncio.QueueFull):
                            pass
            except Exception as exc:
                print("poll err:", exc)
            await asyncio.sleep(max(0.0, GPU_POLL_SECONDS - (time.time() - t0)))

    # Prime the LLM cache once before the GPU feed starts so the first frames
    # already carry TPS/model data.
    try:
        STATE.models_cache = await loop.run_in_executor(None, _scrape_all)
        STATE.models_revision += 1
    except Exception as exc:
        print("llm prime err:", exc)

    asyncio.create_task(llm_poller())
    asyncio.create_task(gpu_poller())


@app.get("/api/snapshot")
def api_snapshot():
    return JSONResponse(STATE.snapshot)


@app.get("/api/stream")
async def api_stream():
    q: asyncio.Queue = asyncio.Queue(maxsize=4)
    STATE.subscribers.add(q)

    async def gen():
        try:
            # Yield the baseline outside the bounded delta queue. Even if the
            # producer fills that queue during connection setup, every client
            # receives a complete snapshot before its first delta.
            yield f"data:{json.dumps(STATE.snapshot, separators=(',', ':'))}\n\n".encode()
            while True:
                chunk = await q.get()
                yield chunk
        finally:
            STATE.subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.get("/healthz")
def health():
    return {"ok": True, "ts": utc_iso()}


def _html_file(request: Request, name: str):
    """FileResponse with conditional-request support: bare FileResponse never
    answers 304, so no-cache HTML would re-ship the full body on every load.
    ETag matches Starlette's stat-based algorithm for consistency."""
    path = STATIC_ROOT / name
    stat = path.stat()
    etag = f'"{hashlib.md5(f"{stat.st_mtime}-{stat.st_size}".encode(), usedforsecurity=False).hexdigest()}"'
    if etag in (request.headers.get("if-none-match") or ""):
        return Response(status_code=304, headers={"ETag": etag})
    return FileResponse(path, stat_result=stat)


@app.get("/login")
def login_page(request: Request):
    return _html_file(request, "login.html")


@app.post("/api/auth")
async def api_auth(request: Request):
    global AUTH_USERS
    try:
        body = await request.json()
    except Exception:
        body = {}
    raw_user = str(body.get("login", "")).strip()
    user_norm = raw_user.lower()
    pw = str(body.get("password", ""))
    pw_strip = pw.strip()
    pw_hash = hashlib.sha256(pw.encode()).hexdigest().lower()
    pw_strip_hash = hashlib.sha256(pw_strip.encode()).hexdigest().lower()

    expected_hashes = AUTH_USERS.get(user_norm)
    if not expected_hashes:
        AUTH_USERS = _load_auth_users(_auth_cfg())
        expected_hashes = AUTH_USERS.get(user_norm)

    ok = False
    if expected_hashes:
        for eh in expected_hashes:
            if hmac.compare_digest(pw_hash, eh) or hmac.compare_digest(pw_strip_hash, eh):
                ok = True
                break

    if not ok:
        sys.stderr.write(f"[AUTH_FAIL] user={repr(raw_user)} pw_len={len(pw)}\n")
        sys.stderr.flush()
        return JSONResponse({"error": "denied"}, status_code=401)

    exp = int(time.time()) + SESSION_TTL
    resp = JSONResponse({"ok": True})
    resp.set_cookie(
        COOKIE_NAME, sign_session(raw_user, exp),
        max_age=SESSION_TTL, httponly=True, samesite="lax", path="/",
    )
    return resp


@app.get("/api/logout")
def api_logout():
    resp = RedirectResponse("/login", status_code=302)
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp


# static
app.mount("/static", StaticFiles(directory=STATIC_ROOT), name="static")


@app.get("/")
def root(request: Request):
    return _html_file(request, "index.html")


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("NVTOP_HOST", "127.0.0.1")
    port = int(os.environ.get("NVTOP_PORT", "8801"))
    uvicorn.run(app, host=host, port=port, log_level="warning")
