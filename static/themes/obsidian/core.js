// APERTURE / a machined kinetic instrument. Geometry is built once; seven rigid
// assemblies precess independently on the GPU. No scene library or model assets.
const TAU = Math.PI * 2;
const LAYERS = 7;

const meshVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in float a_material;
layout(location=3) in float a_layer;
uniform mat3 u_assemblies[7];
uniform mat3 u_world;
uniform mat4 u_projection;
uniform mat4 u_light;
out vec3 v_position;
out vec3 v_normal;
out vec3 v_local;
out vec4 v_shadow;
flat out int v_material;
void main() {
  mat3 rotation=u_world*u_assemblies[int(a_layer)];
  v_position=rotation*a_position;
  v_normal=rotation*a_normal;
  v_local=a_position;
  v_material=int(a_material);
  v_shadow=u_light*vec4(v_position,1.);
  gl_Position=u_projection*vec4(v_position-vec3(0.,0.,6.),1.);
}`;

const meshFragment = `#version 300 es
precision highp float;
in vec3 v_position;
in vec3 v_normal;
in vec3 v_local;
in vec4 v_shadow;
flat in int v_material;
uniform sampler2D u_shadow;
uniform vec3 u_accent;
uniform float u_drive;
uniform float u_heat;
uniform float u_phase;
out vec4 fragColor;
float visibility(vec3 n) {
  vec3 p=v_shadow.xyz*.5+.5;
  float bias=max(.0007,.0022*(1.-dot(n,normalize(vec3(3.,4.,5.)))));
  float s=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++)
    s+=step(p.z-bias,texture(u_shadow,p.xy+vec2(x,y)/768.).r);
  return .38+.62*s/9.;
}
vec3 studio(vec3 r,float rough) {
  vec3 c=vec3(.17,.19,.23)+vec3(.34,.37,.41)*smoothstep(-.3,.8,r.y);
  float panel=pow(max(dot(r,normalize(vec3(-.8,1.3,1.8))),0.),mix(90.,18.,rough));
  c+=vec3(2.4,2.25,1.98)*panel;
  float strip=pow(max(dot(r,normalize(vec3(1.5,.2,1.))),0.),70.);
  c+=vec3(1.5,1.7,1.95)*strip;
  c+=u_accent*pow(max(dot(r,normalize(vec3(-.7,-.3,1.))),0.),16.)*.95;
  return c;
}
void main() {
  vec3 n=normalize(v_normal)*(gl_FrontFacing?1.:-1.);
  vec3 view=normalize(vec3(0.,0.,6.)-v_position);
  vec3 r=reflect(-view,n);
  vec3 base=vec3(.28,.31,.35);
  float rough=.38;
  if(v_material==1){base=vec3(.62,.66,.70);rough=.20;}
  if(v_material==2){base=mix(u_accent,vec3(.78,.69,.55),.24);rough=.26;}
  if(v_material==3){base=vec3(.37,.41,.46);rough=.16;}
  float facing=max(dot(n,view),0.);
  vec3 fresnel=base+(1.-base)*pow(1.-facing,5.);
  float diffuse=max(dot(n,normalize(vec3(-2.,4.,5.))),0.);
  float shadow=visibility(n);
  vec3 c=studio(r,rough)*fresnel*(.42+.58*shadow)+base*diffuse*.34*shadow;
  // Fine circular machining, rather than a noisy texture or game-like paneling.
  float grain=sin(length(v_local.xz)*1700.+v_local.y*620.);
  c*=.97+.03*grain;
  if(v_material==4){
    float breath=.92+.08*sin(u_phase*1.8);
    c=mix(u_accent,vec3(1.,.94,.82),.38)*(1.65+u_drive*.6)*breath;
  }
  if(v_material==5){
    float a=atan(v_local.z,v_local.x);
    float travel=pow(.5+.5*cos(a*2.-u_phase*.8),18.);
    c=u_accent*(.40+travel*2.8+u_drive*.18);
  }
  c=mix(c,c*vec3(1.10,.91,.83),u_heat*.18);
  c=1.-exp(-c*1.35);
  fragColor=vec4(c,1.);
}`;

const shadowVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=3) in float a_layer;
uniform mat3 u_assemblies[7];
uniform mat3 u_world;
uniform mat4 u_light;
void main(){gl_Position=u_light*vec4(u_world*u_assemblies[int(a_layer)]*a_position,1.);}`;
const shadowFragment = `#version 300 es
precision highp float;
void main(){}`;
const screenVertex = `#version 300 es
out vec2 v_uv;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  v_uv=p;gl_Position=vec4(p*2.-1.,0.,1.);
}`;
const blurFragment = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_step;
uniform float u_threshold;
out vec4 fragColor;
vec3 sampleLight(vec2 uv){
  vec3 c=texture(u_image,uv).rgb;
  return mix(c,max(c-.54,0.)*2.2,u_threshold);
}
void main(){
  vec3 c=sampleLight(v_uv)*.227027;
  c+=(sampleLight(v_uv+u_step*1.384615)+sampleLight(v_uv-u_step*1.384615))*.316216;
  c+=(sampleLight(v_uv+u_step*3.230769)+sampleLight(v_uv-u_step*3.230769))*.070270;
  fragColor=vec4(c,1.);
}`;
const compositeFragment = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_bloom;
uniform vec2 u_pixel;
out vec4 fragColor;
void main(){
  vec4 c=texture(u_image,v_uv);
  // Subpixel edge integration keeps narrow machined edges calm in motion.
  vec4 near=(texture(u_image,v_uv+vec2(u_pixel.x*.45,0.))+
    texture(u_image,v_uv-vec2(u_pixel.x*.45,0.))+
    texture(u_image,v_uv+vec2(0.,u_pixel.y*.45))+
    texture(u_image,v_uv-vec2(0.,u_pixel.y*.45)))*.25;
  c=mix(c,near,.35);
  vec3 bloom=texture(u_bloom,v_uv).rgb*.74;
  float a=clamp(c.a+max(bloom.r,max(bloom.g,bloom.b))*2.5,0.,1.);
  vec3 color=c.rgb+bloom;
  fragColor=vec4(color/max(a,.001),a);
}`;

