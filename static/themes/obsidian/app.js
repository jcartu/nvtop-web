import {
	mergeFrame,
	SessionHistory,
	EventLog,
	number,
	compact,
	gib,
	duration,
	escapeHTML as esc,
	clamp,
	sum,
	modelName,
	modelEntries,
	processes,
	diagnostics,
	linkDegraded,
} from "./data.js?v=20260905h";
import { ComputeSculpture } from "./core.js?v=20260905h";
import { HistoryChart, chartMetrics, sparkline } from "./charts.js?v=20260905h";
import {
	modelIdentity,
	residentModels,
	chooseResident,
} from "./models.js?v=20260905h";

const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const text = (id, value) => {
	const el = typeof id === "string" ? $(id) : id;
	if (el && el.textContent !== String(value)) el.textContent = value;
};
const html = (el, value) => {
	if (el._html !== value) {
		el.innerHTML = value;
		el._html = value;
	}
};
const readPreference = (key, fallback) => {
	try {
		return localStorage.getItem(`obsidian-${key}`) ?? fallback;
	} catch {
		return fallback;
	}
};
const savePreference = (key, value) => {
	try {
		localStorage.setItem(`obsidian-${key}`, value);
	} catch {
		/* Private storage must not prevent live telemetry. */
	}
};
const history = new SessionHistory();
const events = new EventLog();
const sculpture = new ComputeSculpture($("core-canvas"));
const chart = new HistoryChart($("history-chart"), $("chart-tooltip"));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let snapshot = null,
	frozen = null,
	frozenPoints = null,
	frozenEnergy = 0,
	frozenEvents = null;
let paused = false,
	view = "overview",
	palette = "ember",
	color = "#ff9166";
let metric = "util",
	range = 300,
	source = null,
	reconnectTimer = null,
	reconnectAttempt = 0;
let lastMessage = 0,
	lastSample = 0,
	lastSlowRender = 0,
	lastEventCount = -1,
	renderFrame = 0;
let selectedGpu = null,
	selectedModel = null,
	streamState = "connecting";
let featuredModel = null;
let motion =
	readPreference("motion", "true") === "true" && !reducedMotion.matches;
const gpuCards = new Map(),
	modelCards = new Map();

