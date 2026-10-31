import { modelName } from "./data.js?v=20260905h";

// These are publisher-owned marks, not generated approximations. The local
// asset manifest records their original URLs and content hashes.
const publishers = {
	zai: ["Z.ai", "zai-org", "zai-org"],
	alibaba: ["Alibaba Cloud", "alibaba-cloud", "Qwen"],
	deepseek: ["DeepSeek", "deepseek-ai", "deepseek-ai"],
	moonshot: ["Moonshot AI", "moonshotai", "moonshotai"],
	meta: ["Meta", "meta-llama", "meta-llama"],
	mistral: ["Mistral AI", "mistralai", "mistralai"],
	google: ["Google", "google", "google"],
	microsoft: ["Microsoft", "microsoft", "microsoft"],
	openai: ["OpenAI", "openai", "openai"],
	nvidia: ["NVIDIA", "nvidia", "nvidia"],
	ibm: ["IBM", "ibm", "ibm-granite"],
	cohere: ["Cohere", "coherelabs", "CohereLabs"],
	minimax: ["MiniMax", "minimaxai", "MiniMaxAI"],
	tencent: ["Tencent", "tencent", "tencent"],
	baidu: ["Baidu", "baidu", "baidu"],
	internlm: ["InternLM team", "internlm", "internlm"],
	opengvlab: ["OpenGVLab", "opengvlab", "OpenGVLab"],
	tii: ["Technology Innovation Institute", "tiiuae", "tiiuae"],
	lg: ["LG AI Research", "lgai-exaone", "LGAI-EXAONE"],
	allen: ["Allen Institute for AI", "allenai", "allenai"],
	nous: ["Nous Research", "nousresearch", "NousResearch"],
	hf: ["Hugging Face", "huggingface", "HuggingFaceTB"],
	bigcode: ["BigCode", "bigcode", "bigcode"],
};
// Specific derivatives precede base families. A family mark identifies lineage,
// not an endorsement or a claim that the publisher made a custom fine-tune.
const families = [
	[/\b(?:hermes|nous)(?=[-_. /\d]|$)/i, "Hermes", "nous"],
	[/\b(?:smollm|smolvlm)(?=[-_. /\d]|$)/i, "Smol", "hf", "huggingfacetb.webp"],
	[/\b(?:starcoder|starencoder)(?=[-_. /\d]|$)/i, "StarCoder", "bigcode"],
	[/\b(?:chatglm|glm)(?=[-_. /\d]|$)/i, "GLM", "zai", "glm.svg"],
	[/\b(?:qwen|qwq|qvq)(?=[-_. /\d]|$)/i, "Qwen", "alibaba", "qwen.webp"],
	[/\bdeepseek(?=[-_. /\d]|$)/i, "DeepSeek", "deepseek"],
	[/\bkimi(?=[-_. /\d]|$)/i, "Kimi", "moonshot", "kimi.webp"],
	[/\bnemotron(?=[-_. /\d]|$)/i, "Nemotron", "nvidia"],
	[/\b(?:llama|codellama)(?=[-_. /\d]|$)/i, "Llama", "meta"],
	[
		/\b(?:mistral|mixtral|ministral|magistral|codestral|devstral|pixtral|voxtral)(?=[-_. /\d]|$)/i,
		"Mistral",
		"mistral",
	],
	[/\b(?:gemma|paligemma)(?=[-_. /\d]|$)/i, "Gemma", "google"],
	[/\bphi(?=[-_. /\d]|$)/i, "Phi", "microsoft"],
	[/\bgpt[-_]oss(?=[-_. /\d]|$)/i, "GPT-OSS", "openai"],
	[/\bgranite(?=[-_. /\d]|$)/i, "Granite", "ibm", "ibm-granite.webp"],
	[/\b(?:command[-_ ]?[ar]|aya)(?=[-_. /\d]|$)/i, "Command / Aya", "cohere"],
	[/\bminimax(?=[-_. /\d]|$)/i, "MiniMax", "minimax"],
	[/\bhunyuan(?=[-_. /\d]|$)/i, "Hunyuan", "tencent"],
	[/\bernie(?=[-_. /\d]|$)/i, "ERNIE", "baidu"],
	[/\binternlm(?=[-_. /\d]|$)/i, "InternLM", "internlm"],
	[/\binternvl(?=[-_. /\d]|$)/i, "InternVL", "opengvlab"],
	[/\bfalcon(?=[-_. /\d]|$)/i, "Falcon", "tii"],
	[/\bexaone(?=[-_. /\d]|$)/i, "EXAONE", "lg"],
	[/\b(?:olmo|molmo)(?=[-_. /\d]|$)/i, "OLMo / Molmo", "allen"],
];
const leaf = (value) =>
	String(value || "")
		.replace(/\/+$/, "")
		.split("/")
		.at(-1);

export function modelIdentity(model) {
	const intel = model.intel || {};
	const name = String(modelName(model) || "Unnamed model");
	const candidates = [
		...(model.model_names || []).map(leaf),
		leaf(intel.display_name),
		leaf(model.name),
		leaf(model.path),
		leaf(intel.path),
		...[].concat(intel.base_model || []).map(leaf),
		intel.family,
	].filter(Boolean);
	let family;
	for (const candidate of candidates) {
		family = families.find(([pattern]) => pattern.test(candidate));
		if (family) break;
	}
	const publisher = family ? publishers[family[2]] : null;
	const engineName =
		model.engine || model.app || intel.engine || "Engine unreported";
	const engine = /\bvllm\b/i.test(engineName)
		? "vLLM"
		: /\bsglang\b/i.test(engineName)
			? "SGLang"
			: engineName;
	return {
		name,
		title: leaf(name),
		family: family?.[1] || intel.family || "Unidentified family",
		company: publisher?.[0] || intel.creator || "Publisher not identified",
		companyLogo: publisher ? `${publisher[1]}.webp` : null,
		modelLogo: family ? family[3] || `${publisher[1]}.webp` : null,
		companySource: publisher
			? family[2] === "alibaba"
				? "https://www.alibabacloud.com/en"
				: `https://huggingface.co/${publisher[2]}`
			: null,
		modelSource: family
			? family[1] === "GLM"
				? "https://github.com/zai-org/GLM-5"
				: family[1] === "Kimi"
					? "https://www.kimi.com/"
					: `https://huggingface.co/${publisher[2]}`
			: null,
		engine,
		engineVersion: model.engine_version || intel.engine_version || "",
		summary:
			intel.summary ||
			intel.blurb ||
			"No model-card summary was found. Available specifications are discovered from the serving engine and local weight files.",
		summarySource: intel.summary
			? "LOCAL MODEL CARD"
			: intel.blurb
				? "MODEL FAMILY NOTES"
				: "DISCOVERED CONFIGURATION",
	};
}

export function residentModels(models) {
	return models.filter(
		(model) =>
			model.healthy || model.state === "loading" || model.state === "memory",
	);
}

export function chooseResident(models, previous) {
	if (previous) {
		const retained =
			models.find((model) => model.id === previous.id) ||
			models.find((model) => modelName(model) === modelName(previous));
		if (retained) return retained;
	}
	return (
		models.find((model) => model.healthy) ||
		models.find((model) => model.state === "loading") ||
		models[0] ||
		null
	);
}