function program(gl, vertex, fragment, names) {
	const compile = (type, source) => {
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const message = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw new Error(message);
		}
		return shader;
	};
	const vs = compile(gl.VERTEX_SHADER, vertex);
	const fs = compile(gl.FRAGMENT_SHADER, fragment);
	const handle = gl.createProgram();
	gl.attachShader(handle, vs);
	gl.attachShader(handle, fs);
	gl.linkProgram(handle);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(handle);
		gl.deleteProgram(handle);
		throw new Error(message);
	}
	return {
		handle,
		uniforms: Object.fromEntries(
			names.map((name) => [name, gl.getUniformLocation(handle, `u_${name}`)]),
		),
	};
}

// Column-major XYZ rigid rotation, writing directly into persistent uniform memory.
function rotation(out, offset, x, y, z) {
	const sx = Math.sin(x),
		cx = Math.cos(x),
		sy = Math.sin(y),
		cy = Math.cos(y),
		sz = Math.sin(z),
		cz = Math.cos(z);
	out[offset] = cy * cz;
	out[offset + 1] = cy * sz;
	out[offset + 2] = -sy;
	out[offset + 3] = sx * sy * cz - cx * sz;
	out[offset + 4] = sx * sy * sz + cx * cz;
	out[offset + 5] = sx * cy;
	out[offset + 6] = cx * sy * cz + sx * sz;
	out[offset + 7] = cx * sy * sz - sx * cz;
	out[offset + 8] = cx * cy;
}

