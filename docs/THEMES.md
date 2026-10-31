# nvtop theme spec

Each theme is ONE file at `static/themes/<id>.js` registering itself:

```js
(window.NVTHEMES = window.NVTHEMES || {})['<id>'] = {
  id: '<id>',
  name: 'DISPLAY NAME',          // shown in theme menu + shift toast (short, punchy, uppercase)
  tag: 'ONE-LINE FLAVOR',        // subtitle on login screen + menu
  theme: {
    light: false,                // true only for light UIs
    accent:  '#rrggbb',          // primary UI accent (headings, rings, util bars)
    accent2: '#rrggbb',          // gradient partner / secondary accent
    text:  '#rrggbb',            // main text
    muted: '#rrggbb',            // labels
    faint: '#rrggbb',            // faintest text
    void:  '#rrggbb',            // page bg behind the shader
    panel: 'rgba(r,g,b,a)',      // card background (translucent! shader shows through, a≈0.45-0.7)
    line:  'rgba(r,g,b,a)',      // card borders / hairlines
    good:  '#rrggbb',            // ok/healthy (must read on panel bg)
    warn:  '#rrggbb',            // hot/degraded
    crit:  '#rrggbb',            // critical/offline
    info:  '#rrggbb',            // memory/neutral-data accent
    radius: '14px',              // panel corner radius (0-4px = sharp military, 14-22px = soft glass)
    fonts: {
      display: "'Font Name',fallback",  // big numbers, brand, buttons
      head:    "'Font Name',fallback",  // section titles, labels
      mono:    "'Font Name',monospace", // data values, tables, KPI digits
    },
    googleFonts: ['Font+Name:wght@400;700', ...],  // css2 API family params
  },
  login: {
    title: 'SYSTEM NAME',        // big title on the login card
    sub: 'FLAVOR SUBTITLE',      // small line under title
    user: 'OPERATOR ID',         // username field label (in-universe!)
    pass: 'ACCESS KEY',          // password field label
    button: 'ENGAGE',            // submit button text
    granted: 'ACCESS GRANTED',   // success button text
    denied: 'ACCESS DENIED',     // error text
    boot: ['LINE 1 .... OK', 'LINE 2 .... OK', 'READY.'],  // 3-5 boot log lines typed on the login card (in-universe flavor)
    footer: 'small print line',  // bottom small print (in-universe easter egg)
  },
  /* OPTIONAL low-power profile, merged into the WallpaperRunner opts by index.html + login.html.
     Runner defaults: fps 18, idleFps 6, quality 0.35. Declare only to run CHEAPER (e.g. tokyo: fps 14, idleFps 4, quality 0.30). */
  perf: { fps: 14, idleFps: 4, quality: 0.30 },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
/* ... WebGL1 GLSL ES 1.00 fragment shader ... */
void main(){ ...; gl_FragColor = vec4(col, 1.0); }`,
};
```

## Shader contract (WebGL1 / GLSL ES 1.00 — no `#version`, no dFdx unless you enable the ext, loops must have constant bounds)
- `u_res` px resolution, `u_time` seconds, `u_mouse` smoothed pointer each axis in [-0.5,0.5] — use it for subtle parallax (NOT huge shifts).
- `u_energy` 0..1 "event excitement" — spikes when the dashboard sees TPS/load surges or theme shift. React noticeably but tastefully: brighten trails, speed up motion, ripple. MUST NOT blow out the whole frame (dark themes: pulsed center luma ≤ 0.5).
- `u_pulseAge` seconds since last event pulse (huge before first) — good for shockwave rings: `float ring = smoothstep(...)` on radius `u_pulseAge * speed`.
- OPTIONAL live-telemetry uniforms (declare only if used; runner feeds them when declared):
  `u_drive` 0..1 smoothed cluster GPU utilization — gate "the machine is working" drama on this (idle should be CALM);
  `u_spin` integrated rotation phase (d/dt = 0.12 + 2.3·drive) — use INSTEAD of `u_time` for rotation angles so speed ramps never snap;
  `u_heat` 0..1 smoothed hottest-GPU temperature (0 ≈ 35°C, 1 ≈ 85°C+) — recolor cores/glows cool→hot.
- Runs at scale 0.85 fullscreen behind a dashboard — CONTENT SITS ON TOP. Keep the CENTER-region readable: dark themes center avg luma 0.03–0.16; light themes 0.72–0.92. Put the flashy stuff toward edges/horizon, vignette the center.
- Must animate continuously (idle motion even with no events) and loop gracefully for hours (no precision blowups: wrap long times with mod()).
- Budget ~120-250 lines of GLSL. fbm/noise helpers welcome. It must run 60fps on a real GPU; avoid >6-octave fbm over full screen with multiple raymarch loops.

## Quality bar
This must look like a AAA film UI wallpaper, not a demoscene toy: art-directed palette, depth (layers/parallax/fog), atmosphere (grain, vignette, chromatic touches), and 2–3 distinct visual ideas composed together (e.g. for a TRON theme: perspective grid floor + light-trail streaks + horizon gate glow). Study the film reference given in your task. Cheap = uniform noise everywhere, plain plasma, or a single unmodulated pattern. Include subtle film grain (`hash` flicker ~0.02) and vignette in most themes.

## Validate (must PASS before you're done)
```
python validate_theme.py <id>
```
Then LOOK at /tmp/nvtheme-<id>.png (Read tool — it's an image) and iterate until it genuinely looks film-grade. Expect 2-4 iterations; judge composition, palette, depth. A flat/boring first render is normal — push it.