function toast(message) {
	text("toast", message);
	$("toast").hidden = false;
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => {
		$("toast").hidden = true;
	}, 3500);
}
function setConnection(state) {
	streamState = state;
	const visual = paused && state === "live" ? "paused" : state;
	$("connection").dataset.state = visual;
	text(
		$("connection").querySelector("span"),
		visual === "live"
			? "LIVE TELEMETRY"
			: visual === "paused"
				? "DISPLAY PAUSED"
				: visual === "connecting"
					? "CONNECTING"
					: "LINK INTERRUPTED",
	);
	$("status-banner").hidden = state === "live" && !paused;
	if (state !== "live")
		text(
			"status-banner",
			snapshot
				? "The telemetry link is interrupted. Last values are retained and may be stale. Reconnecting automatically…"
				: "Connecting to the local telemetry collector. Measurements will appear as soon as the link is established.",
		);
	else if (paused)
		text(
			"status-banner",
			`Display frozen at ${new Date(frozen.generated_at).toLocaleTimeString("en-GB")}. Collection continues in the background. Press Space or the play button to return to live.`,
		);
}
function renderMetrics(data) {
	const totals = data.totals,
		gpus = data.gpus;
	const used = sum(gpus, "memory_used_mib"),
		total = sum(gpus, "memory_total_mib");
	const peak = gpus.length
		? Math.max(...gpus.map((gpu) => gpu.temperature_c))
		: null;
	text("workspace-host", data.host);
	text("nav-gpus", gpus.length);
	text(
		"nav-models",
		modelEntries(data).filter((model) => model.healthy || model.state).length,
	);
	text(
		"side-hardware",
		`${gpus.length} × ${gpus[0]?.name?.replace(" Workstation Edition", "") || "No accelerators"}`,
	);
	text("side-memory", `${gib(total)} GiB ADDRESSABLE`);
	document.querySelectorAll(".mini-lanes i").forEach((lane, index) => {
		lane.style.opacity = gpus[index]
			? String(0.25 + gpus[index].utilization_gpu_pct / 133)
			: "0";
	});
	text("metric-util", gpus.length ? number(totals.gpu_util_avg) : "—");
	text("metric-gpu-count", `${gpus.length} accelerators`);
	text("metric-memory", gib(used));
	text("metric-memory-total", `/ ${gib(total)}`);
	text("metric-memory-free", `${gib(total - used)} GiB available`);
	text("metric-memory-pct", `${number(total ? (used / total) * 100 : 0, 1)}%`);
	$("memory-fill").style.width = `${clamp(total ? (used / total) * 100 : 0)}%`;
	text("metric-tps", number(totals.total_tps, totals.total_tps < 100 ? 1 : 0));
	text("metric-output", `${compact(totals.output_tps)} decode`);
	text("metric-input", `${compact(totals.input_tps)} prefill`);
	text("metric-power", number(totals.power_draw_w));
	text(
		"metric-headroom",
		`${number(Math.max(0, totals.power_limit_w - totals.power_draw_w))} W headroom`,
	);
	text("metric-power-pct", `${number(totals.power_pct, 1)}% of limit`);
	html(
		$("core-util"),
		`${gpus.length ? number(totals.gpu_util_avg) : "—"}<small>%</small>`,
	);
	text("core-temperature", `${number(peak)}°C PEAK`);
	text("hero-uptime", `UPTIME ${duration(data.uptime_seconds).toUpperCase()}`);
	const issues = diagnostics(data).filter((item) => item.level !== "good");
	text(
		"hero-status",
		!gpus.length
			? "No accelerators detected"
			: issues.length
				? `${issues.length} advisory ${issues.length === 1 ? "signal" : "signals"}`
				: "System nominal",
	);
	$("hero-status").classList.toggle("warn", !!issues.length);
	text(
		"gpu-description",
		`${gpus.length} ACCELERATORS / ${gib(total)} GiB TOTAL`,
	);
	text("capacity-free", gib(total - used));
	$("capacity-arc").style.strokeDashoffset = String(
		100 - (total ? clamp(((total - used) / total) * 100) : 0),
	);
	html(
		$("efficiency"),
		`${totals.output_tps > 0 && totals.power_draw_w > 0 ? number(totals.output_tps / totals.power_draw_w, 2) : "—"} <small>tok/J</small>`,
	);
	html(
		$("session-energy"),
		`${number(paused ? frozenEnergy : history.energyWh, 2)} <small>Wh</small>`,
	);
	const hottest = [...gpus].sort(
		(a, b) => b.temperature_c - a.temperature_c,
	)[0];
	text(
		"hottest",
		hottest ? `GPU ${hottest.index} / ${number(hottest.temperature_c)}°C` : "—",
	);
	const minFree = gpus.length
		? Math.min(
				...gpus.map((g) => (g.memory_total_mib - g.memory_used_mib) / 1024),
			)
		: 0;
	text(
		"capacity-insight",
		gpus.length
			? `${number(minFree, 1)} GiB free on the tightest device. Memory is per GPU, not a shared pool. Energy covers this tab’s observed samples only.`
			: "No accelerator measurements available. Capacity and efficiency require live hardware telemetry.",
	);
	text(
		"footer-system",
		`${data.host} · NVIDIA ${data.driver || "—"} · CUDA ${data.cuda || "—"} · ${number(1 / data.poll_seconds)} Hz GPU / ${number(1 / data.llm_poll_seconds)} Hz LLM`,
	);
	sculpture.setTelemetry(data);
}
function gpuTemplate(gpu) {
	return `<div class="gpu-card-top"><span class="gpu-index">${icon("chip")} GPU ${String(gpu.index).padStart(2, "0")}</span><span class="gpu-pstate" data-field="pstate"></span></div><h3>${esc(gpu.name.replace(" Workstation Edition", "").replace(" Blackwell", ""))}</h3><div class="gpu-arch">${gpu.name.includes("Blackwell") ? "BLACKWELL" : "NVIDIA"} · ${gib(gpu.memory_total_mib)} GiB · PCIe ${gpu.pcie_gen_max || "—"}.0</div><div class="gpu-util-row"><div><span class="gpu-util"><span data-field="util"></span><small>%</small></span><span class="gpu-util-label">GPU UTILIZATION</span></div><span class="gpu-temp"><i class="temp-dot"></i><span data-field="temp"></span></span></div><div class="segment-meter" aria-hidden="true">${"<i></i>".repeat(28)}</div><div class="gpu-row"><span>VRAM</span><strong><span data-field="memory"></span> <small>/ ${gib(gpu.memory_total_mib)} GiB</small></strong></div><div class="thin-meter"><i data-field="memory-bar"></i></div><div class="gpu-row"><span>POWER</span><strong><span data-field="power"></span> <small>/ ${number(gpu.power_limit_w)} W</small></strong></div><div class="thin-meter"><i class="power-bar" data-field="power-bar"></i></div><div class="gpu-card-bottom"><span data-field="process"></span>${icon("arrow")}</div>`;
}
function renderGpus(data) {
	const present = new Set();
	const sort = $("gpu-sort").value;
	const ordered = [...data.gpus].sort((a, b) =>
		sort === "index"
			? a.index - b.index
			: b[sort] - a[sort] || a.index - b.index,
	);
	if (!gpuCards.size && ordered.length) {
		$("gpu-grid").replaceChildren();
		$("gpu-grid")._html = null;
	}
	for (const [position, gpu] of ordered.entries()) {
		present.add(gpu.index);
		let card = gpuCards.get(gpu.index);
		if (!card) {
			card = document.createElement("button");
			card.className = "gpu-card entering";
			card.dataset.gpu = gpu.index;
			card.addEventListener("click", () => openGpu(gpu.index));
			gpuCards.set(gpu.index, card);
			$("gpu-grid").append(card);
		}
		const identity = `${gpu.uuid}/${gpu.name}/${gpu.memory_total_mib}/${gpu.power_limit_w}`;
		if (card.identity !== identity) {
			card.innerHTML = gpuTemplate(gpu);
			card.fields = Object.fromEntries(
				[...card.querySelectorAll("[data-field]")].map((el) => [
					el.dataset.field,
					el,
				]),
			);
			card.segments = [...card.querySelectorAll(".segment-meter i")];
			card.identity = identity;
		}
		card.style.order = position;
		const fields = card.fields;
		text(fields.pstate, gpu.pstate || "—");
		text(fields.util, number(gpu.utilization_gpu_pct));
		text(fields.temp, `${number(gpu.temperature_c)}°`);
		text(fields.memory, gib(gpu.memory_used_mib));
		text(fields.power, number(gpu.power_draw_w));
		text(
			fields.process,
			gpu.processes?.length
				? `${gpu.processes.length} COMPUTE ${gpu.processes.length === 1 ? "PROCESS" : "PROCESSES"}`
				: "NO COMPUTE PROCESSES",
		);
		fields["memory-bar"].style.width = `${clamp(gpu.memory_pct)}%`;
		fields["power-bar"].style.width = `${clamp(gpu.power_pct)}%`;
		const lit = Math.round(
			(clamp(gpu.utilization_gpu_pct) / 100) * card.segments.length,
		);
		card.segments.forEach((segment, index) => {
			segment.classList.toggle("lit", index < lit);
		});
		card.classList.toggle("hot", gpu.temperature_c >= 75);
		card.classList.toggle("critical", gpu.temperature_c >= 90);
		card.setAttribute(
			"aria-label",
			`Inspect GPU ${gpu.index}, ${gpu.name}, ${number(gpu.utilization_gpu_pct)} percent utilization, ${number(gpu.temperature_c)} degrees Celsius`,
		);
	}
	for (const [index, card] of gpuCards)
		if (!present.has(index)) {
			card.remove();
			gpuCards.delete(index);
		}
	if (!ordered.length)
		html(
			$("gpu-grid"),
			'<div class="empty-state">No accelerators reported. The collector will discover devices automatically when available.</div>',
		);
}
function modelStatus(model) {
	return model.state === "loading"
		? "Loading"
		: model.state === "memory"
			? "In memory"
			: model.healthy
				? "Online"
				: "Offline";
}
function brandMark(identity, kind = "model") {
	const file = kind === "company" ? identity.companyLogo : identity.modelLogo;
	const label =
		kind === "company"
			? `${identity.company} publisher mark`
			: `${identity.family} model-family mark`;
	return `<span class="model-mark ${file ? "has-artwork" : ""}">${file ? `<img class="brand-artwork" src="/static/themes/obsidian/brands/${file}?v=20260905g" alt="${esc(label)}" width="64" height="64" decoding="async">` : ""}<span class="brand-fallback" aria-hidden="true">${icon("orbit")}</span></span>`;
}
function identityHeading(identity, titleId) {
	const company = `<span class="publisher-name">${esc(identity.company)}</span>`;
	return `<div class="model-publisher">${brandMark(identity, "company")}<div><span class="publisher-label">FAMILY PUBLISHER</span>${identity.companySource ? `<a href="${identity.companySource}" target="_blank" rel="noopener noreferrer">${company}${icon("arrow")}</a>` : company}</div></div><div class="brand-heading">${brandMark(identity)}<div><h2 class="featured-title" id="${titleId}">${esc(identity.title)}</h2><div class="featured-engine"><span class="engine-badge" title="${esc(identity.engineVersion)}">${esc(identity.engine)}</span><span>${esc(identity.family)} family</span></div></div></div>`;
}
function renderFeatured(models) {
	const resident = residentModels(models);
	featuredModel = chooseResident(resident, featuredModel);
	const picker = $("featured-select");
	$("featured-picker").hidden = resident.length < 2;
	html(
		picker,
		resident
			.map(
				(model) =>
					`<option value="${esc(model.id)}">${esc(modelName(model))}</option>`,
			)
			.join(""),
	);
	picker.value = featuredModel?.id || "";
	text(
		"featured-count",
		`${resident.length} ${resident.length === 1 ? "MODEL" : "MODELS"} RESIDENT`,
	);
	$("featured-inspect").disabled = !featuredModel;
	$("featured-facts").hidden = !featuredModel;
	$("featured-performance").hidden = !featuredModel;
	$("featured-loading").hidden = !featuredModel?.loading;
	if (!featuredModel) {
		html(
			$("featured-identity"),
			`<div class="featured-empty-mark">${icon("orbit")}</div><h2 class="featured-title" id="featured-title">Your next model.<br><span class="accent">In focus.</span></h2>`,
		);
		text(
			"featured-summary",
			"No model is currently reported online, loading, or resident in GPU memory. vLLM, SGLang, and other detected engines appear here automatically when a model is discovered.",
		);
		text("featured-source", "AUTOMATIC MODEL DISCOVERY");
		html($("featured-facts"), "");
		html($("featured-loading"), "");
		text("featured-live", "");
		text("featured-status", "");
		return;
	}
	const model = featuredModel,
		intel = model.intel || {},
		identity = modelIdentity(model);
	const status = modelStatus(model);
	html($("featured-identity"), identityHeading(identity, "featured-title"));
	text("featured-summary", identity.summary);
	text("featured-source", identity.summarySource);
	const context = intel.ctx_serving ?? intel.ctx_native;
	const memory = model.vram_mib ?? intel.vram_mib;
	const weights = intel.weights_gb ?? model.disk_gb;
	html(
		$("featured-facts"),
		[
			fact("Parameters", intel.params),
			fact(
				intel.ctx_serving != null ? "Serving context" : "Native context",
				context != null ? `${number(context)} tokens` : null,
			),
			fact("Quantization", intel.quant?.replaceAll("_", " ")),
			fact("GPU memory", memory != null ? `${gib(memory)} GiB` : null),
			fact(
				"Weights on disk",
				weights != null ? `${number(weights, 1)} GB` : null,
			),
			fact(
				"Accelerators",
				model.gpu_indices?.length
					? model.gpu_indices.map((index) => `GPU ${index}`).join(" · ")
					: null,
			),
		].join(""),
	);
	text("featured-status", status);
	$("featured-status").classList.toggle("warn", status === "Loading");
	text(
		"featured-live",
		model.healthy
			? `${number(model.output_tps, 1)} tok/s decode · ${number(model.running)} active · ${number(model.waiting)} queued`
			: status === "Loading"
				? "Weights are being prepared"
				: "Detected in GPU memory",
	);
	if (model.loading) {
		const load = model.loading;
		html(
			$("featured-loading"),
			`<div><span>${esc(load.detail || load.stage || "Loading weights")}</span><strong>${load.pct != null ? `${number(load.pct, 1)}% estimated` : "Staging"}${load.eta_s != null ? ` · ${duration(load.eta_s)} ETA` : ""}</strong></div><div class="thin-meter"><i style="width:${clamp(load.pct)}%"></i></div>`,
		);
	}
}
$("featured-select").addEventListener("change", (event) => {
	const models = modelEntries(paused ? frozen : snapshot);
	featuredModel =
		models.find((model) => model.id === event.target.value) || null;
	renderFeatured(models);
});
$("featured-inspect").addEventListener("click", () => {
	if (featuredModel) openModel(featuredModel.id);
});
document.addEventListener(
	"error",
	(event) => {
		if (!event.target.matches?.("img.brand-artwork")) return;
		event.target.hidden = true;
		event.target.closest(".model-mark").classList.remove("has-artwork");
		event.target.closest(".model-mark").title = "Publisher artwork unavailable";
	},
	true,
);
function modelTemplate(model) {
	const intel = model.intel || {},
		status = modelStatus(model);
	const identity = modelIdentity(model),
		engine = identity.engine;
	const metadata = [
		engine,
		intel.params,
		intel.quant?.replaceAll("_", " "),
		model.port ? `:${model.port}` : "",
	]
		.filter(Boolean)
		.join(" / ");
	let result = `<div class="model-ident"><span class="model-glyph">${brandMark(identity)}</span><div><h3>${esc(modelName(model))}</h3><p>${esc(metadata)}</p></div></div><div class="model-cell"><span class="eyebrow">STATE</span><span class="status-chip ${status === "Loading" ? "warn" : status === "Offline" ? "bad" : ""}">${esc(status)}</span></div><div class="model-cell model-performance"><span class="eyebrow">${model.healthy ? "DECODE / OUTPUT" : "GPU MEMORY"}</span><strong>${model.healthy ? number(model.output_tps, 1) : gib(model.vram_mib ?? intel.vram_mib)} <small>${model.healthy ? "tok/s" : "GiB"}</small></strong></div><div class="model-cell gpu-attribution"><span class="eyebrow">ACCELERATORS</span><div class="model-chips">${(model.gpu_indices || []).map((index) => `<span>GPU ${Number(index)}</span>`).join("") || "<span>Not resident yet</span>"}</div></div>${icon("arrow")}`;
	if (model.loading) {
		const load = model.loading;
		result += `<div class="model-progress"><div class="gpu-row"><span>${esc(load.detail || load.stage || "Loading weights")}</span><strong>${load.pct != null ? `${number(load.pct, 1)}% estimated` : "Staging"}${load.eta_s != null ? ` · ${duration(load.eta_s)} ETA` : ""}</strong></div><div class="thin-meter"><i style="width:${clamp(load.pct)}%;background:var(--accent)"></i></div></div>`;
	}
	return result;
}
function renderModels(data) {
	const models = modelEntries(data),
		present = new Set();
	renderFeatured(models);
	const online = (data.models || []).filter((m) => m.healthy).length;
	text(
		"model-summary",
		`${online} ONLINE / ${models.filter((m) => m.state === "loading").length} LOADING / ${models.filter((m) => m.state === "memory").length} IN MEMORY`,
	);
	if (!modelCards.size && models.length) {
		$("model-list").replaceChildren();
		$("model-list")._html = null;
	}
	for (const model of models) {
		present.add(model.id);
		let card = modelCards.get(model.id);
		if (!card) {
			card = document.createElement("button");
			card.className = "model-row";
			card.addEventListener("click", () => openModel(model.id));
			modelCards.set(model.id, card);
			$("model-list").append(card);
		}
		card.classList.toggle("model-offline", modelStatus(model) === "Offline");
		card.setAttribute(
			"aria-label",
			`Inspect ${modelName(model)}, ${modelStatus(model)}`,
		);
		html(card, modelTemplate(model));
	}
	for (const [id, card] of modelCards)
		if (!present.has(id)) {
			card.remove();
			modelCards.delete(id);
		}
	if (!models.length)
		html(
			$("model-list"),
			'<div class="empty-state">The silicon is yours.<br>No models detected in memory or at inference endpoints. Discovery continues automatically.</div>',
		);
}
function renderHealth(data) {
	const health = diagnostics(data),
		issues = health.filter((item) => item.level !== "good");
	text(
		"health-count",
		issues.length
			? `${issues.length} ${issues.length === 1 ? "advisory" : "advisories"}`
			: "All clear",
	);
	$("health-count").classList.toggle("warn", !!issues.length);
	html(
		$("health-list"),
		health
			.map(
				(item) =>
					`<div class="health-item"><span class="health-icon ${item.level}">${item.level === "good" ? "✓" : "!"}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div><span class="health-value">${esc(item.value)}</span></div>`,
			)
			.join(""),
	);
}
function renderEvents(force = false) {
	const entries = paused ? frozenEvents : events.entries;
	if (
		!force &&
		entries.length === lastEventCount &&
		entries[0]?.ts === renderEvents.latest
	)
		return;
	lastEventCount = entries.length;
	renderEvents.latest = entries[0]?.ts;
	text("nav-events", entries.length);
	const filtered =
		$("event-filter").value === "warning"
			? entries.filter((event) => ["warning", "critical"].includes(event.level))
			: entries;
	html(
		$("event-list"),
		filtered
			.map(
				(event) =>
					`<div class="event ${event.level}"><span class="event-dot"></span><div><strong>${esc(event.title)}</strong>${event.detail ? `<p>${esc(event.detail)}</p>` : ""}</div><time datetime="${new Date(event.ts).toISOString()}">${new Date(event.ts).toLocaleTimeString("en-GB")}</time></div>`,
			)
			.join("") ||
			'<div class="empty-state">No matching events this session.</div>',
	);
}
function renderProcesses(data) {
	const query = $("process-search").value.trim().toLowerCase();
	const rows = processes(data).filter((p) =>
		`${p.process_name} ${p.pid} ${p.model} ${p.gpus.join(" ")}`
			.toLowerCase()
			.includes(query),
	);
	html(
		$("process-table"),
		rows
			.map(
				(p) =>
					`<tr><td><strong>${esc(p.process_name)}</strong><small>PID ${p.pid}</small></td><td>${p.gpus.map((index) => `GPU ${index}`).join(", ")}</td><td>${esc(p.model || "Unattributed compute process")}</td><td class="number mono">${gib(p.used_memory_mib)} GiB</td></tr>`,
			)
			.join("") ||
			`<tr><td colspan="4">${query ? "No processes match your search." : "No compute processes are currently reported."}</td></tr>`,
	);
}
function renderCharts(data) {
	const allPoints = paused ? frozenPoints : history.points;
	const end = Date.parse(data.generated_at);
	const points = allPoints.filter(
		(p) => p.ts >= end - range * 1000 && p.ts <= end,
	);
	chart.update(points, metric, range, end, color);
	const config = chartMetrics[metric];
	const current =
		metric === "util"
			? data.totals.gpu_util_avg
			: metric === "tps"
				? data.totals.total_tps
				: metric === "power"
					? data.totals.power_draw_w
					: data.gpus.length
						? Math.max(...data.gpus.map((g) => g.temperature_c))
						: null;
	text("chart-current", number(current, config.digits));
	text("chart-unit", config.caption);
	text("chart-legend-label", config.legend);
	const values = points.map((p) => p[metric]).filter(Number.isFinite);
	text(
		"chart-peak",
		`PEAK ${values.length ? number(Math.max(...values), config.digits) : "—"} ${config.unit}`,
	);
	text(
		"history-coverage",
		points.length
			? `${duration((points.at(-1).ts - points[0].ts) / 1000)} observed · ${points.length} samples`
			: "Collecting history",
	);
	text(
		"chart-now",
		paused ? "FROZEN" : streamState === "live" ? "LIVE / LOCAL TIME" : "STALE",
	);
	const h = data.totals.history || {};
	sparkline($("micro-util"), h.gpu_util_avg || [], color, 100);
	sparkline($("micro-tps"), h.total_tps || [], "#a5b9d6");
	sparkline($("micro-power"), h.power_total || [], "#cbbda5");
}
function render(force = false) {
	const data = paused ? frozen : snapshot;
	if (!data?.totals || !data.gpus) return;
	renderMetrics(data);
	renderGpus(data);
	const now = performance.now();
	if (force || now - lastSlowRender >= 900) {
		renderModels(data);
		renderCharts(data);
		renderHealth(data);
		renderEvents(force);
		if (view === "accelerators" || view === "inference") renderProcesses(data);
		if ($("gpu-dialog").open) renderGpuDetail(data);
		if ($("model-dialog").open) renderModelDetail(data);
		lastSlowRender = now;
	}
}
function scheduleRender() {
	if (renderFrame || paused || document.hidden) return;
	renderFrame = requestAnimationFrame(() => {
		renderFrame = 0;
		render();
	});
}
function accept(frame) {
	const next = mergeFrame(snapshot, frame);
	if (!next?.totals || !Array.isArray(next.gpus))
		throw new Error("Missing telemetry baseline");
	snapshot = next;
	lastMessage = Date.now();
	reconnectAttempt = 0;
	setConnection("live");
	history.add(snapshot);
	if (lastMessage - lastSample >= 900) {
		events.observe(snapshot);
		lastSample = lastMessage;
	}
	scheduleRender();
}
function reconnect() {
	if (reconnectTimer) return;
	source?.close();
	source = null;
	setConnection("stale");
	reconnectTimer = setTimeout(
		() => {
			reconnectTimer = null;
			connect();
		},
		Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempt++, 4)),
	);
}
function connect() {
	source?.close();
	if (document.hidden) return;
	source = new EventSource("/api/stream");
	source.onmessage = (event) => {
		try {
			accept(JSON.parse(event.data));
		} catch (error) {
			console.warn("Telemetry frame rejected:", error.message);
			reconnect();
		}
	};
	source.onerror = async () => {
		if (streamState === "live")
			events.push(
				"warning",
				"Telemetry connection interrupted",
				"Last values retained. Automatic reconnection is active.",
			);
		reconnect();
		try {
			const response = await fetch("/api/snapshot", {
				cache: "no-store",
				signal: AbortSignal.timeout(5000),
			});
			if (response.status === 401) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
				source?.close();
				location.assign("/login");
			}
		} catch {
			/* The visible stale state remains until a full baseline reconnects. */
		}
	};
}
setInterval(() => {
	if (!document.hidden && lastMessage && Date.now() - lastMessage > 8000)
		reconnect();
}, 2500);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		source?.close();
		source = null;
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
		history.previousEnergy = null;
	} else {
		connect();
		render(true);
	}
});
window.addEventListener("online", () => {
	clearTimeout(reconnectTimer);
	reconnectTimer = null;
	connect();
});
window.addEventListener("offline", reconnect);

