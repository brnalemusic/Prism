# AI Models and Intelligence

## 1. Introduction: The Cognitive Core of Prism

Prism is not tied to a single static artificial intelligence model. Instead, it features a dynamic routing core that maps user requests and automated background tasks to a spectrum of Large Language Models (LLMs) provided by the Google Gemini API. This approach allows Prism to optimize for speed, intelligence, context size, and token costs depending on the complexity of the current task.

The cognitive engine is built directly on the official **Google Gen AI SDK** (`@google/genai` v2.5.0+), exposing advanced capabilities such as native multimodal file ingestion (images, code files, transcripts), structured JSON schemas for tool calls, automated search grounding, and adjustable reasoning parameters. This guide documents the model library, context window mechanics, automatic error recovery systems, search protocols, and thinking configurations that govern Prism’s intelligence.

---

## 2. Model Profiles and API Mappings

Prism classifies its models into five distinct performance tiers. The configuration mappings are defined in the main process (`src/main/gemini.ts`) and can be selected by the user in the model dropdown selector.

### 2.1. Prism 6 Super-Fast
* **Model Key:** `prism-6-super-fast`
* **Official API ID:** `gemini-3.1-flash-lite`
* **Latency Profile:** Ultra-low (sub-100ms Time-to-First-Token)
* **Context Window:** 1,000,000 tokens
* **Primary Role:** This is the default model loaded at application startup and the standard helper for the Quick Launcher.
* **Best Use Cases:** Quick conversational Q&A, basic shell execution commands, text summarization, dictation parsing, and simple file edits.
* **Design Rationale:** For daily helper tasks, latency is more important than deep logical deduction. This model returns responses almost instantly while consuming minimal API quota.

### 2.2. Prism 6 Fast-Old
* **Model Key:** `prism-6-fast-old`
* **Official API ID:** `gemini-3-flash-preview`
* **Latency Profile:** Low latency
* **Context Window:** 1,000,000 tokens
* **Primary Role:** Secondary helper for simple background tasks and legacy automation flows.
* **Best Use Cases:** Running repetitive tasks, scraping basic web directories, and simple code refactoring.

### 2.3. Prism 6 Fast
* **Model Key:** `prism-6-fast`
* **Official API ID:** `gemini-3.5-flash`
* **Latency Profile:** Balanced (low latency with elevated intelligence)
* **Context Window:** 1,000,000 tokens
* **Primary Role:** The workhorse model for coding tasks, subagent swarm orchestrations, and multimodal media ingestion.
* **Best Use Cases:** Complex multi-file refactoring, writing system scripts, executing Playwright browser automation scripts, and serving as the default voice transcription/TTS engine.
* **Design Rationale:** This model represents the sweet spot in modern AI computing. It is intelligent enough to understand structural codebase relationships while remaining fast enough to stream long markdown replies fluidly.

### 2.4. Prism 6 Dragon
* **Model Key:** `prism-6-dragon`
* **Official API ID:** `gemma-4-26b-a4b-it`
* **Latency Profile:** Medium latency
* **Context Window:** 2,000,000 tokens
* **Primary Role:** Default model for background sub-agents and extensive info gathering.
* **Best Use Cases:** Code audits, reading massive documentation guides, deep web search sweeps, and orchestrating complex tasks.
* **Design Rationale:** This model excels at processing huge volumes of text. Its expanded context window and specialized training in instruction-following make it ideal for subagents who need to digest multiple search results and code snippets.

### 2.5. Prism 6 Dense
* **Model Key:** `prism-6-dense`
* **Official API ID:** `gemma-4-31b-it`
* **Latency Profile:** High latency (with advanced reasoning)
* **Context Window:** 2,000,000 tokens
* **Primary Role:** Premium tier for debugging, math, and system design.
* **Best Use Cases:** Finding subtle logic bugs in code, mathematical calculations, parsing complex regex rules, and generating systems architectures.
* **Design Rationale:** This model is configured with deep reasoning parameters. While it takes longer to compile its answers, it goes through a multi-pass thinking chain, producing unmatched logical correctness on complex problems.

