# Prism Creator and Origin

## 1. Introduction and Overview

Prism is a state-of-the-art AI-powered desktop companion designed to blur the line between generative intelligence and local operating system control. Born out of frustration with traditional, web-browser-based chatbot interfaces that operate in silos separated from a developer's workspace, Prism was conceptualized as a native application capable of directly interacting with the local filesystem, running terminal commands through a secure sandbox, browsing the web via automated headless browser engines, and executing direct autonomous tool workflows.

Unlike legacy applications locked to a single API provider or fixed model vendor, Prism features a **Multi-Provider & Dynamic Model Architecture**. Users can connect Google AI Studio, OpenAI GPT, Anthropic Claude, OpenRouter, NVIDIA NIM, GroqCloud, Cerebras AI, Puter.js, or any custom OpenAI-compatible / Anthropic-compatible / Responses API-compatible endpoint (including local LLM setups like Ollama or LM Studio).

---

## 2. The Creator: Breno Alexandre (@brnalemusic)

Prism is the brainchild of Breno Alexandrē, known in open-source and developer communities as `@brnalemusic`. Breno's background combines software engineering, systems architecture, and audio engineering/music production. This interdisciplinary foundation profoundly shaped the design philosophy of Prism. Breno recognized that in music production, a digital audio workstation (DAW) coordinates multiple specialized tracks, plugins, inputs, and routing lines through a centralized console to produce a cohesive acoustic output. He wanted to apply this exact concept to artificial intelligence.

In Breno's view, a singular Large Language Model is like a single musical instrument. It is powerful, but to solve complex real-world tasks, it must be part of an orchestra. Thus, the idea of "Prism" was born: a system where a central coordinator routing intelligence (the main chat process) orchestrates multiple tools and capabilities (like browser automation, terminal sandboxes, file utilities, and interactive mini-apps) to deliver a unified, high-value result.

Working as an independent developer, Breno spent countles hours designing and coding the core engines of Prism, ensuring that it was highly optimized for latency, clean interfaces, and robust security. His dual passion for aesthetic excellence and functional speed drove the integration of advanced styling systems, custom typography, micro-animations, and immediate keyboard-driven navigation.

---

## 3. The Metaphor of the Prism

The name "Prism" is a deliberate reference to the optical device that splits white light into a spectrum of vibrant colors. In the context of the application, "white light" represents the user's raw, singular input request (e.g., "Refactor my project's database layer and verify it by running tests"). 

When this request enters the Prism engine, the application acts as a refractive medium:
1. **Refraction:** The unified user prompt is analyzed and broken down into its technical requirements.
2. **Dispersion:** The request is split into multiple parallel execution tracks:
   * **Autonomous Reasoning (Red Wave):** Parsing reasoning streams and executing multi-step tool calls.
   * **Local Sandbox Executions (Orange Wave):** Running localized compilation or testing commands safely inside a guarded process shell.
   * **Browser Automation (Green/Blue Wave):** Launching persistent Playwright sessions to scrape documentation, search Google, or download dependencies.
   * **File Read/Write Operations (Violet Wave):** Modifying files, patching codeblocks, and maintaining strict workspace directories.
3. **Recombination:** The spectrum of outputs is gathered, analyzed, and synthesized by the primary LLM to present a single, high-fidelity response back to the user.

This optical metaphor runs deep within the application's identity, influencing everything from the theme colors (such as the default `marine` and the hidden `rgb` Easter egg theme) to the layout of the launcher's border glows, which ripple with a refractive light effect whenever active operations are executing.

---

## 4. Detailed Version History and Technological Evolution

### 4.1. Version 1.x: The CLI Prototype (v1.0.0 - v1.5.0)
The earliest iterations of Prism were written entirely in Python as a Command Line Interface (CLI) tool. The goal was to test whether a local LLM prompt could safely decide when to execute a shell command versus when to return a text response. 
* **Core Tech:** Python, basic system commands via `subprocess`, raw API calls to LLM endpoints.

### 4.2. Version 2.x: Transition to Electron and React (v2.0.0 - v2.8.0)
To make the application accessible and visually appealing, Breno rewrote the application from scratch using Electron.
* **Core Tech:** Electron, React, Webpack, Tailwind CSS v3.
* **Key Introductions:** The birth of the **Quick Launcher**, a global hotkey-activated window that slid into view for quick prompts.

