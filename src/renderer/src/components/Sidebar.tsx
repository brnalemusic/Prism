import { MessageSquare, Settings, CheckSquare, Plus, Trash2, Clock } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'

interface ChatSession {
  id: string
  title: string
  lastUpdated: number
}

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
  onLoadChat: (id: string) => void
  onNewChat: (force?: boolean) => void
  runningTasksCount?: number
  currentChatId?: string
}

export function Sidebar({
  activeView,
  onViewChange,
  onLoadChat,
  onNewChat,
  runningTasksCount = 0,
  currentChatId
}: SidebarProps): React.JSX.Element {
  const [chats, setChats] = useState<ChatSession[]>([])
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const streamingIntervals = useRef<Record<string, NodeJS.Timeout>>({})

  const refreshChats = async (): Promise<void> => {
    const history = await window.api.getChats()
    // Don't overwrite chats that are currently streaming
    setChats(prev => {
      const streamingIds = Object.keys(streamingIntervals.current)
      return history.map(h => {
        if (streamingIds.includes(h.id)) {
          const existing = prev.find(p => p.id === h.id)
          return existing || h
        }
        return h
      })
    })
  }

  useEffect(() => {
    refreshChats()
    // Refresh history periodically or when view changes to chat
    const interval = setInterval(refreshChats, 10000)

    // Listen for new session creation to show loading state immediately
    const removeCreatedListener = window.api.onChatSessionCreated(({ id }) => {
      setChats(prev => {
        if (prev.some(c => c.id === id)) return prev
        // Add to the top of the list with empty title (triggers loading state)
        return [{ id, title: '', lastUpdated: Date.now() }, ...prev]
      })
    })

    // Listen for title received to simulate streaming
    const removeTitleReceivedListener = window.api.onChatTitleReceived(({ id, title }) => {
      // Clear existing interval for this chat if any
      if (streamingIntervals.current[id]) {
        clearInterval(streamingIntervals.current[id])
      }

      let currentIndex = 0
      const fullTitle = title
      
      streamingIntervals.current[id] = setInterval(() => {
        setChats(prev => prev.map(c => {
          if (c.id === id) {
            const newTitle = fullTitle.substring(0, currentIndex + 1)
            return { ...c, title: newTitle }
          }
          return c
        }))
        
        currentIndex++
        if (currentIndex >= fullTitle.length) {
          if (streamingIntervals.current[id]) {
            clearInterval(streamingIntervals.current[id])
            delete streamingIntervals.current[id]
          }
        }
      }, 50) // 20 characters per second = 50ms per character
    })

    return () => {
      clearInterval(interval)
      removeCreatedListener()
      removeTitleReceivedListener()
      // Clear all streaming intervals on unmount
      Object.values(streamingIntervals.current).forEach(clearInterval)
    }
  }, [activeView])

  const handleDelete = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    setIsDeleting(id)
    const success = await window.api.deleteChat(id)
    if (success) {
      setChats(prev => prev.filter(c => c.id !== id))
      if (id === currentChatId) {
        onNewChat(true)
      }
    }
    setIsDeleting(null)
  }

  return (
    <aside className="w-[260px] h-full hidden md:flex flex-col bg-background-secondary/30 backdrop-blur-xl z-20 relative border-r border-surface/20 transition-all duration-300">
      <div className="p-8 pb-4 shrink-0">
        <h1 className="text-text-primary font-black text-3xl tracking-tighter">
          PRISM
          <span className="block h-1 w-8 bg-accent-primary mt-1 rounded-full shadow-[0_0_10px_rgba(108,99,255,0.5)]"></span>
        </h1>
      </div>

      <div className="px-4 py-4 shrink-0">
        <button
          onClick={() => onNewChat()}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary rounded-xl border border-accent-primary/30 transition-all duration-300 font-bold text-sm"
        >
          <Plus size={16} />
          New Chat
        </button>
      </div>

      <nav className="px-4 py-2 flex flex-col gap-2 shrink-0">
        <NavItem
          icon={<MessageSquare size={16} />}
          label="Active Chat"
          active={activeView === 'chat'}
          onClick={(): void => onViewChange('chat')}
        />
        <NavItem
          icon={<CheckSquare size={16} />}
          label="Monitoring"
          active={activeView === 'tasks'}
          onClick={(): void => onViewChange('tasks')}
          badge={runningTasksCount > 0 ? runningTasksCount : undefined}
          pulse={runningTasksCount > 0}
        />
      </nav>

      <div className="h-px bg-surface/20 mx-4 my-4 shrink-0" />

      <div className="flex-1 px-4 overflow-hidden flex flex-col min-h-0">
        <div className="flex flex-col gap-1 overflow-y-auto pr-2 custom-scrollbar h-full">
          {chats.length > 0 && (
            <div className="px-4 py-2 text-[10px] uppercase tracking-widest font-black text-text-secondary/40 flex items-center gap-2 sticky top-0 bg-background-secondary/5 z-10 backdrop-blur-sm">
              <Clock size={10} />
              Recent History
            </div>
          )}
          {chats.map((chat) => (
            <div key={chat.id} className="group relative">
              <button
                onClick={() => {
                  onViewChange('chat')
                  onLoadChat(chat.id)
                }}
                className={clsx(
                  'w-full text-left px-4 py-2.5 rounded-xl text-xs font-medium transition-all duration-300 pr-10 truncate min-h-[36px]',
                  currentChatId === chat.id
                    ? 'bg-surface/60 text-text-primary border border-surface shadow-lg'
                    : 'text-text-secondary hover:bg-surface/30 hover:text-text-primary border border-transparent'
                )}
                title={chat.title}
              >
                {chat.title ? (
                  chat.title
                ) : (
                  <div className="flex gap-1 items-center h-full py-1">
                    <span className="w-1 h-1 rounded-full bg-accent-primary/40 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1 h-1 rounded-full bg-accent-primary/40 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1 h-1 rounded-full bg-accent-primary/40 animate-bounce" />
                  </div>
                )}
              </button>
              <button
                onClick={(e) => handleDelete(e, chat.id)}
                disabled={isDeleting === chat.id}
                className={clsx(
                  'absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-status-error/10 hover:text-status-error transition-all duration-300',
                  isDeleting === chat.id && 'opacity-100 animate-pulse'
                )}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 mt-auto shrink-0">
        <NavItem
          icon={<Settings size={16} />}
          label="Settings"
          active={activeView === 'settings'}
          onClick={(): void => onViewChange('settings')}
        />
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  active = false,
  onClick,
  badge,
  pulse = false
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  badge?: number | string
  pulse?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 relative group overflow-hidden',
        active
          ? 'bg-surface/50 text-text-primary shadow-[inset_0_0_20px_rgba(255,255,255,0.02)] border border-surface'
          : 'text-text-secondary hover:bg-surface/30 hover:text-text-primary border border-transparent'
      )}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent-primary rounded-r-full shadow-[0_0_10px_rgba(108,99,255,0.5)]" />
      )}

      <span
        className={clsx(
          'transition-all duration-300',
          active
            ? 'text-accent-primary scale-110'
            : 'opacity-60 group-hover:opacity-100 group-hover:scale-110',
          pulse && 'animate-pulse text-accent-primary'
        )}
      >
        {icon}
      </span>

      <span className="tracking-tight">{label}</span>

      {badge !== undefined && (
        <span className="ml-auto bg-accent-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg min-w-[20px] flex items-center justify-center shadow-[0_0_15px_rgba(108,99,255,0.4)]">
          {badge}
        </span>
      )}
    </button>
  )
}
