# Changelog

All notable changes to nvtop-web.

## [Unreleased]

### Load averages, energy cost, calmer instrumentation
- 1/5/15 min load averages for total throughput, **input and output tok/s**, GPU utilisation and cluster power, computed
  server-side with uptime-style fixed-decay exponentials and seeded on first sample so a restarted
  service starts at truth instead of climbing from zero. Each headline KPI carries the triplet with
  a momentum caret; the other tiles gained a single derived footnote (output share, in:out ratio,
  daily average draw, ₽/h burn). Input and output tiles also carry **$/Mtok** — sustained electrical cost per million
  tokens in each direction (sustained power × marginal ₽/kWh ÷ sustained tok/s ÷ the day's CBR USD rate) — so the
  token-metered economics are visible without a spreadsheet.
- Electricity cost: site tariff for a rural Moscow-region settlement (сельское население), 2026 II полугодие — 7.46 / 8.04 / 10.86 ₽/kWh across the 3900 / 6000 kWh monthly
  bands. Editable `energy_tariff.json` (+ `NVTOP_ELECTRICITY_RATES` override), day and month
  accumulators in Moscow time, marginal-band charging that prices a boundary-crossing tick at the
  correct split rate, driver-counter-reset rebasing, and a month-to-date projection. Exposed as
  `totals.cost` and re-shaped as a twin: the **COST · MTOK** instrument leads with blended treating-cost-per-million-tokens
  and its own 1/5/15 min averages, per-direction input/output $/Mtok underneath, with ₽/day, ₽/h and
  month-to-date moved into the tooltip; kWh accrued
  before the feature existed is priced at the entry band and flagged approximate.
- GPU meter strips rebuilt for the STARK HUD (and every theme): engraved 10% graduations visible through
  filled and empty track, colour-mixed gradients anchored in the theme's own void, a crisp 2 px leading
  cursor instead of a glossy dome, halved bloom, and sparklines recoloured to match their bar (util cyan,
  temperature mint) so a cool GPU no longer plots an alarming red line.
- Legibility pass aimed at eye strain: global glow halved, per-theme shader exposure (`theme.dim`)
  and panel alpha floors, calmer KPI sheen and tighter numeral halos, taller panel blur, and an
  automatic contrast lifter in the theme engine. The lifter composites the real panel-over-void
  stage colour and nudges `text`/`muted`/`faint`/accents toward white or black until they meet
  their contrast targets — so light themes like SKYTOWER and any future palette stay readable
  without hand-tuning sixteen colour values per theme.
- Four new first-class themes, each a single-file fragment shader, all validated at 0.03–0.16
  centre luma: **LIQUID GLASS** (warped refractive slabs, caustic filaments, spectral rim
  dispersion), **LIQUID CHROME** (endless mercury sea with studio softbox reflections and thin-film
  fringing on the flanks), **THERMAL SCAN** (buoyant LWIR plumes, ironbow ramp, isotherm contours,
  reticle furniture), **DITHERPUNK** (Bayer 4×4 ordered dither, interference rings, sparse acid
  pixels, cleared centre). Registered in the dashboard and login theme orders and documented in the
  gallery.


### Model identity and Flare
- Recognize Flare serving processes and discover their API ports even when socket descriptors are
  unreadable; connect Flare token, request, queue, and KV-page counters to the existing dashboard.
- Separate the serving alias, authoritative checkpoint root, compiled package, and source metadata.
  Exact local matches take precedence; ambiguous or unavailable checkpoints do not inherit another
  variant's metadata. Same-port model/engine switches invalidate cached identity and counter baselines.
- Distinguish DeepSeek V4.1 Flash original/1017, stock/WARMIND-abliterated, native mixed FP8/FP4,
  lossless CSF, and NVIDIA NVFP4. Read nested text configs and avoid counting opaque Flare payloads
  or packed quantized tensors as logical parameters.
- Show full descriptions in fit and scrolling layouts, with wrapping model names/specs and separate
  weight/package provenance. The model band scrolls on short screens without pushing GPUs offscreen.
- Add model-identity regression coverage and replace the UI's fixed engine allowlist with description
  visibility/clipping checks. Preserve privacy-mode scrubbing of provenance fields.

## [2.2.0] — 2026-10-31

### Visual overhaul & showcase documentation
- Full showcase-tier documentation suite designed by Claude Fable with architecture diagrams, interactive telemetry breakdowns, and responsive container layout galleries.
- Live animated GIF suite in `docs/media/`:
  - `dashboard-live.gif`: 4× GPU real-time telemetry, token speedometer odometer, and WebGL shader wallpaper.
  - `theme-cycling.gif`: live demonstration cycling through 13 WebGL shader themes in real time.
  - `gpu-card-live.gif`: close-up recording of the analog speedometer, thermometer, and KV cache memory breakdown.
- Complete theme creation specification published in `docs/THEMES.md`.
- Privacy & kiosk mode in `app.py`: `NVTOP_HOST_LABEL` for customizable host branding and `NVTOP_MASK_NAMES=1` for anonymized kiosk/screenshot streaming.

## [2.1.1] — 2026-10-31

### Wallpaper smoothness
- Shader wallpapers now render every vsync (60 fps; 30 fps after 4 s idle) with pure rAF pacing
  instead of 18 fps / 6 fps idle through setTimeout. GPU cost is held constant by a pixel budget
  (36 Mpx/s → ~0.6 Mpx canvas, CSS-upscaled); an adaptive governor measures real frame deltas and
  steps resolution down 15% when frames are dropped, creeping back after 8 s of clean frames.
  Per-theme `perf.fps` below 30 is clamped. Asset version bumped so cached runners refresh.

## [2.1.0] — 2026-10-31

### Hero throughput card
- "Total tok/s" is now the deck's hero instrument: a large odometer that tweens toward the live value
  (fast attack, slow decay) with glow and colour temperature scaling against the session peak; a token
  particle stream over the chart whose density and speed follow throughput and converge on the chart
  head; thicker glowing area chart with pulsing head dot and a dashed session-peak line;
  ↑out ↓in · pk · rec sub-line (record persisted per browser). The card takes 1.55× the width of the
  cluster-util chart in fit mode.
- Endpoint scraper: counters appearing for the first time (endpoint just turned healthy / server
  replaying lifetime totals) no longer register as a throughput spike.

## [2.0.0] — 2026-10-31

### Layout — "fit" mode
- The dashboard is now a single viewport-filling grid (header / deck / GPU grid / footer) with no page
  scroll whenever the window is ≥ 760×540. All four GPUs are always on screen, whatever the tile size.
  Toggle to the old scrolling page with `L` or the ⊞ button (persisted in `localStorage`).
- GPU cards are CSS size containers: every dimension inside is `em` off a `--fs` derived from the card's
  own height/width, so gauges, bars and text scale to the tile. Container queries re-arrange the card:
  short cards keep hardware tags in the head row; tall cards drop them under the instruments; portrait
  cards (4-across on ultrawide) stack instruments over telemetry.
- GPU grid shape follows the window shape: 2×2 by default, 1×4 for portrait tiles, 4×1 on ultrawide.
- Models and the two cluster charts share one horizontal "deck" band; the band grows to 50 vh while a
  model boot is in progress.
- Compact horizontal model cards in fit mode (identity · meta line · stats · spark); long-form blurbs
  only in the scrolling layout.

### GPU card — meter strips
- Bars + sparklines merged into four meter strips (Memory, Power, Util, Temp): header with peak,
  a thick glowing bar whose thickness scales with the strip, and the history graph filling the rest.
  2×2 on short cards, 4 rows on tall; below ~58 px of strip height the graph yields and the bar thickens.
- Hardware tags moved to pills: PCIe link, AER, SM/MEM clocks, P-state, fan, per-GPU TPS, model.
  Fan % and TPS-share are no longer bars.
- Processes rendered as one chip line in fit mode (heaviest first), full table in the scrolling layout.
- GPU name shortened for the head row (`RTX PRO 6000 Blackwell WS`), full name and UUID in tooltips.

### Model boot — launch sequence (new `bootlog.py`)
- The serving engine's own stdout is tailed (docker container via `/proc/<pid>/cgroup` → `docker logs`,
  or a log file on fd 1/2) and parsed into a structured boot: engine/version, architecture, TP,
  max model len, KV dtype, expert dtype, checkpoint size, MoE backend, NCCL version.
