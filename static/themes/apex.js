(window.NVTHEMES = window.NVTHEMES || {})['apex'] = {
  id: 'apex',
  name: 'APEX TELEMETRY',
  tag: 'F1 PIT WALL · RACE OPS',
  theme: {
    light: false,
    accent:  '#e10600',
    accent2: '#ffffff',
    text:  '#f2f2f5',
    muted: '#9aa0ab',
    faint: '#5c626e',
    void:  '#060608',
    panel: 'rgba(16,16,20,0.6)',
    line:  'rgba(255,255,255,0.1)',
    good:  '#2bd94f',
    warn:  '#ffd24d',
    crit:  '#e10600',
    info:  '#4db8ff',
    radius: '10px',
    fonts: {
      display: "'Titillium Web',sans-serif",
      head:    "'Barlow Condensed',sans-serif",
      mono:    "'B612 Mono',monospace",
    },
    googleFonts: ['Titillium+Web:wght@700;900', 'Barlow+Condensed:wght@500;700', 'B612+Mono:wght@400;700'],
  },
  login: {
    title: 'APEX RACE OPS',
    sub: 'PIT WALL ACCESS · FIA ENCRYPTED',
    user: 'DRIVER NO.',
    pass: 'RADIO KEY',
    button: 'LIGHTS OUT',
    granted: 'AND AWAY WE GO',
    denied: 'BOX BOX BOX — INVALID KEY',
    boot: [
      'TELEMETRY LINK ............ 984 CH LOCKED',
      'TYRE DELTA (MED-SOFT) ..... -0.42s / LAP',
      'ERS DEPLOYMENT MAP ........ OVERTAKE ARMED',
      'DRS ZONES 1-3 ............. ENABLED',
      'RACE CONTROL .............. TRACK GREEN',
    ],
    footer: 'it\'s lights out and away we go',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float noise2(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.,0.)), f.x),
             mix(hash12(i+vec2(0.,1.)), hash12(i+vec2(1.,1.)), f.x), f.y);
}

