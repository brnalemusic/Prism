import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  ClockCounterClockwise,
  Code,
  Folder,
  Gear,
  Plus,
  StopCircle,
  X
} from '@phosphor-icons/react'
import type { TabSession } from '../types/tab'
import type { SessionMode } from '../../../shared/types'

interface HarnessHistorySession {
  id: string
  title: string
  lastUpdated: number
  sessionMode?: SessionMode
  disciplinePath?: string
}

export interface HarnessWorkspaceProps {
  tabs: TabSession[]
  activeTabId: string
  reduceMotion?: boolean
  tabProjectMode?: 'fixed' | 'grouped'
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
  onStopTab: (tab: TabSession) => void
  onLoadSession: (chatId: string) => void
  onDeleteSession: (chatId: string) => void
  onOpenSettings: () => void
  onOpenProjectPicker: () => void
  renderActiveTab: (tab: TabSession) => React.ReactNode
}

function projectName(projectPath?: string): string {
  if (!projectPath) return 'No project selected'
  const pieces = projectPath.split(/[\\/]/).filter(Boolean)
  return pieces[pieces.length - 1] || projectPath
}

function getTabDisplayName(tab: TabSession): string {
  if (tab.title && tab.title !== 'New Harness' && tab.title !== 'Chat') {
    return tab.title
  }
  if (tab.disciplinePath) {
    return projectName(tab.disciplinePath)
  }
  return 'New Harness'
}

