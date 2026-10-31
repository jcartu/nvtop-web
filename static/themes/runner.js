/* WallpaperRunner — shared WebGL1 fullscreen-shader runner for RaspOS wallpapers.
   Contract: fragment shaders receive
     uniform vec2  u_res;     // canvas resolution in px
     uniform float u_time;    // seconds since start
     uniform vec2  u_mouse;   // smoothed pointer, each axis in [-0.5, 0.5]
     uniform float u_energy;  // deposit excitement 0..1, spikes then decays
     uniform float u_pulseAge;// seconds since the last pulse() (optional; huge before first pulse)
     uniform float u_drive;   // smoothed steady load 0..1 (optional; GPU busyness)
     uniform float u_spin;    // integrated rotation phase: d(u_spin)/dt = 0.12 + 2.3*drive
                              // (optional; use for ring rotations so speed ramps never jump angles)
     uniform float u_heat;    // smoothed thermal state 0..1 (optional; 0 = cool idle, 1 = hottest GPU pegged)
*/
(function(){
  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  class WallpaperRunner {
    constructor(canvas, frag, opts = {}){
      this.canvas = canvas;
      this.opts = opts;
      this.frag = frag;
      this.scale = opts.scale || 1;
      /* Smoothness comes from frame rate, cost comes from pixels × frames. We run at the
         display's refresh (rAF every frame; themes may not throttle below 30) and keep the
         fragment budget constant by sizing the canvas from pixelsPerSecond / fps. The CSS
         layer upscales bilinearly — for a wallpaper that reads as soft, not blurry. */
      this.fps = Math.max(30, opts.fps || 60);
      this.frameInterval = 1000 / this.fps;
      this.idleFps = Math.max(30, Math.min(this.fps, opts.idleFps || 30));
      this.idleFrameInterval = 1000 / this.idleFps;
      this.idleDelay = opts.idleDelay || 4000;
      this.quality = Math.min(1, Math.max(0.25, opts.quality || 0.35));
      this.pixelsPerSecond = opts.pixelsPerSecond || 36e6;
      this.maxPixels = Math.min(opts.maxPixels || 1200000, this.pixelsPerSecond / this.fps);
      /* adaptive governor: 1 = full budget; shrinks when rAF deltas show dropped frames */
      this.adapt = 1;
      this._ft = [];                 // recent frame deltas (ms)
      this._refresh = 16.7;          // estimated display frame time
      this._lastAdapt = 0;
      this._smoothSince = 0;
      this.gl = canvas.getContext('webgl', { antialias:false, alpha:false, preserveDrawingBuffer:!!opts.preserve });
      if (!this.gl) throw new Error('no-webgl');
      /* survive GPU-process resets / driver fallbacks: rebuild GL state on restore */
      this._lost = false;
      this._onContextLost = (e) => {
        e.preventDefault();
        this._lost = true;
        canvas.style.visibility = 'hidden';
      };
      this._onContextRestored = () => {
        try {
          this.prog = null;
          this.buf = null;
          this._setup();
          this._lost = false;
          canvas.style.visibility = '';
        } catch(e) { /* stays lost and hidden */ }
      };
      canvas.addEventListener('webglcontextlost', this._onContextLost);
      canvas.addEventListener('webglcontextrestored', this._onContextRestored);
      this._setup();
      this.energy = 0; this._energyTarget = 0;
      this.drive = 0; this._driveTarget = 0; this.spin = 0;
      this.heat = 0; this._heatTarget = 0;
      this.pulseAge = 1e4; this._lastNow = performance.now();
      this.mouse = [0, 0]; this._mouseTarget = [0, 0];
      this._t0 = performance.now();
      this._running = false;
      this._raf = 0;
      this._timer = 0;
      this._nextFrame = 0;
      this._activeUntil = 0;
      this._onVisibility = () => {
        if (document.hidden){
          cancelAnimationFrame(this._raf);
          clearTimeout(this._timer);
          this._raf = 0;
          this._timer = 0;
        } else if (this._running && !this._raf && !this._timer){
          const now = performance.now();
          this._lastNow = now;
          this._lastDraw = 0;
          this._ft.length = 0;
          this._activeUntil = now + this.idleDelay;
          this._schedule();
        }
      };
      this._loop = (now) => {
        this._raf = 0;
        if (!this._running || document.hidden) return;
        const interval = now < this._activeUntil ? this.frameInterval : this.idleFrameInterval;
        /* rAF-only pacing: render when the interval has (nearly) elapsed, otherwise skip this
           vsync. No timers → no jitter from timer granularity. */
        if (now - this._lastDraw >= interval - 2){
          this._govern(now);
          this.frame(now);
          this._lastDraw = now;
        }
        this._schedule();
      };
      document.addEventListener('visibilitychange', this._onVisibility);
      this._resize = () => {
        const gl = this.gl;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const d = dpr * this.scale;
        let w = Math.max(2, Math.round((opts.width  || window.innerWidth)  * d));
        let h = Math.max(2, Math.round((opts.height || window.innerHeight) * d));
        const qualityPixels = (opts.width || window.innerWidth) * (opts.height || window.innerHeight)
          * this.quality * dpr;
        const pixelLimit = Math.min(this.maxPixels, qualityPixels) * this.adapt;
        if (w * h > pixelLimit){
          const ratio = Math.sqrt(pixelLimit / (w * h));
          w = Math.max(2, Math.round(w * ratio));
          h = Math.max(2, Math.round(h * ratio));
        }
        if (canvas.width !== w || canvas.height !== h){
          canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
          this._wake(1500);
        }
        this.pixels = w * h;
      };
      this._resize();
      window.addEventListener('resize', this._resize);
    }
    _schedule(){
      if (!this._running || document.hidden || this._raf) return;
      this._raf = requestAnimationFrame(this._loop);
    }
    _wake(duration = this.idleDelay){
      const now = performance.now();
      this._activeUntil = Math.max(this._activeUntil, now + duration);
      this._schedule();
    }
    /* Frame-time governor. Measures real rAF deltas while active; if the mean over the last
       ~1.5 s exceeds 1.35× the display frame time we are dropping frames (GPU or main thread),
       so drop resolution 15%. After 8 s of clean frames, creep back up toward the budget. */
    _govern(now){
      const d = now - (this._lastDraw || now);
      if (d > 0 && d < 1000){
        this._ft.push(d);
        if (this._ft.length > 90) this._ft.shift();
        if (d > 4 && d < this._refresh) this._refresh = Math.max(4, this._refresh * 0.9 + d * 0.1);
      }
      if (this._ft.length < 45 || now - this._lastAdapt < 2000) return;
      const mean = this._ft.reduce((a, b) => a + b, 0) / this._ft.length;
      const expected = Math.max(this._refresh, now < this._activeUntil ? this.frameInterval : this.idleFrameInterval);
      if (mean > expected * 1.35 && this.adapt > 0.4){
        this.adapt = Math.max(0.4, this.adapt * 0.85);
        this._lastAdapt = now; this._smoothSince = now; this._ft.length = 0;
        this._resize();
      } else if (mean < expected * 1.1){
        if (!this._smoothSince) this._smoothSince = now;
        if (this.adapt < 1 && now - this._smoothSince > 8000){
          this.adapt = Math.min(1, this.adapt / 0.92);
          this._lastAdapt = now; this._smoothSince = now; this._ft.length = 0;
          this._resize();
        }
      } else {
        this._smoothSince = 0;
      }
    }
    _setup(){
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        if (!s) throw new Error('shader-allocation');
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
          const message = gl.getShaderInfoLog(s);
          gl.deleteShader(s);
          throw new Error('compile: ' + message);
        }
        return s;
      };
      let vert = null, frag = null, prog = null;
      try {
        vert = compile(gl.VERTEX_SHADER, VERT);
        frag = compile(gl.FRAGMENT_SHADER, this.frag);
        prog = gl.createProgram();
        if (!prog) throw new Error('program-allocation');
        gl.attachShader(prog, vert);
        gl.attachShader(prog, frag);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
      } catch(e) {
        if (prog) gl.deleteProgram(prog);
        if (vert) gl.deleteShader(vert);
        if (frag) gl.deleteShader(frag);
        throw e;
      }
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.useProgram(prog);
      this.prog = prog;
      const buf = gl.createBuffer();
      if (!buf){
        gl.deleteProgram(prog);
        this.prog = null;
        throw new Error('buffer-allocation');
      }
      this.buf = buf;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {
        res:    gl.getUniformLocation(prog, 'u_res'),
        time:   gl.getUniformLocation(prog, 'u_time'),
        mouse:  gl.getUniformLocation(prog, 'u_mouse'),
        energy: gl.getUniformLocation(prog, 'u_energy'),
        pulseAge: gl.getUniformLocation(prog, 'u_pulseAge'),
        drive:  gl.getUniformLocation(prog, 'u_drive'),
        spin:   gl.getUniformLocation(prog, 'u_spin'),
        heat:   gl.getUniformLocation(prog, 'u_heat'),
      };
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    /* deposit excitement: v in 0..1 (whale = 1) */
    pulse(v){
      this._energyTarget = Math.min(1, this._energyTarget + v);
      this.pulseAge = 0;
      this._wake(4500);
    }
    setMouse(x, y){
      this._mouseTarget[0] = x;
      this._mouseTarget[1] = y;
      this._wake(1800);
    }
    /* steady busyness 0..1 (e.g. cluster GPU util) — smoothed, integrates u_spin */
    setDrive(v){
      const next = Math.min(1, Math.max(0, v));
      if (Math.abs(next - this._driveTarget) >= 0.12) this._wake(1800);
      this._driveTarget = next;
    }
    /* thermal state 0..1 (e.g. hottest GPU normalized) — smoothed */
    setHeat(v){
      const next = Math.min(1, Math.max(0, v));
      if (Math.abs(next - this._heatTarget) >= 0.12) this._wake(1800);
      this._heatTarget = next;
    }
    frame(now = performance.now()){
      if (this._lost) return;
      const gl = this.gl;
      const dt = Math.min(0.1, (now - this._lastNow) / 1000);
      this.pulseAge += dt;
      this._lastNow = now;
      this.energy += (this._energyTarget - this.energy) * (1 - Math.exp(-25.8 * dt));
      this._energyTarget *= Math.exp(-1.52 * dt);
      this.drive += (this._driveTarget - this.drive) * Math.min(1, dt * 2.4);   /* fps-independent ~1s ramp */
      this.spin += dt * (0.12 + this.drive * 2.3);
      this.heat += (this._heatTarget - this.heat) * Math.min(1, dt * 1.8);      /* fps-independent ~1.7s ramp */
      const mouseEase = 1 - Math.exp(-3.08 * dt);
      this.mouse[0] += (this._mouseTarget[0] - this.mouse[0]) * mouseEase;
      this.mouse[1] += (this._mouseTarget[1] - this.mouse[1]) * mouseEase;
      gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u.time, (now - this._t0) / 1000);
      gl.uniform2f(this.u.mouse, this.mouse[0], this.mouse[1]);
      gl.uniform1f(this.u.energy, this.energy);
      if (this.u.pulseAge) gl.uniform1f(this.u.pulseAge, this.pulseAge);
      if (this.u.drive) gl.uniform1f(this.u.drive, this.drive);
      if (this.u.spin) gl.uniform1f(this.u.spin, this.spin);
      if (this.u.heat) gl.uniform1f(this.u.heat, this.heat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    start(){
      if (this._running) return;
      this._running = true;
      const now = performance.now();
      this._lastNow = now;
      this._lastDraw = 0;
      this._nextFrame = 0;
      this._activeUntil = now + this.idleDelay;
      this._schedule();
    }
    stop(){
      this._running = false;
      cancelAnimationFrame(this._raf);
      clearTimeout(this._timer);
      this._raf = 0;
      this._timer = 0;
    }
    /* Soft teardown: release every runner-owned GL and DOM resource while the
       canvas context stays reusable by the next theme. */
    _teardown(){
      this.stop();
      window.removeEventListener('resize', this._resize);
      document.removeEventListener('visibilitychange', this._onVisibility);
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      if (!this.gl.isContextLost()){
        try { if (this.buf) this.gl.deleteBuffer(this.buf); } catch(e){}
        try { if (this.prog) this.gl.deleteProgram(this.prog); } catch(e){}
      }
      this.buf = null;
      this.prog = null;
    }
    destroySoft(){
      this._teardown();
    }
    destroy(){
      this._teardown();
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }
  window.WallpaperRunner = WallpaperRunner;
})();
