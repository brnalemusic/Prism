import { IpcMainEvent } from 'electron'
import { loadConfig } from '../config'
import { searchChatsOffline } from '../history'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { OpenAiMessage, StreamToolCallDelta } from './types'
import { getNativeToolsForOpenAi } from './chatHandler'
import { executeSystemTool } from '../systemTools'

let searchAbortController: AbortController | null = null

export function cancelAiSearch(): void {
  if (searchAbortController) {
    searchAbortController.abort()
    searchAbortController = null
  }
}

export async function handleAiSearchChatMessage(
  event: IpcMainEvent,
  query: string
): Promise<void> {
  cancelAiSearch()
  searchAbortController = new AbortController()

  const config = loadConfig()
  const modelSelection = config.searchModel || config.lastSelectedChatModel
  const { provider, model } = resolveProviderAndModel(modelSelection)

  if (!provider || !provider.apiKey || !model) {
    event.sender.send('ai-search-reply-error', { error: 'No active AI Provider configured for search' })
    return
  }

  event.sender.send('ai-search-reply-start')

  try {
    const offlineData = searchChatsOffline(query)
    const contextSnippet = (offlineData.results || [])
      .slice(0, 10)
      .map(
        (res: any) =>
          `[Chat ID: ${res.id} | Title: "${res.title}"]\nSnippets: ${(res.matchingSnippets || []).join(' ... ')}`
      )
      .join('\n\n')

    console.log(`[AI SEARCH DEBUG MAIN] Starting search for query: "${query}" using model: ${model.id}`)

    const systemPrompt: OpenAiMessage = {
      role: 'system',
      content: `You are Prism Conversation Search Assistant. Analyze the user search query and past conversation history.

YOUR MANDATORY GOAL:
1. Examine the provided "Relevant Past Chats Context".
2. If one or more relevant past chats are found, call the 'render_chat_history' tool for each matching chat using its Chat ID or filename (e.g. {"query": "CHAT_ID"}). Also provide a helpful, concise summary of the relevant conversation history.
3. If NO past chats match the search query or context is empty, call the 'not_found_chat_history' tool.

Tool Call Format (if not using native API tool calling):
[PRISM_EXECUTE_TOOL]{"type":"render_chat_history","query":"CHAT_ID"}[/PRISM_EXECUTE_TOOL]`
    }

    const userPrompt: OpenAiMessage = {
      role: 'user',
      content: `User Search Query: "${query}"\n\nRelevant Past Chats Context:\n${contextSnippet || 'No direct keyword matches found.'}`
    }

    const searchTools = getNativeToolsForOpenAi('main')

    let fullText = ''
    let fullReasoning = ''
    const activeStreamingToolCalls: Array<{ index: number; name: string; arguments: string; isComplete: boolean }> = []

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

    const sendChunk = () => {
      const { thoughts, content } = parseThoughtAndContent(fullText, fullReasoning)
      event.sender.send('ai-search-reply-chunk', {
        thoughts,
        finalResponse: content,
        isThinking: !!thoughts && !content,
        isWritingToolCall: activeStreamingToolCalls.length > 0
      })
    }

    const result = await streamOpenAiCompletion(
      provider,
      model.id,
      [systemPrompt, userPrompt],
      searchTools,
      searchAbortController.signal,
      {
        onTextDelta: (text) => {
          fullText += text
          sendChunk()
        },
        onReasoningDelta: (reasoning) => {
          fullReasoning += reasoning
          sendChunk()
        },
        onToolCallDelta: (delta: StreamToolCallDelta) => {
          let tc = activeStreamingToolCalls.find((t) => t.index === delta.index)
          const toolName = delta.name || ''
          if (!tc) {
            tc = { index: delta.index, name: toolName, arguments: '', isComplete: false }
            activeStreamingToolCalls.push(tc)
          }
          if (toolName && !tc.name) tc.name = toolName
          if (delta.argsDelta) tc.arguments += delta.argsDelta
          sendChunk()
        }
      }
    )

    console.log(`[AI SEARCH DEBUG MAIN] AI Search completed. response: ${result.text?.length || 0} chars, tools: ${result.toolCalls?.length || 0}`)

    // Process native tool calls returned by API
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const tc of result.toolCalls) {
        let parsedArgs: Record<string, any> = {}
        try {
          parsedArgs = JSON.parse(tc.args || '{}')
        } catch {
          parsedArgs = { query: tc.args }
        }

        event.sender.send('ai-search-tool-start', { name: tc.name, args: parsedArgs })
        const toolOutput = await executeSystemTool(tc.name, parsedArgs)
        event.sender.send('ai-search-tool-end', { name: tc.name, result: String(toolOutput) })

        const toolJson = JSON.stringify({ type: tc.name, ...parsedArgs })
        const toolMarkup = `\n[PRISM_EXECUTE_TOOL]${toolJson}[/PRISM_EXECUTE_TOOL]\n`
        if (!fullText.includes(toolMarkup)) {
          fullText += toolMarkup
        }
      }
    }

    // Safety fallback: if AI didn't emit render_chat_history or not_found_chat_history, ensure UI displays results or not found state
    const hasRenderChatInText =
      /"type"\s*:\s*"render_chat_history"|"name"\s*:\s*"render_chat_history"/.test(fullText) ||
      result.toolCalls?.some((tc) => tc.name === 'render_chat_history')

    const hasNotFoundChatInText =
      /"type"\s*:\s*"not_found_chat_history"|"name"\s*:\s*"not_found_chat_history"/.test(fullText) ||
      result.toolCalls?.some((tc) => tc.name === 'not_found_chat_history')

    if (!hasRenderChatInText && !hasNotFoundChatInText) {
      if (offlineData.results && offlineData.results.length > 0) {
        const topResults = offlineData.results.slice(0, 3)
        for (const res of topResults) {
          const toolJson = JSON.stringify({ type: 'render_chat_history', query: res.id })
          fullText += `\n[PRISM_EXECUTE_TOOL]${toolJson}[/PRISM_EXECUTE_TOOL]\n`
          event.sender.send('ai-search-tool-start', { name: 'render_chat_history', args: { query: res.id } })
          event.sender.send('ai-search-tool-end', {
            name: 'render_chat_history',
            result: `Successfully rendered chat history for ${res.id}`
          })
        }
      } else {
        const toolJson = JSON.stringify({ type: 'not_found_chat_history' })
        fullText += `\n[PRISM_EXECUTE_TOOL]${toolJson}[/PRISM_EXECUTE_TOOL]\n`
        event.sender.send('ai-search-tool-start', { name: 'not_found_chat_history', args: {} })
        event.sender.send('ai-search-tool-end', {
          name: 'not_found_chat_history',
          result: 'No matching chat history found'
        })
      }
    }

    const { thoughts, content } = parseThoughtAndContent(fullText, fullReasoning)

    event.sender.send('ai-search-reply-end', {
      thoughts,
      finalResponse: content,
      offlineResults: offlineData.results
    })
  } catch (error: any) {
    if (searchAbortController?.signal.aborted) {
      console.log('[AI SEARCH DEBUG MAIN] Search aborted before main loop')
      event.sender.send('ai-search-reply-error', { error: 'Search cancelled' })
    } else {
      console.error('AI Search Error:', error)
      event.sender.send('ai-search-reply-error', { error: error.message || String(error) })
    }
  } finally {
    searchAbortController = null
  }
}
