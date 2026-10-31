import { number, compact } from "./data.js?v=20260905h";

function surface(canvas) {
	const rect = canvas.getBoundingClientRect();
	if (!rect.width || !rect.height) return null;
	const ratio = Math.min(devicePixelRatio || 1, 2);
	const width = Math.round(rect.width * ratio),
		height = Math.round(rect.height * ratio);
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext("2d");
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, rect.width, rect.height);
	return { context, width: rect.width, height: rect.height };
}

export function sparkline(canvas, values, color, fixedMax) {
	const drawing = surface(canvas);
	if (!drawing || values.length < 2) return;
	const { context: ctx, width, height } = drawing;
	const max = fixedMax || Math.max(1, ...values.filter(Number.isFinite));
	ctx.beginPath();
	let started = false;
	values.forEach((value, index) => {
		if (!Number.isFinite(value)) {
			started = false;
			return;
		}
		const x = (index / (values.length - 1)) * width;
		const y = height - 2 - Math.min(value / max, 1) * (height - 4);
		if (started) ctx.lineTo(x, y);
		else ctx.moveTo(x, y);
		started = true;
	});
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.25;
	ctx.stroke();
}

export const chartMetrics = {
	util: {
		label: "Utilization",
		unit: "%",
		caption: "% cluster average",
		legend: "Cluster average",
		max: 100,
		digits: 0,
	},
	tps: {
		label: "Throughput",
		unit: "tok/s",
		caption: "tok/s · prefill + decode",
		legend: "Endpoint throughput",
		digits: 1,
	},
	power: {
		label: "Power",
		unit: "W",
		caption: "W · GPU board power",
		legend: "All accelerators",
		digits: 0,
	},
	temp: {
		label: "Thermals",
		unit: "°C",
		caption: "°C · hottest accelerator",
		legend: "Peak GPU temperature",
		max: 100,
		digits: 0,
	},
};