function instrumentGeometry() {
	const vertices = [],
		indices = [];
	const vertex = (p, n, material, layer) => {
		const index = vertices.length / 8;
		vertices.push(...p, ...n, material, layer);
		return index;
	};
	const triangle = (a, b, c, material, layer) => {
		const u = b.map((v, i) => v - a[i]),
			v = c.map((value, i) => value - a[i]);
		const normal = [
			u[1] * v[2] - u[2] * v[1],
			u[2] * v[0] - u[0] * v[2],
			u[0] * v[1] - u[1] * v[0],
		];
		const length = Math.hypot(...normal);
		for (let i = 0; i < 3; i++) normal[i] /= length || 1;
		indices.push(
			vertex(a, normal, material, layer),
			vertex(b, normal, material, layer),
			vertex(c, normal, material, layer),
		);
	};
	const arc = (
		layer,
		radius,
		width,
		height,
		start,
		end,
		material = 1,
		bevelMaterial = material,
	) => {
		const bevel = Math.min(width, height) * 0.32;
		const profile = [
			[width - bevel, height],
			[-width + bevel, height],
			[-width, height - bevel],
			[-width, -height + bevel],
			[-width + bevel, -height],
			[width - bevel, -height],
			[width, -height + bevel],
			[width, height - bevel],
		];
		const steps = Math.max(2, Math.ceil((end - start) * 42));
		for (let side = 0; side < 8; side++) {
			const a = profile[side],
				b = profile[(side + 1) % 8];
			let nx = b[1] - a[1],
				ny = a[0] - b[0];
			const length = Math.hypot(nx, ny);
			nx /= length;
			ny /= length;
			const first = vertices.length / 8;
			for (let i = 0; i <= steps; i++) {
				const angle = start + ((end - start) * i) / steps,
					c = Math.cos(angle),
					s = Math.sin(angle);
				for (const p of [a, b])
					vertex(
						[(radius + p[0]) * c, p[1], (radius + p[0]) * s],
						[nx * c, ny, nx * s],
						side % 2 ? bevelMaterial : material,
						layer,
					);
				if (i < steps) {
					const j = first + i * 2;
					indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
				}
			}
		}
		if (end - start < TAU - 0.001) {
			for (const angle of [start, end]) {
				const c = Math.cos(angle),
					s = Math.sin(angle),
					center = [radius * c, 0, radius * s];
				for (let i = 0; i < 8; i++) {
					const a = profile[i],
						b = profile[(i + 1) % 8];
					const p = [(radius + a[0]) * c, a[1], (radius + a[0]) * s];
					const q = [(radius + b[0]) * c, b[1], (radius + b[0]) * s];
					if (angle === start) triangle(center, q, p, 0, layer);
					else triangle(center, p, q, 0, layer);
				}
			}
		}
	};
	const pin = (layer, center, radius, height, material = 1) => {
		const count = 8;
		for (let i = 0; i < count; i++) {
			const a = (i / count) * TAU,
				b = ((i + 1) / count) * TAU;
			const p = [
				center[0] + Math.cos(a) * radius,
				center[1] + height,
				center[2] + Math.sin(a) * radius,
			];
			const q = [
				center[0] + Math.cos(b) * radius,
				center[1] + height,
				center[2] + Math.sin(b) * radius,
			];
			triangle(
				[center[0], center[1] + height, center[2]],
				q,
				p,
				material,
				layer,
			);
			const lowP = [p[0], center[1], p[2]],
				lowQ = [q[0], center[1], q[2]];
			triangle(lowP, p, q, 0, layer);
			triangle(lowP, q, lowQ, 0, layer);
		}
	};
	// The carrier: a thin continuous bearing with 96 radial graduations.
	arc(1, 1.54, 0.028, 0.05, 0, TAU, 0, 1);
	arc(1, 1.505, 0.009, 0.055, 0, TAU, 2);
	for (let i = 0; i < 96; i++) {
		const a = (i / 96) * TAU;
		arc(
			1,
			i % 8 ? 1.575 : 1.594,
			i % 8 ? 0.01 : 0.029,
			0.01,
			a,
			a + 0.009,
			i % 8 ? 3 : 2,
		);
	}
	// Twelve separate titanium shoes, with paired fasteners and copper inlays.
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * TAU;
		arc(2, 1.31, 0.06, 0.064, a + 0.045, a + 0.47, 0, 1);
		arc(2, 1.31, 0.041, 0.074, a + 0.07, a + 0.44, 1, 3);
		arc(2, 1.383, 0.01, 0.034, a + 0.11, a + 0.4, 2);
		for (const offset of [0.1, 0.41])
			pin(
				2,
				[1.31 * Math.cos(a + offset), 0.075, 1.31 * Math.sin(a + offset)],
				0.018,
				0.007,
			);
	}
	// Counter-rotating split race. The dark outside and warm inner bevel separate it
	// optically from the neighboring silver assembly even when their axes align.
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * TAU;
		arc(3, 1.07, 0.063, 0.067, a + 0.06, a + 0.7, 0, 2);
		arc(3, 1.005, 0.011, 0.04, a + 0.1, a + 0.66, 4);
		arc(3, 1.145, 0.01, 0.027, a + 0.25, a + 0.51, 1);
	}
	// Inner double gimbal, connected by the same material rather than a HUD outline.
	arc(4, 0.835, 0.024, 0.067, 0, TAU, 1, 3);
	arc(4, 0.875, 0.009, 0.043, 0, TAU, 2);
	for (let i = 0; i < 24; i++) {
		const a = (i / 24) * TAU;
		arc(4, 0.81, 0.013, 0.078, a, a + 0.04, i % 3 ? 0 : 2);
	}
	// A thirty-six-blade rotor forms the iris immediately around the central jewel.
	arc(5, 0.55, 0.025, 0.045, 0, TAU, 0, 1);
	for (let i = 0; i < 36; i++) {
		const a = (i / 36) * TAU;
		const polar = (r, angle, y) => [
			r * Math.cos(angle),
			y,
			r * Math.sin(angle),
		];
		const p = polar(0.43, a, -0.025),
			q = polar(0.7, a + 0.095, 0.025);
		const r = polar(0.7, a + 0.13, 0.052),
			s = polar(0.43, a + 0.05, 0.005);
		triangle(p, q, r, i % 6 ? 1 : 2, 5);
		triangle(p, r, s, i % 6 ? 1 : 2, 5);
		const lowQ = [q[0], q[1] - 0.027, q[2]],
			lowR = [r[0], r[1] - 0.027, r[2]];
		triangle(q, lowQ, lowR, 0, 5);
		triangle(q, lowR, r, 0, 5);
	}
	// A faceted, open-jointed core: individual triangular metal panels sit above an
	// illuminated inner icosahedron, so the light exists in the cracks, not as a flare.
	const phi = (1 + Math.sqrt(5)) / 2;
	const points = [
		[-1, phi, 0],
		[1, phi, 0],
		[-1, -phi, 0],
		[1, -phi, 0],
		[0, -1, phi],
		[0, 1, phi],
		[0, -1, -phi],
		[0, 1, -phi],
		[phi, 0, -1],
		[phi, 0, 1],
		[-phi, 0, -1],
		[-phi, 0, 1],
	].map((p) => p.map((v) => (v / Math.hypot(1, phi)) * 0.335));
	const faces = [
		[0, 11, 5],
		[0, 5, 1],
		[0, 1, 7],
		[0, 7, 10],
		[0, 10, 11],
		[1, 5, 9],
		[5, 11, 4],
		[11, 10, 2],
		[10, 7, 6],
		[7, 1, 8],
		[3, 9, 4],
		[3, 4, 2],
		[3, 2, 6],
		[3, 6, 8],
		[3, 8, 9],
		[4, 9, 5],
		[2, 4, 11],
		[6, 2, 10],
		[8, 6, 7],
		[9, 8, 1],
	];
	for (let i = 0; i < faces.length; i++) {
		const face = faces[i].map((index) => points[index]);
		const center = [0, 1, 2].map(
			(axis) => (face[0][axis] + face[1][axis] + face[2][axis]) / 3,
		);
		const panel = face.map((p) =>
			p.map((v, axis) => center[axis] + (v - center[axis]) * 0.86),
		);
		triangle(...panel, i % 5 ? 3 : 2, 0);
		triangle(...face.map((p) => p.map((v) => v * 0.96)), 4, 0);
	}
	// Two fine physical light guides frame the mechanism; their illumination travels.
	arc(6, 1.77, 0.006, 0.006, 0.1, 2.75, 5);
	arc(6, 1.77, 0.006, 0.006, 3.25, 6.0, 5);
	for (const a of [0.1, 2.75, 3.25, 6.0])
		pin(6, [1.77 * Math.cos(a), -0.012, 1.77 * Math.sin(a)], 0.02, 0.025, 4);
	return {
		vertices: new Float32Array(vertices),
		indices: new Uint32Array(indices),
	};
}

