# Core Philosophy of Prism

## 1. Introduction: The Vision of a Harmonious Companion

Prism is built upon a fundamental paradigm shift: artificial intelligence should not be a destination (a webpage you visit when you need help) but a native layer of your daily operating system environment. The traditional interface model of conversational AI relies on vertical web panels that are entirely isolated from the user's active work tools—their IDEs, local file hierarchies, terminal shells, and local network directories.

To bridge this disconnect, Prism is governed by a core philosophy that treats system integration, security, raw speed, agentic autonomy, and aesthetic excellence as equal pillars. This document outlines the seven core tenets that guide every architectural decision, every line of code, and every tool integration within the Prism ecosystem.

---

## 2. Tenet 1: Speed, Fluidity, and Low Latency

In any human-computer interaction model, latency is the ultimate killer of flow. A developer who has to wait even three seconds for an interface to register a command or initialize a chat experience will eventually abandon that tool in favor of standard keyboard inputs. Prism is designed to deliver a near-zero latency experience.

### 2.1. Light, Local IPC
The communication channel between the user’s inputs in the renderer process and the operating system tools in the main process is handled via highly optimized Electron Inter-Process Communication (IPC) bridges. By avoiding overhead-heavy frameworks and utilizing direct serialization of JSON payloads, messages are sent, parsed, validated, and processed in milliseconds.

In the renderer, state updates are carefully batched. React components utilize `useRef` to capture input text during typing, which prevents the main App component from re-rendering on every keypress. State is synchronized only when crucial events occur (e.g. sending a message or triggering a shortcut), maintaining a responsive 60fps frame rate even on low-spec systems.

### 2.2. Stream-First Rendering
When communicating with the Google Gemini API, Prism does not wait for the entire text block to generate. It requests chunked token streams. The React renderer intercepts these streams and updates the DOM incrementally. To prevent layouts from shifting violently, the app uses structural layout containers and optimized typography measurements, keeping the text readable even as it writes at hundreds of characters per second.

Furthermore, we optimize the markdown parsing engine (which relies on `react-markdown`, `remark-gfm`, and `rehype-raw`). Instead of parsing the entire text block from scratch on every token chunk, the parser maintains an internal tree difference map to patch only the newly arrived tokens into the active HTML nodes, minimizing browser layout reflows and reducing CPU cycles during long stream generations.

### 2.3. Fast Initialization
Through the use of Vite compilation and selective module loading, the application starts up in a fraction of a second. Static system assets (like installed application caches) are loaded asynchronously in the background. The Quick Launcher is kept in a suspended, invisible state in memory, allowing it to slide onto the screen instantly when the global hotkey is pressed, without having to spawn a new OS process.

---

## 3. Tenet 2: Local-First and Hybrid Computing (Cloud Brain, Local Body)

We believe that the user's local machine is the primary workspace, and the cloud should only be used as a source of cognitive computation. Prism operates under a "local-first" hybrid model.

### 3.1. Local Storage of Work Data
All critical user data generated during a session—such as chat history logs, customized command workflows, settings config files, and caches of system executables—are written directly to the local disk. There is no external cloud database syncing user conversations or recording workspace paths. This approach offers multiple advantages:
* **Instant Retrieval:** History searches and configuration updates do not require API calls to external database servers, ensuring sub-millisecond retrieval speeds.
* **Offline Access:** Even if the user loses internet connection, they can browse past chats, access their custom workflows, and run local utilities.
* **Data Ownership:** The user has complete control over their transcripts. They can back them up, inspect them, delete them, or sync them to their own private Git repositories.

### 3.2. Local Tool Execution
When Prism performs tasks like refactoring code, compiling a project, or running a browser automation script, it runs these tools directly on the host machine. Instead of uploading code to a cloud environment to compile it, Prism leverages the developer’s local environment, including installed compilers, local environment variables, databases, and local server setups. This hybrid model combines the intelligence of cloud LLMs with the reality of local execution.

Furthermore, a local-first architecture eliminates cloud computing overhead. There is no need to queue for remote sandbox instances or suffer from bandwidth-choked virtual systems. The AI has direct access to the computer's CPU cores, memory channels, and local disk write-speeds, making actions like spawning local testing rigs, reading long log files, and bulk-replacing codeblocks incredibly efficient.

---

## 4. Tenet 4: Absolute Security and Encryption

Empowering an artificial intelligence with the ability to read and write files, open browsers, and execute terminal commands requires a state-of-the-art security model. Prism ensures that credentials and files are guarded with defense-in-depth principles.

### 4.1. OS-Level Credential Protection (`safeStorage`)
API keys are the keys to the castle. If an attacker gains access to a user's API key, they can rack up massive bills or misuse the quota. Prism completely rejects storing API keys in plain text.
* **Electron safeStorage API:** When a user enters their Gemini API key in the System Settings, the main process encrypts it using Electron's `safeStorage` module.
* **Underlying Mechanics (DPAPI):** On Windows, `safeStorage` binds the encryption to the Windows Data Protection API (DPAPI). DPAPI encrypts the data using key material derived from the currently logged-in Windows user account. This means that even if a malicious script runs on the machine and copies the encrypted `prismconfigs.cfg` file, it cannot decrypt the key unless it executes within the security context of the user's specific Windows login session. On macOS, it integrates with Keychain Services, and on Linux, it utilizes libsecret or KWallet.

This cryptographic binding ensures that if a computer is stolen, or if a user's files are backed up to an unencrypted cloud drive, the configuration files remain completely useless to an attacker who does not have access to the active Windows user credentials and hardware security chips (TPM).

