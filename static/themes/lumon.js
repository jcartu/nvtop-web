(window.NVTHEMES = window.NVTHEMES || {})['lumon'] = {
  id: 'lumon',
  name: 'MACRODATA',
  tag: 'LUMON INDUSTRIES · SEVERED FLOOR',
  theme: {
    light: false,
    accent: '#9ce0e8',
    accent2: '#e6f4f1',
    text: '#dcecf0',
    muted: '#8bb4c4',
    faint: '#4c6e82',
    void: '#061424',
    panel: 'rgba(8,24,40,0.6)',
    line: 'rgba(156,224,232,0.16)',
    good: '#7dd8a8',
    warn: '#ffcf7d',
    crit: '#ff7d7d',
    info: '#9ce0e8',
    radius: '6px',
    fonts: {
      display: "'IBM Plex Mono',monospace",
      head: "'IBM Plex Sans',sans-serif",
      mono: "'IBM Plex Mono',monospace",
    },
    googleFonts: ['IBM+Plex+Mono:wght@400;500;600;700', 'IBM+Plex+Sans:wght@400;600'],
  },
  login: {
    title: 'LUMON',
    sub: 'SEVERED FLOOR TERMINAL · MDR DIVISION',
    user: 'INNIE DESIGNATION',
    pass: 'CODE DETECTOR BYPASS',
    button: 'REFINE',
    granted: 'PRAISE KIER — 100% QUOTA',
    denied: 'PLEASE REPORT TO THE BREAK ROOM',
    boot: [
      'WO  WOE ............ CONTAINED',
      'FC  FROLIC ......... CALIBRATED',
      'DR  DREAD .......... SUPPRESSED',
      'MA  MALICE ......... BINNED',
      'MACRODATA FILE: SIENA — 04% REFINED',
    ],
    footer: 'the work is mysterious and important',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

/* rounded segment bar */
float bar(vec2 p, vec2 b){
  vec2 d = abs(p) - b;
  float dd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return smoothstep(0.030, 0.006, dd);
}
/* 7-segment bit table, segs A..G = bits 0..6 */
float segMask(float d){
  if(d < 0.5) return 63.0;
  if(d < 1.5) return 6.0;
  if(d < 2.5) return 91.0;
  if(d < 3.5) return 79.0;
  if(d < 4.5) return 102.0;
  if(d < 5.5) return 109.0;
  if(d < 6.5) return 125.0;
  if(d < 7.5) return 7.0;
  if(d < 8.5) return 127.0;
  return 111.0;
}
float bit(float m, float i){ return mod(floor(m/exp2(i)), 2.0); }
float digit(vec2 p, float d){
  float m = segMask(d);
  float v = 0.0;
  v += bit(m, 0.)*bar(p - vec2(0.0,  0.30), vec2(0.10, 0.015));
  v += bit(m, 1.)*bar(p - vec2(0.15, 0.15), vec2(0.015, 0.10));
  v += bit(m, 2.)*bar(p - vec2(0.15,-0.15), vec2(0.015, 0.10));
  v += bit(m, 3.)*bar(p - vec2(0.0, -0.30), vec2(0.10, 0.015));
  v += bit(m, 4.)*bar(p - vec2(-0.15,-0.15), vec2(0.015, 0.10));
  v += bit(m, 5.)*bar(p - vec2(-0.15, 0.15), vec2(0.015, 0.10));
  v += bit(m, 6.)*bar(p, vec2(0.10, 0.015));
  return min(v, 1.0);
}

/* one plane of bobbing digits; cc/rad = scary cluster, wig/fade = event envelopes */
float field(vec2 uv, float asp, float G, float t, float e, vec2 cc, float rad, float wig, float fade){
  vec2 gsz = vec2(floor(G*asp + 0.5), G);
  vec2 cid = floor(uv*gsz);
  vec2 f = fract(uv*gsz) - 0.5;
  float hc = h21(cid + 0.7);
  /* sparse in the dead center */
  vec2 cellUV = (cid + 0.5)/gsz;
  float cdist = length((cellUV - 0.5)*vec2(asp, 1.0));
  float dens = mix(0.78, 0.38, smoothstep(0.18, 0.55, cdist));
  /* scary membership: event cluster + energy strays */
  float mem = smoothstep(rad, rad*0.5, length((cellUV - cc)*vec2(asp, 1.0)));
  dens -= mem*0.45;              /* the haunted patch is always well populated */
  if(hc < dens) return 0.0;
  float stray = step(1.0 - e*0.30, h21(cid + 4.4));
  float sc = clamp(mem*wig + stray*e*0.8, 0.0, 1.0);
  /* gentle bob, unique phase per digit */
  float w1 = 0.45 + h21(cid + 2.9)*0.9;
  vec2 bob = 0.085*vec2(sin(t*w1 + hc*41.0), cos(t*w1*0.77 + hc*17.0));
  /* frantic jitter when scary */
  vec2 jit = (vec2(h21(cid + floor(t*24.0)), h21(cid + floor(t*24.0) + 9.0)) - 0.5)*0.18*sc;
  float scl = (0.52 + 0.42*h21(cid + 2.2))*(1.0 - 0.6*fade*mem);
  vec2 p = (f - bob - jit)/max(scl, 0.05);
  float dv = floor(h21(cid + floor(t*0.06 + hc*9.0))*10.0);
  float dgt = digit(p, dv);
  float bright = 0.45 + 0.55*h21(cid + 8.8);
  bright *= 1.0 + 0.22*sin(t*(0.8 + hc) + hc*23.0);
  bright *= 1.0 + sc*1.1;
  bright *= 1.0 - fade*mem;          /* cluster binned: fades out */
  return dgt*bright;
}

void main(){
  float t = mod(u_time, 600.0);
  float asp = u_res.x/u_res.y;
  vec2 uv = gl_FragCoord.xy/u_res;
  vec2 m = u_mouse;
  float e = clamp(u_energy, 0.0, 1.0);

  /* subtle CRT curvature */
  vec2 cc0 = uv - 0.5;
  float r2 = dot(cc0, cc0);
  vec2 suv = 0.5 + cc0*(1.0 + 0.055*r2);

  /* ---- scary-cluster event: every ~11s, or immediately on pulse ---- */
  float ev = floor(t/11.0);
  float ph = t - ev*11.0;
  float pa = min(u_pulseAge, 1000.0);
  float usePulse = step(pa, ph);
  ph = mix(ph, pa, usePulse);
  ev += usePulse*37.0;
  float wig  = smoothstep(0.0, 1.2, ph)*smoothstep(6.2, 4.2, ph);
  float boxE = smoothstep(1.1, 1.7, ph)*smoothstep(6.4, 5.2, ph);
  float fade = smoothstep(3.8, 5.8, ph)*(1.0 - smoothstep(6.4, 7.0, ph)*0.0);
  fade *= step(ph, 8.0);
  vec2 dirc = vec2(h21(vec2(ev, 1.3)), h21(vec2(ev, 4.7))) - 0.5;
  vec2 ccen = clamp(vec2(0.5) + sign(dirc)*(vec2(0.14, 0.10) + abs(dirc)*vec2(0.40, 0.34)), vec2(0.17, 0.24), vec2(0.83, 0.78));
  float rad = 0.13;

  /* ---- deep navy field with faint drifting murk ---- */
  vec3 col = mix(vec3(0.011, 0.042, 0.082), vec3(0.024, 0.068, 0.124), suv.y + 0.15*vnoise(suv*2.4 + t*0.02));
  col += vec3(0.0, 0.020, 0.034)*vnoise(suv*vec2(5.0, 3.6) - vec2(t*0.014, t*0.01));
  col *= 1.0 - 0.30*r2;

  /* ---- digit planes: dim far layer for depth, crisp near layer ---- */
  float far  = field(suv + vec2(0.021, 0.013) + m*vec2(0.007, -0.005), asp, 13.0, t*0.7 + 53.0, e, ccen, rad, wig*0.4, fade*0.5);
  float near = field(suv + m*vec2(0.019, -0.013), asp, 7.5, t, e, ccen, rad, wig, fade);

  vec3 teal  = vec3(0.612, 0.878, 0.910);
  vec3 white = vec3(0.902, 0.957, 0.945);
  col += teal*far*0.34;
  col += teal*near*0.80 + white*near*near*0.40;

  /* ---- selection rectangle drawn around the scary cluster ---- */
  vec2 dq = abs((suv - ccen)*vec2(asp, 1.0)) - vec2(rad*1.25 + 0.015, rad*0.95 + 0.015);
  float rd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
  float box = smoothstep(0.0032, 0.0008, abs(rd))*boxE*(0.60 + 0.40*sin(t*12.0));
  col += teal*box*0.9 + white*box*0.25;

  /* ---- MDR chrome: double rule up top, rule + five bins below ---- */
  float chrome = smoothstep(0.0016, 0.0004, abs(suv.y - 0.935))
               + smoothstep(0.0016, 0.0004, abs(suv.y - 0.925))
               + smoothstep(0.0016, 0.0004, abs(suv.y - 0.115));
  chrome *= step(0.02, suv.x)*step(suv.x, 0.98);
  col += teal*chrome*0.22;
  float binTarget = floor(h21(vec2(ev, 8.1))*5.0);
  for(int i = 0; i < 5; i++){
    float fi = float(i);
    vec2 bcn = vec2(0.5 + (fi - 2.0)*0.155, 0.062);
    vec2 bq = abs((suv - bcn)*vec2(asp, 1.0)) - vec2(0.048, 0.020);
    float brd = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0);
    float bbox = smoothstep(0.0028, 0.0008, abs(brd));
    /* fill bar creeps up as this bin's quota refines */
    float fill = fract(h11(fi + 3.7) + t*0.004*(0.6 + h11(fi + 6.1)));
    vec2 fq = (suv - bcn)*vec2(asp, 1.0);
    float fbar = step(abs(fq.x), 0.043)*step(-0.016, fq.y)*step(fq.y, -0.016 + fill*0.030);
    /* the target bin lights up while the scary cluster gets binned */
    float flash = step(abs(fi - binTarget), 0.1)*fade*(0.5 + 0.5*sin(t*14.0));
    col += teal*(bbox*(0.30 + flash*0.8) + fbar*(0.12 + flash*0.35));
  }

  /* pulse: soft ring washes across the floor */
  float ring = exp(-abs(length((suv - 0.5)*vec2(asp, 1.0)) - pa*0.5)*14.0)*exp(-pa*0.8);
  col += teal*ring*0.12;

  /* scanlines + slow refresh band */
  col *= 0.90 + 0.10*sin(suv.y*640.0);
  col *= 1.0 - 0.05*exp(-pow(fract(suv.y - t*0.03) - 0.5, 2.0)*30.0);

  /* glass reflection sheen up top, drifts with the viewer */
  vec2 gu = uv - m*0.10;
  float sh = pow(max(0.0, 1.0 - abs(gu.y - 0.90 + gu.x*0.12)*3.4), 2.0);
  sh += pow(max(0.0, 1.0 - length((gu - vec2(0.22, 0.93))*vec2(1.3, 2.6))), 2.0)*0.6;
  col += vec3(0.75, 0.86, 0.94)*sh*0.030;

  /* vignette, grain */
  col *= clamp(1.05 - r2*0.9, 0.0, 1.0);
  col = 1.0 - exp(-col*1.55);
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))*43758.5453 + fract(u_time)) - 0.5)*0.018;
  gl_FragColor = vec4(col, 1.0);
}`,
};
