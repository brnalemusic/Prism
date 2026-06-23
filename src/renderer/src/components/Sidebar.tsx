import {
  ChatTeardropText,
  Gear,
  CheckSquare,
  Plus,
  Trash,
  Clock,
  MagnifyingGlass,
  CaretLeft
} from '@phosphor-icons/react'
import React, { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { LoadingDots } from './LoadingDots'
import { Spinner } from './Spinner'
import { AnimatedStreamingText, StreamContext, useStreamStats } from './AnimatedStreamingText'
import type { AppConfig } from '../../../main/config'

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
  runningChats?: Record<string, boolean>
  className?: string
  isOpen?: boolean
  config?: AppConfig | null
  onOpenSearch?: () => void
  onClose?: () => void
}

interface StreamTitleWrapperProps {
  title: string
}

const StreamTitleWrapper = React.memo(function StreamTitleWrapper({
  title
}: StreamTitleWrapperProps) {
  const streamStats = useStreamStats(title, true)
  return (
    <StreamContext.Provider value={streamStats}>
      <AnimatedStreamingText text={title} isStreaming={true} mode="chars" />
    </StreamContext.Provider>
  )
})

export function Sidebar({
  activeView,
  onViewChange,
  onLoadChat,
  onNewChat,
  runningTasksCount = 0,
  currentChatId,
  runningChats = {},
  className,
  isOpen = false,
  config,
  onOpenSearch,
  onClose
}: SidebarProps): React.JSX.Element {
  const [chats, setChats] = useState<ChatSession[]>([])
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const streamingIntervals = useRef<Record<string, NodeJS.Timeout>>({})

  // RGB Countdown Easter Egg state
  const [countdownText, setCountdownText] = useState('')
  const [isRgbActive, setIsRgbActive] = useState(false)

  useEffect(() => {
    if (!config || !config.rgbThemeExpiry) {
      setIsRgbActive(false)
      return
    }

    const updateCountdown = () => {
      const now = Date.now()
      const expiry = config.rgbThemeExpiry || 0
      if (now < expiry) {
        setIsRgbActive(true)
        const diff = expiry - now
        const hrs = Math.floor(diff / (3600 * 1000))
        const mins = Math.floor((diff % (3600 * 1000)) / (60 * 1000))
        const secs = Math.floor((diff % (60 * 1000)) / 1000)
        const formatNum = (num: number) => String(num).padStart(2, '0')
        setCountdownText(`${formatNum(hrs)}:${formatNum(mins)}:${formatNum(secs)}`)
      } else {
        setIsRgbActive(false)
      }
    }

    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)

    return () => clearInterval(timer)
  }, [config])

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
    const currentIntervals = streamingIntervals.current
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
      Object.values(currentIntervals).forEach(clearInterval)
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
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-40 w-[272px] flex flex-col border-r border-white/[0.055] bg-background-main/95 shadow-[18px_0_46px_rgba(0,0,0,0.22)] backdrop-blur-md transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        className
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between px-5 mt-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <span className="text-[12px] font-extrabold text-accent-primary">P</span>
          </div>
          <h1 className="text-base font-semibold text-text-primary tracking-wide">Prism</h1>
        </div>
        {isOpen && onClose && (
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-text-muted hover:bg-white/[0.05] hover:text-text-primary transition-all duration-200 active:scale-95"
            title="Close sidebar"
          >
            <CaretLeft size={18} weight="bold" />
          </button>
        )}
      </div>

      <div className="px-4 pb-2 pt-1 shrink-0">
        <button
          onClick={() => onNewChat()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-primary/[0.08] to-accent-primary/[0.02] border border-accent-primary/[0.15] px-4 py-2.5 text-sm font-medium text-accent-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-all duration-200 hover:from-accent-primary/[0.12] hover:to-accent-primary/[0.06] hover:border-accent-primary/[0.25] active:scale-[0.98] rgb-new-chat-btn"
        >
          <Plus size={16} weight="bold" />
          New Chat
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-1 px-4 py-3">
        <NavItem
          icon={<ChatTeardropText size={18} weight={activeView === 'chat' ? 'fill' : 'regular'} />}
          label="Chat"
          active={activeView === 'chat'}
          onClick={(): void => onViewChange('chat')}
        />
        <NavItem
          icon={<CheckSquare size={18} weight={activeView === 'tasks' ? 'fill' : 'regular'} />}
          label="Monitoring"
          active={activeView === 'tasks'}
          onClick={(): void => onViewChange('tasks')}
          badge={runningTasksCount > 0 ? runningTasksCount : undefined}
          pulse={runningTasksCount > 0}
        />
        <NavItem
          icon={<MagnifyingGlass size={18} weight="regular" />}
          label="Search"
          onClick={onOpenSearch}
        />
      </nav>

      <div className="mx-4 h-px shrink-0 bg-white/[0.04]" />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
        <div className="mb-2 flex shrink-0 items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60">
          <Clock size={12} />
          History
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
          {chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-text-muted/60">
              No recent chats
            </div>
          ) : (
            chats.map((chat) => (
              <div key={chat.id} className="group relative">
                <button
                  onClick={() => {
                    onViewChange('chat')
                    onLoadChat(chat.id)
                  }}
                  className={clsx(
                    'min-h-[38px] w-full truncate rounded-xl border px-3 py-2 pr-8 text-left text-sm transition-all duration-200 active:scale-[0.98]',
                    currentChatId === chat.id
                      ? 'border-white/[0.06] bg-white/[0.045] text-text-primary font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]'
                      : 'border-transparent text-text-secondary hover:bg-white/[0.025] hover:text-text-primary'
                  )}
                  title={chat.title}
                >
                  {chat.title ? (
                    streamingIntervals.current[chat.id] ? (
                      <StreamTitleWrapper title={chat.title} />
                    ) : (
                      chat.title
                    )
                  ) : (
                    <LoadingDots className="h-full py-1" size="xs" />
                  )}
                </button>
                {runningChats[chat.id] && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-300 group-hover:opacity-0">
                    <Spinner size="xxs" />
                  </div>
                )}
                <button
                  onClick={(e) => handleDelete(e, chat.id)}
                  disabled={isDeleting === chat.id}
                  className={clsx(
                    'absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-text-muted opacity-0 scale-95 transition-all duration-200 hover:bg-white/[0.05] hover:text-status-error hover:scale-105 group-hover:opacity-100 group-hover:scale-100 active:scale-90',
                    isDeleting === chat.id && 'opacity-100 animate-pulse'
                  )}
                  title="Delete chat"
                >
                  <Trash size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-auto p-4 shrink-0 border-t border-white/[0.04] bg-background-main/30 backdrop-blur-md">
        <NavItem
          icon={<Gear size={18} weight={activeView === 'settings' ? 'fill' : 'regular'} />}
          label="Settings"
          active={activeView === 'settings'}
          onClick={(): void => onViewChange('settings')}
          badge={isRgbActive ? countdownText : undefined}
          pulse={isRgbActive}
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
        'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all duration-200',
        active
          ? 'border-white/[0.07] bg-white/[0.055] text-text-primary font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.015)]'
          : 'border-transparent text-text-secondary hover:bg-white/[0.025] hover:text-text-primary'
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent-primary shadow-[0_0_8px_var(--accent-primary)]" />
      )}
      <span
        className={clsx(
          'transition-colors duration-200',
          active ? 'text-accent-primary' : 'text-text-muted group-hover:text-text-secondary',
          pulse && 'animate-pulse text-accent-secondary'
        )}
      >
        {icon}
      </span>

      <span>{label}</span>

      {badge !== undefined && (
        <span
          className={clsx(
            'ml-auto flex min-w-[20px] items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-medium transition-all duration-300',
            label === 'Settings' && pulse
              ? 'bg-gradient-to-r from-[#FF0000]/20 to-[#007BFF]/20 border border-white/10 text-white font-mono rgb-settings-timer'
              : 'bg-white/[0.05] text-text-primary'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
