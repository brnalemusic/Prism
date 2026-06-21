# Prism Demo Build Variant

## 1. Architectural Philosophy and Target Goals

The standard production version of Prism operates as an agentic desktop coordinator. It demands a private Google Gemini API key to query language models and relies on direct OS access to perform terminal commands, inspect system logs, read file paths, and execute browser scripts through Playwright. While this local-first power is ideal for developers seeking a local companion, it can present onboarding friction for users who are hesitant to immediately supply API credentials or grant raw shell execution rights.

To address this initial friction, Breno Alexandre architected the **Prism Demo Variant**. Configured and packaged using the compilation flag `DEMO_MODE=true`, the Demo Variant provides a self-contained, keyless, and offline-capable showcase environment. It replicates the entire high-fidelity desktop workspace of Prism—including visual themes, keyboard layouts, chat feeds, collapsible subagent reasoning accordions, terminal logs, and system dashboards—but replaces actual live API streams and destructive system commands with a time-based **Interactive Playback Engine**.

### 1.1. Key Design Goals
* **Frictionless Onboarding:** Prospective users can instantly run the application without pasting a Gemini API key or configuring local configuration pathways.
* **Security Sandboxing:** The demo runs in an isolated mode where the execution of active shell write utilities is mocked. No local files can be deleted or overwritten, and no network requests are dispatched to LLM endpoints.
* **High-Fidelity Showcase:** Users can interact with five curated simulation scenarios representing real-world programming, system operations, research, and workspace setup tasks.
* **Direct Path to Upgrade:** Includes an embedded installer unpacking and installation wizard that checks dependencies (Git, Node.js, Playwright) and installs the full-featured, live desktop edition of Prism seamlessly.

---

## 2. Build Configurations and Packaging Pipeline

The Prism Demo Variant is built from the same unified monorepo as the standard desktop app. The build system uses environment injections, build-time constant definition flags, and customized bundler configurations to compile the standalone demo installer.

