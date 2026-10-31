(window.NVTHEMES = window.NVTHEMES || {})['muthur'] = {
  id: 'muthur',
  name: 'MU/TH/UR 6000',
  tag: 'USCSS NOSTROMO · WEYLAND-YUTANI',
  theme: {
    light: false,
    accent: '#48ff7a',
    accent2: '#b8ffcf',
    text: '#d6ffe4',
    muted: '#7fc99a',
    faint: '#3f7a55',
    void: '#010603',
    panel: 'rgba(1,14,6,0.62)',
    line: 'rgba(72,255,122,0.16)',
    good: '#48ff7a',
    warn: '#ffd24d',
    crit: '#ff5c5c',
    info: '#6ee7c8',
    radius: '0px',
    fonts: {
      display: "'VT323',monospace",
      head: "'Share Tech Mono',monospace",
      mono: "'VT323',monospace",
    },
    googleFonts: ['VT323', 'Share+Tech+Mono'],
  },
  login: {
    title: 'MU/TH/UR 6000',
    sub: 'USCSS NOSTROMO · SCIENCE OFFICER EYES ONLY',
    user: 'CREW ID',
    pass: 'OVERRIDE CODE',
    button: 'INTERFACE 2037',
    granted: 'GOOD MORNING. HOW ARE YOU FEELING TODAY?',
    denied: 'UNABLE TO CLARIFY — SPECIAL ORDER 937',
    boot: [
      'LIFE SUPPORT ............... NOMINAL',
      'HYPERSLEEP CAPSULES 1-7 .... REVIVED',
      'SELF-DESTRUCT SYSTEM ....... DISARMED',
      'INTERFACE 2037 READY FOR INQUIRY',
    ],
    footer: 'crew expendable · building better worlds',
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

/* procedural dot-matrix character: p cell-local 0..1, id picks pattern */
float glyph(vec2 p, float id, float soft){
  vec2 q = (p - vec2(0.16, 0.13)) / vec2(0.68, 0.70);
  float inside = step(0.0, q.x)*step(q.x, 0.999)*step(0.0, q.y)*step(q.y, 0.999);
  q = clamp(q, 0.0, 0.999);
  vec2 ip = floor(q*vec2(4.0, 6.0));
  vec2 fp = fract(q*vec2(4.0, 6.0)) - 0.5;
  float on = step(0.43, h21(ip + vec2(id*3.71, id*7.13)));
  on = max(on, step(0.94, h21(vec2(ip.y + id, 4.2))));
  float d = max(abs(fp.x), abs(fp.y)*0.92);
  return inside*on*smoothstep(0.5, 0.5 - soft, d);
}

/* one plane of terminal panes dumping log lines; wipeY refreshes content */
float logText(vec2 sv, float asp, float S, float t, float cyc, float wipeY, float e){
  float cx = sv.x*asp*S;
  float cy = sv.y*S/1.9;
  float col = floor(cx);
  float row0 = floor(cy);
  vec2 zone = vec2(floor(col/20.0), floor(row0/8.0));   /* pane grid snapped to char cells */
  float zh = h21(zone*3.7 + 1.1);
  float zg = step(0.20, h21(zone + 0.13));              /* some panes dark */
  float rate = 0.45 + zh*1.7 + e*2.4;                   /* activity bursts on energy */
  float scroll = floor(t*rate + zh*33.0);
  float row = row0 + scroll;
  float seed = cyc - 1.0 + step(wipeY, sv.y);           /* refreshed above the wipe line */
  vec2 rk = vec2(row, zone.x*9.0 + zone.y*5.0) + seed*0.618;
  float blank = step(0.26, h21(rk + 2.3));              /* empty lines */
  float left = zone.x*20.0 + 1.0 + floor(h21(rk + 5.1)*5.0);
  float len = 4.0 + h21(rk + 7.7)*14.0;
  float on = step(left, col)*step(col, left + len)*blank;
  on *= step(0.15, h21(vec2(col, row) + seed*0.31));    /* word gaps */
  float ciz = cx - zone.x*20.0;
  on *= step(0.6, ciz)*step(ciz, 19.4);                 /* pane margins */
  float gid = floor(h21(vec2(col, row)*0.73 + seed*13.0)*64.0);
  float g = glyph(vec2(fract(cx), fract(cy)), gid, 0.17);
  float hdr = step(0.93, h21(rk + 9.9));                /* bright header lines */
  float zb = 0.5 + 0.5*h21(zone + 7.7);                 /* per-pane phosphor wear */
  zb *= 0.75 + 0.25*sin(t*(0.10 + zh*0.3) + zh*31.0);   /* panes breathe slowly */
  return zg*on*g*zb*(0.75 + hdr*1.0);
}

void main(){
  float t = mod(u_time, 480.0);
  float asp = u_res.x/u_res.y;
  vec2 uv = gl_FragCoord.xy/u_res;
  vec2 m = u_mouse;
  float e = clamp(u_energy, 0.0, 1.0);

  /* barrel distortion of the tube face */
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  vec2 suv = 0.5 + cc*(1.0 + 0.14*r2 + 0.10*r2*r2);

  /* raster shift from viewer (mouse) + faint sync jitter */
  vec2 sv = suv + m*vec2(0.024, -0.018);
  sv.x += (h11(floor(t*43.0)) - 0.5)*0.0009;

  /* full-screen refresh wipe every 8s: bright line sweeps down, text renews */
  float cyc = floor(t/8.0);
  float ph = t - cyc*8.0;
  float wipeY = 1.05 - ph/1.1;
  float wActive = step(-0.15, wipeY);

  /* radar geometry first so text can clear the dish */
  vec2 q = vec2((sv.x - 0.5)*asp, sv.y - 0.5);
  vec2 rp = vec2(asp*0.5 - 0.26, -0.235);
  vec2 dr = q - rp;
  float r = length(dr);
  float R = 0.185;
  float disc = smoothstep(R, R - 0.006, r);

  /* character field dimmer at center so the dashboard reads */
  float gain = mix(0.16, 1.0, smoothstep(0.13, 0.46, length(vec2((sv.x - 0.5)*asp*0.8, sv.y - 0.5))));
  gain *= 1.0 - disc*0.92;   /* dish is its own instrument, not a text pane */

  float I = 0.0;
  I += logText(sv, asp, 45.6, t, cyc, wipeY, e)*gain;
  I += logText(sv + vec2(0.017, 0.009) + m*vec2(0.011, -0.006), asp, 78.0, t*0.8 + 217.0, cyc, wipeY, e)*0.30*gain;

  /* fresh phosphor glows just behind the wipe line, then settles */
  float ag = exp(-(sv.y - wipeY)*7.0)*step(wipeY, sv.y)*wActive;
  I *= 1.0 + ag*1.1;
  I += exp(-abs(sv.y - wipeY)*120.0)*0.9*wActive;

  /* ---- corner radar: rings, ticks, crosshair, rotating sweep, blips ---- */
  float rings = smoothstep(0.005, 0.001, abs(r - R))
              + 0.55*smoothstep(0.004, 0.0008, abs(r - R*0.66))
              + 0.55*smoothstep(0.004, 0.0008, abs(r - R*0.33));
  float cross = (smoothstep(0.0026, 0.0006, abs(dr.x)) + smoothstep(0.0026, 0.0006, abs(dr.y)))*disc*0.35;
  float ang = atan(dr.y, dr.x);
  float ticks = step(0.86, fract(ang/6.28318*24.0))*smoothstep(0.018, 0.008, abs(r - R*0.93))*disc*0.7;
  float swA = -t*(0.85 + e*1.3);
  float beam = exp(-mod(ang - swA, 6.28318)*1.9)*disc;
  float radar = beam*1.25 + rings*0.8 + cross + ticks + disc*0.035;
  for(int i = 0; i < 4; i++){
    float fi = float(i);
    float ba = h11(fi + 3.0)*6.28318 + t*0.05*(h11(fi + 8.0) - 0.5);
    float br = (0.25 + 0.62*h11(fi + 11.0))*R;
    vec2 bp = rp + br*vec2(cos(ba), sin(ba));
    float bb = exp(-mod(ba - swA, 6.28318)*1.1);
    radar += exp(-dot(q - bp, q - bp)*9000.0)*bb*1.7;
  }

  /* proximity alert: radial blip expanding out of the radar on pulse */
  float pa = min(u_pulseAge, 40.0);
  float pring = exp(-abs(r - pa*0.55)*22.0)*exp(-pa*0.9)*1.8;
  radar += pring;
  radar += disc*exp(-pa*1.4)*0.5*step(0.5, fract(t*4.0));   /* alert blink */
  radar += exp(-max(r - R, 0.0)*14.0)*(1.0 - disc)*0.06;    /* phosphor halo off the dish */
  I += radar;

  /* slow phosphor haze pooling behind everything */
  I += vnoise(sv*vec2(3.0, 2.1) + vec2(t*0.04, -t*0.02))*vnoise(sv*vec2(6.0, 4.6) - vec2(t*0.02, t*0.03))*0.05;
  I += 0.016;
  I *= 1.0 + e*0.35;

  vec3 green = vec3(0.282, 1.0, 0.478);
  vec3 mint  = vec3(0.72, 1.0, 0.81);
  vec3 col = green*I + mint*I*I*0.55;

  /* scanlines, slow roll band, vignette, tube flicker */
  col *= 0.78 + 0.22*sin(suv.y*700.0);
  col *= 1.0 - 0.09*exp(-pow(fract(suv.y - t*0.045) - 0.5, 2.0)*26.0);
  col *= clamp(1.06 - r2*1.15, 0.0, 1.0);
  col *= 0.95 + 0.05*h11(floor(t*27.0));

  /* soft dark bezel just outside the distorted face */
  vec2 ov = max(abs(suv - 0.5) - vec2(0.485), 0.0);
  col *= smoothstep(0.030, 0.0, length(ov));

  col = 1.0 - exp(-col*1.7);
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))*43758.5453 + fract(u_time)) - 0.5)*0.02;
  gl_FragColor = vec4(col, 1.0);
}`,
};
