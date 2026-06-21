# Subagent Orchestration Swarms

## 1. Introduction: The Power of Multi-Agent Collaboration

Generative artificial intelligence has reached a level of cognitive intelligence where it can write code, debug errors, and automate processes. However, a single Large Language Model (LLM) thread suffers from structural limitations:
* **Context Overload:** As the conversation grows longer, historical messages consume the active token limit, inflating execution latency and increasing the risk of the model forgetting early instructions.
* **Single-Threaded Execution:** A single model can only execute tool calls sequentially. If a task requires searching multiple terms, scraping different documentation pages, and editing several source files, a sequential model becomes a severe time bottleneck.
* **Cognitive Focus:** Forcing a single model to switch between high-level task management, code generation, testing, and research causes cognitive confusion, leading to poor implementations.

Prism solves these limitations by implementing an **Autonomous Subagent Swarm** architecture. When faced with complex, multi-step requests, the primary model routes tasks to multiple concurrent background workers. These worker subagents collaborate inside a closed-loop system, executing tools in parallel, checking each other's work, and consolidating their findings. This document serves as the technical reference guide for Prism's subagent orchestration layer.

---

## 2. Spawning Mechanics and Parameter Validation

The entry point for spawning background workers is the `run_subagents` tool, declared in `toolsManifest.ts` and managed in the main process (`src/main/gemini.ts`).

### 2.1. Tool Signature
The tool signature requires a `quantity` parameter and dynamic prompt arguments:
```json
{
  "name": "run_subagents",
  "description": "Spawn sub-agents for parallel tasks.",
  "usage": "<tool_call>{\"type\":\"run_subagents\",\"quantity\":\"X\",\"prompt:1\":\"P1\",\"prompt:2\":\"P2\"}</tool_call>"
}
```

### 2.2. Main Process Parameter Scanner
Before the main process allows subagents to initialize, it runs a strict verification scan:
1. **Quantity Check:** It extracts the `quantity` value and verifies that it is a positive integer. If the AI passes a non-number, a negative value, or zero, the execution is blocked, and an error message is returned:
   `Argument "quantity" for "run_subagents" must be a positive integer.`
2. **Dynamic Prompt Validation:** The scanner checks if the number of prompt parameters exactly matches the requested quantity. For example, if `quantity = 3`, the tool call must contain precisely `prompt:1`, `prompt:2`, and `prompt:3` arguments. If any of these are missing, the validation fails:
   `Tool "run_subagents" is missing required arguments for quantity=X: prompt:Y.`
3. **Invalid Parameter Lock:** The scanner blocks any unexpected parameters starting with `prompt:` that exceed the requested quantity, preventing token bloat.

---

## 3. Subagent System Prompt Generation

Every spawned subagent runs in its own isolated LLM context. To define its boundaries and behavior, the main process calls `getSubagentSystemPrompt(modelKey, index, total)` in `src/main/systemTools.ts`.

The returned prompt combines:
* **Base System Tools Prompt:** Injects standard instructions regarding XML tool block formatting (`<tool_call>`) and path resolution rules.
* **Identity Token:** Sets the agent's identity index (e.g. `[IDENTITY]: Agent #1`).
* **Team Array:** Informs the subagent of its collaborators (e.g. `[TEAM]: Master Coordinator, Agent #0, Agent #2`).
* **Core Task Instruction:** Injects the specific prompt block passed from the master coordinator.
* **Group Chat Rules:** A set of strict protocols that govern how the subagents must behave inside the swarm.

---

## 4. The Closed-Loop Group Chat Protocol

Subagents do not communicate with the user directly. Instead, they operate inside a shared, asynchronous group chat channel. This interaction is guided by nine strict rules injected into their system prompts:

### 4.1. Rule 1: Async Collaboration
The tool `send_group_message` acts as the shared working memory for the swarm. Subagents are prohibited from working in silence. Every message posted must advance the group's state: reporting plans, sharing command logs, stating file changes, or raising blocking decisions.

