# AI Models and Intelligence Architecture

## 1. Introduction: Multi-Provider Intelligence Engine

Prism 7.0.1 operates on an **Open Multi-Provider & Dynamic Model Architecture**. Instead of hardcoding vendor-locked or fine-tuned model keys, Prism features a modular cognitive dispatching core (`src/main/ai/`) that connects to any cloud LLM vendor or local model engine.

Users can attach Google AI Studio, OpenAI, Anthropic Claude, OpenRouter, NVIDIA NIM, GroqCloud, Cerebras AI, Puter.js, or custom OpenAI-compatible / Anthropic-compatible / Responses API-compatible endpoints (such as local Ollama, LM Studio, or vLLM setups).

---

## 2. Provider Configuration Interfaces

In `src/shared/types.ts`, providers and models are defined with clean TypeScript schemas:

```typescript
export type CompletionType = 'chat_completions' | 'responses' | 'anthropic_messages'

export interface ProviderModel {
  id: string
  name?: string
  enabled: boolean
  isTrusted: boolean
}

export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  completionType: CompletionType
  isTrusted: boolean
  models: ProviderModel[]
}
```

### Supported Completion Paradigms

1. **`chat_completions` (OpenAI SSE Standard):**
   - Standard `/chat/completions` payload format used by OpenAI, Google AI Studio OpenAI-compat bridge (`/openai/chat/completions`), OpenRouter, NVIDIA NIM, Groq, Cerebras, Puter.js, Ollama, LM Studio, etc.
2. **`anthropic_messages` (Anthropic Messages API):**
   - Native `/messages` endpoint structure used by Anthropic Claude endpoints, requiring `x-api-key` and `anthropic-version: 2023-06-01` headers.
3. **`responses` (OpenAI Responses API):**
   - Modern `/responses` payload architecture using structured `input` arrays and flat tool definitions.

---

## 3. Trusted Registry and Dynamic Discovery

### 3.1. Trusted Providers Registry (`trustedRegistry.ts`)

Prism comes pre-configured with a trusted registry of popular AI cloud providers:
- **Google AI Studio:** `https://generativelanguage.googleapis.com/v1beta`
- **OpenAI GPT:** `https://api.openai.com/v1`
- **Anthropic Claude:** `https://api.anthropic.com/v1`
- **OpenRouter:** `https://openrouter.ai/api/v1`
- **NVIDIA NIM:** `https://integrate.api.nvidia.com/v1`
- **GroqCloud:** `https://api.groq.com/openai/v1`
- **Cerebras AI:** `https://api.cerebras.ai/v1`
- **Puter.js:** `https://api.puter.com/puterai/openai/v1`

### 3.2. Dynamic Model Fetching (`providerManager.ts`)

When adding or refreshing a provider, Prism queries `${baseUrl}/models` (or `${baseUrl}/openai/models` for Google endpoints, and native Puter.js `puter.ai.listModels()` for Puter.js).
- Models returned by the endpoint are cross-referenced with `TRUSTED_MODELS_LIST`.
- Known trusted models are enabled by default; non-trusted or experimental custom models can be enabled manually in Settings.

### 3.3. Puter.js Native Account Integration (`puterClient.ts`)

For Puter.js, Prism provides a native integration powered by `@heyputer/puter.js`:
- **Default Browser Authentication:** Users can connect their existing Puter account directly via their default OS browser (`shell.openExternal`) rather than manually copying API keys. Prism listens on an ephemeral local HTTP server (`127.0.0.1:<port>`), captures the OAuth callback token, serves a Prism confirmation page, and initializes the native Puter session.
- **Native Model Discovery:** Discovers the 800+ models available on Puter directly via `puter.ai.listModels()` on the official SDK.
- **Native Driver & Tool Calling (`streamPuterCompletion`):** Supports live NDJSON streaming completions and native tool calling (function calling) directly via `https://api.puter.com/drivers/call` (`puter-chat-completion`), handling tool chunk extraction and multi-turn tool loops with sanitization.
- **User-Pays Credential Isolation:** The `puter_native` route requires the connected `puterAuthToken`; it never falls back to `apiKey`. Manual API keys remain a separate `chat_completions` mode.
- **Hybrid Support:** Users retain the ability to either connect an account or input a manual API token in the provider wizard.

---

## 4. Feature-Level Model Assignment

Prism allows users to independently assign different models to different functional components in the application:

1. **Main Chat Model (`lastSelectedChatModel` / `defaultModel`):** The primary engine used for complex coding, interactive chat, and general computer use tasks.
2. **Web Search Model (`searchModel`):** Optimized model for analyzing Google search grounding results and extracting factual context.
3. **Quick Launcher Model (`quickLauncherModel`):** Low-latency model for instant overlay queries, math evaluation, and app launches.
4. **Speech-to-Text / Dictation Model (`sttModel`):** Model for parsing voice dictation audio. Dedicated Whisper/ASR models return their raw transcription immediately, without an editorial prompt or a second LLM pass. Multimodal models that understand audio use Prism's live speech editor to remove fillers and repetitions, resolve false starts and self-corrections to the final intended wording, improve clarity and structure, and preserve explicit requests for the main assistant.
5. **Generative Browser Model (`generativeBrowserModel`):** Dedicated model for live HTML5 + CSS website generation and interactive subpage synthesis via `generate:` prompts.
6. **Periodic Memory Review Model (`memory.reviewModel`):** Optional dedicated model for asynchronous long-term-memory curation. An explicit available model wins. With an authenticated Prism account and no explicit selection, Prism defaults to `Arcadia-1.0 Mini`; otherwise it uses the main chat model. Invalid or unavailable dedicated routes fall back to the main model and surface that fallback in Memory settings. The selector displays **Not set** when no dedicated route is configured.

The memory reviewer runs outside chat `activeRuns`, so it does not block, cancel or mutate an active
conversation. Each model request reviews one bounded, sanitized per-chat delta and uses normal quota
accounting. User/assistant/tool roles are separated in the review prompt, and every saved decision
must cite a real user-message index; assistant-generated claims cannot become user memories by
themselves. Network failures, malformed structured responses and unavailable routes leave the
checkpoint unchanged for retry. Dedicated global IPC status events report start, per-chat progress,
completion and failure without appearing as chat tool labels.

---

## 5. Streaming Reasoning and Thought Signatures

### 5.1. Multi-Provider Reasoning Stream
Modern reasoning models stream thinking steps before outputting text. Prism intercepts reasoning chunks across standard formats:
- `delta.reasoning_content` (DeepSeek / OpenAI compatible)
- `delta.reasoning` / `delta.thinking` (Anthropic / Qwen / custom)
- Chunks are appended to `fullReasoning` and displayed live in the renderer's expandable **Thoughts** panel.

### 5.2. Thought Signature Support (`thought_signature`)
Google Gemini 2.5 / 3.x thinking models require a `thought_signature` when executing tool calls across multi-turn sessions. In SSE streams, Prism extracts `delta.extra_content.google.thought_signature` or `delta.thought_signature` and attaches it to tool call objects so multi-turn tool loops succeed smoothly.

---

## 6. Context Window and Token Optimization

Even with massive context windows (1M–2M tokens), context efficiency is critical:
- **System Prompt Composition:** Injects OS version, CWD, username, current weekday and local date/time (with dates explicitly identified as `MM/DD/YYYY`), active workflow system instructions, and tool constraints. Non-Harness Chat and Quick Launcher user messages also carry compact `[MM-DD-YYYY HH:MM:SS]` metadata for temporal context; the UI keeps it hidden.
- **Multimodal Payloads:** Images and screenshots are packaged directly into message content payloads.
- **Output Truncation:** Large command outputs are truncated at 50,000 characters by `localCommandSandbox.ts`.
- **Local History Persistence:** Chat sessions are persisted as JSON files on disk for fast search and zero cloud storage dependency.


## Chat Work Timeline

Chat renders assistant text and tool actions in execution order. Each native tool reserves a position when its first argument delta arrives, using its orchestration round and call index until its call ID is available. A visible action starts with the first characters of the model's `progressTitle`; it never starts with a generic tool name. Completion updates the same action with `completedTitle`, falling back to its progress title.

During streaming, intermediate text, actions, and artifacts remain expanded. After the turn finishes, **Worked for N seconds** collapses that history and leaves the final response and successful generated images visible. Image errors, retry controls, cancellations, and attachment-free results remain inside the collapsible history. Expanding reveals the history directly below the summary and preserves the summary's screen position. A turn without a final response keeps its work accessible without treating its pre-tool text as a final answer. Errors and cancellation retain completed and partially generated actions.

Chat history reconstructs rounds from saved assistant messages and joins results by tool-call ID. Repeated calls to the same tool remain distinct. The Quick Launcher uses the same timeline and disclosure; Harness retains its separate presentation.

Validation: `node --experimental-strip-types --test scripts/chat-timeline-validation.mts`. For visual regression checks, run `node --experimental-strip-types scripts/chat-timeline-browser.mts` and open the printed localhost URL. This fixture mounts the real Chat and Launcher message components with controlled events; it does not contact providers or load user history.
