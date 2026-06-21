# The Quick Launcher Window

## 1. Introduction: The Concept of Non-Intrusive Interaction

The Quick Launcher is the primary interface gateway for Prism. Breno Alexandre designed it with one core objective: to provide instantaneous AI assistance without interrupting the user's active screen workflow. Traditional AI applications force you to open a browser window, switch virtual desktops, or resize your workspace to ask a quick question or execute a shell command.

The Quick Launcher is different. It is a highly optimized, lightweight overlay window that sleeps in the background, consuming almost zero CPU cycles. With a single press of the global hotkey (`CommandOrControl+Space`), it slides onto the screen, positioned on top of all other windows. The user can type a question, execute a file edit, trigger a system command, capture a screenshot, or launch a local application, and then press `Escape` or click away to watch the launcher vanish, instantly returning them to their IDE or design tool.

---

## 2. Window Properties and System Geometry

To achieve a seamless overlay effect, the Quick Launcher window (`launcherWindow` in `src/main/index.ts`) uses specific Electron configuration parameters:

```typescript
launcherWindow = new BrowserWindow({
  width: primaryDisplay.bounds.width,
  height: primaryDisplay.bounds.height,
  x: primaryDisplay.bounds.x,
  y: primaryDisplay.bounds.y,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  show: false,
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true
  }
})
```

### 2.1. Fullscreen Transparent Architecture
Although the launcher’s input interface is a compact, centralized card, the browser window itself is created at the full width and height of the active display monitor. This design choice is critical for two reasons:
* **Ambient Glow animations:** It allows the application to render full-screen overlays, such as screenshot selection bounds and pulsing radial ambient glows along the absolute edge of the user's screen during processing.
* **Click-Through Handling:** The window utilizes transparent canvas areas. Electron handles mouse clicks through transparent regions, meaning the user can see their background code and click through the empty parts of the screen without the launcher blocking their OS desktop inputs. Only the central card registers mouse and key events.

### 2.2. Multi-Monitor Bounds Calculation
In multi-monitor configurations, positioning a global overlay window can be problematic. If the launcher always appears on the "primary" display, a developer working on their secondary monitor would have to look away, disrupting their focus. Prism solves this using dynamic cursor tracking:
1. When the toggle hotkey is pressed, the main process calls Electron's `screen` module.
2. It retrieves the current position of the OS mouse pointer:
   ```typescript
   const cursorPoint = screen.getCursorScreenPoint()
   ```
3. It identifies which monitor currently contains the mouse cursor:
   ```typescript
   const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
   ```
4. It sets the launcher window bounds to match the active display bounds, ensuring it centers on the screen the user is actively looking at:
   ```typescript
   launcherWindow.setBounds(activeDisplay.bounds)
   ```

### 2.3. Always-on-Top Focus Protocols
The launcher is configured with `setAlwaysOnTop(true, 'screen-saver')`. This ensures that the window floats above all standard OS elements—including full-screen IDEs, web browsers, system taskbars, and standard utility popups.
* **Auto-Blur Hiding:** To maintain a non-intrusive footprint, the main process listens for the `blur` event (which occurs when the launcher loses focus, e.g. when the user clicks a background file or presses Alt+Tab):
  ```typescript
  launcherWindow.on('blur', () => {
    launcherWindow?.hide()
  })
  ```
  Whenever focus is lost, the window is hidden from view, freeing input capture back to the operating system.

---

## 3. Screen Capture and Visual Feedback

One of the most powerful workflows in the Quick Launcher is visual debugging. If a developer encounters a UI bug, compiler error message, or rendering glitch, they can take a screenshot and query the AI about it in seconds.

