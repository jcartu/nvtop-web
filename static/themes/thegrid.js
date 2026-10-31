(window.NVTHEMES = window.NVTHEMES || {})['thegrid'] = {
  id: 'thegrid',
  name: 'THE GRID',
  tag: 'TRON: LEGACY · ENCOM OS-12',
  theme: {
    light: false,
    accent:  '#5ff2ff',
    accent2: '#ff9430',
    text:  '#dff6fc',
    muted: '#7fa9ba',
    faint: '#3d5768',
    void:  '#020408',
    panel: 'rgba(4,12,22,0.58)',
    line:  'rgba(95,242,255,0.16)',
    good:  '#3affa8',
    warn:  '#ffb43c',
    crit:  '#ff4f30',
    info:  '#5fb0ff',
    radius: '2px',
    fonts: {
      display: "'Orbitron',sans-serif",
      head:    "'Exo 2',sans-serif",
      mono:    "'Share Tech Mono',monospace",
    },
    googleFonts: ['Orbitron:wght@500;700;900', 'Exo+2:wght@400;600', 'Share+Tech+Mono'],
  },
  login: {
    title: 'THE GRID',
    sub: 'ENCOM OS-12 · SEA OF SIMULATION',
    user: 'PROGRAM ID',
    pass: 'IDENTITY DISC',
    button: 'ENTER THE GRID',
    granted: 'WELCOME TO THE GRID, PROGRAM',
    denied: 'DEREZZED',
    boot: [
      'ENCOM OS-12 KERNEL .... ONLINE',
      'BIT COPROCESSOR .... YES',
      'RECOGNIZER PATROL 7 .... DISPATCHED',
      'SOLAR SAILER 4-6-5 .... ON SCHEDULE',
      'PORTAL CYCLE 89 .... APERTURE STABLE',
    ],
    footer: 'greetings, programs · your GPUs fight for the users',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash11(float n){ return hash21(vec2(n, 17.17)); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), f.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5, r = 0.0;
  for (int i = 0; i < 4; i++){ r += a*vnoise(p); p = p*2.03 + vec2(19.7, 7.3); a *= 0.5; }
  return r;
}
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0); }

/* run depth for segment n of a cycle: 2-unit lanes so jogs read clearly, clamped in front of camera */
float lvlOf(float n, float seed, float zb){ return max(zb + 2.0*(floor(hash11(n+seed)*5.0) - 2.0), 0.8); }

/* ---- one light cycle: staircase path on the plan (u = travel axis, y = depth),
   90-degree hash-driven jogs, wall-band rendering, derezzing tail, head flare ---- */
vec3 cycle(vec2 plan, float band, float Tc, float v, float d, float P, float zb, float hist, float seed, vec3 tint){
  float ageU = mod(v*Tc - plan.x, P);   /* how far behind the head this column is */
  float age  = ageU / v;
  float f = 1.0 - age/hist;
  vec3 col = vec3(0.0);
  if (f > 0.0){
    float tp  = Tc - age;               /* when the cycle passed this column */
    float n   = floor(tp/d);
    float lvl = lvlOf(n, seed, zb);
    float dzs = (plan.y - lvl)/band;      /* signed height across the wall band */
    float dz  = abs(plan.y - lvl);
    float wall  = smoothstep(band, band*0.55, dz);        /* flat-top light wall */
    wall *= mix(1.25, 0.60, smoothstep(-1.0, 1.0, dzs));  /* hotter at the base */
    float base  = exp(-(dzs+0.85)*(dzs+0.85)*9.0);        /* floor-contact line */
    float core  = exp(-dz*dz/(band*band*0.10 + 1e-5));    /* white-hot center stripe */
    float spill = 0.10/(dz*dz + 0.22);                    /* light pooling on the glass */
    /* tail derezz: voxel dropout + shatter glints */
    float dr  = smoothstep(0.0, 0.22, f);
    float vox = step(0.30 + 0.55*dr, hash21(vec2(floor(plan.x*2.0), n) + floor(Tc*14.0) + seed));
    float B = (f*f*0.85 + 0.15*f) * mix(vox, 1.0, dr);
    B += (1.0-dr)*vox*f*1.4;
    col += (tint*(wall*0.80 + base*0.55 + spill*0.55) + vec3(1.0)*core*wall*0.85) * B;
    /* the 90-degree jog connectors bracketing this run */
    for (int j = 0; j < 2; j++){
      float nb = n + float(j);
      float bAge = Tc - nb*d;
      if (bAge > 0.0 && bAge < hist){
        float z1 = lvlOf(nb-1.0, seed, zb);
        float z2 = lvlOf(nb, seed, zb);
        float dx  = abs(ageU - v*bAge);
        float dzc = max(max(min(z1,z2)-plan.y, plan.y-max(z1,z2)), 0.0);
        float dc2 = dx*dx + dzc*dzc;
        float fb  = 1.0 - bAge/hist;
        col += (tint*(0.30/(dc2*0.6+0.06)) + vec3(1.0)*exp(-dc2*10.0)*0.9) * fb*fb;
      }
    }
  }
  /* head flare */
  float nh  = floor(Tc/d);
  float lvh = lvlOf(nh, seed, zb);
  float hx  = min(ageU, P-ageU);
  float hd2 = hx*hx + (plan.y-lvh)*(plan.y-lvh);
  col += (vec3(1.0)*0.06 + tint*0.10)/(hd2*14.0 + 0.05);
  return col;
}

