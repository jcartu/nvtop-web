(window.NVTHEMES = window.NVTHEMES || {})['construct'] = {
  id: 'construct',
  name: 'THE CONSTRUCT',
  tag: 'MATRIX · DIGITAL RAIN',
  theme: {
    light: false,
    accent: '#39ff6e',
    accent2: '#b6ffc9',
    text: '#d8ffe2',
    muted: '#7fbf93',
    faint: '#3f6b4d',
    void: '#010401',
    panel: 'rgba(2,12,4,0.6)',
    line: 'rgba(57,255,110,0.22)',
    good: '#66ff99',
    warn: '#ffd24d',
    crit: '#ff4d4d',
    info: '#4dd8a8',
    radius: '8px',
    fonts: {
      display: "'Doto',monospace",
      head: "'Space Grotesk',sans-serif",
      mono: "'Kode Mono',monospace",
    },
    googleFonts: ['Doto:wght@700;900', 'Space+Grotesk:wght@400;600', 'Kode+Mono:wght@400;700'],
  },
  login: {
    title: 'ZION MAINFRAME',
    sub: 'NEBUCHADNEZZAR UPLINK',
    user: 'OPERATOR',
    pass: 'PASSPHRASE',
    button: 'JACK IN',
    granted: 'WELCOME BACK, NEO',
    denied: 'ACCESS DENIED — TRACE INITIATED',
    boot: [
      'Wake up, Neo…',
      'The Matrix has you.',
      'Follow the white rabbit.',
      'Broadcast depth: 21 levels … LOCKED',
      'Knock, knock.',
    ],
    footer: 'there is no spoon',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float h1(float n){ return fract(sin(n*127.1)*43758.5453123); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float vno(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1.0,0.0)), f.x), mix(h2(i+vec2(0.0,1.0)), h2(i+vec2(1.0,1.0)), f.x), f.y);
}

/* pseudo-glyph: 5x7 dot-matrix; anisotropic correlated noise thresholded into
   contiguous strokes so cells read as characters, not static. q in [0,1]^2 */
float glyph(vec2 q, float s, float soft){
  vec2 g = (q - vec2(0.17, 0.11)) / vec2(0.66, 0.78);
  if (g.x < 0.0 || g.x >= 1.0 || g.y < 0.0 || g.y >= 1.0) return 0.0;
  vec2 c = floor(g*vec2(5.0, 7.0));
  float seed = floor(s*713.0);
  float v = vno(c*vec2(0.95, 0.55) + seed*vec2(3.71, 7.13));
  float n = h2(c + seed);
  float bit = step(0.52, v*0.74 + n*0.26);
  /* occasional forced spine stroke keeps glyphs from going empty */
  bit = max(bit, step(0.72, h1(seed + 11.0)) * step(abs(c.x - 2.0), 0.5) * step(0.35, h2(c + seed*1.7)));
  vec2 f = fract(g*vec2(5.0, 7.0));
  float px = smoothstep(0.46, 0.24 - soft, abs(f.x - 0.5))
           * smoothstep(0.49, 0.26 - soft, abs(f.y - 0.5));
  return bit * px;
}

