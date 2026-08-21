# Agent Instructions for Prism

Prism is an Electron + Vite application. You are working directly on this repository, and this file defines the rules and workflow you MUST follow when modifying Prism.

These instructions are contribution rules for AI agents working on the project. Follow them strictly.

## 1. Core Rules

### 1.1 Never Commit Source Code

NEVER create commits or commit source-code changes.

You may modify files, create branches, run checks, and inspect Git state, but you MUST NOT run commands that create commits.

### 1.2 Prism UI/UX Language

Prism's application language is ALWAYS English.

This applies to:

* UI text
* UX text
* labels
* buttons
* menus
* dialogs
* notifications
* error messages
* user-facing application text
* code comments

If the user asks you to translate any part of Prism's application interface or code comments into another language, REFUSE the translation and keep Prism in English.

This language rule applies ONLY to Prism itself. It does NOT apply to communication with the user.

You MUST communicate with the user in the language they use.

### 1.3 Communication Language

Always match the user's language when communicating with them or producing artifacts intended for communication with them.

The following distinction MUST always be maintained:

* Prism application: English.
* Prism code comments: English.
* Communication with the user: the user's language.

Do not confuse the language of the application with the language of the conversation.

### 1.4 Subagents

Use subagents ONLY when they are genuinely necessary.

In most situations, do NOT use subagents.

For source-code exploration, code checking, debugging, and repository research, inspect and reason about the code yourself whenever possible.

NEVER use subagents merely to research or explore Prism's source code.

Use a subagent ONLY when:

1. The task genuinely requires parallel or specialized work that cannot reasonably be handled directly; or
2. The user explicitly asks you to use subagents.

## 2. Change Classification

Before deciding how to execute a task, determine what type of change it is.

### PATCH

A PATCH is a small, localized change that does not materially alter Prism's behavior or architecture.

Examples include:

* typo fixes
* small UI corrections
* minor styling corrections
* straightforward bug fixes
* other narrowly scoped changes

PATCH changes are executed immediately. Do NOT enter Plan Mode for PATCH changes.

### MINOR

A MINOR update introduces a meaningful change to Prism but does not fundamentally change the application's architecture or core behavior.

MINOR updates require planning and normally require a dedicated branch when working from `main` or `master`.

### MAJOR

A MAJOR update introduces a substantial feature, architectural change, significant redesign, or another change that can materially affect multiple parts of Prism.

MAJOR updates require planning and normally require a dedicated branch when working from `main` or `master`.

### Bug Fixes

Bug fixes should be planned ONLY when fixing the bug requires a breaking change.

Non-breaking bug fixes are treated as PATCH changes and should be executed immediately without entering Plan Mode.

## 3. Development Workflow

The workflow depends on the change classification.

### PATCH Workflow

For PATCH changes, execute the work immediately.

Do not enter Plan Mode.

Before modifying files, understand the affected code and make the smallest appropriate change.

After implementation, perform the applicable validation steps described below.

### MINOR and MAJOR Workflow

For MINOR and MAJOR changes, planning is mandatory.

The workflow is:

1. Understand the user's request deeply.
2. Research and inspect the relevant Prism source code yourself.
3. Identify the areas of the codebase affected by the requested change.
4. Determine a technically sound solution.
5. Think carefully about the consequences of the proposed changes.
6. Explore viable implementation approaches when multiple approaches exist.
7. Compare the approaches and choose the best one.
8. Create a clear implementation plan.
9. Write the Implementation Plan artifact when the environment allows it.
10. Present the plan to the user and wait for acceptance before implementing.

Do NOT implement a planned MINOR or MAJOR change before the user accepts the plan.

### If the User Rejects the Plan

If the user does not accept the proposed plan, DO NOT implement it.

Reconsider the requirements and create a revised plan that addresses the user's concerns.

Repeat this process until the user accepts the plan.

### After Plan Acceptance

Once the user accepts the plan:

