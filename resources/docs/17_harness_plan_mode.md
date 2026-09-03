# Harness Plan Mode

Harness sessions have two project-scoped phases: **Plan** and **Build**. The phase is persisted with the session and restored when its history is reopened. Existing Harness sessions default to Build.

## Entering Plan

Use the **Plan / Build** control in the Harness InputBar, or send `$plan`. A request can be started directly with `$plan <request>`; Prism consumes the command prefix and sends only the request to the model.

Plan is enforced as read-only by the main process, independently of the project's Ask, Independent, or YOLO permission profile. The model can inspect project files, search, ask questions, use web search, and run a conservative allowlist of read-only terminal commands. File mutation tools and commands that are not provably read-only are rejected.

## Native Implementation Plan

The Harness model publishes a completed plan through the native `plan` tool. Prism renders its Markdown in a dedicated review panel with four actions:

- **Accept & Continue Here** approves the plan and changes the current session to Build.
- **Accept & Continue in New Chat** prepares complementary context from the entire source conversation, creates a clean Build session in the exact same project, and automatically sends the approved plan plus that context for implementation.
- **Send Feedback** sends a revision request while keeping the session in Plan.
- **Cancel** sends no new model request, stops active preparation when necessary, and dismisses the pending plan while leaving the session in Plan.

If handoff preparation fails, the source session and plan remain available for retry.

## Harness Questions

The `to_ask` tool supports `essay`, `multiple-choice`, and `multiple-select`. Choice options have a short title, a separate explanatory description, and an optional **Recommended** marker selected by the model when one option is clearly best. A multiple-select question may provide `max_selections`; omitting it allows any number of selections. Prism always appends **Write your own answer** to both choice modes. The custom answer must be non-empty when selected and counts toward a multiple-select limit.
