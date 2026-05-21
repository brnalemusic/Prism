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
    setChats((prev) => {
      const streamingIds = Object.keys(streamingIntervals.current)
      return history.map((h) => {
        if (streamingIds.includes(h.id)) {
          const existing = prev.find((p) => p.id === h.id)
          return existing || h
        }
        return h
      })
    })
  }

  useEffect(() => {
    refreshChats()
    const interval = setInterval(refreshChats, 10000)

    const removeCreatedListener = window.api.onChatSessionCreated(({ id }) => {
      setChats((prev) => {
        if (prev.some((c) => c.id === id)) return prev
        return [{ id, title: '', lastUpdated: Date.now() }, ...prev]
      })
    })

    const removeTitleReceivedListener = window.api.onChatTitleReceived(({ id, title }) => {
      if (streamingIntervals.current[id]) {
        clearInterval(streamingIntervals.current[id])
      }

      let currentIndex = 0
      const fullTitle = title

      streamingIntervals.current[id] = setInterval(() => {
        setChats((prev) =>
          prev.map((c) => {
            if (c.id === id) {
              return { ...c, title: fullTitle.substring(0, currentIndex + 1) }
            }
            return c
          })
        )

        currentIndex++
        if (currentIndex >= fullTitle.length) {
          clearInterval(streamingIntervals.current[id])
          delete streamingIntervals.current[id]
        }
      }, 50)
    })

    return () => {
      clearInterval(interval)
      removeCreatedListener()
      removeTitleReceivedListener()
      Object.values(streamingIntervals.current).forEach(clearInterval)
    }
  }, [activeView])

  const handleDelete = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    setIsDeleting(id)
    const success = await window.api.deleteChat(id)
    if (success) {
      setChats((prev) => prev.filter((c) => c.id !== id))
      if (id === currentChatId) {
        onNewChat(true)
      }
    }
    setIsDeleting(null)
  }

  return (
    <aside className="relative z-20 hidden h-full w-[278px] flex-col border-r border-white/[0.055] bg-background-main/[0.62] backdrop-blur-2xl md:flex">
      <div className="px-5 pb-4 pt-7">
        <div className="premium-panel-soft rounded-[28px] px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.055] text-accent-primary">
              <span className="text-base font-semibold">P</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">Prism</h1>
              <p className="text-xs text-text-secondary/60">Desktop AI</p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 py-2">
        <button
          onClick={() => onNewChat()}
          className="flex w-full items-center justify-center gap-2 rounded-[18px] border border-accent-primary/25 bg-accent-primary/[0.09] px-4 py-3 text-sm font-semibold text-accent-primary transition-all duration-200 hover:border-accent-primary/40 hover:bg-accent-primary/[0.13] active:scale-[0.99]"
        >
          <Plus size={16} />
          New Chat
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-2 px-5 py-4">
        <NavItem
          icon={<MessageSquare size={16} />}
          label="Chat"
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

      <div className="mx-5 h-px bg-white/[0.055]" />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
        <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-text-secondary/60">
          <Clock size={13} />
          History
        </div>
        <div className="flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
          {chats.map((chat) => (
            <div key={chat.id} className="group relative">
              <button
                onClick={() => {
                  onViewChange('chat')
                  onLoadChat(chat.id)
                }}
                className={clsx(
                  'min-h-[38px] w-full truncate rounded-[18px] border px-3.5 py-2.5 pr-10 text-left text-xs font-medium transition-all duration-200 active:scale-[0.98]',
                  currentChatId === chat.id
                    ? 'border-accent-primary/20 bg-accent-primary/[0.09] text-text-primary'
                    : 'border-transparent text-text-secondary/75 hover:border-white/[0.07] hover:bg-white/[0.04] hover:text-text-primary'
                )}
                title={chat.title}
              >
                {chat.title ? (
                  chat.title
                ) : (
                  <div className="flex h-full items-center gap-1.5 py-1">
                    <span className="thinking-dot h-1 w-1 rounded-full bg-accent-primary/70 [animation-delay:-0.22s]" />
                    <span className="thinking-dot h-1 w-1 rounded-full bg-accent-secondary/70 [animation-delay:-0.11s]" />
                    <span className="thinking-dot h-1 w-1 rounded-full bg-white/60" />
                  </div>
                )}
              </button>
              <button
                onClick={(e) => handleDelete(e, chat.id)}
                disabled={isDeleting === chat.id}
                className={clsx(
                  'absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-text-secondary/40 opacity-0 transition-all duration-300 hover:bg-status-error/[0.15] hover:text-status-error group-hover:opacity-100 active:scale-90',
                  isDeleting === chat.id && 'opacity-100 animate-pulse'
                )}
                title="Delete chat"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto p-5">
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
        'group relative flex w-full items-center gap-3 overflow-hidden rounded-[18px] border px-3.5 py-3 text-sm font-semibold transition-all duration-200',
        active
          ? 'border-white/[0.09] bg-white/[0.07] text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
          : 'border-transparent text-text-secondary/70 hover:border-white/[0.07] hover:bg-white/[0.04] hover:text-text-primary'
      )}
    >
      {active && <div className="absolute inset-y-2 left-1 w-1 rounded-full bg-accent-primary" />}

      <span
        className={clsx(
          'ml-1 transition-all duration-200',
          active ? 'text-accent-primary' : 'opacity-70 group-hover:opacity-100',
          pulse && 'animate-pulse text-accent-secondary'
        )}
      >
        {icon}
      </span>

      <span>{label}</span>

      {badge !== undefined && (
        <span className="ml-auto flex min-w-[22px] items-center justify-center rounded-full bg-accent-secondary/[0.18] px-2 py-0.5 text-[11px] font-semibold text-accent-secondary">
          {badge}
        </span>
      )}
    </button>
  )
}