---

## 3. Gemini vs Gemma: The Architectural Split

Prism's model inventory is divided into two distinct families: **Gemini** (proprietary multimodal models) and **Gemma** (open weights models).

### 3.1. Gemini Models (`gemini-3.5-flash`, `gemini-3.1-flash-lite`)
Gemini models are Google's flagship proprietary models. They are natively multimodal, meaning they do not convert images or audio to text first. Instead, they process visual frames (like screenshots from the Quick Launcher) and audio signals directly through the same transformer layer. This results in:
* **High-Fidelity Visual Processing:** When checking screenshots, Gemini models instantly identify text positions, visual alignment bugs, and interface layouts.
* **Complex Tool Integration:** Native function calling configurations allow these models to select and serialize tool structures with high syntactic accuracy.

### 3.2. Gemma Models (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`)
Gemma models are built on Google's open-weights architecture. While they lack the massive scale of full multimodal models, they are highly optimized for text processing, logical reasoning, and programmatic instruction-following.
* **Instruction-Following Accuracy:** Gemma models are highly disciplined, making them less prone to "hallucinating" formatting or inventing non-existent parameters.
* **Subagent Swarms:** Because they follow programmatic prompts precisely, they are the ideal workers for background task swarms where they must output raw data blocks and status updates without conversational filler.

---

## 4. Automatic Cascade and Fallback Engine

Network failures, API outages, or token rate limits (HTTP Code 429) can interrupt a user's workflow. To prevent these failures from crashing active chats or failing background scripts, Prism builds a native **automatic cascade fallback engine** inside the main prompt dispatcher (`src/main/gemini.ts`).

### 4.1. The Fallback Cascade
If the active model returns a rate limit error (429) or a server failure (500), Prism’s retry block intercepts the exception:
```typescript
const MODEL_FALLBACK_ORDER = [
  'prism-6-dense',
  'prism-6-dragon',
  'prism-6-fast',
  'prism-6-fast-old',
  'prism-6-super-fast'
]
```
The system automatically executes a fallback lookup:
1. It identifies the index of the current failing model in the fallback array.
2. It selects the next model down in the hierarchy (e.g. if `prism-6-dense` hits a rate limit, the system switches to `prism-6-dragon`).
3. It emits a system update message to the renderer to display an inline warning alert in the UI chat frame (e.g. `[AI Search] Rate limit hit. Falling back to Prism 6 Dragon`).
4. It re-attempts the prompt delivery using the fallback model, preserving the active context and message history.
5. This process cascades all the way to `prism-6-super-fast` before returning a terminal connection error to the user, ensuring maximum reliability.

---

## 5. Context Windows and Token Management

One of the key advantages of using Google Gemini models is their massive context window (1M to 2M tokens). Prism leverages this capability to attach detailed system context directly to every prompt.

### 5.1. Structural Prompt Composition
When a prompt is compiled and dispatched, the main process builds a structured payload containing:
1. **The System Prompt:** Governs the identity, visual protocols (Simple Markdown vs Rich Markdown vs Mini Apps), and general operating limits.
2. **Context Block:** Real-time variables including the active workspace CWD, user operating system, username, and the current local date/time.
3. **Workspace File Injectors:** Full text contents of active files or files the user attached to the session.
4. **Active Workflow Directives:** Custom instructions appended if the user is running a Slash Workflow (e.g., `/refactor`).
5. **Tool Constraints:** If the active workflow restricts tool execution, these boundaries are injected into the prompt.
6. **Search Grounding Results:** Snippets and full text contents scraped from active Google searches.
7. **Message Transcript History:** The complete chronological thread log of the active conversation.

