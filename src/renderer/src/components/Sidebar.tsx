import {
  ChatTeardropText,
  Gear,
  Trash,
  Clock,
  MagnifyingGlass,
  Folder,
  Lightning,
  CaretDown,
  CaretRight,
  NotePencil,
  SidebarSimple
} from '@phosphor-icons/react'
import React, { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { LoadingDots } from './LoadingDots'
import { Spinner } from './Spinner'
import { AnimatedStreamingText, StreamContext, useStreamStats } from './AnimatedStreamingText'
import type { AppConfig } from '../../../main/config'
import type { SessionMode } from '../../../shared/types'
import { FolderChatsPanel } from './FolderChatsPanel'

interface ChatSession {
  id: string
  title: string
  lastUpdated: number
  sessionMode?: SessionMode
  disciplinePath?: string
}

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
  onLoadChat: (id: string) => void
  onNewChat: (force?: boolean) => void
  currentChatId?: string
  runningChats?: Record<string, boolean>
  className?: string
  isOpen?: boolean
  config?: AppConfig | null
  onOpenSearch?: () => void
  onOpenSettings?: () => void
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

const getFolderBasename = (fullPath: string): string => {
  if (!fullPath) return ''
  const parts = fullPath.split(/[\\/]/)
  return parts[parts.length - 1] || fullPath
}

export function Sidebar({
  activeView,
  onViewChange,
  onLoadChat,
  onNewChat,
  currentChatId,
  runningChats = {},
  className,
  isOpen = false,
  config,
  onOpenSearch,
  onOpenSettings,
  onClose
}: SidebarProps): React.JSX.Element {
  const [chats, setChats] = useState<ChatSession[]>([])
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const streamingIntervals = useRef<Record<string, NodeJS.Timeout>>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [viewMoreGroupId, setViewMoreGroupId] = useState<string | null>(null)

  const toggleGroup = (groupId: string): void => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

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

  interface ChatGroup {
    id: string
    name: string
    isGeneral: boolean
    chats: ChatSession[]
    lastUpdated: number
  }

  // Group chats and memoize to optimize rendering performance
  const groups = React.useMemo(() => {
    const groupsMap = new Map<string, ChatSession[]>()
    chats.forEach((chat) => {
      const pathKey = chat.disciplinePath ? chat.disciplinePath.trim() : ''
      if (pathKey) {
        if (!groupsMap.has(pathKey)) {
          groupsMap.set(pathKey, [])
        }
        groupsMap.get(pathKey)!.push(chat)
      } else {
        if (!groupsMap.has('__general__')) {
          groupsMap.set('__general__', [])
        }
        groupsMap.get('__general__')!.push(chat)
      }
    })

    const computedGroups: ChatGroup[] = []
    groupsMap.forEach((groupChats, pathKey) => {
      groupChats.sort((a, b) => b.lastUpdated - a.lastUpdated)
      const isGeneral = pathKey === '__general__'
      const mostRecentChat = groupChats[0]
      const lastUpdated = mostRecentChat ? mostRecentChat.lastUpdated : 0
      computedGroups.push({
        id: pathKey,
        name: isGeneral ? 'General' : getFolderBasename(pathKey),
        isGeneral,
        chats: groupChats,
        lastUpdated
      })
    })

    computedGroups.sort((a, b) => b.lastUpdated - a.lastUpdated)
    return computedGroups
  }, [chats])

  return (
    <aside
      className={clsx(
        'relative h-full flex flex-row border-r border-white/[0.055] bg-background-main/95 shadow-[18px_0_46px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden',
        isOpen
          ? (viewMoreGroupId ? 'w-[600px] opacity-100' : 'w-[272px] opacity-100')
          : 'w-0 opacity-0 pointer-events-none border-r-0',
        className
      )}
    >
      {/* Left Column - Main Sidebar Navigation */}
      <div className="w-[272px] shrink-0 h-full flex flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-5 mt-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] select-none">
            <span className="text-[12px] font-extrabold text-accent-primary">P</span>
          </div>
          <h1 className="text-base font-semibold text-text-primary tracking-wide">Prism</h1>
        </div>
        {isOpen && onClose && (
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary hover:bg-white/[0.05] hover:text-text-primary transition-all duration-200 active:scale-95 cursor-pointer"
            title="Collapse sidebar"
          >
            <SidebarSimple size={18} weight="bold" />
          </button>
        )}
      </div>

      <div className="px-4 pb-2 pt-1 shrink-0">
        <button
          onClick={() => onNewChat()}
          className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-white/[0.06] hover:text-white transition-all duration-200 active:scale-[0.98] cursor-pointer"
        >
          <NotePencil size={18} weight="bold" className="text-text-secondary" />
          New Chat
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-1 px-4 py-3">
        <NavItem
          icon={<ChatTeardropText size={18} weight={activeView === 'chat' ? 'fill' : 'bold'} />}
          label="Chat"
          active={activeView === 'chat'}
          onClick={(): void => onViewChange('chat')}
        />
        <NavItem
          icon={<MagnifyingGlass size={18} weight="bold" />}
          label="Search"
          onClick={onOpenSearch}
        />
      </nav>

      <div className="mx-4 h-px shrink-0 bg-white/[0.04]" />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
        <div className="mb-2 flex shrink-0 items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/60">
          <Clock size={12} weight="bold" />
          History
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
          {chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-text-muted/60">
              No recent chats
            </div>
          ) : (
            groups.map((group) => {
              const isCollapsed = collapsedGroups[group.id] || false
              const Icon = group.isGeneral ? Lightning : Folder
              const CaretIcon = isCollapsed ? CaretRight : CaretDown
              const visibleChats = group.chats.slice(0, 5)

              return (
                <div key={group.id} className="flex flex-col mb-2">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="group/btn flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.03] transition-all duration-200 text-left w-full select-none"
                    title={group.isGeneral ? undefined : group.id}
                  >
                    <CaretIcon size={12} weight="bold" className="text-text-muted transition-transform duration-200" />
                    <Icon
                      size={14}
                      weight="bold"
                      className={clsx(
                        group.isGeneral
                          ? 'text-accent-primary'
                          : 'text-text-muted group-hover/btn:text-text-secondary'
                      )}
                    />
                    <span className="truncate flex-1 font-medium">{group.name}</span>
                    <span className="text-[10px] text-text-muted bg-white/[0.04] px-1.5 py-0.5 rounded-md font-mono">
                      {group.chats.length}
                    </span>
                  </button>

                  <div
                    className={clsx(
                      'flex flex-col gap-1 pl-4 overflow-hidden transition-all duration-300 ease-in-out',
                      isCollapsed
                        ? 'max-h-0 opacity-0 pointer-events-none'
                        : 'max-h-[1000px] opacity-100 mt-1'
                    )}
                  >
                    {visibleChats.map((chat) => (
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
                          <Trash size={14} weight="bold" />
                        </button>
                      </div>
                    ))}
                    {group.chats.length > 5 && (
                      <button
                        onClick={() => setViewMoreGroupId(group.id)}
                        className="w-full text-center py-2 px-3 text-xs font-semibold text-accent-primary hover:text-white bg-white/[0.02] hover:bg-accent-primary/[0.1] rounded-xl border border-dashed border-accent-primary/20 hover:border-accent-primary/40 transition-all duration-200 mt-1 cursor-pointer"
                      >
                        View more... ({group.chats.length - 5}+)
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="mt-auto p-4 shrink-0 border-t border-white/[0.04] bg-background-main/30 backdrop-blur-md">
        <NavItem
          icon={<Gear size={18} weight="bold" />}
          label="Settings"
          active={false}
          onClick={onOpenSettings}
          badge={isRgbActive ? countdownText : undefined}
          pulse={isRgbActive}
        />
      </div>
      </div>

      {/* Right Column - Folder Chats Panel */}
      <div
        className={clsx(
          'h-full flex flex-col border-l border-white/[0.05] transition-all duration-300 ease-in-out overflow-hidden',
          viewMoreGroupId ? 'w-[328px] opacity-100' : 'w-0 opacity-0 pointer-events-none'
        )}
      >
        <FolderChatsPanel
          folderPath={viewMoreGroupId || ''}
          folderName={
            viewMoreGroupId
              ? viewMoreGroupId === '__general__'
                ? 'General'
                : getFolderBasename(viewMoreGroupId)
              : ''
          }
          chats={viewMoreGroupId ? (groups.find((g) => g.id === viewMoreGroupId)?.chats || []) : []}
          currentChatId={currentChatId}
          runningChats={runningChats}
          deletingChatId={isDeleting}
          onLoadChat={onLoadChat}
          onViewChange={onViewChange}
          onDeleteChat={handleDelete}
          onClose={() => setViewMoreGroupId(null)}
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