### 4.2. Secure Sandbox Boundaries
Terminal command execution is wrapped in a validation layer. Every command goes through a multi-pass security scanner before it is allowed to execute. The system checks for illegal parameters, blocks access to system-critical roots, and rejects destructive commands (see the Sandbox Guide for details).

---

## 5. Tenet 5: Guarded Execution and Informed Consent

A major concern with autonomous AI agents is the "runaway execution" problem—where an AI makes a wrong assumption, deletes files, or executes an infinite loop in the terminal. Prism solves this by implementing **Guarded Execution**.

### 5.1. The Human-in-the-Loop Safeguard
Prism operates under the principle that the AI is an assistant, not an absolute ruler.
* **Consent Popups:** When the AI decides to call a system tool that alters state—such as writing to a file, deleting a directory, or executing a shell command—the application halts execution and displays an explicit authorization prompt to the user.
* **Interactive Reviews:** The user can review the exact command line, the precise file path, or the proposed code changes in a clean diff interface before clicking "Allow" or "Deny".
* **Refined Control:** The user can edit the proposed command or file path directly in the UI prompt, correcting the AI's mistakes before execution occurs.

This matches Breno's vision of "pair programming." The AI is not a silent, hidden black-box agent; it is an active collaborator. When the AI proposes an edit, the user acts as the editor and mentor. This interactive loop prevents the system from generating garbage code or breaking project dependencies, and ensures that the user is always aware of what is changing under the hood.

### 5.2. Non-Disruptive Flow
While security is paramount, it should not become annoying. For safe, read-only tools—such as reading a file, searching Google, or listing directory contents—Prism executes the tools silently without requiring explicit authorization, striking a perfect balance between speed and protection.

---

## 6. Tenet 6: Agentic Background Autonomy

While single-thread conversations are useful for simple Q&A, complex engineering tasks require sustained, parallel effort. Prism implements a background orchestration layer that allows the model to delegate work.

### 6.1. Parallel Swarm Delegation
When a user requests a large task, the main model can invoke the `run_subagents` tool, spawning a swarm of concurrent background workers. These workers run in their own asynchronous promises, executing tools, conducting research, and compiling information in parallel.

This paradigm shifts the AI from a simple calculator to a manager of tasks. For example, if a user wants to audit a project for security vulnerabilities, the main model spawns Subagent A to check dependencies, Subagent B to scan source code for SQL injections, and Subagent C to review the API routing. They work together, splitting the cognitive load and avoiding the single-prompt token limits.

### 6.2. Status-Driven Coordination
The subagents communicate via a group chat interface. Instead of spamming the user's main chat window with detailed research logs, the subagents exchange messages in a specialized background channel. They publish progress updates (`working`, `done`, `error`) and coordinate their findings. Once the subagents finish their individual tasks, the primary model gathers their outputs and synthesizes them into a single, clean markdown response. This background orchestration ensures the user's main thread remains neat and clutter-free.

---

## 7. Tenet 7: Premium Visual Aesthetics and User Experience

Breno Alexandre believes that a tool's design directly affects the cognitive state of the developer using it. A poorly designed, cluttered, or sterile interface leads to friction and fatigue. Prism is designed to look and feel premium, inspiring creativity and focus.

### 7.1. Visual Polish
Prism relies on modern design aesthetics:
* **Glassmorphism:** Leveraging CSS backdrop filters to create semi-transparent surfaces that blur the underlying desktop, giving a feeling of depth and native desktop integration.
* **Radial Ambient Glows:** Subtle, animated glowing backdrops that pulsate when the AI is thinking, taking a screenshot, or executing sandboxed commands.
* **Curated Color Palettes:** Avoiding standard, harsh primary colors in favor of balanced HSL tones (like the slate-blue of `marine` or the deep emerald of `ursula`).

### 7.2. Micro-Animations and Layout Scaling
Interactive elements—such as buttons, selector dropdowns, and sidebar icons—feature smooth, hardware-accelerated CSS transitions. Hovering over a tool card displays subtle glows; sending a message triggers a smooth entry transition; toggling thinking modes expands panels with soft spring-physics layouts.

The styling system has been built on Tailwind CSS v4. By moving away from compiled CSS-in-JS styling engines, the renderer process leverages native CSS custom properties which are compiled using LightningCSS. This ensures layout calculations, animations, and typography rendering are handled directly by the GPU, ensuring buttery-smooth transitions even when resizing the window.

### 7.3. Typography
The default typeface is `Outfit`, loaded via Google Fonts. It is a modern, geometric sans-serif that balances readability with a tech-forward look. For mono-spaced text blocks, Prism uses highly legible fonts like `JetBrains Mono` or `SF Mono` to ensure that code reviews do not strain the eyes.

---

## 8. Tenet 8: Telemetry-Free Privacy

In an era of ubiquitous user tracking and data harvesting, Prism takes a stand for developer privacy.
* **No Telemetry:** There are no analytics libraries (like Google Analytics, Mixpanel, or Amplitude) built into the code. Prism does not track your clicks, your typing speed, or how many times you open the app.
* **Direct Connections:** The application communicates directly with Google's API endpoints. There are no intermediary proxy servers running under Prism's control that inspect, redirect, or log your queries.
* **Zero Logging:** What you type, what the AI replies, and the files you process remain exclusively on your computer, stored in your user configuration directories. Breno Alexandre and third-party networks have zero visibility into your workflows.
* **Transparent Auditing:** Since the application is built on web standards (React/TypeScript), developers can easily inspect the package contents, monitor outgoing network requests using standard developer tools, and verify that no telemetry leaks are occurring.
