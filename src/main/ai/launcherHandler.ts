import { BrowserWindow } from 'electron'
import { loadConfig } from '../config'
import { resolveProviderAndModel, PRISM_PROVIDER_ID } from './providerManager'
import { OpenAiMessage } from './types'
import { getNativeToolsForOpenAi } from './chatHandler'
import { getSystemToolsPrompt } from '../systemTools'
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
      systemContent += `\n\n# YouTube Video Search Protocol (Active YouTube App Mode)
You are acting as the specialized YouTube Assistant. The user wants to find YouTube videos.
STRICT EXECUTION PROTOCOL:
1. SEARCH VIA GOOGLE QUERY: You MUST search using the 'web_search' tool with the exact query format:
   \`site:youtube.com <SEARCH_QUERY>\`
   (e.g., web_search({ query: "site:youtube.com Thinking Space II verified" })).
   This uses Google search to instantly and reliably locate the official YouTube video URLs (https://www.youtube.com/watch?v=...), channel names, video titles, and snippets.
2. OUTPUT FORMAT (MANDATORY STYLED CARD BLOCK): You MUST format your final response by wrapping the title, description, and buttons in an HTML card container block, followed by the suggestion chip below it:

<div style="border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 18px 20px; background: rgba(255, 255, 255, 0.03); margin: 12px 0;">
  <div style="font-size: 16px; font-weight: bold; color: #ffffff; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
    🎬 <span>[Video Title / Clean Name]</span>
  </div>
  <div style="font-size: 14px; color: rgba(255, 255, 255, 0.75); line-height: 1.5; margin-bottom: 16px;">
    [Customized description of what was found based on the user request].
  </div>
  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
    <a href="https://www.youtube.com/watch?v=..." target="_blank" style="display: inline-flex; align-items: center; justify-content: center; background-color: #ff0000; color: #ffffff; padding: 8px 18px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13.5px;">[Primary Action/Watch Label]</a>
    <a href="https://www.youtube.com/watch?v=..." target="_blank" style="display: inline-flex; align-items: center; justify-content: center; background-color: #272727; color: #ffffff; padding: 8px 18px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 13.5px;">[Alternative Label]</a>
  </div>
</div>

<prism-suggestion send="Open the YouTube video that you've found for me.">Open the video</prism-suggestion>

STRICT BUTTON RULES:
- Maximum 3 buttons total inside the flex container (1 primary in bold red #ff0000, up to 2 alternatives in dark charcoal #272727).
- All buttons MUST be clickable <a> links with real href="https://www.youtube.com/watch?v=..." and target="_blank".
- The <prism-suggestion> chip MUST be outside/below the card container.
3. OPENING THE FOUND VIDEO: If the user sends "Open the YouTube video that you've found for me." or asks to open/play the video, immediately call 'open_browser_link' with the target video URL to open it in their browser.`
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
