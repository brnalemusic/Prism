# GitHub and Contributing Guide

## 1. Introduction: Developing for the Prism Ecosystem

Prism is maintained by Breno Alexandre (`@brnalemusic`) as a modern, tool-capable desktop assistant. While the application is designed to feel cohesive and unified to the end-user, the codebase is structured as a modular, cross-platform project built on web technologies (React, TypeScript, Tailwind CSS v4) and compiled natively using Electron and Vite.

For developers reviewing the repository, submitting pull requests, or adapting the code for custom environments, understanding the repository layout, build pipelines, dependencies, and coding conventions is critical. This document serves as the master developer documentation and contribution reference guide.

---

## 2. Codebase Directory Architecture

Prism separates its code into isolated processes to maintain Electron’s security standards. Below is a detailed breakdown of the file structure.

```
prism/
├── .github/                  # GitHub workflow definitions and templates
├── build/                    # Native installer visual assets, icons (ico/icns), and installer configurations
├── dist/                     # Compiled binaries and packaged installer targets (generated after build)
├── node_modules/             # System package dependencies
├── out/                      # Intermediate build output directory
├── resources/                # Static app assets
│   └── docs/                 # Internal AI and User documentation markdown files
├── scripts/                  # Custom build utilities
│   └── build-demo.js         # Build script for packing the demo web version
├── src/                      # Source directory
│   ├── main/                 # Electron Main process files (Node.js engine)
│   ├── preload/              # Security preload scripts (IPC bridge context)
│   ├── renderer/             # React application renderer files (Chromium UI)
│   │   ├── index.html        # Main HTML rendering page
│   │   └── src/              # React components, styles, hooks, and helpers
│   └── shared/               # Shared type definitions and constants
├── package.json              # App configuration, metadata, and dependencies
├── tsconfig.json             # Root TypeScript compilation options
└── electron.vite.config.ts   # Combined configuration file for Vite and Electron compiler
```

### 2.1. The Main Process (`src/main/`)
The code in this directory runs directly inside Node.js. It manages system-level interactions:
* `index.ts`: The main application entry point. Handles window creation, global hotkeys, IPC listeners, and app lifecycle hooks.
* `config.ts`: Manages application configurations, defaults, and the DPAPI safeStorage encryption layer.
* `gemini.ts`: Houses the Google Gen AI API client routing, thinking parameters, stream helpers, and the subagent swarm manager.
* `localCommandSandbox.ts`: Implements regex rules, length limits, and path checks to secure the terminal execution.
* `systemTools.ts`: Implements the actual OS tool bindings (filesystem edits, Playwright browser hooks, application scanners).
* `toolsManifest.ts`: The API reference schema that describes all available tools for the AI models.
* `updater.ts`: Controls auto-update checks using GitHub releases.

### 2.2. The Preload Script (`src/preload/`)
Provides a secure bridge:
* `index.ts`: Declares Electron's `contextBridge`. Exposes a restricted set of IPC invoke methods to `window.api`, keeping the renderer isolated from native system access.

### 2.3. The Renderer Process (`src/renderer/`)
Contains the React frontend, compiled by Vite and rendered inside Chromium:
* `src/App.tsx`: Main React component managing conversational state, sidebars, panel triggers, and IPC listeners.
* `src/assets/main.css`: Core application stylesheet using Tailwind CSS v4, containing custom theme color definitions.
* `src/components/`: Modular UI widgets (e.g. `SettingsView`, `InputBar`, `ModelSelector`, `QuickLauncher`, `Tasks`, `SubagentChat`).
* `src/hooks/`: React state lifecycle listeners (such as shortcut triggers and window focus controllers).
* `src/utils.ts`: Lightweight styling and text utilities (such as dynamic class merges).

---

## 3. Package Script Registry (NPM Commands)

Prism’s execution pipeline is managed via custom npm scripts configured in `package.json`.

* **`npm run dev`**
  * **Command:** `electron-vite dev`
  * **Purpose:** Launches the development environment. It starts a hot-reloading Vite dev server for the React UI and spawns Electron with file-watcher hooks. Any edits to UI code appear instantly; edits to the main process trigger an automated rebuild and restart of the application container.
