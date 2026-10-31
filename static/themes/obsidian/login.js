import { ComputeSculpture } from "./core.js?v=20260905h";
const sculpture = new ComputeSculpture(document.getElementById("core-canvas"));
try {
	const palette = localStorage.getItem("obsidian-palette");
	const colors = { ember: "#ff9166", glacier: "#a1d6ed", phosphor: "#c2e889" };
	if (Object.hasOwn(colors, palette)) {
		document.documentElement.dataset.palette = palette;
		sculpture.setPalette(colors[palette]);
	}
	if (localStorage.getItem("obsidian-motion") === "false")
		sculpture.setMotion(false);
} catch {
	/* Storage is optional. */
}
const form = document.getElementById("login-form");
const submit = document.getElementById("login-submit");
const error = document.getElementById("login-error");
form.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (submit.disabled) return;
	submit.disabled = true;
	error.hidden = true;
	submit.querySelector("span").textContent = "Establishing secure link…";
	try {
		const response = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				login: document.getElementById("username").value.trim(),
				password: document.getElementById("password").value,
			}),
			signal: AbortSignal.timeout(12000),
		});
		if (!response.ok)
			throw new Error(
				response.status === 401
					? "Access denied. Check your operator ID and access key."
					: "Authentication service unavailable. Please try again.",
			);
		const result = await response.json();
		if (!result.ok)
			throw new Error("Unable to establish a session. Please try again.");
		submit.querySelector("span").textContent = "Access granted. Welcome back.";
		// Always return to this application's root; never follow an untrusted redirect.
		location.assign("/");
	} catch (failure) {
		error.textContent =
			failure.name === "TimeoutError" || failure instanceof TypeError
				? "The connection could not be completed. Please try again."
				: failure.message;
		error.hidden = false;
		submit.disabled = false;
		submit.querySelector("span").textContent = "Connect to the machine";
	}
});
