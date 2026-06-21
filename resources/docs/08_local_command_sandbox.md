# Local Command Sandbox and Security Guards

## 1. Introduction: The Mandate for Local Security

Allowing an artificial intelligence model to execute shell commands directly on a user’s local operating system is one of the most powerful features of Prism. It transforms the AI from a text advisor into a hands-on assistant that can compile code, run test suites, check server statuses, and manage dependencies. However, this power introduces significant security risks. If the model generates a command with an accidental typo, makes an incorrect assumption about file hierarchies, or falls victim to prompt injection attacks, it could execute destructive actions—such as formatting drives, deleting user folders, altering system configuration settings, or disabling firewall protections.

To prevent these hazards, Prism builds a native **Guarded Security Sandbox** directly inside the process lifecycle (`src/main/localCommandSandbox.ts`). Every terminal command proposed by the AI must pass a multi-stage security validation scanner before it can execute. This guide documents the engineering architecture, validation limits, protected path registries, blocked command lists, and bypass prevention techniques that secure Prism’s local sandboxed terminal.

---

## 2. Process Execution Boundaries and Technical Limits

When a terminal command is authorized by the user, the main process runs it using Node’s `child_process` library. To prevent runaway commands, system resource exhaustion, or memory overflows, the execution is bounded by strict constraints:

### 2.1. Maximum Command Length
* **Limit:** 20,000 characters (`MAX_COMMAND_LENGTH = 20_000`)
* **Rationale:** Extremely long commands are highly unusual and often represent buffer overflow attempts or obfuscated script injections. Any command exceeding this limit is instantly blocked.

### 2.2. Output Truncation
* **Limit:** 50,000 characters (`MAX_OUTPUT = 50_000`)
* **Max Buffer Size:** 10 Megabytes (`MAX_PROCESS_BUFFER = 10 * 1024 * 1024`)
* **Rationale:** If a command generates massive logs (e.g. printing a compiled database block), loading millions of characters into the Electron IPC pipe and the React rendering tree can lock up the UI. The sandbox allocates up to 10MB of buffer in memory to let the process complete, but truncates the text returned to the AI and user at 50,000 characters, appending the notice:
  `... (Output truncated for performance)`

### 2.3. Process Execution Timeout
* **Limit:** 5 minutes (`PROCESS_TIMEOUT_MS = 5 * 60 * 1000`)
* **Rationale:** If the AI starts a local developer server that runs continuously, or if a script hangs waiting for terminal input that never arrives, the process could run indefinitely in the background. The main process attaches an `AbortSignal` to the execution. If the command does not exit within 5 minutes, it is automatically terminated, freeing system resources.

---

## 3. Environment Variables Sanitization

When spawning local processes, access to system environment variables must be managed carefully. If the spawned terminal inherits the parent Electron process's environment variables directly, it could expose sensitive application secrets (like decrypted API keys or session configurations) to secondary commands or third-party build scripts:
1. **Cloned Environment:** Prism does not pass the parent `process.env` directly. Instead, it creates a sanitized clone of the environment variables.
2. **Secret Stripping:** Any keys matching sensitive naming patterns (e.g. `GEMINI_API_KEY`, `PRISM_SECRET`, `safeStorage` session salts) are explicitly stripped from the execution context.
3. **Execution Context:** The cloned environment retains standard path pointers (`PATH`, `HOMEPATH`, `TEMP`) to ensure compilers, Git tools, and packages can locate their binaries without failure, balancing security with developer utility.

---

## 4. Protected System Roots and Path Normalization

A core defense mechanism is blocking commands from targeting system directories or broad user storage folders.

### 4.1. Path Normalization Protocol
Before scanning a command for directory targets, the path must be normalized to prevent traversal bypasses (e.g. `C:\Windows\..\Windows\System32` or using mixed backslashes/slashes):
1. The path is resolved absolutely using Node's `path.resolve()`.
2. Backslashes `\` are converted to forward slashes `/`.
3. Duplicate slashes are merged (e.g., `//` -> `/`).
4. The entire string is converted to lowercase.
This normalization ensures that checks are compared using a single, unified canonical path.

### 4.2. Protected System Roots (Windows)
The following Windows directories are classified as system-critical. The AI is blocked from running any commands that modify, delete, or target these paths:
* `C:\Windows` (and its nested subfolders like `C:\Windows\System32`)
* `C:\Program Files`
* `C:\Program Files (x86)`
* `C:\ProgramData`
* `C:\Boot`
* `C:\Recovery`
* `C:\System Volume Information`