export class HistoryChart {
	constructor(canvas, tooltip) {
		this.canvas = canvas;
		this.tooltip = tooltip;
		this.points = [];
		this.metric = "util";
		this.seconds = 300;
		this.color = "#ff9166";
		this.hover = null;
		this.keyboardIndex = null;
		this.observer = new ResizeObserver(() => this.draw());
		this.observer.observe(canvas);
		canvas.addEventListener("pointermove", (event) => {
			const rect = canvas.getBoundingClientRect();
			this.hover = event.clientX - rect.left;
			this.keyboardIndex = null;
			this.draw();
		});
		canvas.addEventListener("pointerleave", () => {
			this.hover = null;
			this.draw();
		});
		canvas.addEventListener("blur", () => {
			this.keyboardIndex = null;
			this.hover = null;
			this.draw();
		});
		canvas.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return;
			event.preventDefault();
			if (event.key === "Escape") this.keyboardIndex = null;
			else
				this.keyboardIndex = Math.max(
					0,
					Math.min(
						this.points.length - 1,
						(this.keyboardIndex ?? this.points.length - 1) +
							(event.key === "ArrowLeft" ? -1 : 1),
					),
				);
			this.hover = null;
			this.draw();
		});
	}
	update(points, metric, seconds, end, color) {
		this.points = points;
		this.metric = metric;
		this.seconds = seconds;
		this.end = end;
		this.color = color;
		this.draw();
	}
	draw() {
		const drawing = surface(this.canvas);
		if (!drawing) return;
		const { context: ctx, width, height } = drawing;
		const config = chartMetrics[this.metric];
		const left = 4,
			right = 35,
			top = 14,
			bottom = 24;
		const w = width - left - right,
			h = height - top - bottom;
		const end = this.end || Date.now(),
			start = end - this.seconds * 1000;
		const values = this.points
			.map((point) => point[this.metric])
			.filter(Number.isFinite);
		const rawMax = Math.max(1, ...values);
		const max =
			config.max ||
			Math.ceil((rawMax * 1.15) / 10 ** Math.floor(Math.log10(rawMax))) *
				10 ** Math.floor(Math.log10(rawMax));
		const x = (ts) => left + ((ts - start) / (end - start)) * w;
		const y = (value) => top + h - Math.min(1, Math.max(0, value / max)) * h;
		ctx.font = "9px Plex, monospace";
		ctx.textBaseline = "middle";
		for (let i = 0; i <= 4; i++) {
			const yy = top + (h * i) / 4;
			ctx.strokeStyle = "#27282b";
			ctx.lineWidth = 0.65;
			ctx.setLineDash([2, 4]);
			ctx.beginPath();
			ctx.moveTo(left, yy);
			ctx.lineTo(width - right + 3, yy);
			ctx.stroke();
			ctx.fillStyle = "#666970";
			ctx.fillText(compact(max * (1 - i / 4)), width - right + 9, yy);
		}
		ctx.setLineDash([]);
		for (let i = 0; i <= 4; i++) {
			ctx.fillStyle = "#666970";
			ctx.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
			const date = new Date(start + ((end - start) * i) / 4);
			ctx.fillText(
				date.toLocaleTimeString("en-GB", {
					hour: "2-digit",
					minute: "2-digit",
					second: this.seconds <= 60 ? "2-digit" : undefined,
				}),
				left + (w * i) / 4,
				height - 7,
			);
		}
		ctx.textAlign = "left";
		const segments = [];
		let segment = [];
		for (const point of this.points) {
			if (!Number.isFinite(point[this.metric])) {
				if (segment.length) segments.push(segment);
				segment = [];
				continue;
			}
			if (segment.length && point.ts - segment.at(-1).ts > 3500) {
				segments.push(segment);
				segment = [];
			}
			segment.push(point);
		}
		if (segment.length) segments.push(segment);
		const gradient = ctx.createLinearGradient(0, top, 0, height - bottom);
		gradient.addColorStop(0, `${this.color}28`);
		gradient.addColorStop(1, `${this.color}00`);
		for (const points of segments) {
			ctx.beginPath();
			points.forEach((point, index) => {
				if (index) ctx.lineTo(x(point.ts), y(point[this.metric]));
				else ctx.moveTo(x(point.ts), y(point[this.metric]));
			});
			ctx.lineTo(x(points.at(-1).ts), top + h);
			ctx.lineTo(x(points[0].ts), top + h);
			ctx.closePath();
			ctx.fillStyle = gradient;
			ctx.fill();
			ctx.beginPath();
			points.forEach((point, index) => {
				if (index) ctx.lineTo(x(point.ts), y(point[this.metric]));
				else ctx.moveTo(x(point.ts), y(point[this.metric]));
			});
			ctx.lineWidth = 1.5;
			ctx.lineJoin = "round";
			ctx.strokeStyle = this.color;
			ctx.stroke();
		}
		const last = this.points.at(-1);
		if (last && Number.isFinite(last[this.metric])) {
			ctx.beginPath();
			ctx.arc(x(last.ts), y(last[this.metric]), 2.5, 0, Math.PI * 2);
			ctx.fillStyle = this.color;
			ctx.fill();
		}
		let chosen = null;
		if (this.keyboardIndex != null)
			chosen =
				this.points[Math.min(this.keyboardIndex, this.points.length - 1)];
		else if (this.hover != null && this.points.length) {
			const targetTs = start + ((this.hover - left) / w) * (end - start);
			chosen = this.points.reduce((best, point) =>
				Math.abs(point.ts - targetTs) < Math.abs(best.ts - targetTs)
					? point
					: best,
			);
			// Leave gaps empty instead of presenting a distant sample as a current one.
			if (Math.abs(x(chosen.ts) - this.hover) > 14) chosen = null;
		}
		this.tooltip.hidden = !chosen;
		if (chosen) {
			const xx = x(chosen.ts);
			ctx.setLineDash([3, 4]);
			ctx.strokeStyle = "#aaa29a";
			ctx.lineWidth = 0.7;
			ctx.beginPath();
			ctx.moveTo(xx, top);
			ctx.lineTo(xx, top + h);
			ctx.stroke();
			ctx.setLineDash([]);
			this.tooltip.replaceChildren(
				document.createTextNode(
					`${number(chosen[this.metric], config.digits)} ${config.unit}`,
				),
			);
			const time = document.createElement("span");
			time.textContent = new Date(chosen.ts).toLocaleTimeString("en-GB");
			this.tooltip.append(time);
			this.tooltip.style.left = `${Math.max(0, Math.min(width - 130, xx - 55))}px`;
		}
		this.canvas.setAttribute(
			"aria-label",
			`${config.label} over the last ${this.seconds / 60} minutes. Latest ${number(last?.[this.metric], config.digits)} ${config.unit}. Use left and right arrows to inspect samples.`,
		);
	}
}
