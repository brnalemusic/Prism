import { useState, useEffect } from 'react'
import { ChatTeardropText, ArrowSquareOut } from '@phosphor-icons/react'
import { Spinner } from './Spinner'

interface RenderChatHistoryProps {
  chatId: string
  onOpenChat: (id: string) => void
}

export function RenderChatHistory({
  chatId,
  onOpenChat
}: RenderChatHistoryProps): React.JSX.Element {
  const cleanId = chatId.replace('chat_', '').replace('.json', '').trim()
  const [loading, setLoading] = useState(true)
  const [chatInfo, setChatInfo] = useState<{
    title: string
    messageCount: number
    lastUpdated?: string
  } | null>(null)

  useEffect(() => {
    let active = true
    const loadDetails = async (): Promise<void> => {
      try {
        const chats = await window.api.getChats()
        const found = chats.find((c) => c.id === cleanId)
        const messages = await window.api.loadChat(cleanId)

        if (active) {
          if (found) {
            setChatInfo({
              title: found.title || 'Untitled Chat',
              messageCount: messages.length,
              lastUpdated: new Date(found.lastUpdated).toLocaleDateString()
            })
          } else {
            setChatInfo({
              title: 'Conversation ' + cleanId,
              messageCount: messages.length,
              lastUpdated: undefined
            })
          }
          setLoading(false)
        }
      } catch (err) {
        console.error(err)
        if (active) {
          setLoading(false)
        }
      }
    }
    loadDetails()
    return () => {
      active = false
    }
  }, [cleanId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-text-secondary/70 my-1 w-full max-w-md">
        <Spinner size="sm" />
        <span className="text-xs font-mono">Loading conversation context...</span>
      </div>
    )
  }

  if (!chatInfo) {
    return (
      <div className="rounded-2xl border border-status-error/10 bg-status-error/[0.03] p-4 text-status-error text-xs my-1 w-full max-w-md">
        Failed to load chat "{cleanId}" details.
      </div>
    )
  }

  return (
    <div className="premium-panel-soft flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#0b0c0f]/60 p-4 hover:border-white/10 transition-all duration-300 w-full max-w-md animate-fade-in my-1">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent-secondary/20 bg-accent-secondary/[0.08] text-accent-secondary">
          <ChatTeardropText size={18} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{chatInfo.title}</span>
          <span className="text-xs text-text-secondary/70">
            {chatInfo.messageCount} messages{' '}
            {chatInfo.lastUpdated ? `· ${chatInfo.lastUpdated}` : ''}
          </span>
        </div>
      </div>
      <button
        onClick={() => onOpenChat(cleanId)}
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-text-primary px-3 py-1.5 text-xs font-bold text-black transition-all hover:bg-white active:scale-95 cursor-pointer"
      >
        <span>Open Chat</span>
        <ArrowSquareOut size={13} weight="bold" />
      </button>
    </div>
  )
}
