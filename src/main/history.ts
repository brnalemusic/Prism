import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { Content } from '@google/genai'

export interface ChatSession {
  id: string
  title: string
  lastUpdated: number
  messages: Content[]
}

const CHATS_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
  'PrismDesktop',
  'chats'
)

/**
 * Ensures the chats directory exists.
 */
function ensureChatsDir(): void {
  if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR, { recursive: true })
  }
}

/**
 * Sanitizes a session ID to prevent path traversal.
 */
function sanitizeId(id: string): string {
  // Only allow alphanumeric characters and hyphens
  return id.replace(/[^a-zA-Z0-9-]/g, '')
}

/**
 * Safely extracts text from content parts, combining all text components.
 * Optionally filters out technical blocks like tool calls and system results.
 */
export function getMessageText(content?: Content, clean = false): string {
  if (!content || !content.parts) return ''

  let text = content.parts
    .map((p) => p.text || '')
    .join(' ')
    .trim()

  if (clean && text) {
    // Remove tool calls
    text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    // Remove mini apps
    text = text.replace(/<mini_app>[\s\S]*?<\/mini_app>/gi, '')
    // Remove system results / tool results
    text = text.replace(/\[SYSTEM: TOOL RESULTS\][\s\S]*?(?=\n\n|$)/gi, '')
    // Remove other system-like markers
    text = text.replace(/\[SYSTEM:[\s\S]*?\]/gi, '')

    return text.replace(/\s+/g, ' ').trim()
  }

  return text
}

/**
 * Lists all available chat sessions.
 */
export function listChatSessions(): Omit<ChatSession, 'messages'>[] {
  ensureChatsDir()
  try {
    const files = fs.readdirSync(CHATS_DIR)
    const sessions = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const filePath = path.join(CHATS_DIR, file)
        const data = fs.readFileSync(filePath, 'utf-8')
        const session: ChatSession = JSON.parse(data)
        return {
          id: session.id,
          title: session.title,
          lastUpdated: session.lastUpdated
        }
      })
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
    return sessions
  } catch (error) {
    console.error('Failed to list chat sessions:', error)
    return []
  }
}

/**
 * Loads a specific chat session by ID.
 */
export function loadChatSession(id: string): ChatSession | null {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return null
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data)
    }
    return null
  } catch (error) {
    console.error(`Failed to load chat session ${id}:`, error)
    return null
  }
}

/**
 * Sanitizes search_chat_memory tool outputs in history messages before saving,
 * replacing their content with "[RESULTS OMITTED]".
 */
function sanitizeMessagesForSaving(messages: Content[]): Content[] {
  return messages.map((m) => {
    if (!m.parts) return m
    const sanitizedParts = m.parts.map((p) => {
      if (typeof p.text === 'string') {
        const sanitizedText = p.text.replace(
          /\[RESULT FOR search_chat_memory\]:\r?\n([\s\S]*?)(?=\r?\n\[RESULT FOR |\r?\nAnalyze these results|\r?\n\[SYSTEM: TOOL RESULTS\]|$)/g,
          '[RESULT FOR search_chat_memory]:\n[RESULTS OMITTED]\n'
        )
        return { ...p, text: sanitizedText }
      }
      return p
    })
    return { ...m, parts: sanitizedParts }
  })
}

/**
 * Saves or updates a chat session.
 */
export function saveChatSession(id: string, messages: Content[], title?: string): boolean {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)

  try {
    let sessionTitle = title

    // If title not provided (undefined), try to keep the existing one from the file or generate fallback
    if (sessionTitle === undefined) {
      if (fs.existsSync(filePath)) {
        try {
          const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          const firstMsgText = getMessageText(messages[0])
          if (
            existingData.title &&
            !existingData.title.startsWith(firstMsgText.substring(0, 5) || '___')
          ) {
            sessionTitle = existingData.title
          }
        } catch {
          /* ignore parse errors */
        }
      }

      if (!sessionTitle && messages.length > 0) {
        // Fallback title generation from first REAL user message
        const firstRealUserMsg = messages.find(
          (m) => m.role === 'user' && m.parts?.some((p) => typeof p.text === 'string')
        )
        const text = getMessageText(firstRealUserMsg)
        if (text) {
          sessionTitle = text.substring(0, 40) + (text.length > 40 ? '...' : '')
        }
      }
    }

    const filteredMessages = messages.filter((msg) => {
      if (msg.role === 'system') {
        const text = msg.parts?.[0]?.text || ''
        return !text.includes('# Identity') && !text.includes('Understood. I am Prism')
      }
      return true
    })

    const messagesToSave = sanitizeMessagesForSaving(filteredMessages)

    const session: ChatSession = {
      id,
      title: sessionTitle !== undefined ? sessionTitle : 'New Conversation',
      lastUpdated: Date.now(),
      messages: messagesToSave
    }

    fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
    return true
  } catch (error) {
    console.error(`Failed to save chat session ${id}:`, error)
    return false
  }
}

/**
 * Deletes a chat session.
 */
