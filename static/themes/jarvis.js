(window.NVTHEMES = window.NVTHEMES || {})['jarvis'] = {
  id: 'jarvis',
  name: 'STARK HUD',
  tag: 'J.A.R.V.I.S. · MARK VII',
  theme: {
    light: false,
    accent:  '#57c8ff',
    accent2: '#ffc96b',
    text:  '#dcecf7',
    muted: '#8fb2c9',
    faint: '#54718a',
    void:  '#030811',
    panel: 'rgba(8,20,38,0.55)',
    line:  'rgba(87,200,255,0.20)',
    good:  '#4de6a8',
    warn:  '#ffc96b',
    crit:  '#ff5a5a',
    info:  '#8fa8ff',
    radius: '16px',
    fonts: {
      display: "'Exo 2',sans-serif",
      head:    "'Titillium Web',sans-serif",
      mono:    "'Fira Code',monospace",
    },
    googleFonts: ['Exo+2:wght@700;800', 'Titillium+Web:wght@400;600;700', 'Fira+Code:wght@400;600'],
  },
  login: {
    title: 'STARK INDUSTRIES',
    sub: 'J.A.R.V.I.S. SECURE TERMINAL',
    user: 'PRINCIPAL',
    pass: 'ENCRYPTION KEY',
    button: 'INITIALIZE',
    granted: 'GOOD EVENING, SIR',
    denied: 'I\'M AFRAID I CAN\'T DO THAT',
    boot: [
      'ARC REACTOR .... OUTPUT 100% · STABLE',
      'MARK VII DIAGNOSTICS .... ALL SYSTEMS GREEN',
      'FLIGHT SYSTEMS .... CALIBRATED',
      'PROTOCOL "HOUSE PARTY" .... ON STANDBY',
      'AT YOUR SERVICE, SIR.',
    ],
    footer: 'stark industries © 2026 · all systems nominal',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
uniform float u_drive;   /* smoothed cluster GPU util 0..1 — spins the machinery, summons the storm */
uniform float u_spin;    /* integrated rotation phase from the runner — speed ramps never jump */
uniform float u_heat;    /* hottest GPU 0..1 — recolors the reactor cores blue→yellow→orange→red */
#define TAU 6.2831853

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h12(i),h12(i+vec2(1.0,0.0)),f.x), mix(h12(i+vec2(0.0,1.0)),h12(i+vec2(1.0,1.0)),f.x), f.y);
}
float fbm(vec2 p){
  float s=0.0, a=0.5; mat2 m = rot(0.71)*2.02;
  for(int i=0;i<4;i++){ s += a*vn(p); p = m*p + 9.2; a *= 0.5; }
  return s;
}
float hexd(vec2 p){ p = abs(p); return max(dot(p, vec2(0.8660254, 0.5)), p.y); }
float hexline(vec2 p, float px){
  vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(p, r) - r*0.5;
  vec2 b = mod(p - r*0.5, r) - r*0.5;
  vec2 g = dot(a,a) < dot(b,b) ? a : b;
  return smoothstep(px*2.5, px*0.5, abs(hexd(g) - 0.48));
}

/* reactor-core palette: repulsor blue → solar yellow → furnace orange → meltdown red */
vec3 coreColor(float h){
  vec3 c = mix(vec3(0.34, 0.78, 1.00), vec3(1.00, 0.88, 0.45), smoothstep(0.10, 0.35, h));
  c = mix(c, vec3(1.00, 0.50, 0.16), smoothstep(0.40, 0.65, h));
  return mix(c, vec3(1.00, 0.15, 0.08), smoothstep(0.70, 0.88, h));
}

/* holographic gimbal assembly — 5 nested precessing rings, graduation rim,
   gear teeth, iris shutter, reticle, heat-breathing arc-reactor core, satellites.
   S drives every rotation (integrated on CPU — idle crawl, load spin-up).
   x: cyan ink · y: gold ink · z: core/lens glow. W = shockwave kick, H = heat. */
