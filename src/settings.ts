import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MuseWeaverAiBridgePlugin from "./main";
import { PROVIDERS, DEFAULT_AI_SETTINGS, type AiProvider, type AiSettings, getApiKey, getModel, getJapaneseRating, diagnoseModel } from "./types";
import { callAi, listOllamaModels, showOllamaModel, type OllamaModelEntry } from "./ai-client";
import { t, lang } from "./i18n";
import { getPresetIds, getPreset, resolvePersona, buildPersonaPrompt } from "./persona";

export class MwabSettingTab extends PluginSettingTab {
	plugin: MuseWeaverAiBridgePlugin;

	constructor(app: App, plugin: MuseWeaverAiBridgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(t.pluginTitle).setHeading();
		containerEl.createEl("p", {
			text: t.pluginSubtitle,
			cls: "setting-item-description",
		});

		const s = this.plugin.settings;
		const currentProvider = PROVIDERS.find((p) => p.id === s.provider) || PROVIDERS[0];

		// ---- Enable toggle ----
		new Setting(containerEl)
			.setName(t.enableAi)
			.addToggle((toggle) =>
				toggle.setValue(s.enabled).onChange(async (v) => {
					s.enabled = v;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (!s.enabled) {
			containerEl.createEl("p", {
				text: t.disabledNote,
				cls: "setting-item-description",
			});
			this.renderFooter(containerEl);
			return;
		}

		// ---- Provider ----
		new Setting(containerEl)
			.setName(t.provider)
			.addDropdown((dd) => {
				for (const p of PROVIDERS) {
					dd.addOption(p.id, p.name);
				}
				dd.setValue(s.provider);
				dd.onChange(async (v) => {
					s.provider = v as AiProvider;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		// ---- API Key (if needed) ----
		if (currentProvider.needsApiKey) {
			new Setting(containerEl)
				.setName(t.apiKey)
				.setDesc(t.apiKeyDesc(currentProvider.name))
				.addText((text) =>
					text
						.setPlaceholder("sk-... / anthropic-... / AIza...")
						.setValue(getApiKey(s))
						.onChange(async (v) => {
							this.ensureProvider(s.provider);
							s.providers[s.provider].apiKey = v.trim();
							await this.plugin.saveSettings();
						})
				);
			// Obscure the input
			const apiInput = containerEl.querySelector(".setting-item:last-child input");
			if (apiInput instanceof HTMLInputElement) apiInput.type = "password";
		}

		// ---- Ollama URL (before model selector, since URL affects model list) ----
		if (s.provider === "ollama") {
			new Setting(containerEl)
				.setName("Ollama URL")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(s.ollamaUrl)
						.onChange(async (v) => {
							s.ollamaUrl = v.trim() || "http://localhost:11434";
							await this.plugin.saveSettings();
						})
				);
		}

		// ---- Model ----
		if (s.provider === "ollama") {
			// Async: render placeholder then populate dropdown
			const modelContainer = containerEl.createDiv();
			const loadingEl = modelContainer.createDiv({ cls: "setting-item-description" });
			loadingEl.setText(t.ollamaFetchingModels);
			void this.renderOllamaModelSelector(modelContainer, s).then(() => {
				loadingEl.remove();
			});
		} else {
			// Always show the stored value as-is. Placeholder shows default.
			const storedModel = s.providers[s.provider]?.model || "";
			new Setting(containerEl)
				.setName(t.model)
				.addText((text) =>
					text
						.setPlaceholder(currentProvider.defaultModel)
						.setValue(storedModel)
						.onChange(async (v) => {
							this.ensureProvider(s.provider);
							s.providers[s.provider].model = v.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		// ---- Connection Test ----
		new Setting(containerEl).setName(t.testHeading).setHeading();

		const testResultEl = containerEl.createDiv({ cls: "setting-item-description" });
		testResultEl.style.marginBottom = "8px";

		new Setting(containerEl)
			.setName(t.testName)
			.setDesc(t.testDesc)
			.addButton((btn) =>
				btn
					.setButtonText(t.testBtn)
					.setCta()
					.onClick(async () => {
						testResultEl.empty();
						testResultEl.setText(t.testConnecting);
						testResultEl.style.color = "";

						const result = await callAi(this.plugin.settings, {
							system: "You are a test assistant. Respond with exactly: OK",
							message: "Connection test. Respond with: OK",
							maxTokens: 50,
						});

						testResultEl.empty();

						if (result.ok) {
							const modelName = getModel(s);
							testResultEl.setText(t.testSuccess(currentProvider.name, modelName));
							testResultEl.style.color = "var(--text-success)";

							// Show Ollama diagnostics after successful connection
							if (s.provider === "ollama") {
								await this.showOllamaDiagnostics(testResultEl, s);
							}
						} else {
							testResultEl.createDiv({ text: t.testFail(result.error || "Unknown error") });
							testResultEl.style.color = "var(--text-error)";

							if (result.error?.includes("404") || result.error?.includes("not found")) {
								const hint = testResultEl.createDiv();
								hint.style.color = "var(--text-muted)";
								hint.style.marginTop = "4px";
								hint.style.fontSize = "0.85em";
								hint.setText(t.error404Hint);
							}
						}
					})
			);

		// ---- Muse Persona ----
		this.renderPersonaSection(containerEl);

		this.renderFooter(containerEl);
	}

	// ============================================================
	// Guide Section (導き手)
	// ============================================================

	private renderPersonaSection(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName(t.guideHeading).setHeading();

		const presetIds = getPresetIds();
		const currentId = s.persona.selected;
		const isCustom = currentId === "custom";

		// Guide selector dropdown with description underneath
		new Setting(containerEl)
			.setName(t.guideSelect)
			.setDesc(t.guideAppliesAll)
			.addDropdown((dd) => {
				for (const id of presetIds) {
					const preset = getPreset(id);
					dd.addOption(id, preset.name);
				}
				dd.addOption("custom", t.guideCustom);
				dd.setValue(currentId);

				// Sync default to data.json if not yet saved
				if (!currentId || (!isCustom && !presetIds.includes(currentId))) {
					s.persona.selected = "default";
					dd.setValue("default");
					void this.plugin.saveSettings();
				}

				dd.onChange(async (v) => {
					s.persona.selected = v;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		// Show tone preview (only if tone is non-empty and not custom)
		const activePersona = resolvePersona(s.persona);
		if (!isCustom && activePersona.tone) {
			const previewEl = containerEl.createDiv({ cls: "setting-item-description" });
			previewEl.style.marginTop = "4px";
			previewEl.style.marginBottom = "12px";
			previewEl.style.fontStyle = "italic";
			previewEl.style.opacity = "0.8";
			previewEl.setText(activePersona.tone);
		}

		// Customization fields
		if (isCustom) {
			this.renderPersonaCustomFields(containerEl, s);
		}
	}

	private renderPersonaCustomFields(containerEl: HTMLElement, s: AiSettings): void {
		const c = s.persona.custom;

		new Setting(containerEl)
			.setName(t.guideName)
			.addText((text) =>
				text
					.setPlaceholder("Muse")
					.setValue(c.name)
					.onChange(async (v) => {
						c.name = v.trim() || "Muse";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t.guideFirstPerson)
			.addText((text) =>
				text
					.setPlaceholder(lang === "ja" ? "\u308f\u305f\u3057" : "I")
					.setValue(c.firstPerson)
					.onChange(async (v) => {
						c.firstPerson = v.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t.guideSpeechStyle)
			.addText((text) =>
				text
					.setPlaceholder(lang === "ja" ? "\u3067\u3059\u307e\u3059\u8abf" : "Polite and warm")
					.setValue(c.speechStyle)
					.onChange(async (v) => {
						c.speechStyle = v.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t.guideTone)
			.setDesc(t.guideToneDesc)
			.addTextArea((text) => {
				text
					.setPlaceholder(lang === "ja"
						? "\u7a4f\u3084\u304b\u3067\u77e5\u7684\u306a\u5c0e\u304d\u624b\u3002\u7269\u8a9e\u306b\u7d14\u7c8b\u306a\u597d\u5947\u5fc3\u3092\u6301\u3064\u3002"
						: "A gentle, intellectual guide with curiosity about stories.")
					.setValue(c.tone)
					.onChange(async (v) => {
						c.tone = v.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
				text.inputEl.style.width = "100%";
			});
	}

	/** Render Ollama model selector as dropdown */
	private async renderOllamaModelSelector(containerEl: HTMLElement, s: AiSettings): Promise<void> {
		const currentModel = s.providers["ollama"]?.model || "";

		// Fetch installed models
		const models = await listOllamaModels(s.ollamaUrl);

		if (models.length === 0) {
			// No models: show disabled dropdown
			const setting = new Setting(containerEl)
				.setName(t.model)
				.addDropdown((dd) => {
					dd.addOption("", t.ollamaNoModels);
					dd.setValue("");
					dd.setDisabled(true);
				});
			setting.descEl.style.color = "var(--text-muted)";

			// Clear stale model value in data.json
			if (currentModel) {
				this.ensureProvider("ollama");
				s.providers["ollama"].model = "";
				void this.plugin.saveSettings();
			}

			if (lang === "ja") {
				this.renderOllamaRecommendHint(containerEl, models);
			}
			return;
		}

		// Sort: recommended first (ja only), then by size descending
		models.sort((a, b) => {
			if (lang === "ja") {
				const aRec = getJapaneseRating(a.name).recommended ? 0 : 1;
				const bRec = getJapaneseRating(b.name).recommended ? 0 : 1;
				if (aRec !== bRec) return aRec - bRec;
			}
			return b.size - a.size;
		});

		// Build dropdown options
		const formatOption = (m: OllamaModelEntry): string => {
			const sizeGB = (m.size / 1e9).toFixed(1);
			if (lang === "ja") {
				const jp = getJapaneseRating(m.name);
				return `${m.name}  (${sizeGB} GB)  ${t.ollamaJpLabel} ${jp.rating}`;
			}
			return `${m.name}  (${sizeGB} GB)`;
		};

		// Check if current model is in the list
		const isInList = models.some((m) => m.name === currentModel);

		const modelSetting = new Setting(containerEl).setName(t.model);
		modelSetting.addDropdown((dd) => {
			for (const m of models) {
				dd.addOption(m.name, formatOption(m));
			}
			const effectiveModel = isInList ? currentModel : models[0]?.name || "";
			dd.setValue(effectiveModel);

			// Sync to data.json if displayed model differs from stored value
			if (effectiveModel !== currentModel) {
				this.ensureProvider("ollama");
				s.providers["ollama"].model = effectiveModel;
				void this.plugin.saveSettings();
			}

			dd.onChange(async (v) => {
				this.ensureProvider("ollama");
				s.providers["ollama"].model = v;
				await this.plugin.saveSettings();
			});
		});

		// Show recommend hint if no qwen model installed (ja only)
		if (lang === "ja") {
			this.renderOllamaRecommendHint(containerEl, models);
		}
	}

	/** Show hint if no qwen2.5 model is installed */
	private renderOllamaRecommendHint(containerEl: HTMLElement, models: OllamaModelEntry[]): void {
		const hasQwen = models.some((m) => m.name.startsWith("qwen"));
		if (hasQwen) return;

		const hintEl = containerEl.createDiv({ cls: "setting-item-description" });
		hintEl.style.marginTop = "4px";
		hintEl.style.marginBottom = "8px";

		const textSpan = hintEl.createSpan({ text: t.ollamaRecommendHint });
		textSpan.style.marginRight = "8px";

		const codeEl = hintEl.createEl("code", { text: t.ollamaRecommendCmd });
		codeEl.style.marginRight = "4px";
		codeEl.style.fontSize = "0.85em";

		const copyBtn = hintEl.createEl("button", { text: "📋" });
		copyBtn.style.fontSize = "0.8em";
		copyBtn.style.cursor = "pointer";
		copyBtn.style.border = "none";
		copyBtn.style.background = "none";
		copyBtn.style.padding = "2px 4px";
		copyBtn.addEventListener("click", () => {
			void navigator.clipboard.writeText(t.ollamaRecommendCmd);
			new Notice(t.ollamaCopied);
		});
	}

	/** Show diagnostics after successful Ollama connection test */
	private async showOllamaDiagnostics(resultEl: HTMLElement, s: AiSettings): Promise<void> {
		const modelName = getModel(s);
		const details = await showOllamaModel(s.ollamaUrl, modelName);
		if (!details?.parameter_size) return;

		const diag = diagnoseModel(modelName, details.parameter_size);
		const diagEl = resultEl.createDiv();
		diagEl.style.color = "var(--text-muted)";
		diagEl.style.marginTop = "4px";
		diagEl.style.fontSize = "0.9em";
		diagEl.setText(`   ${t.ollamaDiag(diag.parameterSize, diag.japaneseRating, diag.recommendedContext)}`);

		if (diag.note) {
			const noteMap: Record<string, string> = {
				"ollama.diagNoteLarge": t.ollamaDiagNoteLarge,
				"ollama.diagNoteSmall": t.ollamaDiagNoteSmall,
				"ollama.diagNote8B": t.ollamaDiagNote8B,
				"ollama.diagNote14B": t.ollamaDiagNote14B,
				"ollama.diagNoteMid": t.ollamaDiagNoteMid,
			};
			const noteText = noteMap[diag.note] || diag.note;
			const noteEl = resultEl.createDiv();
			noteEl.style.color = "var(--text-muted)";
			noteEl.style.fontSize = "0.85em";
			noteEl.setText(`   💡 ${noteText}`);
		}
	}

	/** Ensure providers[id] exists before writing to it */
	private ensureProvider(id: string): void {
		const s = this.plugin.settings;
		if (!s.providers[id]) {
			s.providers[id] = { apiKey: "", model: "" };
		}
	}

	private renderFooter(containerEl: HTMLElement): void {
		// ---- Reset all settings ----
		containerEl.createEl("hr");

		new Setting(containerEl)
			.setName(t.resetName)
			.setDesc(t.resetDesc)
			.addButton((btn) =>
				btn
					.setButtonText(t.resetBtn)
					.setWarning()
					.onClick(async () => {
						this.plugin.settings = JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS));
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