- Stage track INIT / WEIGHTS / WARMUP / API with live per-stage durations and the previous boot's
  durations beside them; ETA from the last successful boot of the same model (`boot_history.json`).
- Progress bar driven by whatever bar the engine is drawing: safetensors shards, CUDA-graph capture
  (FULL / PIECEWISE), JIT kernel warmup, parallel compile, GEMM tuning.
- Per-rank VRAM fill against the per-rank weight target; warmup checklist (model init, weights,
  KV budget GiB/rank, KV cache tokens + max concurrency, compile, CUDA graphs, API server, TTFT probe);
  host-side cells (disk read, VRAM fill rate, loader CPU, RAM staged, host RAM free at load).
- One-shot TTFT probe (1-token streaming completion) when the API comes up; retried if refused.
- Failure state: root-cause line surfaced (first `<X>Error:` after the traceback), bar frozen,
  card and stage track in red; `BOOT FAILED` / `ONLINE` toasts and wallpaper pulses on milestones.
- 6-line engine log tail with level colouring; traceback frames and tqdm spam filtered.
- Resident models show `boot · ttft · N boots` from history.
- Handles `docker logs` spanning container restarts (a second engine banner resets the boot) and
  ignores vLLM's early "Starting vLLM API server" line (readiness = "Application startup complete").

### Telemetry
- PCIe RX/TX per GPU (`nvmlDeviceGetPcieThroughput`) with link capacity at the current Gen × width:
  shown in the PCIe pill as ↑/↓ GB/s with a bus-utilisation fill, cluster total in the hostline,
  per-GPU `pcie` history series.
- Energy: lifetime NVML energy counter → kWh since local midnight (baseline persisted in
  `energy_day.json`, survives restarts and driver counter resets) as a sixth header KPI;
  tokens per kJ over a 30 s window in the hostline.
- vLLM serving quality from `/metrics` histograms: TTFT p50/p95 and inter-token latency p50/p95
  (windowed bucket deltas), prefix-cache hit rate, preemptions — as live cells on the model card.

### Sniffer
- Loading entries deduplicated by pid set (export/quant jobs touching many weight files produced
  one card per file group); boots sort first.

### Security / ops
- Plaintext dashboard password removed from source; `verify_ui.py` reads `NVTOP_TEST_PASSWORD`,
  `app.py` accepts `NVTOP_PASS_SHA256`.
- `NVTOP_DEMO_BOOT=/path/server.log` replays a captured engine log as a synthetic loading model
  (`NVTOP_DEMO_LPS` lines/s, `NVTOP_PORT` to run a second instance).

## [1.x] — baseline
- Animated GPU + LLM TPS dashboard: NVML poll, SSE stream, endpoint scraper, model sniffer,
  13 shader themes, PWA, login.
