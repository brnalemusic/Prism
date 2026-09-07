# Harness Git Control

Harness Git Control is the compact Source Control surface beside the Harness project selector. It operates only inside the selected, registered Harness project and never stores GitHub credentials. GitHub pull requests use the authenticated local `gh` CLI session.

The control renders through a viewport-aware portal so it is not clipped by the Harness input area. The Git Control panel opens beside the trigger, preferring its right side and falling back to the left when the viewport is constrained. Its lower edge stays anchored just below the trigger, so dynamic commit-message height grows upward and then scrolls internally instead of making the panel drift. Internal branch and commit pickers open downward as floating dropdowns, so they never resize the panel. Branches, commits, PR bases, confirmations, and destructive actions use Prism-owned controls rather than operating-system selects or prompts.

## Project synchronization

`harness.lastProjectPath` is the persisted active-project source. Project activation updates that value, bumps the selected project's recent timestamp, broadcasts `config-changed` to Prism windows, and updates the active Harness tab. Manage Projects, Settings, the mini-selector, startup resolution, and Harness tab focus share this activation flow.

A tab carrying a Harness context snapshot cannot change to a different project. Prism keeps its original project and asks the user to start a new Harness conversation instead. Changing a compatible tab clears its Explorer context.

## Git actions

The main process executes Git with `execFile` and explicit argument arrays; it never builds shell command strings. The status snapshot includes the checked-out branch, upstream and ahead/behind counts, changed and conflicted files, local and remote branches, remotes, recent commits, signing configuration, and in-progress merge, rebase, or cherry-pick state.

- **Sync** performs fetch with prune, pull with rebase, then push. Pull and Push stay available as individual actions.
- **Merge** always targets the currently checked-out branch. The selected branch is the source: to merge `9` into `main`, switch to `main` first and then choose `9` in Merge. Git Control does not switch branches as part of the merge.
- **Commit** stages with `git add .`. An empty message generates an AI message from the active Harness model and commits immediately. The sparkle button instead generates an editable draft. While either AI generation flow is running, a centered opaque status layer blocks Git operations until the text is ready; the panel itself can still be closed and reopened without interrupting generation. The commit message field grows with its content up to 300 pixels and then scrolls internally.
- Signing follows local `commit.gpgsign`; Sign-off is opt-in. **Breno as co-author** is enabled by default and adds `Co-authored-by: Breno Alexandrē <brenoalexandre.music@gmail.com>` only to commits created by Git Control. GitHub links that verified e-mail to `https://github.com/brnalemusic`; the control does not reveal the e-mail in its compact UI. Existing commits are never rewritten and force push is not exposed.
- Local and remote branches can be selected, created, renamed, checked out, fetched, and removed. Merge is available through the typed action API.
- Reset supports soft and hard modes. Branch deletion and reset require typing the target value in the confirmation prompt.
- Pull requests use `gh pr create`; the base defaults to the remote default branch and can be edited by the CLI prompt. On `main` or `master`, Git Control requires a new working branch before a PR can be opened.
- Merge, Pull, and Sync require a clean index and working tree; Prism never stashes automatically. The Commit action stages all changes — that breadth is explicit and is separate from recovery, whose staging is restricted to the resolution.
- Before mutating, Prism resolves and records the remote, branch, and ref each operation targets, so a later Retry cannot be redirected by a screen selection that changed in the meantime. Git exit codes and output are validated: a failed status read never counts as a clean repository.

## Conflicts and recovery

Any detected conflict or in-progress Git operation blocks further mutating actions and opens recovery immediately — the Merge form does not need to be closed first, and paused operations are distinguished from ordinary errors instead of everything being labeled a conflict.

Recovery state is tracked by the main process and persisted in Prism's local storage (outside versioned files) with atomic writes. Git remains the authority over files, the index, and references; the Prism record explains intent and progress and never replaces real inspection. Repositories and worktrees are identified by canonical paths, and operations that share Git references are coordinated across worktrees.

- **Resolve with AI** opens the native Plan workflow bound to the recovery. While the conflict session is being opened, the Git Control panel and the recovery card show a dedicated loading state. After approval, Build runs in the same or a new chat while the recovery keeps the association; Retry unlocks only after that Build finishes successfully and the staged resolution passes checks (resolved files staged, no unmerged entries, no unrelated index changes, plan checks recorded). A Build is marked incomplete only when a mutating tool breaks or the turn is aborted or hits the tool-loop limit; non-zero exits from read-only inspection commands and from verification commands are treated as diagnostics and never poison the Build on their own.
- **Retry** continues the pending native operation (`merge --continue`, `rebase --continue`, `cherry-pick --continue`); it never replays the original operation. Each Retry executes one step: after a Sync recovers the local integration, Push requires a separate confirmation, and a rejected Push first offers Pull with rebase under explicit authorization. New conflicts return the recovery to resolution without starting another AI run.
- **Abort** requires typed confirmation that the resolution may be discarded, uses the matching native abort for local operations, and for a rejected Push or pending upload only ends the tracked attempt while preserving local commits. Prism never creates automatic backups, removes external locks, force pushes, or discards files as automatic recovery; if abort fails, the state is preserved and the error shown.
- External completion disables the recovery controls, a superseded operation invalidates the old recovery, and externally created pending operations can be recovered without an invented Pull or Sync intent. Restarting Prism reconciles state without automatically resuming mutations.

The recovery card also appears in the linked Harness conversation after the connected Build response, with **Retry** primary and **Abort** secondary; the Git Control panel exposes the same controls, backed by the same capabilities and commands. During an action, progress is shown and concurrent Git commands are blocked; the card collapses into a compact result record afterwards.

## Operational boundaries

Git Control does not persist credentials, create force pushes, rewrite existing commits, or automatically resolve conflicts. It reports missing Git repositories, unavailable GitHub CLI authentication, and command failures in the panel without exposing tokens or local credential data. Late results from another project never replace the current snapshot, and recovery coordination rejects concurrent continuations so double clicks, parallel chats, or multiple windows cannot run two continuations at once.

The active project's Git status refreshes on mount, after every Git action, when Prism regains focus, when the document becomes visible, and on a lightweight interval. Background refreshes first compare a compact Git metadata fingerprint; working-tree changes are reconciled per file while branch, commit, remote, and configuration changes trigger a complete metadata refresh. Overlapping reads are prevented and unchanged snapshots are deduplicated before renderer updates. Background refresh failures keep the last valid snapshot visible, and Prism requires consecutive unavailable reads before replacing an active repository with an unavailable state.