### 4.2. Rule 2: Staying Alive
Because subagents execute asynchronously, their lifecycle is tied directly to active tool calls. If an agent needs to wait for a peer’s output, it must post a status update message (`status="working"`) and immediately invoke the `wait_for_updates` tool in the *same* response. If it fails to call a tool, its thread terminates.

### 4.3. Rule 3: Mandatory Communication
Before executing any local tool (such as editing a file or running a terminal command), the subagent must output a short plan to the group chat. This allows other agents to know who is working on what, preventing merge conflicts on code files.

### 4.4. Rule 4: Closed-Loop Sync
When new messages arrive from other agents, they are marked as `[UNREAD MESSAGES]` in the subagent's input context. Subagents must acknowledge these updates, incorporate the peer data into their next tool run, and adjust their course immediately if the Master Coordinator directs them to.

### 4.5. Rule 5: Waiting Discipline
Subagents are forbidden from "spin-waiting" (generating useless conversational text in a loop to wait). They must use the `wait_for_updates` tool, which pauses execution for a configured duration (up to 180 seconds) or until a new message is broadcast.

### 4.6. Rule 6: Peer Exit Permission Protocol (Crucial Safeguard)
To prevent agents from exiting prematurely before their tasks are verified, Prism implements a **Peer Exit Permission** protocol.
* **The Request:** An agent cannot simply declare itself done. It must post an exit request to its peers (e.g., "I have finished refactoring the database layer. Do you need anything else or can I exit?").
* **The Wait:** While waiting for a response, it sets its status to `working` and calls `wait_for_updates`.
* **The Review:** Peer subagents check the request against their own progress.
* **The Grant:** If all other active workers reply with explicit consent (e.g., "Yes, you can exit"), the requesting agent is permitted to terminate. If any peer rejects (e.g., "Wait, I need you to verify this import path"), the agent must remain active and help.

### 4.7. Rule 7: Individual Termination
Once exit permission is granted, the subagent sends a final message with `status="done"` or `status="error"` containing a summary of its work, evidence, changed files, and remaining risks. Its thread then terminates, freeing system resources.

### 4.8. Rule 8: Peer Review
Active agents are required to monitor the chat for peer exit requests, ensuring that they review their teammates' code or data outputs before letting them exit.

### 4.9. Rule 9: No Subagent Spawning
To prevent runaway CPU exhaustion, subagents are blocked from calling `run_subagents` recursively. Only the Master Coordinator can spawn agents.

---

## 5. IPC Message Broadcasting and UI State Sync

The communication bus of the swarm is managed via Electron’s Inter-Process Communication (IPC) channels.

```
       +------------------+                    +------------------+
       |   Subagent #0    |                    |   Subagent #1    |
       | (Node Worker/LLM)|                    | (Node Worker/LLM)|
       +--------+---------+                    +--------+---------+
                |                                       |
     ipcRenderer.send('subagent-message-broadcast', messageData)
                |                                       |
                v                                       v
       +----------------------------------------------------------+
       |                       Main Process                       |
       |  - Listens to 'subagent-message-broadcast'               |
       |  - appends message to subagentChatLog Array              |
       |  - Emits 'subagent-chat-updated' event                   |
       +------------------------+---------------------------------+
                                |
                   window.api.onSubagentChatUpdated()
                                |
                                v
       +----------------------------------------------------------+
       |                     Renderer Process                     |
       |  - React updates active views in Right Sidebar Panel     |
       |  - Renders real-time message bubbles and task checklists  |
       |  - User can type and broadcast messages back to swarm    |
       +----------------------------------------------------------+
```

### 5.1. The Data Interface (`SubagentChatLogEntry`)
Messages sent through the broadcast channel match the following structure:
```typescript
interface SubagentChatLogEntry {
  senderIndex: number | 'user' | 'master' // Identity source
  senderName: string                       // e.g. "Agent #1"
  message: string                         // The actual text payload
  timestamp: number                       // Unix epoch milliseconds
  status: 'working' | 'done' | 'error'    // Current lifecycle state
}
```