function navigate(next, updateHash = true) {
	if (!["overview", "accelerators", "inference", "activity"].includes(next))
		next = "overview";
	view = next;
	const titles = {
		overview: ["Cluster overview", "YOUR HARDWARE. A HIGHER PERSPECTIVE."],
		accelerators: ["Meet the machine", "EVERY ACCELERATOR. EVERY DETAIL."],
		inference: ["Intelligence, resident", "FROM WEIGHTS TO WORKLOADS."],
		activity: ["Follow the signal", "THE MACHINE HAS A STORY TO TELL."],
	};
	const apply = () => {
		document.body.dataset.view = view;
		document.querySelectorAll("[data-views]").forEach((section) => {
			section.hidden = !section.dataset.views.split(" ").includes(view);
		});
		document.querySelectorAll("nav [data-view]").forEach((link) => {
			const active = link.dataset.view === view;
			link.classList.toggle("active", active);
			if (active) link.setAttribute("aria-current", "page");
			else link.removeAttribute("aria-current");
		});
		text("view-title", view[0].toUpperCase() + view.slice(1));
		html($("page-heading"), `${titles[view][0]}<span class="accent">.</span>`);
		text("view-eyebrow", titles[view][1]);
		if (updateHash) window.history.replaceState(null, "", `#${view}`);
		window.scrollTo({ top: 0, behavior: "instant" });
		render(true);
	};
	if (document.startViewTransition && !reducedMotion.matches && snapshot)
		document.startViewTransition(apply);
	else apply();
}
document
	.querySelectorAll('[data-view], .brand[href="#overview"]')
	.forEach((link) => {
		link.addEventListener("click", (event) => {
			event.preventDefault();
			navigate(link.dataset.view || "overview");
		});
	});
