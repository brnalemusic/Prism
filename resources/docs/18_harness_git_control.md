# Harness Git Control

Harness Git Control is the compact Source Control surface beside the Harness project selector. It operates only inside the selected, registered Harness project and never stores GitHub credentials. GitHub pull requests use the authenticated local `gh` CLI session.

The control renders through a viewport-aware portal so it is not clipped by the Harness input area. It opens above or below its trigger based on available space. Branches, commits, PR bases, confirmations, and destructive actions use Prism-owned controls rather than operating-system selects or prompts.

## Project synchronization

`harness.lastProjectPath` is the persisted active-project source. Project activation updates that value, bumps the selected project's recent timestamp, broadcasts `config-changed` to Prism windows, and updates the active Harness tab. Manage Projects, Settings, the mini-selector, startup resolution, and Harness tab focus share this activation flow.

A tab carrying a Harness context snapshot cannot change to a different project. Prism keeps its original project and asks the user to start a new Harness conversation instead. Changing a compatible tab clears its Explorer context.

## Git actions

The main process executes Git with `execFile` and explicit argument arrays; it never builds shell command strings. The status snapshot includes the checked-out branch, upstream and ahead/behind counts, changed and conflicted files, local and remote branches, remotes, recent commits, signing configuration, and in-progress merge, rebase, or cherry-pick state.

- **Sync** performs fetch with prune, pull with rebase, then push. Pull and Push stay available as individual actions.
- **Commit** stages with `git add .`. An empty message generates an AI message from the active Harness model and commits immediately. The sparkle button instead generates an editable draft.
- Signing follows local `commit.gpgsign`; Sign-off is opt-in. **Breno as co-author** adds `Co-authored-by: brnalemusic <brenoalexandre.music@gmail.com>` only to commits created by Git Control. Existing commits are never rewritten and force push is not exposed.
- Local and remote branches can be selected, created, renamed, checked out, fetched, and removed. Merge is available through the typed action API.
- Reset supports soft and hard modes. Branch deletion and reset require typing the target value in the confirmation prompt.
- Pull requests use `gh pr create`; the base defaults to the remote default branch and can be edited by the CLI prompt. On `main` or `master`, Git Control requires a new working branch before a PR can be opened.

## Conflicts

Any detected conflict or in-progress Git operation blocks further mutating actions. The panel offers Abort, Open project, and Resolve with AI. Abort selects the matching Git abort command for merge, rebase, or cherry-pick. Resolve with AI opens the native Plan workflow and leaves execution gated behind the standard approval actions.

## Operational boundaries

Git Control does not persist credentials, create force pushes, rewrite existing commits, or automatically resolve conflicts. It reports missing Git repositories, unavailable GitHub CLI authentication, and command failures in the panel without exposing tokens or local credential data.

The active project's Git status refreshes on mount, after every Git action, when Prism regains focus, when the document becomes visible, and on a lightweight interval. Overlapping reads are prevented and unchanged snapshots are deduplicated before renderer updates.
