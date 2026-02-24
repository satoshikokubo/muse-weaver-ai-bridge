import { Plugin } from "obsidian";
import {
	DEFAULT_AI_SETTINGS,
	type AiSettings,
	type AiRequest,
	type AiResult,
	type MusePersona,
	PROVIDERS,
	migrateSettings,
	getApiKey,
} from "./types";
import { callAi } from "./ai-client";
import { MwabSettingTab } from "./settings";
import { resolvePersona, buildPersonaPrompt } from "./persona";

export default class MuseWeaverAiBridgePlugin extends Plugin {
	settings: AiSettings = DEFAULT_AI_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MwabSettingTab(this.app, this));
	}

	// ============================================================
	// Public API — called by other Muse Weaver plugins
	// ============================================================

	/**
	 * Send a request to the configured AI provider.
	 * Consumer plugins call this via:
	 *   app.plugins.plugins["muse-weaver-ai-bridge"].callAi(req)
	 */
	async callAi(req: AiRequest): Promise<AiResult> {
		return callAi(this.settings, req);
	}

	/**
	 * Check if AI is configured and ready to use.
	 */
	isConfigured(): boolean {
		if (!this.settings.enabled) return false;
		const provider = PROVIDERS.find((p) => p.id === this.settings.provider);
		if (!provider) return false;
		if (provider.needsApiKey && !getApiKey(this.settings)) return false;
		return true;
	}

	/**
	 * Get the display name of the current provider.
	 */
	getProviderName(): string {
		return PROVIDERS.find((p) => p.id === this.settings.provider)?.name || "Unknown";
	}

	/**
	 * Get the currently active Muse persona.
	 */
	getPersona(): MusePersona {
		return resolvePersona(this.settings.persona);
	}

	/**
	 * Get a system prompt fragment describing the active persona.
	 * Consumer plugins insert this at the start of their system prompts.
	 */
	getPersonaPrompt(): string {
		return buildPersonaPrompt(this.getPersona());
	}

	// ============================================================
	// Settings persistence
	// ============================================================

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_AI_SETTINGS, data);
		this.settings = migrateSettings(this.settings);
		await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
