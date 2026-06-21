# Keyboard Shortcuts and Navigation

## 1. Introduction: Keyboard-First Interface Design

Prism is designed with a "keyboard-first" philosophy. Breno Alexandre recognized that developers, system administrators, and power users spend the majority of their work hours with their hands on the keyboard. Forcing a developer to constantly lift their hand, grab a mouse, and click small buttons to toggle an AI view, take screenshots, or change models introduces physical friction that breaks cognitive flow.

To ensure absolute efficiency, Prism integrates a multi-layered hotkey system. This system is split between OS-level global keyboard hooks registered in Electron’s main process and application-level keyboard listeners mapped inside the React renderer. This document provides a comprehensive breakdown of every default keyboard shortcut, their underlying execution logic, and the mechanics of custom hotkey registration.

---

## 2. Exhaustive Keyboard Shortcut Reference

Below is a complete matrix summarizing all default keyboard shortcuts built into Prism, categorized by their execution scope and target trigger.

| Key Combination | Scope / Context | Action Performed | Trigger Source |
| :--- | :--- | :--- | :--- |
| `CommandOrControl + Space` | OS Global | Toggles the Quick Launcher Overlay | Electron Main Process |
| `Ctrl + Alt + Space` | OS Global | Captures Primary Monitor Screenshot | Electron Main Process |
| `CommandOrControl + N` | App Focused | Starts a New Chat Session (Clears Chat) | React Renderer (`App.tsx`) |
| `CommandOrControl + S` | App Focused | Toggles Google Search Grounding | React Renderer (`InputBar.tsx`) |
| `CommandOrControl + T` | App Focused | Toggles AI Think / Reasoning Mode | React Renderer (`InputBar.tsx`) |
| `CommandOrControl + D` | App Focused | Toggles Voice Dictation / Recording | React Renderer (`InputBar.tsx`) |
| `CommandOrControl + Y` | App Focused | Opens the YouTube Summarizer Modal | React Renderer (`InputBar.tsx`) |
| `CommandOrControl + M` | App Focused | Toggles Model Picker Dropdown Menu | React Renderer (`ModelSelector.tsx`) |
| `Enter` | Input Textarea | Submits Chat Prompt and Attachments | Textarea Listener |
| `Shift + Enter` | Input Textarea | Inserts a Line Break / Newline | Textarea Listener |
| `ArrowUp` / `ArrowDown` | Slash Menu Open | Navigates Autocomplete Workflows | Textarea Listener |
| `Enter` | Slash Menu Open | Confirms and Injects Active Workflow | Textarea Listener |
| `Escape` | Modal / Dropdown | Closes active Modal, Menu, or Selector | Universal Event Listener |

---

## 3. Operating System Level Global Hotkeys

Global hotkeys are registered at the operating system level by Electron’s main process (`src/main/index.ts`). These shortcuts are captured by Windows hooks (or system-specific equivalents) even when Prism is minimized, hidden in the system tray, or when the user is focused on another application (such as VS Code, a web browser, or a local terminal).

### 3.1. Under the Hood: OS Hooking Mechanics
When the main process calls `globalShortcut.register()`, Electron registers a hook with the operating system’s windowing manager:
* **On Windows (Win32):** Electron calls the native `RegisterHotKey` Win32 API. This API registers a hotkey with the calling thread's message queue. When the user presses the registered key combination, the OS sends a `WM_HOTKEY` message to Prism’s hidden background message window. The main process intercepts this message, translates it to the corresponding callback, and runs the registered function.
* **On macOS (AppKit):** The system uses Apple’s Core Graphics event taps or Carbon HotKey APIs to monitor event registers. When a matching key event is captured, the OS sends a notification to Prism, interrupting the active app's layout event dispatch.
* **On Linux (X11/Wayland):** Electron registers a grabbing hook via `XGrabKey` under X11 server protocols. Under Wayland, it utilizes shell-specific global shortcut portal APIs.

### 3.2. Toggle Quick Launcher (`CommandOrControl+Space`)
* **Configuration Key:** `launcherShortcut`
* **Underlying Workflow:**
  1. The user presses the hotkey.
  2. The OS intercepts the combination and redirects it to Prism's main process.
  3. The main process invokes the `toggleLauncher()` function:
     * If the Quick Launcher window (`launcherWindow`) is currently visible, it is immediately hidden (`launcherWindow.hide()`).
     * If it is hidden, the main process queries the operating system for the current screen geometry bounds (to match the primary active display) and sets the window bounds (`launcherWindow.setBounds()`).
     * It shows the window (`launcherWindow.show()`) and forces focus (`launcherWindow.focus()`).
     * An IPC message (`launcher-focus`) is sent to the renderer process to automatically focus the input textarea.