* **`npm run format`**
  * **Command:** `prettier --write .`
  * **Purpose:** Runs code formatting across all TS, TSX, JS, CSS, and Markdown files, ensuring code style consistency.
* **`npm run lint`**
  * **Command:** `eslint --cache .`
  * **Purpose:** Runs ESLint diagnostics, catching code style errors or potential React hook rule violations.
* **`npm run typecheck`**
  * **Command:** `npm run typecheck:node && npm run typecheck:web`
  * **Purpose:** Compares types across the codebase. It splits typechecks between the Node process (`tsconfig.node.json`) and the web renderer process (`tsconfig.web.json`) to prevent package compiler conflicts.
* **`npm run build`**
  * **Command:** `npm run typecheck && electron-vite build`
  * **Purpose:** Compiles production assets. It runs type checks and compiles main, preload, and renderer source trees into production-optimized assets inside the `/out` directory.
* **`npm run build:win`**
  * **Command:** `npm run build && electron-builder --win`
  * **Purpose:** Packages the application for Windows. It generates portable executables and NSIS setup installers inside the `/dist` directory.
* **`npm run sync`**
  * **Command:** Runs a PowerShell script that parses `version.txt` and updates the version metadata in `package.json` to keep package information synchronized.

---

## 4. Environment and Dependency Setup

### 4.1. Development Prerequisite Stack
To build and run Prism locally, you must install:
1. **Node.js:** Recommended version is v24+ (which supports modern JS optimizations).
2. **NPM:** Standard package manager.
3. **C++ Compilers:** On Windows, node-gyp compilation of native keyhook utilities requires Windows Build Tools (accessible via visual studio installer with desktop C++ packages).

### 4.2. Local Environment Configuration (`.env`)
Prism uses `dotenv` to load local configurations during development. Create a `.env` file in the root directory:
```env
# Google Gemini API key (optional if using in-app settings safeStorage)
GEMINI_API_KEY=your_api_key_here

# Proxy configuration (optional for corporate networks)
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080

# Demo Mode toggle
DEMO_MODE=false
```

---

## 5. Electron Builder Configurations (`electron-builder.yml`)

The production packaging is controlled by `electron-builder.yml`. Understanding its settings is essential for creating clean installers:
* **File Exclusions:** To keep the installer size small, the configuration includes strict exclusion rules. It blocks packaging test source folders, raw TypeScript files, visual assets not used in production, and source maps (`*.map`).
* **Auto-Update bindings:** The file links to the GitHub repository target `brnalemusic/Prism`. This binding is used by `electron-updater` to check for releases, download diff blocks, and run silent background updates.
* **NSIS Installer:** The Windows target is configured with NSIS settings, enabling a clean setup window, custom installation directories, auto-launch toggles, and shortcut creation on the user's desktop and start menus.

---

## 6. How to Debug Prism: A Step-by-Step Tutorial

Debugging a multi-process Electron application requires attaching debuggers to both the Node.js main process and the Chromium renderer process.

