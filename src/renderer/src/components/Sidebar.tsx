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
  SidebarSimple,
  Code
} from '@phosphor-icons/react'
import React, { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { MotionConfig, motion } from 'motion/react'
import { LoadingDots } from './LoadingDots'
import { Spinner } from './Spinner'
import { AnimatedStreamingText, StreamContext, useStreamStats } from './AnimatedStreamingText'
import type { AppConfig } from '../../../main/config'
import type { HarnessExplorerSelection, SessionMode } from '../../../shared/types'
import { FolderChatsPanel } from './FolderChatsPanel'
import { UserAccountCard } from './UserAccountCard'
import prismIcon from '../../../../resources/icon.png?asset'
import { HarnessExplorer } from './HarnessExplorer'

interface ChatSession {
  id: string
  title: string
  lastUpdated: number
  sessionMode?: SessionMode
  disciplinePath?: string
  isDiscord?: boolean
}

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
  onLoadChat: (id: string) => void
  onNewChat: (force?: boolean) => void
  onStartHarness?: () => void
  onChatDeleted: (id: string) => void
  currentChatId?: string
  runningChats?: Record<string, boolean>
  className?: string
  isOpen?: boolean
  config?: AppConfig | null
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onClose?: () => void
  authUser?: import('../../../shared/types').UserProfile | null
  onOpenAuth?: () => void
  onOpenProfile?: () => void
  harnessProjectPath?: string
  harnessExplorerContext?: HarnessExplorerSelection[]
  onAddHarnessExplorerContext?: (selection: HarnessExplorerSelection) => boolean
  onRemoveHarnessExplorerContext?: (relativePath: string) => void
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


const DiscordIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 199"
    width={size}
    height={size}
    fill="currentColor"
    className={className}
  >
    <path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.6 131.6 0 0 0 5.356 4.237 136.075 136.075 0 0 1-21.887 10.632 156.776 156.776 0 0 0 13.873 22.846c21.122-6.58 42.605-16.638 64.774-33.193 5.485-57.818-10.985-107.031-48.423-148.358zM85.474 135.04c-11.832 0-21.606-10.793-21.606-24.088 0-13.296 9.57-24.088 21.606-24.088 12.036 0 21.809 10.954 21.606 24.088 0 13.295-9.57 24.088-21.606 24.088zm85.05 0c-11.833 0-21.607-10.793-21.607-24.088 0-13.296 9.57-24.088 21.607-24.088 12.036 0 21.81 10.954 21.607 24.088 0 13.295-9.773 24.088-21.607 24.088z" />
  </svg>
)

