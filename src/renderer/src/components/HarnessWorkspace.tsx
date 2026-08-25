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

  const dockWidth = Math.min(720, Math.max(76, 76 + tabs.length * 150))
  const motionClass = reduceMotion
    ? 'transition-none'
    : 'transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'

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
        className="absolute left-1/2 top-3 z-40 -translate-x-1/2"
        onMouseEnter={() => setIsDockOpen(true)}
        onMouseLeave={() => setIsDockOpen(false)}
      >
        <div
          className={clsx(
            'relative flex items-center rounded-2xl border border-white/[0.14] bg-black/52 p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.48),var(--glass-specular-top)] backdrop-blur-2xl',
            motionClass,
            isDockOpen ? 'opacity-100' : 'opacity-92'
          )}
          style={{ width: `${isDockOpen ? dockWidth : 38}px` }}
        >
          <button
            type="button"
            onClick={() => setIsDockOpen((open) => !open)}
            onFocus={() => setIsDockOpen(true)}
            aria-expanded={isDockOpen}
            aria-label="Toggle Harness tabs"
            className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/[0.09] hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <span className={clsx('h-2 w-2 rounded-full bg-accent-primary shadow-[0_0_12px_var(--accent-primary)]', activeTab?.isProcessing && 'animate-pulse')} />
          </button>

          <div
            className={clsx(
              'flex min-w-0 items-center gap-1 overflow-hidden',
              motionClass,
              isDockOpen ? 'ml-1 max-w-[620px] opacity-100' : 'ml-0 max-w-0 opacity-0 pointer-events-none'
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTab(tab.id)}
                    className={clsx(
                      'group/tab flex h-7 min-w-[108px] max-w-[170px] items-center gap-1.5 rounded-xl px-2 text-left text-[10.5px] font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
                      isActive
                        ? 'bg-white/[0.1] text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
                    )}
                    title={`${tab.title || 'New Harness'} · ${projectName(tab.disciplinePath)}`}
                  >
                    <Folder size={11} weight={isActive ? 'fill' : 'bold'} className="shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate">{tab.title || 'New Harness'}</span>
                    {tab.isProcessing ? (
                      <StopCircle
                        size={11}
                        weight="fill"
                        onClick={(event) => {
                          event.stopPropagation()
                          onStopTab(tab)
                        }}
                        className="shrink-0 text-accent-primary hover:text-text-primary"
                      />
                    ) : (
                      <X
                        size={10}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover/tab:opacity-100 hover:text-text-primary"
                      />
                    )}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={onNewTab}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/[0.09] hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              aria-label="New Harness tab"
              title="New Harness tab"
            >
              <Plus size={13} weight="bold" />
            </button>
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/[0.09] hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              aria-label="Open Harness history"
              title="Project history"
            >
              <ClockCounterClockwise size={13} weight="bold" />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/[0.09] hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              aria-label="Open Harness settings"
              title="Harness settings"
            >
              <Gear size={13} weight="bold" />
            </button>
          </div>
        </div>
        {isDockOpen && tabProjectMode === 'grouped' && activeTab?.disciplinePath && (
          <div className="mt-1.5 text-center text-[9px] font-medium tracking-wide text-text-muted/75">
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
                      {group.sessions.map((session) => (
                        <div key={session.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.045]">
                          <button
                            type="button"
                            onClick={() => {
                              onLoadSession(session.id)
                              setIsHistoryOpen(false)
                            }}
                            className="min-w-0 flex-1 text-left focus:outline-none"
                          >
                            <div className="truncate text-xs font-medium text-text-primary">{session.title || 'New Harness'}</div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">{formatUpdated(session.lastUpdated)}</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteSession(session.id)
                              setHistory((current) => current.filter((entry) => entry.id !== session.id))
                            }}
                            className="rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-white/[0.08] hover:text-status-error group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                            aria-label={`Delete ${session.title || 'Harness conversation'}`}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
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
