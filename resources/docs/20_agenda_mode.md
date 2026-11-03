# Agenda Mode

Agenda is Prism's desktop-only mode for AI-driven schedule creation. Each Agenda tab is an independent creation agent with its own conversation and its own schedules.

Agenda is in alpha and remains in development; users will encounter issues. The app displays a persistent notice linking to [Prism GitHub Issues](https://github.com/brnalemusic/Prism/issues) for Agenda bug reports and suggestions. Feedback helps improve Agenda and prioritize future Prism updates.

## Core pieces

- **Bottom composer:** a Chat-style compact pill with a theme-aware Forest/Medium glass surface plus Liquid Glass Maximum. The Agenda model selector and Safe/YOLO chip live inside it.
- **Manual-create button:** immediately left of the composer, bottom-aligned. Opens a modal that can create a schedule directly or save it as a draft.
- **Floating right sidebar:** groups schedules by status (running/active open by default; paused; cancelled/completed; drafts; failed/needs attention) and supports an "See other agents' Agendas" view grouped by agent.

## Agents

- The first tab is **Main Agenda agent** and cannot be deleted.
- New agents auto-title from the first message.
- Each agent owns its schedules; the sidebar filters to the selected agent by default.
- Closing a tab does not delete the agent; the All-agents view can reopen it.
- Deleting an agent that owns schedules requires a three-step verification: acknowledge, type the agent name, then solve a generated (non-unique) arithmetic puzzle. Schedules, runs and transcripts are removed.

## Schedules

- Every schedule has a mandatory **12-digit numeric id** and a **title**.
- AI creation requires an AI-generated name; manual creation requires a user title.
- Statuses: `draft`, `active`, `paused`, `completed`, `cancelled`.
- One-shot tasks (`intervalMinutes: null`) auto-complete after their run.
- Drafts can come from both AI and the manual modal.
- Cadence range: 120–44640 minutes, with optional clock anchors.

## Schedule detail

- Header breadcrumb: `Main Agenda agent > <schedule title>`; clicking the agent returns to the creation view.
- Status chip, run picker (defaults to the latest run), compact action menu: pause/resume, run now, edit, complete, cancel, delete.
- Run prompt and instructions render as collapsed cards above the transcript.
- The transcript is Chat-like (tool shimmer, expandable "Worked for N seconds") with a locked input while a run is active.

## Runs

- Run records snapshot `prompt`, `instructions`, `taskTitle`, `agentId` and trigger (`scheduled`, `manual`, `agent`) so detail cards survive edits.
- Opening a schedule creates a new Agenda tab and counts toward the 5-tab limit.
- Run-now does not change status; pause/resume adjusts status; complete stops future runs; cancel aborts the active run and preserves history.

## AI tools

The creation agent can search schedules by their exclusive 12-digit id and run, edit or delete them. It chooses production-ready (`active`) vs `draft` based on the request.

## Safety

- Safe mode prompts for terminal commands, MCP tool calls, MCP installs and schedule mutations.
- Manual UI actions (create/update/delete/run/status) do not require Safe-mode prompts.
- Agent-initiated schedule mutations do.

## Persistence

- Schedules, agents and runs persist across launches. Open tabs reset to the Main Agenda agent on launch.
- Agenda conversations and run transcripts are stored as hidden chat sessions.
- Legacy UUID schedule ids are migrated to 12-digit ids on startup; legacy schedules are assigned to the main agent.
