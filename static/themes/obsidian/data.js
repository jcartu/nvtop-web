// The wire format is shared with nvtop: a full baseline followed by keyed deltas.
// Keep it independent of rendering so reconnection, history, and paused views agree.
export function mergeFrame(snapshot, frame) {
	if (frame.type !== "update") return frame.snapshot || frame;
	if (!snapshot) return null;
	for (const key of [
		"generated_at",
		"uptime_seconds",
		"host",
		"driver",
		"cuda",
		"poll_seconds",
		"llm_poll_seconds",
	]) {
		if (Object.hasOwn(frame, key)) snapshot[key] = frame[key];
	}
	const byIndex = new Map(snapshot.gpus.map((gpu) => [gpu.index, gpu]));
	for (const patch of frame.gpus || []) {
		const gpu = byIndex.get(patch.index);
		if (gpu) Object.assign(gpu, patch);
		else {
			const added = { history: {}, ...patch };
			snapshot.gpus.push(added);
			byIndex.set(added.index, added);
		}
	}
	if (frame.gpu_remove) {
		const removed = new Set(frame.gpu_remove);
		snapshot.gpus = snapshot.gpus.filter((gpu) => !removed.has(gpu.index));
	}
	if (frame.totals) Object.assign(snapshot.totals, frame.totals);
	for (const key of ["models", "sniffed"]) {
		if (Object.hasOwn(frame, key)) snapshot[key] = frame[key];
	}
	if (frame.history) {
		const max = frame.history.max_points || 180;
		const append = (target, values) => {
			target.history ||= {};
			for (const [key, value] of Object.entries(values)) {
				target.history[key] ||= [];
				const series = target.history[key];
				series.push(value);
				if (series.length > max) series.splice(0, series.length - max);
			}
		};
		for (const [index, values] of Object.entries(frame.history.gpus || {})) {
			if (byIndex.has(+index)) append(byIndex.get(+index), values);
		}
		append(snapshot.totals, frame.history.totals || {});
	}
	return snapshot;
}

export const clamp = (n, low = 0, high = 100) =>
	Math.max(low, Math.min(high, Number(n) || 0));
export const sum = (items, key) =>
	items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
export const number = (value, digits = 0) =>
	value == null || !Number.isFinite(Number(value))
		? "—"
		: Number(value).toLocaleString("en-US", {
				maximumFractionDigits: digits,
				minimumFractionDigits: digits,
			});
export const compact = (value) =>
	value == null
		? "—"
		: Intl.NumberFormat("en-US", {
				notation: "compact",
				maximumFractionDigits: 1,
			}).format(value);
export const gib = (mib) => (mib == null ? "—" : number(mib / 1024, 1));
export function duration(seconds) {
	if (seconds == null) return "—";
	const s = Math.max(0, Math.floor(seconds));
	if (s >= 86400)
		return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
	if (s >= 3600)
		return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
	if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
	return `${s}s`;
}
export const escapeHTML = (value) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
export const modelName = (model) =>
	model.model_names?.[0] ||
	model.intel?.display_name ||
	model.name ||
	model.label ||
	model.id;
