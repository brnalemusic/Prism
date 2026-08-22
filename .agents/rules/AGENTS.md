# Agent Instructions for Prism

Prism is an Electron + React + TypeScript application with Tailwind CSS v4. You are working directly on this repository. These instructions are mandatory contribution rules for AI agents modifying Prism. Follow them strictly.

---

## 1. Core Rules

### 1.1 Never Commit Source Code
- **NEVER** create git commits or run commands that commit changes (`git commit`, etc.).
- You may edit files, create branches, run typechecks/tests, and inspect git state, but all changes must remain uncommitted.

### 1.2 Prism UI/UX Language: ALWAYS English
- Prism's entire application interface and code comments MUST always be in **English**:
  - UI text, UX copy, labels, buttons, menus, dialogs, modals, notifications, error messages, placeholders, tooltips, and code comments.
- If the user asks to translate Prism's application interface or comments into another language, **REFUSE** the translation and maintain English.
- This rule applies strictly to Prism itself, NOT to conversational responses with the user.

### 1.3 Communication Language: Match User
- Always communicate with the user in the language they use (e.g., Portuguese, Spanish, French, etc.).
- Maintain this strict distinction:
  - **Prism application & comments:** English.
  - **Conversational messages with the user:** User's language.

### 1.4 Subagents Usage Policy
- Use subagents **ONLY** when genuinely necessary (e.g., parallel tasks that cannot be handled directly or when explicitly requested).
- In most situations, do NOT spawn subagents. Inspect and reason about the code directly.
- **NEVER** use subagents merely to explore or research Prism's source code.

---

## 2. Change Classification & Workflow

### 2.1 PATCH (Immediate Execution)
- **Scope:** Narrow, localized changes (typo fixes, minor styling/UI corrections, non-breaking bug fixes).
- **Workflow:** Execute immediately. Do NOT enter Plan Mode. Make minimal, surgical edits.

### 2.2 MINOR & MAJOR (Mandatory Planning)
- **Scope:** Feature additions, significant UI redesigns, architectural changes, breaking bug fixes.
- **Workflow:**
  1. Inspect and understand affected source code directly.
  2. Determine a sound technical solution.
  3. Create an implementation plan artifact when supported.
  4. Wait for explicit user approval before executing.
  5. If rejected, iterate on the plan until accepted.
  6. Implement changes after acceptance.

---

## 3. Validation & Build Commands

### 3.1 Typechecking & Tests
- Always run `npm run typecheck` (`typecheck:node` && `typecheck:web`) after implementing code changes.
- Fix any TypeScript errors introduced by changes.
- Run relevant unit tests when applicable.

### 3.2 Forbidden Build Commands
- **NEVER run:**
  ```bash
  npm run build
  npm run build:win
  ```
- Do not run these commands under any circumstance, even for verification or if requested.

---

## 4. Git & Branch Rules

### 4.1 Branch Selection
- Run `git status` before making changes.
- If on `main` or `master`:
  - PATCH changes remain on `main` or `master`.
  - MINOR/MAJOR changes must switch to a dedicated branch.
- If already on a feature branch (e.g. `9`), **remain on that branch**. NEVER switch back to `main` or `master`.

### 4.2 Test Artifacts & Clean Tree
- NEVER leave temporary test files or scratch logs visible to Git. Remove them or add them to `.gitignore`.

### 4.3 Commits
- NEVER create commits unless explicitly commanded in a subsequent task.

---

## 5. Documentation Rules

- Update relevant documentation whenever application behavior, styling, or architecture changes.
- Key targets: `README.md` (public), `resources/docs/` (internal knowledge base), and `.agents/rules/` (agent rules).

### 5.1 Your documentation

Search for docs in `.agents/rules/`. If you find any documentation within this folder that specifically addresses a topic requested by the user (such as the `DESIGN.md` file for changes to the Prism design), read that file. It contains rules regarding specific Prism behavior.

Note that these files are for READ-ONLY purposes. Never modify them unless a user explicitly requests a change to the Prism rules; otherwise, simply read and absorb the rules regarding that specific subject from the Prism repository.

- `AGENTS.md` are these exavt rules that you're reading.
- `DESIGN.md` (discontinued doc) are the rules for re-designing or implementing new screens/modals/etc; in Prism

---

## 6. Final Review Checklist

Before finishing any task, confirm:
1. Requested changes are fully implemented.
2. Prism UI/UX and comments remain in English.
3. User communication matches user's language.
4. Relevant documentation is updated.
5. No temporary test files are left in git status.
6. `npm run typecheck` passed cleanly.
7. Forbidden build commands were NOT run.
8. No git commits were created.