/* one depth layer of rain columns */
vec3 rain(vec2 uv, float scale, float bright, float soft, float lseed, float Tm, float t){
  vec3 GRN = vec3(0.224, 1.0, 0.431);   /* #39ff6e */
  vec3 PAL = vec3(0.714, 1.0, 0.788);   /* #b6ffc9 */
  vec2 p = uv*scale;
  p.x += lseed*13.7;
  float ci = floor(p.x);
  float hc = h1(ci*7.31 + lseed*29.0);
  /* readability: fewer columns near the dead center */
  float colx = (ci + 0.5 - lseed*13.7)/scale;
  float thr = 0.14 + 0.30*smoothstep(0.42, 0.04, abs(colx));
  if (hc < thr) return vec3(0.0);
  float spd = 2.0 + 5.5*h1(ci*3.77 + lseed);
  float S = 26.0 + floor(22.0*h1(ci*5.13 + lseed));
  float headRow = floor(-Tm*spd + hc*97.0);
  float r = floor(p.y);
  float d = mod(r - headRow, S);            /* cells above the falling head */
  float TL = 10.0 + 16.0*h1(ci*9.19 + lseed);
  float I = exp(-d*1.9/TL) * (1.0 - smoothstep(TL*1.3, TL*1.9, d));
  if (I < 0.004) return vec3(0.0);
  /* glyph seed + mutation flicker inside the trail */
  float base = h2(vec2(ci, r));
  float mrate = 0.4 + 2.4*h2(vec2(ci, r) + 4.7);
  float mt = floor(t*mrate);
  float mut = step(0.80, h2(vec2(ci, r) + mt*0.731));
  float s = base + mut*(0.13 + 0.51*h1(mt + ci));
  float isHead = step(d, 0.5);
  s += isHead*floor(t*9.0)*0.037;           /* head glyph cycles fast */
  float gph = glyph(fract(p), s, soft);
  float amp = mix(I, 2.3, isHead);
  vec3 c = mix(GRN, PAL, I*I*0.30);
  c = mix(c, vec3(0.90, 1.0, 0.94), isHead*0.85);
  float flick = 0.78 + 0.22*h2(vec2(ci, r) + floor(t*13.0));
  /* soft radial dimming toward the very center (panels live there) */
  float cdim = mix(0.55, 1.0, smoothstep(0.04, 0.28, length(vec2(colx, uv.y*0.6))));
  /* phosphor halo trailing the head, independent of the glyph mask */
  float xf = fract(p.x) - 0.5;
  float halo = exp(-d*d*0.22) * exp(-xf*xf*7.0) * 0.28;
  vec3 hc2 = mix(GRN, PAL, exp(-d*0.6));
  return (c * gph * amp + hc2 * halo) * bright * flick * cdim;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float t = mod(u_time, 3600.0);
  float e = clamp(u_energy, 0.0, 1.0);
  float Tm = t*(1.0 + 0.85*e);              /* surge: the code pours faster */
  vec2 M = u_mouse;
  vec3 GRN = vec3(0.224, 1.0, 0.431);

  vec3 col = vec3(0.004, 0.026, 0.010);
  /* subtle drifting green fog, thicker off-center */
  float fogN = vno(uv*2.6 + vec2(t*0.02, -t*0.035)) * vno(uv*5.2 - vec2(t*0.013, t*0.02));
  col += GRN * fogN * 0.10 * (0.50 + 0.50*smoothstep(0.15, 0.75, length(uv)));

  /* three depth layers: far = small, dim, soft; near = large, sharp, bright */
  vec3 rf = rain(uv + M*0.012, 44.0, 0.60, 0.16, 3.0, Tm*0.52 + 7.0, t);
  vec3 rm = rain(uv + M*0.032, 27.0, 1.10, 0.06, 2.0, Tm*0.74 + 3.0, t);
  vec3 rn = rain(uv + M*0.065, 16.0, 1.70, 0.00, 1.0, Tm, t);
  vec3 code = rf*vec3(0.45, 0.80, 0.58) + rm*vec3(0.72, 0.94, 0.80) + rn;

  /* "wake up" scan pulse sweeping down on events */
  float scanB = 0.0, scanL = 0.0;
  if (u_pulseAge < 3.5){
    float syn = 0.60 - u_pulseAge*0.52;
    float dS = uv.y - syn;
    float env = exp(-u_pulseAge*0.8);
    scanB = exp(-dS*dS*420.0)*env;
    scanL = exp(-dS*dS*26000.0)*env;
  }
  col += code * (1.0 + 0.45*e + 2.6*scanB);
  col += GRN * (scanB*0.05 + scanL*0.28);
  col += vec3(0.85, 1.0, 0.92) * scanL * 0.10;

  /* phosphor scanlines + vignette + grain + tone */
  col *= 0.955 + 0.045*sin(frag.y*3.14159);
  vec2 vp = frag/u_res - 0.5;
  col *= 1.0 - dot(vp, vp)*0.80;
  col = 1.0 - exp(-col*1.35);
  col += (h2(frag*0.6 + fract(t)*17.0) - 0.5)*0.02;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`,
};
