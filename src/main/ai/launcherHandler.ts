import { BrowserWindow } from 'electron'
import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { OpenAiMessage } from './types'

let launcherHistory: OpenAiMessage[] = []
let launcherAbortController: AbortController | null = null

export function clearLauncherChat(): void {
  launcherHistory = []
  if (launcherAbortController) {
    launcherAbortController.abort()
    launcherAbortController = null
  }
}

export async function handleLauncherChatMessage(
  window: BrowserWindow,
  message: string
): Promise<void> {
  if (launcherAbortController) {
    launcherAbortController.abort()
  }
  launcherAbortController = new AbortController()

  const config = loadConfig()
  const modelSelection = config.quickLauncherModel || config.lastSelectedChatModel
  const { provider, model } = resolveProviderAndModel(modelSelection)

  if (!provider || !provider.apiKey || !model) {
    window.webContents.send('launcher-reply-error', { error: 'No active AI Provider configured' })
    return
  }

  launcherHistory.push({ role: 'user', content: message })
  window.webContents.send('launcher-reply-start')

  try {
    const systemPrompt: OpenAiMessage = {
      role: 'system',
      content:
        'You are Prism Quick Launcher AI, a fast, concise assistant. Answer directly, clearly, and compactly in clean markdown.'
    }

    const messages: OpenAiMessage[] = [systemPrompt, ...launcherHistory]

    let fullText = ''
    let fullReasoning = ''

    const result = await streamOpenAiCompletion(
      provider,
      model.id,
      messages,
      [],
      launcherAbortController.signal,
      {
        onTextDelta: (text) => {
          fullText += text
          window.webContents.send('launcher-reply-chunk', { text })
        },
        onReasoningDelta: (reasoning) => {
          fullReasoning += reasoning
          window.webContents.send('launcher-reply-thought', { thought: reasoning })
        },
        onToolCallDelta: () => {}
      }
    )

    launcherHistory.push({ role: 'assistant', content: result.text })

    window.webContents.send('launcher-reply-end', {
      thoughts: result.reasoning,
      finalResponse: result.text
    })
  } catch (error: any) {
    if (launcherAbortController.signal.aborted) {
      window.webContents.send('launcher-reply-error', { error: 'Request cancelled' })
    } else {
      window.webContents.send('launcher-reply-error', { error: error.message || String(error) })
    }
  } finally {
    launcherAbortController = null
  }
}
