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

## 4. Human-in-the-Loop Consent Policy

1. **Read-Only Operations (Silent Execution):** Reading files, listing directories, getting file metadata, or fetching application lists run silently without blocking.
2. **State-Altering Operations (User Review Required):**
   - Executing terminal commands.
   - Creating, writing, editing, or deleting files and directories.
   - When triggered, Prism displays an interactive UI modal showing the exact command line or path diff. The user can **Allow**, **Deny**, or **Edit** the command before execution proceeds.
