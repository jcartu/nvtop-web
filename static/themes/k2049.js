(window.NVTHEMES = window.NVTHEMES || {})['k2049'] = {
  id: 'k2049',
  name: 'WALLACE ARCHIVE',
  tag: 'BLADE RUNNER 2049 · LAS VEGAS',
  theme: {
    light: false,
    accent:  '#ff8c2e',
    accent2: '#ffd9a0',
    text:  '#f2e2ce',
    muted: '#c49a72',
    faint: '#7d5f42',
    void:  '#120701',
    panel: 'rgba(24,10,2,0.55)',
    line:  'rgba(255,140,46,0.14)',
    good:  '#7dd87d',
    warn:  '#ffb347',
    crit:  '#ff4d4d',
    info:  '#6fb7c9',
    radius: '10px',
    fonts: {
      display: "'Big Shoulders Display','Big Shoulders',sans-serif",
      head:    "'Archivo Narrow',sans-serif",
      mono:    "'Space Mono',monospace",
    },
    googleFonts: ['Big+Shoulders+Display:wght@700;800', 'Archivo+Narrow:wght@400;600', 'Space+Mono:wght@400;700'],
  },
  login: {
    title: 'WALLACE CORP',
    sub: 'LAPD ARCHIVE TERMINAL · SECTOR 6',
    user: 'SERIAL NUMBER',
    pass: 'BASELINE KEY',
    button: 'RUN BASELINE',
    granted: 'CONSTANT K — YOU CAN PICK UP YOUR BONUS',
    denied: 'NOT EVEN CLOSE TO BASELINE',
    boot: [
      'CELLS .... CELLS',
      'INTERLINKED .... WITHIN CELLS INTERLINKED',
      'DREADFULLY DISTINCT .... AGAINST THE DARK',
      'A TALL WHITE FOUNTAIN PLAYED .... OK',
      'BASELINE READY.',
    ],
    footer: 'a blood-black nothingness began to spin',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1.0,0.0));
  float c = hash21(i+vec2(0.0,1.0)), d = hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + vec2(13.7, 7.1); a *= 0.5; }
  return s;
}

/* ruined-city skyline: per-cell trapezoid slabs with rare monoliths and gaps */
float skyH(float x, float seed, float gap){
  float c = floor(x);
  float h = hash21(vec2(c, seed));
  float H = 0.10 + h*h*0.34;
  H += step(0.90, hash21(vec2(c, seed+7.0)))*0.55;         /* monolith towers */
  float f = fract(x);
  float taper = smoothstep(0.0, 0.10+h*0.25, f)*smoothstep(1.0, 0.90-h*0.25, f);
  H *= mix(0.55, 1.0, taper);                               /* trapezoid shoulders */
  H *= step(gap, hash21(vec2(c, seed+3.0)));                /* gaps between blocks */
  return H;
}

