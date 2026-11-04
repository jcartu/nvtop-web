(window.NVTHEMES = window.NVTHEMES || {})['chrome'] = {
  id: 'chrome',
  name: 'LIQUID CHROME',
  tag: 'MERCURY OCEAN · SPECTRAL FRINGE',
  theme: {
    light: false,
    accent:  '#c9d6ff',
    accent2: '#8ef7d3',
    text:  '#f4f7ff',
    muted: '#adb8c9',
    faint: '#69738c',
    void:  '#060709',
    panel: 'rgba(14,16,22,0.64)',
    line:  'rgba(200,215,255,0.14)',
    good:  '#7cf2c8',
    warn:  '#ffd479',
    crit:  '#ff5d7a',
    info:  '#9dafff',
    radius: '18px',
    dim: 0.9,
    fonts: {
      display: "'Big Shoulders Display',sans-serif",
      head:    "'Inter Tight',sans-serif",
      mono:    "'Geist Mono',monospace",
    },
    googleFonts: ['Big+Shoulders+Display:wght@700;800', 'Inter+Tight:wght@500;700', 'Geist+Mono:wght@400;600'],
  },
  login: {
    title: 'MERCURY LAB',
    sub: 'FERROFLUID SEA · POLISHED Gd–Ag',
    user: 'LAB OPERATOR',
    pass: 'ALLOY CODE',
    button: 'DROP THE BEAD',
    granted: 'SURFACE TENSION HOLDS',
    denied: 'OXIDISED — WIPE AND RETRY',
    boot: [
      'FERROFLUID BASIN ........... SEALED',
      'FIELD COILS 1-6 ............ 42 mT',
      'SURFACE ROUGHNESS .......... Ra 0.2 nm',
      'SPECTRAL FOIL .............. ARMED',
      'READY.',
    ],
    footer: 'the future was shiny and we are still polishing it',
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
  float s=0.0, a=0.5; mat2 m=rot(-0.42)*2.05;
  for(int i=0;i<4;i++){ s+=a*vn(p); p=m*p+8.3; a*=0.5; }
  return s;
}
vec3 spectrum(float t){ return 0.5+0.5*cos(TAU*(vec3(0.00,0.33,0.67)+t)); }

/* Long swell + chop on an endless mercury sea. Heights are dimensionless. */
float seaH(vec2 p, float T){
  mat2 r = rot(-0.52);
  vec2 q = r*p;
  float h = 0.62*sin(q.y*1.85 - T*0.13 + q.x*1.15)
          + 0.26*sin(q.y*4.10 + q.x*2.30 + T*0.21)
          + 0.13*sin(q.y*8.60 - q.x*3.10 - T*0.34);
  h += 0.65*(fbm(p*1.25 + vec2(T*0.028,-T*0.019))-0.5);
  h += 0.30*u_drive*sin(p.y*2.4 + p.x*1.6 + T*0.5);
  return h;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float asp = u_res.x/u_res.y;
  float T = mod(u_time, 4000.0);
  vec2 mouse = u_mouse*0.16;

  vec2 p = uv*vec2(asp*0.72, 1.0) + mouse;
  float e = 0.005;
  float h0 = seaH(p, T);
  float hx = seaH(p+vec2(e,0.0), T);
  float hy = seaH(p+vec2(0.0,e), T);
  float k = 2.4;                                    /* slope amplification */
  vec3 N = normalize(vec3(-(hx-h0)/e/k, -(hy-h0)/e/k, 1.0));

  /* studio lighting rig: a cold key strip high-left, a warm fill low-right */
  vec3 L1 = normalize(vec3(-0.55,0.78,0.52));
  vec3 L2 = normalize(vec3( 0.62,-0.35,0.45));
  vec3 V  = vec3(0.0,0.0,1.0);
  float spec1 = pow(max(dot(N,L1),0.0), 34.0);
  float spec2 = pow(max(dot(N,normalize(L1+L2)),0.0), 120.0);
  float fres  = pow(1.0-clamp(dot(N,V),0.0,1.0), 2.2);

  /* the reflected softbox: horizontal emissive bands swept by the slopes */
  float bandAxis = N.y*2.6 + h0*1.15;
  float soft = smoothstep(0.26,0.0,abs(bandAxis-0.36));
  float strip = smoothstep(0.055,0.0,abs(bandAxis+0.55));

  vec3 col = vec3(0.016,0.018,0.023);
  col += vec3(0.030,0.034,0.042)*smoothstep(-0.7,0.7,uv.y);

  /* base alloy — dark pewter with grazing intensity */
  vec3 alloy = vec3(0.046,0.051,0.062)
             + vec3(0.16,0.18,0.22)*smoothstep(-0.25,0.9,N.y)
             + vec3(0.30,0.33,0.38)*fres*0.55;

  /* brush pattern expands with scale so it never turns into moire */
  float brush = pow(abs(sin((N.x*40.0 + N.y*22.0) + T*0.10)), 34.0);

  col += alloy;
  float peri = 1.0 - 0.88*exp(-pow(length(uv*vec2(0.92,1.32)),1.9)*1.35);
  col += vec3(0.72,0.80,0.98)*soft*0.13*peri;
  col += vec3(0.96,0.84,1.00)*strip*0.060;
  col += vec3(0.80,0.88,1.00)*brush*(0.05 + 0.09*u_drive)*peri*peri;
  col += vec3(1.00,1.00,1.00)*spec1*0.62*(0.42+0.58*peri) + vec3(1.00,0.97,0.94)*spec2*0.85;

  /* thin-film diffraction lives on curvature, not on flats */
  float bend = atan(N.y, N.x);
  float curv = smoothstep(0.20,0.85,abs(N.x));     /* steep flanks only */
  col += spectrum(bend*0.16 + h0*0.28 + T*0.012) * (curv*0.14 + fres*0.17) * (0.55+0.45*peri);

  /* the far glitter line: micro chop catching the key at the horizon */
  float glit = pow(abs(sin(p.x*11.0 + fbm(p*3.1)*6.0 + T*0.4)), 60.0)
             * smoothstep(0.30,0.05,abs(uv.y+0.34));
  col += vec3(0.86,0.91,1.00)*glit*0.22;

  /* centre stays hushed under content: damp speculars in a soft oval */
  float cen = exp(-pow(length(uv*vec2(0.92,1.32)),1.9)*1.35);
  col = mix(col, col*vec3(0.62,0.66,0.74) + vec3(0.010,0.012,0.016), cen*0.72);

  /* horizon reflection event on shift / spike */
  float pring = smoothstep(0.055,0.0,abs(length(uv)-u_pulseAge*0.62))*exp(-u_pulseAge*0.55);
  col += spectrum(0.55+u_pulseAge*0.12)*pring*0.16*(1.0-cen*0.6);
  col += spectrum(0.48+N.x*0.3)*u_energy*0.018;

  /* optics */
  float vig = smoothstep(1.42,0.26,length(uv*vec2(0.9,1.05)));
  col *= mix(0.66,1.0,vig);
  col = 1.0-exp(-col*1.12);
  col = pow(col, vec3(0.96));
  col += (h12(frag+fract(T)*269.0)-0.5)*0.012;
  gl_FragColor = vec4(col,1.0);
}`,
};
