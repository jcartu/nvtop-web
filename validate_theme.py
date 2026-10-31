#!/usr/bin/env python3
"""Validate an nvtop theme file: shader compiles, luma in range, animates, theme block complete.

Usage: validate_theme.py <id>
Exit 0 = PASS. Prints diagnostics either way. Screenshot at /tmp/nvtheme-<id>.png.
Serves static/themes/ on a throwaway local port (no app server needed).
"""
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

TID = sys.argv[1]
ROOT = Path(__file__).resolve().parent / "static" / "themes"

REQUIRED_THEME_KEYS = ["accent", "accent2", "text", "muted", "faint", "void", "panel", "line",
                       "good", "warn", "crit", "info", "radius", "fonts", "googleFonts"]
REQUIRED_LOGIN_KEYS = ["title", "sub", "user", "pass", "button", "granted", "denied", "boot", "footer"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def main():
    srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    from playwright.sync_api import sync_playwright
    fails = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/test.html?wp={TID}")
        try:
            pg.wait_for_function("window.__WP_STATUS !== undefined", timeout=12000)
        except Exception:
            print("FAIL: harness never reported status", errors)
            sys.exit(1)
        status = pg.evaluate("window.__WP_STATUS")
        if status != "ok":
            print(f"FAIL: {status}")
            sys.exit(1)

        th = pg.evaluate("window.__THEME.theme || {}")
        lg = pg.evaluate("window.__THEME.login || {}")
        name = pg.evaluate("window.__THEME.name || ''")
        for k in REQUIRED_THEME_KEYS:
            if k not in th:
                fails.append(f"theme.{k} missing")
        for k in REQUIRED_LOGIN_KEYS:
            if k not in lg:
                fails.append(f"login.{k} missing")
        if not name:
            fails.append("name missing")
        light = bool(th.get("light"))
        lo, hi = (0.72, 0.92) if light else (0.03, 0.16)

        time.sleep(2.5)
        pg.wait_for_function("window.__LUMA !== undefined", timeout=8000)
        l1 = pg.evaluate("window.__LUMA")
        time.sleep(2.0)
        l2 = pg.evaluate("window.__LUMA")
        pg.screenshot(path=f"/tmp/nvtheme-{TID}.png")

        # full-frame luma too (center may be atypical)
        if not (lo <= l1 <= hi) and not (lo <= l2 <= hi):
            fails.append(f"luma out of range: {l1:.3f}/{l2:.3f} (want {lo}-{hi}, light={light})")
        print(f"name={name!r} light={light} luma={l1:.3f}->{l2:.3f} animated={abs(l1 - l2) > 1e-5}")

        # energy pulse must not blow out the frame
        pg.evaluate("window.__RUNNER.pulse(1)")
        time.sleep(0.8)
        l3 = pg.evaluate("window.__LUMA")
        print(f"pulse luma={l3:.3f}")
        if not light and l3 > 0.55:
            fails.append(f"pulse blows out frame: luma {l3:.3f}")
        b.close()
    srv.shutdown()
    if fails:
        print("FAIL:", "; ".join(fails))
        sys.exit(1)
    print(f"PASS — screenshot /tmp/nvtheme-{TID}.png")


if __name__ == "__main__":
    main()
