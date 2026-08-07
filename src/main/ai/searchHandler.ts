import { IpcMainEvent } from 'electron'
import { loadConfig } from '../config'
import { searchChatsOffline } from '../history'
import { resolveProviderAndModel } from './providerManager'
import { OpenAiMessage } from './types'
import { getNativeToolsForOpenAi } from './chatHandler'
import { safeSend } from '../safeSend'
import { executeValidatedTool } from '../toolRuntime'
import { runToolOrchestration } from './toolOrchestrator'

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
  const abortController = new AbortController()
  searchAbortController = abortController

  const config = loadConfig()
  const modelSelection = config.searchModel || config.lastSelectedChatModel
  const { provider, model } = resolveProviderAndModel(modelSelection)

  if (!provider || !provider.apiKey || !model) {
    safeSend(event.sender, 'ai-search-reply-error', { error: 'No active AI Provider configured for search' })
    return
  }

  safeSend(event.sender, 'ai-search-reply-start')

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
      content: `Prism Conversation Search Assistant. Analyze query and past chat context.
1. If matches found, invoke 'render_chat_history' with matching Chat ID and provide concise summary.
2. If no matches, invoke 'not_found_chat_history'.`
    }

    const userPrompt: OpenAiMessage = {
      role: 'user',
      content: `User Search Query: "${query}"\n\nRelevant Past Chats Context:\n${contextSnippet || 'No direct keyword matches found.'}`
    }

    const searchTools = getNativeToolsForOpenAi('main', [
      'render_chat_history',
      'not_found_chat_history'
    ])

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

    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages: [systemPrompt, userPrompt],
      tools: searchTools,
      signal: abortController.signal,
      onStreamEvent: (streamEvent, state) => {
        const currentText = state.accumulatedText
          ? `${state.accumulatedText}\n\n${state.currentText}`
          : state.currentText
        const currentReasoning = state.accumulatedReasoning
          ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
          : state.currentReasoning
        const parsed = parseThoughtAndContent(currentText, currentReasoning)
        safeSend(event.sender, 'ai-search-reply-chunk', {
          thoughts: parsed.thoughts,
          finalResponse: parsed.content,
          isThinking: streamEvent.type === 'reasoning',
          isWritingToolCall: state.streamingToolCalls.length > 0
        })
      },
      createToolContext: ({ callId, name }) => ({
        signal: abortController.signal,
        onStart: (args) =>
          safeSend(event.sender, 'ai-search-tool-start', { callId, name, args })
      }),
      onToolResult: (call) =>
        safeSend(event.sender, 'ai-search-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent
        }),
      finalInstruction:
        'The maximum tool-call limit was reached. Do not call more tools. ' +
        'Summarize the conversation-search result.'
    })

    const fullText = orchestration.accumulatedText
    const fullReasoning = orchestration.accumulatedReasoning
    console.log(
      `[AI SEARCH DEBUG MAIN] AI Search completed. response: ${fullText.length} chars, ` +
        `tools: ${orchestration.executedTools.length}`
    )

    // Safety fallback: if AI didn't emit render_chat_history or not_found_chat_history, ensure UI displays results or not found state
    const hasRenderChatInText = orchestration.executedTools.some(
      (call) => call.name === 'render_chat_history'
    )
    const hasNotFoundChatInText = orchestration.executedTools.some(
      (call) => call.name === 'not_found_chat_history'
    )

    if (!hasRenderChatInText && !hasNotFoundChatInText) {
      if (offlineData.results && offlineData.results.length > 0) {
        const topResults = offlineData.results.slice(0, 3)
        for (const res of topResults) {
          const callId = `search-fallback-${res.id}`
          const execution = await executeValidatedTool('render_chat_history', { query: res.id }, {
            signal: abortController.signal,
            onStart: (args) =>
              safeSend(event.sender, 'ai-search-tool-start', {
                callId,
                name: 'render_chat_history',
                args
              })
          })
          safeSend(event.sender, 'ai-search-tool-end', {
            callId,
            name: 'render_chat_history',
            result: execution.modelContent
          })
        }
      } else {
        const callId = `search-fallback-not-found-${Date.now()}`
        const execution = await executeValidatedTool('not_found_chat_history', {}, {
          signal: abortController.signal,
          onStart: (args) =>
            safeSend(event.sender, 'ai-search-tool-start', {
              callId,
              name: 'not_found_chat_history',
              args
            })
        })
        safeSend(event.sender, 'ai-search-tool-end', {
          callId,
          name: 'not_found_chat_history',
          result: execution.modelContent
        })
      }
    }

    const { thoughts, content } = parseThoughtAndContent(fullText, fullReasoning)

    safeSend(event.sender, 'ai-search-reply-end', {
      thoughts,
      finalResponse: content,
      offlineResults: offlineData.results
    })
  } catch (error: any) {
    if (abortController.signal.aborted) {
      console.log('[AI SEARCH DEBUG MAIN] Search aborted before main loop')
      safeSend(event.sender, 'ai-search-reply-error', { error: 'Search cancelled' })
    } else {
      console.error('AI Search Error:', error)
      safeSend(event.sender, 'ai-search-reply-error', { error: error.message || String(error) })
    }
  } finally {
    if (searchAbortController === abortController) searchAbortController = null
  }
}
