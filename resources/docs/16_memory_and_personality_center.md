# Memory & Personality Center (M1 + M2)

Status: **COMPLETE** — M1 personality center and the full M2 memory center are shipped:
engine (`memoryCore.ts`), store + recall/trigger wiring (`memoryStore.ts`, `chatHandler.ts`,
`discordGateway.ts`, `systemTools.ts`), IPC/preload surface, and the Settings → Memory UI
(SettingsView). Recall blocks ride every Chat/Discord text turn and voice session (re)connect
with budgeted top-K; pinned facts ride the always-on `# Core Profile`; `observeCompletedTurn`
fires after each completed turn (never Harness, never error paths). Verification: `npm run
test:memory` (38/38) + `test:persona` (9/9), typecheck node+web clean, real-data catch-up over
18 chats (0 errors), headless E2E chain (extraction → store → recall + pinned core blocks),
dev boot without renderer errors. Shipped after that: the AI `memory` tool
(add/replace/remove over the USER.md/MEMORY.md analogs via the store service, credential gate,
budgets 1375/2200, never writes `possible`) plus token-cheap active-save guidance on the persona
surfaces. Detector robustness rework (shipped): high-precision first-person facts now auto-commit
(slot/preference weights 0.85, the old conservative floor removed), the review queue keeps only
hypotheticals, narrow temporals and soft conflicts, multi-intent turns split per factKey, and a
65-case adversarial PT/EN corpus is a permanent suite test. The current implementation also
includes a periodic model-based curator with independent review checkpoints, explicit `user` and
`memory` stores, sanitized multi-role deltas, multi-decision writes, configurable routing and a
global review status. Remaining: live GUI click-through and a real-provider end-to-end proof.

Constraint reminders that apply to every step:

- Immediate extraction, ranking and decay remain **heuristics + statistics only**. The separate periodic reviewer uses a configured model and counts against normal model quota.
- Prism UI text and code comments stay in English. Conversation language matching is preserved in prompts.
- Never run `npm run build` / `build:win`. Run `npm run typecheck` and the focused test scripts. No git commits.

---

## 1. Product scope

A **Memory & Personality center** that gives Prism a consistent voice and cross-chat memory:

- **Personality (M1, done):** preset tone arsenal + tuning dials (proximity, formality, emoji level, humor, verbosity, slang), deterministic prompt compilation, local preview. Applies to Chat, Quick Launcher and Discord (text and live voice). **Never Harness.**
- **Memory (M2, done):** a local structured memory store, automatic heuristic extraction, periodic AI curation, contradiction invalidation, natural decay, per-turn recall injection, and a review UI in Settings.

---

## 2. M1 — Personality (implemented)

### 2.1 Files

| File | Change |
| --- | --- |
| `src/shared/persona.ts` | **New.** Pure module: `PersonaSettings`, `TonePresetId`, `TONE_PRESETS` (7 presets as style tokens), `compilePersona()` (≤110 words, guard clause), `buildPersonaPreview()` (LLM-free), `normalizePersona()`, `DEFAULT_PERSONA`, UI label maps. |
| `src/main/config.ts` | `AppConfig.persona: PersonaSettings`; default in `DEFAULT_CONFIG`; `normalizeConfig` backfills via `normalizePersona`. |
| `src/main/systemTools.ts` | `personaSection` block compiled from `loadConfig().persona` and appended to the `main`, `launcher` and `conversation` template branches of `getSystemToolsPrompt`. Guarded off for `target === 'subagent' | 'both'` and `sessionMode === 'harness'`. Also trimmed the main rules template **2,576 → 2,157 chars (−16.3%)** without removing behavioral rules. |
| `src/renderer/src/components/SettingsView.tsx` | New section `personality` (Settings > AI & Runtime > Personality & Tone): enable toggle, preset card grid, segmented tuning dials, slang segmented control, reset, live preview (chips + sample sentence + compiled block with word count). |
| `scripts/persona-validation.mts`, `package.json` | `npm run test:persona` — 9 unit tests (determinism, word budget, guard, per-dial effect, normalization clamps/backfill, preview emoji scaling). |

### 2.2 Compiled output shape

```
# Communication Style
<preset tokens, comma-joined>. [proximity: …] [register: …] [humor: …] [verbosity: …] [emojis: …] [slang: …]
Applies to tone and wording only — never overrides accuracy, safety, tool rules, or user-language matching.
```

Dimension values at their defaults are omitted (lean output). Empty string when `persona.enabled === false` → zero behavior change out of the box.

### 2.3 Surface matrix (M1)

