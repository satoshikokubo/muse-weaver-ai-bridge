# 🔌 Muse Weaver AI Bridge

**Shared AI connection bridge for the Muse Weaver plugin series.**

This [Obsidian](https://obsidian.md) plugin provides a unified AI connection layer and persona system for all Muse Weaver plugins. Configure your AI provider and guide persona once, and all Muse Weaver plugins will use them automatically.

## Supported Providers

| Provider           | Example Models                                  |   API Key    |
| ------------------ | ----------------------------------------------- | :----------: |
| **Google Gemini**  | gemini-2.5-flash, gemini-2.5-pro                |   Required   |
| **OpenAI**         | gpt-4o-mini, gpt-4o, gpt-4.1-mini, gpt-4.1-nano |   Required   |
| **Anthropic**      | claude-sonnet-4, claude-haiku-4.5               |   Required   |
| **Ollama (Local)** | Any installed model                             | Not required |

> **Tip:** Google Gemini offers a generous free tier — a great way to get started without any cost.

## Guide Personas

Choose the voice that guides your creative journey. Each persona changes how the AI speaks to you across all Muse Weaver plugins:

| Persona     | Icon | Personality                                            |
| ----------- | :--: | ------------------------------------------------------ |
| **Muse**    |  ☽   | Gentle moon goddess — warm, curious, encouraging       |
| **Sol**     |  ☀   | Energetic sun god — casual, hype, pushes you forward   |
| **Stella**  |  ★   | Tsundere star goddess — sharp but secretly supportive  |
| **Minerva** |  ⚖   | Wise goddess — scholarly, formal, precise              |
| **Athena**  |  ⚔   | Strategic goddess — tough, Socratic, demands your best |

You can also create a **fully custom persona** with your own name, first person pronoun, tone, and speech style.

## Installation

### From Obsidian Community Plugins

1. Open **Settings** → **Community plugins** → **Browse**
2. Search for **Muse Weaver AI Bridge**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/satoshikokubo/muse-weaver-ai-bridge/releases)
2. Create `.obsidian/plugins/muse-weaver-ai-bridge/` and place the files inside
3. Enable in **Settings** → **Community plugins**

## Setup

1. Open **Settings** → **Muse Weaver AI Bridge**
2. Toggle **Enable AI** on
3. Select your preferred provider
4. Enter your API key (or configure the Ollama URL for local models)
5. Click **Run Test** to verify the connection
6. (Optional) Choose a guide persona or create your own

## For Plugin Developers

Other Obsidian plugins can use this bridge to access AI capabilities:

```typescript
const bridge = app.plugins.plugins["muse-weaver-ai-bridge"];
if (bridge?.isConfigured()) {
  const result = await bridge.callAi({
    system: "You are a helpful assistant.",
    message: "Hello!",
    maxTokens: 100,
  });
  if (result.ok) {
    console.log(result.text);
  }
}
```

### Public API

| Method               | Returns             | Description                                          |
| -------------------- | ------------------- | ---------------------------------------------------- |
| `callAi(req)`        | `Promise<AiResult>` | Send a prompt to the configured AI provider          |
| `isConfigured()`     | `boolean`           | Check if AI is enabled and properly configured       |
| `getProviderName()`  | `string`            | Get the display name of the current provider         |
| `getPersona()`       | `MusePersona`       | Get the currently selected persona                   |
| `getPersonaPrompt()` | `string`            | Get a formatted system prompt string for the persona |

### AiRequest

```typescript
interface AiRequest {
  system: string; // System prompt
  message: string; // User message
  maxTokens: number; // Max tokens for the response
}
```

### AiResult

```typescript
type AiResult = { ok: true; text: string } | { ok: false; error: string };
```

### MusePersona

```typescript
interface MusePersona {
  id: string; // "default" | "sol" | "stella" | "minerva" | "athena" | "custom"
  name: string; // Display name
  icon: string; // Lucide icon name
  tone: string; // AI prompt: personality description
  firstPerson: string; // First person pronoun
  speechStyle: string; // AI prompt: speech pattern description
}
```

## Companion Plugins

- **[Muse Weaver Plot](https://github.com/satoshikokubo/muse-weaver-plot)** — Guided plot creation with AI-powered hints and diagnosis

## Support

☕ [Buy Me a Coffee](https://buymeacoffee.com/kokubox)

## License

[MIT](LICENSE)

---

# 🔌 Muse Weaver AI Bridge（日本語）

**Muse Weaverプラグインシリーズ共通のAI接続基盤**

AIプロバイダーの設定とガイドペルソナを一度設定すれば、すべてのMuse Weaverプラグインで自動的に使用されます。

## 対応プロバイダー

- **Google Gemini** — gemini-2.5-flash / gemini-2.5-pro
- **OpenAI** — gpt-4o-mini / gpt-4o / gpt-4.1-mini / gpt-4.1-nano
- **Anthropic** — claude-sonnet-4 / claude-haiku-4.5
- **Ollama（ローカル）** — インストール済みの任意のモデル

> **おすすめ:** Google Gemini は無料枠が充実しており、コストをかけずに始められます。

## ガイド神格

AIがあなたに語りかける「声」を選べます。すべてのMuse Weaverプラグインに反映されます：

| 神格                      | 口調                                   |
| ------------------------- | -------------------------------------- |
| **Muse**（月の女神）      | 穏やか・知的・「聞かせてください」     |
| **Sol**（太陽の神）       | タメ口・情熱的・「いいじゃん！」       |
| **Stella**（星の女神）    | ツンデレ・「別に……」                   |
| **Minerva**（知恵の女神） | でございます調・「お見事でございます」 |
| **Athena**（戦略の女神）  | である調・「悪くない。だが、もう一歩」 |

自分だけのオリジナルペルソナも作成できます。

## セットアップ

1. **設定** → **Muse Weaver AI Bridge** を開く
2. **AI機能を有効にする** をオン
3. プロバイダーを選択し、APIキーを入力
4. **テスト実行** で接続確認
5. （任意）ガイド神格を選択、またはカスタムペルソナを作成

## ライセンス

[MIT](LICENSE)
