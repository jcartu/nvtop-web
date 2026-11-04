#!/usr/bin/env python3
"""End-to-end UI verification: login flow, theme engine, W-key cycling, screenshots.

Usage: verify_ui.py [--shots]   (--shots saves per-theme dashboard + login screenshots)
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8801"
THEMES = ['oblivion', 'ares', 'k2049', 'muthur', 'jarvis', 'nightcity', 'arrakis', 'lumon', 'apex', 'construct', 'gargantua', 'thegrid', 'tokyo']
SHOTS = "--shots" in sys.argv
PASSWORD = os.environ.get("NVTOP_TEST_PASSWORD") or sys.exit("set NVTOP_TEST_PASSWORD")
USER = os.environ.get("NVTOP_TEST_USER") or sys.exit("set NVTOP_TEST_USER")

fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" — " + str(extra) if extra and not cond else ""))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1720, "height": 1080})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    # 1. unauthenticated → login redirect
    pg.goto(BASE + "/")
    pg.wait_for_selector("#card", timeout=15000)
    check("redirects to /login", "/login" in pg.url, pg.url)
    time.sleep(2.2)
    theme_name = pg.eval_on_selector("#t-name", "el => el.textContent")
    check("login theme loaded", bool(theme_name and theme_name != "—"), theme_name)
    if SHOTS:
        pg.screenshot(path="/tmp/nv-login-default.png")

    # 3. wrong password shakes + error
    pg.fill("#u", USER)
    pg.fill("#p", "wrong")
    pg.click("#go")
    pg.wait_for_selector("#err.on", timeout=6000)
    check("bad login shows error", True)

    # 4. correct login → dashboard
    pg.fill("#u", USER)
    pg.fill("#p", PASSWORD)
    pg.click("#go")
    pg.wait_for_url(BASE + "/", timeout=10000)
    pg.wait_for_selector(".gpu-card", timeout=15000)
    check("login lands on dashboard with GPU cards", True)

    # 5. whichever serving stack is live renders as a healthy model card with
    # its served model ids and endpoint (not pinned to one port/model: the
    # serving stack changes far more often than this UI does)
    pg.wait_for_selector(".model-card.healthy", timeout=15000)
    mc = ".model-card.healthy "
    served_models = pg.eval_on_selector_all(
        mc + '[data-role="served"] .tag',
        "els => els.map(el => el.textContent.trim())",
    )
    model_role = pg.eval_on_selector(mc + '[data-role="role"]', "el => el.textContent")
    check("live model card lists served models", bool(served_models) and all(served_models), served_models)
    check("live model card shows its endpoint", "http://" in model_role and "GPUs" in model_role, model_role)

    # 5b. model intelligence: lineage and the full description remain readable,
    # including in fit mode (which previously hid the description entirely).
    lineage = pg.eval_on_selector(mc + '[data-role="lineage"]', "el => el.textContent")
    check("model card shows lineage", len(lineage.strip()) > 1 and lineage.strip() != "—", lineage)
    description = pg.locator(mc + '[data-role="blurb"]')
    check("model description visible in fit mode", description.is_visible())
    unclipped = description.evaluate("el => el.scrollHeight <= el.clientHeight + 1 && [...el.children].every(e => e.scrollHeight <= e.clientHeight + 1)")
    check("model description is not line-clamped", unclipped)

    # 5c. animated thermometer on every GPU card
    ngpu = pg.eval_on_selector_all(".gpu-card", "els => els.length")
    nthermo = pg.eval_on_selector_all(".gpu-card .thermo", "els => els.length")
    check("every GPU card has a thermometer", ngpu > 0 and nthermo == ngpu, f"{nthermo}/{ngpu}")
    tval = pg.eval_on_selector('.gpu-card .thermo [data-role="t-val"]', "el => el.textContent")
    check("thermometer shows core temp", tval.strip().isdigit(), tval)
    merc_y = pg.eval_on_selector('.gpu-card .thermo [data-role="merc"]', "el => getComputedStyle(el).y")
    check("thermometer mercury is positioned", merc_y not in ("", "auto", "0px"), merc_y)

    # 5d. universal model sniffer: snapshots always carry the sniffed array, and
    # any rendered sniffed card has a name + VRAM/spec cells
    check("snapshot carries sniffed models array",
          bool(pg.evaluate("Array.isArray(lastSnap && lastSnap.sniffed)")))
    n_sniffed = pg.eval_on_selector_all(".model-card.sniffed", "els => els.length")
    if n_sniffed:
        sname = pg.eval_on_selector('.model-card.sniffed [data-role="name"]', "el => el.textContent")
        check(f"sniffed card ({n_sniffed}) has model name", bool(sname.strip()), sname)

    # 5. all themes registered
    time.sleep(2.5)
    n = pg.evaluate("Object.keys(window.NVTHEMES||{}).length")
    check(f"all {len(THEMES)} themes registered", n == len(THEMES), f"got {n}")
    cur = pg.evaluate("localStorage.getItem('nvtop-theme')")
    print("   current theme:", cur)

    # 6. W key cycles through every theme; wallpaper canvas live; screenshot each
    seen = []
    for i in range(len(THEMES)):
        cur = pg.evaluate("localStorage.getItem('nvtop-theme')")
        seen.append(cur)
        accent = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        font = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim()")
        opac = pg.evaluate("Math.max(...['wp-a','wp-b'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).opacity)))")
        ok = bool(accent) and opac > 0.9
        check(f"theme {cur}: accent={accent} wallpaper-visible={opac}", ok, f"font={font}")
        if SHOTS:
            time.sleep(1.6)  # let crossfade finish
            pg.screenshot(path=f"/tmp/nv-dash-{cur}.png")
        pg.keyboard.press("w")
        time.sleep(2.2)  # allow shader compilation and canvas crossfade to settle
    check(f"W cycled all {len(THEMES)} uniquely", len(set(seen)) == len(THEMES), seen)

    # 7. theme menu opens via S and lists every theme
    pg.keyboard.press("s")
    pg.wait_for_selector("#theme-menu.open", timeout=4000)
    items = pg.eval_on_selector_all(".tm-item", "els => els.length")
    check(f"S opens menu with {len(THEMES)} items", items == len(THEMES), items)
    pg.keyboard.press("Escape")

    # 8. theme button exists and shows name
    btn = pg.eval_on_selector("#btn-theme-name", "el => el.textContent")
    check("theme button shows name", bool(btn and btn != "THEME"), btn)

    # 9. data still streaming (KPI changes)
    v1 = pg.eval_on_selector("#hostline", "el => el.textContent")
    time.sleep(3)
    v2 = pg.eval_on_selector("#hostline", "el => el.textContent")
    check("SSE stream updating hostline", v1 != v2, v1)

    # 10. responsive form factors: Samsung Z TriFold / Z Fold cover + unfolded,
    # and a portrait PC monitor. Fresh context per device (own auth + touch).
    def login_flow(page):
        page.goto(BASE + "/")
        page.wait_for_selector("#card", timeout=15000)
        page.fill("#u", USER)
        page.fill("#p", PASSWORD)
        page.click("#go")
        page.wait_for_url(BASE + "/", timeout=10000)
        page.wait_for_selector(".gpu-card", timeout=15000)

    FORMS = [
        ("candybar", 384, 872, True),        # trifold/fold folded cover screen
        ("fold-portrait", 748, 1092, True),  # unfolded, held vertical
        ("fold-landscape", 1176, 892, True), # trifold fully open
        ("desk-portrait", 1080, 1920, False),# PC monitor rotated 90°
    ]
    for name, w, h, touch in FORMS:
        c2 = b.new_context(viewport={"width": w, "height": h},
                           device_scale_factor=2.5 if touch else 1,
                           is_mobile=touch, has_touch=touch)
        p2 = c2.new_page()
        errs2 = []
        p2.on("pageerror", lambda e, _l=errs2: _l.append(str(e)))
        login_flow(p2)
        time.sleep(2.5)
        overflow = p2.evaluate("document.scrollingElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{name} {w}x{h}: no horizontal overflow", overflow <= 1, overflow)
        touch_cls = p2.evaluate("document.body.classList.contains('touch')")
        check(f"{name}: touch class == {touch}", touch_cls == touch, touch_cls)
        fs_vis = p2.evaluate("(() => { const r = document.getElementById('btn-fs').getBoundingClientRect(); return r.width > 0 && r.height > 0; })()")
        check(f"{name}: fullscreen button visible", fs_vis)
        check(f"{name}: no JS errors", not errs2, errs2[:2])
        p2.screenshot(path=f"/tmp/nv-resp-{name}.png")
        if name == "candybar":
            p2.click("#btn-fs")
            time.sleep(0.7)
            fs_on = p2.evaluate("!!document.fullscreenElement")
            check("fullscreen button enters fullscreen", fs_on)
            if fs_on:
                p2.click("#btn-fs")
                time.sleep(0.6)
                check("fullscreen button exits fullscreen",
                      p2.evaluate("!document.fullscreenElement"))
        c2.close()

    # 11. per-theme login screens
    if SHOTS:
        for t in THEMES:
            pg.evaluate(f"localStorage.setItem('nvtop-theme','{t}')")
            pg.goto(BASE + "/api/logout")
            pg.wait_for_selector("#card", timeout=8000)
            time.sleep(2.4)
            pg.screenshot(path=f"/tmp/nv-login-{t}.png")
            # log back in for next round
            pg.fill("#u", USER)
            pg.fill("#p", PASSWORD)
            pg.click("#go")
            pg.wait_for_url(BASE + "/", timeout=10000)

    js_errors = [e for e in errors if "favicon" not in e]
    check("no page JS errors", not js_errors, js_errors[:3])
    b.close()

print()
if fails:
    print("FAILURES:", fails)
    sys.exit(1)
print("ALL PASS")
