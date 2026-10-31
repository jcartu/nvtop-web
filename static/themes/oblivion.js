(window.NVTHEMES = window.NVTHEMES || {})['oblivion'] = {
  id: 'oblivion',
  name: 'SKYTOWER',
  tag: 'TET CONTROL · OBLIVION',
  theme: {
    light: true,
    accent:  '#3fb6cf',
    accent2: '#eef7fa',
    text:  '#1e2a33',
    muted: '#485964',
    faint: '#7b8d99',
    void:  '#dfe9ef',
    panel: 'rgba(255,255,255,0.55)',
    line:  'rgba(94,124,142,0.32)',
    good:  '#177a4c',
    warn:  '#96660a',
    crit:  '#b23327',
    info:  '#22759b',
    radius: '4px',
    fonts: {
      display: "'Michroma',sans-serif",
      head:    "'Jost',sans-serif",
      mono:    "'Space Mono',monospace",
    },
    googleFonts: ['Michroma', 'Jost:wght@400;600', 'Space+Mono:wght@400;700'],
  },
  login: {
    title: 'SKYTOWER 49',
    sub: 'TET UPLINK · MISSION CONTROL',
    user: 'TECH ID',
    pass: 'CLEARANCE CODE',
    button: 'AUTHENTICATE',
    granted: 'WELCOME, TECH 49',
    denied: 'UNAUTHORIZED — DRONE DISPATCHED',
    boot: [
      'DRONE 166 UPLINK .... ONLINE',
      'HYDRO RIG DELTA-7 .... NOMINAL',
      'GRID SECTOR SWEEP .... CLEAR',
      'TET SYNC WINDOW 0400 .... LOCKED',
      'READY.',
    ],
    footer: 'another day in paradise · are you an effective team?',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;
#define TAU 6.2831853

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h12(i),h12(i+vec2(1.0,0.0)),f.x), mix(h12(i+vec2(0.0,1.0)),h12(i+vec2(1.0,1.0)),f.x), f.y);
}
float fbm(vec2 p){
  float s=0.0, a=0.5; mat2 m = rot(0.62)*2.03;
  for(int i=0;i<5;i++){ s += a*vn(p); p = m*p + 11.7; a *= 0.52; }
  return s;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float px = 1.4/u_res.y;
  float T = mod(u_time, 3600.0);
  float E = clamp(u_energy, 0.0, 1.0);
  vec2 M = u_mouse;

  /* ---------- sky: bright white-blue gradient, center kept luminous ---------- */
  vec3 zen = vec3(0.42, 0.62, 0.84);
  vec3 mid = vec3(0.70, 0.805, 0.915);
  vec3 low = vec3(0.905, 0.935, 0.955);
  vec3 col = mix(mid, zen, smoothstep(0.06, 0.62, uv.y - M.y*0.03));
  col = mix(low, col, smoothstep(-0.30, 0.12, uv.y));

  /* thin high cirrus streaks */
  float cir = fbm(vec2(uv.x*2.4 - T*0.006, uv.y*11.0 + 3.0));
  cir = smoothstep(0.52, 0.78, cir)*smoothstep(0.02, 0.22, uv.y)*smoothstep(0.62, 0.30, uv.y);
  col = mix(col, vec3(0.97, 0.98, 0.99), cir*0.35);

  /* ---------- pale sun, high off-center, delicate glare ---------- */
  vec2 sp = vec2(0.585, 0.335) + M*0.05;
  vec2 sd = uv - sp;
  float dsun = length(sd);
  col += vec3(1.00, 0.99, 0.93)*exp(-dsun*dsun*220.0)*1.5;
  col += vec3(1.00, 0.96, 0.84)*exp(-dsun*2.6)*0.19;
  col += vec3(1.00, 0.98, 0.92)*exp(-abs(sd.y)*95.0)*exp(-abs(sd.x)*3.8)*0.20;
  col += vec3(0.98, 0.99, 1.00)*exp(-abs(sd.x)*80.0)*exp(-abs(sd.y)*5.5)*0.10;
  col += vec3(0.80, 0.92, 1.00)*exp(-abs(dsun - 0.15)*70.0)*0.05;    /* lens ghost ring */

  /* ---------- sea of clouds below the horizon (perspective fbm deck) ---------- */
  float hy = -0.155 + M.y*0.02;
  if (uv.y < hy + 0.06){
    float dpt = 0.22/(hy - uv.y + 0.052);              /* far at horizon, near at bottom */
    vec2 cp = vec2((uv.x + M.x*0.06)*dpt, dpt) + vec2(T*0.0075, T*0.0115);
    float n  = fbm(cp*1.7);
    n = n*0.72 + 0.55*fbm(cp*4.4 + 7.0)*n;             /* billowy detail rides the big forms */
    float n2 = fbm(cp*1.7 + vec2(0.16, -0.12));        /* sample toward the sun */
    float litf = clamp((n - (n2*0.72 + 0.55*fbm(cp*4.4 + vec2(7.16, 6.88))*n2))*7.5 + 0.38, 0.0, 1.4);
    vec3 cshade = vec3(0.375, 0.495, 0.715);
    vec3 clit   = vec3(1.03, 1.01, 0.975);
    vec3 cloud = mix(cshade, clit, clamp(litf*(0.28 + 0.85*n), 0.0, 1.2));
    float hz = exp(-max(dpt - 0.42, 0.0)*0.72);        /* aerial haze with distance */
    cloud = mix(low + vec3(0.0, 0.01, 0.02), cloud, clamp(hz + 0.08, 0.0, 1.0));
    float edge = hy + (n - 0.5)*0.052;                 /* fluffy horizon */
    float m = smoothstep(edge + 0.004, edge - 0.035, uv.y);
    col = mix(col, cloud, m);
    /* thin warm cloud-top rim right along the horizon */
    col += vec3(0.07, 0.055, 0.03)*exp(-abs(uv.y - edge)*80.0)*(1.0 - m)*0.9;
  }

  /* ---------- Sky Tower HUD: ultra-thin concentric arcs, edge-biased ---------- */
  vec2 rc = uv - vec2(0.0, -0.01) - M*0.035;
  float rr = length(rc);
  float an = atan(rc.y, rc.x);
  vec3 ink  = vec3(0.115, 0.455, 0.565);               /* pale-cyan ink (darkens the sky) */
  vec3 glowc = vec3(0.36, 0.80, 0.90);
  float ringA = 0.0, glowA = 0.0;

  /* drone scan sweep: rotating angular falloff, driven by energy */
  float sw = mod(an - T*0.55, TAU);
  float sweep = exp(-sw*2.3);
  float boost = 1.0 + E*(0.75 + 2.4*sweep);

  for(int i=0;i<5;i++){
    float fi = float(i);
    float R = 0.545 + fi*0.148 + 0.012*sin(T*0.10 + fi*1.7);
    float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float ph = T*dir*(0.014 + 0.026*h12(vec2(fi, 3.1))) + fi*0.37;
    float aN = an/TAU + ph;
    float segN = 3.0 + fi;                              /* long arc segments */
    float arcOn = step(fract(aN*segN), 0.52 + 0.22*h12(vec2(fi, 9.2)));
    float fine = mix(1.0, step(fract(aN*(38.0 + fi*21.0)), 0.72), step(0.5, h12(vec2(fi, 5.5))));
    float line = smoothstep(px*2.1, px*0.5, abs(rr - R));
    ringA += line*arcOn*fine*(0.62 + 0.25*h12(vec2(fi, 7.7)));
  }

  /* heavier accent arcs: two short thick segments sliding on rings 2 and 4 */
  float aa1 = mod(an - T*0.045, TAU);
  ringA += smoothstep(px*3.2, px*1.0, abs(rr - 0.841))*smoothstep(0.62, 0.55, aa1)*step(0.10, aa1)*0.85;
  float aa2 = mod(-an - T*0.032 + 2.1, TAU);
  ringA += smoothstep(px*3.2, px*1.0, abs(rr - 0.575))*smoothstep(0.40, 0.34, aa2)*step(0.06, aa2)*0.85;
  /* small square nodes at the quadrants of the tick ring */
  vec2 qn = abs(vec2(fract(an/TAU*4.0 + 0.125) - 0.5, rr - 0.629));
  ringA += step(max(qn.x*0.629*TAU*0.25, qn.y), 0.0075)*0.9;

  /* tick combs: fine at 0.62, coarse at 0.91 */
  float arcd1 = abs(fract(an/TAU*96.0 + T*0.010) - 0.5)/96.0*TAU*rr;
  float band1 = smoothstep(0.0, 0.004, rr - 0.615)*smoothstep(0.0, 0.004, 0.643 - rr);
  ringA += smoothstep(px*1.6, px*0.4, arcd1)*band1*0.5;
  float arcd2 = abs(fract(an/TAU*48.0 - T*0.014) - 0.5)/48.0*TAU*rr;
  float band2 = smoothstep(0.0, 0.004, rr - 0.895)*smoothstep(0.0, 0.004, 0.940 - rr);
  ringA += smoothstep(px*1.6, px*0.4, arcd2)*band2*0.55;

  /* orbit marker: small tracked dot on the inner ring */
  float ma = T*0.11;
  vec2 mp = vec2(cos(ma), sin(ma))*0.695;
  ringA += smoothstep(0.011, 0.004, length(rc - mp))*0.9;
  glowA += exp(-dot(rc - mp, rc - mp)*2600.0)*0.7;
  /* bracket ticks flanking the marker */
  ringA += smoothstep(px*1.6, px*0.4, abs(length(rc - mp) - 0.022))*step(0.5, fract(an*2.0/TAU + 0.25))*0.0;

  float centerFade = smoothstep(0.30, 0.52, rr);       /* keep the middle clean */
  ringA *= centerFade*boost;
  glowA *= centerFade;

  /* left-edge altimeter scale: hairline, ticks, sliding caret */
  float lx = -0.80 - M.x*0.02;
  float inBand = smoothstep(0.0, 0.02, uv.y + 0.24)*smoothstep(0.0, 0.02, 0.36 - uv.y);
  ringA += smoothstep(px*1.6, px*0.4, abs(uv.x - lx))*inBand*0.45;
  float ty = abs(fract(uv.y*20.0) - 0.5)/20.0;
  float tlen = mix(0.010, 0.020, step(fract(uv.y*4.0 + 0.002), 0.05));
  ringA += smoothstep(px*1.5, px*0.4, ty)*step(uv.x - lx, tlen)*step(0.0, uv.x - lx)*inBand*0.5;
  float cy = 0.06 + 0.20*sin(T*0.07) + 0.06*sin(T*0.23 + 2.0);
  vec2 cq = vec2(uv.x - lx + 0.016, (uv.y - cy)*1.0);
  ringA += smoothstep(px*1.5, px*0.4, abs(cq.x) + abs(cq.y)*1.2 - 0.008)*0.9;   /* caret diamond */
  /* tiny data dashes beside the caret */
  float rowd = step(abs(fract((uv.y - cy)*60.0) - 0.5), 0.22)*step(h12(vec2(floor((uv.y - cy)*60.0), floor(T*0.5))), 0.6);
  ringA += rowd*step(0.022, uv.x - lx)*step(uv.x - lx, 0.062)*step(abs(uv.y - cy), 0.026)*0.55;

  col = mix(col, ink, clamp(ringA, 0.0, 1.0)*0.62);
  col += glowc*glowA*0.22;
  col += glowc*clamp(ringA, 0.0, 1.0)*sweep*E*0.30;    /* sweep lights the arcs cyan */

  /* ---------- event shockwave: faint circular pressure wave ---------- */
  float wave = exp(-pow((rr - u_pulseAge*0.55)*9.0, 2.0))*exp(-u_pulseAge*0.9);
  col += vec3(0.42, 0.72, 0.82)*wave*0.10;
  col = mix(col, ink, wave*0.10*centerFade);

  /* ---------- finish: gentle corner shade + subtle grain ---------- */
  col *= 1.0 - 0.13*smoothstep(0.55, 1.15, length(uv*vec2(0.85, 1.0)));
  col += (h12(frag + fract(T)*17.0) - 0.5)*0.018;
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`,
};