export function Sidebar({
  activeView,
  onViewChange,
  onLoadChat,
  onNewChat,
  onStartHarness,
  onChatDeleted,
  currentChatId,
  runningChats = {},
  className,
  isOpen = false,
  config,
  onOpenSearch,
  onOpenSettings,
  onClose,
  authUser,
  onOpenAuth,
  onOpenProfile,
  harnessProjectPath,
  harnessExplorerContext = [],
  onAddHarnessExplorerContext,
  onRemoveHarnessExplorerContext
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

    // The main process broadcasts lifecycle events for both workspaces. Reload
    // through the Chat-only IPC endpoint instead of inserting an unknown id.
    const removeCreatedListener = window.api.onChatSessionCreated(() => {
      void refreshChats()
    })

    const removeTitleListener = window.api.onChatTitleReceived(() => {
      void refreshChats()
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
      onChatDeleted(id)
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
    isDiscord?: boolean
    chats: ChatSession[]
    lastUpdated: number
  }

  // Group chats and memoize to optimize rendering performance
  const groups = React.useMemo(() => {
    const groupsMap = new Map<string, ChatSession[]>()
    chats.forEach((chat) => {
      const pathKey = chat.disciplinePath ? chat.disciplinePath.trim() : ''
      if (chat.isDiscord) {
        if (!groupsMap.has('__discord__')) {
          groupsMap.set('__discord__', [])
        }
        groupsMap.get('__discord__')!.push(chat)
      } else if (pathKey) {
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
      const isDiscord = pathKey === '__discord__'
      const mostRecentChat = groupChats[0]
      const lastUpdated = mostRecentChat ? mostRecentChat.lastUpdated : 0
      computedGroups.push({
        id: pathKey,
        name: isDiscord ? 'Discord' : isGeneral ? 'General' : getFolderBasename(pathKey),
        isGeneral,
        isDiscord,
        chats: groupChats,
        lastUpdated
      })
    })

    computedGroups.sort((a, b) => b.lastUpdated - a.lastUpdated)
    return computedGroups
  }, [chats])

  const [licenseInfo, setLicenseInfo] = useState<
    import('../../../shared/types').LicenseInfo | null
  >(null)

  useEffect(() => {
    const updateLicense = () => {
      window.api
        .getLicenseInfo()
        .then((info) => {
          if (info && info.isActivated) {
            setLicenseInfo(info)
          } else {
            setLicenseInfo(null)
          }
        })
        .catch(() => setLicenseInfo(null))
    }
    updateLicense()

    const removeConfigListener = window.api.onConfigChanged(() => {
      updateLicense()
    })

    const timer = setInterval(updateLicense, 1000)

    return () => {
      removeConfigListener()
      clearInterval(timer)
    }
  }, [])

  return (
    <aside
      className={clsx(
        'relative h-full flex flex-row bg-black/25 backdrop-blur-2xl overflow-hidden z-20 select-none transition-[width,opacity] duration-[460ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
        isOpen
          ? viewMoreGroupId
            ? 'w-[min(860px,calc(100vw-320px))] opacity-100'
            : 'w-[264px] opacity-100'
          : 'w-0 opacity-0 pointer-events-none',
        className
      )}
    >
      {/* Soft separation from the chat canvas — light falloff, not a border. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-black/35 to-transparent" />
      {/* Left Column - Main Sidebar Navigation */}
      <div className="w-[264px] shrink-0 h-full flex flex-col">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-2.5 select-none">
            <img
              src={prismIcon}
              alt="Prism Logo"
              className="h-7 w-7 rounded-lg object-cover shadow-[0_2px_10px_rgba(0,0,0,0.35)] self-center"
            />
            <div className="flex items-baseline gap-1.5 min-w-0">
              <h1 className="text-sm font-semibold text-text-primary tracking-tight">Prism</h1>
              {licenseInfo?.isActivated && (
                <span
                  className="font-mono text-[9.5px] font-bold tracking-[0.18em] uppercase select-none"
                  style={{ color: 'var(--accent-primary)' }}
                  title={`Activated for ${licenseInfo.licensee} (${licenseInfo.email})`}
                >
                  {licenseInfo.type || 'ENTERPRISE'}
                </span>
              )}
            </div>
          </div>
          {isOpen && onClose && (
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary/60 hover:bg-white/[0.06] hover:text-text-primary transition-all duration-150 cursor-pointer active:scale-95"
              title="Collapse sidebar"
            >
              <SidebarSimple size={15} weight="bold" />
            </button>
          )}
        </div>

        {/* Workspace action — quiet island, presses like a physical key. */}
        <div className="px-3 pb-1 pt-1 shrink-0">
          <button
            onClick={() => (activeView === 'harness' ? onStartHarness?.() : onNewChat())}
            className="group flex w-full items-center justify-center gap-2.5 rounded-2xl bg-white/[0.055] hover:bg-white/[0.09] text-xs font-semibold text-text-primary transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] cursor-pointer py-2.5 px-3 shadow-[0_1px_6px_rgba(0,0,0,0.25)] active:scale-[0.97]"
          >
            {activeView === 'harness' ? (
              <Code
                size={15}
                weight="bold"
                className="text-text-secondary group-hover:text-white transition-colors"
              />
            ) : (
              <NotePencil
              size={15}
              weight="bold"
              className="text-text-secondary group-hover:text-white transition-colors"
              />
            )}
            <span>{activeView === 'harness' ? 'Start Harness' : 'New Chat'}</span>
          </button>
        </div>

        {/* Navigation Items — one shared pill glides between destinations. */}
        <MotionConfig reducedMotion="user">
        <nav className="flex shrink-0 flex-col gap-0.5 px-3 py-2">
          <NavItem
            icon={<ChatTeardropText size={15} weight={activeView === 'chat' ? 'fill' : 'bold'} />}
            label="Chat"
            active={activeView === 'chat'}
            onClick={(): void => onViewChange('chat')}
          />
          <NavItem
            icon={<Code size={15} weight={activeView === 'harness' ? 'fill' : 'bold'} />}
            label="Harness"
            active={activeView === 'harness'}
            onClick={(): void => onViewChange('harness')}
          />
          <NavItem
            icon={<MagnifyingGlass size={15} weight="bold" />}
            label="Search chats"
            onClick={onOpenSearch}
          />
        </nav>
        </MotionConfig>

        <div className="mx-3 h-px shrink-0 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />

        {/* The regular sidebar intentionally owns only Chat history. Harness
            history lives in its focused project modal. */}
        {activeView === 'harness' ? (
          <HarnessExplorer
            projectPath={harnessProjectPath}
            selections={harnessExplorerContext}
            onAdd={onAddHarnessExplorerContext || (() => false)}
            onRemove={onRemoveHarnessExplorerContext || (() => {})}
          />
        ) : (
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
                const Icon = group.isDiscord ? DiscordIcon : group.isGeneral ? Lightning : Folder
                const CaretIcon = isCollapsed ? CaretRight : CaretDown
                const visibleChats = group.chats.slice(0, 5)

                return (
                  <div key={group.id} className="flex flex-col mb-1.5">
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="group/btn flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.025] transition-all duration-200 text-left w-full select-none cursor-pointer"
                      title={group.isGeneral ? undefined : group.id}
                    >
                      <CaretIcon
                        size={11}
                        weight="bold"
                        className="text-text-muted/60 transition-transform duration-200"
                      />
                      <Icon
                        size={13}
                        weight={group.isDiscord ? undefined : 'bold'}
                        className={clsx(
                          group.isDiscord
                            ? 'text-white/80'
                            : group.isGeneral
                              ? 'text-white/80'
                              : 'text-text-muted group-hover/btn:text-text-secondary'
                        )}
                      />
                      <span className="truncate flex-1 text-xs">{group.name}</span>
                      <span className="text-[10px] text-text-muted/70 bg-white/[0.04] px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                        {group.chats.length}
                      </span>
                    </button>

                    {/* Collapsed groups fold shut via grid rows — no max-height hacks,
                        no layout thrash, perfectly smooth easing. */}
                    <div
                      className={clsx(
                        'grid transition-[grid-template-rows,opacity] duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
                        isCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                      )}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-0.5 pl-3 mt-1">
                      {visibleChats.map((chat) => (
                        <div key={chat.id} className="group relative">
                          <button
                            onClick={() => {
                              onViewChange('chat')
                              onLoadChat(chat.id)
                            }}
                            className={clsx(
                              'min-h-[32px] w-full truncate rounded-xl px-2.5 py-1.5 pr-7 text-left text-xs transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] select-none cursor-pointer relative',
                              currentChatId === chat.id
                                ? 'bg-white/[0.07] text-white font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.22)]'
                                : 'text-text-secondary/80 hover:bg-white/[0.035] hover:text-text-primary'
                            )}
                            title={chat.title}
                          >
                            {currentChatId === chat.id && (
                              <span
                                className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-[3px] -ml-2.5 rounded-full"
                                style={{ backgroundColor: 'var(--accent-primary)' }}
                              />
                            )}
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
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
        )}

        {/* Footer */}
        <div className="mt-auto p-3 shrink-0">
          <UserAccountCard
            user={authUser || null}
            onOpenAuth={onOpenAuth || (() => {})}
            onOpenProfile={onOpenProfile || (() => {})}
          />
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
          'h-full flex flex-col bg-transparent transition-all duration-[460ms] ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden',
          viewMoreGroupId ? 'flex-1 min-w-[300px] opacity-100' : 'w-0 min-w-0 opacity-0 pointer-events-none'
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
          chats={viewMoreGroupId ? groups.find((g) => g.id === viewMoreGroupId)?.chats || [] : []}
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
    <MotionConfig reducedMotion="user">
    <button
      onClick={onClick}
      className={clsx(
        'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-colors duration-200 cursor-pointer select-none outline-none',
        active
          ? 'text-text-primary font-semibold'
          : 'text-text-secondary/80 hover:bg-white/[0.035] hover:text-text-primary'
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-nav-surface"
          transition={{ type: 'spring', stiffness: 480, damping: 42 }}
          className="absolute inset-0 rounded-xl bg-white/[0.065] shadow-[0_1px_6px_rgba(0,0,0,0.2)]"
        />
      )}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 -ml-3 rounded-full"
          style={{
            backgroundColor: 'var(--accent-primary)'
          }}
        />
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
    </MotionConfig>
  )
}