### 2.1. Bundler Injection
During compilation, Vite references the `DEMO_MODE` environment variable inside [electron.vite.config.ts](../../electron.vite.config.ts) to define a global compilation constant:
```typescript
const IS_DEMO = process.env.DEMO_MODE === 'true'

// Inside Vite configuration:
define: {
  __DEMO_MODE__: JSON.stringify(IS_DEMO)
}
```
In the shared codebase, [demo.ts](../../src/shared/demo.ts) declares the runtime flag [IS_DEMO](../../src/shared/demo.ts#L12):
```typescript
export const IS_DEMO: boolean = __DEMO_MODE__ === true
```
This flag is imported by the Main and Renderer processes to conditionally disable security hooks, change local configuration storage directories, and redirect app initialization.

### 2.2. Package Scripts and Build Hooks
The workspace [package.json](../../package.json) contains scripts to compile the demo variant:
* **`npm run dev:demo`:** Launches Vite in hot-reloading development mode with `DEMO_MODE=true`, enabling developers to debug demo components in real-time.
* **`npm run build:demo`:** Invokes the custom script [build-demo.js](../../scripts/build-demo.js). This script sets `process.env.DEMO_MODE = 'true'` and executes the bundler, outputting packaged files.
* **`electron-builder.demo.js`:** A specialized builder file [electron-builder.demo.js](../../electron-builder.demo.js) is used to package the demo installer. It changes the target product name to `Prism Demo`, defines unique folder configurations, and points shortcuts to the demo executable.

### 2.3. System and Shell Exclusions in Demo Mode
To ensure the sandbox remains secure and non-intrusive, the main process implements several runtime exclusions when [IS_DEMO](../../src/shared/demo.ts#L12) is true:
1. **Shortcut Interception Bypass:** The global hotkey hooks (`globalShortcut.register`) are disabled. The application will not register shortcuts like `Ctrl+Space` globally, preventing conflict with other apps while running.
2. **Auto-Updater Disablement:** The auto-updater modules do not check GitHub releases or prompt updates, keeping the showcase locked to its stable release version.
3. **Tray and Window Behavior:** The system tray integration is disabled. Clicking the window close button terminates the application normally, instead of minimizing it to the background tray.
4. **Cache Directory Isolation:** Local configurations, themes, and mock chats are written to a folder named `PrismDemo` rather than `PrismDesktop`, ensuring settings from the showcase do not interfere with the production version.

---

## 3. Interactive Playback Engine & Time-based Simulation

Instead of using a live connection to Gemini API, the Demo Variant feeds timeline-driven events into the UI using a lightweight scheduler.

### 3.1. The Simulation Type Defs
The conversation models are defined in [demo.ts](../../src/shared/demo.ts):

* **[DemoEvent](../../src/shared/demo.ts#L23-L37):** Represents a single action in the simulation timeline, triggered at a specific millisecond offset (`at`):
  ```typescript
  export type DemoEvent =
    | { kind: 'user_message'; text: string; at: number }
    | { kind: 'tool_start'; tool: string; toolType: 'task' | 'search' | 'mini-app'; label: string; at: number }
    | { kind: 'tool_update'; text: string; at: number }
    | { kind: 'tool_end'; at: number }
    | { kind: 'thinking_chunk'; text: string; at: number }
    | { kind: 'answer_chunk'; text: string; at: number }
    | { kind: 'done'; at: number }
  ```
* **[DemoScript](../../src/shared/demo.ts#L39-L49):** The container for an interactive showcase scenario:
  ```typescript
  export interface DemoScript {
    id: string
    trigger: string
    subtitle: string
    category: string
    events: DemoEvent[]
  }
  ```

### 3.2. Playback Loop Scheduler
The playback controller, defined in [playback.ts](../../src/renderer/src/demo/playback.ts), parses a scenario's events list, orders them chronologically, and schedules them using standard timeout blocks:

```typescript
export function playDemoScript(
  script: DemoScript,
  onEvent: (event: DemoEvent) => void,
  onDone?: () => void
): DemoPlaybackController {
  const sortedEvents = [...script.events].sort((a, b) => a.at - b.at)
  const timers: number[] = []
  const duration = sortedEvents.reduce((max, event) => Math.max(max, event.at), 0)

  for (const event of sortedEvents) {
    timers.push(
      window.setTimeout(() => {
        onEvent(event)
        if (event.kind === 'done') {
          onDone?.()
        }
      }, event.at)
    )
  }

  if (!sortedEvents.some((event) => event.kind === 'done')) {
    timers.push(window.setTimeout(() => onDone?.(), duration + 100))
  }

  return {
    duration,
    stop: () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }
}
```

### 3.3. Text-chunking Streaming Engine
To simulate the typewriter streaming effect of a live LLM, the utility [utils.ts](../../src/renderer/src/demo/scripts/utils.ts) contains [answerChunks](../../src/renderer/src/demo/scripts/utils.ts#L3). This function splits the simulated text response into segments of varying lengths and assigns them incremental millisecond delays:

```typescript
export function answerChunks(
  text: string,
  startAt: number,
  interval = 46,
  maxChars = 36
): DemoEvent[] {
  const chunks: DemoEvent[] = []
  let cursor = 0

  const originalChunksCount = Math.ceil(text.length / maxChars)
  const totalTime = originalChunksCount * interval

  const targetInterval = 12
  let subInterval = targetInterval
  let subChunkSize = Math.max(1, Math.round((subInterval / interval) * maxChars))

  if (subChunkSize < 2) {
    subChunkSize = 2
    const totalSubChunks = Math.ceil(text.length / subChunkSize)
    subInterval = totalSubChunks > 0 ? totalTime / totalSubChunks : interval
  } else if (subChunkSize > 8) {
    subChunkSize = 8
    const totalSubChunks = Math.ceil(text.length / subChunkSize)
    subInterval = totalSubChunks > 0 ? totalTime / totalSubChunks : interval
  }

  if (subInterval < 4) {
    subInterval = 4
    const totalSubChunks = Math.ceil(text.length / subChunkSize)
    subChunkSize = totalSubChunks > 0 ? Math.max(1, Math.round(text.length / (totalTime / 4))) : 4
  }

  let timeAccumulator = startAt
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + subChunkSize)
    chunks.push({
      kind: 'answer_chunk',
      text: text.slice(cursor, end),
      at: Math.round(timeAccumulator)
    })
    cursor = end
    timeAccumulator += subInterval
  }

  return chunks
}
```
This helper allows the interface to dynamically simulate text generation, creating a realistic typing feel without blocky transitions.

---

## 4. The Five Pre-Configured Showcase Scenarios

Prism Demo comes preloaded with five scenarios designed to demonstrate different facets of the application's agentic tools. These scenarios are aggregated in [index.ts](../../src/renderer/src/demo/scripts/index.ts).

```
   +-------------------------------------------------------+
   |                       DemoHome                        |
   |                                                       |
   |   [Trip to Japan]           [System latency check]    |
   |   (Research & Grounds)      (System diagnostics)      |
   |                                                       |
   |   [Downloads Cleanup]       [Git Status]              |
   |   (Filesystem actions)      (Coding & repository)     |
   |                                                       |
   |               [Focus Workspace setup]                 |
   |               (Desktop layout control)                |
   +-------------------------------------------------------+
```

### 4.1. 10-Day Trip to Japan (Research)
* **Script File:** [tripJapan.ts](../../src/renderer/src/demo/scripts/tripJapan.ts)
* **Trigger Prompt:** `"I am planning a 10-day trip to Japan. Can you research a sample itinerary?"`
* **Features Demonstrated:** Real-time Web Search grounding (`web_search` tool card) and custom HTML layouts.
* **Simulation Flow:** The AI calls `web_search`, displays simulated queries, and streams a detailed travel plan. It renders tables, travel routes (Tokyo-Kyoto-Osaka), interactive map pointers, and structured travel cards in a custom CSS grid.

### 4.2. Latency Config for Music Production (System Tools)
* **Script File:** [musicLaptop.ts](../../src/renderer/src/demo/scripts/musicLaptop.ts)
* **Trigger Prompt:** `"Check my system audio settings and configure them for music production latency."`
* **Features Demonstrated:** System terminal interaction and system telemetry display.
* **Simulation Flow:** The AI runs CLI tasks querying installed ASIO drivers, sample rates, and thread scheduling. It presents a real-time system latency bar chart and walks the user through tuning latency settings.

### 4.3. Downloads Folder Cleanup (Automation)
* **Script File:** [downloadsCleanup.ts](../../src/renderer/src/demo/scripts/downloadsCleanup.ts)
* **Trigger Prompt:** `"Scan my Downloads folder and group files by category."`
* **Features Demonstrated:** Sandbox-safe filesystem operations.
* **Simulation Flow:** The AI invokes `computer_use_list_directory` to examine the mock directory. It identifies untidy archives, images, and documents, then calls `computer_use_move_file` to organize them into subfolders, showing how file organization can be automated safely.

### 4.4. Repo Git Status (Coding)
* **Script File:** [gitStatus.ts](../../src/renderer/src/demo/scripts/gitStatus.ts)
* **Trigger Prompt:** `"Gimme the Git status of this folder."`
* **Features Demonstrated:** Git repository awareness and dev command compilation.
* **Simulation Flow:** The AI runs `git status --short`. It highlights modified files (renderer UI components, main IPC handlers) and newly added demo scripts, then drafts a git commit message (`feat: add demo installer overlay`) and outlines testing recommendations before committing.

### 4.5. Focus Workspace Setup (Productivity)
* **Script File:** [focusWorkspace.ts](../../src/renderer/src/demo/scripts/focusWorkspace.ts)
* **Trigger Prompt:** `"Set up a clean developer focus workspace."`
* **Features Demonstrated:** Workspace orchestration and theme changing.
* **Simulation Flow:** The AI closes background tasks, shifts the user interface theme to `ursula` (deep forest dark mode), launches the developer workspace configuration, and starts a local audio loop, illustrating workspace orchestration.

---

## 5. UI Architecture and Layout Components

When running under [IS_DEMO](../../src/shared/demo.ts#L12) = true, the React front-end (in [DemoApp.tsx](../../src/renderer/src/components/demo/DemoApp.tsx)) routes page rendering through dedicated showcase modules:

### 5.1. DemoHome
* **File Link:** [DemoHome.tsx](../../src/renderer/src/components/demo/DemoHome.tsx)
* **Purpose:** Serves as the landing dashboard for the demo.
* **Visual Elements:**
  * Displays a greetings header ("Hello, User. What are we working on?") featuring a radial glow theme backdrop.
  * A 2-column layout grid displaying cards for each of the five scenarios.
  * Hover micro-animations that lift the cards and display scenario subtitles.
  * A dedicated header bar containing the "Download Prism" upgrade button.

### 5.2. DemoChatView
* **File Link:** [DemoChatView.tsx](../../src/renderer/src/components/demo/DemoChatView.tsx)
* **Purpose:** Renders the simulated conversation thread and controls the playback timeline.
* **Key Mechanics:**
  * Starts the simulation using [playDemoScript](../../src/renderer/src/demo/playback.ts#L8) when a user clicks a scenario.
  * Intercepts keystrokes in the mock chat textarea, redirecting user input to launch the appropriate scripted playback.
  * Displays a persistent warning banner: "Running in Demo Mode. Get the full desktop version to execute actual commands on your machine."
  * Manages active simulation states, including rendering markdown outputs, faking tool card states (e.g. loading, success), and appending streaming text tokens.

### 5.3. CliTerminalDemo
* **File Link:** [CliTerminalDemo.tsx](../../src/renderer/src/components/demo/CliTerminalDemo.tsx)
* **Purpose:** Renders an animated terminal command block.
* **Key Mechanics:**
  * Uses a typewriter hook to cycle through simulated command inputs (e.g. `prism "Open FL Studio"`, `prism "Find the biggest files in Downloads"`).
  * Animates a flashing caret next to the commands and prints corresponding terminal output logs.
  * Provides a visual reference for how users can interface with Prism using the terminal.

### 5.4. Carousel
* **File Link:** [Carousel.tsx](../../src/renderer/src/components/demo/Carousel.tsx)
* **Purpose:** Rotates slide summaries and preview screenshots in the installation overlay.
* **Key Mechanics:**
  * Imports screenshots dynamically using Vite's `import.meta.glob`:
    ```typescript
    const imageModules = import.meta.glob<string>(
      '../../assets/install/examples/*.{png,jpg,jpeg,webp}',
      { eager: true, import: 'default' }
    )
    ```
  * Slides rotate every 4 seconds. If assets are not loaded, it falls back to styled typography slides summarizing core features (Scripted Chat, Desktop Actions, PrismCLI).

### 5.5. LicenseView
* **File Link:** [LicenseView.tsx](../../src/renderer/src/components/demo/LicenseView.tsx)
* **Purpose:** Displays the GPL-3.0 copyleft terms of the Prism project.
* **Key Mechanics:**
  * Reads the LICENSE text file dynamically at build time using the Vite raw import system:
    ```typescript
    import licenseText from '../../../../../LICENSE?raw'
    ```
  * Renders the text in a collapsible `<details>` panel.
  * Disables the "Install Prism" action button in the wizard until the user checks the "I accept the license terms" checkbox.

### 5.6. InstallOverlay
* **File Link:** [InstallOverlay.tsx](../../src/renderer/src/components/demo/InstallOverlay.tsx)
* **Purpose:** A wizard that guides the user through installing the production build of Prism.
* **Wizard Stages:**
  1. **Unpack:** Displays a progress bar while the embedded installer executable is unpacked to the system's temporary directory. Shows the GPL-3.0 license terms and feature preview carousel.
  2. **Install:** Launches the production installer and monitors its installation status.
  3. **Dependencies:** Verifies and configures required system runtimes (Node.js, Git, Playwright) sequentially.
  4. **PrismCLI:** Asks if the user wants to install the terminal companion.
  5. **Done:** Confirms installation is complete and offers to launch the full version of Prism.

---

## 6. The Automated Upgrade and Installation Engine

The upgrade process in the demo variant is handled by a main-process installer module located in [demoDownload.ts](../../src/main/demoDownload.ts). It exposes Electron IPC handlers that coordinate file management, download streams, and elevated process execution.

```
       [Renderer Process]                        [Main Process]
         (InstallOverlay)                       (demoDownload.ts)
                |                                       |
                | ----- (demo-download-prism) --------> |
                |                                       | Unpacks prism-setup.exe
                | <---- (download-progress) ----------- | calculation logs
                |                                       |
                | ----- (demo-run-prism-installer) ----> |
                |                                       | Spawns production setup
                |                                       | (MSI / EXE wizard)
                | <---- (demo-install-progress) ------- |
                |                                       |
                | ----- (demo-get-prism-deps) --------> | Queries dependencies
                | <------------------------------------ | or falls back to manifest
                |                                       |
                | ----- (demo-install-dep) ------------> | Installs Git / Node.js
                | <---- (demo-dependency-progress) ---- | (Sequential loops)
                |                                       |
                | ----- (demo-install-cli) -----------> | Installs PrismCLI
                |                                       | (Powershell script)
                |                                       |
                | ----- (demo-open-prism) ------------> | Scans system paths
                |                                       | Launches Prism.exe
                |                                       | Quits Demo app
```

### 6.1. IPC Channels Registration
The entry point [registerDemoDownloadHandlers](../../src/main/demoDownload.ts#L527) registers handlers in the Main process:
* `demo-download-prism`: Unpacks the embedded setup wizard.
* `demo-run-prism-installer`: Executes the installer executable.
* `demo-install-deps`: Dynamic installer dependencies checker stub.
* `demo-get-prism-dependencies`: Inspects the system for required runtimes.
* `demo-install-dependency`: Downloads and installs a specific package.
* `demo-install-cli`: Spawns a PowerShell subprocess to install the CLI.
* `demo-open-prism`: Scans local directories for the installed application.
* `demo-quit-app`: Quits the Electron process.

### 6.2. Embedded Installer Unpacking
The function [unpackEmbeddedInstaller](../../src/main/demoDownload.ts#L212) extracts the embedded setup executable.
* **Production Path:** Reads the binary from `process.resourcesPath/resources/prism-setup.exe`.
* **Development Path:** Reads the binary from `process.cwd()/resources/prism-setup.exe`. If missing in development mode, it creates a mock fallback using a copy of a system executable (e.g. `whoami.exe` or `cmd.exe`) to allow testing the installation flow without packaging the full setup.
* **File Streaming:** Uses a Node `Transform` stream pipeline to copy the file to the temp directory (`app.getPath('temp')`), emitting progress calculations to the UI at 150ms intervals:
  ```typescript
  const percentage = Math.min(100, Math.round((copiedBytes / totalBytes) * 100))
  emitDownloadProgress({ receivedBytes, totalBytes, percent: percentage })
  ```

### 6.3. Running the Installer
The function [runInstaller](../../src/main/demoDownload.ts#L103) executes the unpacked setup file:
* **Spawning Executable:** Uses Node's `child_process.spawn` to run the setup. If the target installer asks for elevated administrator privileges, it shows the Windows User Account Control (UAC) prompt to the user.
* **Fallback Handler:** If spawning fails with permissions or access errors (e.g., `EACCES`), it falls back to Electron's `shell.openPath(setupPath)` to launch the executable via the OS shell.
* **Cleanup:** Once the installer process exits, the main process removes the temporary installer file from the temp directory to keep the host system clean.

### 6.4. Dynamic Dependency Scanning & Installation
Prism checks for system dependencies to ensure its terminal and web search features function correctly. The dependencies are configured in [dependenciesManifest.ts](../../src/main/dependenciesManifest.ts):
1. **Node.js:** Needed to run local command tools. (Checks `node -v`; downloads `node-setup.msi` and installs it silently using `msiexec /i "{filepath}" /qn /norestart`).
2. **Git:** Required for codebase operations. (Checks `git --version`; downloads and runs setup using `/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS`).
3. **Playwright Chromium:** Required for web search and page reading. (Checks for Chrome, Edge, Firefox, or local Playwright chromium paths; installs using `npx playwright install chromium`).

The main process coordinates the installation sequence:
* **Check Command:** Runs [checkDependencyInstalled](../../src/main/demoDownload.ts#L396) using Node's `exec` to verify if the dependency is already available on the system PATH.
* **Environment Refresh:** When a runtime is installed, its new path does not propagate automatically to running processes. To address this, the demo uses the utility [refreshEnvPath](../../src/main/demoDownload.ts#L347) to query Windows Registry variables:
  ```typescript
  // Queries Registry paths
  reg query HKCU\Environment /v Path
  reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path
  ```
  It parses the outputs, resolves variables (e.g. `%USERPROFILE%`, `%SystemRoot%`), and updates `process.env.PATH` dynamically. This allows the application to verify newly installed runtimes immediately.
* **Sequential Downloads:** If a dependency is missing, [downloadDependencyFile](../../src/main/demoDownload.ts#L405) downloads the package from the configured URL, streaming bytes to a local temporary file and emitting progress percentages.
* **Installation Subprocess:** Calls [installDependency](../../src/main/demoDownload.ts#L468) to run the installer command. It captures `stdout` and `stderr` logs and streams them to the UI console in real-time.

### 6.5. CLI Installation Trigger
If the user chooses to install `PrismCLI` during onboarding, the function [installPrismCli](../../src/main/demoDownload.ts#L149) runs a PowerShell script to fetch and install the CLI from a shortlink:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb bit.ly/prismcli | iex"
```
The console output is streamed to the UI in real-time. Once complete, it updates the setup wizard to its final stage.

### 6.6. Path Scanning and Final Launch
Once the installation is complete, the function [openInstalledPrism](../../src/main/demoDownload.ts#L175) searches for the production executable in standard Windows directories:
1. `C:\Users\Username\AppData\Local\Programs\Prism\Prism.exe` (User-specific app installations)
2. `C:\Users\Username\AppData\Local\Prism\Prism.exe` (Local fallback installation path)
3. `C:\Program Files\Prism\Prism.exe` (System-wide 64-bit installation)
4. `C:\Program Files (x86)\Prism\Prism.exe` (System-wide 32-bit installation)
5. `C:\Users\Username\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Prism.lnk` (Start menu shortcut)

If found, it calls Electron's `shell.openPath(candidate)` to launch the production version, then terminates the demo application using `app.quit()`, completing the onboarding flow.
