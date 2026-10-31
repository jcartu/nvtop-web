# nvtop-web

Animated GPU + LLM telemetry dashboard for a multi-GPU inference box (built on a 4× RTX PRO 6000 Blackwell rig).

- `app.py` — FastAPI: NVML poll (4 Hz), SSE stream, OpenAI-endpoint scraper (`/metrics`), model sniffer, auth
- `bootlog.py` — engine boot-log tailer → structured launch sequence + boot history
- `static/index.html` — single-file UI (fit / flow layouts, meter strips, launch sequence); `static/themes/` shader wallpapers
- `verify_ui.py` — Playwright end-to-end check (`NVTOP_TEST_USER` / `NVTOP_TEST_PASSWORD` required)

Auth: put `{"user": "...", "pass_sha256": "..."}` in `.auth.json` next to `app.py` (or `NVTOP_AUTH_USER` / `NVTOP_PASS_SHA256`). Run: `NVTOP_PORT=8801 python app.py` behind any reverse proxy. See `CHANGELOG.md`.
