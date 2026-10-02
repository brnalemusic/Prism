import { BrowserWindow } from 'electron'
import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { OpenAiMessage } from './types'
import { streamOpenAiCompletion } from './openaiClient'
import { safeSend } from '../safeSend'
import { markConnectionActive } from '../connection'

const activeGenerations = new Map<string, AbortController>()

export function cancelBrowserGeneration(sessionId?: string): void {
  if (sessionId) {
    const controller = activeGenerations.get(sessionId)
    if (controller) {
      controller.abort()
      activeGenerations.delete(sessionId)
    }
  } else {
    for (const [id, controller] of activeGenerations.entries()) {
      controller.abort()
      activeGenerations.delete(id)
    }
  }
}

const GENERATIVE_BROWSER_SYSTEM_PROMPT = `You are the Prism Generative Web Engine: you create live, modern, high-fidelity, interactive single-file web apps and websites in unified HTML5, Tailwind CSS, Lucide Icons, and JavaScript.

# OUTPUT CONTRACT
1. Output PURE, RAW HTML ONLY — no markdown code fences (do not start with \`\`\`html or end with \`\`\`) and no conversational preambles, greetings, or outros. Start immediately with <!DOCTYPE html>.
2. The output streams into a live viewport: write rich semantic HTML in the <body> (header, nav, aside, main, section, div, button, footer) FIRST so the layout renders progressively; place all JS in one <script> at the end of the body.
3. Every page must be a self-contained single file: semantic HTML5 (cards, grids, buttons, modals); Tailwind styling (modern themes, glassmorphism, responsive flex/grid, hover states, badges); full client-side JS (state, DOM reactivity, events, tabs, live search filtering, modals, media playback, like/bookmark counters, toasts, secret toggles).

# RUNTIME ENVIRONMENT
The runtime pre-loads Tailwind CSS CDN, Lucide (<i data-lucide="play"></i> etc., rendered via lucide.createIcons()), FontAwesome, and vanilla JS/React 18 (DOM, Web Audio, Canvas APIs).

# STRUCTURE TEMPLATE
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Title</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    .glassmorphism { background: rgba(255, 255, 255, 0.05) !important; backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; }
  </style>
</head>
<body class="bg-[#0f0f0f] text-white antialiased selection:bg-purple-600 selection:text-white min-h-screen">
  <header class="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-[#0f0f0f]/90 px-6 py-3 backdrop-blur-md"></header>
  <div class="flex min-h-[calc(100vh-60px)]"></div>
  <script>
    if (window.lucide && typeof window.lucide.createIcons === 'function') lucide.createIcons();
    // Client state + event listeners: tabs, live filter, modals, likes/saves, theme toggles
  </script>
</body>
</html>

# SELF-CONTAINED INTERACTIVITY (JS FIRST, NEVER RE-PROMPT PER CLICK)
Build modals/drawers, like/dislike counters, comment submission, bookmarking, search filtering, tab switching, and theme/secret toggles directly with client-side JS event listeners — never re-prompt for a UI action.

# SUBPAGE PROTOCOL (data-prompt / generate:...)
Reserve AI generations ONLY for major distinct subpages or separate pages (Terms of Service, Privacy Policy, Pricing Plans, User Onboarding). Add a descriptive data-prompt attribute, e.g.:
- <a href="generate:Terms of Service" data-prompt="Clicked 'Terms & Conditions' in footer; Generate the Terms of Service page with the exact same visual identity, typography, and navigation bar.">Terms of Service</a>
In-page buttons (like, comment, tabs, modals, theme toggles, player controls) must NOT use data-prompt — handle them with JS. Subpage continuations must keep the EXACT SAME visual identity, color scheme, typography, header navbar, footer, and branding.
`

/**
 * Strips markdown code blocks (\`\`\`html ... \`\`\`) and conversational preambles if emitted by models.
 */
