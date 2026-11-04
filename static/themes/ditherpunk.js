(window.NVTHEMES = window.NVTHEMES || {})['ditherpunk'] = {
  id: 'ditherpunk',
  name: 'DITHERPUNK',
  tag: 'BAYER 4×4 · DIGITAL BRUTALISM',
  theme: {
    light: false,
    accent:  '#c8ff00',
    accent2: '#f4f2ea',
    text:  '#f2f2ec',
    muted: '#adada4',
    faint: '#6f6f68',
    void:  '#080907',
    panel: 'rgba(12,13,11,0.70)',
    line:  'rgba(230,230,215,0.16)',
    good:  '#b8ff5c',
    warn:  '#ffe14d',
    crit: '#ff4d4d',
    info:  '#dcdcd2',
    radius: '2px',
    dim: 0.9,
    fonts: {
      display: "'Major Mono Display',monospace",
      head:    "'Space Mono',monospace",
      mono:    "'JetBrains Mono',monospace",
    },
    googleFonts: ['Major+Mono+Display', 'Space+Mono:wght@400;700', 'JetBrains+Mono:wght@400;700'],
  },
  login: {
    title: 'DITHERPUNK',
    sub: '1-BIT INTERROGATION · NO GREYS ALLOWED',
    user: 'UNIT',
    pass: 'PUNCHKEY',
    button: 'COMMIT CRIMES',
    granted: 'BANDING IS A CHOICE',
    denied: 'WRONG ORDER — RESAMPLE AND RETURN',
    boot: [
      'QUANTIZER ................. 4×4 BAYER',
      'PALETTE ................... ONE + POISON',
      'MOIRE AMPLIFIER ........... ENGAGED',
      'GREYS ..................... EXTINCT',
      'READY.',
    ],
    footer: 'sixteen thresholds between here and hell',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
uniform float u_drive; uniform float u_spin;
#define TAU 6.2831853

float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h12(i),h12(i+vec2(1.,0.)),f.x), mix(h12(i+vec2(0.,1.)),h12(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){
  float s=0.0, a=0.5;
  for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; p+=7.7; a*=0.5; }
  return s;
}
/* recursive ordered-dither thresholds (Bayer 2×2 → 4×4) */
float bayer2(vec2 a){ a=floor(a); return fract(a.x*0.5 + a.y*a.y*0.75); }
float bayer4(vec2 a){ return bayer2(0.5*a)*0.25 + bayer2(a); }

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float asp = u_res.x/u_res.y;
  float T = mod(u_time, 4800.0);
  vec2 mouse = u_mouse*0.14;

  /* slow tonal mass: interferometry of two offsets interference centres */
  vec2 c1 = vec2(-0.55*asp + mouse.x, 0.10 + 0.05*sin(T*0.07));
  vec2 c2 = vec2( 0.62*asp + mouse.y, -0.05 + 0.06*cos(T*0.05));
  float r1 = length(uv-c1), r2 = length(uv-c2);
  float f  = 0.5 + 0.5*sin(r1*7.0 - T*0.20 + sin(r2*5.2 + T*0.13)*1.15);
  f  = mix(f, 1.0-f, 0.35);
  /* horizon weave amplifies banding near top/bottom thirds */
  f += 0.10*sin(uv.y*26.0 + uv.x*3.4 + T*0.22);
  f += 0.07*fbm(uv*2.4 - T*0.02) - 0.035;

  /* darkness discipline: keep the content centre sparse */
  float cen = exp(-pow(length(uv*vec2(1.05,1.45)),1.9)*1.55);
  f = mix(f, f*0.22, cen*0.92);

  /* screen-door cell grid, roughly 5 px cells */
  vec2 cell = frag/5.0;
  float th = bayer4(cell);
  float bit = step(f, th) * step(0.045, f) * (1.0 - 0.94*cen);

  /* second tone: bright speckles only where density is high */
  float bit2 = step(f-0.26, th) * step(0.45, f) * (1.0 - 0.97*cen);

  vec3 ink = vec3(0.86,0.86,0.80);
  vec3 col = vec3(0.020,0.021,0.017);
  col += ink*bit*0.185 + ink*bit2*0.30;

  /* degenerate grey bands mistakenly surviving quantisation */
  float bandMiss = smoothstep(0.03,0.0,abs(fract(uv.y*4.5+T*0.01)-0.5)-0.47);
  col += ink*bandMiss*0.02;

  /* poison accent: acid pixels fired sparsely along the interference crests */
  vec2 aj = frag/3.0;
  col = mix(col, vec3(0.66,0.95,0.02), step(0.972, h12(floor(cell*0.5001)+floor(T*3.0)))*bit*0.70*(1.0-cen));

  /* teletype ruling: dashed hairlines at the extremes, like fanfold paper */
  float dashTop = step(0.86, fract(frag.x/9.0)) * smoothstep(0.006,0.0,abs(uv.y-0.74));
  float dashBot = step(0.86, fract(frag.x/9.0)) * smoothstep(0.006,0.0,abs(uv.y+0.76));
  col += vec3(0.72,0.72,0.64)*(dashTop+dashBot)*0.5;

  /* arrival pulse: inverse square burst echoing through the dither */
  float pring = smoothstep(0.09,0.0,abs(length(uv)-u_pulseAge*0.7))*exp(-u_pulseAge*0.9);
  col += vec3(0.80,1.00,0.20)*pring*0.30*(0.35+0.65*th);
  col += ink*bit*u_energy*0.04;

  /* momentum from the rig: field density leans with load, never blows out */
  col *= 0.92 + 0.12*u_drive;

  float vig = smoothstep(1.34,0.26,length(uv*vec2(0.92,1.02)));
  col *= mix(0.74,1.0,vig);
  /* CRT-ish scanning + grain, very low amplitude */
  col *= 1.0 - 0.05*step(0.5, fract(frag.y*0.5));
  col += (h12(frag+fract(T)*173.0)-0.5)*0.020;
  gl_FragColor = vec4(col,1.0);
}`,
};