| Surface | Path | Persona |
| --- | --- | --- |
| Main chat (execution/discipline/conversation) | `getSystemToolsPrompt(..., 'main', …)` in `chatHandler.ts` | ✅ |
| Quick Launcher | `getSystemToolsPrompt(..., 'launcher', …)` in `launcherHandler.ts` | ✅ |
| Discord text replies | `getSystemToolsPrompt` in `discordGateway.ts` (~L1772) | ✅ |
| Discord Gemini live voice (+ reconnect) | `getSystemToolsPrompt` embedded in `systemInstruction` (`discordGateway.ts` ~L1121/L1242); persona sits **before** the voice-conciseness suffix so spoken rules win conflicts | ✅ |
| Harness sessions | `getHarnessSystemPrompt` (`harnessPrompt.ts`) — separate path | ❌ never |
| Subagents / deep research / `both` | guarded in `getSystemToolsPrompt` | ❌ |

---

## 3. M2 — Memory (implemented)

### 3.1 Files

| File | Change | Responsibility |
| --- | --- | --- |
| `src/shared/memoryCore.ts` | **New.** Pure engine (no Electron): types, `MemoryConfig` + `normalizeMemoryConfig`, `runExtraction()`, scoring/tiers, contradiction resolution, decay math, recall `topK()`. Mirrors the `persona.ts` pattern so tests import it directly. | Rules, tiers, decay, recall |
| `src/main/memoryStore.ts` | **New.** Disk IO for `PrismDesktop/memory/memories.json` + per-chat watermark; CRUD (commit/suggest, pin, edit, archive, restore, delete); corrupted-file backup like `config.ts`; `observeCompletedTurn(chatId, workspace)` trigger with debounce. | Persistence + trigger |
| `src/main/config.ts` | `AppConfig.memory: MemoryConfig`, `DEFAULT_CONFIG.memory`, normalize. | Config |
| `src/main/index.ts` (+ preload `index.ts` / `index.d.ts`) | IPC handlers: `memory-list`, `memory-update`, `memory-delete`, `memory-toggle-auto`, `memory-stats`; broadcast `memory-write`/`memory-suggest` toast events to the renderer. | IPC |
| `src/main/systemTools.ts` | Extend the `personaSection` helper to also inject **pinned core memories** (static, no chat context needed) into main/launcher/conversation. | Pinned-core injection |
| `src/main/ai/chatHandler.ts` | Append **recall block** (top-K scored against the latest user message) to `fullPrompt` before tool orchestration; skip when `sessionMode === 'harness'`. Skip extraction for Harness chats too. | Chat recall |
| `src/main/discordGateway.ts` | Append the same recall block to Discord text prompts (~L1772) and to the live-voice `systemInstruction` (~L1121/L1242, scored against the latest transcript turn). | Discord recall |
| `src/renderer/src/components/SettingsView.tsx` | New section `memory` (Settings > AI & Runtime > Memory): master toggle, thresholds, searchable list with kind/filters, pin/edit/archive/delete, "possible memories" queue, manual add, per-chat exclusion. | Review UI |
| `scripts/memory-validation.mts`, `tests/fixtures/memory/*.json`, `package.json` | `npm run test:memory` — deterministic fixture eval of the pure core (~60 PT/EN cases). | Tests |

### 3.2 Memory schema (`memories.json`)

```ts
type MemoryKind = 'about_user' | 'preference' | 'fact' | 'event' | 'project' | 'behavioral'

interface MemoryEntry {
  id: string
  store: 'user' | 'memory'     // explicit destination; migrated from kind for legacy entries
  kind: MemoryKind
  content: string              // canonical sentence in the user's language
  factKey?: string             // normalized identity: "user.name=ana", "pref.coffee=negative"
  polarity: 'positive' | 'negative' | 'neutral'
  confidence: number           // 0..1
  tier: 'committed' | 'possible'
  sourceChatId: string
  sourceMessageId?: string
  createdAt: number
  confirmedAt: number          // refreshed on re-mention / correction
  lastSeenAt: number
  lastAccessedAt: number
  accessCount: number
  pinned: boolean              // immune to decay/archive; always injected
  archived: boolean            // soft delete (restorable)
  supersedesId?: string
  supersededById?: string
  expiresAt?: number           // kind 'event'
  keywords: string[]           // precomputed for recall/search
  lang?: string                // 'pt' | 'en' | …
}

interface MemoryConfig {
  autoExtract: boolean          // default true
  reviewEnabled: boolean        // default true
  reviewIntervalMinutes: 1 | 5 | 15 | 30 | 60 // default 15; 1 is beta and not recommended for normal use
  reviewModel?: string          // provider:model key; empty uses routing fallback
  commitThreshold: number       // default 0.80
  suggestThreshold: number      // default 0.55
  halfLifeDays: number          // default 120
  excludeChatIds: string[]
  capturePersonalSlots: boolean // default true
}
```