function cleanGeneratedHtml(raw: string): string {
  let cleaned = raw.trim()
  // Remove markdown code fences at the beginning
  cleaned = cleaned.replace(/^```(?:html)?\s*/i, '')
  // If there is preamble before <!DOCTYPE or <html, slice from HTML start
  const docTypeIdx = cleaned.indexOf('<!DOCTYPE')
  const htmlTagIdx = cleaned.indexOf('<html')
  if (docTypeIdx !== -1 && (htmlTagIdx === -1 || docTypeIdx < htmlTagIdx)) {
    cleaned = cleaned.slice(docTypeIdx)
  } else if (htmlTagIdx !== -1 && (docTypeIdx === -1 || htmlTagIdx < docTypeIdx)) {
    cleaned = cleaned.slice(htmlTagIdx)
  }
  // Remove trailing markdown code fence if present
  cleaned = cleaned.replace(/\s*```\s*$/i, '')
  return cleaned
}

export async function handleGenerateBrowserSite(
  window: BrowserWindow,
  data: {
    prompt: string
    sessionId: string
    history?: OpenAiMessage[]
  }
): Promise<void> {
  const { prompt, sessionId, history = [] } = data

  // Cancel any existing generation for this session ID
  if (activeGenerations.has(sessionId)) {
    activeGenerations.get(sessionId)?.abort()
    activeGenerations.delete(sessionId)
  }

  const abortController = new AbortController()
  activeGenerations.set(sessionId, abortController)

  const config = loadConfig()
  const currentModelKey =
    config.generativeBrowserModel ||
    config.lastSelectedChatModel ||
    config.defaultModel ||
    ''
  const { provider, model } = resolveProviderAndModel(currentModelKey)

  if (!provider || !model) {
    safeSend(window, 'browser-gen-error', {
      sessionId,
      error: 'No active AI model or API key configured. Please configure a provider in Settings.'
    })
    activeGenerations.delete(sessionId)
    return
  }

  markConnectionActive()

  // Clean prompt: strip generate: or gen: prefix
  const cleanPrompt = prompt.replace(/^(?:generate|gen):/i, '').trim()

  const systemMessage: OpenAiMessage = {
    role: 'system',
    content: GENERATIVE_BROWSER_SYSTEM_PROMPT
  }

  // Build message history
  const messages: OpenAiMessage[] = [systemMessage]
  if (history && history.length > 0) {
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'model') {
        messages.push({
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: msg.content
        })
      }
    }
  }

  // Add current user prompt
  messages.push({
    role: 'user',
    content: cleanPrompt || prompt
  })

  safeSend(window, 'browser-gen-start', { sessionId, prompt: cleanPrompt || prompt })

  let accumulatedText = ''

  try {
    const reasoningLevel = config.modelReasoningLevels?.[model.id] || 'minimal'

    await streamOpenAiCompletion(
      provider,
      model.id,
      messages,
      [],
      abortController.signal,
      {
        onTextDelta: (delta: string) => {
          accumulatedText += delta
          const currentCleanHtml = cleanGeneratedHtml(accumulatedText)
          safeSend(window, 'browser-gen-chunk', {
            sessionId,
            chunk: delta,
            fullHtml: currentCleanHtml
          })
        },
        onReasoningDelta: () => {
          // Generative browser focuses strictly on HTML output
        },
        onToolCallDelta: () => {
          // No tools required for pure HTML compilation
        }
      },
      reasoningLevel
    )

    const finalHtml = cleanGeneratedHtml(accumulatedText)
    safeSend(window, 'browser-gen-end', {
      sessionId,
      fullHtml: finalHtml
    })
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      safeSend(window, 'browser-gen-error', {
        sessionId,
        error: 'Generation stopped by user'
      })
    } else {
      const errorMsg = err instanceof Error ? err.message : String(err)
      safeSend(window, 'browser-gen-error', {
        sessionId,
        error: errorMsg
      })
    }
  } finally {
    if (activeGenerations.get(sessionId) === abortController) {
      activeGenerations.delete(sessionId)
    }
  }
}
