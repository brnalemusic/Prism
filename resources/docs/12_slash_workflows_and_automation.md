# Slash Workflows and Custom Automation Guide

## 1. Overview: Custom AI Slash Commands

Prism allows users to create state-driven **Slash Workflows** that inject tailored system instructions and constrain allowed tools for specific tasks.

Workflows can be managed dynamically via chat tools or System Settings.

---

## 2. Slash Workflow Management Tools

Prism provides three native tools for workflow control:

### 2.1. `list_workflows`
Returns all configured custom slash workflows in the application.

### 2.2. `save_workflow`
Creates a new workflow or updates an existing one:
- `command`: Slash command trigger starting with `/` (e.g. `/summarize`, `/refactor`, `/audit`).
- `name`: Human-readable name.
- `description`: Brief description of workflow objective.
- `systemInstruction`: System instructions injected into prompt payload when active.
- `toolConstraints`: Optional array of allowed tool names (e.g. `['web_search', 'web_fetch']`). If omitted, all tools remain available.

### 2.3. `delete_workflow`
Deletes a custom workflow by command or ID.

---

## 3. Built-In Default Workflows

| Command | Name | Goal / System Instruction | Tool Constraints |
| --- | --- | --- | --- |
| `/search` | Search | Perform deep web research on a topic | `web_search`, `web_fetch`, `open_browser_link` |
| `/summarize` | Summarizer | Extract key points, check errors, and format structured summaries | All tools allowed |

The Search workflow uses `web_fetch` for deep research with exactly five queries and up to ten readable Sources per query (up to 50 Sources total). Up to 15,000 characters from each Source are provided to the research subagent. For standard `web_search` calls, the model sets `resultCount` from 1 to 10; 2–4 is recommended, while 5–8 is reserved for specific cases.
