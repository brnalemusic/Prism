# Agenda Mode

Agenda is Prism's desktop-only mode for recurring AI work. You describe a task once, choose a cadence, and Prism runs it while the app is open. Every run starts with a fresh model context; the only memory carried between runs is a small state file inside the task folder.

Agenda is intentionally **not** an OS service and does not use an isolated computer. The executor runs through the regular Prism chat pipeline with full access to the real machine, and safety comes from the permission mode described below.

## Opening Agenda

Use the **Agenda** entry in the sidebar. The workspace shows every task, its cadence, the next run, the last run status, and the recent run history. The header contains the `Safe` / `YOLO` chip and the tutorial button.

## Creating a task

There are two ways to create a task:

- **New task** opens the manual editor: title, instructions, cadence, and optional MCP servers.
- **Bottom composer** accepts natural language such as "every morning, summarize my downloads folder". Prism drafts a task, shows a confirmation card, and only creates it when you press **Create task**. The composer never schedules anything by itself. It also understands clock anchors ("every Monday at 9", "on the 1st at 9").

The editor is also used to edit an existing task. Pausing, resuming, running now, opening the task folder, and deleting are available from each task row.

### Cadence

- Minimum: **2 hours**.
- Maximum: **31 days**.
- Presets cover 2 hours through one month; **Custom** accepts hours or days.
- **Once** creates a one-shot task. It runs at the next scheduler tick and is then paused automatically.
- Cadences of one day or longer can also **run at a specific time**. Weekly tasks pick a weekday; monthly tasks pick a day of the month, clamped to the last day of short months. Without an anchor, the schedule rolls from the previous scheduled occurrence.

The next occurrence is always computed from the schedule, not from when the previous run finished, so long runs do not make the schedule drift. When Prism was closed through one or more occurrences, the next launch records a **single catch-up run** instead of a burst. If the previous run of the same task is still active when the next occurrence is due, that occurrence is recorded as **skipped**.

Agenda only runs while Prism is open, including when the window is minimized to the tray. Closing Prism stops the scheduler. A run that was executing when Prism quit is marked **interrupted** on the next launch.

## Task folders and memory

Every task owns a folder:

```text
<Documents>/Prism/Agenda/<slug>-<short id>/
  .agenda/
    manifest.json   task identity
    state.md        the only memory carried between runs
    runs.log        append-only run log
```

The executor is instructed to work inside this folder and to rewrite `.agenda/state.md` at the end of every run with what was done, what is pending, and what the next run needs to know. Files written anywhere else are not cleaned up automatically.

Use **Open task folder** on a task row to inspect or edit its files. Deleting a task removes its schedule and run records; deleting the folder is a separate, explicit checkbox.

## Permission modes

### Safe (default)

Safe is the default after install, after a reset, and whenever the persisted settings are inconsistent. Before any of these actions, Prism shows a dialog, restores the window if minimized, flashes the taskbar, and sends a Windows notification:

- running a terminal command;
- calling an MCP tool;
- installing or changing an MCP server;
- creating or changing a schedule.

The choices are:

- **Stop** — deny this action. The run continues and reports what was skipped.
- **Continue** — allow this one action.
- **Switch to YOLO** — allow the action and switch the whole app to YOLO.

A prompt that receives no answer within **5 minutes** is denied. Every decision is appended to `agenda/permissions.jsonl` in the Prism config directory.

### YOLO

YOLO runs without prompts. The mode is only enabled after an explicit confirmation in the Agenda header. The confirmation is persisted together with the mode, and a tampered config that claims YOLO without the acknowledgement is normalized back to Safe on load.

## Run history

The right-hand panel lists recent runs. Select a run to open its transcript, including the prompt, assistant messages, tool calls, duration, status, catch-up marker, error, and the number of permission prompts resolved during the run.

Agenda runs reuse the chat pipeline with hidden `agenda-<run id>` sessions. These sessions are stored for auditing but are filtered out of the chat sidebar and search results. Their streaming events never reach the chat UI.

## Concurrency and queue

- Up to **2 runs** execute at the same time by default (configurable from 1 to 8).
- Additional due tasks wait in an in-memory queue capped at 20 entries.
- Overlapping occurrences of the same task are skipped rather than queued twice.
- The queue is not persisted; if Prism quits while tasks are queued, they are evaluated again on the next launch.

## What the executor can do

The executor uses the normal Prism tool surface: terminal commands, file tools, web search/fetch, browser tools, image generation when configured, and any MCP servers attached to the task. It cannot create, edit, pause, or delete Agenda tasks — task management stays with the user or the composer. It can install MCP servers for itself through `agenda_install_mcp_server`, which always passes through the `mcp_install` permission in Safe mode.

Because there is no sandbox, the model can change real files and run real commands. Review task instructions before enabling YOLO, and keep Safe mode for tasks that touch sensitive data.

## Troubleshooting

- **A task never runs.** Check that Prism is open, the task is active, and `nextRunAt` is in the future. One-shot tasks pause after their run.
- **A run failed immediately.** Open its transcript. The most common causes are a missing provider API key, an unavailable model, or no active chat model selected.
- **A run is stuck.** Use the run transcript to see the last tool call. In Safe mode, a pending permission prompt blocks until it is answered or times out.
- **No permission prompt appeared.** Make sure the app is not on a locked screen and that Windows notifications are allowed for Prism. The in-app dialog is the source of truth; the notification is only a shortcut.
- **The task folder is missing.** It lives under Documents/Prism/Agenda. Recreating the folder is safe; `.agenda/state.md` will be recreated empty on the next run.
