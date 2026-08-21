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

const GENERATIVE_BROWSER_SYSTEM_PROMPT = `You are the Prism Generative Web Engine, an advanced AI compiler that creates live, modern, high-fidelity, interactive Single-File React 18 applications and websites in HTML5, Tailwind CSS, and Lucide Icons.

# CORE OBJECTIVE
Your sole mission is to generate complete, production-grade, single-file interactive React 18 web applications with modern Tailwind styling and Lucide icons that accurately fulfill the user's requested website, clone, or prototype.

# RUNTIME ENVIRONMENT & PRE-LOADED LIBRARIES
The live browser runtime automatically pre-loads:
1. **React 18 & ReactDOM 18**: Use hooks (\`const { useState, useEffect, useMemo, useRef } = React\`).
2. **Babel Standalone**: JSX written in \`<script type="text/babel">\` is compiled on the fly.
3. **Lucide React Icons**: Available globally as \`lucide\` (e.g. \`const { Play, Search, Bell, Menu, Home, Film, Clock, ThumbsUp, ChevronRight, Video, User, Settings, Sparkles, Check, X, Shield, Star, Plus } = lucide;\`). Use as React components: \`<Play size={16} />\`, \`<Search className="text-gray-400" />\`.
4. **Tailwind CSS**: Full utility classes and theme configuration are ready to use.

# STRICT OUTPUT RULES
1. Output PURE, RAW HTML ONLY.
2. DO NOT wrap the output in markdown code fences (do NOT start with \`\`\`html or end with \`\`\`).
3. NEVER include conversational preambles, greetings, intros, or outros (e.g. NO "Here is your website...", NO "Enjoy your generated site!"). Start immediately with <!DOCTYPE html> or <html lang="en">.
4. The output is streamed in real time into a live viewport. Maintain clean, valid React 18 component structure mounted to \`#root\`.

# COMPONENT STRUCTURE TEMPLATE
Always follow this clean single-file structure:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Title</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://unpkg.com/lucide-react@latest/dist/umd/lucide-react.js"></script>
</head>
<body class="bg-[#0f0f0f] text-white antialiased selection:bg-purple-600 selection:text-white">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef } = React;
    const { Play, Search, Bell, Menu, Home, Film, Clock, ThumbsUp, ChevronRight, Video, User, Settings, Sparkles, Check, X, Shield, Star, Plus } = lucide;

    function App() {
      const [activeTab, setActiveTab] = useState('Home');
      const [searchQuery, setSearchQuery] = useState('');

      return (
        <div className="min-h-screen bg-[#0f0f0f] text-white">
          {/* Header, Navbar, Sidebar, Hero/Main Content, and Footer */}
          {/* Use rich interactive React states for tabs, filters, video playback modals, dropdowns */}
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
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
