import { BrowserWindow } from 'electron'
import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { OpenAiMessage, StreamToolCallDelta } from './types'
import { getNativeToolsForOpenAi } from './chatHandler'
import { getSystemToolsPrompt } from '../systemTools'
import { safeSend } from '../safeSend'
import { executeValidatedTool, ToolLoopGuard } from '../toolRuntime'

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
    safeSend(window, 'launcher-reply-error', { error: 'No active AI Provider configured' })
    return
  }

  launcherHistory.push({ role: 'user', content: message })
  safeSend(window, 'launcher-reply-start')

  try {
    const systemPrompt: OpenAiMessage = {
      role: 'system',
      content: getSystemToolsPrompt(model.id, 'launcher')
    }

    const launcherTools = getNativeToolsForOpenAi('launcher')
    let loopCount = 0
    const maxLoops = 100
    const toolLoopGuard = new ToolLoopGuard()

    let fullText = ''
    let fullReasoning = ''
    let replyEnded = false

    while (loopCount < maxLoops) {
      loopCount++
      const messages: OpenAiMessage[] = [systemPrompt, ...launcherHistory]

      let currentText = ''
      let currentReasoning = ''
      const currentStreamingToolCalls: Array<{ index: number; name: string; arguments: string; isComplete: boolean }> = []

      const parseThoughtAndContent = (rawText: string, extraReasoning: string) => {
        let thoughts = extraReasoning || ''
        let content = rawText

        const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
        if (thinkMatch) {
          const embeddedThought = thinkMatch[1]
          thoughts = thoughts ? `${thoughts}\n${embeddedThought}` : embeddedThought
          content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
        }

        return { thoughts, content }
      }

      const result = await streamOpenAiCompletion(
        provider,
        model.id,
        messages,
        launcherTools,
        launcherAbortController.signal,
        {
          onTextDelta: (text) => {
            currentText += text
            const combinedText = fullText ? fullText + '\n\n' + currentText : currentText
            const combinedReasoning = fullReasoning ? fullReasoning + '\n\n' + currentReasoning : currentReasoning
            const { thoughts, content } = parseThoughtAndContent(combinedText, combinedReasoning)

            safeSend(window, 'launcher-reply-chunk', {
              thoughts,
              finalResponse: content,
              isThinking: !!thoughts && !content,
              isWritingToolCall: currentStreamingToolCalls.length > 0,
              streamingToolCalls: currentStreamingToolCalls.length > 0 ? currentStreamingToolCalls : undefined
            })
          },
          onReasoningDelta: (reasoning) => {
            currentReasoning += reasoning
            const combinedText = fullText ? fullText + '\n\n' + currentText : currentText
            const combinedReasoning = fullReasoning ? fullReasoning + '\n\n' + currentReasoning : currentReasoning
            const { thoughts, content } = parseThoughtAndContent(combinedText, combinedReasoning)

            safeSend(window, 'launcher-reply-chunk', {
              thoughts,
              finalResponse: content,
              isThinking: true,
              isWritingToolCall: currentStreamingToolCalls.length > 0,
              streamingToolCalls: currentStreamingToolCalls.length > 0 ? currentStreamingToolCalls : undefined
            })
          },
          onToolCallDelta: (delta: StreamToolCallDelta) => {
            const existingIdx = currentStreamingToolCalls.findIndex(t => t.index === delta.index)
            if (existingIdx !== -1) {
              const existing = currentStreamingToolCalls[existingIdx]
              currentStreamingToolCalls[existingIdx] = {
                ...existing,
                name: delta.name || existing.name,
                arguments: existing.arguments + (delta.argsDelta || ''),
                isComplete: false
              }
            } else {
              currentStreamingToolCalls.push({
                index: delta.index,
                name: delta.name || '',
                arguments: delta.argsDelta || '',
                isComplete: false
              })
            }

            const combinedText = fullText ? fullText + '\n\n' + currentText : currentText
            const combinedReasoning = fullReasoning ? fullReasoning + '\n\n' + currentReasoning : currentReasoning
            const { thoughts, content } = parseThoughtAndContent(combinedText, combinedReasoning)

            safeSend(window, 'launcher-reply-chunk', {
              thoughts,
              finalResponse: content,
              isThinking: false,
              isWritingToolCall: true,
              streamingToolCalls: currentStreamingToolCalls
            })
          }
        }
      )

      currentText = result.text || currentText
      currentReasoning = result.reasoning || currentReasoning

      const { thoughts: iterThoughts, content: iterContent } = parseThoughtAndContent(currentText, currentReasoning)
      if (iterContent) {
        fullText = fullText ? fullText + '\n\n' + iterContent : iterContent
      }
      if (iterThoughts) {
        fullReasoning = fullReasoning ? fullReasoning + '\n\n' + iterThoughts : iterThoughts
      }

      if (result.toolCalls && result.toolCalls.length > 0) {
        launcherHistory.push({
          role: 'assistant',
          content: iterContent || null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
            ...(tc.thoughtSignature
              ? {
                  thought_signature: tc.thoughtSignature,
                  extra_content: { google: { thought_signature: tc.thoughtSignature } }
                }
              : {})
          })),
          ...(result.nativeContent
            ? { provider_metadata: { gemini: { content: result.nativeContent } } }
            : {})
        })

        for (const tc of result.toolCalls) {
          const toolCallId = tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
          const execution = await executeValidatedTool(
            tc.name,
            tc.args,
            {
              event: { sender: window.webContents },
              signal: launcherAbortController.signal,
              onStart: (args) =>
                safeSend(window, 'launcher-tool-start', {
                  callId: toolCallId,
                  name: tc.name,
                  args
                })
            },
            toolLoopGuard
          )
          const toolOutput = execution.modelContent

          safeSend(window, 'launcher-tool-end', {
            callId: toolCallId,
            name: tc.name,
            result: toolOutput
          })

          launcherHistory.push({
            role: 'tool',
            tool_call_id: toolCallId,
            name: tc.name,
            content: toolOutput
          })
        }
      } else {
        launcherHistory.push({ role: 'assistant', content: fullText })
        replyEnded = true
        break
      }
    }

    if (!replyEnded && !launcherAbortController.signal.aborted) {
      let limitText = ''
      let limitReasoning = ''
      const finalResult = await streamOpenAiCompletion(
        provider,
        model.id,
        [
          {
            role: 'system',
            content:
              `${getSystemToolsPrompt(model.id, 'launcher')}\n\n` +
              'The maximum of 100 tool rounds has been reached. Do not call more tools. ' +
              'Summarize completed work, remaining work, and the last tool result.'
          },
          ...launcherHistory
        ],
        [],
        launcherAbortController.signal,
        {
          onTextDelta: (text) => {
            limitText += text
            safeSend(window, 'launcher-reply-chunk', {
              thoughts: fullReasoning + limitReasoning,
              finalResponse: fullText ? `${fullText}\n\n${limitText}` : limitText,
              isThinking: false,
              isWritingToolCall: false
            })
          },
          onReasoningDelta: (reasoning) => {
            limitReasoning += reasoning
          },
          onToolCallDelta: () => {}
        }
      )
      limitText = finalResult.text || limitText
      limitReasoning = finalResult.reasoning || limitReasoning
      if (limitText) fullText = fullText ? `${fullText}\n\n${limitText}` : limitText
      if (limitReasoning) fullReasoning += limitReasoning
      launcherHistory.push({
        role: 'assistant',
        content: finalResult.text,
        ...(finalResult.nativeContent
          ? { provider_metadata: { gemini: { content: finalResult.nativeContent } } }
          : {})
      })
    }

    safeSend(window, 'launcher-reply-end', {
      thoughts: fullReasoning,
      finalResponse: fullText
    })
  } catch (error: any) {
    if (launcherAbortController?.signal.aborted) {
      safeSend(window, 'launcher-reply-error', { error: 'Request cancelled' })
    } else {
      safeSend(window, 'launcher-reply-error', { error: error.message || String(error) })
    }
  } finally {
    launcherAbortController = null
  }
}
