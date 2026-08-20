# Local Command Sandbox and Security Guide

## 1. Overview: Guarded Command Execution

Prism allows AI models to execute terminal commands (`execute_terminal_command`) and modify local files (`computer_use_*`). To protect the host operating system from unintended damage, command execution is governed by a local security validation engine implemented in `src/main/localCommandSandbox.ts`.

---

## 2. Shell Configuration

Users can customize the host terminal shell executable used by Prism:

- **Configurable Shell (`terminalShell`):** `powershell.exe` (default), `cmd.exe`, `pwsh.exe`, or custom shell paths.
- **Shell Syntax Summary:** Prism dynamically injects a shell syntax summary into system prompts so connected AI models format terminal commands according to the configured shell.

---

## 3. Path Mutation Guards (`localCommandSandbox.ts`)

Before any file write, edit, append, deletion, or terminal execution occurs, Prism enforces path safety assertions:

### 3.1. Single File Safety (`assertSafeFileMutationPath`)

Blocks mutations on critical OS files:

- Windows system folders (`C:\Windows`, `C:\Program Files`, System32).
- User profile root files (`C:\Users\Username` root level files like `NTUSER.DAT`).
- Boot records, SAM registries, and driver directories.

### 3.2. Bulk Directory Safety (`assertSafeBulkMutationPath`)

Blocks recursive directory deletion or bulk moves targeting:

- Drive roots (`C:\`, `/`).
- User home directory root (`C:\Users\Username`).
- System directories (`C:\Windows`, `/usr/bin`, `/etc`).

---

## 4. Asynchronous Execution and Interactive Terminal

Prism runs terminal commands in an embedded pseudoterminal. On Windows, `node-pty` uses ConPTY so interactive CLIs receive a real terminal environment without opening an external Windows Terminal window.

### 4.1. 5-Second Initial Wait & 6-Digit Run IDs

- Commands taking less than 5 seconds complete synchronously and return terminal output immediately.
- Commands exceeding 5 seconds automatically transition to background execution with a **unique 6-digit Run ID**.
- The tool output immediately informs the AI of the Run ID and the output produced so far.

### 4.2. Standby and Automatic Wake-up Notifications

- When a command is running in the background, the AI can safely finish its turn and enter Standby (idle mode).
- Upon command completion or exit, Prism automatically generates an internal wake-up notification and pings the AI with the complete output (without showing false user messages in the chat interface).
- If the AI is actively running other tools, the notification is delivered smoothly in the next round interval.

### 4.3. Automatic Input Detection

- PTY output is inspected after a short debounce so prompts can arrive without a newline or across multiple output chunks.
- Prompt punctuation, selection markers, and known multilingual prompt terms reinforce detection. ConPTY itself does not expose a universal "stdin requested" event.
- A detected prompt backgrounds the process immediately, updates its terminal snapshot to **Waiting for input**, and queues an internal AI notification containing the Run ID, command, detected prompt, and the complete retained output-so-far snapshot.
- Notifications never interrupt a tool already in progress. Active chats consume them at the next orchestration round; idle chats wake automatically.
- Output retention is capped at 100,000 characters per process. When older output has been dropped, the notification explicitly marks the snapshot as truncated.

### 4.4. Bi-directional Interactivity & Virtual Keyboard

- **`send_terminal_input`**: Sends text and/or simulated key sequences to the standard input (`stdin`) of any running process using its Run ID.
  - Automatically confirms text with `Enter` by default (`pressEnter: true`).
  - Full keyboard modifier support (`Ctrl`, `Alt`, `Shift`), navigation arrows (`ArrowUp`, `ArrowDown`), function keys (`F1-F12`), `Tab`, `Escape`, etc. (e.g. `["Ctrl+B"]`, `["Shift+Alt+L"]`, `["ArrowUp", "ArrowUp", "Enter"]`).
- **`read_terminal_output`**: Extracts the current snapshot of accumulated terminal output for any active or completed Run ID.
- **`kill_terminal_process`**: Explicitly terminates a background process.

### 4.5. Input Bar Terminal Panel

- Backgrounded commands are exposed to the renderer through serializable process snapshots scoped by chat and Run ID.
- The **Terminal** tab above the Input Bar shows **Running**, **Waiting for input**, **Completed**, **Failed**, or **Stopped**, together with the Run ID and exit code when available.

---

## 5. Human-in-the-Loop Consent Policy

1. **Read-Only Operations (Silent Execution):** Reading files, listing directories, getting file metadata, or fetching application lists run silently without blocking.
2. **State-Altering Operations (User Review Required):**
   - Executing terminal commands.
   - Creating, writing, editing, or deleting files and directories.
   - When triggered, Prism displays an interactive UI modal showing the exact command line or path diff. The user can **Allow**, **Deny**, or **Edit** the command before execution proceeds.