vec3 gimbal(vec2 p, float sc, float seed, float T, float S, float W, float H, float px){
  p /= sc; px /= sc;
  vec3 o = vec3(0.0);
  float kick = 1.0 + 0.05*W;
  for(int i=0;i<5;i++){
    float fi = float(i);
    float hs = h12(vec2(seed, fi*7.3));
    float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float aR = S*dir*(0.09 + 0.20*hs) + hs*TAU;
    float ecc = 0.40 + 0.60*abs(sin(T*(0.05 + 0.04*hs) + seed*3.0 + fi*1.9));
    vec2 q = rot(aR)*p;
    q.y /= max(ecc, 0.28);
    float R = (0.34 + fi*0.155)*kick;
    float r = length(q);
    float a = atan(q.y, q.x)/TAU;
    float nd = 5.0 + fi*6.0;
    float duty = 0.52 + 0.30*h12(vec2(seed + fi, 2.2));
    float dash = step(fract(a*nd + S*dir*0.02), duty);
    float line = smoothstep(px*2.2, px*0.6, abs(r - R));
    line += smoothstep(px*12.0, px*1.0, abs(r - R))*0.32;      /* holographic bloom */
    float depth = mix(0.40, 1.0, smoothstep(-0.6, 0.6, q.y/max(R, 0.2)));
    float ink = line*dash*depth;
    if (i == 1) o.y += ink*1.25;                               /* gold gimbal rings */
    else if (i == 3) o.y += ink*0.55;
    else o.x += ink*(1.0 - 0.11*fi);
    if (i == 4){                                               /* graduations + gear teeth on the rim */
      float arcd = abs(fract(a*72.0) - 0.5)/72.0*TAU*max(r, 0.2);
      o.x += smoothstep(px*2.0, px*0.5, arcd)*step(R, r)*step(r, R + 0.05)*depth*0.6;
      float tooth = step(fract(a*36.0 - S*dir*0.03), 0.5);
      o.x += smoothstep(px*2.4, px*0.7, abs(r - R - 0.075))*tooth*depth*0.45;
    }
  }
  /* iris shutter — tri-blade, spins with the machinery */
  float rr = length(p);
  float ra = atan(p.y, p.x)/TAU;
  float blades = step(fract(ra*3.0 + S*0.25), 0.30);
  o.x += smoothstep(px*2.2, px*0.6, abs(rr - 0.215))*blades*0.9;
  /* inner reticle + crosshair */
  o.x += smoothstep(px*2.0, px*0.5, abs(rr - 0.14))*step(fract(ra*4.0 - S*0.12), 0.75)*0.85;
  o.x += smoothstep(px*1.6, px*0.4, abs(p.x))*step(abs(p.y), 0.09)*0.5;
  o.x += smoothstep(px*1.6, px*0.4, abs(p.y))*step(abs(p.x), 0.09)*0.5;
  /* arc-reactor core — calm breath when cool, fast agitated boil when hot */
  float breathe = 0.85 + (0.15 + 0.22*H)*sin(T*(2.1 + 6.5*H) + seed);
  o.z += (exp(-rr*rr*6.0)*1.35 + exp(-rr*rr*55.0)*2.2 + exp(-rr*rr*300.0)*2.0)*breathe*(1.0 + 0.12*H);
  /* orbiting satellite + trail ghosts */
  float ta = S*0.6 + seed;
  for(int k=0;k<3;k++){
    float fk = float(k);
    vec2 gp = vec2(cos(ta - fk*0.16), sin(ta - fk*0.16))*0.86;
    o.z += exp(-dot(p - gp, p - gp)*(700.0 + fk*600.0))*(1.6 - fk*0.5);
  }
  return o;
}

/* writhing energy filament between two reactor cores */
float filament(vec2 p, vec2 a, vec2 b, float T, float seed, float px){
  vec2 ab = b - a;
  float L = max(length(ab), 1e-3);
  vec2 d = ab/L;
  vec2 n = vec2(-d.y, d.x);
  float t = clamp(dot(p - a, d)/L, 0.0, 1.0);
  float env = sin(t*3.14159);
  float off = (fbm(vec2(t*5.0 + seed*9.0, T*6.0)) - 0.5)*0.10*env
            + (fbm(vec2(t*13.0 - seed*4.0, T*11.0)) - 0.5)*0.04*env;
  float dist = abs(dot(p - a, n) - off);
  return smoothstep(px*2.8, px*0.5, dist) + exp(-dist*70.0)*0.45;
}

