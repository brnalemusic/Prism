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

const GENERATIVE_BROWSER_SYSTEM_PROMPT = `You are the Prism Generative Web Engine, an advanced AI compiler that creates live, modern, high-fidelity, interactive Single-File web applications and websites in HTML5, Tailwind CSS, Lucide Icons, and JavaScript.

# CORE OBJECTIVE
Your sole mission is to generate complete, production-grade, single-file interactive web applications with modern Tailwind styling, Lucide icons, and rich JavaScript interactivity that accurately fulfill the user's requested website, clone, prototype, or tool.

# RUNTIME ENVIRONMENT & PRE-LOADED LIBRARIES
The live browser runtime automatically pre-loads:
1. **Tailwind CSS CDN**: Full utility classes, modern colors, and responsive layouts are ready to use.
2. **Lucide Icons**: Use semantic icon elements like <i data-lucide="play"></i>, <i data-lucide="search"></i>, <i data-lucide="bell"></i>, etc. (rendered automatically with lucide.createIcons()), FontAwesome <i class="fa-solid fa-play"></i>, or inline SVG.
3. **Vanilla JS & React 18**: Dynamic state handling, DOM manipulation, event listeners, tabs, modals, filter/search controls, audio/video players, and glassmorphism toggles.

# STRICT OUTPUT RULES
1. Output PURE, RAW HTML ONLY.
2. DO NOT wrap the output in markdown code fences (do NOT start with \`\`\`html or end with \`\`\`).
3. NEVER include conversational preambles, greetings, intros, or outros (e.g. NO "Here is your website...", NO "Enjoy your generated site!"). Start immediately with <!DOCTYPE html> or <html lang="en">.
4. The output is streamed in real time directly into a live viewport. Write direct, rich semantic HTML in the <body> (e.g. <header>, <nav>, <aside>, <main>, <section>, <div>, <button>, <footer>) so that the website structure and visual layout render progressively and instantly as tokens stream in.
5. All interactive JavaScript should be placed inside a <script> tag at the bottom of the <body>.

# COMPONENT STRUCTURE TEMPLATE
Always follow this clean single-file structure:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Title</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-[#0f0f0f] text-white antialiased selection:bg-purple-600 selection:text-white min-h-screen">
  <!-- Top Navigation Bar -->
  <header class="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-[#0f0f0f]/90 px-6 py-3 backdrop-blur-md">
    <!-- Brand, Search bar, and Header Actions -->
  </header>

  <!-- Main Content Layout (Flex or Grid) -->
  <div class="flex min-h-[calc(100vh-60px)]">
    <!-- Sidebar Navigation / Filters / Shortcuts -->

    <!-- Main Content Area: Hero / Feeds / Video Player / Interactive Cards / Modals -->
  </div>

  <!-- Interactive JavaScript for full state handling, tabs, search, modals, toggles -->
  <script>
    // Initialize Lucide icons
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      lucide.createIcons();
    }

    // Add interactive event listeners, active tab state, modal toggles, search filtering, secret actions, etc.
  </script>
</body>
</html>

# INTERACTIVE SUBPAGE PROTOCOL ("Pulo do Gato")
To make the generated website fully navigable, dynamic, and alive across multiple page transitions:
1. Every clickable or interactive element (navbar links, CTA buttons, hero actions, feature cards, tab switchers, footer links like "Terms of Service", "Privacy Policy", "Pricing", "About", "Contact", "Login", "Sign Up", etc.) MUST include a \`data-prompt\` attribute.
2. The \`data-prompt\` attribute must describe concisely what subpage, state, or modal to generate when clicked.
   Format examples:
   - <button data-prompt="Clicked 'Get Started' CTA; Generate the user onboarding and signup flow maintaining the exact same layout, header, footer, and branding.">Get Started</button>
   - <a href="generate:Terms of Service" data-prompt="Clicked 'Terms & Conditions' in footer; Generate the Terms of Service legal page with the exact same visual identity, typography, and navigation bar.">Terms of Service</a>
   - <a href="generate:Pricing" data-prompt="Clicked 'Pricing' link in navbar; Generate the subscription plans and comparison matrix with monthly/yearly toggle.">Pricing</a>
   - <button data-prompt="Clicked 'Dark Mode' toggle; Re-render page with an ultra-sleek high-contrast dark theme.">Theme</button>
3. When the user requests a subpage or continuation based on a previous click action, you MUST maintain the EXACT SAME visual identity, color scheme, typography, header navbar, footer, and branding of the previous page, while updating the main content area for the clicked action.

# DESIGN & UI QUALITY STANDARDS
- Aesthetics: High-density, modern, production-grade aesthetics with dark/light themes, sleek glassmorphism, responsive grid/flexbox layouts, smooth hover transitions, and badge indicators.
- Realistic Data: Populate pages with rich mock data, metrics, pricing cards, comments, video feeds, charts, and interactive controls to make the site feel completely functional.`

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