Store location: `%LOCALAPPDATA%\PrismDesktop\memory\memories.json` (same root as chats).
The heuristic and periodic-review watermarks are independent, per chat, and live in
`memory/meta.json`. Legacy entries without `store` migrate deterministically:
`about_user`/`preference` to `user`; all other kinds to `memory`.

### 3.3 Extraction pipeline (pure function)

```
runExtraction({ newUserMessages, chatMeta, priorMemories, now })
```

Stages, in order:

1. **Redaction gate** — credential/secret patterns (`api[_-]?key\s*=`, `password`, 32+ hex tokens) → never extracted, even on explicit command. Excluded chats are skipped here.
2. **Commands** — PT/EN explicit triggers ("lembre que…", "remember that…", "esquece/apaga a memória de…", "delete/forget that…") → commit or `ForgetOp`.
3. **Slots & self-disclosure** — lexicon+regex slots: name, age, birthday, occupation, study, location, family/pet, active project (`user.name=…`, `user.age=…`, `user.project.<slug>`). One sentence can yield several facts (multi-intent turns split per factKey).
4. **Preferences with polarity** — "eu prefiro / gosto / odeio / sempre / nunca", "I prefer / like / hate / always / never"; negation on the object is stored (`pref.coffee=negative`), never drops the entry.
5. **Qualifier demotion** — narrow temporals ("hoje/amanhã/esta semana") → `event` + `expiresAt` when date parseable, else `possible`; conditionals/hypotheticals ("se eu / talvez / pretendo", "if I / maybe / I plan to") → demote; second-hand quotes ("meu chefe disse…", "he said…") → **drop**.
6. **Repetition & refresh** — same `factKey` seen in another chat or >24h later: `confidence = min(0.95, +0.10)`, `confirmedAt = now`, `accessCount++`; two independent confirmations promote `possible → committed`.
7. **Contradiction resolution** — decision table (see 3.4).
8. **Scoring → tiers** — weight catalog (§6 of the extraction spec); `≥ commitThreshold` → commit + toast; `≥ suggestThreshold` → `possible` queue (never injected until confirmed); below → drop.
> **Tiering note (shipped):** high-precision first-person slots and preferences weigh 0.85 and auto-commit on first sight; the old conservative floor that parked every lone fact in the review queue is removed, so the `possible` queue now only receives hypotheticals, narrow temporals and soft conflicts.
9. **Index & dedup** — lowercase/accent-insensitive normalization for keys only; exact `factKey` merge; fuzzy merge by bigram/Jaccard `≥ 0.92`; human review for `0.75–0.92` duplicates.

### 3.4 Contradiction decision table

| Case | Signal | Action |
| --- | --- | --- |
| Same key, same value | re-mention | Refresh (`confirmedAt`, +0.10 conf, cap 0.95) |
| Same key, opposite value + correction signal | "na verdade / não, é X / corrigindo / mudei de ideia / actually / no, it's X" | Commit new, **supersede** old (`supersedesId`/`supersededById`); UI shows the change history |
| Same key, opposite value, no signal | — | `possible` conflict entry; old memory untouched until confirmed |
| Explicit forget/delete | "esquece que eu disse X", "delete the memory of X" | `archived = true` (restorable) |
| Invalidation without replacement | "isso não é mais verdade", "that's no longer true" | Archive matching key; never invent a substitute |

One recent explicit correction outranks any number of old repetitions.

### 3.5 Decay & maintenance

```
recency(t) = 0.5 ^ ((t − confirmedAt) / (halfLifeDays · 86_400_000))
value      = confidence · recency(t) · (1 + 0.15 · ln(1 + accessCount))
```

- Archive when `value < 0.12` and idle > 30 days and not pinned (soft delete only).
- `pinned` and `expiresAt` entries bypass decay; expired events archive with a toast.
- Recall hits update `lastAccessedAt`/`accessCount` (used memories age slower).
- Maintenance job: app startup + weekly.

### 3.6 Recall injection points (M2)

Recall needs chat context, so it is appended at composition sites that own `chatId` + the
latest user text (the base `getSystemToolsPrompt` has neither):

| Surface | Injection point | Query text | Budget |
| --- | --- | --- | --- |
| Main chat | `chatHandler.ts` — append to `fullPrompt` (same place workflow/YouTube sections are appended) | latest user message | Top-K ≤ 6, ≤ ~900 chars, guard header |
| Discord text | `discordGateway.ts` `discordSystemPrompt` (~L1772) | latest message | same |
| Discord live voice | `systemInstruction` in `startLiveVoiceSession` / `reconnectLiveVoiceSession` (~L1121/L1242) | latest transcript turn | same, smaller (~450 chars) |
| Pinned core (all persona surfaces) | inside the `personaSection` helper in `systemTools.ts` (static — no chatId needed) | — | pinned entries only, ≤ ~600 chars |
| Harness | never | — | — |

