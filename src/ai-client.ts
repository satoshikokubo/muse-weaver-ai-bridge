import { type AiSettings, PROVIDERS, getApiKey, getModel } from "./types";

interface AiRequest {
	system: string;
	message: string;
	maxTokens: number;
}

interface AiResponse {
	ok: boolean;
	text?: string;
	error?: string;
}

/** Timeout for AI API calls (ms) */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Redact sensitive information from error messages.
 * Removes API keys, authorization headers, and URL query parameters.
 */
function redactError(error: string, apiKey?: string): string {
	let safe = error;

	// Remove specific API key value if known
	if (apiKey && apiKey.length > 4) {
		safe = safe.replaceAll(apiKey, "[REDACTED]");
	}

	// Remove common query parameters that may contain keys
	safe = safe.replace(/[?&](key|api_key|apikey|token|access_token)=[^&\s]*/gi, "?$1=[REDACTED]");

	// Remove Authorization header values
	safe = safe.replace(/Authorization:\s*(Bearer\s+)?\S+/gi, "Authorization: [REDACTED]");

	// Remove x-goog-api-key header values
	safe = safe.replace(/x-goog-api-key:\s*\S+/gi, "x-goog-api-key: [REDACTED]");

	// Remove x-api-key header values
	safe = safe.replace(/x-api-key:\s*\S+/gi, "x-api-key: [REDACTED]");

	// Remove full URLs with query strings (fallback)
	safe = safe.replace(/https?:\/\/[^\s]*\?[^\s]*/g, (url) => {
		try {
			const u = new URL(url);
			return `${u.origin}${u.pathname}?[QUERY_REDACTED]`;
		} catch {
			return url.replace(/\?.*/, "?[QUERY_REDACTED]");
		}
	});

	return safe;
}

/**
 * Fetch with timeout using AbortController.
 */
async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		return response;
	} catch (e: unknown) {
		if (e instanceof DOMException && e.name === "AbortError") {
			throw new Error("Request timed out");
		}
		throw e;
	} finally {
		clearTimeout(timeoutId);
	}
}

export async function callAi(settings: AiSettings, req: AiRequest): Promise<AiResponse> {
	const provider = settings.provider;
	const apiKey = getApiKey(settings);
	const model = getModel(settings);

	try {
		switch (provider) {
			case "gemini":
				return await callGemini(apiKey, model, req);
			case "openai":
				return await callOpenAi(apiKey, model, req);
			case "anthropic":
				return await callAnthropic(apiKey, model, req);
			case "ollama":
				return await callOllama(settings.ollamaUrl, model, req);
			default:
				return { ok: false, error: `Unknown provider: ${provider}` };
		}
	} catch (e: unknown) {
		const rawMsg = e instanceof Error ? e.message : String(e);
		return { ok: false, error: redactError(rawMsg, apiKey) };
	}
}

// ── Gemini ──

