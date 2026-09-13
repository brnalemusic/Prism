# Sub-Agent Swarm Orchestration (Deprecated)

> [!NOTE]
> **Deprecation Notice:** Sub-agent swarm orchestration (`run_subagents`, `send_group_message`, `read_group_messages`, `wait_for_updates`) has been completely deprecated and removed in Prism 7.1.0.
>
> All task execution, terminal commands, web search, file mutations, and tool calls are now executed directly within the primary assistant context.

In earlier versions of Prism (v6.x - v7.0.0), subagent swarm orchestration allowed the main coordinator model to spawn nested background worker agents for parallel task execution.

---

## Prism 9.0: Inter-Chat Delegation & Autonomous Sub-Agents

Prism 9 introduces native inter-chat communication and sub-agent task delegation across both standard chat sessions and the Harness workspace.

### Core Capabilities

1. **Inter-Chat Messaging & Task Dispatch (`send_message_to_chat`)**:
   - Enables any agent in standard chat or Harness to dispatch asynchronous tasks or messages to other chat tabs or Harness workspaces.
   - **Target workspace:** `chat` (Execution or Discipline mode) or `harness` (Plan or Build mode).
   - **Target project path:** Optional for chat (activates Discipline mode), mandatory for Harness.
   - Automatic real-time notification with result summaries upon task completion or failure.

2. **Real-Time Progress Inspection (`read_chat_session`)**:
   - Inspect the live progress, execution status, message transcript, and API errors of any target chat.

3. **Sub-Agent Questionnaire Routing (`to_ask` & `answer_subagent_question`)**:
   - When a sub-agent calls `to_ask`, the questionnaire is rendered in the sub-agent's tab without displaying disruptive popups in the supervising chat.
   - The question is routed directly to the supervising agent (or to Discord Voice AI).
   - The supervising agent can either answer directly or query the user first, then submit answers using `answer_subagent_question`.

4. **Task Control & Safe Abort (`cancel_subagent_task`)**:
   - Supervising agents can abort a delegated task at any time.
   - Immediately cancels model generation, terminates associated background terminal processes, and rejects pending questionnaires.

5. **Implementation Plan Approval (`approve_harness_plan`)**:
   - When a sub-agent completes an implementation plan in Harness Plan mode, the supervising agent can review and approve it.
   - Supports `same_chat` (seamless continuation in Build mode) and `new_chat` (fresh context tab with full plan handoff).