/* comet streak — head flare + exponentially fading tail */
float comet(vec2 p, vec2 dirc, float T, float seed, float gateP, float px){
  float cyc = T*0.13 + seed;
  float ph = fract(cyc);
  float id = floor(cyc);
  float gate = step(h12(vec2(id, seed*13.0 + 3.0)), gateP);
  vec2 start = -dirc*0.95 + (h22(vec2(id, seed*3.0 + 1.0)) - 0.5)*0.8;
  vec2 pos = start + dirc*ph*1.9;
  vec2 rel = p - pos;
  float along = dot(rel, dirc);
  float perp = abs(dot(rel, vec2(-dirc.y, dirc.x)));
  float head = exp(-(perp*perp + along*along)*3000.0)*1.8;
  float tail = exp(-perp*240.0)*exp(min(along, 0.0)*9.0)*step(along, 0.015)*0.9;
  return (head + tail)*gate*sin(ph*3.14159);
}

/* fake telemetry readout — flickering rows of data dashes */
float readout(vec2 p, vec2 org, vec2 size, float T){
  vec2 q = (p - org)/size;
  float inb = step(0.0, q.x)*step(q.x, 1.0)*step(0.0, q.y)*step(q.y, 1.0);
  vec2 c = floor(q*vec2(26.0, 7.0));
  vec2 f = fract(q*vec2(26.0, 7.0));
  float on = step(0.42, h12(c + floor(T*(0.9 + h12(c)*2.2))*0.31));
  float dash = step(0.12, f.x)*step(f.x, 0.86)*step(0.30, f.y)*step(f.y, 0.72);
  return inb*on*dash;
}

