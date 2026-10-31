(window.NVTHEMES = window.NVTHEMES || {})['nightcity'] = {
  id: 'nightcity',
  name: 'NIGHT CITY',
  tag: 'CYBERPUNK 2077 · ARASAKA NET',
  theme: {
    light: false,
    accent:  '#fcee0a',
    accent2: '#00f0ff',
    text:  '#e8e8e0',
    muted: '#9a9aa5',
    faint: '#5c5c68',
    void:  '#07070b',
    panel: 'rgba(14,14,18,0.6)',
    line:  'rgba(252,238,10,0.14)',
    good:  '#2bd94f',
    warn:  '#ff9f1a',
    crit:  '#ff003c',
    info:  '#00f0ff',
    radius: '2px',
    fonts: {
      display: "'Chakra Petch',sans-serif",
      head:    "'Rajdhani',sans-serif",
      mono:    "'IBM Plex Mono',monospace",
    },
    googleFonts: ['Chakra+Petch:wght@600;700', 'Rajdhani:wght@500;700', 'IBM+Plex+Mono:wght@400;600'],
  },
  login: {
    title: 'ARASAKA NET',
    sub: 'NIGHT CITY SUBNET · MILITECH FIREWALL BYPASS',
    user: 'NETRUNNER HANDLE',
    pass: 'ICE-BREAKER',
    button: 'BREACH PROTOCOL',
    granted: 'DAEMON UPLOADED — WELCOME, CHOOM',
    denied: 'FLATLINED',
    boot: [
      'BREACH PROTOCOL v2.077 .... INIT',
      'ICE DETECTED: MILITECH BASTION .... BYPASSED',
      'DAEMONS ARMED: PING / MASS VULNERABILITY .... OK',
      'RELIC INTEGRITY 98.2% .... MALFUNCTION SUPPRESSED',
      'JACKED IN. NIGHT CITY SUBNET LIVE.',
    ],
    footer: 'wake the f*ck up, samurai · we have GPUs to burn',
  },
  frag: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_energy; uniform float u_pulseAge;

float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1.0,0.0));
  float c = hash21(i+vec2(0.0,1.0)), d = hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

/* pick a neon hue: mostly warm sodium, cyan / magenta / CP77-yellow accents */
vec3 neonHue(float r){
  vec3 c = vec3(1.0, 0.62, 0.25);                       /* sodium */
  c = mix(c, vec3(0.0, 0.94, 1.0),  step(0.55, r));     /* cyan */
  c = mix(c, vec3(1.0, 0.16, 0.72), step(0.75, r));     /* magenta */
  c = mix(c, vec3(0.99, 0.93, 0.06), step(0.90, r));    /* CP77 yellow */
  return c;
}

/* one depth-slice of the bokeh light-field: jittered points on a hash grid.
   blur = disc radius/softness (near = big soft bokeh), den = keep-probability */
vec3 bokeh(vec2 uv, float scale, float blur, float den, float seed, float T){
  vec2 p = uv*scale;
  vec2 g = floor(p);
  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 id = g + vec2(float(x), float(y));
    float rnd = hash21(id + seed);
    /* towers of lights: density clusters into vertical stacks + falls off upward */
    float struct2 = pow(vnoise(vec2(id.x*0.23, seed) + floor(id.y*0.14)), 2.0);
    if (rnd < den*(0.25 + struct2*1.5)) {
      vec2 jp = vec2(hash21(id+seed+1.7), hash21(id+seed+4.2))*0.8 + 0.1;
      float d = length(p - id - jp);
      float rad = min(blur*(0.55 + 0.55*hash21(id+seed+8.8)), 0.85); /* keep discs inside 3x3 hood */
      float disc = smoothstep(rad, rad*0.25, d);
      float tw = 0.72 + 0.28*sin(T*(0.8+hash21(id+seed+3.0)*3.0) + hash21(id)*40.0);
      /* occasional hard flicker — dying signage */
      tw *= mix(1.0, step(fract(T*(2.0+hash21(id)*6.0)), 0.6), step(0.94, hash21(id+seed+6.1)));
      acc += neonHue(hash21(id+seed+2.5))*disc*tw;
    }
  }
  return acc;
}

/* a wall of towers: dark silhouettes rising above 'horiz', facades packed with
   window-grid lights that thin out with tower hash + altitude */
