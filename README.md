<div align="center">

<img src="https://i.imgur.com/CFx555y.png" alt="Prism" width="100%" />

<br />

**One interface. Many capabilities.**

A desktop AI that doesn't just answer — it _acts_.

[![License](https://img.shields.io/badge/License-GPL%20v3.0-6C63FF?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-C084FC?style=flat-square)](#installation)
[![Made with](https://img.shields.io/badge/Powered_by-Prism-F0F0F5?style=flat-square&logo=google&logoColor=white)](#models)

</div>

---

## What is Prism?

Prism is a native desktop AI assistant that runs locally on your machine and has real access to your files, terminal, and system resources. Unlike browser-based AI tools that live in a tab and forget everything the moment you close the window, Prism sits on your operating system and can actually _do things_ on your behalf.

The name reflects the core idea: a single AI interface that **refracts into many different capabilities** depending on what you need.

---

## Highlights

<table>
<tr>
<td width="50%">

### 🔒 &nbsp;Private by design

Your API key lives on your machine. No third-party servers, no cloud sync, no telemetry. Prism only talks to the Gemini API — nothing else.

### ⚡ &nbsp;Action-oriented

Prism doesn't just suggest commands — it runs them. Read files, write code, execute shell commands, open apps, search the web. All from a single conversation.

</td>
<td width="50%">

### 🖥️ &nbsp;Native experience

A real desktop application with a Spotlight-style Quick Launcher (<kbd>Ctrl</kbd>+<kbd>Space</kbd>), system tray integration, and auto-updates. Not a browser wrapper.

### 🧠 &nbsp;Smart fallback

If a model fails mid-response, Prism automatically falls back to the next available model and continues where it left off — seamlessly.

</td>
</tr>
</table>

---

## System Tools

Prism can interact with your computer through a set of built-in tools:

| Tool                  | What it does                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| **Autonomous Agents** | Spawn multiple AI units to coordinate and solve complex tasks in parallel |
| **Terminal**          | Execute shell commands (PowerShell, Bash, etc.)                           |
| **File System**       | Create, read, edit, and delete files and directories                      |
| **Web Reader**        | Fetch and extract clean text content from any URL                         |
| **Web Search**        | Search the web via DuckDuckGo for real-time answers                       |
| **Applications**      | List installed apps and launch them                                       |
| **Browser**           | Open URLs directly in your default browser                                |

All actions are executed from the main process — the API key and OS access never touch the renderer.

---

## Models

Prism exposes its own model family in the app. You can switch models at any time via the UI or the Quick Launcher (<kbd>Ctrl</kbd>+<kbd>M</kbd>).

| Model                  | Underlying Engine        | Best for                                                                                                     |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Prism 6 Dense**      | `gemma-4-31b-it`         | Deep debugging of large codebases, dense information processing, and complex logic.                          |
| **Prism 6 Dragon**     | `gemma-4-26b-a4b-it`     | In-depth research, massive agent orchestration, and information gathering.                                   |
| **Prism 6 Fast**       | `gemini-3.5-flash`       | Complex tasks involving automation, orchestration, and raw code with low latency.                            |
| **Prism 6 Fast-Old**   | `gemini-3-flash-preview` | Speed-focused assistant for simple day-to-day tasks, automation, and orchestration.                          |
| **Prism 6 Super-Fast** | `gemini-3.1-flash-lite`  | **(Default)** Ultra-fast execution and extremely low latency for daily assistance and coding.                |

> **Note:** All models support **Think Mode** (<kbd>Ctrl</kbd>+<kbd>T</kbd>), which elevates their logic and reasoning capabilities on demand using specialized inference budgets.

---

## Installation

### From releases

Download the latest installer from [**Releases**](https://github.com/brnalemusic/Prism/releases):

- **Windows** — `.exe` (NSIS installer)

### From source

```bash
git clone https://github.com/brnalemusic/Prism.git
cd Prism
npm install
```

Create a `.env` file with your Gemini API key:

```
GEMINI_API_KEY=your_key_here
```

Run in development mode:

```bash
npm run dev
```

Build for Windows:

```bash
npm run build:win    # Windows
```

---

## Security

| Concern            | How Prism handles it                                       |
| ------------------ | ---------------------------------------------------------- |
| API key exposure   | Stored in `.env`, only accessed by the main process        |
| Renderer isolation | `contextIsolation: true`, `nodeIntegration: false`         |
| File system access | Operations are AI-driven but visible in the chat log       |
| Shell execution    | Commands are shown to the user in real time                |
| Network calls      | Only to `generativelanguage.googleapis.com` and DuckDuckGo |

---

## Tech Stack

| Layer         | Technology                             |
| ------------- | -------------------------------------- |
| Desktop shell | Electron                               |
| UI            | React + TypeScript + Tailwind CSS      |
| Build tooling | Vite (via electron-vite)               |
| AI backbone   | Prism model family via `@google/genai` |
| Distribution  | electron-builder                       |
| Auto-updates  | electron-updater (GitHub Releases)     |

---

## License

Prism is released under the [GPL-3.0 License](LICENSE).

---

<div align="center">
<sub>

_Design é como o Prism faz você sentir antes de você entender o que ele faz._

</sub>
</div>
