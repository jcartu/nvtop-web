(window.NVTHEMES = window.NVTHEMES || {})['liquidglass'] = {
  id: 'liquidglass',
  name: 'LIQUID GLASS',
  tag: 'REFRACTION FIELD · GLASS OS',
  theme: {
    light: false,
    accent:  '#8ad8ff',
    accent2: '#f2b8ff',
    text:  '#eef4f9',
    muted: '#a6bacb',
    faint: '#6b8095',
    void:  '#05070c',
    panel: 'rgba(18,24,34,0.62)',
    line:  'rgba(190,215,240,0.13)',
    good:  '#6bf0b5',
    warn:  '#ffcb6b',
    crit:  '#ff6b8a',
    info:  '#8ad8ff',
    radius: '22px',
    dim: 0.9,
    fonts: {
      display: "'Syne',sans-serif",
      head:    "'Manrope',sans-serif",
      mono:    "'IBM Plex Mono',monospace",
    },
    googleFonts: ['Syne:wght@700;800', 'Manrope:wght@500;700', 'IBM+Plex+Mono:wght@400;600'],
  },
  login: {
    title: 'GLASS OS',
    sub: 'LIGHT REFRACTION BUS · TRANSPARENCY LAYER',
    user: 'BODY ID',
    pass: 'PRISM KEY',
    button: 'ENTER THE PANE',
    granted: 'INDEX OF REFRACTION ACCEPTED',
    denied: 'OPAQUE — RE-ALIGN THE PRISM',
    boot: [
      'CAUSTIC PROBE ............. CALIBRATED',
      'RIBBON PHASES 01-07 ....... LAMINAR',
      'DIFFUSION LAYER ........... 2.4 μm',
      'SPECULAR INDEX ............ 1.521',
      'READY.',
    ],
    footer: 'everything is a lens if you look through it long enough',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
uniform float u_drive; uniform float u_spin;
#define TAU 6.2831853

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h12(i),h12(i+vec2(1.,0.)),f.x), mix(h12(i+vec2(0.,1.)),h12(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){
  float s=0.0, a=0.5; mat2 m=rot(0.55)*2.03;
  for(int i=0;i<4;i++){ s+=a*vn(p); p=m*p+9.7; a*=0.5; }
  return s;
}
/* thin-film / dispersion tint: hue bends across the refraction angle */
vec3 prism(float t){
  return 0.5+0.5*cos(TAU*(vec3(0.00,0.33,0.67)+t));
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float asp = u_res.x/u_res.y;
  float T = mod(u_time, 4000.0);
  vec2 mouse = u_mouse*0.16;

  /* deep ink stage with a slow breathing sheen */
  vec3 col = mix(vec3(0.014,0.019,0.028), vec3(0.034,0.045,0.062), uv.y*0.5+0.5);
  col += prism(0.62+uv.x*0.05)*0.012*(0.5+0.5*sin(T*0.07));

  /* warped fluid domain — the sheet of glass itself */
  vec2 p = uv*vec2(asp*0.62, 1.0) + mouse + vec2(T*0.014, -T*0.010);
  float flow = fbm(p*1.15 + vec2(0.0, T*0.02));
  vec2 w = p + vec2(flow*0.42, -flow*0.30)
             + 0.10*vec2(vn(p*2.1 - T*0.03), vn(p*2.3 + T*0.026));

  /* four laminated slabs sliding at different speeds */
  for(int i=0;i<4;i++){
    float fi = float(i);
    vec2 q = w*rot(0.29*fi - 0.35) + vec2(fi*1.7, -fi*0.9);
    float d = q.y*2.1 + sin(q.x*1.35 + T*0.10 + fi*0.9)*0.34 + fbm(q*1.6 - T*0.04)*0.30;
    float body = smoothstep(0.22, 0.0, abs(d));
    float rim  = smoothstep(0.006, 0.0, abs(abs(d)-0.185)) * (0.34+0.66*vn(q*5.5+T*0.12));
    /* dispersion breaks the rim into chromatic slivers instead of clean wiring */
    float disp = smoothstep(0.026, 0.0, abs(abs(d)-0.185-0.004*sin(q.x*3.0+fi)));
    /* interior striae: the layered stress lines inside tempered glass */
    float striae = pow(abs(sin(d*7.0 + flow*5.0 + fi)), 26.0);
    float bandCol = prism(0.58 + d*0.10 + fi*0.07).r;

    col += prism(0.56 + fi*0.09 + d*0.06) * body * 0.050;
    col += mix(vec3(0.72,0.90,1.0), prism(0.60+fi*0.08), 0.55) * rim * (0.13 + 0.16*u_drive);
    col += prism(0.50+fi*0.11+q.y*0.05)*disp*(0.05+0.08*u_drive);
    col += prism(0.52 + d*0.14) * striae * body * (0.05 + 0.16*u_drive);
    col += vec3(0.85,0.93,1.0) * bandCol * rim * 0.10;
  }

  /* caustics: focused light dancing on the underside of the sheets */
  float caus = pow(abs(sin(w.x*3.4 + w.y*2.6 + flow*5.0 + T*0.09)), 30.0);
  vec2 cq = w*3.1 + vec2(flow*2.2, -T*0.06);
  float vor = abs(vn(cq) - vn(cq+vec2(0.28,0.0))) + abs(vn(cq) - vn(cq+vec2(0.0,0.28)));
  float filament = smoothstep(0.055, 0.0, vor);
  vec3 cause = (prism(0.50+w.x*0.08)*caus*0.10 + vec3(0.80,0.92,1.0)*filament*0.10)*(0.45+0.55*u_drive);

  /* centre stays quiet: content sits there */
  float cen = exp(-pow(length((uv-vec2(0.0,0.03))*vec2(0.95,1.35)), 1.9)*1.5);
  col += cause*(1.0-0.72*cen);

  /* arrival/shift pulse: a refractive ring bending the sheet */
  float pr = u_pulseAge*0.62;
  float ring = smoothstep(0.055,0.0,abs(length(uv)-pr)) * exp(-u_pulseAge*0.45);
  col += prism(0.55+length(uv)*0.2)*ring*0.16*(1.0-0.5*cen);
  col += u_energy*0.020*(0.4+caus);

  /* suspended dust catching the light */
  vec2 gp = frag/22.0;
  vec2 gi = floor(gp);
  float gh = h12(gi);
  if(gh > 0.976){
    vec2 gc = (gi+vec2(h12(gi+1.3),h12(gi+7.1)))/ (u_res/22.0);
    vec2 dd = (frag/u_res - vec2(gc.x, gc.y));
    float tw = 0.5+0.5*sin(T*1.6+gh*40.0);
    col += vec3(0.78,0.90,1.0)*smoothstep(0.006,0.0,length(dd))*tw*0.16;
  }

  /* specular sweep — a broad reflection travelling across the assembly */
  float sweep = smoothstep(0.16,0.0, abs(uv.x - sin(T*0.16)*0.95 - uv.y*0.18));
  col += vec3(0.86,0.93,1.0)*sweep*smoothstep(0.55,0.0,abs(uv.y+0.08))*0.020;

  /* optics: soft vignette, gentle tone curve, film grain */
  float vig = smoothstep(1.35,0.25,length(uv*vec2(0.86,1.05)));
  col *= mix(0.72,1.0,vig);
  col = 1.0-exp(-col*1.45);
  col = pow(col, vec3(0.95));
  col += (h12(frag+fract(T)*331.0)-0.5)*0.014;
  gl_FragColor = vec4(col,1.0);
}`,
};
