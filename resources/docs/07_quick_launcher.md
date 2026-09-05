# Quick Launcher Guide

## 1. Overview: Always-Available Desktop Overlay

The Quick Launcher is a global, transparent, always-on-top desktop overlay window. Triggered by a global OS hotkey (`Ctrl+Space` by default), it acts as an intelligent command launcher, search engine, math evaluator, and AI mini-chat assistant.

---

## 2. Simple vs Advanced Operating Modes

Configurable in System Settings or via `configure_prism` (`quickLauncherMode` parameter):

- **Simple Mode (Default):** The launcher processes queries and displays AI responses inline directly inside the overlay. Ideal for quick questions, quick command lookups, or instant math calculations without interrupting your active desktop workspace.
- **Advanced Mode:** Upon submitting a query, the launcher closes, brings the main chat workspace window to the foreground, and executes the prompt in the main chat.

---

## 3. Quick Launcher Features

### 3.1. Installed Application Launcher
Typing an application name performs a fuzzy search over locally installed applications (`search_installed_applications`). Selecting an app and pressing `Enter` launches the executable (`open_application`).

### 3.2. Workspace File Search
Type filenames to search files in the active working directory. Pressing `Enter` opens the file in the default system viewer.

### 3.3. Inline Calculator
Type math expressions (e.g. `128 * 1024 / 4`) to display an instant calculation result. Pressing `Enter` copies the answer to the system clipboard.

### 3.4. Inline Model Selector (`Ctrl+M`)
Pressing `Ctrl+M` inside the launcher opens an inline model picker dropdown. Users can switch the active launcher model on the fly between connected providers (e.g. switching between OpenAI, Anthropic, Google AI Studio, or local models).

### 3.5. Screenshot & Ask (`Ctrl+Alt+Space`)
Pressing the global screenshot shortcut captures the screen, plays a visual glow border animation, opens the launcher, and automatically attaches the captured image to the next prompt.

---

## 4. Quick Launcher Keyboard Shortcuts Summary

| Hotkey | Action |
| --- | --- |
| `Ctrl+Space` (default) | Toggle Launcher overlay open/closed |
| `Escape` | Close launcher immediately |
| `↑` / `↓` | Navigate suggestion list or model dropdown |
| `Enter` | Launch app, open file, copy math result, or send AI query |
| `Ctrl+M` | Open inline model selector dropdown |
| `Ctrl+T` | Toggle Think / Reasoning mode |
| `Ctrl+S` | Toggle Web Search mode |
| `Ctrl+Y` | Toggle YouTube mode |
| `Ctrl+D` | Toggle Voice Dictation |


## Mini-Chat Work History

The mini-chat shares the main Chat's chronological work timeline: text, action, intermediate text, next action, final response. Actions first appear when the model starts writing their `progressTitle`, then remain in place after completion. **Worked for N seconds** collapses all intermediate text and ordinary actions when the turn finishes; expanding restores them directly below the summary without jumping to the bottom. The final response and successful generated images stay outside the collapsed history. Image errors, retry controls, cancellations, and attachment-free results remain inside it.
