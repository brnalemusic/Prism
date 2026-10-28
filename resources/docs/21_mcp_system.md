# MCP System

Prism supports the Model Context Protocol (MCP) so Agenda tasks can use external tools without adding native Prism code. The system is reusable: install a server once, attach it to any number of tasks, and every run starts it on demand.

MCP servers are currently exposed **only to Agenda runs**. Regular chats keep the native Prism tool surface.

## Installing a server

Open **Settings → MCP Servers** and choose **Add server**.

- **Presets** fill in a known server in one click: Filesystem, Memory, Sequential Thinking, and the Everything test server. Presets that need credentials show the expected environment variables.
- **Stdio** runs a command as a child process. This is the usual transport for `npx`/`uvx` servers.
- **HTTP** connects to a remote Streamable HTTP endpoint.

For stdio servers, arguments are entered one per line. On Windows, Prism spawns the command through the shell so `npx` and `uvx` shims resolve correctly, and it quotes every argument explicitly.

After saving, Prism starts the server, performs the MCP handshake, lists its tools, and shows the result as **Ready** or **Error** with the message. Use the refresh button to restart the server and list its tools again. The toggle disables a server without deleting it.

In **Safe** mode, installing or changing a server requires a permission prompt. In **YOLO** it proceeds immediately. Both paths are recorded in the Agenda permission audit log.

## Secrets

Environment variables are stored separately from the server list:

- `mcp.json` keeps the portable `mcpServers` shape plus Prism metadata under `prism`.
- `mcp-secrets.json` keeps encrypted values through Electron `safeStorage` (the OS keychain).

Secrets are never written to `mcp.json`. Editing a server and leaving a value blank keeps the stored value; removing the row deletes the key. If secure storage is unavailable, Prism refuses to save the secrets instead of writing them in plain text.

Both files live in the Prism config directory (`%LOCALAPPDATA%\PrismDesktop` on Windows).

## Attaching servers to a task

The Agenda task editor lists the installed servers. Select one or more and save. The task stores their ids in `mcpServerIds`.

When a run starts, Prism starts the attached servers before the model asks for its tool list, then exposes their tools as:

```text
mcp__<serverId>__<toolName>
```

Tool names are sanitized and capped at 64 characters (OpenAI-compatible function names); a short hash keeps truncated names unique. The original tool name is recovered from the server's cached tool list when the model calls it.

## Permissions and safety

- **Safe:** every MCP tool call asks for permission with the server, tool name, and exact JSON arguments. Denying the call returns an error to the model, which is instructed to continue and report what was skipped.
- **YOLO:** calls run without prompting but are still written to `agenda/permissions.jsonl`.

## Letting an Agenda run install a server

Agenda runs receive one extra native tool, `agenda_install_mcp_server`. When a task needs a capability that is not attached yet, the model can install a server itself and attach it to the task for the rest of the run and for future runs.

The tool accepts `name`, `transport` (`stdio` or `http`), `command`, `args`, `env`, `url`, an optional `id` to update an existing server, and `attachToTask` (defaults to `true`). It goes through the same `mcp_install` permission as the Settings editor, so in Safe mode the user sees the exact command or endpoint before anything is written. The server is started immediately; because the tool list is rebuilt on every round, its tools become available without restarting the run. If the install is denied or the server fails to start, the model receives the error and is told to continue and report the blocker.

Use this deliberately: a task that installs servers on its own can grow its permissions over time. Review the task instructions and the permission audit log.

MCP tool results are capped to a readable text form: text parts are joined, resources are JSON-encoded, and images become `[image]`. Errors reported by the server (`isError`) are surfaced to the model as a failed tool call.

## Lifecycle

- Servers start on demand: when a run needs them, when you refresh them in Settings, or when a saved server is validated.
- Servers are child processes of Prism. Quitting Prism stops every managed server, and Windows process trees are terminated with `taskkill /T /F`.
- A crashed or exited server is reported as **Error** with its stderr tail. Refresh restarts it.
- The queue and status cache are in-memory; the configuration survives restarts.

## The `mcp.json` shape

Prism keeps the file portable so it can be shared with other MCP clients:

```json
{
  "mcpServers": {
    "filesystem-1a2b3c": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\you\\Documents"]
    }
  },
  "prism": {
    "servers": {
      "filesystem-1a2b3c": {
        "name": "Filesystem",
        "transport": "stdio",
        "envKeys": [],
        "enabled": true,
        "createdAt": 1730000000000,
        "updatedAt": 1730000000000
      }
    }
  }
}
```

HTTP servers use `{ "type": "http", "url": "https://..." }` instead of `command`/`args`. Editing the file by hand works, but Prism only knows about servers that are present under `mcpServers`; metadata is optional.

## Troubleshooting

- **Server stays in Error.** Open the error text. Common causes are a missing package, an invalid command, a missing API key, or a corporate proxy blocking `npx`.
- **`npx` is not found.** Stdio presets use `npx`, which must be available on your PATH. Install Node.js if `npx` does not work in a terminal. On Windows the server is spawned through `cmd.exe`.
- **Handshake times out.** Initialization has a 60-second budget because `npx` may download a package on first use. Tool calls have a 5-minute budget.
- **Tools are missing from a run.** Attach the server to the task and refresh it once in Settings so its tool list is cached. A disabled server is never started.
- **A tool call is denied.** In Safe mode, approve the prompt. Denials are recorded in the run transcript and the audit log.
- **Secrets disappeared.** Re-enter them in the server editor. Prism does not fall back to plaintext storage if the OS keychain is unavailable.
