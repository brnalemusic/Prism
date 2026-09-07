# Harness Plan Mode

Harness sessions have two project-scoped phases: **Plan** and **Build**. The phase is persisted with the session and restored when its history is reopened. Existing Harness sessions default to Build.

## Entering Plan

Use the **Plan / Build** control in the Harness InputBar, or send `$plan`. A request can be started directly with `$plan <request>`; Prism consumes the command prefix and sends only the request to the model.

Plan is enforced as read-only by the main process, independently of the project's Ask, Independent, or YOLO permission profile. The model can inspect project files, search, ask questions, use web search, and run a conservative allowlist of read-only terminal commands. File mutation tools and commands that are not provably read-only are rejected.

## Native Implementation Plan

The Harness model publishes a completed plan through the native `plan` tool. Prism renders its Markdown in a dedicated review surface that temporarily replaces the Harness InputBar while review is pending. The conversation remains visible, the plan body scrolls independently, and the action area remains available at the bottom.

The review surface uses the same Markdown pipeline as completed chat messages, including GFM, raw HTML handling, and KaTeX for inline (`$...$`) and display (`$$...$$`) LaTeX.

- **Accept & Continue** approves the plan, transitions the current session to Build, and sends the single implementation request for the approved plan in the same chat. The transition is confirmed through a structured binding before Build starts, so the phase is consistent even if the session is reloaded mid-handoff; a failed start keeps the approved plan available for retry.
- **New Build Chat** prepares complementary context from the entire source conversation, creates a clean Build session in the exact same project, and automatically sends the approved plan plus that context for implementation. The source session remains in Plan, and any linked Git recovery travels with the plan to the new chat.
- **Request changes** sends a revision request while keeping the session in Plan. The request can also be sent with `Ctrl+Enter` or `Cmd+Enter`.
- **Cancel** sends no new model request, stops active preparation when necessary, and dismisses the pending plan while leaving the session in Plan.

While a plan is being prepared or revised, Prism shows a matching loading state and keeps cancellation available. If handoff preparation fails, the source session and plan remain available for retry. After approval, the InputBar returns and the approved plan remains available as a compact expandable summary.

## Git conflict plans

When Git Control detects a conflicted merge, rebase, pull, Sync, or cherry-pick, it pauses the operation and lists the affected files. **Resolve with AI** opens a new Harness conversation in the same project directly in Plan, bound to the Git recovery from its first message. The Plan session persists before the first request is dispatched, so the confirmed phase is reflected in the frontend immediately and after loading history. The initial Markdown request contains the branch, upstream, ahead/behind counts, pending operation, and conflicted files.

The conflict session follows the same read-only Plan rules described above. It can inspect the repository and ask questions, but it cannot modify files until the user approves the generated plan with **Accept & Continue** or starts a **New Build Chat**.

### Linked recovery lifecycle

Approval binds the recovery, the approved plan, and the Build execution together: the binding is validated against the source session's published plans, the approved Build's completion (including still-running terminal tasks) is associated by run identifier, and a cancelled or incomplete Build can never enable Retry. After the linked Build response, a native recovery card appears in that conversation with **Retry** primary and **Abort** secondary, restoring its state from the backend. The recovery, plan, and execution association survives restarts, and duplicate events never duplicate the card. During Build, the resolution may stage only resolved conflict paths; continuation, commit, push, and abort stay with Git Control's user-triggered Retry.

## Harness Questions

The `to_ask` tool supports `essay`, `multiple-choice`, and `multiple-select`. Choice options have a short title, a separate explanatory description, and an optional **Recommended** marker selected by the model when one option is clearly best. A multiple-select question may provide `max_selections`; omitting it allows any number of selections. Prism always appends **Write your own answer** to both choice modes. The custom answer must be non-empty when selected and counts toward a multiple-select limit.