export function modelEntries(snapshot) {
	// An endpoint still starting and its discovered loader are one model, not two.
	const sniffed = snapshot.sniffed || [];
	return [
		...(snapshot.models || []).filter(
			(model) =>
				model.healthy || !sniffed.some((s) => s.ports?.includes(model.port)),
		),
		...sniffed,
	];
}
export function processes(snapshot) {
	const map = new Map();
	for (const gpu of snapshot.gpus) {
		for (const process of gpu.processes || []) {
			let row = map.get(process.pid);
			if (!row) {
				row = { ...process, used_memory_mib: 0, gpus: [], model: "" };
				map.set(process.pid, row);
			}
			row.gpus.push(gpu.index);
			row.used_memory_mib += process.used_memory_mib || 0;
		}
	}
	for (const model of modelEntries(snapshot)) {
		for (const pid of model.worker_pids || model.pids || []) {
			if (map.has(pid)) map.get(pid).model = modelName(model);
		}
	}
	return [...map.values()].sort(
		(a, b) => b.used_memory_mib - a.used_memory_mib || a.pid - b.pid,
	);
}
export function linkDegraded(gpu) {
	return (
		(gpu.pcie_width > 0 && gpu.pcie_width < gpu.pcie_width_max) ||
		(gpu.pcie_gen >= 2 &&
			gpu.pcie_gen < gpu.pcie_gen_max &&
			gpu.utilization_gpu_pct > 15)
	);
}
export function diagnostics(snapshot) {
	const gpus = snapshot.gpus;
	const hottest = gpus.length
		? Math.max(...gpus.map((g) => g.temperature_c))
		: null;
	const degraded = gpus.filter(linkDegraded);
	const pressure = gpus.filter((g) => g.memory_pct >= 95);
	const offline = modelEntries(snapshot).filter(
		(m) => Object.hasOwn(m, "healthy") && !m.healthy,
	);
	const loading = (snapshot.sniffed || []).filter((m) => m.state === "loading");
	const online = (snapshot.models || []).filter((m) => m.healthy);
	const queued = sum(online, "waiting");
	return [
		{
			id: "thermal",
			level:
				hottest == null
					? "warn"
					: hottest >= 90
						? "bad"
						: hottest >= 85
							? "warn"
							: "good",
			title:
				hottest == null
					? "No GPU telemetry"
					: hottest >= 85
						? "Elevated GPU temperature"
						: "Thermals within range",
			detail: "Advisory threshold 85°C · critical 90°C",
			value: hottest == null ? "—" : `${hottest}°C peak`,
		},
		{
			id: "pcie",
			level: !gpus.length || degraded.length ? "warn" : "good",
			title: degraded.length
				? "PCIe link needs attention"
				: gpus.length
					? "PCIe links nominal"
					: "Waiting for PCIe telemetry",
			detail: degraded.length
				? `Check GPU ${degraded.map((g) => g.index).join(", ")}`
				: "Idle generation downshift is normal power saving",
			value: `${gpus.length - degraded.length}/${gpus.length} links`,
		},
		{
			id: "memory",
			level: pressure.length || !gpus.length ? "warn" : "good",
			title: pressure.length
				? "High memory pressure"
				: gpus.length
					? "Memory capacity available"
					: "Waiting for memory telemetry",
			detail: pressure.length
				? `GPU ${pressure.map((g) => g.index).join(", ")} at or above 95% allocated`
				: "Allocation includes weights, cache, and driver reservations",
			value: `${gib(sum(gpus, "memory_total_mib") - sum(gpus, "memory_used_mib"))} GiB free`,
		},
		{
			id: "inference",
			level: offline.length || queued > 0 ? "warn" : "good",
			title: offline.length
				? "Endpoint unavailable"
				: queued
					? "Requests waiting for capacity"
					: loading.length
						? "Model loading in progress"
						: online.length
							? "Inference endpoints responding"
							: "No model endpoints online",
			detail: offline.length
				? offline.map(modelName).join(", ")
				: loading.length
					? loading.map(modelName).join(", ")
					: `${online.length} online · ${queued} queued · read-only discovery`,
			value: offline.length
				? `${offline.length} offline`
				: loading.length
					? "Loading"
					: `${online.length} online`,
		},
	];
}

export class SessionHistory {
	points = [];
	energyWh = 0;
	previousEnergy = null;
	add(snapshot) {
		const ts = Date.parse(snapshot.generated_at);
		if (!Number.isFinite(ts)) return;
		const power = Number(snapshot.totals.power_draw_w) || 0;
		// Do not invent energy across an offline interval or a suspended tab.
		if (this.previousEnergy) {
			const dt = (ts - this.previousEnergy.ts) / 1000;
			if (dt > 0 && dt < 3)
				this.energyWh +=
					(((power + this.previousEnergy.power) / 2) * dt) / 3600;
		}
		this.previousEnergy = { ts, power };
		if (!this.points.length) this.seed(snapshot, ts);
		const last = this.points.at(-1);
		if (last && ts - last.ts < 900) return;
		const total = snapshot.totals;
		this.points.push({
			ts,
			util: total.gpu_util_avg,
			tps: total.total_tps,
			power,
			temp: snapshot.gpus.length
				? Math.max(...snapshot.gpus.map((g) => g.temperature_c))
				: null,
			mem: total.memory_pct_avg,
		});
		while (this.points.length && this.points[0].ts < ts - 1800000)
			this.points.shift();
	}
	seed(snapshot, ts) {
		const h = snapshot.totals.history || {};
		const util = h.gpu_util_avg || [];
		for (let i = 0; i < util.length; i++) {
			const temps = snapshot.gpus
				.map((g) => g.history?.temp?.[i])
				.filter(Number.isFinite);
			this.points.push({
				ts: ts - (util.length - 1 - i) * 1000,
				util: util[i],
				tps: h.total_tps?.[i] ?? null,
				power: h.power_total?.[i] ?? null,
				mem: h.mem_pct_avg?.[i] ?? null,
				temp: temps.length ? Math.max(...temps) : null,
			});
		}
	}
	window(seconds, end = this.points.at(-1)?.ts || Date.now()) {
		return this.points.filter(
			(point) => point.ts >= end - seconds * 1000 && point.ts <= end,
		);
	}
}