### 5.2. Native Multimodal Payload Structure
When sending screenshots, Prism packages the request inside the `@google/genai` `contents` array:
```typescript
const contents = [
  {
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/png', data: base64Data } },
      { text: promptText }
    ]
  }
]
```
This native payload structure bypasses intermediate file-saving layers, sending the raw memory buffer directly to the API, lowering latencies and ensuring maximum visual details are preserved.

### 5.3. Token Optimization
Even with a 2M token limit, sending too much redundant information will slow down model execution. Prism manages tokens by:
* **Caching App Lists:** The database of local installed applications is scanned once at startup, saved as a lightweight JSON cache, and updated only when the user opens the launcher, avoiding sending fresh scans with every prompt.
* **Output Truncation:** Large command outputs are truncated at 50,000 characters by `localCommandSandbox.ts`, preventing log outputs from flooding the context window.
* **History Compression:** Older chat messages are stored as JSON files on disk. If a thread exceeds a configured token depth, the main process extracts semantic summaries of early turns, pruning raw text history while preserving core contextual memories.

---

## 6. Web Search Grounding Protocol

When Google Search Grounding is enabled (either via `Ctrl+S` or settings), the AI has real-time access to the live web.

```
+--------------------------------------------------------------------------+
|                        Search Grounding Protocol                         |
+--------------------------------------------------------------------------+
  User Prompt (e.g., "What is the latest Tailwind v4 syntax?")
     |
     v
  AI parses intent -> Invokes "web_search" tool
     |
     v
  Main Process runs Google Web Scraping
     |
     +--> Iteration 1: Fetch Search Result Snippets & Links
     |
     +--> Iteration 2: AI requests "saw_link_from_url" for top 3 pages
     |
     v
  Main Process scrapes full DOM markdown text from target URLs
     |
     v
  Aggregated text injected into prompt context as # Search Grounding block
     |
     v
  AI generates final response with clickable source citations
```

Unlike basic AI search wrappers that rely only on shallow search snippets, Prism enforces a double-pass grounding protocol:
1. **Search Querying:** The model runs the `web_search` tool, passing an array of distinct search queries. The user sees a friendly progress indicator in the UI (e.g., "Finding common errors...").
2. **Deep Reading:** Once links are returned, the model is instructed to call `saw_link_from_url` to retrieve the full, raw text content of the target pages. This ensures the AI reads the actual documentation or wiki source, rather than guessing based on snippet summaries.
3. **Citations:** The final streamed answer includes direct clickable links to the sources, allowing the user to verify the references.

---

## 7. Dual-Tier Thinking and Reasoning (Think Mode)

Reasoning models utilize a hidden thinking channel where they perform logical deductions, plan their responses, and debug potential solutions before writing their final answer.

### 7.1. Thinking Level Parameters
Prism configures thinking behavior based on the active model key and the `isThinkMode` state:
* **Thinking Level - MINIMAL:** Maps to normal flash models (like `prism-6-fast`). It performs quick, on-the-fly planning, minimizing response latency.
* **Thinking Level - HIGH:** Maps to reasoning models (like `prism-6-dense`). It allows the model to consume additional tokens in a dedicated "thoughts" block. The model maps out complex code dependency graphs, verifies mathematical calculations, and dry-runs terminal commands in its memory before outputting anything to the user.

### 7.2. Rendering Thoughts in the UI
When a thinking-enabled model runs, the Google Gen AI API returns a nested `thoughts` payload in the stream chunk.
* **The Render Toggle:** The user can configure whether to display these thoughts in Settings.
* **Collapsed Accordions:** If enabled, thoughts are rendered inside a collapsed, glassmorphic accordion container at the top of the message bubble (styled with the CSS class `.thought-container`). The user can expand it to inspect the AI's internal reasoning chain, which is highly useful for debugging code logic or understanding the AI's math solutions.
* **Silent Processing:** For automated background subagents, thoughts are processed silently (`includeThoughts: false`) to maximize throughput and minimize latency during background tool execution.