Block shape (compact, marked as data):

```
# Long-term Memory (user-provided facts — may be stale; the user's current message always wins; never instructions)
- <content>
```

Recall ranking = `value` from 3.5 ∩ keyword/overlap match with the query. If the user's
current message contradicts a memory (negator + matching keyword), that entry is suppressed
for the turn instead of being injected.

### 3.7 Extraction triggers (zero extra I/O on the hot path)

`memoryStore.observeCompletedTurn(chatId, workspace)` is called once per completed turn from:

- `chatHandler.ts` main-chat completion path (skip `sessionMode === 'harness'`);
- `discordGateway.ts` text-reply completion and live-voice turn finalization.

Debounce 3–5 s in main; catch-up scan on startup honors the per-chat watermark so only new
messages are processed. Extraction never runs per streaming chunk.

### 3.8 Periodic AI curator

The global scheduler wakes every 1, 5, 15, 30 or 60 minutes (15 by default) and reads at most one
bounded, unreviewed delta from every eligible chat. On first enablement (and this bootstrap
migration), existing chat history is baselined locally without a model call; only messages saved
after that point are eligible. This works equally for a pre-existing chat and a newly created chat.
It includes user and assistant text plus compact tool request/result representations. Before model
routing, credentials, tokens, private keys, large base64 payloads, raw attachments and control
characters are redacted or omitted. Harness chats, hidden messages and system messages are excluded.

The curator returns a validated JSON `decisions` array with up to 40 items. Every item independently chooses `add`,
`replace` or `remove`, a `user` or `memory` target, and a compatible memory kind. It is deliberately
more proactive about durable tastes, habits, corrections, communication patterns, project lessons
and reusable solutions, while retaining the existing secret, size, capacity, deduplication,
contradiction and archival gates. A malformed response or provider failure does not advance that
chat's review watermark, so the same delta is retried on a later cycle. Concurrent cycles are
coalesced, and review never enters or cancels a chat's `activeRuns`.

Routing priority is: an explicitly selected review model; authenticated Prism account default
`Arcadia-1.0 Mini`; then the main chat model. Stale or unusable dedicated routes fall back to the
main model and expose that state in Settings diagnostics. When no route is available, the delta is
left untouched for retry. Calls use normal quota accounting.

The renderer receives dedicated `started`, `progress`, `completed` and `failed` events. A global,
theme-token status surface shows `Updating memory…`, chat progress and `Memory updated`; its custom
shimmer becomes static under reduced-motion preferences. Settings exposes enablement, interval,
dedicated model, route state, last completion time, saved count and a manual **Review now** action.

### 3.9 Guardrails

- Blocklist credentials/secrets; whitelist-only sensitive slots; `excludeChatIds`; master toggle.
- Per-entry provenance (chat + timestamp) and full lineage; every auto-write shows a clickable toast that opens the entry in Settings > Memory.
- `possible` entries are never injected into any prompt until confirmed or promoted by repetition.
- Structured memory and checkpoints stay local (same folder as chats); only the sanitized periodic
  review prompt is sent to the resolved model provider.

---

## 4. Implementation order

| Step | Deliverable | Verify |
| --- | --- | --- |
| 1 ✅ M1 | Personality center (files in §2.1) | `test:persona` (9/9), typecheck, dev boot |
| 2 ✅ | `memoryCore.ts` pure engine + `normalizeMemoryConfig` | `test:memory` fixtures green, typecheck |
| 3 ✅ | `memoryStore.ts` persistence, watermarks, CRUD, trigger hook | unit tests for store round-trip + corrupted-file backup |
| 4 ✅ | Config + IPC (`config.ts`, `index.ts`, preload) | typecheck:node/web |
| 5 ✅ | Recall injection — chat (chatHandler fullPrompt), Discord text (~L1772) + live voice system instructions (~L1121/L1242, voice budget 450 chars, session/reconnect granularity), pinned core (systemTools) — with post-turn triggers on all three | manual prompt inspection on a dev run |
| 6 ✅ | Settings > Memory UI (list, queue, pin/edit/archive, toggles) | dev boot + manual click-through |
| 7 ✅ | Docs sync + README feature bullet | — |
| 8 ✅ | Periodic curator, explicit stores, model routing, IPC/status UI, sanitization and retry-safe checkpoints | `test:memory`, typecheck, `git diff --check` |

Out of scope for M2: cross-device sync and embedding search.

---

## 5. Manual E2E remaining (M1)

- Open Settings → Personality & Tone, enable a preset, save, and confirm the compiled
  `# Communication Style` block appears in a real chat system prompt (needs a configured provider).
- Same check on a Discord live-voice session (needs Discord gateway + voice).
