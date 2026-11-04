(window.NVTHEMES = window.NVTHEMES || {})['thermalscan'] = {
  id: 'thermalscan',
  name: 'THERMAL SCAN',
  tag: 'LWIR PLUME · HEAT SIGNATURE',
  theme: {
    light: false,
    accent:  '#ff3d7f',
    accent2: '#ffb43c',
    text:  '#ffeee6',
    muted: '#cda7a4',
    faint: '#856367',
    void:  '#08040a',
    panel: 'rgba(22,10,16,0.64)',
    line:  'rgba(255,120,150,0.16)',
    good:  '#4ef2c0',
    warn:  '#ffc14d',
    crit:  '#ff3d7f',
    info:  '#b388ff',
    radius: '12px',
    dim: 0.88,
    fonts: {
      display: "'Unbounded',sans-serif",
      head:    "'Archivo',sans-serif",
      mono:    "'DM Mono',monospace",
    },
    googleFonts: ['Unbounded:wght@700;800', 'Archivo:wght@500;700', 'DM+Mono:wght@400;500'],
  },
  login: {
    title: 'LWIR ARRAY',
    sub: 'LONG-WAVE INFRARED · 8–14 μm BAND',
    user: 'THERMOGRAPHER',
    pass: 'CALIBRATION KEY',
    button: 'START CAPTURE',
    granted: 'EMISSIVITY LOCKED · 0.95',
    denied: 'NO SIGNATURE — TOO COLD TO ENTER',
    boot: [
      'MICROBOLOMETER 640×512 ..... STABLE',
      'NUC (SHUTTER) .............. COMPLETE',
      'AMBIENT Δ .................. +21.4 K',
      'RANGE ...................... -20 to 650 °C',
      'READY.',
    ],
    footer: 'heat does not lie — it only spreads',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
uniform float u_drive; uniform float u_heat;
#define TAU 6.2831853

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h12(i),h12(i+vec2(1.,0.)),f.x), mix(h12(i+vec2(0.,1.)),h12(i+vec2(1.,1.)),f.x), f.y);
}
float fbm(vec2 p){
  float s=0.0, a=0.5; mat2 m=rot(0.7)*2.07;
  for(int i=0;i<5;i++){ s+=a*vn(p); p=m*p+13.1; a*=0.52; }
  return s;
}
/* black plum → indigo → magenta → ember → cream: the LWIR camo ramp */
vec3 heatRamp(float t){
  t = clamp(t,0.0,1.0);
  vec3 c0 = vec3(0.020,0.010,0.035);
  vec3 c1 = vec3(0.150,0.030,0.270);
  vec3 c2 = vec3(0.620,0.080,0.400);
  vec3 c3 = vec3(0.980,0.330,0.140);
  vec3 c4 = vec3(1.000,0.870,0.560);
  vec3 o = mix(c0,c1, smoothstep(0.00,0.28,t));
  o = mix(o,c2, smoothstep(0.24,0.52,t));
  o = mix(o,c3, smoothstep(0.50,0.78,t));
  o = mix(o,c4, smoothstep(0.80,1.00,t));
  return o;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float asp = u_res.x/u_res.y;
  float T = mod(u_time, 5000.0);
  vec2 mouse = u_mouse*0.10;

  vec3 col = vec3(0.030,0.016,0.046);
  /* ambient warm haze: the sensor sees thermal mass everywhere, thinly */
  float haze = fbm(uv*1.35 + vec2(T*0.015, -T*0.01));
  col += heatRamp(0.10 + haze*0.30)*0.30;

  /* two plumes rise from the lower corners: turbulent, buoyant, slow */
  float plume = 0.0;
  for(int i=0;i<2;i++){
    float fi = float(i);
    vec2 o = vec2((fi<0.5 ? -0.62 : 0.60)*asp + mouse.x, -0.62 + mouse.y*0.4);
    vec2 q = (uv - o)*vec2(2.1,1.25);
    q.x += sin(q.y*2.1 - T*0.16 + fi*2.3)*0.16;          /* sway */
    vec2 adv = q + vec2(fbm(q*0.9 + T*0.03)*0.55, T*0.045*1.7);
    float dens = fbm(adv*1.7);
    dens *= smoothstep(1.55, 0.05, length(q*vec2(0.80,1.35) - vec2(0.0,0.15)));
    plume = max(plume, dens);
  }

  /* pooled heat along the floor + a thin inversion layer near the horizon */
  float floorH = smoothstep(-0.18,-0.52, uv.y) * (0.35 + 0.5*fbm(uv*vec2(2.6,4.2)+T*0.02));
  float band   = smoothstep(0.030,0.0, abs(uv.y-0.34+0.012*sin(uv.x*3.0+T*0.10))) * (0.35+0.4*fbm(uv*3.3-T*0.05));

  float intensity = clamp(plume*1.20 + floorH*0.60 + band*0.38, 0.0, 1.0);
  intensity *= 0.86 + 0.14*u_drive;
  intensity += 0.10*u_heat*plume;
  intensity = pow(intensity, 1.35);

  col += heatRamp(intensity*0.92) * (0.72 + 1.05*intensity) * 0.80;
  /* darkest palette floor for the quiet zones keeps the stage readable */
  col += vec3(0.012,0.005,0.022);

  /* isolines: thermography contour rings over the plume body */
  float iso = abs(fract(intensity*7.5 + fbm(uv*2.2)*0.35) - 0.5);
  col += vec3(1.0,0.72,0.48) * smoothstep(0.475,0.5,iso) * smoothstep(0.04,0.50,intensity) * 0.085;

  /* sensor cosmetics: 60 Hz-ish micro beat + scanline pattern, no strobe */
  float scan = 0.5+0.5*sin(uv.y*620.0 + T*0.35);
  col *= 1.0 - 0.045*scan;

  /* reticle furniture at the corners */
  float rr = length(uv);
  float ticks = smoothstep(0.0016,0.0, abs(fract((atan(uv.y,uv.x)/TAU)*72.0)-0.5)-0.48) *
                smoothstep(0.70,0.74,rr)*smoothstep(0.90,0.78,rr);
  col += vec3(0.95,0.55,0.35)*ticks*0.16;
  float cross_h = smoothstep(0.0009,0.0, abs(uv.y)) * smoothstep(0.055,0.0,abs(uv.x));
  float cross_v = smoothstep(0.0009,0.0, abs(uv.x)) * smoothstep(0.055,0.0,abs(uv.y));
  col += vec3(1.0,0.85,0.70)*(cross_h+cross_v)*0.16;

  /* pulse: a calibration shutter sweeps top-down */
  float shPos = -0.62 + mod(u_pulseAge*0.55, 1.55);
  float shutter = smoothstep(0.06,0.0, abs(uv.y - shPos));
  col += vec3(0.95,0.75,0.55)*shutter*exp(-u_pulseAge*0.8)*0.22;

  /* corner cool-blues counterbalance the magma */
  float cedge = smoothstep(0.95,1.25,length(uv*vec2(0.78,1.0)));
  col = mix(col, col*vec3(0.75,0.80,1.10), cedge*0.7);

  float vig = smoothstep(1.42,0.30,length(uv*vec2(0.88,1.05)));
  col *= mix(0.66,1.0,vig);
  col = 1.0-exp(-col*1.28);
  col += (h12(frag+fract(T)*211.0)-0.5)*0.017;
  gl_FragColor = vec4(col,1.0);
}`,
};