/* small drifting HUD reticle */
float reticle(vec2 q, float r, float ph, float px){
  float d = length(q);
  float a = atan(q.y, q.x)/TAU;
  float v = smoothstep(px*1.8, px*0.5, abs(d - r))*step(fract(a*4.0 + ph), 0.7);
  v += smoothstep(px*1.4, px*0.4, abs(d - r*0.45));
  v += exp(-d*d/(r*r)*30.0)*0.5;
  return v;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float px = 1.4/u_res.y;
  float T = mod(u_time, 3600.0);
  float S = mod(u_spin, 3600.0*TAU);
  float E = clamp(u_energy, 0.0, 1.0);
  float B = clamp(u_drive, 0.0, 1.0);
  float H = clamp(u_heat, 0.0, 1.0);
  vec2 M = u_mouse;
  float rad = length(uv);
  float asp = u_res.x/u_res.y;
  bool land = asp > 1.0;
  float ax = min(asp, 1.9)*0.5;

  vec3 CY = vec3(0.34, 0.78, 1.00);
  vec3 GD = vec3(1.00, 0.79, 0.42);
  vec3 CC = coreColor(H);                                /* reactor cores follow GPU heat */

  /* ---------- deep blue-black volume ---------- */
  vec3 col = mix(vec3(0.015, 0.037, 0.078), vec3(0.003, 0.009, 0.024), smoothstep(0.15, 1.05, rad));
  float neb = fbm(uv*1.5 + vec2(T*0.008, -T*0.005) + M*0.10);
  col += vec3(0.014, 0.046, 0.100)*neb*neb*smoothstep(1.15, 0.30, rad);
  col += CC*neb*neb*0.05*H*smoothstep(1.15, 0.30, rad);  /* hot haze bleeds into the room */

  /* ---------- hexagonal plating whisper, kept off the center ---------- */
  float hg = hexline((rot(0.26)*(uv + M*0.05))*7.5, px*7.5);
  col += CY*hg*0.05*smoothstep(0.28, 0.80, rad)*(0.7 + 0.3*sin(T*0.4 + uv.x*3.0));

  /* ---------- double event shockwave ---------- */
  float wave = exp(-pow((rad - u_pulseAge*0.85)*5.0, 2.0))*exp(-u_pulseAge*0.8);
  wave += exp(-pow((rad - u_pulseAge*0.55)*7.0, 2.0))*exp(-u_pulseAge*1.1)*0.6;
  float W = min(wave, 1.2);

  /* ---------- holo floor — dim perspective grid ---------- */
  float fm = smoothstep(-0.26, -0.40, uv.y);
  float fz = 0.11/max(0.045, -(uv.y + 0.22));
  vec2 fw = vec2((uv.x + M.x*0.08)*fz*6.5, fz*3.0 + T*(0.25 + 0.9*B));
  float gridl = pow(smoothstep(0.5, 0.0, abs(fract(fw.x) - 0.5)), 14.0)
              + pow(smoothstep(0.5, 0.0, abs(fract(fw.y) - 0.5)), 14.0);
  col += CY*gridl*fm*smoothstep(9.0, 1.6, fz)*(0.07 + 0.10*B + 0.35*W);
  col += CY*exp(-abs(uv.y + 0.245)*26.0)*fm*0.06;

  /* ---------- depth ghost — colossal background gimbal, slow parallax ---------- */
  vec3 gG = gimbal(uv - vec2(ax*0.10, 0.06) - M*0.015, land ? 1.15 : 0.90, 12.9, T*0.55, S*0.55, W*0.5, H, px);
  col += CY*gG.x*0.085 + GD*gG.y*0.075;

  /* ---------- THE MACHINES — three floating gimbal assemblies ---------- */
  vec2 PA = land ? vec2(-ax*0.72, 0.10)  : vec2(-ax*0.52, 0.335);
  vec2 PB = land ? vec2( ax*0.70, -0.16) : vec2( ax*0.55, -0.345);
  vec2 PC = land ? vec2( ax*0.20, 0.385) : vec2( ax*0.05, 0.475);
  vec3 gA = gimbal(uv - PA - M*0.060, land ? 0.44 : 0.30, 3.7, T, S, W, H, px);
  vec3 gB = gimbal(uv - PB - M*0.045, land ? 0.34 : 0.26, 8.1, T*1.13 + 5.0, S*1.13 + 5.0, W, H, px);
  vec3 gC = gimbal(uv - PC - M*0.028, land ? 0.15 : 0.12, 5.2, T*0.8 + 11.0, S*0.8 + 11.0, W, H, px)*0.5;
  vec3 g = gA + gB + gC;
  /* anamorphic lens streaks — tinted by core temperature */
  vec2 fA = uv - PA - M*0.060;
  vec2 fB = uv - PB - M*0.045;
  col += CC*exp(-abs(fA.y)*60.0)*exp(-abs(fA.x)*7.0)*(0.11 + 0.12*E + 0.10*H);
  col += CC*exp(-abs(fB.y)*70.0)*exp(-abs(fB.x)*9.0)*(0.09 + 0.10*E + 0.08*H);
  col += mix(CY, CC, 0.65*H)*g.x*(0.74 + 0.55*E + 0.8*W);   /* ring ink warms under heat */
  col += mix(GD, CC, 0.75*H)*g.y*(1.00 + 1.9*E + 1.3*W);
  col += CC*g.z*(0.30 + 0.10*H) + GD*g.z*(0.05 + 0.25*E)*(1.0 - 0.9*H);

  /* ---------- energy conduits: silent when idle, field lines mid-load, storm at 80%+ ---------- */
  float storm = smoothstep(0.60, 0.85, B);               /* dramatic strikes live here */
  float field = smoothstep(0.35, 0.75, B);               /* faint magnetic field lines fade in first */
  float fb1 = filament(uv, PA, PB, T, 1.3, px);
  float fb2 = filament(uv, PB, PC, T, 5.1, px);
  float fb3 = filament(uv, PC, PA, T, 9.4, px);
  float fg1 = step(h12(vec2(floor(T*2.3), 4.2)), (0.55 + 0.35*W)*storm);
  float fg2 = step(h12(vec2(floor(T*1.9) + 7.0, 8.8)), (0.45 + 0.35*W)*storm);
  float fg3 = step(h12(vec2(floor(T*2.7) + 3.0, 2.5)), 0.38*storm);
  float fbF = filament(uv, mix(PA, PB, 0.45) + vec2(0.0, 0.10), PC, T, 3.3, px);
  float fil = (fb1*fg1 + fbF*fg1*0.55 + fb2*fg2 + fb3*fg3)
            *(0.55 + 0.45*sin(T*47.0))*(0.55 + 0.45*storm);
  fil += (fb1 + fb2*0.8 + fb3*0.7)*0.20*field;
  col += mix(CY, vec3(1.0), 0.45)*fil*0.85 + mix(GD, CC, 0.5)*fil*0.25;

  /* ---------- comet streaks — sparse at idle, busier under load ---------- */
  float cm = comet(uv + M*0.02, normalize(vec2(0.82, -0.42)), T, 0.0, 0.15 + 0.35*B, px)
           + comet(uv + M*0.03, normalize(vec2(-0.70, -0.52)), T, 17.7, 0.12 + 0.30*B, px)*0.8;
  col += CY*cm*0.5 + vec3(1.0)*cm*0.12;

  /* ---------- drifting data particles + rising sparks (ember-colored when hot) ---------- */
  float pt = 0.0, ptg = 0.0;
  for(int i=0;i<3;i++){
    float fi = float(i);
    float scp = 13.0 + fi*9.0;
    vec2 drift = i == 2 ? vec2(T*0.03, T*(0.12 + 0.55*B)) : vec2(T*(0.05 + fi*0.05), T*(0.02 + fi*0.03));
    vec2 pp = (uv + M*(0.03 + fi*0.035))*scp + drift;
    vec2 cell = floor(pp);
    vec2 f = fract(pp) - 0.5;
    vec2 o2 = (h22(cell) - 0.5)*0.8;
    float rn = h12(cell*1.7 + fi*11.0);
    float tw = 0.5 + 0.5*sin(T*(1.0 + rn*4.0) + rn*40.0);
    float dot2 = exp(-dot(f - o2, f - o2)*(240.0 + fi*150.0))*step(0.80, rn)*tw;
    if (i == 2) ptg += dot2;
    else pt += dot2*(1.0 - fi*0.24);
  }
  col += CY*pt*(0.33 + 2.4*W);
  col += mix(GD, CC, 0.6*H + 0.2)*ptg*(0.15 + 0.5*B)*smoothstep(0.55, -0.1, uv.y);
  col += (CY*0.05 + GD*pt*0.9)*W;

  /* ---------- small drifting reticles ---------- */
  float rt = reticle(uv - vec2(-ax*0.17 + 0.05*sin(T*0.11), -0.34 + 0.03*cos(T*0.09)) - M*0.03, 0.045, T*0.05, px)*0.5
           + reticle(uv - vec2(ax*0.88 + 0.03*sin(T*0.13 + 2.0), 0.30) - M*0.05, 0.060, -T*0.04, px)*0.6
           + reticle(uv - vec2(-ax*0.92, -0.28 + 0.04*sin(T*0.07)) - M*0.055, 0.052, T*0.06, px)*0.55;
  col += CY*rt*0.5;

  /* ---------- corner brackets + telemetry ---------- */
  vec2 q = abs(uv + M*0.02);
  float hw = ax - 0.075;
  float hh = 0.425;
  float br = smoothstep(px*2.0, px*0.6, abs(q.x - hw))*smoothstep(hh - 0.085, hh - 0.025, q.y)*step(q.y, hh)
           + smoothstep(px*2.0, px*0.6, abs(q.y - hh))*smoothstep(hw - 0.14, hw - 0.04, q.x)*step(q.x, hw);
  col += CY*br*(0.45 + 0.6*E + 0.9*W);
  float rd = readout(uv + M*0.03, vec2(-hw + 0.035, -hh + 0.045), vec2(0.205, 0.085), T)
           + readout(uv + M*0.045, vec2(hw - 0.24, hh - 0.13), vec2(0.205, 0.085), T)*0.85;
  col += CY*rd*0.26 + GD*rd*0.05;

  /* ---------- cinematic finish ---------- */
  col *= 1.0 - 0.20*exp(-rad*rad*3.4);                  /* keep the middle dark for content */
  col *= 1.0 - 0.30*smoothstep(0.80, 1.32, rad);
  float chroma = smoothstep(0.55, 1.15, rad);
  col.r *= 1.0 + 0.055*chroma;
  col.b *= 1.0 - 0.035*chroma;
  col *= 1.0 + 0.02*sin(uv.y*640.0 + T*2.2);            /* holo scanline shimmer */
  col *= 1.0 + 0.08*E + 0.06*B;
  col = 1.0 - exp(-col*1.35);
  col += (h12(frag + fract(T)*23.0) - 0.5)*0.02;
  gl_FragColor = vec4(col, 1.0);
}`,
};
