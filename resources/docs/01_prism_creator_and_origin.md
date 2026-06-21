# Prism Creator and Origin

## 1. Introduction and Overview

Prism is a state-of-the-art AI-powered desktop companion designed to blur the line between generative intelligence and local operating system control. Born out of a frustration with traditional, web-browser-based chatbot interfaces that operate in silos separated from a developer's workspace, Prism was conceptualized as a native application capable of directly interacting with the local filesystem, running terminal commands through a secure sandbox, browsing the web via automated headless browser engines, and coordinating teams of specialized AI subagents.

Unlike typical wrappers that simply stream text, Prism is engineered as an active agentic coordinator. It parses user intent, matches it against a rich inventory of local and network tools, and executes complex tasks with high autonomy—always maintaining a strict layer of user consent. The application sits natively on the user's desktop, responding instantly to keyboard commands, running background automation scripts, and serving as a frictionless bridge between cognitive LLM models and local execution environments.

---

## 2. The Creator: Breno Alexandre (@brnalemusic)

Prism is the brainchild of Breno Alexandre, known in the open-source and developer communities as `@brnalemusic`. Breno's unique background combines software engineering, systems architecture, and audio engineering/music production. This interdisciplinary foundation profoundly shaped the design philosophy of Prism. Breno recognized that in music production, a digital audio workstation (DAW) coordinates multiple specialized tracks, plugins, inputs, and routing lines through a centralized console to produce a cohesive acoustic output. He wanted to apply this exact concept to artificial intelligence.

In Breno's view, a singular Large Language Model is like a single musical instrument. It is powerful, but to solve complex real-world tasks, it must be part of an orchestra. Thus, the idea of "Prism" was born: a system where a central coordinator routing intelligence (the main chat process) orchestrates multiple specialized tracks (subagents) and effects units (tools like browser automation, terminal sandboxes, and file utilities) to deliver a unified, high-value result.

Working as an independent developer, Breno spent countles hours designing and coding the core engines of Prism, ensuring that it was highly optimized for latency, clean interfaces, and robust security. His dual passion for aesthetic excellence and functional speed drove the integration of advanced styling systems, custom typography, micro-animations, and immediate keyboard-driven navigation, creating an experience that feels premium and state-of-the-art.

---

## 3. The Metaphor of the Prism

The name "Prism" is a deliberate reference to the optical device that splits white light into a spectrum of vibrant colors. In the context of the application, "white light" represents the user's raw, singular input request (e.g., "Refactor my project's database layer and verify it by running tests"). 

When this request enters the Prism engine, the application acts as a refractive medium:
1. **Refraction:** The unified user prompt is analyzed and broken down into its constituent technical requirements.
2. **Dispersion:** The request is split into multiple parallel execution tracks:
   * **Subagent Swarms (Red Wave):** Spawning specialized agents to handle isolated research or code generation tasks concurrently.
   * **Local Sandbox Executions (Orange Wave):** Running localized compilation or testing commands safely inside a guarded process shell.
   * **Browser Automation (Green/Blue Wave):** Launching persistent Playwright sessions to scrape documentation, search Google, or download dependencies.
   * **File Read/Write Operations (Violet Wave):** Modifying files, patching codeblocks, and maintaining strict workspace directories.
3. **Recombination:** The spectrum of outputs is gathered, analyzed, and synthesized by the primary LLM to present a single, high-fidelity response back to the user.

This optical metaphor runs deep within the application's identity, influencing everything from the theme colors (such as the default `marine` and the hidden `rgb` Easter egg theme) to the layout of the launcher's border glows, which ripple with a refractive light effect whenever active operations are executing.

---

## 4. Detailed Version History and Technological Evolution

### 4.1. Version 1.x: The CLI Prototype (v1.0.0 - v1.5.0)
The earliest iterations of Prism were written entirely in Python as a Command Line Interface (CLI) tool. The goal was simply to test whether a local LLM prompt could safely decide when to execute a shell command versus when to return a text response. 
* **Core Tech:** Python, basic system commands via `subprocess`, raw API calls to Google's Gemini models using HTTP requests.
* **Limitations:** The lack of a graphical interface meant that users had to constantly look at a terminal window. Command execution was highly risky as there was no structured sandbox or regex filtering. Multi-agent execution was blocked by Python's single-threaded nature and lack of intuitive event-driven architectures.

