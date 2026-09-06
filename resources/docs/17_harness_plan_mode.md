# Harness Plan Mode

Harness sessions have two project-scoped phases: **Plan** and **Build**. The phase is persisted with the session and restored when its history is reopened. Existing Harness sessions default to Build.

## Entering Plan

Use the **Plan / Build** control in the Harness InputBar, or send `$plan`. A request can be started directly with `$plan <request>`; Prism consumes the command prefix and sends only the request to the model.

Plan is enforced as read-only by the main process, independently of the project's Ask, Independent, or YOLO permission profile. The model can inspect project files, search, ask questions, use web search, and run a conservative allowlist of read-only terminal commands. File mutation tools and commands that are not provably read-only are rejected.

## Native Implementation Plan

The Harness model publishes a completed plan through the native `plan` tool. Prism renders its Markdown in a dedicated review surface that temporarily replaces the Harness InputBar while review is pending. The conversation remains visible, the plan body scrolls independently, and the action area remains available at the bottom.

The review surface uses the same Markdown pipeline as completed chat messages, including GFM, raw HTML handling, and KaTeX for inline (`$...$`) and display (`$$...$$`) LaTeX.

- **Accept & Continue** approves the plan and changes the current session to Build.
- **New Build Chat** prepares complementary context from the entire source conversation, creates a clean Build session in the exact same project, and automatically sends the approved plan plus that context for implementation.
- **Request changes** sends a revision request while keeping the session in Plan. The request can also be sent with `Ctrl+Enter` or `Cmd+Enter`.
- **Cancel** sends no new model request, stops active preparation when necessary, and dismisses the pending plan while leaving the session in Plan.

While a plan is being prepared or revised, Prism shows a matching loading state and keeps cancellation available. If handoff preparation fails, the source session and plan remain available for retry. After approval, the InputBar returns and the approved plan remains available as a compact expandable summary.

## Git conflict plans

When Git Control detects a conflicted merge, rebase, pull, Sync, or cherry-pick, it pauses the operation and lists the affected files. **Resolve with AI** opens a new Harness conversation in the same project directly in Plan. The initial Markdown request contains the branch, upstream, ahead/behind counts, pending operation, and conflicted files.

The conflict session follows the same read-only Plan rules described above. It can inspect the repository and ask questions, but it cannot modify files until the user approves the generated plan with **Accept & Continue** or starts a **New Build Chat**.

## Harness Questions

The `to_ask` tool supports `essay`, `multiple-choice`, and `multiple-select`. Choice options have a short title, a separate explanatory description, and an optional **Recommended** marker selected by the model when one option is clearly best. A multiple-select question may provide `max_selections`; omitting it allows any number of selections. Prism always appends **Write your own answer** to both choice modes. The custom answer must be non-empty when selected and counts toward a multiple-select limit.
