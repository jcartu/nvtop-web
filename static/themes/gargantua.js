(window.NVTHEMES = window.NVTHEMES || {})['gargantua'] = {
  id: 'gargantua',
  name: 'GARGANTUA',
  tag: 'INTERSTELLAR · LAZARUS MISSION',
  theme: {
    light: false,
    accent:  '#f0a63c',
    accent2: '#8fd3e8',
    text:  '#e9edf1',
    muted: '#96a2af',
    faint: '#59636f',
    void:  '#05060a',
    panel: 'rgba(10,13,18,0.55)',
    line:  'rgba(240,166,60,0.14)',
    good:  '#4fd08a',
    warn:  '#ff8f3d',
    crit:  '#ff4f45',
    info:  '#8fd3e8',
    radius: '10px',
    fonts: {
      display: "'Michroma',sans-serif",
      head:    "'Titillium Web',sans-serif",
      mono:    "'IBM Plex Mono',monospace",
    },
    googleFonts: ['Michroma', 'Titillium+Web:wght@400;600;700', 'IBM+Plex+Mono:wght@400;600'],
  },
  login: {
    title: 'ENDURANCE',
    sub: 'NASA LAZARUS MISSION · GARGANTUA APPROACH VECTOR',
    user: 'CREW DESIGNATION',
    pass: 'DOCKING AUTHORIZATION',
    button: 'INITIATE DOCKING',
    granted: 'DOCKING CONFIRMED — WELCOME ABOARD',
    denied: "IT'S NOT POSSIBLE — NO. IT'S NECESSARY.",
    boot: [
      'ENDURANCE RING MODULES A-D .... PRESSURIZED',
      'CRYO PODS x4 .... NOMINAL',
      'TARS ONLINE — HONESTY 90% / HUMOR 75%',
      'RELATIVE TIME DILATION 61,000:1 .... ACCEPTED',
      'GARGANTUA APPROACH VECTOR .... LOCKED',
    ],
    footer: 'do not go gentle into that good night · S T A Y',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

#define RIN  0.185
#define ROUT 0.95
#define RS   0.150
#define RP   0.158
#define TILT 0.13

float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x), mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x), f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+vec2(17.7,9.2); a*=0.5; }
  return v;
}

/* accretion disk surface: Keplerian-sheared turbulent bands + doppler beaming.
   R = disk radius, ph = disk azimuth (seam hidden on receding side),
   sx = screen-space side (-1 left approaching .. +1 right receding)          */
vec3 diskCol(float R, float ph, float sx, float T, float E){
  float u = clamp((R-RIN)/(ROUT-RIN), 0.0, 1.0);
  float om = (0.05 + E*0.07)*pow(max(R,0.08), -1.5);      /* inner bands orbit faster */
  float pw = ph + T*om;
  vec2 cs = vec2(cos(pw), sin(pw));                       /* circle embedding: no atan seam */
  float st2 = vnoise(cs*4.5 + vec2(R*80.0 - T*0.15, 0.0));
  float st  = fbm(cs*2.6 + vec2(R*34.0 + st2*1.6, st2*0.9)); /* domain-warped eddies */
  float fil = vnoise(cs*8.0 + vec2(R*150.0, 0.0));        /* fine shear filaments */
  float hs  = pow(vnoise(cs*1.3 + vec2(R*11.0, 0.0)), 5.0); /* orbiting hot clumps */
  float bands = (0.22 + 1.05*pow(st,1.5) + 0.34*st2 + 1.7*hs)*(0.72 + 0.45*fil);
  float hot = pow(1.0-u, 2.0)*2.2 + 0.10;                 /* white-hot inner edge */
  vec3 c = mix(vec3(1.00,0.87,0.62), vec3(1.00,0.44,0.12), smoothstep(0.02,0.50,u));
  c = mix(c, vec3(0.36,0.13,0.045), smoothstep(0.42,1.0,u));
  c = mix(vec3(1.04,1.00,0.94), c, smoothstep(0.0,0.14,u));
  float dd = clamp(-sx,-1.0,1.0);                         /* +1 = approaching side */
  float dop = pow(1.0+0.62*dd, 3.0);                      /* relativistic beaming */
  c = mix(c, vec3(1.05,1.02,0.98), clamp(dd,0.0,1.0)*0.55);
  c = mix(c, c*vec3(1.0,0.42,0.22), clamp(-dd,0.0,1.0)*0.7);
  float ein  = smoothstep(RIN-0.010, RIN+0.025, R);
  float eout = 1.0 - smoothstep(0.60, ROUT, R);
  return c*bands*hot*dop*ein*eout*(1.0+E*0.7);
}

