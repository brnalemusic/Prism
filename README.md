# Prism

**Prism** is an Electron + React desktop AI assistant powered by the **Prism 6** model family (built on Google Gemini). It combines a full-featured chat interface with a global Quick Launcher, computer use tools, parallel sub-agents, text-to-speech (TTS), microphone dictation, interactive mini-apps, and a visual theming system.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Model Family](#model-family)
- [Quick Launcher](#quick-launcher)
- [Main Chat](#main-chat)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Apps & AI Workflows](#apps--ai-workflows)
- [Search Modes](#search-modes)
- [Sub-Agent System](#sub-agent-system)
- [Interactive Mini-Apps](#interactive-mini-apps)
- [Text-to-Speech (TTS)](#text-to-speech-tts)
- [Microphone Dictation](#microphone-dictation)
- [System Tools (Computer Use)](#system-tools-computer-use)
- [Settings & Themes](#settings--themes)
- [AI-Driven Configuration](#ai-driven-configuration)
- [Easter Egg: RGB Theme](#easter-egg-rgb-theme)
- [Conversation History](#conversation-history)
- [Development](#development)

---

## Tech Stack

| Layer    | Technology                                      |
| -------- | ----------------------------------------------- |
| Desktop  | Electron 34+                                    |
| UI       | React 19 + TypeScript                           |
| Build    | Vite / electron-vite                            |
| AI       | Google Gemini (`@google/genai`)                 |
| Markdown | react-markdown + rehype-raw + rehype-katex      |
| Styling  | Tailwind CSS                                    |
| IPC      | Electron IPC (main ↔ renderer) via `window.api` |

---

## Model Family

Prism uses an internal model key system that maps to specific Gemini/Gemma API models. All models support extended reasoning (Think mode).

### Available Models in the App

| Model ID             | Display Name           | Internal API             | Profile                                                                                                                     |
| -------------------- | ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `prism-6-super-fast` | **Prism 6 Super-Fast** | `gemini-3.1-flash-lite`  | Ultra-fast, ultra-low latency for simple tasks and everyday computer use. **Default at startup.**                           |
| `prism-6-fast-old`   | **Prism 6 Fast-Old**   | `gemini-3-flash-preview` | Older speed-focused model for day-to-day tasks, automation, and orchestration.                                              |
| `prism-6-fast`       | **Prism 6 Fast**       | `gemini-3.5-flash`       | Balanced model for complex automation, orchestration, and code tasks with low latency.                                      |
| `prism-6-dragon`     | **Prism 6 Dragon**     | `gemma-4-26b-a4b-it`     | Most capable for in-depth research, large-scale agent orchestration, and information gathering. **Default for sub-agents.** |
| `prism-6-dense`      | **Prism 6 Dense**      | `gemma-4-31b-it`         | Densest model for debugging large codebases, complex mathematics, and heavy reasoning (`ThinkingLevel.HIGH`).               |

> **Automatic fallback:** If the active model fails due to rate limiting (429) or unavailability, the system cascades through: `Dense → Dragon → Fast → Fast-Old → Super-Fast`, notifying the user in chat.

### Legacy Models (not exposed in the UI, but recognized internally)

| ID          | API                      | Notes               |
| ----------- | ------------------------ | ------------------- |
| `prism-4`   | `gemini-3.1-flash-lite`  | Legacy              |
| `prism-4.1` | `gemini-3-flash-preview` | Legacy              |
| `prism-4.2` | `gemma-4-26b-a4b-it`     | Legacy              |
| `prism-4.3` | `gemma-4-31b-it`         | Legacy (Think HIGH) |
| `prism-5`   | `gemini-3.5-flash`       | Legacy              |

### Sub-Agent Model Configuration

The sub-agent model is configured independently from the main model. By default it uses `prism-6-dragon` running with `ThinkingLevel.HIGH` and thoughts disabled (silent processing for faster orchestration throughput).

---

## Quick Launcher

The Quick Launcher is a global, always-on-top transparent overlay triggered by a configurable system-wide keyboard shortcut. It functions as an intelligent search bar with AI integration.

### Operating Modes

Two modes are configurable in Settings:

- **Simple (default):** Displays an inline mini-chat directly inside the launcher. Ideal for quick queries without leaving your workflow.
- **Advanced:** On message submission, the launcher closes and opens the main chat window, passing the message as input.

### Launcher Features

- **Installed app search:** Typing an app name shows results with native icons. `Enter` launches it immediately.
- **Workspace file search:** Real-time file search in the current working directory (150ms debounce). `Enter` opens the file in the system default program.
- **Inline calculator:** Math expressions (e.g., `2+2*3`) are evaluated instantly and shown as a suggestion. `Enter` copies the result to the clipboard.
- **AI mini-chat:** In Simple mode, AI responses appear directly below the search bar with Markdown rendering, tool call indicators, and streaming support.
- **Screenshot & Ask:** Triggering the global screenshot shortcut captures the entire screen, plays an animated "glow master" border effect, and automatically attaches the image to the next sent message.
- **AI Apps & Workflows:** Toggle dedicated application modes (like the YouTube App) directly from the Apps menu or keyboard shortcuts.

---

## Main Chat

The main chat window is Prism's central interface. It supports:

- Response streaming with an animated cursor during generation.
- **Visible Thinking:** When the model is in reasoning mode, a collapsible `<details>` panel displays the model's `thoughts` in real time, extracting the last bold heading as the current step label.
- **Tool Calls:** Each tool invocation is rendered as an `ActionLoader` component with live status (`writing → running → done/error`).
- **Mini-Apps:** Generated via `<mini_app>` tags and rendered as sandboxed iframes inside the chat.
- **Rich Markdown:** Inline HTML/CSS via `rehype-raw`, LaTeX via `rehype-katex`, and GFM tables.
- **Persistent history:** Sessions saved as JSON files on the local filesystem, with offline keyword search.
- **Answer Prism:** Selecting any text in the chat reveals a floating "Answer Prism" button that sends the selected text as context to the AI.
- **Parallel multi-chat:** Multiple conversations can run simultaneously. The sidebar lists all sessions with live execution indicators.
- **Fullscreen input:** The input bar can be expanded to fullscreen mode for long-form text.

---

## Keyboard Shortcuts

### Global Shortcuts (OS-level, work even when Prism is in the background)

These shortcuts are registered system-wide and are **fully configurable** in Settings.

| Default Shortcut                       | Action                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Ctrl+Space` (Win) / `Cmd+Space` (Mac) | Toggle the Quick Launcher open/closed                                                        |
| `Ctrl+Alt+Space`                       | Screenshot & Ask — captures the entire screen and opens the launcher with the image attached |

### Main Chat Shortcuts (InputBar)

| Shortcut      | Action                                 |
| ------------- | -------------------------------------- |
| `Enter`       | Send message                           |
| `Shift+Enter` | Insert newline without sending         |
| `Ctrl+T`      | Toggle Think mode                      |
| `Ctrl+S`      | Toggle web search (Active Search)      |
| `Ctrl+E`      | Toggle extended search (Deep Research) |
| `Ctrl+Y`      | Toggle YouTube mode                    |
| `Ctrl+D`      | Start/stop microphone dictation        |
| `Escape`      | Exit fullscreen input mode             |
| `Ctrl+N`      | Start a new conversation               |

### Quick Launcher Shortcuts

| Shortcut                     | Action                                                    |
| ---------------------------- | --------------------------------------------------------- |
| `Escape`                     | Close the launcher                                        |
| `↑` / `↓`                    | Navigate suggestions (apps, files, commands, math result) |
| `Enter`                      | Execute selected suggestion / Send message                |
| `Ctrl+T`                     | Toggle Think mode in the launcher                         |
| `Ctrl+S`                     | Toggle web search in the launcher                         |
| `Ctrl+Y`                     | Toggle YouTube mode                                       |
| `Ctrl+D`                     | Start/stop microphone dictation in the launcher           |
| `Ctrl+M` (default)           | Open model selector (Advanced mode only)                  |
| `↑` / `↓` + `Enter`          | Navigate and confirm model in the model selector          |
| `Escape` (in model selector) | Close selector without changing model                     |

> The model selection shortcut is configurable in Settings (default: `CommandOrControl+M`).

---

## Apps & AI Workflows

Legacy slash commands have been discontinued and replaced with state-driven **AI Apps**. In the future, these will be substituted by extensible **AI Workflows**.

### YouTube App Mode

- **Activation:** Toggle YouTube mode via the **Apps Menu** (Plus icon dropdown) or using the `Ctrl+Y` keyboard shortcut.
- **Vibe:** The input bar shifts to YouTube colors and a badge is displayed showing the active App.
- **Behavior:** The user message is sent cleanly (without `/youtube` prefixes) with metadata, guiding the AI to find and open matching videos.

---

## Search Modes

### Active Search (Standard)

Enabled via the search toggle (`Ctrl+S`) or the `/search` command. The AI executes `web_search` and `saw_link_from_url` calls to collect real-time information. **Mandatory for serious topics** (medical, legal, current events, up-to-date code).

### Deep Research (Extended Search)

Enabled via the extended search toggle (`Ctrl+E`). When active, the AI follows a structured 5-step protocol:

1. **Understanding:** Analyzes what the user wants to discover.
2. **Brief initial research:** 1–2 searches for context and keywords.
3. **Research plan + confirmation:** Presents a briefing and a detailed plan, **stops and explicitly waits for user confirmation** before proceeding.
4. **Deep research (after confirmation):** At least 10 distinct iterations of `web_search` + `saw_link_from_url`, cross-referencing sources and investigating details. Can take up to 20 minutes.
5. **Strategic output:** Compiles the result into professional-level Markdown with tables and structures where useful.

---

## Sub-Agent System

Prism supports orchestrating multiple parallel sub-agents (up to 20 per invocation). The system is built on an asynchronous "Group Chat" blackboard.

### Architecture

- **Main Agent (Coordinator):** The primary agent can invoke `run_subagents` with up to 20 distinct prompts. Each sub-agent runs independently.
- **Master Coordinator:** A special sub-agent that coordinates without directly executing tasks — directs, analyzes, and synthesizes worker output.
- **Worker Sub-Agents:** Each worker receives a task prompt and must communicate progress via `send_group_message`. Workers can read each other's messages with `read_group_messages`.
- **Blackboard:** Shared real-time memory accessible by all sub-agents and the user.

### Sub-Agent Exit Protocol

Workers do not ask the Master Coordinator for exit permission. Instead, they must ask the **other workers** (Peer Exit Permission). The swarm terminates automatically when all workers exit individually with `status: "done"` or `status: "error"`.

### Sub-Agent Window

A separate window (400×650px) displays the Group Chat in real time. The user can send messages directly to the group, and sub-agents treat user messages as human input via `senderRole: "user"`.

### Sub-Agent Exclusive Tools

| Tool                  | Description                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `send_group_message`  | Posts a message to the Group Chat. `status: "working"` keeps the agent alive; `"done"/"error"` exits it. |
| `read_group_messages` | Reads Group Chat history with optional timestamp filter and limit.                                       |
| `wait_for_updates`    | Pauses and waits for new messages (max 180s). Required when awaiting a response.                         |

---

## Interactive Mini-Apps

The AI can generate complete interactive applications directly in the chat using the `<mini_app>` XML tag.

### Structure

```xml
<mini_app>
<title>App Name</title>
<html><!-- HTML structure --></html>
<css>/* optional styles */</css>
<js>// optional JavaScript logic</js>
</mini_app>
```

### Characteristics

- Rendered as sandboxed iframes inside the chat.
- Can be popped out into a separate window (800×600px) via a button in the UI.
- Support Vanilla JS, glassmorphism, gradients, and animations.
- **Correct use:** Only for content requiring real interactivity (forms with logic, calculators, games, inputs that change internal state).
- **Incorrect use:** Static cards or idea lists — those should use Rich Markdown (inline HTML/CSS) or plain Markdown.

---

## Text-to-Speech (TTS)

Prism can read AI responses aloud using the Google Gemini TTS API (`gemini-3.5-flash`).

### Available Voices

| Name       | Profile                        |
| ---------- | ------------------------------ |
| **Aoede**  | Warm and natural. **Default.** |
| **Puck**   | Energetic male.                |
| **Charon** | Deep voice.                    |
| **Kore**   | Soft female.                   |
| **Fenrir** | Sharp male.                    |

The voice is configurable in Settings. Each AI response displays a play button at the bottom of the message.

---

## Microphone Dictation

Available in both the main chat and the Quick Launcher.

- **Toggle:** `Ctrl+D`
- Audio is captured from the microphone and sent for transcription via `transcribeAudio` (using the Gemini API).
- In the launcher, if recording is stopped while `shouldSendRef` is active, the message is sent automatically after transcription.
- In the main chat, the transcription is inserted into the text field for review before sending.
- Visual indicators: animated microphone icon while recording; transcribing indicator while processing.

---

## System Tools (Computer Use)

Prism exposes an extensive set of tools the AI can invoke to interact with the operating system.

### Filesystem Tools

| Tool                            | Action                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| `computer_use_create_file`      | Create a new file (fails if it already exists)                   |
| `computer_use_save_file`        | Create or overwrite a file                                       |
| `computer_use_append_file`      | Append text to the end of a file                                 |
| `computer_use_edit_file`        | Edit a specific line range (with auto-indentation)               |
| `computer_use_read_file`        | Read file content (with line numbers; truncated at 10,000 chars) |
| `computer_use_remove_file`      | Delete a file                                                    |
| `computer_use_remove_directory` | Recursively delete a directory                                   |
| `computer_use_create_directory` | Create a directory (recursive)                                   |
| `computer_use_copy_file`        | Copy a file or directory                                         |
| `computer_use_move_file`        | Move or rename a file or directory                               |
| `computer_use_get_file_info`    | Get metadata (type, size, dates, permissions)                    |
| `computer_use_list_directory`   | List directory contents                                          |

### System & Web Tools

| Tool                          | Action                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `execute_terminal_command`    | Run a shell/PowerShell command (truncated at 50,000 chars)                              |
| `list_installed_applications` | List installed apps (Windows registry + manual path scan, cached)                       |
| `open_application`            | Launch an app by `.exe` path (resolves `.lnk` shortcuts)                                |
| `open_browser_link`           | Open a URL in the system default browser                                                |
| `web_search`                  | Web search via DuckDuckGo (returns up to 5 results)                                     |
| `saw_link_from_url`           | Read text content from a URL (truncated at 20,000 chars; fallback to offscreen browser) |
| `computer_use_see_screen`     | Capture a screenshot of a specific window or the entire screen                          |

### Memory & History Tools

| Tool                  | Action                                                         |
| --------------------- | -------------------------------------------------------------- |
| `search_chat_history` | Full-text offline search across past conversations by keywords |
| `search_chat_memory`  | Search history returning metadata (IDs, titles, snippets)      |
| `render_chat_history` | Render a specific chat session in the main window UI           |

### App Control Tools

| Tool               | Action                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| `configure_prism`  | Change app settings (shortcuts, model, theme, TTS voice, etc.)                  |
| `unlock_rgb_theme` | Activate the RGB theme for 2 hours (requires special access)                    |
| `open_main_app`    | Open the main window with pre-loaded instructions (used by the launcher)        |
| `run_subagents`    | Spawn parallel sub-agents (max 20)                                              |
| `to_ask`           | Render an interactive UI questionnaire and block until the user submits answers |

### Sub-Agent-Exclusive Tools

| Tool                  | Action                               |
| --------------------- | ------------------------------------ |
| `send_group_message`  | Post to the shared Group Chat        |
| `read_group_messages` | Read messages from the Group Chat    |
| `wait_for_updates`    | Asynchronously wait for new messages |

### Launcher-Context Tools (restricted subset)

In the launcher context, only a subset of tools is available: `web_search`, `saw_link_from_url`, `open_browser_link`, `open_application`, `open_main_app`.

---

## Settings & Themes

All settings are persisted locally — the API key is encrypted via Electron's `safeStorage`; all other settings are stored as plain JSON.

### Available Preferences

| Setting                  | Default              | Description                                                      |
| ------------------------ | -------------------- | ---------------------------------------------------------------- |
| Launcher Shortcut        | `Ctrl+Space`         | Global hotkey to open/close the Quick Launcher                   |
| Screenshot Shortcut      | `Ctrl+Alt+Space`     | Global hotkey to capture screen and open the launcher            |
| Model Selection Shortcut | `Ctrl+M`             | Hotkey in the launcher (Advanced mode) to open the model picker  |
| Default Model            | `prism-6-super-fast` | AI model loaded at startup                                       |
| Sub-Agent Model          | `prism-6-dragon`     | Model used by parallel sub-agents                                |
| Launcher Mode            | `simple`             | `simple` (inline mini-chat) or `advanced` (opens main app)       |
| Minimize to Tray         | `false`              | Keeps Prism running in the system tray when the window is closed |
| Start on Login           | `false`              | Automatically opens Prism at OS login                            |
| TTS Voice                | `Aoede`              | Default voice for Text-to-Speech                                 |
| Visual Theme             | `marine`             | App color theme                                                  |
| Gemini API Key           | _(empty)_            | Personal Google AI Studio key (encrypted locally)                |

### Visual Themes

| ID         | Name            | Color Palette                     | Description                                                                          |
| ---------- | --------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `marine`   | **Marine**      | `#13151a` / `#8fb4ff` / `#78e0c2` | Matte blue accent with cool slate tones. **Default.**                                |
| `vertez`   | **Vertez**      | `#161413` / `#ff4e3a` / `#ff9f1c` | Flame orange-red accent with warm charcoal tones. Bold, active, energetic.           |
| `akoustik` | **Akoustik**    | `#12101a` / `#b07aff` / `#e88cff` | Deep violet, moody, atmospheric, synthwave vibes.                                    |
| `terno`    | **Terno**       | `#000000` / `#ffffff` / `#888888` | AMOLED pure black-and-white with elegant serif typography. Retro, high-contrast.     |
| `ursula`   | **Ursula Tree** | `#0a110a` / `#388e3c` / `#c8e6c9` | Leaf green and baby green blend with serif font. Natural, soothing, reading-focused. |
| `rgb`      | **RGB**         | Dynamic                           | Dynamic chroma-shifting theme. **Secret Easter Egg** — see section below.            |

---

## AI-Driven Configuration

The AI has direct access to the `configure_prism` tool to modify app settings without the user opening the Settings screen. Supported parameters:

- `launcherShortcut` — Launcher hotkey
- `screenshotShortcut` — Screenshot hotkey
- `modelSelectionShortcut` — Model picker hotkey
- `defaultModel` — Main model key
- `subagentModel` — Sub-agent model key
- `minimizeToTray` — `"true"` / `"false"`
- `autoLaunch` — `"true"` / `"false"`
- `quickLauncherMode` — `"simple"` / `"advanced"`
- `userGeminiKey` — Gemini API key
- `username` — User display name
- `ttsVoice` — `Aoede`, `Puck`, `Charon`, `Kore`, `Fenrir`
- `theme` — `marine`, `vertez`, `akoustik`, `terno`, `ursula`

> **Note:** The `rgb` theme cannot be set via `configure_prism`. It has a dedicated unlock flow.

---

## Easter Egg: RGB Theme

The **RGB** theme is a secret Easter Egg that activates a dynamic chroma-shifting animation for **2 hours**.

### How to unlock

1. The user must have special access (`isRgbUnlocked: true` in their configuration).
2. Explicitly ask the AI for a "questionnaire", "quiz", "questions game", or similar.
3. The AI administers **4 sequential questions** — each trivially obvious and logically absurd (e.g., "What color was George Washington's white horse?").
4. **The trick:** The user must answer **all 4 questions incorrectly**. Getting any one correct immediately ends the quiz with a playful failure message.
5. Upon failing all 4, the AI automatically invokes `unlock_rgb_theme` and the theme becomes active for 2 hours.

> The existence of the questionnaire, the RGB theme, and the unlock logic are **never voluntarily disclosed by the AI**. It only responds to the topic if the user explicitly asks about it.

---

## Conversation History

- Sessions are automatically saved as JSON files on the local filesystem.
- The sidebar displays all sessions with AI-generated titles (`TITLE_GENERATION_TEMPERATURE: 1.4`).
- **Offline search:** Full-text keyword search across all sessions without requiring a network connection.
- The AI can use `search_chat_history` to reference past conversations as context.
- Sessions can be deleted individually. Deletion also cancels any in-progress execution for that `chatId`.
- Multiple conversations can be active simultaneously — the sidebar indicates which ones are currently running.

---

## Development

### Prerequisites

- Node.js 22+
- npm

### Installation

```bash
npm install
```

### API Key Setup

Create a `.env` file at the project root:

```env
GEMINI_API_KEY=your_key_here
```

Alternatively, enter the key directly in the app Settings (encrypted via `safeStorage`).

### Scripts

| Command               | Description                        |
| --------------------- | ---------------------------------- |
| `npm run dev`         | Start in development mode with HMR |
| `npm run build`       | Compile for production             |
| `npm run build:win`   | Build for Windows                  |
| `npm run build:mac`   | Build for macOS                    |
| `npm run build:linux` | Build for Linux                    |
| `npm run typecheck`   | TypeScript type checking           |
| `npm run lint`        | Lint the codebase                  |

### Project Structure

```
src/
├── main/
│   ├── index.ts          # Main Electron process: windows, IPC, tray, global shortcuts
│   ├── gemini.ts         # AI logic: models, streaming, sub-agents, TTS, transcription
│   ├── systemTools.ts    # Implementation of all computer use tools
│   ├── toolsManifest.ts  # Declarative definition of all tools (schema + metadata)
│   ├── config.ts         # Configuration persistence and validation
│   ├── history.ts        # Chat session management
│   └── updater.ts        # Auto-updater
└── renderer/src/
    ├── App.tsx           # Main UI orchestration
    ├── constants.ts      # Model definitions for the frontend
    └── components/
        ├── InputBar.tsx          # Input bar with slash commands and modes
        ├── QuickLauncher.tsx     # Launcher overlay
        ├── SettingsView.tsx      # Settings screen
        ├── ActionLoader.tsx      # Tool call execution visualization
        ├── MiniAppRenderer.tsx   # Mini-app rendering in sandboxed iframe
        ├── SubagentChat.tsx      # Sub-agent Group Chat window
        ├── ModelSelector.tsx     # Model selector
        ├── ShortcutRecorder.tsx  # Interactive keyboard shortcut recorder
        └── ...
```

### Electron Windows

| Window             | Hash Route           | Dimensions  | Characteristics                                     |
| ------------------ | -------------------- | ----------- | --------------------------------------------------- |
| Main               | _(none)_             | 1200×900    | Non-resizable, hidden title bar                     |
| Quick Launcher     | `#launcher`          | Full screen | Frameless, transparent, always-on-top, skip taskbar |
| Sub-Agents         | `#subagents`         | 400×650     | Hidden title bar                                    |
| Sub-Agent Settings | `#subagent-settings` | 430×560     | Non-resizable, non-maximizable                      |
| Mini-App           | `#mini-app`          | 800×600     | Hidden title bar, per-app content                   |

---

## AI Visual Protocol

The AI follows a strict protocol for choosing the response format:

| User Intent                                                       | Dynamic Interaction Required? | Output Format                       |
| ----------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| Conversational reply, explanations, lists, text analyses          | No                            | **Plain Markdown**                  |
| Explicit visual representation request (cards, dashboard, layout) | No                            | **Rich Markdown (inline HTML/CSS)** |
| Interactive widget (game, calculator, form with logic)            | Yes                           | **Mini-App (`<mini_app>`)**         |

The AI **never** uses HTML/CSS in standard conversational responses, and **never** generates Mini-Apps for static content.
