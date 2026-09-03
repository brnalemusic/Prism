import { BrowserWindow } from 'electron'
import { loadConfig } from '../config'
import { resolveProviderAndModel, PRISM_PROVIDER_ID } from './providerManager'
import { OpenAiMessage } from './types'
import { getNativeToolsForOpenAi } from './chatHandler'
import { getSystemToolsPrompt, YOUTUBE_SEARCH_PROTOCOL } from '../systemTools'
import { safeSend } from '../safeSend'
import { runToolOrchestration } from './toolOrchestrator'
import { markConnectionActive } from '../connection'

import { unlockBrowserToolsForSession } from '../skillsManager'

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
  message: string,
  appMode?: string
): Promise<void> {
  if (launcherAbortController) {
    launcherAbortController.abort()
  }
  const abortController = new AbortController()
  launcherAbortController = abortController

  const config = loadConfig()
  const currentSelectedChatModel =
    config.quickLauncherModel || config.lastSelectedChatModel || config.defaultModel || ''
  const { provider, model } = resolveProviderAndModel(currentSelectedChatModel)

  if (!provider || !model) {
    safeSend(window, 'launcher-reply-error', {
      error: 'No active AI model or API key configured. Open settings to configure.'
    })
    return
  }

  markConnectionActive()

  launcherHistory.push({ role: 'user', content: message })
  safeSend(window, 'launcher-reply-start')

  try {
    const isPrismCloud = provider?.id === PRISM_PROVIDER_ID || provider?.name === 'Prism Cloud'
    const isYoutubeMode =
      appMode === 'youtube' ||
      /^Search YouTube for:/i.test(message.trim()) ||
      /^\/youtube\b/i.test(message.trim())

    if (isYoutubeMode) {
      unlockBrowserToolsForSession('launcher')
    }

    let systemContent = getSystemToolsPrompt(
      model.id,
      'launcher',
      undefined,
      'execution',
      '',
      model.name,
      isPrismCloud
    )

    if (isYoutubeMode) {
      systemContent += `

${YOUTUBE_SEARCH_PROTOCOL}`
    }

    const systemPrompt: OpenAiMessage = {
      role: 'system',
      content: systemContent
    }

    const launcherTools = getNativeToolsForOpenAi('launcher', undefined, 'launcher')
    const messages: OpenAiMessage[] = [systemPrompt, ...launcherHistory]
    const parseThoughtAndContent = (
      rawText: string,
      extraReasoning: string
    ): { thoughts: string; content: string } => {
      let thoughts = extraReasoning || ''
      let content = rawText
      const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
      if (thinkMatch) {
        thoughts = thoughts ? `${thoughts}\n${thinkMatch[1]}` : thinkMatch[1]
        content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
      }
      return { thoughts, content }
    }

    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages,
      tools: launcherTools,
      signal: abortController.signal,
      onStreamEvent: (streamEvent, state) => {
        const combinedText = state.accumulatedText
          ? `${state.accumulatedText}\n\n${state.currentText}`
          : state.currentText
        const combinedReasoning = state.accumulatedReasoning
          ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
          : state.currentReasoning
        const parsed = parseThoughtAndContent(combinedText, combinedReasoning)
        safeSend(window, 'launcher-reply-chunk', {
          thoughts: parsed.thoughts,
          finalResponse: parsed.content,
          isThinking: streamEvent.type === 'reasoning',
          isWritingToolCall: state.streamingToolCalls.length > 0,
          streamingToolCalls:
            state.streamingToolCalls.length > 0
              ? state.streamingToolCalls.map((call) => ({ ...call, isComplete: false }))
              : undefined
        })
      },
      createToolContext: ({ callId, name }) => ({
        event: { sender: window.webContents },
        signal: abortController.signal,
        onStart: (args) => safeSend(window, 'launcher-tool-start', { callId, name, args })
      }),
      onToolResult: (call) =>
        safeSend(window, 'launcher-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent
        }),
      onHistoryMessage: (historyMessage) => launcherHistory.push(historyMessage),
      finalInstruction:
        'The maximum of 100 tool rounds has been reached. Do not call more tools. ' +
        'Summarize completed work, remaining work, and the last tool result.'
    })

    const finalOutput = parseThoughtAndContent(
      orchestration.accumulatedText,
      orchestration.accumulatedReasoning
    )
    safeSend(window, 'launcher-reply-end', {
      thoughts: finalOutput.thoughts,
      finalResponse: finalOutput.content,
      ...(orchestration.loopLimitReached ? { loopLimitReached: true } : {})
    })
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      safeSend(window, 'launcher-reply-error', { error: 'Request cancelled' })
    } else {
      safeSend(window, 'launcher-reply-error', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  } finally {
    if (launcherAbortController === abortController) launcherAbortController = null
  }
}