window.addEventListener("hashchange", () =>
	navigate(location.hash.slice(1), false),
);
$("gpu-sort").addEventListener("change", () => {
	if (snapshot) renderGpus(paused ? frozen : snapshot);
});
$("process-search").addEventListener("input", () => {
	if (snapshot) renderProcesses(paused ? frozen : snapshot);
});
$("event-filter").addEventListener("change", () => renderEvents(true));
document.querySelectorAll("[data-metric]").forEach((button) => {
	button.addEventListener("click", () => {
		metric = button.dataset.metric;
		document.querySelectorAll("[data-metric]").forEach((b) => {
			b.classList.toggle("selected", b === button);
			b.setAttribute("aria-pressed", String(b === button));
		});
		if (snapshot) renderCharts(paused ? frozen : snapshot);
	});
});
document.querySelectorAll("[data-range]").forEach((button) => {
	button.addEventListener("click", () => {
		range = +button.dataset.range;
		document.querySelectorAll("[data-range]").forEach((b) => {
			b.classList.toggle("selected", b === button);
			b.setAttribute("aria-pressed", String(b === button));
		});
		if (snapshot) renderCharts(paused ? frozen : snapshot);
	});
});
function togglePause() {
	if (!snapshot) return;
	paused = !paused;
	if (paused) {
		frozen = structuredClone(snapshot);
		frozenPoints = [...history.points];
		frozenEnergy = history.energyWh;
		frozenEvents = [...events.entries];
	} else {
		frozen = null;
		frozenPoints = null;
		frozenEvents = null;
	}
	text("pause", paused ? "▷" : "Ⅱ");
	$("pause").setAttribute(
		"aria-label",
		paused ? "Resume live telemetry display" : "Pause telemetry display",
	);
	$("pause").setAttribute("aria-pressed", String(paused));
	sculpture.setMotion(motion && !paused);
	setConnection(streamState);
	render(true);
}
$("pause").addEventListener("click", togglePause);
function openDialog(dialog) {
	if (!dialog.open) dialog.showModal();
}
document.querySelectorAll("[data-close]").forEach((button) => {
	button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach((dialog) => {
	dialog.addEventListener("click", (event) => {
		if (event.target !== dialog) return;
		const rect = dialog.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		)
			dialog.close();
	});
});
const fact = (label, value) =>
	`<div class="detail-fact"><span>${esc(label)}</span><strong>${esc(value == null || value === "" ? "Not reported" : value)}</strong></div>`;
const detailMetric = (value, unit, label) =>
	`<div class="detail-metric"><strong>${esc(value)}<small>${esc(unit)}</small></strong><span class="eyebrow">${esc(label)}</span></div>`;
function openGpu(index) {
	selectedGpu = index;
	renderGpuDetail(paused ? frozen : snapshot);
	openDialog($("gpu-dialog"));
}
function renderGpuDetail(data) {
	const gpu = data.gpus.find((g) => g.index === selectedGpu);
	if (!gpu) {
		html(
			$("gpu-detail"),
			'<h2 id="gpu-detail-title">Accelerator disconnected</h2><p class="detail-description">This device is no longer reported by the collector.</p>',
		);
		return;
	}
	const aer = gpu.pcie_aer || {};
	html(
		$("gpu-detail"),
		`<h2 id="gpu-detail-title">GPU ${String(gpu.index).padStart(2, "0")}<span class="accent"> / </span>${esc(gpu.name.replace(" Workstation Edition", ""))}</h2><p class="detail-subtitle">${esc(gpu.uuid)}<br>PCI ${esc(gpu.bus_id)} · ${paused ? "FROZEN SNAPSHOT" : streamState === "live" ? "LIVE MEASUREMENTS" : "STALE MEASUREMENTS"}</p><div class="detail-metrics">${detailMetric(number(gpu.utilization_gpu_pct), "%", "COMPUTE UTILIZATION")}${detailMetric(number(gpu.temperature_c), "°C", "DIE TEMPERATURE")}${detailMetric(number(gpu.power_draw_w), "W", "BOARD POWER")}</div><div class="detail-grid">${fact("Memory allocated", `${gib(gpu.memory_used_mib)} / ${gib(gpu.memory_total_mib)} GiB`)}${fact("Memory controller", `${number(gpu.utilization_memory_pct)}%`)}${fact("Graphics clock", `${number(gpu.graphics_clock_mhz)} MHz`)}${fact("Memory clock", `${number(gpu.memory_clock_mhz)} MHz`)}${fact("Fan speed", `${number(gpu.fan_pct)}%`)}${fact("Power state", gpu.pstate)}${fact("PCIe negotiated", `Gen ${gpu.pcie_gen} ×${gpu.pcie_width}`)}${fact("PCIe maximum", `Gen ${gpu.pcie_gen_max} ×${gpu.pcie_width_max}`)}${fact("Link condition", linkDegraded(gpu) ? "Degraded under load" : gpu.pcie_gen < gpu.pcie_gen_max ? "Idle downshift / nominal" : "Nominal")}${fact("Power limit", `${number(gpu.power_limit_w)} W`)}${fact("Correctable AER", number(aer.total_correctable))}${fact("Fatal / nonfatal AER", `${number(aer.total_fatal)} / ${number(aer.total_nonfatal)}`)}</div><h3 class="detail-heading">Processes on this accelerator</h3><div class="table-scroll"><table><thead><tr><th>Process</th><th>PID</th><th class="number">Device VRAM</th></tr></thead><tbody>${(gpu.processes || []).map((p) => `<tr><td>${esc(p.process_name)}</td><td class="mono">${p.pid}</td><td class="number mono">${gib(p.used_memory_mib)} GiB</td></tr>`).join("") || '<tr><td colspan="3">No compute processes on this device.</td></tr>'}</tbody></table></div><p class="detail-description">AER values are cumulative kernel counters, not necessarily current faults. Model throughput cannot be measured independently per tensor-parallel GPU; cluster inference is shown without inventing a per-device rate.</p>`,
	);
}
function openModel(id) {
	selectedModel = id;
	renderModelDetail(paused ? frozen : snapshot);
	openDialog($("model-dialog"));
}
function renderModelDetail(data) {
	const model = modelEntries(data).find((m) => m.id === selectedModel);
	if (!model) {
		html(
			$("model-detail"),
			'<h2 id="model-detail-title">Model no longer resident</h2><p class="detail-description">It was released or replaced while this inspector was open.</p>',
		);
		return;
	}
	const intel = model.intel || {},
		live = Object.hasOwn(model, "healthy"),
		identity = modelIdentity(model);
	const facts = [
		fact("Status", modelStatus(model)),
		fact(
			"Engine",
			[
				model.engine || model.app || intel.engine,
				model.engine_version || intel.engine_version,
			]
				.filter(Boolean)
				.join(" "),
		),
		fact("Parameters", intel.params),
		fact("Quantization", intel.quant),
		fact(
			"Serving context",
			intel.ctx_serving ? `${number(intel.ctx_serving)} tokens` : null,
		),
		fact(
			"Native context",
			intel.ctx_native ? `${number(intel.ctx_native)} tokens` : null,
		),
		fact("Architecture", intel.arch),
		fact(
			"Weight size on disk",
			intel.weights_gb || model.disk_gb
				? `${number(intel.weights_gb || model.disk_gb, 1)} GB`
				: null,
		),
		fact(
			"GPU memory",
			model.vram_mib != null || intel.vram_mib != null
				? `${gib(model.vram_mib ?? intel.vram_mib)} GiB`
				: null,
		),
		fact("Worker uptime", duration(intel.uptime_s ?? model.uptime_s)),
		fact("Tensor parallelism", intel.tp),
		fact("License", intel.license),
	];
	if (live)
		facts.push(
			fact(
				"Time to first token",
				model.ttft_ms != null ? `${number(model.ttft_ms, 1)} ms` : null,
			),
			fact(
				"Inter-token latency",
				model.inter_token_ms != null
					? `${number(model.inter_token_ms, 1)} ms`
					: null,
			),
			fact("KV cache allocation", `${number(model.kv_cache_pct, 1)}%`),
			fact("Running / queued", `${model.running} / ${model.waiting}`),
			fact("Prefill tokens (counter)", compact(model.prompt_tokens_total)),
			fact("Output tokens (counter)", compact(model.generation_tokens_total)),
		);
	if (model.loading)
		facts.push(
			fact("Loading stage", model.loading.stage),
			fact(
				"Estimated progress",
				model.loading.pct != null ? `${number(model.loading.pct, 1)}%` : null,
			),
			fact("Estimated time remaining", duration(model.loading.eta_s)),
			fact(
				"Disk read rate",
				model.loading.disk_read_mbps != null
					? `${number(model.loading.disk_read_mbps)} MB/s`
					: null,
			),
			fact(
				"Loader CPU",
				model.loading.cpu_pct != null
					? `${number(model.loading.cpu_pct)}%`
					: null,
			),
			fact(
				"RAM staging",
				model.loading.rss_mib != null
					? `${gib(model.loading.rss_mib)} GiB`
					: null,
			),
		);
	if (intel.moe)
		facts.push(
			fact(
				"MoE experts",
				`${intel.moe.experts} total / ${intel.moe.active ?? "—"} active`,
			),
		);
	if (intel.layers) facts.push(fact("Transformer layers", intel.layers));
	html(
		$("model-detail"),
		`${identityHeading(identity, "model-detail-title")}<p class="detail-subtitle">${esc([intel.family, intel.creator, intel.origin].filter(Boolean).join(" / ")) || "AUTOMATIC MODEL DISCOVERY"}</p>${live ? `<div class="detail-metrics">${detailMetric(number(model.output_tps, 1), "tok/s", "DECODE / OUTPUT")}${detailMetric(number(model.input_tps, 1), "tok/s", "PREFILL / INPUT")}${detailMetric(number(model.running), "active", "RUNNING REQUESTS")}</div>` : ""}<p class="detail-description">${esc(identity.summary)}</p><div class="detail-grid">${facts.join("")}</div><div class="detail-code">${esc(model.endpoint || model.path || intel.path || "No model path reported")}<br>GPUs: ${esc((model.gpu_indices || []).join(", ") || "not assigned")}<br>PIDs: ${esc((model.worker_pids || model.pids || []).join(", ") || "not reported")}</div>${model.error ? `<p class="detail-description">Endpoint response: ${esc(model.error)}</p>` : ""}<p class="detail-description">${identity.modelSource ? `<a class="brand-source-link" href="${identity.modelSource}" target="_blank" rel="noopener noreferrer">Official model-family source ${icon("arrow")}</a><br>` : ""}Publisher artwork identifies the model family, not an endorsement of a local fine-tune. Summary source: ${esc(identity.summarySource.toLowerCase())}. Latency values are the collector’s latest observed averages, not percentiles. Loading progress and ETA are estimates; disk read rate may include other readers of the same device.</p>`,
	);
}
function applyPalette(next) {
	const colors = { ember: "#ff9166", glacier: "#a1d6ed", phosphor: "#c2e889" };
	palette = Object.hasOwn(colors, next) ? next : "ember";
	color = colors[palette];
	document.documentElement.dataset.palette = palette;
	savePreference("palette", palette);
	document
		.querySelectorAll(".palette-options [data-palette]")
		.forEach((button) => {
			const active = button.dataset.palette === palette;
			button.classList.toggle("selected", active);
			button.setAttribute("aria-pressed", String(active));
		});
	sculpture.setPalette(color);
	if (snapshot) render(true);
}
function setMotion(enabled) {
	motion = enabled;
	savePreference("motion", String(enabled));
	sculpture.setMotion(enabled && !paused);
	$("motion-setting").checked = enabled;
	text("motion-toggle", enabled ? "Ⅱ" : "▷");
	const label = enabled
		? "Pause sculpture animation"
		: "Resume sculpture animation";
	$("motion-toggle").setAttribute("aria-label", label);
	$("motion-toggle").title = label;
}
function setFocus(enabled) {
	document.body.classList.toggle("focus-mode", enabled);
	$("focus-setting").checked = enabled;
	savePreference("focus", String(enabled));
}
$("appearance-open").addEventListener("click", () =>
	openDialog($("appearance-dialog")),
);
$("appearance-quick").addEventListener("click", () =>
	openDialog($("appearance-dialog")),
);
$("motion-toggle").addEventListener("click", () => setMotion(!motion));
$("motion-setting").addEventListener("change", (event) =>
	setMotion(event.target.checked),
);
$("focus-setting").addEventListener("change", (event) =>
	setFocus(event.target.checked),
);
document
	.querySelectorAll(".palette-options [data-palette]")
	.forEach((button) => {
		button.addEventListener("click", () =>
			applyPalette(button.dataset.palette),
		);
	});
reducedMotion.addEventListener("change", (event) => {
	if (event.matches) setMotion(false);
});
async function toggleFullscreen() {
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await document.documentElement.requestFullscreen();
	} catch {
		toast("Fullscreen is not available in this browser.");
	}
}
$("fullscreen").addEventListener("click", toggleFullscreen);
$("logout").addEventListener("click", () => location.assign("/api/logout"));
function exportSnapshot() {
	if (!snapshot) {
		toast("Wait for the first telemetry sample.");
		return;
	}
	const data = paused ? frozen : snapshot;
	const exportData = {
		exported_at: new Date().toISOString(),
		display: paused ? "paused" : streamState,
		telemetry: data,
		session: {
			energy_wh: paused ? frozenEnergy : history.energyWh,
			history: paused ? frozenPoints : history.points,
			events: paused ? frozenEvents : events.entries,
		},
	};
	const blob = new Blob([JSON.stringify(exportData, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob),
		link = document.createElement("a");
	link.href = url;
	link.download = `gpu-telemetry-${data.generated_at.replace(/[:.]/g, "-")}.json`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
	toast("Snapshot exported. Includes observed history and session events.");
}
$("export").addEventListener("click", exportSnapshot);

const commands = [
	{
		label: "Overview",
		icon: "grid",
		key: "1",
		run: () => navigate("overview"),
	},
	{
		label: "Accelerators & compute processes",
		icon: "chip",
		key: "2",
		run: () => navigate("accelerators"),
	},
	{
		label: "Inference & model intelligence",
		icon: "orbit",
		key: "3",
		run: () => navigate("inference"),
	},
	{
		label: "Activity & event timeline",
		icon: "pulse",
		key: "4",
		run: () => navigate("activity"),
	},
	{
		label: "Appearance & spectral palette",
		icon: "sliders",
		key: "A",
		run: () => openDialog($("appearance-dialog")),
	},
	{
		label: "Toggle focus mode",
		icon: "grid",
		key: "",
		run: () => setFocus(!document.body.classList.contains("focus-mode")),
	},
	{
		label: "Pause / resume live display",
		icon: "pulse",
		key: "Space",
		run: togglePause,
	},
	{
		label: "Export telemetry snapshot",
		icon: "download",
		key: "E",
		run: exportSnapshot,
	},
	{
		label: "Toggle fullscreen",
		icon: "expand",
		key: "F",
		run: toggleFullscreen,
	},
	{
		label: "Sign out of the observatory",
		icon: "out",
		key: "",
		run: () => location.assign("/api/logout"),
	},
];
let commandIndex = 0,
	filteredCommands = commands;
function renderCommands() {
	const query = $("command-search").value.trim().toLowerCase();
	filteredCommands = commands.filter((command) =>
		command.label.toLowerCase().includes(query),
	);
	commandIndex = Math.max(
		0,
		Math.min(commandIndex, filteredCommands.length - 1),
	);
	html(
		$("command-results"),
		filteredCommands
			.map(
				(command, index) =>
					`<button class="command-option ${index === commandIndex ? "selected" : ""}" data-command="${index}">${icon(command.icon)}<span>${esc(command.label)}</span>${command.key ? `<kbd>${command.key}</kbd>` : ""}</button>`,
			)
			.join("") || '<div class="empty-state">No matching commands.</div>',
	);
}
function openCommands() {
	$("command-search").value = "";
	commandIndex = 0;
	renderCommands();
	openDialog($("command-dialog"));
	$("command-search").focus();
}
function executeCommand(index) {
	const command = filteredCommands[index];
	if (command) {
		$("command-dialog").close();
		command.run();
	}
}
$("command-open").addEventListener("click", openCommands);
$("command-search").addEventListener("input", () => {
	commandIndex = 0;
	renderCommands();
});
$("command-results").addEventListener("click", (event) => {
	const button = event.target.closest("[data-command]");
	if (button) executeCommand(+button.dataset.command);
});
$("command-search").addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		commandIndex = Math.max(
			0,
			Math.min(
				filteredCommands.length - 1,
				commandIndex + (event.key === "ArrowDown" ? 1 : -1),
			),
		);
		renderCommands();
		$("command-results .selected")?.scrollIntoView({ block: "nearest" });
	} else if (event.key === "Enter") {
		event.preventDefault();
		executeCommand(commandIndex);
	}
});
document.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		if ($("command-dialog").open) $("command-dialog").close();
		else if (!document.querySelector("dialog[open]")) openCommands();
		return;
	}
	if (
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.repeat ||
		event.target.closest("input,textarea,select,[contenteditable],button,a") ||
		document.querySelector("dialog[open]")
	)
		return;
	const key = event.key.toLowerCase();
	if (["1", "2", "3", "4"].includes(key)) {
		event.preventDefault();
		navigate(["overview", "accelerators", "inference", "activity"][+key - 1]);
	} else if (key === " ") {
		event.preventDefault();
		togglePause();
	} else if (key === "f") toggleFullscreen();
	else if (key === "e") exportSnapshot();
	else if (key === "a") openDialog($("appearance-dialog"));
});
let resizeFrame = 0;
window.addEventListener("resize", () => {
	if (!resizeFrame)
		resizeFrame = requestAnimationFrame(() => {
			resizeFrame = 0;
			render(true);
		});
});
text(
	"today",
	new Date()
		.toLocaleDateString("en-GB", {
			day: "2-digit",
			month: "short",
			year: "numeric",
		})
		.toUpperCase(),
);
applyPalette(readPreference("palette", "ember"));
setMotion(motion);
setFocus(readPreference("focus", "false") === "true");
navigate(location.hash.slice(1) || "overview", false);
connect();
