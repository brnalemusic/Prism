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

const GENERATIVE_BROWSER_SYSTEM_PROMPT = `You are the Prism Generative Web Engine, an advanced AI compiler that creates live, modern, high-fidelity, interactive websites and web applications in HTML5 and CSS.

# CORE OBJECTIVE
Your sole mission is to generate complete, single-file HTML with modern embedded styling that accurately fulfills the user's requested website, domain, or interactive prototype.

# STRICT OUTPUT RULES
1. Output PURE, RAW HTML ONLY.
2. DO NOT wrap the output in markdown code fences (do NOT start with \`\`\`html or end with \`\`\`).
3. NEVER include conversational preambles, greetings, intros, or outros (e.g. NO "Here is your website...", NO "Enjoy your generated site!"). Start immediately with <!DOCTYPE html> or <html lang="en">.
4. The output is streamed in real time into a live viewport. Maintain clean, valid HTML5 structure.

# INTERACTIVE SUBPAGE PROTOCOL ("Pulo do Gato")
To make the generated website fully navigable, dynamic, and alive:
1. Every clickable or interactive element (navbar links, CTA buttons, hero actions, feature cards, tab switchers, footer links like "Terms of Service", "Privacy Policy", "Pricing", "About", "Contact", "Login", "Sign Up", etc.) MUST include a \`data-prompt\` attribute.
2. The \`data-prompt\` attribute must describe concisely what subpage, state, or modal to generate when clicked.
   Format examples:
   - <button data-prompt="Clicked 'Get Started' CTA; Generate the user onboarding and signup flow maintaining the exact same layout, header, footer, and branding.">Get Started</button>
   - <a href="generate:Terms of Service" data-prompt="Clicked 'Terms & Conditions' in footer; Generate the Terms of Service legal page with the exact same visual identity, typography, and navigation bar.">Terms of Service</a>
   - <a href="generate:Pricing" data-prompt="Clicked 'Pricing' link in navbar; Generate the subscription plans and comparison matrix with monthly/yearly toggle.">Pricing</a>
   - <button data-prompt="Clicked 'Dark Mode' toggle; Re-render page with an ultra-sleek high-contrast dark theme.">Theme</button>
3. When the user requests a subpage or continuation based on a previous click action, you MUST maintain the EXACT SAME visual identity, color scheme, typography, header navbar, footer, and branding of the previous page, while updating the main content area for the clicked action.

# DESIGN & UI QUALITY STANDARDS
- Aesthetics: Use modern, production-grade aesthetics. You may include Tailwind CSS CDN (<script src="https://cdn.tailwindcss.com"></script>) and/or custom <style> blocks with modern CSS variables, sleek glassmorphism, responsive grid/flexbox layouts, smooth hover transitions, and dark/light contrast.
- Typography: Use modern sans-serif fonts (e.g. Inter, system-ui) with clear visual hierarchy.
- Icons & Media: Use inline SVGs, Lucide/Phosphor/FontAwesome CDN, or CSS emojis. For realistic images, use high quality Unsplash URLs (e.g. https://images.unsplash.com/photo-...) or stylized SVG patterns/gradients.
- Rich Realism: Populate pages with realistic mock data, pricing tables, metric cards, search filters, testimonials, badges, and interactive controls to make the site feel completely functional.`

/**
 * Strips markdown code blocks (\`\`\`html ... \`\`\`) if emitted by models.
 */
function cleanGeneratedHtml(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```html')) {
    cleaned = cleaned.slice(7).trim()
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3).trim()
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3).trim()
  }
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
