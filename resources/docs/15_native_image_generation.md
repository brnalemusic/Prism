# Native AI Image Generation

Prism exposes image generation and editing through the native `generate_image` tool. The conversational model decides when a visual is the appropriate answer, supplies the final prompt, and can deliberately select a prior chat image through its opaque Prism image reference.

## Intelligence Routing

Configure the route in **Settings > Intelligence Routing > Image Generation Model**. Prism stores the exact `providerId:modelId` key in `imageGenerationModel` and does not fall back to the selected chat model. Only enabled models from OpenAI-compatible `chat_completions` and `responses` providers appear in this selector.

When no valid route exists, the tool is omitted from the model's available tools. Removed providers, disabled models, missing credentials, and incompatible provider types make a previously saved route stale rather than causing an implicit fallback.

## Provider request

The main process resolves the configured provider and sends JSON `POST /v1/images/generations` requests for creation. When `operation` is `edit`, it resolves the required `source_image_ref` inside the current chat and sends the source bytes through the standard multipart `POST /v1/images/edits` route. Both operations support `prompt`, `size`, `quality`, and a bounded image count. Prism accepts OpenAI-compatible `data[].b64_json` and `data[].url` responses.

Remote image URLs are treated as untrusted. Prism accepts only HTTP(S), limits response sizes, verifies PNG/JPEG/WebP signatures, decodes the image, and validates its dimensions. Authentication is retried only for URLs on the configured provider origin and is never forwarded to a different origin.

## Conversation lifecycle

The renderer derives one deterministic lifecycle from the tool call: `generating`, `loading-image`, `completed`, `error`, or `cancelled`. An accent-derived procedural SVG field of translucent silk ribbons appears as soon as the tool starts. After decoding, the surface transitions from the requested aspect ratio to the actual image ratio before a short crossfade reveals the image.

User uploads and successful tool images are saved to the per-chat attachment sidecar and hydrated when history reloads. The JSON history stores compact metadata rather than raw base64. Every subsequent model request includes all unique valid historical images, while duplicate bytes are sent only once. URL responses are downloaded before persistence, so temporary or expiring provider URLs are never stored in conversation history.

Each image is announced to the model as `prism-image://asset/<uuid>`. These references are not filesystem paths and are filtered from assistant presentation if a model echoes one. The edit service accepts only references recorded in the current chat, validates strict base64, the stored MIME signature, size and dimensions, and rejects missing, forged, cross-chat, or invalid assets. Tool results expose references for generated images so a later request can edit a specific prior output. User uploads use the same PNG, JPEG, and WebP validation; unsupported or malformed uploads produce an explicit error instead of disappearing from model context.

Retry uses the original validated arguments and updates the same tool result. Stop, tab close, and conversation deletion abort the relevant generation. Switching chats or tabs does not cancel work running in the background.

## Viewer and saving

Clicking a generated image opens Prism's fullscreen viewer with focus management, Escape and backdrop close, scroll locking, and an original-byte download action. Saving uses Electron's native dialog in the main process; filenames are sanitized and the source PNG, JPEG, or WebP bytes are preserved without recompression.