vec3 towerWall(vec2 uv, float horiz, float xs, float hs, float seed, vec2 wsc, float T, out float sil){
  float x = uv.x*xs + seed*7.31;
  float c = floor(x);
  float h = hash21(vec2(c, seed));
  float top = horiz + 0.03 + h*h*hs + step(0.93, hash21(vec2(c, seed+5.0)))*hs*0.7;
  sil = smoothstep(top+0.005, top-0.005, uv.y);
  /* window grid aligned to the tower column, rows offset per tower */
  vec2 wp = vec2(x*wsc.x, (uv.y-horiz)*wsc.y + hash21(vec2(c, seed+1.0))*7.0);
  vec2 wid = floor(wp);
  vec2 wf = fract(wp);
  float pane = smoothstep(0.42, 0.16, length((wf-vec2(0.5,0.45))*vec2(1.0,1.3)));
  float lp = hash21(vec2(c, seed+9.0));
  float litp = 0.05 + 0.65*lp*lp;                                /* some towers nearly dark */
  float on = step(hash21(wid+seed*3.7), litp);
  float tw = 0.75 + 0.25*sin(T*(0.7+hash21(wid)*2.5) + hash21(wid+2.0)*40.0);
  vec3 wc = neonHue(hash21(vec2(c, wid.y)+seed+2.5));            /* whole floors share hue */
  wc = mix(vec3(1.0,0.62,0.25), wc, 0.55);
  return wc*pane*on*tw*sil;
}