1. Reconsider the accepted plan and determine the safest implementation approach.
2. Implement the requested changes.
3. Run appropriate security checks.
4. Run `npm run typecheck`.
5. Correct any errors discovered during validation.
6. Test the changes whenever testing is reasonably possible.
7. Review the final changes and ensure they satisfy the original request.
8. Update the relevant documentation.
9. Finish the work without creating a commit.

The accepted plan is the implementation contract. If implementation reveals that the plan must materially change, stop and communicate the change before proceeding.

## 4. Validation and Commands

You MUST run `npm run typecheck` after implementing changes whenever the project state allows it.

Correct any type-checking errors introduced by your changes.

Run relevant tests whenever practical and available.

Perform appropriate security checks after implementation.

### Forbidden Build Commands

NEVER run:

```bash
npm run build
npm run build:win
```

Do not run these commands even when they appear useful for validation or even if the user's prompt asks to.

## 5. Git and Branch Rules

These rules apply to source-control operations.

### 5.1 Branch Selection

Before changing source code, run:

```bash
git status
```

If you are currently on `main` or `master`:

* PATCH changes MUST remain on `main` or `master`.
* MINOR and MAJOR changes MUST be performed on a new branch.

If you are already on another branch, remain on that branch.

NEVER switch from another branch back to `main` or `master`.

The only permitted direction of branch switching is from `main` or `master` to another branch when a dedicated branch is required.

Do NOT switch back to `main` or `master`, even for PATCH changes.

### 5.2 Test Files and Git State

NEVER leave temporary test files, test inputs, or test outputs visible to Git after testing.

After creating or using temporary test files:

1. Remove them when they are no longer necessary; or
2. Add the appropriate files, patterns, or directories to `.gitignore`.

This rule also applies to temporary test directories.

Do NOT permanently add generated test artifacts to the repository unless they are intentionally part of the project.

### 5.3 Commits

NEVER create commits.

All changes must remain uncommitted unless the user explicitly changes this instruction in a future task.

## 6. Documentation Rules

Documentation MUST reflect relevant changes made to Prism.

After implementing a change, inspect the repository documentation and determine whether the change requires documentation updates.

At minimum, consider:

* `README.md`
* `/resources/docs/`
* other relevant documentation files discovered in the repository

You MUST search the repository for relevant documentation instead of assuming that no documentation needs to be changed.

### 6.1 README.md

`README.md` is Prism's public documentation.

It is intended for Prism users, GitHub visitors, contributors, and other external readers.

Update it when a change affects information that users or contributors need to know.

### 6.2 Internal Documentation

Files inside:

```text
/resources/docs/
```

are Prism's internal documentation and knowledge base.

They describe how Prism works internally and are intended to provide knowledge to Prism AI and other AI agents about the application, its architecture, behavior, and implementation details.

This is useful in cases where a user is experiencing difficulties with Prism and reports the issue to the AI, but the AI does not know how to resolve it. In such instances, the AI consults its internal knowledge base, understands the workflow and how it operates, and—where possible—provides assistance tailored to the user's specific problem.

When a change modifies internal behavior, architecture, workflows, or other information relevant to Prism AI's understanding of the application, update the appropriate internal documentation.

Do NOT treat `/resources/docs/` as public-facing documentation unless a specific file explicitly serves that purpose.

## 7. Final Review

Before finishing any task:

* Confirm that the requested change was actually implemented.
* Confirm that Prism's UI/UX remains in English.
* Confirm that code comments remain in English.
* Confirm that relevant documentation was updated.
* Confirm that temporary test artifacts are not left in Git's scan.
* Confirm that `npm run typecheck` was run when applicable.
* Confirm that forbidden build commands were not executed.
* Confirm that no commit was created.
* Confirm that the final repository state is consistent with these instructions.

These rules apply to every task performed on Prism unless the user explicitly provides a higher-priority instruction that changes a specific rule.
