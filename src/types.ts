import { t } from "./i18n";

export type AiProvider = "openai" | "anthropic" | "gemini" | "ollama";

/** Per-provider credentials */
export interface ProviderConfig {
	apiKey: string;
	model: string;
}

export interface AiSettings {
	enabled: boolean;
	provider: AiProvider;
	/** @deprecated kept for migration from v0.1.0 */
	apiKey?: string;
	/** @deprecated kept for migration from v0.1.0 */
	model?: string;
	/** Per-provider settings */
	providers: Record<string, ProviderConfig>;
	ollamaUrl: string;
	/** Muse persona settings */
	persona: MusePersonaSettings;
}

// ============================================================
// Muse Persona
// ============================================================

export interface MusePersona {
	id: string;
	name: string;
	icon: string;
	tone: string;
	firstPerson: string;
	speechStyle: string;
}

export interface MusePersonaSettings {
	selected: string;       // preset ID or "custom"
	custom: MusePersona;    // user-customized persona
}

export const DEFAULT_PERSONA_SETTINGS: MusePersonaSettings = {
	selected: "default",
	custom: {
		id: "custom",
		name: "Muse",
		icon: "moon",
		tone: "",
		firstPerson: "",
		speechStyle: "",
	},
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
	enabled: false,
	provider: "gemini",
	providers: {},
	ollamaUrl: "http://localhost:11434",
	persona: DEFAULT_PERSONA_SETTINGS,
};

/**
 * Get the effective API key for the current provider.
 */
export function getApiKey(s: AiSettings): string {
	return s.providers[s.provider]?.apiKey || "";
}

/**
 * Get the effective model for the current provider.
 */
export function getModel(s: AiSettings): string {
	const provider = PROVIDERS.find((p) => p.id === s.provider);
	return s.providers[s.provider]?.model || provider?.defaultModel || "";
}

/**
 * Migrate old flat settings to per-provider format.
 * Called once on load; harmless if already migrated.
 */
export function migrateSettings(s: AiSettings): AiSettings {
	if (!s.providers) s.providers = {};
	// Migrate old flat apiKey/model to the provider that was active
	if (s.apiKey && !s.providers[s.provider]?.apiKey) {
		if (!s.providers[s.provider]) s.providers[s.provider] = { apiKey: "", model: "" };
		s.providers[s.provider].apiKey = s.apiKey;
	}
	if (s.model && !s.providers[s.provider]?.model) {
		if (!s.providers[s.provider]) s.providers[s.provider] = { apiKey: "", model: "" };
		s.providers[s.provider].model = s.model;
	}
	// Also migrate ollamaModel if it exists
	const old = s as Record<string, unknown>;
	if (old.ollamaModel && typeof old.ollamaModel === "string") {
		if (!s.providers["ollama"]) s.providers["ollama"] = { apiKey: "", model: "" };
		if (!s.providers["ollama"].model) s.providers["ollama"].model = old.ollamaModel as string;
		delete old.ollamaModel;
	}
	// Ensure persona settings exist (migration from pre-persona versions)
	if (!s.persona) {
		s.persona = JSON.parse(JSON.stringify(DEFAULT_PERSONA_SETTINGS));
	}
	if (!s.persona.custom) {
		s.persona.custom = JSON.parse(JSON.stringify(DEFAULT_PERSONA_SETTINGS.custom));
	}
	// Clean up deprecated fields
	delete s.apiKey;
	delete s.model;
	return s;
}

/** Request from consumer plugins */
export interface AiRequest {
	system: string;
	message: string;
	maxTokens?: number;
}

/** Response returned to consumer plugins */
export interface AiResult {
	text: string;
	ok: boolean;
	error?: string;
}

/** Provider display info */
export interface ProviderInfo {
	id: AiProvider;
	name: string;
	defaultModel: string;
	needsApiKey: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
	{
		id: "gemini",
		name: "Google Gemini",
		defaultModel: "gemini-2.5-flash",
		needsApiKey: true,
	},
	{
		id: "openai",
		name: "OpenAI",
		defaultModel: "gpt-4o-mini",
		needsApiKey: true,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		defaultModel: "claude-sonnet-4-20250514",
		needsApiKey: true,
	},
	{
		id: "ollama",
		name: t.ollamaLocal,
		defaultModel: "gemma3:12b",
		needsApiKey: false,
	},
];

// ============================================================
// Ollama model diagnostics
// ============================================================

interface JapaneseRating {
	rating: string;
	recommended: boolean;
}

/**
 * Static map of model family → Japanese language quality rating.
 * Unknown models show "?" and are not flagged as recommended.
 */
const JAPANESE_RATINGS: Record<string, JapaneseRating> = {
	qwen3: { rating: "◎", recommended: true },
	"qwen2.5": { rating: "◎", recommended: true },
	qwen2: { rating: "◎", recommended: true },
	gemma3: { rating: "○", recommended: false },
	gemma2: { rating: "○", recommended: false },
	"command-r": { rating: "○", recommended: false },
	llama3: { rating: "△", recommended: false },
	"llama3.1": { rating: "△", recommended: false },
	"llama3.2": { rating: "△", recommended: false },
	"phi-3": { rating: "△", recommended: false },
	"phi-4": { rating: "△", recommended: false },
	mistral: { rating: "△", recommended: false },
};

export function getJapaneseRating(modelName: string): JapaneseRating {
	// Match longest prefix first (e.g., "qwen2.5" before "qwen2")
	const sorted = Object.keys(JAPANESE_RATINGS).sort((a, b) => b.length - a.length);
	for (const family of sorted) {
		if (modelName.startsWith(family)) return JAPANESE_RATINGS[family];
	}
	return { rating: "?", recommended: false };
}

export interface ModelDiagnostics {
	parameterSize: string;
	japaneseRating: string;
	recommendedContext: string;
	note?: string;
}

export function diagnoseModel(modelName: string, paramSize: string): ModelDiagnostics {
	const jpInfo = getJapaneseRating(modelName);

	// Context recommendation based on model parameter size.
	// Assumes user has 16-24 GB VRAM (typical consumer GPU).
	// Larger context = more VRAM needed, so we recommend conservatively.
	// MPC-10 diagnosis prompt typically needs ~4k-8k context.
	let recommendedContext = "8k";
	let note: string | undefined;

	if (/\b[1-3]B/i.test(paramSize)) {
		recommendedContext = "128k";
		note = "ollama.diagNoteSmall";
	} else if (/\b[78]B/i.test(paramSize)) {
		recommendedContext = "32k";
		note = "ollama.diagNote8B";
	} else if (/\b1[0-4]B/i.test(paramSize)) {
		recommendedContext = "32k";
		note = "ollama.diagNote14B";
	} else if (/\b(2[0-9]|3[0-4])B/i.test(paramSize)) {
		recommendedContext = "16k";
		note = "ollama.diagNoteMid";
	} else if (/\b(70|72)B/i.test(paramSize)) {
		recommendedContext = "8k";
		note = "ollama.diagNoteLarge";
	}

	return {
		parameterSize: paramSize,
		japaneseRating: jpInfo.rating,
		recommendedContext,
		note,
	};
}