/* the race: three resident cycles (one orange rival) + one energy-spawned sprinter */
vec3 trails(vec2 plan, float band, float T, float E){
  vec3 cyan = vec3(0.24, 1.00, 1.15);
  vec3 orng = vec3(1.15, 0.50, 0.10);
  vec3 c = vec3(0.0);
  c += cycle(vec2( plan.x, plan.y), band, T+ 13.7,  6.5, 0.55, 42.0, 4.2, 4.5,  7.0, cyan);
  c += cycle(vec2(-plan.x, plan.y), band, T+ 57.3,  8.5, 0.45, 46.0, 7.0, 3.8, 23.0, cyan);
  c += cycle(vec2(-plan.x, plan.y), band, T+101.9,  7.0, 0.70, 48.0, 3.4, 6.0, 41.0, orng*1.3);
  c += cycle(vec2( plan.x, plan.y), band, T+ 71.1, 11.0, 0.40, 44.0, 5.4, 3.0, 59.0, cyan*1.1) * E;
  return c * (1.45 + 0.8*E);
}

/* recognizer: the squared arch, dark hull + hairline edge light + warm cockpit */
vec3 recog(vec2 p, out float sil, out float halo){
  float outer = sdBox(p, vec2(1.0, 1.05)) - 0.10;
  float cut   = sdBox(p + vec2(0.0, 0.42), vec2(0.60, 1.05));
  float s = max(outer, -cut);
  sil = smoothstep(0.012, -0.012, s);
  halo = exp(-max(s, 0.0)*2.2);
  float edge = exp(-abs(s)*38.0);
  float inner = exp(-abs(s+0.20)*50.0);                 /* inner hull contour */
  float ribs = smoothstep(0.10, 0.02, abs(fract(p.x*2.5)-0.5)*0.4)*step(s, -0.06)*0.10;
  float eye  = exp(-max(sdBox(p - vec2(0.0, 0.52), vec2(0.30, 0.10)), 0.0)*30.0);
  return vec3(0.55, 0.95, 1.0)*(edge*0.45 + inner*0.14 + ribs) + vec3(1.0, 0.62, 0.30)*eye*0.55;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  float T = mod(u_time, 1200.0);
  float E = clamp(u_energy, 0.0, 1.0);
  vec2 M = u_mouse;
  float h = -0.02 + M.y*0.025;            /* horizon, subtle mouse parallax */
  float pa = min(u_pulseAge, 30.0);
  float px = 0.335 + M.x*0.05;            /* portal beam x */
  float flick = 0.85 + 0.15*sin(T*2.1) + 0.05*sin(T*9.7);
  float camH = 0.32, hw = 0.09;
  float cdip = 1.0 - 0.5*exp(-uv.x*uv.x*12.0);  /* keep dead-center horizon quiet */
  vec3 col;

  /* recognizer placement (shared by sky + reflection) */
  vec2 rc = vec2(-0.36 + 0.10*sin(T*0.05) + M.x*0.03, 0.205 + 0.018*sin(T*0.11));
  float ca = 0.05*sin(T*0.07);
  mat2 rrot = mat2(cos(ca), -sin(ca), sin(ca), cos(ca));

  if (uv.y >= h){
    /* ================= SKY ================= */
    float ha = uv.y - h;
    col = vec3(0.004, 0.007, 0.012)*(1.0 - ha*1.1);
    /* volumetric data-clouds, drifting */
    vec2 cp = vec2(uv.x*1.6 + M.x*0.05 + T*0.006, uv.y*3.2 - T*0.004);
    float cl = fbm(cp*2.4); cl = cl*cl;
    col += vec3(0.05, 0.14, 0.22)*cl*exp(-ha*3.6)*0.75;
    col += vec3(0.03, 0.10, 0.18)*fbm(cp*5.0 + 7.7)*exp(-ha*7.0)*0.5;
    /* horizon city glow, banded */
    float bands = 0.55 + 0.45*vnoise(vec2(uv.x*7.0 + M.x*0.4, 3.7));
    col += vec3(0.25, 0.75, 0.95)*exp(-ha*22.0)*bands*cdip*(0.37 + 0.38*E);
    col += vec3(0.90, 1.00, 1.00)*exp(-ha*130.0)*0.34*cdip;
    /* the portal: a far column of white light */
    float beam = exp(-abs(uv.x-px)*(26.0 - 6.0*E))*exp(-ha*7.0);
    col += vec3(0.75, 0.95, 1.0)*beam*0.42*flick*(1.0 + 0.8*E);
    col += vec3(0.40, 0.80, 1.0)*exp(-abs(uv.x-px)*7.0)*exp(-ha*3.0)*0.07;
    /* recognizer on patrol */
    vec2 rp = rrot*((uv - rc)/0.10); rp.y *= 1.35;
    float sil, hal; vec3 rl = recog(rp, sil, hal);
    col += vec3(0.10, 0.30, 0.42)*hal*0.16*(1.0-sil);      /* rim haze backlights the hull */
    col = mix(col, vec3(0.004, 0.006, 0.010), sil*0.96);   /* solid dark mass */
    col += rl*0.85;
    /* wingman recognizer, high right, further out */
    vec2 rp2 = (uv - vec2(0.47 - 0.06*sin(T*0.04), 0.30 + 0.012*sin(T*0.09)))/0.045; rp2.y *= 1.35;
    float sil2, hal2; vec3 rl2 = recog(rp2, sil2, hal2);
    col += vec3(0.10, 0.30, 0.42)*hal2*0.08*(1.0-sil2);
    col = mix(col, vec3(0.004, 0.006, 0.010), sil2*0.85);
    col += rl2*0.55;
  } else {
    /* ================= GLASS FLOOR ================= */
    float yd = max(h - uv.y, 1e-4);
    float zf = camH/yd;
    vec2 plan = vec2(uv.x*zf + M.x*0.4 + 0.5, zf);   /* +0.5 keeps lines off dead center */
    col = vec3(0.004, 0.007, 0.013)*(1.0 - yd*0.8);
    col += vec3(0.02, 0.06, 0.09)*exp(-yd*6.0);   /* fresnel sheen at grazing angle */
    /* hairline grid, minor + major, fogged out toward the horizon */
    float pw  = zf/(u_res.y*0.7);
    float pwz = zf*zf/(camH*u_res.y*0.7);
    float dlx = abs(fract(plan.x+0.5)-0.5);
    float dlz = abs(fract(plan.y+0.5)-0.5);
    float gridI = max(smoothstep(pw*1.8,  pw*0.4,  dlx), smoothstep(pwz*1.8, pwz*0.4, dlz))*0.45;
    float dmx = abs(fract(plan.x/5.0+0.5)-0.5)*5.0;
    float dmz = abs(fract(plan.y/5.0+0.5)-0.5)*5.0;
    gridI += max(smoothstep(pw*2.5, pw*0.6, dmx), smoothstep(pwz*2.5, pwz*0.6, dmz))*0.85;
    float fog = exp(-zf*0.07);
    /* derezz shockwave: circular front from a mid-far origin; radius growth eases
       so the front spends its life sweeping the near field, not the horizon mush */
    vec2 pp = vec2(plan.x*0.9, plan.y - 10.0);
    float wR = 9.2*(1.0 - exp(-pa*0.5)) + pa*0.35;
    float wv = exp(-abs(length(pp) - wR)*0.6) * exp(-pa*0.30) * step(pa, 12.0);
    gridI *= 1.0 + 3.2*wv;
    float spk = step(0.70, hash21(floor(plan*1.3) + floor(T*22.0)))*wv;
    col += vec3(0.10, 0.55, 0.75)*gridI*fog*(1.0 + 0.25*E);
    col += vec3(0.35, 0.90, 1.0)*wv*min(fog*2.5, 1.0)*0.35;  /* the front itself glows */
    col += vec3(0.9, 1.0, 1.0)*spk*1.3;
    /* etched studs where gridlines cross, near field only */
    float stud = smoothstep(1.8, 0.5, max(dlx/(pw*2.6), dlz/(pwz*2.6)))*smoothstep(12.0, 3.0, zf);
    col += vec3(0.20, 0.70, 0.85)*stud*0.38;
    /* light-cycle walls (elevated plane) + mirrored smeared reflection (sunken plane) */
    float zw = (camH - 0.5*hw)/yd;
    float bandW = zw*hw/(2.0*camH - hw);
    col += trails(vec2(uv.x*zw + M.x*0.4, zw), bandW, T, E);
    float zm = (camH + 0.5*hw)/yd;
    float bandM = zm*hw/(2.0*camH - hw)*1.7;
    float streak = 0.70 + 0.30*vnoise(vec2(uv.x*160.0, uv.y*14.0 - T*0.3));
    vec3 refl = trails(vec2(uv.x*zm + M.x*0.4, zm), bandM, T, E)*0.50;
    /* sky bounced in the glass: city glow, portal column, recognizer lights */
    float hb = 0.55 + 0.45*vnoise(vec2(uv.x*7.0 + M.x*0.4, 3.7));
    refl += vec3(0.25, 0.75, 0.95)*exp(-yd*12.0)*hb*cdip*0.32*(1.0 + 0.5*E);
    refl += vec3(0.90, 1.00, 1.00)*exp(-yd*80.0)*0.28*cdip;
    refl += vec3(0.75, 0.95, 1.0)*exp(-abs(uv.x-px)*22.0)*exp(-yd*5.0)*0.30*flick;
    vec2 rp = rrot*((vec2(uv.x, 2.0*h-uv.y) - rc)/0.10); rp.y *= 1.35;
    float sil, hal; refl += recog(rp, sil, hal)*0.30;
    /* scanline shimmer lives in the reflective layer only */
    refl *= streak*(1.0 + 0.05*sin(uv.y*520.0 - T*2.4));
    col += refl;
  }

  /* horizon hairline + pulse flash bleeding both ways */
  col += vec3(0.80, 1.00, 1.05)*exp(-abs(uv.y-h)*320.0)*cdip*(0.38 + 0.26*E);
  col += vec3(0.45, 0.90, 1.0)*exp(-abs(uv.y-h)*30.0)*exp(-pa*3.0)*step(pa, 8.0)*0.5;

  /* ---- grade: dark center pocket, vignette, scanlines, grain, cold curve ---- */
  float r = length(uv*vec2(0.82, 1.25));
  col *= mix(0.40, 1.0, smoothstep(0.04, 0.58, r));
  col *= 1.0 - 0.36*dot(uv, uv);
  col *= 0.96 + 0.04*sin(gl_FragCoord.y*3.14159*0.5);
  col += (hash21(gl_FragCoord.xy + fract(T)*vec2(213.0, 117.0)) - 0.5)*0.025;
  col = 1.0 - exp(-col*1.35);
  col = pow(col, vec3(1.04, 1.0, 0.97));
  gl_FragColor = vec4(col, 1.0);
}`,
};
