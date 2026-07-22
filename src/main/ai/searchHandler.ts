import { IpcMainEvent } from 'electron'
import { loadConfig } from '../config'
import { searchChatsOffline } from '../history'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { OpenAiMessage } from './types'

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
    event.sender.send('ai-search-error', { error: 'No active AI Provider configured for search' })
    return
  }

  event.sender.send('ai-search-start')

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
      content:
        'You are Prism Conversation Search Assistant. Analyze the user query and search context from past chats. Provide a helpful, concise summary of relevant conversation history, pointing out specific chat IDs/titles where appropriate.'
    }

    const userPrompt: OpenAiMessage = {
      role: 'user',
      content: `User Search Query: "${query}"\n\nRelevant Past Chats Context:\n${contextSnippet || 'No direct keyword matches found.'}`
    }

    let fullText = ''

    const result = await streamOpenAiCompletion(
      provider,
      model.id,
      [systemPrompt, userPrompt],
      [],
      searchAbortController.signal,
      {
        onTextDelta: (text) => {
          fullText += text
          event.sender.send('ai-search-chunk', { text })
        },
        onReasoningDelta: () => {},
        onToolCallDelta: () => {}
      }
    )

    console.log(`[AI SEARCH DEBUG MAIN] AI Search completed. response: ${result.text?.length || 0} chars`)

    event.sender.send('ai-search-end', {
      finalResponse: result.text,
      offlineResults: offlineData.results
    })
  } catch (error: any) {
    if (searchAbortController?.signal.aborted) {
      console.log('[AI SEARCH DEBUG MAIN] Search aborted before main loop')
      event.sender.send('ai-search-error', { error: 'Search cancelled' })
    } else {
      console.error('AI Search Error:', error)
      event.sender.send('ai-search-error', { error: error.message || String(error) })
    }
  } finally {
    searchAbortController = null
  }
}
