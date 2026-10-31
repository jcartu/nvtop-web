(window.NVTHEMES = window.NVTHEMES || {})['ares'] = {
  id: 'ares',
  name: 'THE GRID',
  tag: 'TRON: ARES · PERMISSION GRANTED',
  theme: {
    light: false,
    accent: '#ff2b2b',
    accent2: '#ff9d5c',
    text: '#ffe9e4',
    muted: '#c4837d',
    faint: '#6e4340',
    void: '#050203',
    panel: 'rgba(22,6,8,0.55)',
    line: 'rgba(255,64,58,0.26)',
    good: '#4dff88',
    warn: '#ffb054',
    crit: '#ff4d4d',
    info: '#5cc8ff',
    radius: '2px',
    fonts: {
      display: "'Audiowide',sans-serif",
      head: "'Michroma',sans-serif",
      mono: "'Share Tech Mono',monospace",
    },
    googleFonts: ['Audiowide', 'Michroma', 'Share+Tech+Mono'],
  },
  login: {
    title: 'ARES GATEWAY',
    sub: 'DILLINGER SYSTEMS · GRID ACCESS',
    user: 'PROGRAM ID',
    pass: 'IDENTITY DISC',
    button: 'ENTER THE GRID',
    granted: 'PERMISSION GRANTED',
    denied: 'DEREZZED',
    boot: [
      'GRID UPLINK .............. ONLINE',
      'IDENTITY DISC ARRAY ...... SYNCED',
      'RECOGNIZER PATROL ........ ACTIVE',
      'LIGHTCYCLE BATONS ........ CHARGED',
      'PERMISSION PROTOCOL ...... ARMED',
    ],
    footer: 'end of line',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float h1(float n){ return fract(sin(n*127.1)*43758.5453123); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float vno(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1.0,0.0)), f.x), mix(h2(i+vec2(0.0,1.0)), h2(i+vec2(1.0,1.0)), f.x), f.y);
}

/* distance + arclength to a segment */
vec2 segdu(vec2 p, vec2 a, vec2 b){
  vec2 ab = b - a;
  float l2 = max(dot(ab,ab), 1e-6);
  float h = clamp(dot(p-a,ab)/l2, 0.0, 1.0);
  return vec2(length(p - a - ab*h), h*sqrt(l2));
}