export class EventLog {
	entries = [];
	previous = null;
	thermal = new Map();
	memory = new Map();
	push(level, title, detail = "", ts = Date.now()) {
		this.entries.unshift({ level, title, detail, ts });
		if (this.entries.length > 200) this.entries.length = 200;
	}
	observe(snapshot) {
		const ts = Date.parse(snapshot.generated_at);
		const current = {
			models: new Map(
				modelEntries(snapshot).map((m) => [
					m.id,
					{
						name: modelName(m),
						status: m.state || (m.healthy ? "online" : "offline"),
					},
				]),
			),
			gpus: new Map(
				snapshot.gpus.map((g) => [
					g.index,
					{
						aer:
							(g.pcie_aer?.total_fatal || 0) +
							(g.pcie_aer?.total_nonfatal || 0),
						corrected: g.pcie_aer?.total_correctable || 0,
						degraded: linkDegraded(g),
					},
				]),
			),
			processes: new Map(processes(snapshot).map((p) => [p.pid, p])),
		};
		if (!this.previous) {
			this.push(
				"success",
				"Telemetry link established",
				`${snapshot.host} · ${snapshot.gpus.length} accelerators · ${number(1 / snapshot.poll_seconds)} Hz GPU stream`,
				ts,
			);
			for (const item of diagnostics(snapshot).filter(
				(item) => item.level !== "good",
			))
				this.push("warning", item.title, item.detail, ts);
		} else {
			for (const [id, model] of current.models) {
				const before = this.previous.models.get(id);
				if (!before || before.status !== model.status)
					this.push(
						model.status === "offline" ? "warning" : "success",
						`${model.name} · ${model.status}`,
						before
							? `Previously ${before.status}`
							: "Discovered by the local collector",
						ts,
					);
			}
			for (const [id, model] of this.previous.models) {
				if (!current.models.has(id))
					this.push(
						"info",
						`${model.name} released`,
						"No longer reported by model discovery",
						ts,
					);
			}
			for (const [index, gpu] of current.gpus) {
				const before = this.previous.gpus.get(index);
				if (!before)
					this.push(
						"success",
						`GPU ${index} detected`,
						"Accelerator joined telemetry",
						ts,
					);
				else {
					if (gpu.aer > before.aer)
						this.push(
							"critical",
							`GPU ${index} PCIe error`,
							`+${gpu.aer - before.aer} fatal/nonfatal AER errors`,
							ts,
						);
					if (gpu.corrected > before.corrected)
						this.push(
							"warning",
							`GPU ${index} corrected PCIe errors`,
							`+${gpu.corrected - before.corrected} correctable AER errors`,
							ts,
						);
					if (gpu.degraded !== before.degraded)
						this.push(
							gpu.degraded ? "warning" : "success",
							`GPU ${index} link ${gpu.degraded ? "degraded" : "recovered"}`,
							"PCIe lane width or active link generation changed",
							ts,
						);
				}
			}
			for (const index of this.previous.gpus.keys())
				if (!current.gpus.has(index))
					this.push(
						"warning",
						`GPU ${index} disconnected`,
						"No longer reported by the collector",
						ts,
					);
			for (const [pid, p] of current.processes)
				if (!this.previous.processes.has(pid))
					this.push(
						"info",
						`${p.process_name} started`,
						`PID ${pid} · GPU ${p.gpus.join(", ")}`,
						ts,
					);
			for (const [pid, p] of this.previous.processes)
				if (!current.processes.has(pid))
					this.push(
						"info",
						`${p.process_name} exited`,
						`PID ${pid} · memory released`,
						ts,
					);
		}
		for (const gpu of snapshot.gpus) {
			const hot = this.thermal.get(gpu.index) || false;
			if (!hot && gpu.temperature_c >= 85) {
				if (this.previous)
					this.push(
						"warning",
						`GPU ${gpu.index} running hot`,
						`${gpu.temperature_c}°C · threshold 85°C`,
						ts,
					);
				this.thermal.set(gpu.index, true);
			} else if (hot && gpu.temperature_c < 80) {
				this.push(
					"success",
					`GPU ${gpu.index} cooled down`,
					`${gpu.temperature_c}°C · below recovery threshold`,
					ts,
				);
				this.thermal.set(gpu.index, false);
			}
			const full = this.memory.get(gpu.index) || false;
			if (!full && gpu.memory_pct >= 95) {
				if (this.previous)
					this.push(
						"warning",
						`GPU ${gpu.index} memory pressure`,
						`${number(gpu.memory_pct, 1)}% allocated`,
						ts,
					);
				this.memory.set(gpu.index, true);
			} else if (full && gpu.memory_pct < 90) this.memory.set(gpu.index, false);
		}
		this.previous = current;
	}
}