### 4.3. Version 3.x: Subagents and Guarded Sandboxing (v3.0.0 - v3.9.0)
With the 3.x series, Prism shifted from a simple helper to a true agentic platform.
* **Core Tech:** TypeScript migration, Vite build system, Playwright headless browser integration, raw child_process sandboxing.
* **Orchestration:** Introduction of the `run_subagents` tool for parallel background workers.

### 4.4. Version 7.0.1: The Multi-Provider Open Era (Current)
Prism 7.0.1 brings complete provider independence and ultimate flexibility:
* **Multi-Provider AI Core:** Supports Google AI Studio, OpenAI, Anthropic Claude, OpenRouter, NVIDIA NIM, GroqCloud, Cerebras AI, Puter.js, or any custom base URL.
* **Completion Paradigms:** Native support for `chat_completions`, OpenAI `responses`, and Anthropic `/messages` APIs.
* **Dynamic Model Discovery:** Queries endpoints `/models` or `/openai/models` to discover and configure available models dynamically.
* **Thinking & Reasoning Integration:** Real-time reasoning stream parsing and Google Gemini `thought_signature` state handling.
* **Tailwind CSS v4 & LightningCSS:** Modern styling engine with dynamic CSS theme switching and custom zoom factor controls.
* **Playwright Browser Automation:** Persistent browser context with CDPSession download tracking.
* **Guarded Local Command Sandbox:** File mutation assertions (`assertSafeFileMutationPath`) and configurable terminal shells (`powershell.exe`, `cmd.exe`, `pwsh.exe`).
* **Custom Slash Workflows & Mini-Apps:** User-defined workflows (`save_workflow`) and AI-authored web widgets (`create_mini_app`).

---

## 5. Architectural Design and Process Separation

Prism is built upon Electron's multi-process architecture:

```
       +---------------------------------------------+
       |                 Main Process                |
       |             (src/main/index.ts)             |
       |  - Window Management (Main & Launcher)      |
       |  - Global Shortcuts (Ctrl+Space, etc.)      |
       |  - Guarded Command Sandbox & Local Tools    |
       |  - Playwright Browser Session Management    |
       |  - Multi-Provider AI Engine (src/main/ai/)  |
       +----------------------^----------------------+
                              |
                     IPC Bridge (Secure)
                              |
       +----------------------v----------------------+
       |                Preload Script               |
       |            (src/preload/index.ts)           |
       |  - contextBridge.exposeInMainWorld()        |
       |  - Secure window.api Method Exposition       |
       +----------------------^----------------------+
                              |
                Renderer-to-Preload Calls
                              |
       +----------------------v----------------------+
       |               Renderer Process              |
       |            (src/renderer/index.html)        |
       |  - React Application (src/renderer/src/)   |
       |  - State Management & Views (App.tsx)       |
       |  - Tailwind CSS v4 Themes & Styles          |
       |  - User Input & Textarea Key Interceptors   |
       +---------------------------------------------+
```

### 5.1. The Main Process (`src/main/`)
The Main Process runs in Node.js with full host access:
* **Window Lifecycle:** Manages `mainWindow` and transparent `launcherWindow`.
* **Multi-Provider AI Dispatcher (`src/main/ai/`):** Handles stream connections (`openaiClient.ts`), provider list management (`providerManager.ts`), model discovery, and trusted registries (`trustedRegistry.ts`).
* **API Key Encryption:** Encrypts provider keys using Electron's `safeStorage` module before persisting to config.
* **Tool Execution:** Implements local file tools, command sandbox, and Playwright browser actions.

### 5.2. The Preload Script (`src/preload/`)
Acts as a security bridge, exposing safe IPC wrappers via `window.api` without leaking raw Node APIs to renderer scripts.

### 5.3. The Renderer Process (`src/renderer/`)
React UI compiled via Vite with hot module replacement in development. Uses hash routing (`#main` or `#launcher`) for window state rendering.

---

## 6. Build and Packaging Pipeline

Built using `electron-builder`:
* **Dev Server:** `npm run dev` (Electron + Vite HMR).
* **Typecheck:** `npm run typecheck` (tsc node + web targets).
* **Production Build:** `npm run build:win` (Windows NSIS / portable installer).
* **Demo Build:** `npm run build:demo` (Isolated demo variant).