/* point at arclength u along axis-aligned polyline A-B-C-D */
vec2 pathPt(vec2 A, vec2 B, vec2 C, vec2 D, float u, float L1, float L2, float L3){
  if (u < L1) return mix(A, B, u/max(L1, 1e-4));
  u -= L1;
  if (u < L2) return mix(B, C, u/max(L2, 1e-4));
  u -= L2;
  return mix(C, D, clamp(u/max(L3, 1e-4), 0.0, 1.0));
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*u_res)/u_res.y;
  float t = mod(u_time, 3600.0);
  float e = clamp(u_energy, 0.0, 1.0);
  float Tm = t*(1.0 + 0.8*e);          /* throttle: everything races on events */
  vec2 M = u_mouse;

  vec3 RED = vec3(1.0, 0.169, 0.169);   /* #ff2b2b */
  vec3 ORG = vec3(1.0, 0.616, 0.361);   /* #ff9d5c */

  float hy = 0.10 + M.y*0.03;           /* horizon height */
  float dxh = uv.x + M.x*0.10;          /* gate-centered x */
  float sy = uv.y - hy;                 /* height above horizon */
  float skyM = step(0.0, sy);

  vec3 col = vec3(0.010, 0.002, 0.003); /* the void */

  /* ================= GRID FLOOR ================= */
  float dy = hy - uv.y;
  float floorM = step(0.0006, dy);
  float z = 1.0/max(dy, 0.0006);
  float scroll = Tm*3.2;
  float camX = M.x*2.0 + sin(t*0.04)*0.8;
  float wx = uv.x*z + camX;             /* world x on the floor */
  float gz = z + scroll;                /* scrolled depth */
  float fog = exp(-z*0.052);
  float aa = z*1.7/u_res.y;             /* world-units-per-pixel at this depth */

  float lx = abs(fract(wx + 0.5) - 0.5);
  float lz = abs(fract(gz + 0.5) - 0.5);
  float glx = exp(-lx*lx/(aa*aa*2.2)) + 0.30*exp(-lx*lx*80.0);
  float glz = exp(-lz*lz/(aa*aa*2.2)) + 0.30*exp(-lz*lz*80.0);
  float mx8 = abs(fract(wx/8.0 + 0.5) - 0.5)*8.0;
  float mz8 = abs(fract(gz/8.0 + 0.5) - 0.5)*8.0;
  float gmx = exp(-mx8*mx8/(aa*aa*5.0)) + 0.25*exp(-mx8*mx8*24.0);
  float gmz = exp(-mz8*mz8/(aa*aa*5.0)) + 0.25*exp(-mz8*mz8*24.0);
  float gridI = (glx + glz)*0.26 + (gmx + gmz)*0.50;
  col += RED * gridI * fog * floorM * (0.85 + 0.35*e);
  col += RED * exp(-dy*14.0) * 0.07 * floorM;   /* haze where floor meets horizon */

  /* ================= LIGHTCYCLE TRAILS ================= */
  vec3 trailC = vec3(0.0);
  vec2 P = vec2(wx, z);
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    float CY = 7.5 + fk*1.9;
    float lif = Tm/CY + fk*0.41;
    float cyc = floor(lif);
    float ph = fract(lif);
    float r1 = h1(cyc*17.31 + fk*57.7 + 1.0);
    float r2 = h1(cyc*23.17 + fk*41.3 + 2.0);
    float r3 = h1(cyc*11.73 + fk*67.1 + 3.0);
    float r4 = h1(cyc*29.51 + fk*13.9 + 4.0);
    float sx = sign(r1 - 0.5);
    /* axis-aligned polyline snapped to grid lines: race, hard 90° turn, race */
    vec2 A = vec2(floor(camX + sx*(3.0 + 11.0*r2)) + 0.5, floor(9.0 + 19.0*r3) + 0.5);
    vec2 B = vec2(A.x - sx*(floor(5.0 + 10.0*r4) + 1.0), A.y);
    vec2 C = vec2(B.x, max(A.y - floor(4.0 + 8.0*r2) - 1.0, 2.2));
    vec2 D = vec2(B.x - sx*(floor(7.0 + 12.0*r3) + 1.0), C.y);
    float L1 = abs(B.x - A.x), L2 = abs(C.y - B.y), L3 = abs(D.x - C.x);
    float L = L1 + L2 + L3;
    float TAIL = 22.0 + 12.0*e;
    float head = ph*(L + TAIL*1.9);
    vec2 d1 = segdu(P, A, B);
    vec2 d2 = segdu(P, B, C); d2.y += L1;
    vec2 d3 = segdu(P, C, D); d3.y += L1 + L2;
    vec3 acc = vec3(0.0);
    for (int s = 0; s < 3; s++){
      vec2 du = (s == 0) ? d1 : ((s == 1) ? d2 : d3);
      float back = head - du.y;
      float lit = step(0.0, back) * exp(-back/TAIL*1.5);
      float w = 0.055;
      float g = 2.5*exp(-du.x*du.x/(w*w)) + 0.20*exp(-du.x*du.x*8.0);
      float hot = exp(-max(back, 0.0)*0.30);
      vec3 tc = mix(RED, ORG, clamp(hot*1.4, 0.0, 1.0));
      tc = mix(tc, vec3(1.0, 0.90, 0.80), hot*0.6);
      acc += tc * g * lit;
    }
    /* the lightcycle itself: hot white spark at the head */
    float hu = min(head, L);
    vec2 hp = pathPt(A, B, C, D, hu, L1, L2, L3);
    float hd2 = dot(P - hp, P - hp);
    float alive = 1.0 - smoothstep(L, L + 3.0, head);
    acc += vec3(1.0, 0.85, 0.70) * exp(-hd2*7.0) * 2.2 * alive;
    trailC += acc;
  }
  col += trailC * fog * floorM * (1.25 + 0.7*e);

  /* ================= DE-REZ SHOCKWAVE (event pulse) ================= */
  if (u_pulseAge < 6.0){
    float R = 2.0 + u_pulseAge*13.0;
    float wr = length(vec2(wx - camX, z));
    float ring = exp(-(wr - R)*(wr - R)*0.055) * exp(-u_pulseAge*0.7);
    float vox = 0.5 + 0.5*h2(floor(vec2(wx, gz)));   /* de-rez voxel sparkle */
    col += mix(vec3(1.0, 0.55, 0.42), RED, 0.45) * ring * vox * fog * floorM * 1.1;
  }

  /* ================= THE GATE ON THE HORIZON ================= */
  float flare = 1.0 + 1.4*e;
  col += mix(RED, vec3(1.0, 0.55, 0.40), 0.5) * exp(-abs(sy)*220.0) * 0.85 * flare;
  col += RED * exp(-abs(sy)*44.0) * 0.20 * flare;
  /* monumental sun band rising over the horizon */
  float band = exp(-max(sy, 0.0)*9.0) * exp(-dxh*dxh*1.7) * skyM;
  col += ORG * band * 0.30 * flare;
  /* twin arch rings */
  vec2 gq = vec2(dxh, sy*1.35);
  float gr = length(gq);
  float arch = exp(-abs(gr - 0.300)*110.0) + 0.55*exp(-abs(gr - 0.335)*160.0)
             + 0.40*exp(-abs(gr - 0.230)*170.0);
  col += RED * arch * skyM * 0.60 * flare;
  /* dark monolithic mass between the rings, so the gate reads as structure */
  float inGate = smoothstep(0.335, 0.300, gr) * skyM;
  col = mix(col, vec3(0.030, 0.004, 0.006) + ORG*exp(-max(sy,0.0)*6.0)*0.10*flare, inGate*0.55);
  /* the portal slit + vertical beam */
  float slit = exp(-dxh*dxh*900.0) * exp(-max(sy, 0.0)*10.0) * skyM;
  col += mix(ORG, vec3(1.0, 0.82, 0.62), 0.45) * slit * 0.75 * flare;
  col += ORG * exp(-dxh*dxh*2600.0) * exp(-max(sy, 0.0)*2.2) * skyM * 0.10 * flare;
  /* gate light spilling down the floor toward the camera */
  col += ORG * exp(-dy*9.0) * exp(-dxh*dxh*13.0) * 0.22 * floorM * flare;
  col += ORG * exp(-dxh*dxh*500.0) * exp(-dy*3.5) * 0.10 * floorM * flare;

  /* ================= DIGITAL RAIN OF RED SHARDS (sky) ================= */
  float shard = 0.0;
  for (int i = 0; i < 2; i++){
    float fi = float(i);
    float sc = 26.0 + fi*18.0;
    float xsh = uv.x + M.x*(0.02 + 0.02*fi) + fi*0.37;
    float cid = floor(xsh*sc);
    float hc = h1(cid*7.13 + fi*33.3);
    float pres = step(0.78, hc);
    float xf = fract(xsh*sc) - 0.5;
    float spd = 0.05 + 0.10*h1(cid*3.1 + fi);
    float yv = fract(hc*9.0 - t*spd);
    float shy = mix(0.52, -0.005, yv);
    shy = floor(shy*44.0)/44.0;            /* quantized: falls in digital steps */
    float dsy = sy - shy;
    float dash = exp(-dsy*dsy*2400.0) * smoothstep(0.17, 0.04, abs(xf));
    float fl = 0.55 + 0.45*h1(cid + floor(t*9.0));
    shard += dash * pres * fl * (0.55 - 0.35*fi);
  }
  col += RED * shard * skyM * 0.65;
  /* low cloud streaks catching the gate light */
  float strk = vno(vec2(dxh*2.6 + t*0.025, sy*22.0)) * vno(vec2(dxh*7.0 - t*0.04, sy*9.0 + 5.0));
  col += mix(RED, ORG, 0.4) * strk * exp(-max(sy, 0.0)*5.5) * skyM * 0.10 * flare;

  /* ================= scanline shimmer / vignette / grain ================= */
  col *= 0.94 + 0.06*sin(frag.y*2.4 + t*2.0);
  col *= 1.0 + 0.05*sin(uv.y*140.0 - t*6.0)*exp(-abs(sy)*3.0);
  vec2 vp = frag/u_res - 0.5;
  col *= 1.0 - dot(vp, vp)*0.9;
  col = 1.0 - exp(-col*1.25);
  col += (h2(frag*0.7 + fract(t)*13.0) - 0.5)*0.02;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`,
};
