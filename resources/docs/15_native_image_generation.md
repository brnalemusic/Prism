# Native AI Image Generation

Prism exposes image generation and editing through the native `generate_image` tool. The conversational model decides when a visual is the appropriate answer, supplies the final prompt, and can deliberately select a prior chat image through its opaque Prism image reference.

## Intelligence Routing

Configure the route in **Settings > Intelligence Routing > Image Generation Model**. Prism stores the exact `providerId:modelId` key in `imageGenerationModel` and does not fall back to the selected chat model. Every enabled model from an addressable provider remains selectable, including unknown and text-looking model names.

Supported image adapters are:

- **OpenAI Images** for direct `/images/generations` and `/images/edits` models such as GPT-Image.
- **OpenAI Responses** for LLM-overhead models that invoke the `image_generation` tool. A separate render model may be declared in model metadata.
- **Gemini GenerateContent** for Gemini image models, including Nano Banana-style generation and editing with inline image parts.
- **Stability AI** for Stable Image Core/Ultra generation and Stability multipart editing.
- **Puter Native** for account-backed `puter.ai.txt2img()` generation and editing.

Prism detects the image protocol on the first real generation or edit request. It does not send a paid probe when a provider is saved. Protocol metadata and the model registry are hints only; automatic detection tries addressable candidates sequentially and never hides a model by name. Generation and editing are tracked independently, with a cached successful adapter for each operation.

Enabled models from a connected **Puter.js Native** provider also appear in this selector. Puter lists its complete account-visible model catalog; Prism does not guess which entries can generate images, so select the model you intend to use. Puter User-Pays generation and editing call `puter.ai.txt2img()` through the native SDK using the connected account session, never an API key or OpenAI-compatible image endpoint. The Puter session is stored separately from API keys.

When no valid route exists, the tool is omitted from the model's available tools. Removed providers, disabled models, missing credentials, and incompatible provider types make a previously saved route stale rather than causing an implicit fallback. Fallback continues only for an explicit unsupported endpoint, method, or model response; authentication, quota, rate limits, invalid options, timeouts, network errors, malformed payloads, and decoding failures stop immediately.

## Provider request

The main process resolves the configured provider and model, then selects a protocol candidate. Direct OpenAI requests use JSON generation and multipart editing. Responses requests supply the image tool and optional source image. Gemini requests use `generateContent`, image response modalities, and inline source data. Stability requests use its native multipart routes and accept binary or JSON image results. Puter maps `size` to an aspect ratio, sends edits as a data-URI `input_image`, and invokes one native request per requested output. Puter execution removes the `openrouter:` catalog prefix before sending the model to the driver while preserving the full catalog ID in Prism. Native Puter image providers use `puter.ai.txt2img()` and forward the catalog provider as both the SDK `driver` and request `provider` (the installed SDK uses `driver` to select the image driver). Puter's OpenRouter GPT image models, such as `openrouter:openai/gpt-5.4-image-2`, use `puter.ai.chat()` and read the returned `message.images` instead.

Responses are normalized from OpenAI `data[].b64_json`/`data[].url`, Responses image tool output, Gemini `inlineData`, Stability binary/JSON payloads, and Puter URLs/data URIs before entering the shared validation pipeline.

Remote image URLs are treated as untrusted. Prism accepts only HTTP(S), limits response sizes, verifies PNG/JPEG/WebP signatures, decodes the image, and validates its dimensions. Authentication is retried only for URLs on the configured provider origin and is never forwarded to a different origin.

## Conversation lifecycle

The renderer derives one deterministic lifecycle from the tool call: `generating`, `loading-image`, `completed`, `error`, or `cancelled`. An accent-derived procedural SVG field of translucent silk ribbons appears as soon as the tool starts. After decoding, the surface transitions from the requested aspect ratio to the actual image ratio before a short crossfade reveals the image.

User uploads and successful tool images are saved to the per-chat attachment sidecar and hydrated when history reloads. The JSON history stores compact metadata rather than raw base64. Subsequent model requests include unique valid user uploads and visual tool results such as screenshots, while duplicate bytes are sent only once. Generated image outputs remain available to the UI and edit flow but are represented to chat models by their opaque references instead of being sent back as vision input. URL responses are downloaded before persistence, so temporary or expiring provider URLs are never stored in conversation history.

Each image is announced to the model as `prism-image://asset/<uuid>`. These references are not filesystem paths and are filtered from assistant presentation if a model echoes one. The edit service accepts only references recorded in the current chat, validates strict base64, the stored MIME signature, size and dimensions, and rejects missing, forged, cross-chat, or invalid assets. Tool results expose references for generated images so a later request can edit a specific prior output. User uploads use the same PNG, JPEG, and WebP validation; unsupported or malformed uploads produce an explicit error instead of disappearing from model context.

Retry uses the original validated arguments and updates the same tool result. Stop, tab close, and conversation deletion abort the relevant generation. Switching chats or tabs does not cancel work running in the background.

## Viewer and saving

Clicking a generated image opens Prism's fullscreen viewer with focus management, Escape and backdrop close, scroll locking, and an original-byte download action. Saving uses Electron's native dialog in the main process; filenames are sanitized and the source PNG, JPEG, or WebP bytes are preserved without recompression.