/* one parallax silhouette layer, fading into the amber haze */
void cityLayer(inout vec3 col, vec2 uv, float xs, float par, float hs, float base, float depth, float seed, float gap, vec3 haze, float E){
  float x = uv.x*xs + u_mouse.x*par + seed*17.31;
  float H = skyH(x, seed, gap)*hs;
  float top = base + H;
  float sil = smoothstep(top+0.004, top-0.004, uv.y)*step(0.001, H);
  /* faint dead windows on the nearest layer only */
  float win = 0.0;
  if (depth > 0.8 && H > 0.001){
    vec2 w = fract(vec2(x*7.0, (uv.y-base)*26.0));
    float wl = step(0.35, w.x)*step(w.x, 0.7)*step(0.3, w.y)*step(w.y, 0.65);
    win = wl*step(0.965, hash21(floor(vec2(x*7.0,(uv.y-base)*26.0))+seed))*0.6;
  }
  vec3 silCol = mix(haze*0.85, vec3(0.030,0.011,0.003), depth);
  silCol += vec3(1.0,0.55,0.22)*win*(0.35+E*0.3);
  col = mix(col, silCol, sil*mix(0.55, 0.97, depth));
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  float T = mod(u_time, 1800.0);
  float E = u_energy;
  uv += u_mouse*vec2(0.02, 0.015);   /* gentle whole-frame parallax */

  float horiz = -0.04;
  vec3 amber = vec3(1.0, 0.46, 0.10);          /* #ff7a1a */
  vec3 deep  = vec3(0.055, 0.018, 0.004);      /* #3a1204-ish floor */

  /* ---- thick amber sky: bright haze band at the horizon, dying upward ---- */
  float hglow = exp(-abs(uv.y - horiz)*2.4);
  float upfade = mix(1.0, 0.42, smoothstep(-0.02, 0.55, uv.y));
  vec3 col = deep*1.1 + amber*hglow*(0.50 + E*0.08);
  col += amber*exp(-max(horiz-uv.y, 0.0)*3.2)*0.16;   /* dusty ground bounce below */
  col *= upfade;

  /* ---- layered orange fog, slow drift; energy stirs it ---- */
  float drift = T*(0.012 + E*0.010);
  float fogA = fbm(uv*vec2(1.5, 2.8) + vec2(drift, T*0.004));
  float fogB = fbm(uv*vec2(3.1, 4.6) - vec2(drift*2.2, T*0.007) + 41.7);
  vec3 haze = amber*0.55 + vec3(0.10,0.03,0.0);
  col = mix(col, haze*(0.65+E*0.25), fogA*fogA*0.45);
  col = mix(col, deep*0.8, fogB*fogB*0.40);

  /* ---- pulse: a slow horizontal scan wave sweeping the ruins ---- */
  float sx = -1.0 + u_pulseAge*0.35;
  float wave = exp(-abs(uv.x - sx)*6.0)*exp(-u_pulseAge*0.35);
  col += amber*wave*hglow*0.45;

  /* ---- three parallax skyline layers, far to near ---- */
  cityLayer(col, uv, 6.0, 0.030, 0.60, horiz+0.005, 0.22, 3.0, 0.10, haze, E);
  col = mix(col, haze*0.85, fbm(uv*vec2(2.4,3.6)+vec2(drift*1.5, 9.0))*0.26); /* haze between layers */
  cityLayer(col, uv, 3.3, 0.080, 0.48, horiz-0.030, 0.58, 7.0, 0.22, haze, E);

  /* ---- giant distant hologram: tall glitching column of light ---- */
  float slot = floor(T*0.7);
  float hgate = 0.30 + 0.70*step(0.40 - E*0.30, hash21(vec2(slot, 5.0)));   /* ghost, flares alive */
  hgate *= step(0.06, hash21(vec2(floor(T*6.0), 9.0)));                     /* micro dropouts */
  float hx = uv.x - 0.56 + u_mouse.x*0.05;
  hx += (hash21(vec2(floor(uv.y*22.0), floor(T*7.0)))-0.5)*0.04*hgate;      /* sliced displacement */
  float hcore = exp(-abs(hx)*22.0);
  float hhalo = exp(-abs(hx)*6.0)*0.45;
  float hband = smoothstep(horiz-0.12, horiz+0.02, uv.y)*smoothstep(0.62, 0.12, uv.y);
  float scanl = 0.68 + 0.32*sin(uv.y*130.0 - T*5.0);
  float hflick = 0.65 + 0.35*sin(T*23.0 + sin(T*11.0)*4.0);
  float hseg = 0.55 + 0.45*step(0.25, hash21(vec2(floor((uv.y+7.0)*9.0), slot)));  /* broken segments */
  vec3 holoC = vec3(1.0, 0.34, 0.46);   /* faded showgirl pink against the amber */
  col += holoC*(hcore+hhalo)*hband*hgate*hflick*scanl*hseg*(1.05 + E*0.9);

  /* ---- nearest skyline, almost black, after the hologram so it occludes ---- */
  cityLayer(col, uv, 1.8, 0.160, 0.42, horiz-0.085, 0.93, 11.0, 0.30, haze, E);

  /* ---- god-ray shafts leaning down through the dust ---- */
  float rc = uv.x*1.8 - uv.y*0.85;
  float ray = pow(vnoise(vec2(rc*3.5 + T*0.02, 2.0)), 3.0)
            + pow(vnoise(vec2(rc*7.0 - T*0.015, 6.0)), 4.0)*0.6;
  col += vec3(1.0, 0.62, 0.26)*ray*smoothstep(-0.30, 0.55, uv.y)*0.14;

  /* ---- dust motes drifting up, two depths ---- */
  for (int k = 0; k < 2; k++){
    float s = 22.0 + float(k)*34.0;
    vec2 dp = uv*s - vec2(T*0.14*(0.4+float(k)*0.4), -T*(0.55+float(k)*0.45));
    vec2 g = floor(dp);
    vec2 j = vec2(hash21(g+1.7), hash21(g+4.2))*0.6 + 0.2;
    float m = smoothstep(0.10, 0.02, length(fract(dp)-j));
    m *= step(0.88, hash21(g+float(k)*9.0));
    m *= 0.5 + 0.5*sin(T*2.0 + hash21(g)*40.0);
    col += vec3(1.0, 0.7, 0.4)*m*(0.10 + float(k)*0.08);
  }

  /* ---- grade: center darkest for the dashboard, corners fall away ---- */
  float r = length(uv*vec2(0.9, 1.25));
  col *= mix(0.38, 1.0, smoothstep(0.04, 0.62, r));    /* dark pocket in the middle */
  col *= 1.0 - 0.38*dot(uv, uv);                        /* outer vignette */

  /* heavy film grain */
  col += (hash21(gl_FragCoord.xy + fract(T)*vec2(171.0, 293.0)) - 0.5)*0.045;

  col = 1.0 - exp(-col*(1.25 - E*0.10));
  col = pow(max(col, 0.0), vec3(0.94, 1.0, 1.06));      /* push warmth */
  gl_FragColor = vec4(col, 1.0);
}`,
};