### 6.1. Debugging the Main Process
The Main process runs on Node.js. To step through Main process files (like `localCommandSandbox.ts` or `systemTools.ts`):
1. In VS Code, create a `.vscode/launch.json` file.
2. Add an Electron Main configuration:
   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "node",
         "request": "launch",
         "name": "Electron: Main",
         "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron-vite",
         "runtimeArgs": ["dev", "--inspect=5858"],
         "port": 5858,
         "cwd": "${workspaceFolder}"
       }
     ]
   }
   ```
3. Set your breakpoints in `src/main/*.ts` files.
4. Press `F5` in VS Code. The debugger will attach to the Node inspector port `5858`, stopping on your breakpoints in real-time.

### 6.2. Debugging the Renderer Process
The UI is a Chromium web window. You can debug it exactly like a web application:
1. Focus the active Prism application window.
2. Open Chromium Developer Tools by pressing the developer key shortcut (typically `F12` or `Ctrl+Shift+I` on Windows, `Cmd+Option+I` on macOS).
3. The DevTools console will slide open, allowing you to inspect the React DOM tree, monitor state updates, inspect network calls to Google APIs, and debug console logs.

---

## 7. Local Testing Guidelines

Before submitting changes, developers must verify local execution behaviors. The workspace contains custom test files in the root folder to dry-run integrations:
* **TTS Verification (`tts_test.ts` / `tts_test_rest.js`):** Test scripts that make direct calls to the Google audio synthesis API. If you refactor the voice player, run these tests to verify that WAV buffer encoding matches and the stream does not return 500 errors.
* **Sandbox Verification:** Write a local scratch script inside the `scratch/` folder to pass mock strings containing bypass sequences (e.g. `rm -rf C:\`) through `localCommandSandbox.ts`'s scanner, validating that the command is successfully blocked and throws a `CommandBlockedError`.

---

## 8. Styling Implementation Standards (Tailwind CSS v4)

Prism styles layouts using Tailwind CSS v4 directives declared in `main.css`.
* **Theme Variable Usage:** Do not write absolute color hex values inside custom React components. Instead, map layouts to theme variable properties (e.g. `bg-surface`, `text-text-primary`, `border-text-muted`), ensuring components auto-adjust when the user switches themes.
* **Glow selectors:** Custom keyframe animations (like `@keyframes rgb-shift`) and glowing borders must be mapped to classes inside `main.css` to allow GPU hardware acceleration, avoiding inline JS styling calculations that degrade rendering speeds.

---

## 9. Git and Commit Guidelines

Prism follows clean, structured Git guidelines to maintain commit history integrity.

### 9.1. Branch Naming Strategy
When developing new features or fixing bugs, create branches following these naming patterns:
* **Feature Branches:** `feature/your-feature-name` (e.g. `feature/subagent-timeout-guard`)
* **Bug Fixes:** `bugfix/target-bug-name` (e.g. `bugfix/tts-500-error-filter`)
* **Releases:** `release/X.Y.Z`

### 7.2. Semantic Commit Messages
Prism enforces semantic commit messages to automatically generate changelogs during builds. Commit prefixes must match:
* `feat:` A new feature or capability (e.g. `feat: add persistent playwright browser settings`).
* `fix:` A bug resolution (e.g. `fix: strip math latex formatting from tts inputs`).
* `refactor:` A code change that neither fixes a bug nor adds a feature, but improves code quality.
* `docs:` Documentation changes only.
* `style:` Code changes that affect formatting, semicolons, or styles, but do not alter logic.
* `test:` Adding or correcting unit tests.
* `chore:` Updating build tasks, packages, or config dependencies.

---

## 10. Coding Guidelines and Best Practices

To maintain performance, security, and stability, developers must adhere to the following standards:

### 10.1. Strict TypeScript Compliance
* Avoid using the `any` type whenever possible. Declare descriptive interfaces for props, IPC payloads, and state parameters.
* Place shared types and interfaces inside `src/shared/` so that both the Main and Renderer processes can reference them without duplicate declarations.

### 10.2. React Performance Optimization
* **Minimize Render Passes:** Avoid putting large typing buffers or hover triggers in parent component states. Use React refs (`useRef`) to capture input texts during text input, syncing to state only when sending a message or toggling menus.
* **Cleanup Listeners:** When adding global keyboard or click listeners inside React `useEffect` hooks, always return a cleanup function to unmount the listeners, preventing memory leaks during panel switching.

### 10.3. Electron Security Best Practices
* **Keep Context Isolation Enabled:** Under no circumstances should `nodeIntegration` be enabled in the browser window configurations, and `contextIsolation` must remain active.
* **Strict IPC Auditing:** Never expose raw Node.js modules (like `child_process` or `fs`) over the preload bridge. If a new capability is required, expose a narrow method like `window.api.runTool()` and run sandbox checks on the arguments in the main process before executing.
* **Sanitize Inputs:** Always parse, validate, and sanitize inputs received from the renderer before processing them in Node.js.
