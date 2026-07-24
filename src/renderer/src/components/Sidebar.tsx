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
import prismIcon from '../../../../resources/icon.png?asset'

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
    refreshChats()
    const interval = setInterval(refreshChats, 10000)

    const removeCreatedListener = window.api.onChatSessionCreated(({ id }) => {
      setChats((prev) => {
        if (prev.some((c) => c.id === id)) return prev
        return [{ id, title: '', lastUpdated: Date.now() }, ...prev]
      })
    })

    const removeTitleListener = window.api.onChatTitleReceived(({ id, title }) => {
      setChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title, lastUpdated: Date.now() } : c))
      )
    })

    return () => {
      clearInterval(interval)
      removeCreatedListener()
      removeTitleListener()
      Object.values(streamingIntervals.current).forEach(clearTimeout)
    }
  }, [])

  const handleDelete = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    if (isDeleting === id) return

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
        'relative h-full flex flex-row border-r border-white/[0.04] bg-black/90 backdrop-blur-xl transition-all duration-300 ease-in-out overflow-hidden',
        isOpen
          ? (viewMoreGroupId ? 'w-[580px] opacity-100' : 'w-[260px] opacity-100')
          : 'w-0 opacity-0 pointer-events-none border-r-0',
        className
      )}
    >
      {/* Left Column - Main Sidebar Navigation */}
      <div className="w-[260px] shrink-0 h-full flex flex-col">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-2.5 select-none">
            <img
              src={prismIcon}
              alt="Prism Logo"
              className="h-7 w-7 rounded-[8px] object-cover border border-white/10 shadow-sm"
            />
            <h1 className="text-sm font-semibold text-text-primary tracking-wide">Prism</h1>
          </div>
          {isOpen && onClose && (
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-white/[0.04] hover:text-text-primary transition-all duration-200 cursor-pointer"
              title="Collapse sidebar"
            >
              <SidebarSimple size={16} weight="bold" />
            </button>
          )}
        </div>

        {/* New Chat Action */}
        <div className="px-3 pb-2 pt-1 shrink-0">
          <button
            onClick={() => onNewChat()}
            className="group flex w-full items-center justify-center gap-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-xs font-medium text-text-primary hover:text-white transition-all duration-200 active:scale-[0.98] cursor-pointer py-2.5 px-3 border border-white/[0.05] hover:border-white/[0.09]"
          >
            <NotePencil size={16} weight="bold" className="text-text-secondary group-hover:text-white transition-colors" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex shrink-0 flex-col gap-0.5 px-3 py-2">
          <NavItem
            icon={<ChatTeardropText size={16} weight={activeView === 'chat' ? 'fill' : 'bold'} />}
            label="Chat"
            active={activeView === 'chat'}
            onClick={(): void => onViewChange('chat')}
          />
          <NavItem
            icon={<MagnifyingGlass size={16} weight="bold" />}
            label="Search"
            onClick={onOpenSearch}
          />
        </nav>

        <div className="mx-3 h-px shrink-0 bg-white/[0.03]" />

        {/* History & Groups */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
          <div className="mb-2 flex shrink-0 items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted/70">
            <Clock size={11} weight="bold" />
            History
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-1 custom-scrollbar">
            {chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-text-muted/50">
                No recent chats
              </div>
            ) : (
              groups.map((group) => {
                const isCollapsed = collapsedGroups[group.id] || false
                const Icon = group.isGeneral ? Lightning : Folder
                const CaretIcon = isCollapsed ? CaretRight : CaretDown
                const visibleChats = group.chats.slice(0, 5)

                return (
                  <div key={group.id} className="flex flex-col mb-1.5">
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="group/btn flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.025] transition-all duration-200 text-left w-full select-none cursor-pointer"
                      title={group.isGeneral ? undefined : group.id}
                    >
                      <CaretIcon size={11} weight="bold" className="text-text-muted/60 transition-transform duration-200" />
                      <Icon
                        size={13}
                        weight="bold"
                        className={clsx(
                          group.isGeneral
                            ? 'text-white/80'
                            : 'text-text-muted group-hover/btn:text-text-secondary'
                        )}
                      />
                      <span className="truncate flex-1 text-xs">{group.name}</span>
                      <span className="text-[10px] text-text-muted/70 bg-white/[0.03] px-1.5 py-0.2 rounded-full font-mono">
                        {group.chats.length}
                      </span>
                    </button>

                    <div
                      className={clsx(
                        'flex flex-col gap-0.5 pl-3 overflow-hidden transition-all duration-300 ease-in-out',
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
                              'min-h-[32px] w-full truncate rounded-lg px-2.5 py-1.5 pr-7 text-left text-xs transition-all duration-200 active:scale-[0.98] select-none cursor-pointer',
                              currentChatId === chat.id
                                ? 'bg-white/[0.06] text-text-primary font-medium'
                                : 'text-text-secondary hover:bg-white/[0.025] hover:text-text-primary'
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
                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-300 group-hover:opacity-0">
                              <Spinner size="xxs" />
                            </div>
                          )}
                          <button
                            onClick={(e) => handleDelete(e, chat.id)}
                            disabled={isDeleting === chat.id}
                            className={clsx(
                              'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted opacity-0 scale-95 transition-all duration-200 hover:bg-white/[0.06] hover:text-status-error hover:scale-105 group-hover:opacity-100 group-hover:scale-100 active:scale-90 cursor-pointer',
                              isDeleting === chat.id && 'opacity-100 animate-pulse'
                            )}
                            title="Delete chat"
                          >
                            <Trash size={13} weight="bold" />
                          </button>
                        </div>
                      ))}
                      {group.chats.length > 5 && (
                        <button
                          onClick={() => setViewMoreGroupId(group.id)}
                          className="w-full flex items-center justify-center gap-1 text-center py-1.5 px-2 text-[11px] font-medium text-text-muted hover:text-white hover:bg-white/[0.03] rounded-lg transition-all duration-200 mt-0.5 cursor-pointer"
                        >
                          <span>View more ({group.chats.length - 5}+)</span>
                          <CaretRight size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto p-3 shrink-0 border-t border-white/[0.03] bg-black/20">
          <NavItem
            icon={<Gear size={16} weight="bold" />}
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
          'h-full flex flex-col border-l border-white/[0.04] transition-all duration-300 ease-in-out overflow-hidden',
          viewMoreGroupId ? 'w-[320px] opacity-100' : 'w-0 opacity-0 pointer-events-none'
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
        'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-all duration-200 cursor-pointer select-none',
        active
          ? 'bg-white/[0.06] text-text-primary font-medium'
          : 'text-text-secondary hover:bg-white/[0.03] hover:text-text-primary'
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-r-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
      )}
      <span
        className={clsx(
          'transition-colors duration-200',
          active ? 'text-white' : 'text-text-muted group-hover:text-text-secondary',
          pulse && 'animate-pulse text-accent-secondary'
        )}
      >
        {icon}
      </span>

      <span>{label}</span>

      {badge !== undefined && (
        <span
          className={clsx(
            'ml-auto flex min-w-[18px] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-medium transition-all duration-300',
            label === 'Settings' && pulse
              ? 'bg-gradient-to-r from-[#FF0000]/20 to-[#007BFF]/20 border border-white/10 text-white font-mono rgb-settings-timer'
              : 'bg-white/[0.04] text-text-muted'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