/* racing line through the frame */
float raceY(float x){ return -0.16 + 0.14*sin(x*2.1 + 0.7) - 0.07*x; }

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  vec2 sv = uv;
  vec2 m = u_mouse;
  float en = clamp(u_energy, 0.0, 1.0);
  float T = mod(u_time, 600.0);
  float pa = max(u_pulseAge, 0.0);
  vec3 f1red = vec3(0.882, 0.024, 0.0);

  /* ---------- carbon fiber twill base ---------- */
  vec2 cw = uv*95.0 + m*6.0;
  cw += vec2(0.5*sin(uv.y*2.0), 0.0);
  vec2 cid = floor(cw);
  vec2 fc = fract(cw);
  float fdir = mod(cid.x + cid.y, 2.0);                 /* 0 = horizontal tow, 1 = vertical */
  float fiber = mix(sin(fc.y*3.1416), sin(fc.x*3.1416), fdir);
  float weave = fiber*fiber*(0.80 + 0.40*hash12(cid));
  vec3 col = vec3(0.016, 0.017, 0.021)*(0.45 + 0.95*weave);
  /* anisotropic sheen band sweeping the weave */
  float sweep = exp(-pow(uv.x + uv.y*0.55 - sin(T*0.13)*0.9, 2.0)*2.6);
  col += vec3(0.045, 0.050, 0.065)*weave*sweep*mix(1.0, 0.45, fdir);
  /* cool overhead floodlight wash */
  col += vec3(0.030, 0.033, 0.041)*smoothstep(0.75, -0.35, abs(uv.y))*0.65;

  /* ---------- ghosted racing-line ribbon with apex markers ---------- */
  float ry = raceY(uv.x) + m.y*0.03;
  float dcv = uv.y - ry;
  float thick = mix(0.0035, 0.0125, smoothstep(-0.95, 0.95, uv.x));  /* perspective: thin far-left */
  float line = exp(-dcv*dcv/(thick*thick*2.0));
  col += f1red*line*(0.30 + 0.15*en);
  col += f1red*exp(-dcv*dcv/(thick*thick*30.0))*0.05;   /* soft under-glow */
  /* apex markers ticking along the line */
  float md = length(vec2((fract(uv.x*1.7 + 0.31) - 0.5)*0.55, dcv*6.0));
  col += vec3(0.95)*exp(-md*md*220.0)*0.30;
  /* ghost car glow lapping the ribbon */
  float lp = fract(T*0.09);
  float gx = mix(-1.05, 1.05, lp);
  vec2 gp = vec2(uv.x - gx, uv.y - (raceY(gx) + m.y*0.03));
  col += vec3(1.0, 0.45, 0.25)*exp(-(gp.x*gp.x*300.0 + gp.y*gp.y*900.0))*0.50;
  col += f1red*exp(-length(gp)*11.0)*0.09;

  /* ---------- car light-trails: 3 depths, rushing left-to-right ---------- */
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    float per = (6.5 - fi*1.6)/(1.0 + 1.4*en);          /* cars pass more often on energy */
    float ph = fract(T/per + fi*0.413);
    float hx = mix(-1.7, 1.7, ph);
    float ty = (fi < 0.5 ? 0.34 : (fi < 1.5 ? -0.305 : 0.10)) + 0.05*sin(uv.x*1.6 + fi*2.1);
    float dx = uv.x - hx;
    float dy = uv.y - ty - m.y*(0.02 + 0.01*fi);
    float w = mix(0.026, 0.011, fi*0.5);                /* nearer trails fatter */
    float gy = exp(-dy*dy/(w*w));
    float tail = dx < 0.0 ? exp(dx*(2.5 - 1.1*en)) : exp(-dx*80.0);
    float u = clamp(-dx*1.2, 0.0, 1.0);
    vec3 tc = mix(vec3(1.15, 1.10, 1.00), vec3(1.0, 0.42, 0.10), smoothstep(0.0, 0.40, u));
    tc = mix(tc, f1red*1.1, smoothstep(0.35, 1.0, u));
    float amp = (0.60 + 0.50*en)*(1.0 - 0.28*fi);
    col += tc*tail*gy*amp;
    /* headlight head: motion-smeared core + bloom + lens streak */
    if(abs(hx) < 1.45){
      col += vec3(1.0, 0.97, 0.90)*exp(-(dx*dx*420.0 + dy*dy*3800.0))*1.05;
      col += vec3(1.0, 0.55, 0.28)*exp(-length(vec2(dx, dy*2.0))*30.0)*0.20;
      col += vec3(0.9, 0.9, 1.0)*exp(-dy*dy*6000.0)*exp(-abs(dx)*9.0)*0.28;
    }
  }

  /* ---------- drifting telemetry glyphs: throttle/brake bar clusters ---------- */
  vec2 g = uv*5.5 + vec2(T*0.035, 0.0) + m*0.4;
  vec2 gid = floor(g); vec2 gf = fract(g) - 0.5;
  float sel = hash12(gid + 4.7);
  float glyph = 0.0;
  if(sel > 0.74){
    float bi = floor((gf.x + 0.30)/0.13);
    if(bi >= 0.0 && bi < 5.0){
      float bx = fract((gf.x + 0.30)/0.13);
      float hh = 0.06 + 0.24*hash12(gid + bi*7.0)
               *(0.55 + 0.45*sin(T*(1.2 + hash12(gid + bi)*1.5) + bi*1.7));
      glyph = step(bx, 0.52)*step(-0.20, gf.y)*step(gf.y, -0.20 + hh);
    }
    /* sector-time tick row above the bars */
    float tick = step(0.13, gf.y)*step(gf.y, 0.155)*step(0.6, fract(gf.x*9.0));
    glyph += tick*0.7;
  }
  col += mix(vec3(0.30, 0.72, 1.0), vec3(1.0), hash12(gid))*glyph*(0.045 + 0.03*en);

  /* ---------- DRS-zone flash band, ~every 9s ---------- */
  float dcyc = mod(T, 9.0);
  float denv = smoothstep(0.0, 0.35, dcyc)*smoothstep(1.5, 0.75, dcyc);
  float bandx = mix(-1.3, 1.3, clamp(dcyc/1.5, 0.0, 1.0));
  col += vec3(0.18, 0.85, 0.42)*exp(-pow((uv.x - bandx)*3.6, 2.0))*denv*0.09;

  /* ---------- pulse: start-lights sequence then green sweep ---------- */
  if(pa < 4.0){
    float seq = step(pa, 2.15);
    for(int i = 0; i < 5; i++){
      float fi = float(i);
      vec2 dp = uv - vec2((fi - 2.0)*0.085, 0.355);
      float dd = dot(dp, dp);
      float on = step(0.20 + fi*0.34, pa)*seq;
      col += f1red*1.25*on*(exp(-dd*2600.0)*1.1 + exp(-sqrt(dd)*17.0)*0.28);
      col += vec3(0.10, 0.10, 0.12)*exp(-dd*2600.0)*seq*0.8;   /* dark housings */
    }
    float gs = (pa - 2.15)/0.9;
    if(gs > 0.0 && gs < 1.3){
      float gxs = mix(-1.5, 1.5, gs);
      col += vec3(0.15, 0.95, 0.35)*exp(-pow((uv.x - gxs)*3.0, 2.0))*0.32*max(1.2 - gs, 0.0);
    }
  }

  /* kerb stripes ghosted along the bottom edge */
  float kmask = smoothstep(-0.40, -0.55, uv.y);
  float kst = step(0.5, fract((uv.x - uv.y*0.8 + T*0.05)*3.2));
  col += mix(f1red, vec3(0.85), kst)*kmask*0.055;
  /* cold stadium-light haze along the top */
  col += vec3(0.05, 0.07, 0.11)*smoothstep(0.28, 0.55, uv.y)*(0.55 + 0.25*noise2(vec2(uv.x*3.0 + T*0.06, 7.0)));

  /* faint red pit-wall underglow at frame edges on energy */
  col += f1red*smoothstep(0.55, 1.05, abs(sv.x)*1.15 + abs(sv.y)*0.4)*(0.02 + 0.06*en);

  /* ---------- grade ---------- */
  col *= 1.0 - 0.42*dot(sv, sv);
  col = 1.0 - exp(-col*1.6);
  col = pow(col, vec3(0.94));
  col += (hash12(frag + fract(T)*417.0) - 0.5)*0.016;
  gl_FragColor = vec4(col, 1.0);
}`,
};