export class ComputeSculpture {
	constructor(canvas) {
		this.canvas = canvas;
		this.enabled = !matchMedia("(prefers-reduced-motion: reduce)").matches;
		this.visible = true;
		this.targetDrive = this.drive = this.targetHeat = this.heat = 0;
		this.phase = 1.8;
		this.previous = this.lastDraw = this.raf = 0;
		this.pointer = new Float32Array(2);
		this.mouse = new Float32Array(2);
		this.accent = new Float32Array([1, 0.569, 0.4]);
		this.assemblies = new Float32Array(LAYERS * 9);
		this.world = new Float32Array(9);
		this.projection = new Float32Array(16);
		// Orthographic shadow basis for the studio key light at (3, 4, 5).
		this.light = new Float32Array([
			0.85749 / 2.1,
			-0.29104 / 2.1,
			-0.42426 / 3,
			0,
			0,
			0.82462 / 2.1,
			-0.56569 / 3,
			0,
			-0.5145 / 2.1,
			-0.48507 / 2.1,
			-Math.SQRT1_2 / 3,
			0,
			0,
			0,
			0,
			1,
		]);
		this.gl = canvas.getContext("webgl2", {
			alpha: true,
			premultipliedAlpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			powerPreference: "low-power",
		});
		if (!this.gl) {
			this.fallback();
			return;
		}
		try {
			this.setup();
		} catch (error) {
			console.warn("Aperture renderer:", error.message);
			this.fallback();
			return;
		}
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(canvas.parentElement);
		this.intersectionObserver = new IntersectionObserver((entries) => {
			this.visible = entries[0].isIntersecting;
			if (this.visible) {
				this.previous = 0;
				this.drawOnce();
				this.schedule();
			} else {
				cancelAnimationFrame(this.raf);
				this.raf = 0;
			}
		});
		this.intersectionObserver.observe(canvas);
		canvas.parentElement.addEventListener("pointermove", (event) => {
			if (event.pointerType === "touch") return;
			const rect = canvas.getBoundingClientRect();
			this.pointer[0] = (event.clientX - rect.left) / rect.width - 0.5;
			this.pointer[1] = (event.clientY - rect.top) / rect.height - 0.5;
		});
		canvas.parentElement.addEventListener("pointerleave", () =>
			this.pointer.fill(0),
		);
		document.addEventListener("visibilitychange", () => {
			this.previous = 0;
			if (document.hidden) {
				cancelAnimationFrame(this.raf);
				this.raf = 0;
			} else {
				this.drawOnce();
				this.schedule();
			}
		});
		canvas.addEventListener("webglcontextlost", (event) => {
			event.preventDefault();
			cancelAnimationFrame(this.raf);
			this.raf = 0;
			this.lost = true;
			this.fallback();
		});
		canvas.addEventListener("webglcontextrestored", () => {
			try {
				this.setup();
				this.lost = false;
				this.resize();
				this.schedule();
			} catch (error) {
				console.warn("Aperture restore:", error.message);
				this.fallback();
			}
		});
		this.resize();
		this.schedule();
	}
	fallback() {
		this.canvas.style.opacity = "0";
		this.canvas.parentElement.classList.remove("webgl-ready");
		const label = document.getElementById("renderer-label");
		if (label) label.textContent = "APERTURE / STATIC VIEW";
	}
	setup() {
		const gl = this.gl;
		this.meshProgram = program(gl, meshVertex, meshFragment, [
			"assemblies[0]",
			"world",
			"projection",
			"light",
			"shadow",
			"accent",
			"drive",
			"heat",
			"phase",
		]);
		this.shadowProgram = program(gl, shadowVertex, shadowFragment, [
			"assemblies[0]",
			"world",
			"light",
		]);
		this.blurProgram = program(gl, screenVertex, blurFragment, [
			"image",
			"step",
			"threshold",
		]);
		this.compositeProgram = program(gl, screenVertex, compositeFragment, [
			"image",
			"bloom",
			"pixel",
		]);
		const mesh = instrumentGeometry();
		this.indexCount = mesh.indices.length;
		this.meshVao = gl.createVertexArray();
		gl.bindVertexArray(this.meshVao);
		const vertexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
		for (const [index, size, offset] of [
			[0, 3, 0],
			[1, 3, 12],
			[2, 1, 24],
			[3, 1, 28],
		]) {
			gl.enableVertexAttribArray(index);
			gl.vertexAttribPointer(index, size, gl.FLOAT, false, 32, offset);
		}
		const indexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
		this.screenVao = gl.createVertexArray();
		this.shadowTexture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.DEPTH_COMPONENT16,
			768,
			768,
			0,
			gl.DEPTH_COMPONENT,
			gl.UNSIGNED_SHORT,
			null,
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		this.shadowFbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.TEXTURE_2D,
			this.shadowTexture,
			0,
		);
		gl.drawBuffers([gl.NONE]);
		gl.readBuffer(gl.NONE);
		this.checkFramebuffer();
		this.targets = [];
		this.canvas.parentElement.classList.add("webgl-ready");
		this.canvas.style.opacity = "1";
		const label = document.getElementById("renderer-label");
		if (label) label.textContent = "APERTURE / KINETIC ENGINE";
	}
	checkFramebuffer() {
		if (
			this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !==
			this.gl.FRAMEBUFFER_COMPLETE
		)
			throw new Error("Render target unavailable");
	}
	target(width, height, depth = false) {
		const gl = this.gl,
			texture = gl.createTexture(),
			fbo = gl.createFramebuffer();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			width,
			height,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			texture,
			0,
		);
		gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
		let buffer = null;
		if (depth) {
			buffer = gl.createRenderbuffer();
			gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
			gl.renderbufferStorage(
				gl.RENDERBUFFER,
				gl.DEPTH_COMPONENT16,
				width,
				height,
			);
			gl.framebufferRenderbuffer(
				gl.FRAMEBUFFER,
				gl.DEPTH_ATTACHMENT,
				gl.RENDERBUFFER,
				buffer,
			);
		}
		this.checkFramebuffer();
		return { texture, fbo, depth: buffer, width, height };
	}
	resize() {
		if (!this.meshProgram || this.lost) return;
		const rect = this.canvas.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const scale = Math.min(
			devicePixelRatio * 1.25,
			1.5,
			Math.sqrt(760000 / (rect.width * rect.height)),
		);
		const width = Math.max(1, Math.round(rect.width * scale)),
			height = Math.max(1, Math.round(rect.height * scale));
		if (
			width === this.canvas.width &&
			height === this.canvas.height &&
			this.targets.length
		) {
			this.drawOnce();
			return;
		}
		this.canvas.width = width;
		this.canvas.height = height;
		const gl = this.gl;
		for (const target of this.targets) {
			gl.deleteTexture(target.texture);
			gl.deleteFramebuffer(target.fbo);
			if (target.depth) gl.deleteRenderbuffer(target.depth);
		}
		this.targets = [
			this.target(width, height, true),
			this.target(Math.max(1, width >> 1), Math.max(1, height >> 1)),
			this.target(Math.max(1, width >> 1), Math.max(1, height >> 1)),
		];
		// Fit the short edge so portrait surfaces retain the complete instrument.
		const p = this.projection,
			aspect = width / height,
			f = Math.min(1, aspect) / Math.tan(0.32);
		p.fill(0);
		p[0] = f / aspect;
		p[5] = f;
		p[8] = aspect < 1.45 ? 0 : 0.08;
		p[10] = -1.0202;
		p[11] = -1;
		p[14] = -0.20202;
		this.drawOnce();
	}
	setTelemetry(snapshot) {
		this.targetDrive = Math.min(
			1,
			(snapshot.totals.gpu_util_avg / 100) *
				Math.min(1, snapshot.totals.power_pct / 25),
		);
		this.targetHeat = Math.max(
			0,
			Math.min(
				1,
				(Math.max(30, ...snapshot.gpus.map((gpu) => gpu.temperature_c)) - 35) /
					55,
			),
		);
	}
	setPalette(hex) {
		for (let i = 0; i < 3; i++)
			this.accent[i] = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
		this.drawOnce();
	}
	setMotion(enabled) {
		this.enabled = enabled;
		this.previous = 0;
		if (enabled) this.schedule();
		else {
			cancelAnimationFrame(this.raf);
			this.raf = 0;
			this.drawOnce();
		}
	}
	pose() {
		const a = this.assemblies,
			t = this.phase;
		rotation(
			this.world,
			0,
			-0.08 + this.mouse[1] * 0.22,
			this.mouse[0] * 0.35,
			-0.23,
		);
		rotation(a, 0, 0.35, -t * 0.48, 0.27);
		rotation(a, 9, 1.1 + Math.sin(t * 0.12) * 0.16, t * 0.11, 0.08);
		rotation(
			a,
			18,
			0.86 + Math.sin(t * 0.21) * 0.36,
			-t * 0.34,
			0.54 + t * 0.15,
		);
		rotation(
			a,
			27,
			1.8 + Math.sin(t * 0.17) * 0.25,
			t * 0.39,
			-0.48 - t * 0.18,
		);
		rotation(a, 36, 1.18 + t * 0.24, -t * 0.48, 0.38 + t * 0.16);
		rotation(a, 45, 1.03 + Math.sin(t * 0.19) * 0.48, t * 1.05, -0.28);
		rotation(a, 54, 0.56, -0.23, -0.44 + Math.sin(t * 0.08) * 0.22);
	}
	drawGeometry(p) {
		const gl = this.gl,
			u = p.uniforms;
		gl.useProgram(p.handle);
		gl.uniformMatrix3fv(u["assemblies[0]"], false, this.assemblies);
		gl.uniformMatrix3fv(u.world, false, this.world);
		gl.uniformMatrix4fv(u.light, false, this.light);
		gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
	}
	drawOnce() {
		if (!this.targets?.length || this.lost || !this.visible || document.hidden)
			return;
		const gl = this.gl,
			[scene, blurA, blurB] = this.targets;
		this.pose();
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.bindVertexArray(this.meshVao);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
		gl.viewport(0, 0, 768, 768);
		gl.clear(gl.DEPTH_BUFFER_BIT);
		this.drawGeometry(this.shadowProgram);
		gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
		gl.viewport(0, 0, scene.width, scene.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		const m = this.meshProgram;
		gl.useProgram(m.handle);
		gl.uniformMatrix4fv(m.uniforms.projection, false, this.projection);
		gl.uniform3fv(m.uniforms.accent, this.accent);
		gl.uniform1f(m.uniforms.drive, this.drive);
		gl.uniform1f(m.uniforms.heat, this.heat);
		gl.uniform1f(m.uniforms.phase, this.phase);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
		gl.uniform1i(m.uniforms.shadow, 0);
		this.drawGeometry(m);
		gl.disable(gl.DEPTH_TEST);
		gl.bindVertexArray(this.screenVao);
		const b = this.blurProgram;
		gl.useProgram(b.handle);
		gl.uniform1i(b.uniforms.image, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
		gl.viewport(0, 0, blurA.width, blurA.height);
		gl.bindTexture(gl.TEXTURE_2D, scene.texture);
		gl.uniform2f(b.uniforms.step, 2 / scene.width, 0);
		gl.uniform1f(b.uniforms.threshold, 1);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fbo);
		gl.bindTexture(gl.TEXTURE_2D, blurA.texture);
		gl.uniform2f(b.uniforms.step, 0, 1 / blurA.height);
		gl.uniform1f(b.uniforms.threshold, 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, scene.width, scene.height);
		const c = this.compositeProgram;
		gl.useProgram(c.handle);
		gl.bindTexture(gl.TEXTURE_2D, scene.texture);
		gl.uniform1i(c.uniforms.image, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, blurB.texture);
		gl.uniform1i(c.uniforms.bloom, 1);
		gl.uniform2f(c.uniforms.pixel, 1 / scene.width, 1 / scene.height);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.activeTexture(gl.TEXTURE0);
	}
	schedule() {
		if (
			this.raf ||
			!this.enabled ||
			!this.meshProgram ||
			this.lost ||
			!this.visible ||
			document.hidden
		)
			return;
		this.raf = requestAnimationFrame((time) => {
			this.raf = 0;
			const dt = this.previous
				? Math.min((time - this.previous) / 1000, 0.15)
				: 0;
			this.previous = time;
			const ease = 1 - Math.exp(-dt * 2.2);
			this.drive += (this.targetDrive - this.drive) * ease;
			this.heat += (this.targetHeat - this.heat) * ease;
			for (let i = 0; i < 2; i++)
				this.mouse[i] += (this.pointer[i] - this.mouse[i]) * ease;
			this.phase += dt * (0.72 + this.drive * 1.15);
			const interval = 1000 / (this.drive > 0.2 ? 30 : 24);
			if (time - this.lastDraw >= interval) {
				this.drawOnce();
				this.lastDraw = time - ((time - this.lastDraw) % interval);
			}
			this.schedule();
		});
	}
}