export function deleteChatSession(id: string): boolean {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return true
    }
    return false
  } catch (error) {
    console.error(`Failed to delete chat session ${id}:`, error)
    return false
  }
}

/**
 * Searches across all chat sessions for a specific query.
 * Returns pairs of interaction (User message + AI response).
 */
export async function searchChatHistory(query: string): Promise<string> {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))

  // Split query by commas or spaces and filter out empty strings
  const keywords = query
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((k) => k.length > 0)

  if (keywords.length === 0) {
    return JSON.stringify({ error: 'Please provide at least one keyword to search.' })
  }

  const matchedSessions: { score: number; session: ChatSession }[] = []

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      let score = 0

      // Check title
      const titleLower = session.title.toLowerCase()
      for (const kw of keywords) {
        if (titleLower.includes(kw)) {
          score += 5
        }
      }

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]

        // ONLY read User and AI messages
        if (msg.role !== 'user' && msg.role !== 'model') {
          continue
        }

        const text = getMessageText(msg, true)

        if (text) {
          const lowerText = text.toLowerCase()

          // Calculate score: how many unique keywords match?
          let matchCount = 0
          for (const kw of keywords) {
            if (lowerText.includes(kw)) {
              matchCount++
            }
          }

          if (matchCount > 0) {
            score += matchCount
          }
        }
      }

      if (score > 0) {
        matchedSessions.push({ score, session })
      }
    } catch (e) {
      console.error(`Error searching file ${file}:`, e)
    }
  }

  if (matchedSessions.length === 0) {
    return JSON.stringify([])
  }

  // Sort by score (descending), then by date (newest first)
  matchedSessions.sort((a, b) => b.score - a.score || b.session.lastUpdated - a.session.lastUpdated)

  // LIMIT results to top 15 and truncate message history for each to avoid token overflow
  const results = matchedSessions.slice(0, 15).map((m) => {
    const s = m.session
    // Find a few relevant snippets from messages that match keywords
    const snippets: string[] = []
    for (const msg of s.messages) {
      if (msg.role === 'system') continue
      const text = getMessageText(msg)
      const lowerText = text.toLowerCase()
      if (keywords.some((kw) => lowerText.includes(kw))) {
        const matchingKeyword = keywords.find((kw) => lowerText.includes(kw))
        const idx = matchingKeyword ? lowerText.indexOf(matchingKeyword) : 0
        const start = Math.max(0, idx - 80)
        const end = Math.min(text.length, idx + 120)
        const role = (msg.role || 'user').toUpperCase()
        snippets.push(`[${role}]: ...${text.substring(start, end).replace(/\n/g, ' ')}...`)
      }
      if (snippets.length >= 2) break
    }

    return {
      id: s.id,
      title: s.title,
      lastUpdated: new Date(s.lastUpdated).toISOString(),
      relevanceScore: m.score,
      matchingSnippets: snippets,
      totalMessages: s.messages.length,
      // We explicitly OMIT the full 'messages' array here to save tokens
      instruction: 'To see the full history of this chat, use the render_chat_history tool.'
    }
  })

  return JSON.stringify(results, null, 2)
}

// Levenshtein distance helper
function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i]
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      )
    }
  }
  return tmp[a.length][b.length]
}

/**
 * Builds vocabulary and returns a spelling suggestion if the user made a typo.
 */