### 3.1. The Screen Grabbing Pipeline
When the user triggers the screenshot hotkey (`Ctrl+Alt+Space`), the following multi-step pipeline executes:
1. **Launcher Hiding:** The launcher window instantly hides (`launcherWindow.hide()`) and waits 50ms for the desktop repaint to complete. This ensures the launcher card does not capture itself in the screenshot.
2. **Desktop Capture:** The main process queries the OS display manager and captures a raw pixel buffer of the active screen using standard Node.js native desktop capture bindings.
3. **Format Serialization:** The raw pixel data is converted into a compressed PNG image buffer, serialized into a base64-encoded string, and cached in memory.
4. **Window Restoring:** The launcher window is restored and focused (`launcherWindow.show()`).
5. **IPC Event Dispatch:** The main process dispatches a `screenshot-captured` IPC payload to the launcher's web view. The React renderer catches the payload and displays a thumbnail of the screenshot in the attachment tray.

### 3.2. Refractive Visual Feedback
To notify the user that the capture was successful without using annoying popup boxes, Prism utilizes its custom radial design tokens. The fullscreen transparent launcher window executes a CSS animation class (`.screenshot-flash`). The boundaries of the user's monitor pulse with a brief, high-intensity refractive blue-green glow that fades away in 300ms, giving immediate visual confirmation of the screen capture.

---

## 4. IPC Message Routing Schema

The Quick Launcher coordinates state with the Main process using dedicated IPC channels. Below is the complete matrix of IPC messages transmitted between the Main process and the launcher renderer.

| IPC Channel | Direction | Parameter | Action / Effect |
| :--- | :--- | :--- | :--- |
| `launcher-focus` | Main -> Renderer | None | Automatically places focus into the launcher text area. |
| `screenshot-shortcut-triggered` | Main -> Renderer | None | Triggers full-screen visual border glow animation. |
| `screenshot-captured` | Main -> Renderer | `base64Data: string` | Appends image payload to the prompt attachment array. |
| `launcher-apps-updated` | Main -> Renderer | `apps: InstalledApp[]` | Reloads local application cache for autocomplete query. |
| `model-changed` | Main -> Renderer | `modelKey: string` | Synchronizes active model selection in launcher view. |
| `think-mode-changed` | Main -> Renderer | `val: boolean` | Toggles thinking indicator in the input panel. |
| `search-enabled-changed` | Main -> Renderer | `val: boolean` | Toggles web search grounding active indicator. |
| `config-changed` | Main -> Renderer | `config: AppConfig` | Syncs custom key combinations and scales. |

---

## 5. Query Execution Modes

Once the user types a prompt inside the launcher, the system selects the execution mode based on the instruction's complexity.

```
                  User Query in Quick Launcher
                               |
                               v
                     Complexity Analysis
                               |
            +------------------+------------------+
            |                                     |
    [Simple/Short Query]                  [Complex/Coding Task]
            |                                     |
            v                                     v
   Simple Mode (Inline Chat)              Main Workspace Routing
   - Streamed inside Launcher             - Closes Launcher
   - Stays on active screen               - Opens Main Window
   - Escape to dismiss                    - Focuses multi-pane IDE
```

### 5.1. Simple Mode (Inline Mini-Chat)
For quick questions (e.g., "What is the ports syntax for docker-compose?", "Convert 500 USD to BRL"), the launcher runs the query in Simple Mode.
* **Inline Streaming:** The prompt is sent to `prism-6-super-fast`. The streamed response is rendered in a compact text panel directly below the input card.
* **Non-Intrusive Dismissal:** Once the user reads the response, they can press `Escape` or click their editor. The launcher window hides, and the inline chat resets, keeping their desktop workspace completely clear.

### 5.2. Main Workspace Routing (`open_main_app` Tool)
If the query requires writing code, running local sandboxed terminal commands, managing subagent swarms, or rendering Rich HTML dashboards, the AI realizes that the compact launcher is too small.

The AI invokes the `open_main_app` tool:
1. The main process captures the active chat history, select model, and prompt state.
2. It closes the Quick Launcher overlay (`launcherWindow.hide()`).
3. It shows the full multi-pane application workspace window (`mainWindow.show()`).
4. It initializes a new chat session in the main view, injects the launcher's conversation history, and displays the full workspace layout (such as code diff panels and subagent swarms).
5. It focuses the main textarea, allowing the user to continue their coding session in a full development environment.