### 4.3. Protected System Roots (Unix/Linux Fallback)
If Prism runs in a Unix-like environment, the system protected roots list shifts to:
* `/bin`, `/boot`, `/dev`, `/etc`, `/lib`, `/lib64`, `/proc`, `/root`, `/sbin`, `/sys`, `/usr`, `/var`

### 4.4. Broad User Protections
In addition to core system folders, Prism protects major user directories from broad, destructive actions (such as running deletions on the entire drive root or home directory):
* The active user's Home directory (e.g. `C:\Users\Username`)
* The User Desktop folder (`C:\Users\Username\Desktop`)
* The User Documents directory (`C:\Users\Username\Documents`)
* The User Downloads directory (`C:\Users\Username\Downloads`)
* The drive root directories (e.g. `C:\`, `D:\`)

---

## 5. Banned Command Registry (Rules List)

The sandbox parses the command string using strict regular expressions to scan for banned commands or binaries. Below are the categorized rules defined in `ALWAYS_BLOCKED_RULES`:

### 5.1. System Power Control
Commands that shut down, restart, or log off the operating system are blocked to prevent the user's workspace from shutting down:
* **Blocked Patterns:** `shutdown.exe`, `restart-computer`, `stop-computer`, `logoff.exe`
* **Regex Rule:** `commandRule('shutdown(?:\\.exe)?')`

### 5.2. Disk and Volume Mutations
To protect disk health and partition layouts, formatting or partitioning commands are banned:
* **Blocked Patterns:** `diskpart.exe`, `format.com`, `format.exe`, `mountvol.exe`
* **Regex Rule:** `commandRule('diskpart(?:\\.exe)?')`

### 5.3. Privilege Elevation
Prism executes commands within the user's current terminal rights. The AI is blocked from spawning administrative elevation prompts:
* **Blocked Patterns:** `runas.exe`, `start-process` paired with `-verb runas`
* **Regex Rule:** `/\b(start-process)\b[\s\S]*\b-verb\s+runas\b/i`

### 5.4. Security and Execution Policies
Modifying security settings or execution levels is prohibited. This prevents the AI from lowering system security:
* **Blocked Patterns:** `set-executionpolicy` (disables PowerShell execution restrictions), `set-mppreference` / `add-mppreference` / `remove-mppreference` (modifies Windows Defender antivirus exclusion lists or shields).
* **Regex Rule:** `/\b(set-mppreference|add-mppreference|remove-mppreference)\b/i`

### 5.5. Windows Service and System Task Mutations
To prevent the AI from stopping critical background processes, service deletions or configuration edits are blocked:
* **Blocked Patterns:** `sc.exe` combined with delete/stop/config, `stop-service`, `set-service`, `new-service`, `remove-service`, `restart-service`.
* **Regex Rule:** `commandRule('sc(?:\\.exe)?\\s+(?:delete|stop|config|create|failure)')`

### 5.6. Registry Alteration
The system registry contains critical OS configurations. Banning registry modifications prevents system corruption:
* **Blocked Patterns:** `reg.exe` combined with add/delete/import/restore, and PowerShell registry commands targeting `HKLM:` (Local Machine root).
* **Regex Rule:** `commandRule('reg(?:\\.exe)?\\s+(?:add|delete|import|restore|save|load|unload)')`

### 5.7. Network and Firewall Modification
To secure the machine from network configuration leaks or disabled firewalls:
* **Blocked Patterns:** `netsh.exe` (network shell management utility)
* **Regex Rule:** `commandRule('netsh(?:\\.exe)?')`

### 5.8. Accounts and Shares Control
Banning alterations to local user accounts, local groups, or file sharing configurations:
* **Blocked Patterns:** `net.exe` combined with user/localgroup/accounts/share, and PowerShell commands like `new-localuser` or `add-localgroupmember`.
* **Regex Rule:** `/\b(add-localgroupmember|remove-localgroupmember|new-localuser|remove-localuser|disable-localuser)\b/i`

### 5.9. File Permissions and ACL Mutations
To prevent the AI from changing file owners or modifying access rights:
* **Blocked Patterns:** `takeown.exe` (claims file ownership), `icacls.exe` (alters Access Control Lists).
* **Regex Rules:** `commandRule('takeown(?:\\.exe)?')`, `commandRule('icacls(?:\\.exe)?')`

### 5.10. Subsystem Escapes
* **Blocked Patterns:** `wsl.exe` (Windows Subsystem for Linux command runner).
* **Rationale:** Blocking WSL prevents the AI from jumping from a guarded Windows environment into an unmonitored Linux environment where sandbox rules might be bypassed.

---

## 6. Broad Recursive Deletion Protection

Even if the command uses a safe utility (like `rm` or `remove-item`), recursive deletions targeted at broad locations are blocked.

### 6.1. The Recursive Flag Detection
The sandbox scans for recursive deletion flags:
* PowerShell: `-r`, `-rf`, `-fr`, `--recursive`
* Command Prompt: `/s`
* **Regex Trigger:** `/\b(-r|-rf|-fr|--recursive|\/s)\b/i`

### 6.2. Destructive Verb Check
It checks if the command uses a file-deletion verb:
* `remove-item`, `rm`, `rmdir`, `rd`, `del`, `erase`

### 6.3. Targeted Directory Check
If both a recursive flag and a deletion verb are detected, the sandbox scans the target path. If the target points to any of the following, the command is instantly blocked:
* The active working directory (`.`)
* The folder root (`./`)
* All folders (`*`)
* Drive letters (`C:\`, `D:\`)
* The user home directory (e.g. `C:\Users\Username`)
This guard prevents accidental mass deletions of the user's workspace or home directory.

---

## 7. Bypass Prevention and Command Splitting

A common way to bypass basic string security checkers is using command chaining character tokens (`&&`, `;`, `|`, `||`). For instance, if an AI is blocked from running `shutdown`, an attacker might try:
`echo "test" && shutdown`

Prism prevents this by analyzing command chains:
1. **The Separator Matcher:** The sandbox parser splits the input string into separate command units. It uses regex boundary templates:
   ```typescript
   const COMMAND_SEPARATOR = String.raw`(?:^|[\s;&|{}()\\/]\s*)`
   const COMMAND_END = String.raw`(?:\s|$|[;&|])`
   ```
2. **Recursive Scan:** The scanning engine loops through every command unit. If *any* unit in the chain matches a banned pattern, the *entire* execution is blocked.
3. **Error Raising:** When a command is blocked, Prism halts execution, bypasses the user consent prompt (since the command is unsafe to run under any condition), and returns a `CommandBlockedError` to the chat console, explaining the exact security rule that triggered the block.

---

## 8. Detailed Analysis of Internal Helpers

Let us examine the core implementation functions exported by `localCommandSandbox.ts` that guarantee string safety:

### 8.1. `stripAnsi(str: string): string`
Terminal outputs often contain styling color codes (like `\x1B[32m` for green text). If log messages are passed to the AI without stripping these characters, the regex pattern matchers can fail. `stripAnsi` uses a clean regex replacement to strip out all ANSI escape sequences, leaving a pure ASCII string:
```typescript
function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}
```

### 8.2. `normalizePathForScan(value: string): string`
This function is responsible for creating a canonical path representation. It resolves the absolute location, converts backslashes to forward slashes, merges consecutive separators, and lowercases the characters:
```typescript
function normalizePathForScan(value: string): string {
  return normalizeSeparators(path.resolve(value))
}
```

### 8.3. `findProtectedPathReason(scanText: string): string | null`
This helper loops through all registered system and broad user roots. If it detects a match, it returns a descriptive error string:
```typescript
function findProtectedPathReason(scanText: string): string | null {
  for (const root of getSystemProtectedRoots()) {
    if (includesRootReference(scanText, root)) return `protected system path: ${root}`
  }
  for (const root of getBroadProtectedRoots()) {
    if (includesBroadRootReference(scanText, root)) return `broad protected path: ${root}`
  }
  return null
}
```

---

## 9. Troubleshooting Sandboxed Rejections

In development scenarios, a user might legitimately need to run a command that triggers a sandbox rule. For example, compiling a utility inside `ProgramData` or launching a system configuration script.

### 9.1. Resolving Legitimate Rejections
If Prism blocks a command that you need to run, follow these workarounds:
* **Manual Execution:** Copy the command from the Prism chat frame and execute it directly inside your native operating system terminal (PowerShell, CMD, or Terminal app). Because the native shell does not run under Prism's security sandbox, it will execute without rejections.
* **Workspace Relocation:** If a deletion or file build command is rejected because it references a broad protected path (like the drive root or the raw user home directory), relocate your project workspace to a dedicated subdirectory (e.g. `C:\Users\Username\Documents\Code\ProjectSubdir`). Prism allows recursive file operations inside narrow subdirectories, guarding the system while keeping coding tasks fluid.
