(window.NVTHEMES = window.NVTHEMES || {})['arrakis'] = {
  id: 'arrakis',
  name: 'ARRAKIS',
  tag: 'DUNE · SPICE OPERATIONS',
  theme: {
    light: false,
    accent:  '#e8a25c',
    accent2: '#f5e3c8',
    text:  '#f1e4cc',
    muted: '#c6a37b',
    faint: '#87694a',
    void:  '#120a04',
    panel: 'rgba(26,15,6,0.55)',
    line:  'rgba(232,162,92,0.15)',
    good:  '#a8c97d',
    warn:  '#f0b45c',
    crit:  '#e8574d',
    info:  '#8cb8c9',
    radius: '12px',
    fonts: {
      display: "'Cinzel',serif",
      head:    "'Cormorant Garamond',serif",
      mono:    "'Cutive Mono',monospace",
    },
    googleFonts: ['Cinzel:wght@600;700', 'Cormorant+Garamond:wght@500;600', 'Cutive+Mono'],
  },
  login: {
    title: 'ARRAKEEN CITADEL',
    sub: 'SPICE OPERATIONS COMMAND · MUAD\'DIB',
    user: 'HOUSE SIGIL',
    pass: 'THE LITANY',
    button: 'MOUNT THE WORM',
    granted: 'LISAN AL-GAIB',
    denied: 'FEAR IS THE MIND-KILLER — TRY AGAIN',
    boot: [
      'SHIELD WALL INTEGRITY ......... HOLDING',
      'ORNITHOPTER WING 7 ............ AIRBORNE',
      'HARVESTER CRAWLER, SECTOR 9 ... SPICE FLOW NOMINAL',
      'WORMSIGN MONITOR .............. CLEAR',
      'THUMPER ARRAY ................. ARMED',
    ],
    footer: 'the spice must flow',
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
float fbm(vec2 p){
  float a = 0.5; float s = 0.0;
  for(int i=0;i<4;i++){ s += a*noise2(p); p = p*2.03 + vec2(11.3,7.9); a *= 0.5; }
  return s;
}
/* ridged dune profile along x */
float ridge(float x, float s){
  float h = 0.0; float a = 0.55; float f = 1.0;
  for(int i=0;i<3;i++){
    h += a*(1.0 - abs(2.0*noise2(vec2(x*f, s + float(i)*9.7))-1.0));
    a *= 0.5; f *= 2.15; x += 7.3;
  }
  return h;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  vec2 sv = uv;
  vec2 m = u_mouse;
  float en = clamp(u_energy, 0.0, 1.0);
  float T = mod(u_time, 1200.0);
  float pa = max(u_pulseAge, 0.0);
  float pw = exp(-pa*0.6);

  /* ---- worm-sign clocks: periodic (~12s) + event pulse ---- */
  float cyc = mod(T, 12.0);
  float env1 = smoothstep(0.0, 1.0, cyc)*smoothstep(7.0, 5.0, cyc);
  float wp1  = clamp(cyc/7.0, 0.0, 1.0);
  float env2 = smoothstep(0.0, 0.4, pa)*smoothstep(5.0, 3.2, pa);
  float wp2  = clamp(pa/5.0, 0.0, 1.0);

  /* ---- heat shimmer hugging the horizon ---- */
  float hy = -0.055;
  float shm = noise2(vec2(uv.x*26.0 + T*1.2, uv.y*70.0 - T*2.4)) - 0.5;
  shm += 0.5*(noise2(vec2(uv.x*55.0 - T*1.7, uv.y*130.0 - T*4.0)) - 0.5);
  float smask = exp(-abs(uv.y - hy)*9.0);
  vec2 suv = uv + shm*vec2(0.010, 0.006)*smask*(1.0 + 1.6*en);

  /* ---- dusk sky: umber gradient, glow pooled toward the sun ---- */
  vec2 sp = vec2(0.55 + m.x*0.05, hy + 0.105 + m.y*0.03);
  float sk = clamp((suv.y - hy)*1.5, 0.0, 1.0);
  vec3 skyTop = vec3(0.024,0.014,0.010);
  vec3 skyHz  = vec3(0.165,0.078,0.030);
  float hzBias = 0.35 + 0.65*exp(-abs(suv.x - sp.x)*1.35);
  vec3 col = mix(skyHz*hzBias, skyTop, pow(sk, 0.55));

  /* dust bands drifting across the sky */
  float dust = fbm(vec2(suv.x*2.2 - T*0.02, suv.y*7.0 + 3.0));
  col *= 0.82 + 0.36*dust;

  /* colossal dim sun/moon behind haze */
  float sd = length((suv - sp)*vec2(1.0, 1.06));
  float haze = 0.55 + 0.45*fbm(vec2(suv.x*5.0 + T*0.03, suv.y*24.0));
  float disc = smoothstep(0.150, 0.136, sd);
  float bands = 0.82 + 0.18*sin(suv.y*150.0 + fbm(suv*8.0)*4.0);
  col += vec3(1.0,0.56,0.22)*disc*0.52*bands*haze;
  col += vec3(1.0,0.50,0.19)*exp(-sd*3.4)*0.16*haze*(1.0 + 0.35*en);

  /* faint stars up high */
  vec2 stg = suv*90.0;
  vec2 sid = floor(stg); vec2 sf = fract(stg) - 0.5;
  vec2 so = (hash22(sid) - 0.5)*0.6;
  float star = exp(-dot(sf-so, sf-so)*110.0)*step(0.93, hash12(sid + 7.0));
  float tw = 0.6 + 0.4*sin(T*3.0 + hash12(sid)*6.2831);
  col += vec3(0.9,0.85,0.78)*star*tw*0.30*smoothstep(0.10, 0.45, suv.y);

  /* ---- four parallax dune ridges, far to near ---- */
  float wormX = 0.0; float wormH = -10.0; float wormX2 = 0.0; float wormH2 = -10.0;
  for(int L=0; L<4; L++){
    float fl = float(L);
    float depth = fl/3.0;
    float base = -0.02 - 0.34*pow(max(depth, 0.001), 1.35);
    base += (0.045 + 0.05*depth)*sin(suv.x*(1.05 + 0.55*fl) + fl*2.3 + 0.8)
          + 0.03*depth*sin(suv.x*3.1 + fl*4.1);                   /* long swells so ridges cross */
    float amp  = mix(0.07, 0.155, depth);
    float freq = mix(1.7, 0.95, depth);
    float seed = fl*13.1 + 3.0;
    float par  = m.x*(0.02 + 0.07*depth) + T*0.004*(0.15 + depth*0.5);
    float sx = (suv.x + par)*freq;

    float hA = base + amp*(ridge(sx, seed) - 0.55);
    float hB = base + amp*(ridge(sx + 0.02, seed) - 0.55);

    /* worm-sign: ripple traveling along this ridge + stash puff anchor */
    if(L == 2){
      float wx = mix(-1.15, 1.15, wp1);
      float dw = suv.x - wx;
      float rip = exp(-dw*dw*50.0)*(0.017 + 0.006*sin(suv.x*60.0 - T*8.0));
      hA += env1*rip; hB += env1*rip;
      wormX = wx;
      wormH = base + amp*(ridge((wx + par)*freq, seed) - 0.55) + env1*0.02;
    }
    if(L == 1){
      float wx2 = mix(-1.15, 1.15, wp2);
      float dw2 = suv.x - wx2;
      float rip2 = exp(-dw2*dw2*50.0)*(0.015 + 0.006*sin(suv.x*70.0 - T*9.0));
      hA += env2*rip2; hB += env2*rip2;
      wormX2 = wx2;
      wormH2 = base + amp*(ridge((wx2 + par)*freq, seed) - 0.55) + env2*0.018;
    }

    float d = hA - suv.y;
    float fill = smoothstep(0.0, 0.0025, d);
    float slope = (hB - hA)/0.02;
    float lit = clamp(slope*sign(sp.x - suv.x)*1.6, 0.0, 1.0);

    vec3 dc = mix(vec3(0.110,0.054,0.022), vec3(0.013,0.008,0.005), depth);
    float tex = fbm(vec2(sx*7.0, d*20.0 + seed));
    dc *= 0.55 + 1.05*tex;
    /* wind ripples raking the faces */
    float rip = 0.5 + 0.5*sin(sx*70.0 + d*55.0 + fbm(vec2(sx*9.0, d*30.0))*6.0);
    dc *= 1.0 + 0.22*rip*depth;
    /* broad sun-side glow on windward slopes */
    float sunProx = exp(-abs(suv.x - sp.x)*1.15);
    dc += vec3(0.34,0.155,0.055)*lit*(0.30 + 0.45*depth)*sunProx*(0.55 + 0.45*rip);
    dc += vec3(0.012,0.010,0.009)*tex*depth;               /* cool skylight keeps foreground alive */
    dc = mix(dc, skyHz*0.95, (1.0 - depth)*(1.0 - depth)*0.38);  /* aerial haze ties far dunes to sky */

    /* crest rim: thin, broken by noise, strongest on near dunes toward the sun */
    float rim = smoothstep(0.008 + 0.006*depth, 0.0, d);
    float rimN = 0.25 + 0.75*noise2(vec2(sx*3.2, seed*1.7));
    float rimI = rim*rimN*(0.10 + 0.42*depth)*(0.15 + 0.85*sunProx)*(1.0 + 0.9*en + 0.7*pw);

    col = mix(col, dc, fill);
    col += vec3(0.91,0.635,0.36)*rimI*fill;
  }

  /* atmospheric sun bloom wrapping over the ridge line */
  col += vec3(1.0,0.52,0.20)*exp(-length(suv - sp)*2.3)*0.055*(1.0 + 0.4*en);

  /* ---- worm-sign dust puffs ---- */
  float pfx = suv.x - wormX; float pfy = suv.y - (wormH + 0.015);
  float puff = exp(-(pfx*pfx*45.0 + pfy*pfy*260.0))*env1;
  puff *= 0.6 + 0.6*fbm(suv*22.0 + vec2(-T*0.6, T*0.3));
  col += vec3(0.60,0.34,0.16)*puff*0.55;
  float qfx = suv.x - wormX2; float qfy = suv.y - (wormH2 + 0.014);
  float puff2 = exp(-(qfx*qfx*45.0 + qfy*qfy*260.0))*env2;
  puff2 *= 0.6 + 0.6*fbm(suv*22.0 + vec2(T*0.5, T*0.35));
  col += vec3(0.62,0.36,0.17)*puff2*0.55;

  /* ---- spice glints: warm sparks rising on the wind, 2 depths ---- */
  vec3 gl = vec3(0.0);
  for(int i=0; i<2; i++){
    float fi = float(i);
    float sc = 12.0 + 8.0*fi;
    vec2 q = sv*sc;
    q.x += T*(0.28 + 0.20*fi) + m.x*(3.0 - fi);
    q.y -= T*(0.55 + 0.32*fi)*(1.0 + 1.1*en);
    vec2 id = floor(q); vec2 fr = fract(q) - 0.5;
    vec2 rn = hash22(id + fi*53.0);
    float gate = step(0.90 - 0.08*en - 0.05*pw, rn.x);
    vec2 off = (rn - 0.5)*0.6;
    float dd = dot(fr - off, fr - off);
    float s = exp(-dd*90.0) + 0.15*exp(-dd*20.0);
    float twk = 0.5 + 0.5*sin(T*(6.0 + 6.0*rn.y) + rn.x*6.2831);
    gl += mix(vec3(1.0,0.58,0.22), vec3(1.0,0.80,0.52), rn.y)*gate*s*twk*(0.09 + 0.05*fi);
  }
  col += gl*(0.15 + 0.85*smoothstep(0.10, -0.42, sv.y))*(1.0 + 1.3*en);

  /* ---- grade: vignette, filmic curve, fine sand grain ---- */
  col *= 1.0 - 0.45*dot(sv, sv);
  col = 1.0 - exp(-col*1.6);
  col = pow(col, vec3(0.92));
  col += (hash12(frag + fract(T)*311.0) - 0.5)*0.018;
  gl_FragColor = vec4(col, 1.0);
}`,
};