---

## 6. Local Application Launcher Integration

The Quick Launcher also serves as a rapid system application runner, bypassing traditional OS start menus.

### 5.1. The App Scanner (`get-installed-apps`)
At application startup, the main process runs an asynchronous system scanner:
* On Windows, it reads Registry paths under `Software\Microsoft\Windows\CurrentVersion\Uninstall` (both HKLM and HKCU) to compile a list of installed applications and their executable targets (.exe).
* On macOS, it parses the `/Applications` directory.
* The scanner outputs an array of application objects:
  ```typescript
  interface InstalledApp {
    name: string
    path: string
    icon?: string
  }
  ```
* This list is cached locally in memory, avoiding redundant system disk scans on subsequent launcher activations.

### 5.2. Auto-Complete Search Matcher
When the user types inside the launcher, if the input does not start with a slash `/` (which would trigger workflows) and is not a conversational prompt, the React renderer matches the characters against the application cache:
* It uses a fuzzy-matching string score algorithm to compare the query with the names of installed applications (e.g. typing "vsc" matches "Visual Studio Code").
* A drop-down autocomplete list appears below the search input, showing matching app icons and names.
* **Rapid Open:** The user can press `Tab` or `ArrowDown` to highlight the app and hit `Enter`. The launcher calls the `open_application` tool, launching the executable via Node's `child_process.exec` and immediately hiding the launcher window.

### 5.3. Executable Path Resolution
Many applications are registered under Windows shortcut links (`.lnk`) or virtual targets. In `src/main/systemTools.ts`, the `openApplication` handler includes deep path resolution helpers:
* If the target path points to a shortcut link (`.lnk`), the main process uses Electron's `shell.readShortcutLink(appPath)` to extract the actual target path.
* It verifies that the file exists and is executable.
* It wraps the execution in a protected spawn environment to prevent path injection vulnerabilities, ensuring that application launching is both fast and secure.

---

## 7. Troubleshooting Quick Launcher Visual and OS Issues

Because the launcher relies on transparent windows and always-on-top overrides, certain operating system graphics drivers can produce visual bugs.

### 7.1. Transparency bugs (Black or White Backgrounds)
On older Windows systems or when running Linux without a compositing window manager, the background of the Quick Launcher may render as solid black or solid white instead of transparent.
* **Cause:** The operating system's desktop window manager (DWM) does not support alpha-channel compositing for transparent Electron windows.
* **Solution:** Ensure hardware acceleration is enabled in the Electron preferences. On Linux, ensure a compositor like Compton, Picom, or Mutter is running. If compiling under Docker or virtualized systems, add the command line flag `--disable-gpu` to bypass driver compositing.

### 7.2. Focus Theft in Fullscreen Video Playback
If the user is watching a video or presenting in full screen, pressing the toggle hotkey might push the launcher behind the fullscreen video player, or conversely, disrupt the player focus.
* **Prism's Mitigation:** The window is registered at the `'screen-saver'` level, which overrides standard fullscreen players. If focus is lost or the launcher is blurred, it is immediately hidden, ensuring it does not lock the screen or steal key events.

### 7.3. Virtual Desktop Switching
On systems utilizing multiple virtual workspaces or workspaces desktops (e.g. Windows Virtual Desktops or macOS Spaces), triggering a global hotkey can cause the OS to scroll back to the original workspace where the window was created.
* **The Prism Configuration:** To bypass this workspace jumping behavior, Prism sets the window's visible-on-all-workspaces behavior:
  ```typescript
  launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  ```
  This ensures that the launcher card is initialized directly onto whichever virtual workspace desktop is currently active, preserving the local screen view context and avoiding disorienting desktop slide animations.