function formatUpdated(timestamp: number): string {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * A focused product surface for coding work. It deliberately owns the Harness
 * tab presentation and history rather than reusing the Chat tab bar/sidebar.
 */
export function HarnessWorkspace({
  tabs,
  activeTabId,
  reduceMotion = false,
  tabProjectMode = 'fixed',
  onSelectTab,
  onCloseTab,
  onNewTab,
  onStopTab,
  onLoadSession,
  onDeleteSession,
  onOpenSettings,
  onOpenProjectPicker,
  renderActiveTab
}: HarnessWorkspaceProps): React.JSX.Element {
  const [isDockOpen, setIsDockOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HarnessHistorySession[]>([])
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0]

  const refreshHistory = useCallback(async (): Promise<void> => {
    const sessions = await window.api.getHarnessSessions()
    setHistory(sessions)
  }, [])

  useEffect(() => {
    if (!isHistoryOpen) return
    void refreshHistory()
  }, [isHistoryOpen, refreshHistory])

  const historyGroups = useMemo(() => {
    const byProject = new Map<string, HarnessHistorySession[]>()
    for (const session of history) {
      const projectPath = session.disciplinePath || ''
      const group = byProject.get(projectPath) || []
      group.push(session)
      byProject.set(projectPath, group)
    }
    return Array.from(byProject.entries())
      .map(([projectPath, sessions]) => ({
        projectPath,
        sessions: [...sessions].sort((left, right) => right.lastUpdated - left.lastUpdated)
      }))
      .sort((left, right) => (right.sessions[0]?.lastUpdated || 0) - (left.sessions[0]?.lastUpdated || 0))
  }, [history])

  const isMaxTabs = tabs.length >= 5

  // Uniform tab width computation:
  // Every tab in the current view has the EXACT same width regardless of title length (max 5 tabs).
  const tabWidth = useMemo(() => {
    const count = tabs.length
    if (count <= 1) return 136
    if (count === 2) return 130
    if (count === 3) return 122
    if (count === 4) return 114
    return 106
  }, [tabs.length])

  // Precise dock width when expanded so there is ZERO excess empty space on the right:
  // Padding (12px) + Dot (28px) + Gap (6px) + Tabs (N * tabWidth + (N - 1) * 4px gap) + Divider (10px) + Actions (92px)
  const dockOpenWidth = useMemo(() => {
    const tabsTotalWidth = tabs.length * tabWidth + Math.max(0, tabs.length - 1) * 4
    return 12 + 28 + 6 + tabsTotalWidth + 10 + 92
  }, [tabs.length, tabWidth])

  const motionClass = reduceMotion
    ? 'transition-none'
    : 'transition-[width,background-color,border-color,box-shadow,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'

  return (
    <section className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-black" aria-label="Harness workspace">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(255,255,255,0.05),transparent_46%)] pointer-events-none" />

      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden pt-2">
        {activeTab ? (
          renderActiveTab(activeTab)
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.11] bg-white/[0.035] text-text-secondary shadow-[var(--glass-specular-top)]">
              <Code size={19} weight="bold" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-text-primary">Start a Harness</h2>
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-text-secondary">
              Choose a project root, then work with its files, terminal and project instructions in one isolated session.
            </p>
            <button
              type="button"
              onClick={onOpenProjectPicker}
              className="mt-5 rounded-xl border border-white/[0.13] bg-white/[0.055] px-3.5 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            >
              Choose project
            </button>
          </div>
        )}
      </div>

      <div
        className="absolute left-1/2 top-3 z-40 -translate-x-1/2 py-1 max-w-[calc(100vw-48px)]"
        onMouseEnter={() => setIsDockOpen(true)}
        onMouseLeave={() => setIsDockOpen(false)}
      >
        <div
          className={clsx(
            'relative flex h-9 items-center rounded-full border border-white/[0.12] bg-[#090b12]/80 px-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.55),var(--glass-specular-top)] backdrop-blur-2xl overflow-hidden',
            motionClass,
            isDockOpen ? 'opacity-100 border-white/[0.18]' : 'opacity-90 hover:opacity-100 hover:border-white/[0.2]'
          )}
          style={{ width: `${isDockOpen ? dockOpenWidth : 36}px` }}
        >
          {/* Glowing Dot Button */}
          <button
            type="button"
            onClick={() => setIsDockOpen((open) => !open)}
            onFocus={() => setIsDockOpen(true)}
            aria-expanded={isDockOpen}
            aria-label="Toggle Harness tabs"
            className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-all hover:bg-white/[0.08] hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            title={isDockOpen ? 'Collapse Harness tabs' : `Expand Harness tabs (${tabs.length} open)`}
          >
            <span
              className={clsx(
                'h-2 w-2 rounded-full bg-accent-primary transition-all duration-200',
                activeTab?.isProcessing
                  ? 'animate-pulse shadow-[0_0_12px_var(--accent-primary),0_0_24px_var(--accent-glow)]'
                  : 'shadow-[0_0_8px_var(--accent-primary)] hover:scale-110'
              )}
            />
          </button>

          {/* Expanded Content (Tabs + Actions) */}
          <div
            className={clsx(
              'flex min-w-0 items-center gap-1.5 overflow-hidden transition-[max-width,opacity,transform] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] select-none',
              isDockOpen
                ? 'ml-1.5 opacity-100 scale-100 pointer-events-auto'
                : 'max-w-0 opacity-0 scale-95 pointer-events-none'
            )}
          >
            {/* Uniform Tabs Container - 0 Sliders Guaranteed */}
            <div className="flex min-w-0 items-center gap-1 overflow-hidden no-scrollbar py-0.5">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId
                const displayName = getTabDisplayName(tab)
                const tabTooltip = `${displayName}${tab.disciplinePath ? ` · ${projectName(tab.disciplinePath)}` : ''}`

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTab(tab.id)}
                    style={{ width: `${tabWidth}px` }}
                    className={clsx(
                      'group/tab relative flex h-7 shrink-0 items-center gap-1.5 rounded-xl px-2 text-left text-[11px] font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary border',
                      isActive
                        ? 'bg-white/[0.12] text-text-primary border-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.25)]'
                        : 'bg-white/[0.025] text-text-secondary/70 hover:bg-white/[0.07] hover:text-text-primary border-transparent hover:border-white/[0.06]'
                    )}
                    title={tabTooltip}
                  >
                    <Folder
                      size={11.5}
                      weight={isActive ? 'fill' : 'bold'}
                      className={clsx(
                        'shrink-0 transition-colors',
                        isActive ? 'text-accent-primary' : 'text-text-muted group-hover/tab:text-text-secondary'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate tracking-tight text-[11px]">
                      {displayName}
                    </span>
                    {tab.isProcessing ? (
                      <span
                        onClick={(event) => {
                          event.stopPropagation()
                          onStopTab(tab)
                        }}
                        className="flex h-4.5 w-4.5 items-center justify-center rounded text-accent-primary hover:text-status-error hover:bg-status-error/15 transition-all shrink-0 cursor-pointer"
                        title="Stop processing"
                      >
                        <StopCircle size={11.5} weight="fill" />
                      </span>
                    ) : (
                      <span
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                        className="flex h-4 w-4 items-center justify-center rounded text-text-muted opacity-0 transition-all duration-150 group-hover/tab:opacity-100 hover:bg-white/[0.14] hover:text-text-primary shrink-0"
                        title="Close tab"
                      >
                        <X size={10} weight="bold" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Crisp Divider */}
            <div className="h-3.5 w-[1px] bg-white/[0.1] shrink-0 mx-0.5" />

            {/* Action Controls */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={isMaxTabs}
                onClick={onNewTab}
                className={clsx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
                  isMaxTabs
                    ? 'opacity-30 cursor-not-allowed text-text-muted hover:bg-transparent'
                    : 'text-text-secondary/75 hover:bg-white/[0.08] hover:text-text-primary'
                )}
                aria-label={isMaxTabs ? 'Maximum 5 Harness tabs reached' : 'New Harness tab'}
                title={isMaxTabs ? 'Maximum 5 Harness tabs reached' : 'New Harness tab'}
              >
                <Plus size={13} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(true)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-secondary/75 transition-all duration-150 hover:bg-white/[0.08] hover:text-text-primary active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                aria-label="Open Harness history"
                title="Project history"
              >
                <ClockCounterClockwise size={13} weight="bold" />
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-secondary/75 transition-all duration-150 hover:bg-white/[0.08] hover:text-text-primary active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                aria-label="Open Harness settings"
                title="Harness settings"
              >
                <Gear size={13} weight="bold" />
              </button>
            </div>
          </div>
        </div>
        {isDockOpen && tabProjectMode === 'grouped' && activeTab?.disciplinePath && (
          <div className="mt-1.5 text-center text-[9.5px] font-medium tracking-wide text-text-muted/70 animate-fade-in pointer-events-none select-none">
            {projectName(activeTab.disciplinePath)} project group
          </div>
        )}
      </div>

      {isHistoryOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/68 p-4 pt-20 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.13] bg-[#0c0c0d]/95 shadow-[0_30px_90px_rgba(0,0,0,0.7),var(--glass-specular-top)] backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-text-primary">Harness history</h2>
                <p className="mt-0.5 text-[11px] text-text-secondary">Conversations grouped by project root.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.07] hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                aria-label="Close Harness history"
              >
                <X size={15} />
              </button>
            </div>
            <div className="max-h-[min(66vh,620px)] space-y-5 overflow-y-auto p-5 custom-scrollbar">
              {historyGroups.length === 0 ? (
                <p className="py-8 text-center text-xs text-text-muted">No Harness conversations yet.</p>
              ) : (
                historyGroups.map((group) => (
                  <section key={group.projectPath || '__unassigned__'}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-secondary">
                      <Folder size={13} weight="fill" className="text-text-muted" />
                      <span className="truncate">{projectName(group.projectPath)}</span>
                      <span className="font-mono text-[10px] font-normal text-text-muted">{group.sessions.length}</span>
                    </div>
                    <div className="space-y-1">
                      {group.sessions.map((session) => {
                        const sessionTitle =
                          session.title && session.title !== 'New Harness' && session.title !== 'Chat'
                            ? session.title
                            : session.disciplinePath
                              ? projectName(session.disciplinePath)
                              : 'New Harness'

                        return (
                          <div
                            key={session.id}
                            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.045]"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onLoadSession(session.id)
                                setIsHistoryOpen(false)
                              }}
                              className="min-w-0 flex-1 text-left focus:outline-none"
                            >
                              <div className="truncate text-xs font-medium text-text-primary">
                                {sessionTitle}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                                {formatUpdated(session.lastUpdated)}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteSession(session.id)
                                setHistory((current) =>
                                  current.filter((entry) => entry.id !== session.id)
                                )
                              }}
                              className="rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-white/[0.08] hover:text-status-error group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                              aria-label={`Delete ${sessionTitle}`}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
