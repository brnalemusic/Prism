import { BrowserWindow } from 'electron'
import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { OpenAiMessage, StreamToolCallDelta } from './types'
import { getNativeToolsForOpenAi } from './chatHandler'
import { executeSystemTool, getSystemToolsPrompt } from '../systemTools'

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
      content: getSystemToolsPrompt(model.id, 'launcher')
    }

    const launcherTools = getNativeToolsForOpenAi('launcher')
    let loopCount = 0
    const maxLoops = 10

    let fullText = ''
    let fullReasoning = ''

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

            window.webContents.send('launcher-reply-chunk', {
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

            window.webContents.send('launcher-reply-chunk', {
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

            window.webContents.send('launcher-reply-chunk', {
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
        for (const tc of result.toolCalls) {
          const toolCallId = tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

          let parsedArgs: Record<string, any> = {}
          try {
            parsedArgs = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args || {}
          } catch {
            parsedArgs = {}
          }

          window.webContents.send('launcher-tool-start', {
            name: tc.name,
            args: parsedArgs
          })

          let toolOutput = ''
          try {
            const execRes = await executeSystemTool(tc.name, parsedArgs, { sender: window.webContents })
            toolOutput = typeof execRes === 'string' ? execRes : JSON.stringify(execRes)
          } catch (err: any) {
            toolOutput = `Error: ${err.message || String(err)}`
          }

          window.webContents.send('launcher-tool-end', {
            name: tc.name,
            result: toolOutput
          })

          launcherHistory.push({
            role: 'assistant',
            content: iterContent || null,
            tool_calls: [
              {
                id: toolCallId,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
                },
                ...(tc.thoughtSignature
                  ? {
                      thought_signature: tc.thoughtSignature,
                      extra_content: { google: { thought_signature: tc.thoughtSignature } }
                    }
                  : {})
              }
            ]
          })

          launcherHistory.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: toolOutput
          })
        }
      } else {
        launcherHistory.push({ role: 'assistant', content: fullText })
        break
      }
    }

    window.webContents.send('launcher-reply-end', {
      thoughts: fullReasoning,
      finalResponse: fullText
    })
  } catch (error: any) {
    if (launcherAbortController?.signal.aborted) {
      window.webContents.send('launcher-reply-error', { error: 'Request cancelled' })
    } else {
      window.webContents.send('launcher-reply-error', { error: error.message || String(error) })
    }
  } finally {
    launcherAbortController = null
  }
}