/* the whole city frame (called 1-3x for chromatic glitch splits) */
vec3 scene(vec2 uv, float T, float E, vec2 M){
  float horiz = 0.02;
  float nb = 1.0 + E*0.55;   /* energy turns the neon up */
  /* ---- smog sky ---- */
  vec3 col = vec3(0.005, 0.006, 0.011)*(1.0 - uv.y*0.5);
  col += vec3(0.09, 0.04, 0.13)*exp(-max(uv.y-horiz, 0.0)*7.0)*0.5;    /* magenta smog low */
  col += vec3(0.85, 0.70, 0.20)*exp(-abs(uv.y-horiz)*18.0)*0.14;       /* sodium horizon line */
  col += vec3(0.0, 0.55, 0.65)*exp(-abs(uv.y-horiz+0.03)*26.0)*0.09;   /* thin cyan haze */
  /* a lone AV taillight crossing the sky */
  vec2 av = vec2(mod(T*0.05, 2.4)-1.2, 0.30 + 0.05*sin(T*0.4));
  col += vec3(1.0, 0.2, 0.25)*smoothstep(0.012, 0.002, length((uv-av)*vec2(1.0,2.0)))*0.8;
  col += vec3(1.0, 0.3, 0.3)*exp(-length((uv-av)*vec2(1.0,2.0))*60.0)*0.25;

  /* ---- three tower walls, far to near, sinking into haze ---- */
  float s0, s1, s2;
  vec3 haze = vec3(0.10, 0.05, 0.13);
  vec3 w0 = towerWall(uv + M*0.012, horiz+0.030, 26.0, 0.14, 3.0, vec2(7.0, 190.0), T, s0);
  vec3 w1 = towerWall(uv + M*0.030, horiz+0.005, 13.0, 0.22, 7.0, vec2(6.0, 120.0), T, s1);
  vec3 w2 = towerWall(uv + M*0.060, horiz-0.030,  6.5, 0.34, 11.0, vec2(5.0,  70.0), T, s2);
  col = mix(col, mix(haze*0.9, vec3(0.012,0.012,0.020), 0.35), s0*0.85);
  col += w0*0.26*nb;
  col = mix(col, haze*0.55, s0*0.40);                    /* far wall sinks into smog */
  col = mix(col, mix(haze*0.5, vec3(0.008,0.008,0.014), 0.65), s1*0.92);
  col += w1*0.70*nb;
  col = mix(col, haze*0.35, s1*0.18);
  col = mix(col, vec3(0.006, 0.006, 0.011), s2*0.96);
  col += w2*1.10*nb;
  float city = max(s0, max(s1, s2));
  /* smog veil pooling at the skyline so tower tops dissolve into it */
  col = mix(col, vec3(0.13, 0.06, 0.16), exp(-abs(uv.y-horiz-0.07)*6.0)*0.38);

  /* ---- out-of-focus foreground bokeh floating over the walls ---- */
  col += bokeh(uv + M*0.09 + vec2(T*0.006, 0.0), 11.0, 0.50, 0.16, 51.0, T)*0.9*city*nb;
  col += bokeh(uv + M*0.14 + vec2(T*0.011, 0.0),  6.5, 0.70, 0.10, 63.0, T)*1.1*city*nb;

  /* ---- big neon sign glows breathing at the frame edges ---- */
  float pl = 0.72 + 0.28*sin(T*1.7);
  float pr = 0.72 + 0.28*sin(T*2.3 + 2.0);
  col += vec3(0.99, 0.93, 0.06)*exp(-length((uv-vec2(-0.92, -0.14))*vec2(1.4, 2.6))*3.0)*0.40*pl*nb;
  col += vec3(0.0, 0.94, 1.0) *exp(-length((uv-vec2( 0.95, -0.28))*vec2(1.4, 2.4))*3.2)*0.34*pr*nb;
  col += vec3(1.0, 0.16, 0.72)*exp(-length((uv-vec2( 0.86,  0.30))*vec2(2.6, 1.8))*4.5)*0.18*pl;

  /* ---- rooftop foreground: dark parapet + wet reflection smear ---- */
  float roofY = -0.36 + vnoise(vec2(uv.x*3.0, 5.0))*0.015;
  float roof = smoothstep(roofY+0.006, roofY-0.006, uv.y);
  vec3 roofCol = vec3(0.008, 0.009, 0.014);
  /* smeared reflections of the lit walls, streaked vertically by wetness */
  float sr1, sr2;
  vec2 ruv = vec2(uv.x, roofY - (uv.y-roofY)*1.8);
  vec3 refl = towerWall(ruv + M*0.030, horiz+0.005, 13.0, 0.22, 7.0, vec2(6.0, 120.0), T, sr1)*0.8
            + towerWall(ruv + M*0.060, horiz-0.030,  6.5, 0.34, 11.0, vec2(5.0,  70.0), T, sr2)*1.0
            + vec3(0.99,0.93,0.06)*exp(-length((ruv-vec2(-0.92,-0.14))*vec2(1.4,2.6))*3.0)*0.35*pl
            + vec3(0.0,0.94,1.0)*exp(-length((ruv-vec2(0.95,-0.28))*vec2(1.4,2.4))*3.2)*0.30*pr;
  float wet = 0.30 + 0.70*vnoise(vec2(uv.x*90.0, uv.y*7.0));
  roofCol += refl*wet*0.55*exp((uv.y-roofY)*6.0)*nb;
  roofCol += vec3(0.99, 0.93, 0.06)*smoothstep(0.008, 0.0, abs(uv.y-roofY))*0.12; /* parapet edge catch */
  col = mix(col, roofCol, roof);

  /* ---- rain: thin streaks with per-column speed, faint, catch the glow ---- */
  float amb = dot(col, vec3(0.5));
  for (int k = 0; k < 2; k++){
    float rs = 70.0 + float(k)*55.0;
    float rid = floor(uv.x*rs + float(k)*13.1);
    float sp = 1.6 + hash21(vec2(rid, 3.0))*1.4 + float(k)*0.8;
    float ph = hash21(vec2(rid, 7.0));
    float ry = uv.y*(2.2+float(k)) + T*sp + ph*8.0;
    float seg = step(hash21(vec2(rid, floor(ry))), 0.30);
    float f = fract(ry);
    float dash = smoothstep(0.0, 0.15, f)*smoothstep(0.55, 0.30, f);
    float fx = abs(fract(uv.x*rs + float(k)*13.1)-0.5);
    float thin = smoothstep(0.10, 0.02, fx);
    col += vec3(0.55, 0.65, 0.75)*seg*dash*thin*(0.05 + amb*0.16);
  }
  return col;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  float T = mod(u_time, 1200.0);
  float E = u_energy;
  vec2 M = u_mouse;

  /* ---- PERIODIC GLITCH: occasional horizontal slice shift + chroma split ---- */
  float gseed = floor(T*2.5);
  float gOn = step(0.90 - E*0.35, hash21(vec2(gseed, 17.0)));       /* rare slots; energy raises odds */
  float sliceId = floor(uv.y*20.0 + hash21(vec2(gseed, 3.0))*8.0);
  float sOn = step(0.55, hash21(vec2(sliceId, gseed)));
  /* pulse: vertical glitch cascade sweeping down the frame */
  float casY = 0.55 - u_pulseAge*0.55;
  float cas = smoothstep(0.16, 0.0, abs(uv.y - casY))*exp(-u_pulseAge*0.8)*step(u_pulseAge, 3.0);
  float g = gOn*sOn + cas;
  uv.x += (hash21(vec2(sliceId, gseed+7.0))-0.5)*0.09*g;
  float ca = 0.010*g;

  vec3 col = scene(uv, T, E, M);
  if (ca > 0.0006){
    col.r = scene(uv + vec2(ca, 0.0), T, E, M).r;
    col.b = scene(uv - vec2(ca, 0.003), T, E, M).b;
    col += vec3(0.99, 0.93, 0.06)*g*0.03;   /* yellow interference tint */
  }

  /* ---- grade: keep the dashboard center dark, CP77 scanline crunch ---- */
  float r = length(uv*vec2(0.85, 1.2));
  col *= mix(0.52, 1.0, smoothstep(0.06, 0.60, r));   /* dark center pocket */
  col *= 1.0 - 0.34*dot(uv, uv);                       /* corner vignette */
  col *= 0.94 + 0.06*sin(gl_FragCoord.y*3.14159*0.5); /* faint scanlines */
  col += (hash21(gl_FragCoord.xy + fract(T)*vec2(213.0, 117.0)) - 0.5)*0.028;

  col = 1.0 - exp(-col*(1.25 - E*0.08));
  gl_FragColor = vec4(col, 1.0);
}`,
};
