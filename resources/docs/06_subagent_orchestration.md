# Sub-Agent Swarm Orchestration (Deprecated)

> [!NOTE]
> **Deprecation Notice:** Sub-agent swarm orchestration (`run_subagents`, `send_group_message`, `read_group_messages`, `wait_for_updates`) has been completely deprecated and removed in Prism v7.1.0.
>
> All task execution, terminal commands, web search, file mutations, and tool calls are now executed directly within the primary assistant context.

## Historical Architecture Summary

In earlier versions of Prism (v6.x - v7.0.0), subagent swarm orchestration allowed the main coordinator model to spawn nested background worker agents for parallel task execution. The feature has been discontinued to streamline single-agent execution, reduce resource overhead, and eliminate redundant inter-agent IPC message passing.