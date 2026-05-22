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
  const filePath = path.join(CHATS_DIR, `chat_${id}.json`)
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
 * Saves or updates a chat session.
 */
export function saveChatSession(id: string, messages: Content[], title?: string): boolean {
  ensureChatsDir()
  const filePath = path.join(CHATS_DIR, `chat_${id}.json`)

  try {
    let sessionTitle = title

    // If title not provided (undefined), try to keep the existing one from the file or generate fallback
    if (sessionTitle === undefined) {
      if (fs.existsSync(filePath)) {
        try {
          const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          if (
            existingData.title &&
            !existingData.title.startsWith(messages[0]?.parts?.[0]?.text?.substring(0, 5) || '___')
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
          (m) => m.role === 'user' && typeof m.parts?.[0]?.text === 'string'
        )
        const text = firstRealUserMsg?.parts?.[0]?.text
        if (typeof text === 'string') {
          sessionTitle = text.substring(0, 40) + (text.length > 40 ? '...' : '')
        }
      }
    }

    const messagesToSave = messages

    const session: ChatSession = {
      id,
      title: sessionTitle !== undefined ? sessionTitle : 'Nova Conversa',
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
  const filePath = path.join(CHATS_DIR, `chat_${id}.json`)
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
    return 'Please provide at least one keyword to search.'
  }

  interface ScoredMatch {
    score: number
    context: string
    timestamp: number
  }
  const allMatches: Map<string, ScoredMatch> = new Map()

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]
        const text = msg.parts?.[0]?.text

        if (typeof text === 'string') {
          // Ignore ANY system role message to avoid polluting history with rules or internal feedback
          if (msg.role === 'system') {
            continue
          }

          const lowerText = text.toLowerCase()

          // Calculate score: how many unique keywords match?
          let matchCount = 0
          for (const kw of keywords) {
            if (lowerText.includes(kw)) {
              matchCount++
            }
          }

          if (matchCount > 0) {
            // Found a match. Try to get the context pair.
            let context = ''

            const formatRole = (role: string, content: string): string => {
              if (role === 'user') {
                if (content.startsWith('[SYSTEM:')) return `[System]:\n${content}`
                return `[User]: ${content}`
              }
              if (role === 'model') {
                if (content.includes('<tool_call>')) return `[AI Action]:\n${content}`
                return `[AI]: ${content}`
              }
              return `[${role}]: ${content}`
            }

            if (msg.role === 'user') {
              context = formatRole('user', text)
              const nextMsg = session.messages[i + 1]
              if (nextMsg && nextMsg.role === 'model') {
                const nextText =
                  typeof nextMsg.parts?.[0]?.text === 'string' ? nextMsg.parts?.[0]?.text : ''
                context += `\n${formatRole('model', nextText)}`
              }
            } else if (msg.role === 'model') {
              const prevMsg = session.messages[i - 1]
              if (prevMsg && prevMsg.role === 'user') {
                const prevText =
                  typeof prevMsg.parts?.[0]?.text === 'string' ? prevMsg.parts?.[0]?.text : ''
                context = `${formatRole('user', prevText)}\n`
              }
              context += formatRole('model', text)
            }

            if (context) {
              const fullContext = `--- Context from chat "${session.title}" (${new Date(session.lastUpdated).toLocaleDateString()}):\n${context}`
              if (allMatches.has(fullContext)) {
                const existing = allMatches.get(fullContext)!
                existing.score = Math.max(existing.score, matchCount)
              } else {
                allMatches.set(fullContext, {
                  score: matchCount,
                  context: fullContext,
                  timestamp: session.lastUpdated
                })
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error searching file ${file}:`, e)
    }
  }

  if (allMatches.size === 0) {
    return 'No relevant history found for this query.'
  }

  // Sort by score (descending), then by date (newest first)
  const results = Array.from(allMatches.values())
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    .slice(0, 10)
    .map((m) => m.context)

  return results.join('\n\n')
}