/* sparse two-layer starfield evaluated in LENSED source coordinates,
   so stars smear into tangential arcs near the photon ring for free */
vec3 stars(vec2 q, float T){
  vec3 acc = vec3(0.0);
  for(int L=0;L<2;L++){
    float sc = (L==0) ? 22.0 : 44.0;
    vec2 g = q*sc; vec2 id = floor(g); vec2 f = fract(g);
    vec2 sp = hash22(id + float(L)*31.7)*0.7 + 0.15;
    float d = length(f - sp);
    float keep = step(0.78, hash21(id + float(L)*5.3));
    float br = keep*pow(hash21(id + 9.1 + float(L)), 3.0);
    float tw = 0.75 + 0.25*sin(T*(1.0+hash21(id)*2.0) + hash21(id)*40.0);
    vec3 tint = mix(vec3(0.62,0.74,1.0), vec3(1.0,0.85,0.62), hash21(id+2.7));
    acc += tint*br*tw*smoothstep(0.14, 0.0, d)*((L==0)?1.0:0.55);
  }
  return acc;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  float T = mod(u_time, 1200.0);
  float E = u_energy;
  vec2 M = u_mouse;

  vec2 C = vec2(0.0, 0.15);                 /* hole slightly above dead center */
  vec2 p = uv - C + M*0.012;                /* tiny parallax of the hole */

  /* ---- gravitational-wave pulse: radial spacetime shudder ---- */
  float age = min(u_pulseAge, 30.0);
  float r0 = length(p);
  float wR = 0.10 + age*0.55;
  float wamp = 0.030*exp(-age*0.8);
  float wave = sin((r0-wR)*34.0)*exp(-(r0-wR)*(r0-wR)*38.0)*wamp;
  p *= 1.0 + wave;

  float r  = length(p);
  float sx = p.x/max(r, 1e-4);
  float sa = atan(p.y, p.x);
  float shadow = smoothstep(RS-0.006, RS+0.004, r);

  /* ---- lensed background: cold dust nebula + starfield ---- */
  float sw = 0.85/(r+0.24);                                /* frame-drag swirl */
  float rsrc = abs(r - 0.021/(r+0.02));                    /* einstein deflection */
  vec2 dir = vec2(cos(sa+sw), sin(sa+sw));
  vec2 q = dir*rsrc + M*0.05 + vec2(T*0.0016, 0.0);
  vec3 col = vec3(0.0);
  float neb = fbm(q*2.4 + vec2(3.7,8.1)) * fbm(q*0.85 + vec2(9.0,1.0));
  float lane = smoothstep(0.55, 0.0, abs(q.y*0.8 - q.x*0.45 + 0.28)); /* dust lane */
  col += vec3(0.075,0.115,0.20)*neb*(1.6 + lane*1.8);      /* ice-cold dust */
  col += vec3(0.17,0.10,0.075)*fbm(q*1.6 + vec2(21.0,5.0))*neb*lane*1.6;
  col += stars(q, T)*1.35;
  col *= shadow;                                           /* the shadow swallows it */

  /* ---- halo arcs: far side of the disk lensed OVER and UNDER the hole ---- */
  float hw = mix(0.048, 0.13, smoothstep(-0.7, 0.9, sin(sa)));
  float t = clamp((r-RP)/hw, 0.0, 1.0);
  float Rh = mix(RIN, 0.72, pow(t, 1.45));
  float ha = atan(p.y, -p.x);                              /* seam on dim side */
  vec3 halo = diskCol(Rh, ha, sx, T, E);
  float hfade = smoothstep(1.0, 0.55, t)*smoothstep(RP-0.004, RP+0.010, r);
  float vshape = mix(0.40, 1.0, smoothstep(-0.9, 0.9, sin(sa)));
  col += halo*hfade*vshape*shadow;

  /* ---- photon ring: blazing, doppler-lopsided, chromatic fringe ---- */
  float flare = 1.0 + E*1.3 + 1.6*exp(-age*1.6);
  float dopr = mix(0.35, 1.6, smoothstep(0.9, -0.9, sx));
  dopr *= mix(0.60, 1.0, smoothstep(-0.9, 0.5, sin(sa)));  /* under-image demagnified */
  dopr *= 0.88 + 0.22*vnoise(vec2(cos(sa), sin(sa))*2.2 + vec2(T*1.4, 0.0)); /* plasma flicker */
  float prr = exp(-pow((r-RP+0.0022)/0.0075, 2.0));
  float prg = exp(-pow((r-RP       )/0.0075, 2.0));
  float prb = exp(-pow((r-RP-0.0022)/0.0075, 2.0));
  col += vec3(prr*1.05, prg*0.92, prb*0.78)*dopr*flare*0.85*shadow;
  col += vec3(1.0,0.82,0.58)*exp(-pow((r-RP-0.017)/0.0045, 2.0))*0.32*dopr*shadow; /* 2nd-order ring */
  col += vec3(1.0,0.70,0.42)*exp(-max(r-RP,0.0)*9.0)*0.115*dopr*flare*shadow;      /* fire glow */

  /* ---- near-side accretion band crossing IN FRONT of the shadow ---- */
  vec2 pd = vec2(p.x, p.y/TILT);
  float Rb = length(pd);
  float ph = atan(pd.y, -pd.x);
  float upper = smoothstep(0.02, 0.14, pd.y/max(Rb, 1e-3));
  float occl = 1.0 - upper*smoothstep(0.62, 0.30, r);      /* far half near hole -> halo */
  vec3 band = diskCol(Rb, ph, sx, T, E)*occl;
  band *= 0.55 + 0.45*smoothstep(-1.0, -0.35, pd.y/max(Rb,1e-3)); /* underside edge shading */
  float cover = smoothstep(RIN-0.010, RIN+0.030, Rb)*(1.0 - smoothstep(0.55, 0.85, Rb))*occl;
  col = mix(col, vec3(0.0), cover*0.85);                   /* disk is opaque */
  col += band;
  /* thin scattering glow hugging the band (disk atmosphere) */
  col += vec3(1.0,0.55,0.22)*exp(-abs(pd.y)*0.9)*smoothstep(ROUT, RIN, Rb)*0.05*(1.0+E*0.6)*occl;

  /* ---- grade: center pocket, vignette, cold ambient floor, grain ---- */
  float rr = length(uv*vec2(0.82,1.15));
  col *= mix(0.38, 1.0, smoothstep(0.06, 0.48, rr));       /* dashboard pocket */
  col *= 1.0 - 0.32*dot(uv,uv);                            /* corner vignette */
  col += vec3(0.012,0.016,0.024)*(1.0 - 0.55*length(uv));  /* starlight fog lifts blacks */
  col += (hash21(gl_FragCoord.xy + fract(T)*vec2(217.0,131.0)) - 0.5)*0.026;
  col = 1.0 - exp(-col*(1.25 + E*0.08));
  gl_FragColor = vec4(col, 1.0);
}`,
};
