/* TOKYO NIGHT — the Oh My Pi terminal, as a wallpaper.
   Exact OMP dark-tokyo-night palette. Budget shader: zero raymarch, zero fbm,
   ~18 hash lookups/px worst case. Runs happily on integrated GPUs. */
(window.NVTHEMES = window.NVTHEMES || {})['tokyo'] = {
  id: 'tokyo',
  name: 'TOKYO NIGHT',
  tag: 'OH MY PI · NEO-TOKYO TERMINAL',
  /* opt-in low-power profile (index.html passes this to WallpaperRunner) */
  perf: { fps: 14, idleFps: 4, quality: 0.30 },
  theme: {
    light: false,
    accent:  '#bb9af7',              /* omp accent  = purple  */
    accent2: '#7dcfff',              /* omp borderAccent = cyan */
    text:  '#c0caf5',                /* omp lightBlue */
    muted: '#a9b1d6',                /* omp fg */
    faint: '#51597d',                /* omp comment/dimGray */
    void:  '#0f1019',                /* omp statusBg */
    panel: 'rgba(26,27,38,0.62)',    /* #1a1b26 glass */
    line:  'rgba(122,162,247,0.16)', /* omp border = blue */
    good:  '#9ece6a',
    warn:  '#e0af68',
    crit:  '#f7768e',
    info:  '#7dcfff',
    radius: '10px',                  /* omp boxRound ╭╮╰╯ */
    fonts: {
      display: "'JetBrains Mono',monospace",
      head:    "'JetBrains Mono',monospace",
      mono:    "'JetBrains Mono',monospace",
    },
    googleFonts: ['JetBrains+Mono:wght@400;500;700;800'],
  },
  login: {
    title: 'OH MY PI',
    sub: 'tokyo-night · interactive session',
    user: 'WHOAMI',
    pass: 'SSH PASSPHRASE',
    button: 'omp --resume',
    granted: 'SESSION RESTORED',
    denied: 'permission denied (publickey)',
    boot: [
      '$ omp --theme tokyo-night ......... OK',
      'skills ............... 12 loaded',
      'lsp .................. 4 servers ready',
      'model ................ claude-fable-5 [online]',
      'READY.',
    ],
    footer: '~/.omp/agent/themes/tokyo-night.json',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
uniform float u_drive; uniform float u_heat;

float h1(float n){ return fract(sin(n)*43758.5453123); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float seg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p-a, ba = b-a;
  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
  return length(pa - ba*h);
}
/* two overlapped column grids -> varied building widths */
float bh(float x, float cols, float seed){
  float a = h1(floor(x*cols) + seed);
  float b = h1(floor(x*cols*0.5) + seed*1.31 + 7.3);
  return max(a*0.72, b);
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float t = mod(u_time, 1200.0);

  vec3 BG0    = vec3(0.043,0.047,0.078);
  vec3 BG1    = vec3(0.102,0.106,0.149); /* #1a1b26 */
  vec3 BLUE   = vec3(0.478,0.635,0.969); /* #7aa2f7 */
  vec3 CYAN   = vec3(0.490,0.812,1.000); /* #7dcfff */
  vec3 PURPLE = vec3(0.733,0.604,0.969); /* #bb9af7 */
  vec3 GREEN  = vec3(0.620,0.808,0.416); /* #9ece6a */
  vec3 ORANGE = vec3(1.000,0.620,0.392); /* #ff9e64 */
  vec3 YELLOW = vec3(0.878,0.686,0.408); /* #e0af68 */
  vec3 RED    = vec3(0.969,0.463,0.557); /* #f7768e */
  vec3 FG     = vec3(0.753,0.792,0.961); /* #c0caf5 */

  /* ---- night sky ---- */
  vec3 col = mix(BG1, BG0, smoothstep(0.22, 0.95, uv.y));
  float horizon = 0.305;
  float dome = exp(-max(uv.y-horizon, 0.0)*5.0);
  vec3 cityWarm = mix(YELLOW, ORANGE, 0.45);
  col += cityWarm * exp(-max(uv.y-horizon, 0.0)*8.0) * (0.17 + 0.05*u_drive);
  col += mix(PURPLE, BLUE, 0.5+0.35*sin(uv.x*2.6+0.7)) * dome * (0.12 + 0.05*u_drive);
  col += CYAN * exp(-abs(uv.y-horizon)*20.0) * 0.05;

  /* ---- stars ---- */
  float sgate = smoothstep(0.40, 0.75, uv.y);
  float sh = h2(floor(gl_FragCoord.xy/2.0));
  col += FG * step(0.9982, sh) * sgate * (0.25 + 0.30*sin(t*1.7 + sh*90.0));

  /* ---- moon ---- */
  vec2 p  = vec2(uv.x*aspect, uv.y);
  vec2 mp = vec2(0.80*aspect, 0.78) - u_mouse*0.018;
  float md = length(p-mp);
  float disc = smoothstep(0.052, 0.049, md);
  float mott = 0.90 + 0.10*h2(floor((p-mp)*140.0));
  col = mix(col, (FG*0.88 + PURPLE*0.12)*0.72*mott, disc);
  col += mix(FG, PURPLE, 0.45) * exp(-md*10.0) * 0.16 * (1.0-disc);

  /* ---- ghost prompt: the omp chevron, breathing in the sky ---- */
  vec2 cp = (p - vec2(0.14*aspect, 0.60)) / 0.10;
  float dch = min(seg(cp, vec2(-0.25,0.55), vec2(0.30,0.0)),
                  seg(cp, vec2(0.30,0.0),  vec2(-0.25,-0.55)));
  col += PURPLE * smoothstep(0.16, 0.02, dch) * 0.06 * (0.75+0.25*sin(t*0.5));

  /* ---- far skyline ---- */
  float xF = uv.x + u_mouse.x*0.006;
  float hF = 0.300 + 0.105*bh(xF, 30.0, 11.0);
  float mF = step(uv.y, hF);
  col = mix(col, vec3(0.104,0.112,0.170), mF*0.92);
  col += BLUE * step(0.90, h2(floor(vec2(xF*160.0, uv.y*90.0)))) * mF * 0.08;
  /* atmospheric haze bleeding over the far rooftops — the city breathes */
  col += cityWarm * exp(-abs(uv.y-0.315)*15.0) * 0.10;
  col += cityWarm * exp(-abs(uv.y-0.315)*45.0) * 0.08;

  /* ---- near skyline ---- */
  float xN = uv.x + u_mouse.x*0.016;
  float hN = 0.155 + 0.205*bh(xN+3.7, 14.0, 51.0);
  float mN = step(uv.y, hN);
  col = mix(col, vec3(0.026,0.028,0.048), mN);
  col += mix(BLUE,PURPLE,0.5) * smoothstep(0.012, 0.0, hN-uv.y) * mN * 0.20;

  /* lit windows, warm/cool mix; u_heat pushes them hot */
  vec2 wg  = vec2(xN*88.0, uv.y*52.0);
  float wr = h2(floor(wg));
  float cl = h2(floor(wg/vec2(3.0,2.0)) + 9.7);
  float lit = step(0.55 + 0.37*cl, wr);
  vec2 wf = fract(wg);
  float shape = step(0.24,wf.x)*step(wf.x,0.80)*step(0.20,wf.y)*step(wf.y,0.72);
  float wsel = fract(wr*7.31);
  vec3 wcol = mix(mix(YELLOW, ORANGE, fract(wr*3.7)), mix(CYAN, BLUE, fract(wr*5.1)), step(0.45,wsel));
  wcol = mix(wcol, RED, u_heat*0.5*step(0.75,wsel));
  float wflick = 0.72 + 0.28*sin(t*(0.4+wr*1.3)+wr*70.0);
  col += wcol * lit * mN * (0.55*shape + 0.10) * wflick;

  /* rooftop beacons */
  float ncol = floor((xN+3.7)*14.0);
  float br = h1(ncol*3.31+51.0);
  float bx = (ncol+0.5)/14.0 - 3.7;
  float rf = 0.155 + 0.205*bh(bx+3.7, 14.0, 51.0);
  vec2 bp = vec2((xN-bx)*aspect, uv.y-(rf+0.006));
  col += RED * smoothstep(0.0075, 0.0015, length(bp))
             * smoothstep(0.2, 0.95, sin(t*2.3+br*40.0)) * step(0.62,br) * 0.7;

  /* ---- glyph rain: terminal characters in tokyo-night ink ---- */
  float density = 0.50 + 0.28*u_drive + 0.18*u_energy;
  vec2 cf = uv - vec2(0.5, 0.55); cf.x *= aspect*0.8;
  float centerFade = mix(0.10, 1.0, smoothstep(0.10, 0.52, length(cf)));
  vec3 rain = vec3(0.0);
  for (int k = 0; k < 2; k++){
    float fk = float(k);
    float cw = mix(9.0, 15.0, fk);
    vec2 cell = gl_FragCoord.xy / vec2(cw, cw*1.4);
    float ci = floor(cell.x) + fk*131.0;
    float ch = h1(ci*1.93 + 4.7);
    float act = step(ch, density*(1.15-0.50*fk));
    float rows = u_res.y/(cw*1.4);
    float spd = rows*(0.05+0.11*fract(ch*7.31))*(0.7+0.5*fk)*(1.0+1.1*u_drive+1.5*u_energy);
    float headY = rows*1.25 - mod(t*spd + fract(ch*13.7)*613.0, rows*1.7);
    float dr = floor(headY) - floor(cell.y);
    float L = rows*(0.09+0.15*fract(ch*3.3) + 0.11*(1.0-fk));
    float trail = step(0.0, dr)*exp(-dr*(2.6/L));
    float hd = 1.0 - min(abs(dr), 1.0);
    /* fake glyph: 3x5 random bitmask, mutates a few times a second */
    float cseed = h2(vec2(ci*0.37, floor(cell.y)*0.91 + floor(t*(1.5+fract(ch*5.7)*2.0))*7.0));
    vec2 sub = floor(fract(cell)*vec2(3.0,5.0));
    float bit = step(0.35, h2(vec2(cseed*97.0, sub.y*3.0+sub.x)));
    vec2 gut = fract(cell);
    bit *= step(0.10,gut.x)*step(gut.x,0.90)*step(0.08,gut.y)*step(gut.y,0.88);
    float csel = fract(ch*11.7);
    vec3 gcol = mix(BLUE, CYAN, step(0.45,csel));
    gcol = mix(gcol, PURPLE, step(0.78,csel));
    gcol = mix(gcol, GREEN,  step(0.94,csel));
    rain += (gcol*trail + mix(FG,CYAN,0.3)*hd*1.45) * bit * act * mix(0.30, 1.0, fk);
  }
  col += rain * centerFade * (1.0 - mN*0.35) * (0.62 + 0.45*u_energy + 0.25*u_drive);

  /* ---- event pulse: terminal redraw sweep, top to bottom ---- */
  float sweepY = 1.06 - u_pulseAge*0.85;
  float sw = exp(-abs(uv.y-sweepY)*70.0) * smoothstep(2.2, 0.0, u_pulseAge);
  col += (CYAN*0.7 + FG*0.3) * sw * 0.30;

  /* ---- CRT post: scanlines, vignette, cool edge shift, grain ---- */
  col *= 0.955 + 0.045*sin(gl_FragCoord.y*3.14159);
  vec2 q = uv - 0.5;
  float d2 = dot(q,q)*1.55;
  col *= 1.0 - 0.34*d2;
  col.r *= 1.0 - 0.05*d2;
  col.b *= 1.0 + 0.05*d2;
  col += (h2(gl_FragCoord.xy + vec2(fract(t*0.61)*61.7, fract(t*0.83)*83.1)) - 0.5) * 0.045;

  gl_FragColor = vec4(col, 1.0);
}`,
};