async function callGemini(apiKey: string, model: string, req: AiRequest): Promise<AiResponse> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
	const res = await fetchWithTimeout(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: req.system }] },
			contents: [{ parts: [{ text: req.message }] }],
			generationConfig: {
				maxOutputTokens: req.maxTokens,
				thinkingConfig: { thinkingBudget: 0 },
			},
		}),
	});

	if (!res.ok) {
		return { ok: false, error: `Request failed, status ${res.status}` };
	}

	const data = await res.json();

	// Debug: log Gemini response metadata for troubleshooting
	const candidate = data?.candidates?.[0];
	const finishReason = candidate?.finishReason;
	const blockReason = data?.promptFeedback?.blockReason;
	const safetyRatings = candidate?.safetyRatings || data?.promptFeedback?.safetyRatings;

	if (finishReason && finishReason !== "STOP") {
		console.warn("[MWAB Gemini] finishReason:", finishReason);
	}
	if (blockReason) {
		console.warn("[MWAB Gemini] blockReason:", blockReason);
	}
	if (safetyRatings) {
		const flagged = safetyRatings.filter(
			(r: { probability: string }) => r.probability !== "NEGLIGIBLE" && r.probability !== "LOW",
		);
		if (flagged.length > 0) {
			console.warn("[MWAB Gemini] safety flags:", JSON.stringify(flagged));
		}
	}

	const text = candidate?.content?.parts?.[0]?.text;

	if (!text) {
		// Build a diagnostic error message
		let detail = "Empty response from Gemini";
		if (blockReason) detail += ` (blocked: ${blockReason})`;
		else if (finishReason === "SAFETY") detail += " (safety filter triggered)";
		else if (finishReason === "MAX_TOKENS") detail += " (output truncated: max tokens reached)";
		else if (finishReason === "RECITATION") detail += " (blocked: recitation)";
		else if (finishReason) detail += ` (finishReason: ${finishReason})`;
		return { ok: false, error: detail };
	}

	// Warn if response was truncated
	if (finishReason === "MAX_TOKENS") {
		console.warn("[MWAB Gemini] Response may be truncated (MAX_TOKENS)");
	}

	return { ok: true, text };
}

// ── OpenAI ──

async function callOpenAi(apiKey: string, model: string, req: AiRequest): Promise<AiResponse> {
	const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: req.system },
				{ role: "user", content: req.message },
			],
			max_tokens: req.maxTokens,
		}),
	});

	if (!res.ok) {
		return { ok: false, error: `Request failed, status ${res.status}` };
	}

	const data = await res.json();
	const text = data?.choices?.[0]?.message?.content;
	return text ? { ok: true, text } : { ok: false, error: "Empty response from OpenAI" };
}

// ── Anthropic ──

async function callAnthropic(apiKey: string, model: string, req: AiRequest): Promise<AiResponse> {
	const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"anthropic-dangerous-direct-browser-access": "true",
		},
		body: JSON.stringify({
			model,
			max_tokens: req.maxTokens,
			system: req.system,
			messages: [{ role: "user", content: req.message }],
		}),
	});

	if (!res.ok) {
		return { ok: false, error: `Request failed, status ${res.status}` };
	}

	const data = await res.json();
	const text = data?.content?.[0]?.text;
	return text ? { ok: true, text } : { ok: false, error: "Empty response from Anthropic" };
}

// ── Ollama ──

/** Model info returned by Ollama /api/tags */
export interface OllamaModelEntry {
	name: string;
	size: number;
	details?: {
		parameter_size?: string;
		quantization_level?: string;
		family?: string;
		families?: string[];
	};
}

/**
 * List locally installed Ollama models.
 * Returns empty array on any error (Ollama not running, etc).
 */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModelEntry[]> {
	try {
		const res = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, 5000);
		if (!res.ok) return [];
		const data = await res.json();
		return Array.isArray(data?.models) ? data.models : [];
	} catch {
		return [];
	}
}

/**
 * Get detailed info for a specific Ollama model.
 * Returns null on any error.
 */
export async function showOllamaModel(
	baseUrl: string,
	modelName: string,
): Promise<{ parameter_size?: string; quantization_level?: string; family?: string } | null> {
	try {
		const res = await fetchWithTimeout(
			`${baseUrl}/api/show`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: modelName }),
			},
			5000,
		);
		if (!res.ok) return null;
		const data = await res.json();
		return data?.details ?? null;
	} catch {
		return null;
	}
}

async function callOllama(baseUrl: string, model: string, req: AiRequest): Promise<AiResponse> {
	const url = `${baseUrl}/api/chat`;
	const res = await fetchWithTimeout(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: req.system },
				{ role: "user", content: req.message },
			],
			stream: false,
			options: { num_predict: req.maxTokens },
		}),
	});

	if (!res.ok) {
		return { ok: false, error: `Request failed, status ${res.status}` };
	}

	const data = await res.json();
	const text = data?.message?.content;
	return text ? { ok: true, text } : { ok: false, error: "Empty response from Ollama" };
}