### 5.2. UI Panel Rendering
When the main process receives a subagent message, it appends it to a local thread log and broadcasts it to the renderer. The renderer React process catches this event and:
* Updates the right sidebar panel state, drawing chat bubbles with customized theme backgrounds depending on the sender index.
* Renders real-time progress indicators (spinning glows for `working`, checkmarks for `done`, warning icons for `error`).
* **User Intervention:** If the user notices a subagent going off-track, they can click on the subagent input panel, type a message, and submit it. This message is broadcast via IPC with `senderIndex: 'user'`. The subagents intercept the unread message in their next loop, allowing the human to correct them in real-time.

---

## 6. Swarm Error Handling and Timeouts

Operating a local multi-agent system introduces real-world variables such as infinite compiler loops, broken network sockets during scrapes, and rate limit freezes. Prism implements three layers of error resilience:

### 6.1. Individual Tool Timeout Guards
Every local command or browser scraper executed by a subagent is bounded by the same sandbox rules as the main model. Specifically:
* **Terminal Command Limit:** If a subagent runs a local test suite or compiler that hangs, the child process is automatically terminated after **5 minutes** (300,000 ms), returning a timeout error back to the subagent's prompt context.
* **Playwright Scraping Limit:** Headless browser actions are locked to a **30-second** network load limit, preventing dead network streams from locking the subagent loop.

### 6.2. Swarm Recovery Loops
If an individual subagent encounters a terminal error (e.g., API key quota exhausted or file write permissions denied), it broadcasts a status update: `status="error"`. 
* The peer agents intercept this broadcast.
* If a critical dependency is broken, peer agents can choose to take over the task, rewrite the target file, or raise an alert.
* If an agent crashes completely without executing a clean exit, the main process detects the orphan promise, writes a termination tombstone to the log, and allows the remaining agents to continue their consolidation cycle, preventing the entire swarm from locking up.

---

## 7. Concrete Swarm Collaboration Walkthrough

To illustrate the peer collaboration protocol, let us trace a two-agent swarm tasked with updating an API route.

1. **Initialization:** The Master Coordinator spawns `Agent #0` (Research & Docs) and `Agent #1` (Coder).
2. **Step 1 (Agent #0):**
   * *Broadcasts:* "I am starting research on the new API schema rules."
   * *Action:* Calls `web_search` to find documentation.
   * *Broadcasts:* "Found schema rules. Writing to draft_schema.json."
   * *Action:* Calls `computer_use_create_file` to write the draft.
   * *Broadcasts:* "Schema written. Agent #1, please review and implement in routing file."
   * *Action:* Calls `wait_for_updates` (enters sleep state).
3. **Step 2 (Agent #1):**
   * *Syncs:* Intercepts Agent #0's broadcast.
   * *Broadcasts:* "I see draft_schema.json. Beginning implementation in api_routes.ts."
   * *Action:* Calls `computer_use_edit_file` to apply the updates.
   * *Broadcasts:* "Implementation done. running compilation checks."
   * *Action:* Calls `execute_terminal_command` (`npm run build`).
   * *Broadcasts:* "Build passed! Agent #0, I am done. Do you need anything else or can I exit?"
   * *Action:* Calls `wait_for_updates` (enters sleep state).
4. **Step 3 (Agent #0):**
   * *Syncs:* Wakes up, sees Agent #1's request to exit.
   * *Broadcasts:* "Checked build outputs. Everything looks clean. Yes, Agent #1, you can exit. I am preparing the final report."
   * *Action:* Exits thread with `status="done"`.
5. **Step 4 (Agent #1):**
   * *Syncs:* Receives exit permission.
   * *Broadcasts:* "Permission received. Exiting swarm."
   * *Action:* Exits thread with `status="done"`.
6. **Consolidation:** The main process receives both `done` statuses, completes the promise loop, and returns the unified session transcript to the Master Coordinator, who displays the final success report.