### 3.3. Instant Capture Screenshot Overlay (`Ctrl+Alt+Space`)
* **Configuration Key:** `screenshotShortcut`
* **Underlying Workflow:**
  1. The user triggers the hotkey.
  2. The main process intercepts it and instantly checks if the Quick Launcher window is visible. If it is visible, it temporarily hides it (`launcherWindow.hide()`) so that the launcher itself does not clutter the captured image.
  3. It waits for a brief frame delay (e.g. 50ms) to allow the OS to complete window hiding and redrawing.
  4. It invokes the native screen capture engine (via Playwright or OS-specific capture wrappers) to grab a high-definition screenshot of the primary screen.
  5. The image is converted to a base64-encoded string buffer in memory.
  6. The main process displays the Quick Launcher window fullscreen again and sends two IPC events:
     * `screenshot-shortcut-triggered` (which plays a visual border glow animation, letting the user know the screenshot was taken).
     * `screenshot-captured` (which attaches the base64 image data directly to the active prompt attachment drawer).
  7. The launcher window is focused, ready for the user to type a query referencing the image.

---

## 4. Application-Level Hotkeys (React Renderer)

These hotkeys are active only when the Prism application window (`mainWindow` or `launcherWindow`) is focused. They are implemented using standard React hook event listeners attached directly to the global `window` object in `App.tsx` and `InputBar.tsx`.

### 4.1. Create a New Chat (`Ctrl+N` / `Cmd+N`)
* **Underlying Logic:**
  ```typescript
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    handleNewChat()
    setIsSidebarOpen(false)
  }
  ```
* **Effect:** Instantly resets the active conversation thread state. It clears the message array in the renderer, resets subagent swarm tasks, closes the sidebar to maximize screen space, and places the cursor focus back into the primary input textarea.

### 4.2. Toggle Google Search Grounding (`Ctrl+S` / `Cmd+S`)
* **Effect:** Toggles the search grounding state variable (`isSearchEnabled`). When enabled, the input bar displays a highlighted "Web Search" indicator, and the AI system prompt is updated with the active web search protocol. Any subsequent prompt sent will execute real-time Google search queries before replying.

### 4.3. Toggle Think Mode (`Ctrl+T` / `Cmd+T`)
* **Effect:** Toggles the thinking/reasoning model mode on or off. When active, it shifts the routing to models that support detailed chain-of-thought outputs (like Gemini reasoning models), displaying an active thinking indicator in the input panel.

### 4.4. Toggle Dictation / Voice Capture (`Ctrl+D` / `Cmd+D`)
* **Effect:** Toggles the voice input dictation engine. If inactive, it requests access to the local microphone, displays a pulsating audio wave overlay in the input panel, and begins recording. Pressing it again stops recording and transcribes the speech to text, inserting it directly into the textarea.

### 4.5. Open YouTube Modal Interface (`Ctrl+Y` / `Cmd+Y`)
* **Effect:** Opens the dedicated YouTube App Modal inside the workspace. It automatically disables standard web search grounding, loads the YouTube search panel, and allows the user to browse videos, extract transcripts, or issue audio summary commands using dedicated hotkeys.

---

## 5. Input Textarea and Slate Editor Interceptors

The primary input textarea (`src/renderer/src/components/InputBar.tsx`) handles specialized keyboard events to allow rapid text editing and command navigation.

### 5.1. Message Submission vs Newline
* **Submit Query (`Enter` key without modifiers):** Submits the current prompt and attachment payload to the execution pipeline. If the textarea is empty, the keystroke is ignored.
* **Insert Line Break (`Shift + Enter` keys):** Inserts a literal newline character `\n` at the cursor position and auto-scales the textarea height to fit the new row, without triggering message submission.