### 4.2. Version 2.x: Transition to Electron and React (v2.0.0 - v2.8.0)
To make the application accessible and visually appealing, Breno made the strategic decision to rewrite the application from scratch using Electron. This transition unlocked the power of HTML5, CSS3, and JavaScript, allowing the creation of a beautiful desktop overlay window.
* **Core Tech:** Electron, React, Webpack, Tailwind CSS v3, Node-PTY for terminal emulation.
* **Key Introductions:** This version marked the birth of the **Quick Launcher**, a global hotkey-activated window that slid into view, allowing the user to issue quick prompts without leaving their active coding screen.
* **Refinement:** The system tools were modularized, separating file operations from terminal commands. Basic command checks were added, but they relied on naive string containment filters that were easily bypassed.

### 4.3. Version 3.x: Subagents and Guarded Sandboxing (v3.0.0 - v3.9.0)
With the launch of the 3.x series, Prism shifted from a simple helper to a true agentic platform. The emphasis was placed heavily on background execution and safety.
* **Core Tech:** TypeScript migration, Vite build system integration for faster development compilation, Playwright headless browser integration, and raw child_process sandboxing.
* **Orchestration:** The introduction of the `run_subagents` tool allowed the main model to spawn background workers that communicated via an IPC bus. This allowed the system to solve complex coding tasks in parallel.
* **Security:** A major rewrite of the sandbox engine introduced protected system paths and broad recursive deletion checks to prevent accidental system damage.

### 4.4. Version 4.0.0: The Modern Era (Current)
Prism 4.0.0 represents the culmination of Breno's vision, bringing unprecedented speed, safety, and visual polish.
* **Core Tech:**
  * **Google Gen AI SDK:** Upgraded to the official `@google/genai` library (v2.5.0+), leveraging the latest API capabilities such as structured outputs, thinking/reasoning model parameters, and high-fidelity native media ingestion.
  * **Tailwind CSS v4:** Rebuilt the entire styling framework around Tailwind v4, utilizing CSS variables, lightningcss compilation, and dynamic custom themes.
  * **Vite-Electron Config:** Integrated `electron-vite` to maintain a strict, fast, and separated compilation pipeline for the main process, preload script, and renderer web views.
  * **Playwright Persistent Sessions:** Upgraded browser automation to maintain stateful, persistent browser contexts, allowing the AI to log into local developer portals or test suites.
  * **Advanced Sandbox Rules:** Implemented the strict, regex-based rules engine in `localCommandSandbox.ts`, guarding critical paths and locking down registry, boot, and Windows service mutations.
  * **Easter Egg Customizations:** Introduced the temporary `rgb` theme unlocked via an interactive quiz.

---

## 5. Architectural Design and Process Separation

Prism is built upon Electron's multi-process architecture. Understanding how these processes interact is critical for developers contributing to the codebase.