export function getSpellingSuggestion(query: string): string | undefined {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const vocab = new Map<string, number>()

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      const texts = [session.title]
      for (const msg of session.messages) {
        if (msg.role !== 'system') {
          texts.push(getMessageText(msg))
        }
      }

      for (const text of texts) {
        if (!text) continue
        const words = text.toLowerCase().match(/[a-zA-Z0-9áéíóúâêîôûãõçñ]+/g)
        if (words) {
          for (const w of words) {
            if (w.length >= 3) {
              vocab.set(w, (vocab.get(w) || 0) + 1)
            }
          }
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const queryWords = query.toLowerCase().split(/\s+/)
  let corrected = false
  const correctedWords: string[] = []

  for (const word of queryWords) {
    if (word.length < 3 || vocab.has(word)) {
      correctedWords.push(word)
      continue
    }

    let closestWord = word
    let minDistance = Infinity
    let maxFreq = 0

    for (const [vocabWord, freq] of vocab.entries()) {
      const dist = getLevenshteinDistance(word, vocabWord)
      const maxAllowedDist = word.length <= 4 ? 1 : 2
      if (dist <= maxAllowedDist) {
        if (dist < minDistance) {
          minDistance = dist
          closestWord = vocabWord
          maxFreq = freq
        } else if (dist === minDistance && freq > maxFreq) {
          closestWord = vocabWord
          maxFreq = freq
        }
      }
    }

    if (closestWord !== word) {
      corrected = true
      correctedWords.push(closestWord)
    } else {
      correctedWords.push(word)
    }
  }

  return corrected ? correctedWords.join(' ') : undefined
}

export interface SearchMatch {
  role: 'user' | 'model' | 'system'
  text: string
  snippet: string
}

export interface ChatSearchResult {
  id: string
  title: string
  lastUpdated: number
  matchedTitle: boolean
  messageMatches: SearchMatch[]
}

/**
 * Searches offline through all chat session files.
 */
export function searchChatsOffline(query: string): {
  results: ChatSearchResult[]
  didYouMean?: string
} {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const results: ChatSearchResult[] = []

  const cleanQuery = query.trim().toLowerCase()
  if (!cleanQuery) {
    return { results: [] }
  }

  const queryKeywords = cleanQuery.split(/\s+/).filter((k) => k.length > 0)

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)

      const titleLower = session.title.toLowerCase()
      const matchedTitle = queryKeywords.every((kw) => titleLower.includes(kw))

      const messageMatches: SearchMatch[] = []

      for (const msg of session.messages) {
        if (msg.role !== 'user' && msg.role !== 'model') continue
        const text = getMessageText(msg, true)
        if (!text) continue

        const textLower = text.toLowerCase()
        const matchedMessage = queryKeywords.every((kw) => textLower.includes(kw))

        if (matchedMessage) {
          let firstIndex = Infinity
          for (const kw of queryKeywords) {
            const idx = textLower.indexOf(kw)
            if (idx !== -1 && idx < firstIndex) {
              firstIndex = idx
            }
          }

          let snippet = ''
          if (firstIndex !== Infinity) {
            const start = Math.max(0, firstIndex - 60)
            const end = Math.min(text.length, firstIndex + queryKeywords[0].length + 60)
            snippet =
              (start > 0 ? '...' : '') +
              text.substring(start, end).replace(/\n/g, ' ') +
              (end < text.length ? '...' : '')
          } else {
            snippet = text.substring(0, 100).replace(/\n/g, ' ') + (text.length > 100 ? '...' : '')
          }

          messageMatches.push({
            role: msg.role as 'user' | 'model',
            text: text,
            snippet: snippet
          })
        }
      }

      if (matchedTitle || messageMatches.length > 0) {
        results.push({
          id: session.id,
          title: session.title,
          lastUpdated: session.lastUpdated,
          matchedTitle,
          messageMatches
        })
      }
    } catch (e) {
      console.error(`Failed to search chat session file ${file}:`, e)
    }
  }

  results.sort((a, b) => b.lastUpdated - a.lastUpdated)

  const didYouMean = getSpellingSuggestion(query)

  return {
    results,
    didYouMean: didYouMean && didYouMean !== query.toLowerCase() ? didYouMean : undefined
  }
}

/**
 * Custom structured search across all chat files.
 * Designed specifically for the AI search assistant.
 */
export async function searchChatMemory(query: string): Promise<string> {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const keywords = query
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((k) => k.length > 0)

  if (keywords.length === 0) {
    return JSON.stringify({ error: 'Please provide at least one keyword to search.' })
  }

  const matchedSessions: { score: number; session: ChatSession }[] = []

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      let score = 0

      // Check title
      const titleLower = session.title.toLowerCase()
      for (const kw of keywords) {
        if (titleLower.includes(kw)) {
          score += 5
        }
      }

      // Check messages
      for (const msg of session.messages) {
        if (msg.role !== 'user' && msg.role !== 'model') continue
        const text = getMessageText(msg, true)
        if (!text) continue
        const textLower = text.toLowerCase()
        for (const kw of keywords) {
          if (textLower.includes(kw)) {
            score++
          }
        }
      }

      if (score > 0) {
        matchedSessions.push({ score, session })
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (matchedSessions.length === 0) {
    return JSON.stringify([])
  }

  // Sort by score (descending), then by date (newest first)
  matchedSessions.sort((a, b) => b.score - a.score || b.session.lastUpdated - a.session.lastUpdated)

  // LIMIT results to top 15 and truncate message history for each to avoid token overflow
  const results = matchedSessions.slice(0, 15).map((m) => {
    const s = m.session
    // Find a few relevant snippets from messages that match keywords
    const snippets: string[] = []
    for (const msg of s.messages) {
      if (msg.role === 'system') continue
      const text = getMessageText(msg)
      const lowerText = text.toLowerCase()
      if (keywords.some((kw) => lowerText.includes(kw))) {
        const matchingKeyword = keywords.find((kw) => lowerText.includes(kw))
        const idx = matchingKeyword ? lowerText.indexOf(matchingKeyword) : 0
        const start = Math.max(0, idx - 80)
        const end = Math.min(text.length, idx + 120)
        const role = (msg.role || 'user').toUpperCase()
        snippets.push(`[${role}]: ...${text.substring(start, end).replace(/\n/g, ' ')}...`)
      }
      if (snippets.length >= 2) break
    }

    return {
      id: s.id,
      title: s.title,
      lastUpdated: new Date(s.lastUpdated).toISOString(),
      relevanceScore: m.score,
      matchingSnippets: snippets,
      totalMessages: s.messages.length,
      // We explicitly OMIT the full 'messages' array here to save tokens
      instruction: 'To see the full history of this chat, use the render_chat_history tool.'
    }
  })

  return JSON.stringify(results, null, 2)
}
