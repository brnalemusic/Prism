# Prism

**Prism** is an open, multi-provider Electron + React desktop AI assistant. It bridges cognitive artificial intelligence models with local operating system execution, combining a full-featured multi-pane chat workspace, a global Quick Launcher, local command sandboxing, Playwright browser automation, interactive mini-apps, voice dictation, text-to-speech (TTS), custom slash workflows, and a visual styling engine.

Unlike legacy setups locked to single API vendors or fixed fine-tuned models, Prism features an open **Multi-Provider & Dynamic Model Architecture**. Anyone can connect Google AI Studio, OpenAI GPT, Anthropic Claude, OpenRouter, NVIDIA NIM, GroqCloud, Cerebras AI, or any custom OpenAI-compatible / Anthropic-compatible / Responses API-compatible endpoint (such as local LLMs running on Ollama or LM Studio).

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Multi-Provider & AI Model Architecture](#multi-provider--ai-model-architecture)
- [Quick Launcher](#quick-launcher)
- [Main Chat Workspace](#main-chat-workspace)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Interactive Mini-Apps](#interactive-mini-apps)
- [Custom Slash Workflows](#custom-slash-workflows)
- [System Tools & Computer Use](#system-tools--computer-use)
- [Local Command Sandbox & Safety](#local-command-sandbox--safety)
- [Playwright Browser Automation](#playwright-browser-automation)
- [Text-to-Speech (TTS) & Microphone Dictation](#text-to-speech-tts--microphone-dictation)
- [Internal AI Knowledge Base](#internal-ai-knowledge-base)
- [Settings & Styling System](#settings--styling-system)
- [Development & Building](#development--building)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop Runtime | Electron 39+ (Node.js + Chromium) |
| UI Framework | React 19 + TypeScript 5.9 |
| Bundler & Build | Vite 7 / `electron-vite` |
| AI Integration | `@google/genai`, `openai`, `undici` |
| Browser Automation | Playwright (Chromium CDPSession) |
| Formatting & Math | `react-markdown` + `rehype-raw` + `rehype-katex` + `katex` + `prismjs` |
| Styling Engine | Tailwind CSS v4 + LightningCSS |
| Security | Electron `safeStorage` (Windows DPAPI / Mac Keychain) + Path Guard |

---

## Multi-Provider & AI Model Architecture

Prism 7.0.1 breaks free from fixed model vendor locks. Users can configure multiple provider profiles and dynamically discover, enable, or assign models to different features.

### Supported Provider Types & Endpoints

1. **Trusted Cloud Providers:**
   - **Google AI Studio:** `https://generativelanguage.googleapis.com/v1beta` (OpenAI-compatible chat completions sub-path & native models)
   - **OpenAI GPT:** `https://api.openai.com/v1`
   - **Anthropic Claude:** `https://api.anthropic.com/v1` (Native Anthropic `/messages` API)
   - **OpenRouter:** `https://openrouter.ai/api/v1`
   - **NVIDIA NIM:** `https://integrate.api.nvidia.com/v1`
   - **GroqCloud:** `https://api.groq.com/openai/v1`
   - **Cerebras AI:** `https://api.cerebras.ai/v1`
2. **Custom Providers & Local Endpoints:**
   - Connect any endpoint supporting `chat_completions`, `responses` (OpenAI Responses API), or `anthropic_messages`.
   - Native integration with local model runners such as **Ollama**, **LM Studio**, **vLLM**, or **LocalAI** via custom Base URL configuration.

### Dynamic Model Discovery & Trusted Registry

- **Automatic Model Listing:** Prism queries `/models` or `/openai/models` on target endpoints to populate available model lists dynamically.
- **Trusted Registry:** Known high-performance models (e.g., `gemini-3.6-flash`, `gpt-5.6-sol`, `claude-sonnet-5`, `deepseek-v4-pro`, `qwen3.6-27b`, `llama-4-maverick-17b-128e-instruct`, `minimax-m3`) are automatically identified and enabled by default.
- **Granular Assignment:** Independently assign active models for:
  - **Main Chat Model:** Primary conversational & coding agent.
  - **Web Search Model:** Search grounding & information extraction.
  - **Quick Launcher Model:** Inline query helper.
  - **Dictation / STT Model:** Speech-to-text transcription.

### Streaming Reasoning & Thought Signatures

Prism seamlessly handles streaming reasoning/thinking tokens across provider architectures:
- Extracts reasoning deltas (`reasoning_content`, `reasoning`, `thinking`) into a real-time collapsible **Thoughts** panel.
- Preserves Google Gemini thinking model multi-turn state via native `thought_signature` tracking during tool execution calls.

---

## Quick Launcher

The Quick Launcher is a global, transparent desktop overlay triggered via system hotkey (`Ctrl+Space` by default).

### Operating Modes

- **Simple Mode (default):** Mini-chat interface rendered directly inside the launcher. Provides sub-second AI responses, math evaluation, app launches, and workspace file lookups without leaving active applications.
- **Advanced Mode:** Passes the prompt directly to the main workspace window upon submission.

### Key Launcher Features

- **App Launcher:** Instant fuzzy search over local installed software with native icons. Pressing `Enter` launches the binary.
- **Workspace File Search:** Real-time search of files in the working directory. Pressing `Enter` opens the file.
- **Inline Calculator:** Evaluates math expressions instantly with result clipboard copying.
- **Inline Model Selector:** Press `Ctrl+M` inside the launcher to toggle active model endpoints on the fly.
- **Screenshot & Ask (`Ctrl+Alt+Space`):** Captures the screen, triggers a visual glow effect, and attaches the image to the next prompt automatically.

---

## Main Chat Workspace

The main chat interface is Prism's primary environment for complex engineering tasks.

- **Streaming Cursor:** Fluid token streaming with markdown layout containment.
- **Reasoning Display:** Expandable real-time thinking panel parsing multi-pass reasoning steps.
- **Tool Execution Loader (`ActionLoader`):** Displays tool calls (`writing → running → done/error`) with expandable live terminal/browser output.
- **Answer Prism:** Selecting any text in chat opens a floating action button to pass the selection as context to the AI.
- **Multi-Chat Parallelism:** Run concurrent conversations in parallel with sidebar status indicators.
- **Fullscreen Mode:** Expandable prompt editor for long system instructions or code submissions.

---

## Keyboard Shortcuts

### Global OS Shortcuts (Configurable)

| Default Hotkey | Action |
| --- | --- |
| `Ctrl+Space` (Win) / `Cmd+Space` (Mac) | Toggle Quick Launcher open/closed |
| `Ctrl+Alt+Space` | Screenshot & Ask (capture screen & attach to prompt) |

### Main Chat Shortcuts

| Hotkey | Action |
| --- | --- |
| `Enter` | Send message |
| `Shift+Enter` | Insert newline |
| `Ctrl+T` | Toggle Think / Reasoning mode |
| `Ctrl+S` | Toggle Web Search mode |
| `Ctrl+Y` | Toggle YouTube mode |
| `Ctrl+D` | Toggle Voice Dictation |
| `Ctrl+N` | Start new conversation |
| `Escape` | Exit fullscreen input mode |

### Quick Launcher Shortcuts

| Hotkey | Action |
| --- | --- |
| `Escape` | Close launcher |
| `↑` / `↓` | Navigate suggestions / model list |
| `Enter` | Execute selected item / send prompt |
| `Ctrl+M` | Open inline model selector dropdown |
| `Ctrl+T` / `Ctrl+S` / `Ctrl+Y` / `Ctrl+D` | Toggle modes in launcher |

---

## Interactive Mini-Apps

Prism models can author stateful, interactive web applications directly in chat via the `create_mini_app` tool.
- HTML, CSS, and JS are executed in isolated, sandboxed web views.
- Ideal for interactive calculators, dashboards, data visualizations, and prototype UI widgets.

---

## Custom Slash Workflows

Define reusable system workflows using custom slash commands:
- `list_workflows`: Fetch active workflows.
- `save_workflow`: Define custom commands (e.g. `/summarize`, `/refactor`) with tailored system instructions and tool execution constraints.
- `delete_workflow`: Remove existing custom slash commands.

---

## System Tools & Computer Use

Prism models have access to a suite of native operating system tools:

- **File Operations (`computer_use_*`):**
  - Read (`read_file`), Create (`create_file`), Save (`save_file`), Append (`append_file`), Line Edit (`edit_file`).
  - Directory List (`list_directory`), Directory Create (`create_directory`), Remove File/Dir (`remove_file`/`remove_directory`).
  - Copy (`copy_file`), Move/Rename (`move_file`), Metadata (`get_file_info`).
- **App Management:** `search_installed_applications`, `open_application`.
- **Task Management:** `create_todo`, `edit_todo` interactive checklist tracking.
- **Screen & Vision:** `computer_use_see_screen` (captures active app windows or desktop).

---

## Local Command Sandbox & Safety

Terminal execution (`execute_terminal_command`) is guarded by `localCommandSandbox.ts`:
- **Shell Customization:** Configurable execution shell (`powershell.exe`, `cmd.exe`, `pwsh.exe`).
- **Path Guardrails:** Enforces `assertSafeFileMutationPath` and `assertSafeBulkMutationPath` to prevent deletion or modification of critical OS roots, system registries, or boot files.
- **User Authorization:** Destructive or modifying terminal commands trigger an interactive prompt for user review.

---

## Playwright Browser Automation

Prism embeds a headless/headful Playwright Chromium browser engine:
- `open_browser`, `browser_navigate`, `browser_snapshot` (semantic accessibility DOM tree).
- `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_back`, `browser_screenshot`, `browser_close`.
- `web_script` (JS execution), `detailed_dom_page` (HTML structure inspection).
- **CDPSession Downloads:** Automatic tracking of browser file downloads with real-time progress events.

---

## Text-to-Speech (TTS) & Microphone Dictation

- **Text-to-Speech:** Integrated audio generation with voice profiles (`Aoede`, `Puck`, `Charon`, `Kore`, `Fenrir`).
- **Dictation (STT):** Local microphone recording with background AI speech transcription.

---

## Internal AI Knowledge Base

Prism features an internal documentation reader (`internal_docs_list`, `internal_docs_read`). Connected AI models can inspect local architectural docs inside `resources/docs/` on demand to understand Prism's internal mechanisms and guide users accurately.

---

## Settings & Styling System

- **Visual Themes:** Powered by Tailwind v4. Includes `marine` (default dark blue), `vertez` (emerald forest), `akoustik` (cyber studio), `terno` (slate monochrome), `ursula` (deep purple), and `rgb` (dynamic Easter egg theme).
- **UI Zoom Factor:** Configurable interface scaling (0.5x to 3.0x).
- **Encrypted Storage:** API keys encrypted via Electron `safeStorage` (Windows DPAPI / macOS Keychain).

---

## Development & Building

### Prerequisites

- Node.js 20+
- npm 10+

### Installation & Execution

```bash
# Install dependencies
npm install

# Run development workspace with HMR
npm run dev

# Run TypeScript type check
npm run typecheck

# Build production executable for Windows
npm run build:win

# Build demo mode variant
npm run dev:demo
```