```
       +---------------------------------------------+
       |                 Main Process                |
       |             (src/main/index.ts)             |
       |  - Window Management (Main & Launcher)      |
       |  - Native Global Shortcuts (Ctrl+Space)     |
       |  - Guarded Command Sandbox                  |
       |  - Playwright Browser Session Management    |
       |  - Gemini API Client (@google/genai)        |
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
The Main Process acts as the operating system gateway. It runs in a Node.js environment with full access to the machine's resources, files, and processes. It is responsible for:
* **Window Lifecycle:** Creating and managing the two primary browser windows: the standard `mainWindow` (which houses the full React workspace, chat history, settings panel, and subagent views) and the `launcherWindow` (a transparent, screen-sized window used for quick overlays).
* **Global Shortcut Registration:** Calling Electron's `globalShortcut` module to bind the Launcher overlay and screenshot utilities directly to the operating system level, capturing keystrokes even when the app is minimized.
* **API Key Encryption:** Interfacing with Electron's `safeStorage` API to encrypt and decrypt the user's Gemini API key before writing it to or reading it from `prismconfigs.cfg` on disk. This prevents unauthorized third-party processes from extracting API credentials.
* **Tool Execution:** Implementing the actual logic for file manipulations (`fs`), command execution (`child_process`), and browser control (`playwright`).

### 5.2. The Preload Script (`src/preload/`)
The Preload Script acts as a security firewall. It executes in a privileged environment with access to Node.js APIs, but runs in the same context as the Renderer process. 
* **Context Isolation:** By using Electron's `contextBridge` and `webFrame`, the preload script ensures that the Renderer process cannot directly call powerful Node modules like `child_process` or `fs`.
* **API Exposition:** It exposes a limited, secure set of IPC methods under `window.api`. For instance, instead of letting the renderer execute a command, it exposes `window.api.runCommand(cmd)`, which passes the command string to the Main process to be scrutinized by the sandbox before execution.

### 5.3. The Renderer Process (`src/renderer/`)
The Renderer Process handles the user interface. It is a standard web application compiled by Vite and rendered inside Electron's Chromium container.
* **Vite Dev Server:** During development, the renderer connects to `http://localhost:5173` with full Hot Module Replacement (HMR) support. In production, it loads files from `out/renderer/index.html`.
* **React State & Styling:** The application state (active chat messages, selected theme, config options, open modals) is managed using React hooks (`useState`, `useEffect`, `useRef`). Layouts are styled using Tailwind CSS v4 directives.
* **Hash Routing:** The application uses URL hashes to determine which view to load. When loading `index.html#launcher`, the renderer displays the compact Quick Launcher interface. When loading `index.html#main` (or no hash), it loads the standard multi-pane chat workspace.

---

## 6. Build and Packaging Pipeline

Prism relies on `electron-builder` to compile, package, and distribute installers for different operating systems.

### 6.1. Development Workflow
To launch the developer workspace:
1. Run `npm install` to download dependencies.
2. Run `npm run dev` to start the concurrent Electron-Vite compilation server.
3. Code changes in `src/renderer/` will trigger instant hot reloads in the Chromium view. Changes in `src/main/` or `src/preload/` will trigger a quick restart of the Electron main process.

### 6.2. Configuration: `electron-builder.yml`
Packaging settings are stored in `electron-builder.yml`. This file defines:
* **Product Name:** `Prism`
* **App ID:** `com.brnalemusic.prism`
* **Directories:** Output folders and build resource paths.
* **Files Configuration:** Specifies which compiled JS/CSS files and static assets (like icons, sound effects, and default documentation) should be bundled into the final package.
* **Windows Target (`win`):** Configures target formats such as `nsis` (Nullsoft Scriptable Install System) installers and portable executables. It also sets up code signing parameters and auto-update mechanisms using `electron-updater`.
* **Mac/Linux Target:** Provides platform-specific build configurations (DMG, AppImage, deb, rpm) to ensure cross-platform compatibility.

---

## 7. Future Roadmap and Vision

Under Breno Alexandre's leadership, the long-term vision for Prism is to build the ultimate, zero-latency desktop operating system assistant. Future milestones include:

### 7.1. Semantic Memory and Local Vector Database
Currently, chat history is saved as JSON files in `history.ts`. The roadmap includes embedding a lightweight, local vector database (like SQLite with vector extensions) directly inside the main process. This will enable Prism to:
* Automatically index files in the active workspace.
* Maintain a persistent "semantic memory" of past conversations across sessions.
* Instantly retrieve relevant context snippets to attach to user queries without inflating context tokens.

### 7.2. Native OS Voice Hooks and Multimodal Input
Future iterations of the Quick Launcher will support full voice control. The application will leverage low-latency Web Audio APIs in the renderer and advanced multimodal streaming in the Gemini API. Users will be able to speak commands directly, and Prism will stream the audio, capture the screen, and execute local tools in real time.

### 7.3. Extensible AI Workflow System
While v4.0.0 introduces customizable Slash Workflows, they are configured via raw settings strings. The next major upgrade will feature a visual workflow builder. Developers will be able to chain system commands, browser scraper actions, subagent spawns, and file edits into complex, flowchart-like automation macros that can be triggered by custom hotkeys or voice prompts.

### 7.4. Extended Local Tool Sandboxing
To further bolster security, the command sandbox will migrate toward containerized execution environments. On Windows, this may involve spawning process commands inside isolated Windows Sandboxes (using lightweight virtualization) or running Linux commands inside secure Docker containers, providing absolute protection for host filesystems while maintaining high tool utility.
