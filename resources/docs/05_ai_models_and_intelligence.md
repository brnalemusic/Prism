# AI Models and Intelligence Architecture

## 1. Introduction: Multi-Provider Intelligence Engine

Prism 7.0.1 operates on an **Open Multi-Provider & Dynamic Model Architecture**. Instead of hardcoding vendor-locked or fine-tuned model keys, Prism features a modular cognitive dispatching core (`src/main/ai/`) that connects to any cloud LLM vendor or local model engine.

Users can attach Google AI Studio, OpenAI, Anthropic Claude, OpenRouter, NVIDIA NIM, GroqCloud, Cerebras AI, or custom OpenAI-compatible / Anthropic-compatible / Responses API-compatible endpoints (such as local Ollama, LM Studio, or vLLM setups).

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
   - Standard `/chat/completions` payload format used by OpenAI, Google AI Studio OpenAI-compat bridge (`/openai/chat/completions`), OpenRouter, NVIDIA NIM, Groq, Cerebras, Ollama, LM Studio, etc.
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

### 3.2. Dynamic Model Fetching (`providerManager.ts`)

When adding or refreshing a provider, Prism queries `${baseUrl}/models` (or `${baseUrl}/openai/models` for Google endpoints).
- Models returned by the endpoint are cross-referenced with `TRUSTED_MODELS_LIST`.
- Known trusted models are enabled by default; non-trusted or experimental custom models can be enabled manually in Settings.

---

## 4. Feature-Level Model Assignment

Prism allows users to independently assign different models to different functional components in the application:

1. **Main Chat Model (`lastSelectedChatModel` / `defaultModel`):** The primary engine used for complex coding, interactive chat, and general computer use tasks.
2. **Web Search Model (`searchModel`):** Optimized model for analyzing Google search grounding results and extracting factual context.
3. **Quick Launcher Model (`quickLauncherModel`):** Low-latency model for instant overlay queries, math evaluation, and app launches.
4. **Speech-to-Text / Dictation Model (`sttModel`):** Model for parsing voice dictation audio transcripts.
5. **Generative Browser Model (`generativeBrowserModel`):** Dedicated model for live HTML5 + CSS website generation and interactive subpage synthesis via `generate:` prompts.

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
- **System Prompt Composition:** Injects OS version, CWD, username, local date/time, active workflow system instructions, and tool constraints.
- **Multimodal Payloads:** Images and screenshots are packaged directly into message content payloads.
- **Output Truncation:** Large command outputs are truncated at 50,000 characters by `localCommandSandbox.ts`.
- **Local History Persistence:** Chat sessions are persisted as JSON files on disk for fast search and zero cloud storage dependency.