### 5.2. Slash Workflows Menu Navigation
Typing a forward slash `/` at the beginning of a line opens the Slash Workflows auto-complete menu. The following key interceptors guide menu navigation:
* **Select Next Workflow (`ArrowDown` key):** Moves the active selection highlight down one item. If it reaches the bottom of the list, it wraps around to the first item.
* **Select Previous Workflow (`ArrowUp` key):** Moves the active selection highlight up one item. If it reaches the top, it wraps around to the bottom.
* **Confirm Selection (`Enter` key):** Selects the highlighted slash workflow. It replaces the typed `/` command with the workflow’s pre-configured system instruction template and closes the menu.
* **Close Menu (`Escape` key):** Hides the auto-complete menu, leaving the text input unaltered.

---

## 6. Custom Hotkey Configuration (Shortcut Recorder)

Prism does not lock users into the default shortcut mappings. The Settings screen features an interactive **Shortcut Recorder** component (`src/renderer/src/components/ShortcutRecorder.tsx`) allowing users to record custom hotkey combinations.

### 6.1. The Recording State
When the user clicks on a shortcut input field in the settings, the recorder enters the recording state:
1. The component mounts a privileged window keydown event listener:
   ```typescript
   window.addEventListener('keydown', handleKeyDown, true)
   ```
   The `true` parameter forces event capturing, intercepting the keystroke before the browser registers default keyboard actions.
2. The browser's default behavior is blocked using `e.preventDefault()` and `e.stopPropagation()`.

### 6.2. Mapping Modifiers
As the user presses keys, the recorder analyzes the keyboard event structure:
* It checks for active modifier flags: `e.ctrlKey`, `e.metaKey` (Command on Mac, Windows key on PC), `e.altKey`, and `e.shiftKey`.
* It ignores standalone modifier keypresses (e.g. pressing only `Ctrl` does not save a shortcut).
* Once a non-modifier key is pressed (the "target key"), it constructs an Electron-compatible accelerator string.
* **Format Conversion:**
  * `Control` or `Command` -> `CommandOrControl`
  * `Alt` -> `Alt`
  * `Shift` -> `Shift`
  * Letters are capitalized (e.g. `s` -> `S`).
  * Function keys are mapped directly (e.g. `F5`, `Space`).
  * Example result: `CommandOrControl+Alt+S`

### 6.3. Serialization and Update
Once a valid combination is captured, the recorder writes the new accelerator string to the React configuration state. When the settings are saved, the config is serialized and sent to the main process via `window.api.saveConfig()`. The main process decrypts/saves the config, unregisters the old shortcuts, and registers the new accelerators:
```typescript
globalShortcut.unregisterAll()
globalShortcut.register(newShortcut, () => { toggleLauncher() })
```

---

## 7. Troubleshooting Shortcut Conflicts and System Errors

System-level keyboard hooks can fail if another active application has already claimed exclusive access to that specific key combination.

### 7.1. Common Conflict Scenarios
* **Conflict on `CommandOrControl+Space` (Mac Spotlight / Windows IME):**
  * On macOS, `Cmd+Space` is bound to Spotlight Search. If a user tries to register this, Apple’s event queue might block Prism from capturing it.
  * On Windows, `Ctrl+Space` is sometimes bound to Input Method Editor (IME) language toggling.
  * **Solution:** If a registration fails, the main process catches the error, logs a console warning, and falls back to registering the default key combination, ensuring that the launcher remains accessible. Alternatively, users can map the launcher to an alternative combination like `Ctrl+Alt+P` in the Settings.
* **Conflict on `Ctrl+Alt+Space` (Third-Party Screen Grabbing Tools):**
  * Third-party capturing apps (like ShareX or Lightshot) sometimes bind global print-screen keys.
  * **Prism's Resolution:** Prism wraps registration calls in a `try...catch` block. If the registration fails, the application remains fully functional and triggers a notification in the UI alerting the user to reconfigure the conflicting hotkey.

### 7.2. X11 and Wayland (Linux Quirks)
On Linux systems running Wayland instead of X11, the native windowing manager blocks application processes from binding global hotkeys for security reasons. When Prism runs in a Wayland environment:
* The application utilizes Wayland portal shortcuts as fallback hooks.
* If portals are unavailable, Prism triggers an on-screen dialog suggesting that the user map the launcher toggle command (`prism --toggle-launcher`) directly inside their desktop environment’s native settings panels (such as GNOME Keyboard Settings or KDE Shortcuts Console), ensuring keyboard productivity across all Linux distributions.
