# Core Philosophy of Prism

## 1. Introduction: The Vision of a Harmonious Companion

Prism is built upon a fundamental paradigm shift: artificial intelligence should not be a destination (a webpage you visit when you need help) but a native layer of your daily operating system environment. The traditional interface model of conversational AI relies on vertical web panels that are entirely isolated from the user's active work tools—their IDEs, local file hierarchies, terminal shells, and local network directories.

To bridge this disconnect, Prism is governed by a core philosophy that treats system integration, security, raw speed, provider independence, agentic autonomy, and aesthetic excellence as equal pillars. This document outlines the seven core tenets that guide every architectural decision, every line of code, and every tool integration within the Prism ecosystem.

---

## 2. Tenet 1: Speed, Fluidity, and Low Latency

In any human-computer interaction model, latency is the ultimate killer of flow. A developer who has to wait even three seconds for an interface to register a command or initialize a chat experience will eventually abandon that tool in favor of standard keyboard inputs. Prism is designed to deliver a near-zero latency experience.

### 2.1. Light, Local IPC
The communication channel between the user’s inputs in the renderer process and the operating system tools in the main process is handled via highly optimized Electron Inter-Process Communication (IPC) bridges. By avoiding overhead-heavy frameworks and utilizing direct serialization of JSON payloads, messages are sent, parsed, validated, and processed in milliseconds.

In the renderer, state updates are carefully batched. React components utilize `useRef` to capture input text during typing, which prevents the main App component from re-rendering on every keypress. State is synchronized only when crucial events occur (e.g. sending a message or triggering a shortcut), maintaining a responsive 60fps frame rate even on low-spec systems.

### 2.2. Stream-First Rendering
When communicating with AI providers, Prism requests chunked Server-Sent Event (SSE) token streams. The React renderer intercepts these streams and updates the DOM incrementally.

Furthermore, we optimize the markdown parsing engine (which relies on `react-markdown`, `remark-gfm`, `rehype-raw`, `rehype-katex`, `katex`, and `prismjs`). The parser maintains internal tree updates to patch newly arrived tokens into active HTML nodes, minimizing browser layout reflows and reducing CPU cycles during long stream generations.

### 2.3. Fast Initialization
Through Vite compilation and selective module loading, the application starts up in a fraction of a second. Static system assets (like installed application caches) are loaded asynchronously in the background. The Quick Launcher is kept in a suspended, invisible state in memory, allowing it to slide onto the screen instantly when the global hotkey is pressed, without having to spawn a new OS process.

---

## 3. Tenet 2: Open Multi-Provider Freedom & Provider Independence

Prism rejects vendor lock-in. A developer should never be forced to rely on a single AI company or fine-tuned model suite.

### 3.1. Connect Any Model, Cloud or Local
Prism allows users to connect any model provider:
- **Cloud APIs:** Google AI Studio, OpenAI, Anthropic, OpenRouter, NVIDIA NIM, Groq, Cerebras.
- **Local Models:** Local LLM instances running on Ollama, LM Studio, vLLM, or LocalAI via custom Base URL configurations.

### 3.2. Granular Feature Mapping
Different tasks benefit from different model capabilities. Prism allows assigning different models for:
- Main Chat
- Real-time Web Search Grounding
- Quick Launcher queries
- Voice Dictation / STT

---

## 4. Tenet 3: Local-First and Hybrid Computing (Cloud Brain, Local Body)

We believe that the user's local machine is the primary workspace, and cloud endpoints should serve as cognitive compute engines. Prism operates under a "local-first" hybrid model.

### 4.1. Local Storage of Work Data
All critical user data generated during a session—such as chat history logs, customized slash workflows, settings config files, and caches of system executables—are written directly to local disk.
* **Instant Retrieval:** History searches and configuration updates do not require API calls to external database servers.
* **Offline Access:** Users can browse past chats, access custom workflows, and run local utilities offline.
* **Data Ownership:** Transcripts remain entirely under user control on local disk.

### 4.2. Local Tool Execution
When Prism performs tasks like refactoring code, compiling a project, or running a browser automation script, it runs these tools directly on the host machine using local compilers, environment variables, databases, and server setups.

---

## 5. Tenet 4: Absolute Security and Encryption

Empowering an artificial intelligence with the ability to read and write files, open browsers, and execute terminal commands requires a state-of-the-art security model.

### 5.1. OS-Level Credential Protection (`safeStorage`)
API keys are encrypted using Electron's `safeStorage` module. On Windows, it binds encryption to the Windows Data Protection API (DPAPI); on macOS, Keychain Services; on Linux, libsecret/KWallet. Plaintext keys are never stored on disk.

### 5.2. Guarded Command Sandbox
Terminal command execution is wrapped in a safety validation layer (`localCommandSandbox.ts`). Path mutation guards (`assertSafeFileMutationPath`) block destructive operations on system roots, registries, or boot directories.

---

## 6. Tenet 5: Guarded Execution and Informed Consent

Operation is governed by **Guarded Execution**:
* **Consent Popups:** State-altering tool calls (writing files, deleting directories, running terminal commands) halt for explicit user authorization.
* **Interactive Reviews:** Users inspect exact command lines, paths, or code diffs before approving or denying execution.
* **Non-Disruptive Flow:** Safe, read-only tools (reading files, directory listing, searching Google) execute smoothly without interrupting user workflow.

---

## 7. Tenet 6: Direct Tool Autonomy & Single-Agent Execution

For complex multi-file engineering tasks, Prism executes tools directly within the assistant loop:
* **Native Tool Calling:** Executes file operations, Playwright browser interactions, and terminal commands directly.
* **Unified Report Synthesis:** Gathers tool execution outputs, inspects exact logs, and synthesizes structured findings directly for the user.

---

## 8. Tenet 7: Premium Visual Aesthetics and UX

Design directly impacts developer focus and cognitive state:
* **Glassmorphism:** CSS backdrop filters create semi-transparent surfaces blending into the host OS.
* **Curated Themes:** Themes (`marine`, `vertez`, `akoustik`, `terno`, `ursula`, `rgb`) powered by Tailwind v4.
* **Responsive Scaling:** Adjustable interface zoom factor (0.5x to 3.0x).
