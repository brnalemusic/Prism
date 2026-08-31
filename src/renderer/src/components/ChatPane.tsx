import React, { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react'
import clsx from 'clsx'
import {
  CaretDown,
  CaretRight,
  ChatTeardropText,
  Check,
  Columns,
  Desktop,
  FolderOpen,
  X,
  ArrowsLeftRight,
  DotsSixVertical,
  Trash,
  Warning
} from '@phosphor-icons/react'
import { InputBar, InputBarHandle } from './InputBar'
import TodoPanel from './TodoPanel'
import { QuestionnaireWizard } from './QuestionnaireRenderer'
import type { TabSession } from '../types/tab'
import type { AppConfig, SlashWorkflow } from '../../../main/config'
import type {
  HarnessPermissionMode,
  TerminalProcessSnapshot,
  TodoState
} from '../../../shared/types'
import { getDefaultThinkingLevelForModel } from '../constants'

interface ChatPaneProps {
  tab: TabSession
  isFocused: boolean
  isSplitView: boolean
  todo: TodoState | null
  terminalProcesses: TerminalProcessSnapshot[]
  config: AppConfig | null
  isKeyMissing: boolean
  isOnline: boolean
  onFocus: (id: string) => void
  onCloseTab: (id: string) => void
  onToggleSplitTab: (id: string) => void
  onSend: (
    text: string,
    file?: TabSession['attachedFile'],
    overrideModel?: string,
    overrideSessionMode?: TabSession['sessionMode'],
    forceYoutube?: boolean
  ) => void
  onCancel: () => void
  onModelChange: (model: string) => void
  onReasoningLevelChange: (model: string, level: string) => void
  onModeChange: (mode: TabSession['sessionMode']) => void
  onSelectFolder: () => void
  onSwitchProject?: (projectPath: string) => void
  onUpdateTabInput: (id: string, text: string) => void
  onUpdateTabFile: (id: string, file: TabSession['attachedFile']) => void
  onUpdateTabQuote?: (id: string, quote: string | null) => void
  onUpdateTabDisabledSkills?: (id: string, disabledSkills: string[]) => void
  onAddHarnessExplorerContext?: (selection: import('../../../shared/types').HarnessExplorerSelection) => boolean
  onRemoveHarnessExplorerContext?: (relativePath: string) => void
  harnessPermissionMode?: HarnessPermissionMode
  onHarnessPermissionModeChange?: (mode: HarnessPermissionMode) => void
  onOpenUpgradePlans?: () => void
  isEnterprise?: boolean
  onToggleSearch?: (enabled?: boolean) => void
  onOpenScreenshotModal: () => void
  onOpenYoutubeModal: () => void
  activeWorkflow: SlashWorkflow | null
  setActiveWorkflow: (wf: SlashWorkflow | null) => void
  renderedMessages: React.ReactNode
  onSwapSplitTabs?: (sourceTabId: string, targetTabId: string) => void
}

export const ChatPane: React.FC<ChatPaneProps> = React.memo(
  ({
    tab,
    isFocused,
    isSplitView,
    todo,
    terminalProcesses,
    config,
    isKeyMissing,
    isOnline,
    onFocus,
    onCloseTab,
    onToggleSplitTab,
    onSend,
    onCancel,
    onModelChange,
    onReasoningLevelChange,
    onModeChange,
    onSelectFolder,
    onSwitchProject,
    onUpdateTabInput,
    onUpdateTabFile,
    onUpdateTabQuote,
    onUpdateTabDisabledSkills,
    onAddHarnessExplorerContext,
    onRemoveHarnessExplorerContext,
    harnessPermissionMode,
    onHarnessPermissionModeChange,
    onOpenUpgradePlans,
    isEnterprise,
    onToggleSearch,
    onOpenScreenshotModal,
    onOpenYoutubeModal,
    activeWorkflow,
    setActiveWorkflow,
    renderedMessages,
    onSwapSplitTabs
  }) => {
    const inputBarRef = useRef<InputBarHandle>(null)
    const [isDraggingSplit, setIsDraggingSplit] = useState(false)
    const [isDragTargetSplit, setIsDragTargetSplit] = useState(false)
    const isHarness = tab.sessionMode === 'harness'

    const [recentProjects, setRecentProjects] = useState<{ path: string; name: string }[]>([])
    const [projectHealthMap, setProjectHealthMap] = useState<Record<string, boolean>>({})
    const [isProjectMissing, setIsProjectMissing] = useState(false)
    const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false)
    const projectButtonRef = useRef<HTMLButtonElement>(null)
    const projectDropdownRef = useRef<HTMLDivElement>(null)

    const checkCurrentProjectHealth = useCallback(async (): Promise<void> => {
      if (!isHarness || !tab.disciplinePath) {
        setIsProjectMissing(false)
        return
      }
      try {
        const status = await window.api.checkHarnessProject(tab.disciplinePath)
        setIsProjectMissing(!status.exists || !status.isDirectory)
      } catch {
        setIsProjectMissing(false)
      }
    }, [isHarness, tab.disciplinePath])

    useEffect(() => {
      void checkCurrentProjectHealth()
    }, [checkCurrentProjectHealth])

    const refreshRecentProjects = useCallback(async (): Promise<void> => {
      if (!isHarness) return
      try {
        const sessions = await window.api.getHarnessSessions()
        const seen = new Set<string>()
        const list: { path: string; name: string }[] = []

        const addPath = (p?: string): void => {
          if (!p) return
          const norm = p.trim().toLowerCase()
          if (!norm || seen.has(norm)) return
          seen.add(norm)
          const pieces = p.split(/[\\/]/).filter(Boolean)
          const name = pieces[pieces.length - 1] || p
          list.push({ path: p, name })
        }

        // Current project path
        addPath(tab.disciplinePath)

        // History sessions
        for (const session of sessions) {
          addPath(session.disciplinePath)
        }

        // Config projects
        const configProjects = Object.values(config?.harness.projects || {})
        for (const proj of configProjects) {
          addPath(proj.rootPath)
        }

        const topRecent = list.slice(0, 7)
        setRecentProjects(topRecent)

        // Check health of all recent projects
        const healthResults: Record<string, boolean> = {}
        await Promise.all(
          topRecent.map(async (item) => {
            try {
              const res = await window.api.checkHarnessProject(item.path)
              healthResults[item.path.toLowerCase()] = res.exists && res.isDirectory
            } catch {
              healthResults[item.path.toLowerCase()] = true
            }
          })
        )
        setProjectHealthMap(healthResults)
      } catch (err) {
        console.error('Failed to get recent projects:', err)
      }
    }, [isHarness, tab.disciplinePath, config?.harness.projects])

    useEffect(() => {
      void refreshRecentProjects()
    }, [refreshRecentProjects])

    useEffect(() => {
      if (!isProjectDropdownOpen) return

      const handleClickOutside = (e: MouseEvent): void => {
        if (
          projectDropdownRef.current &&
          !projectDropdownRef.current.contains(e.target as Node) &&
          projectButtonRef.current &&
          !projectButtonRef.current.contains(e.target as Node)
        ) {
          setIsProjectDropdownOpen(false)
        }
      }

      const handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          setIsProjectDropdownOpen(false)
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [isProjectDropdownOpen])

    const renderMissingFolderBanner = (): React.JSX.Element | null => {
      if (!isHarness || !isProjectMissing || !tab.disciplinePath) return null
      return (
        <div className="w-full max-w-[820px] mx-auto px-4 sm:px-8 mt-2 mb-2 pointer-events-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border border-amber-500/35 bg-[#17120a]/90 px-3.5 py-2.5 text-xs text-amber-200 shadow-[0_12px_36px_rgba(0,0,0,0.5)] backdrop-blur-2xl animate-soft-pop">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <Warning size={15} weight="fill" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-amber-300 flex items-center gap-2">
                  <span>Project folder not found on disk</span>
                </div>
                <p className="font-mono text-[10.5px] text-amber-200/70 truncate">{tab.disciplinePath}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await window.api.recreateHarnessProjectFolder(tab.disciplinePath!)
                    void checkCurrentProjectHealth()
                    void refreshRecentProjects()
                  } catch (e) {
                    console.error(e)
                  }
                }}
                className="rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition-colors cursor-pointer"
              >
                Recreate folder
              </button>
              <button
                type="button"
                onClick={onSelectFolder}
                className="rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors cursor-pointer"
              >
                Choose project
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (tab.disciplinePath) {
                    await window.api.deleteHarnessProject(tab.disciplinePath)
                    onSelectFolder()
                  }
                }}
                className="rounded-lg p-1 text-text-muted hover:text-status-error hover:bg-white/10 transition-colors cursor-pointer"
                title="Remove project from Prism"
                aria-label="Remove project from Prism"
              >
                <Trash size={14} />
              </button>
            </div>
          </div>
        </div>
      )
    }

    const renderProjectDropdown = (placement: 'top' | 'bottom' = 'bottom'): React.JSX.Element | null => {
      if (!isHarness) return null
      const currentName = tab.disciplinePath
        ? tab.disciplinePath.split(/[\\/]/).filter(Boolean).pop() || tab.disciplinePath
        : 'Choose project'

      return (
        <div className="w-full max-w-[820px] mx-auto px-4 sm:px-8 pointer-events-auto">
          <div className="relative mt-2 px-1.5 flex items-center self-start">
            <button
              ref={projectButtonRef}
              type="button"
              onClick={() => setIsProjectDropdownOpen((prev) => !prev)}
              className={clsx(
                'group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary border cursor-pointer',
                isProjectMissing
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                  : 'text-text-secondary/70 hover:bg-white/[0.06] hover:text-text-primary border-transparent hover:border-white/[0.08]'
              )}
              title={isProjectMissing ? 'Project folder missing on disk' : 'Switch workspace project'}
            >
              {isProjectMissing ? (
                <Warning size={13} weight="fill" className="shrink-0 text-amber-400" />
              ) : (
                <Desktop
                  size={13}
                  weight="fill"
                  className="shrink-0 text-text-muted transition-colors group-hover:text-accent-primary"
                />
              )}
              <span className="max-w-[190px] truncate text-[11.5px] font-medium tracking-tight">
                {currentName}
              </span>
              {isProjectMissing && (
                <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-semibold text-amber-300 uppercase">
                  Missing
                </span>
              )}
              <CaretRight
                size={10}
                weight="bold"
                className={clsx(
                  'shrink-0 text-text-muted transition-transform duration-200',
                  isProjectDropdownOpen && 'rotate-90 text-text-primary'
                )}
              />
            </button>

            {isProjectDropdownOpen && (
              <div
                ref={projectDropdownRef}
                className={clsx(
                  'absolute left-1.5 z-50 w-64 rounded-xl border border-white/[0.12] bg-[#0c0e14]/95 p-1.5 text-xs shadow-[0_16px_40px_rgba(0,0,0,0.6),var(--glass-specular-top)] backdrop-blur-2xl animate-soft-pop select-none',
                  placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                )}
              >
                <div className="px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-text-muted flex items-center justify-between">
                  <span>Workspaces</span>
                  <span className="font-mono text-[9px] lowercase font-normal">{recentProjects.length} total</span>
                </div>
                <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto custom-scrollbar">
                  {recentProjects.map((proj) => {
                    const isCurrent =
                      Boolean(tab.disciplinePath) &&
                      tab.disciplinePath.toLowerCase() === proj.path.toLowerCase()
                    const isMissing = projectHealthMap[proj.path.toLowerCase()] === false

                    return (
                      <div
                        key={proj.path}
                        className={clsx(
                          'group/item flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11.5px] transition-colors w-full',
                          isCurrent
                            ? 'bg-white/[0.08] font-medium text-accent-primary'
                            : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setIsProjectDropdownOpen(false)
                            onSwitchProject?.(proj.path)
                          }}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer focus:outline-none"
                          title={proj.path}
                        >
                          {isMissing ? (
                            <Warning size={12.5} weight="fill" className="shrink-0 text-amber-400" />
                          ) : (
                            <Desktop
                              size={12.5}
                              weight={isCurrent ? 'fill' : 'regular'}
                              className={clsx('shrink-0', isCurrent ? 'text-accent-primary' : 'text-text-muted')}
                            />
                          )}
                          <span className="truncate flex-1">{proj.name}</span>
                          {isMissing && (
                            <span className="shrink-0 text-[8.5px] font-mono uppercase rounded bg-amber-500/20 px-1 text-amber-300">
                              missing
                            </span>
                          )}
                        </button>
                        {isCurrent && (
                          <Check size={12} weight="bold" className="shrink-0 text-accent-primary" />
                        )}
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            await window.api.deleteHarnessProject(proj.path)
                            void refreshRecentProjects()
                            if (isCurrent) onSelectFolder()
                          }}
                          className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded text-text-muted hover:text-status-error hover:bg-white/10 transition-all shrink-0 cursor-pointer"
                          title="Remove from Prism"
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <div className="my-1 h-[1px] bg-white/[0.06]" />

                <button
                  type="button"
                  onClick={() => {
                    setIsProjectDropdownOpen(false)
                    onSelectFolder()
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
                >
                  <FolderOpen size={12.5} className="shrink-0" />
                  <span>Manage / choose project...</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )
    }

    // Find the active to_ask tool call from the latest AI message (status running or writing)
    const activeQuestionnaire = useMemo(() => {
      for (let i = tab.messages.length - 1; i >= 0; i--) {
        const msg = tab.messages[i]
        if (msg.role !== 'ai') continue
        const tc = (msg.toolCalls || []).find(
          (t) => t.name === 'to_ask' && (t.status === 'running' || t.status === 'writing')
        )
        if (tc)
          return {
            toolCall: { name: tc.name, status: tc.status, args: tc.args || {} },
            chatId: tab.chatId || ''
          }
      }
      return null
    }, [tab.messages, tab.chatId])

    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const [showScrollButton, setShowScrollButton] = useState(false)
    const isAtBottomRef = useRef(true)
    const bottomThreshold = 80

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior
        })
      }
    }, [])

    useEffect(() => {
      const el = scrollContainerRef.current
      if (!el) return

      const handleScroll = (): void => {
        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        const atBottom = distanceToBottom <= bottomThreshold
        isAtBottomRef.current = atBottom
        setShowScrollButton(!atBottom)
      }

      el.addEventListener('scroll', handleScroll, { passive: true })
      handleScroll()

      const resizeObserver = new ResizeObserver(() => {
        if (isAtBottomRef.current) {
          el.scrollTop = el.scrollHeight - el.clientHeight
        } else {
          const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          setShowScrollButton(distanceToBottom > bottomThreshold)
        }
      })

      resizeObserver.observe(el)
      if (el.firstElementChild) {
        resizeObserver.observe(el.firstElementChild)
      }

      return () => {
        el.removeEventListener('scroll', handleScroll)
        resizeObserver.disconnect()
      }
    }, [])

    // Synchronous layout effect ensuring the chat stays firmly locked to the bottom
    // during tool execution, "Worked for N steps" accordion collapses, and streaming chunks.
    useLayoutEffect(() => {
      if (isAtBottomRef.current && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
    }, [
      tab.messages,
      tab.messages.length,
      tab.messages[tab.messages.length - 1]?.content,
      tab.messages[tab.messages.length - 1]?.toolCalls,
      tab.messages[tab.messages.length - 1]?.streamingToolCalls,
      tab.messages[tab.messages.length - 1]?.harnessRounds,
      tab.isProcessing
    ])

    useEffect(() => {
      if (!isFocused) return
      const timer = setTimeout(() => {
        inputBarRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }, [isFocused, tab.id])

    const [localInputText, setLocalInputText] = useState(tab.inputText)
    const lastTabIdRef = useRef(tab.id)
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
    const localInputTextRef = useRef(localInputText)
    localInputTextRef.current = localInputText

    // Sync from tab.inputText when tab changes or external update happens (e.g. quote / clear)
    useEffect(() => {
      if (tab.id !== lastTabIdRef.current) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        lastTabIdRef.current = tab.id
        setLocalInputText(tab.inputText)
      } else if (tab.inputText !== localInputTextRef.current) {
        setLocalInputText(tab.inputText)
      }
    }, [tab.id, tab.inputText])

    // Flush debounced update on unmount or tab switch
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
          onUpdateTabInput(lastTabIdRef.current, localInputTextRef.current)
        }
      }
    }, [onUpdateTabInput])

    const handleSendInputBar = useCallback(
      (
        message: string,
        _searchEnabled?: boolean,
        _screenshot?: string,
        attachedFile?: TabSession['attachedFile']
      ) => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        setLocalInputText('')
        localInputTextRef.current = ''
        onUpdateTabInput(tab.id, '')
        onSend(message, attachedFile || tab.attachedFile || undefined)
      },
      [onSend, onUpdateTabInput, tab.id, tab.attachedFile]
    )

    const handleSetTextInputBar = useCallback(
      (val: string | ((prev: string) => string)) => {
        setLocalInputText((prev) => {
          const next = typeof val === 'function' ? val(prev) : val
          localInputTextRef.current = next

          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current)
          }
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            onUpdateTabInput(tab.id, next)
          }, 300)

          return next
        })
      },
      [tab.id, onUpdateTabInput]
    )

    return (
      <div
        onClick={() => onFocus(tab.id)}
        onDragOver={(e) => {
          if (isSplitView && e.dataTransfer.types.includes('text/prism-split-tab-id')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (!isDragTargetSplit) {
              setIsDragTargetSplit(true)
            }
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setIsDragTargetSplit(false)
        }}
        onDrop={(e) => {
          if (!isSplitView) return
          e.preventDefault()
          setIsDragTargetSplit(false)
          const sourceId = e.dataTransfer.getData('text/prism-split-tab-id')
          if (sourceId && sourceId !== tab.id && onSwapSplitTabs) {
            onSwapSplitTabs(sourceId, tab.id)
          }
        }}
        className={clsx(
          'relative flex h-full w-full flex-col overflow-hidden bg-black transition-all duration-200 border',
          isSplitView ? 'rounded-xl' : 'rounded-none',
          isDraggingSplit && 'opacity-40 scale-[0.99] border-dashed border-accent-primary/50',
          isDragTargetSplit
            ? 'border-accent-primary shadow-[0_0_25px_rgba(255,255,255,0.12)] ring-2 ring-accent-primary/60 scale-[1.005]'
            : isFocused
              ? 'border-accent-primary/50 shadow-[0_0_20px_rgba(255,255,255,0.03)] ring-1 ring-accent-primary/30'
              : isSplitView
                ? 'border-[var(--border-default)] hover:border-[var(--border-strong)]'
                : 'border-transparent'
        )}
      >
        {/* Pane Sub-Header (Only visible in Split View) */}
        {isSplitView && (
          <div
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              e.dataTransfer.setData('text/prism-split-tab-id', tab.id)
              e.dataTransfer.effectAllowed = 'move'
              setIsDraggingSplit(true)
            }}
            onDragEnd={() => setIsDraggingSplit(false)}
            className={clsx(
              'flex h-8 w-full items-center justify-between border-b px-3 text-xs select-none backdrop-blur-md shrink-0 cursor-grab active:cursor-grabbing transition-colors',
              isFocused
                ? 'bg-accent-primary/10 border-accent-primary/30 text-text-primary'
                : 'bg-white/[0.02] border-white/[0.05] text-text-secondary hover:bg-white/[0.05]'
            )}
            title="Drag to swap split view window"
          >
            <div className="flex items-center gap-2 truncate">
              <DotsSixVertical
                size={14}
                className="text-text-muted hover:text-text-primary shrink-0"
              />
              <ChatTeardropText
                size={14}
                className={isFocused ? 'text-accent-primary' : 'text-text-muted'}
              />
              <span className="font-medium truncate">{tab.title || 'New Chat'}</span>
              {tab.isProcessing && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSplitTab(tab.id)
                }}
                title="Remove from split view"
                className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/[0.1] hover:text-text-primary transition-colors cursor-pointer"
              >
                <Columns size={12} weight="bold" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                title="Close tab"
                className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/[0.1] hover:text-text-primary transition-colors cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Swap drop target overlay */}
        {isDragTargetSplit && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent-primary/60 bg-black/90 animate-drop-target pointer-events-none transition-all duration-200">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-accent-primary/25 bg-[var(--surface)] text-accent-primary animate-bounce">
              <ArrowsLeftRight size={24} />
            </div>
            <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold tracking-wide text-text-primary">
              Swap window
            </span>
          </div>
        )}

        {/* Main Content Area */}
        <div className="relative flex flex-1 w-full overflow-hidden">
          {/* Chat scroll area */}
          <div
            ref={scrollContainerRef}
            className="relative flex-1 h-full overflow-y-auto no-scrollbar flex flex-col"
          >
            {/* Landing State when tab has no messages */}
            {tab.messages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-full bg-transparent select-none">
                <div className="w-full max-w-[720px] flex flex-col items-center gap-6 z-10 my-auto">
                  <div className="flex flex-col items-center text-center space-y-2">
                    <h1 className="text-3xl sm:text-4xl tracking-wide hero-shimmer-text">
                      {isHarness
                        ? tab.disciplinePath
                          ? 'Build & Edit'
                          : 'Choose a project to build'
                        : 'Search & Create'}
                    </h1>
                    <p className="text-sm text-text-secondary/80">
                      {isHarness
                        ? tab.disciplinePath
                          ? 'Describe the outcome. Harness will inspect, clarify material decisions, then implement and verify the work.'
                          : 'Harness is isolated to one project. Use + to choose the folder where it may work.'
                        : 'Prism session is ready. Type your request or choose a mode.'}
                    </p>
                  </div>

                  <div className="w-full flex flex-col gap-0">
                    {/* AI Todo & Artifacts panel docked above InputBar (landing state) */}
                    <TodoPanel
                      todo={todo}
                      artifacts={tab.artifacts}
                      terminalProcesses={terminalProcesses}
                    />
                    {/* Questionnaire wizard card docked above InputBar (landing state) */}
                    {activeQuestionnaire && (
                      <QuestionnaireWizard
                        toolCall={activeQuestionnaire.toolCall}
                        chatId={activeQuestionnaire.chatId}
                      />
                    )}
                    {renderMissingFolderBanner()}
                    <InputBar
                      ref={inputBarRef}
                      onSend={handleSendInputBar}
                      onCancel={onCancel}
                      isProcessing={tab.isProcessing}
                      isKeyMissing={isKeyMissing}
                      disabled={tab.isProcessing || isKeyMissing || !isOnline}
                      selectedModel={tab.selectedModel}
                      onModelChange={onModelChange}
                      reasoningLevel={
                        config?.modelReasoningLevels?.[tab.selectedModel] ||
                        config?.modelReasoningLevels?.[
                          tab.selectedModel.replace('prism_provider:', '')
                        ] ||
                        getDefaultThinkingLevelForModel(tab.selectedModel)
                      }
                      onReasoningLevelChange={(level) =>
                        onReasoningLevelChange(tab.selectedModel, level)
                      }
                      text={localInputText}
                      setText={handleSetTextInputBar}
                      quotedText={tab.quotedText}
                      onClearQuote={() => onUpdateTabQuote?.(tab.id, null)}
                      isSearchEnabled={tab.isSearchEnabled}
                      setIsSearchEnabled={(val) => onToggleSearch?.(val)}
                      isFullscreen={false}
                      onFullscreenToggle={() => {}}
                      attachedFile={tab.attachedFile}
                      onRemoveFile={() => onUpdateTabFile(tab.id, null)}
                      onAttachFile={(f) => onUpdateTabFile(tab.id, f)}
                      onOpenScreenshotModal={onOpenScreenshotModal}
                      onOpenYoutubeModal={onOpenYoutubeModal}
                      activeWorkflow={activeWorkflow}
                      setActiveWorkflow={setActiveWorkflow}
                      sessionMode={tab.sessionMode}
                      disciplinePath={tab.disciplinePath}
                      onModeChange={onModeChange}
                      onSelectFolder={onSelectFolder}
                      disabledSkills={tab.disabledSkills}
                      onDisabledSkillsChange={(skills) =>
                        onUpdateTabDisabledSkills?.(tab.id, skills)
                      }
                      harnessPermissionMode={harnessPermissionMode}
                      onHarnessPermissionModeChange={onHarnessPermissionModeChange}
                      onOpenUpgradePlans={onOpenUpgradePlans}
                      isEnterprise={isEnterprise}
                      harnessExplorerContext={isHarness ? tab.harnessExplorerContext || [] : undefined}
                      onAddHarnessExplorerContext={onAddHarnessExplorerContext}
                      onRemoveHarnessExplorerContext={onRemoveHarnessExplorerContext}
                    />
                    {renderProjectDropdown('bottom')}
                  </div>
                </div>
              </div>
            )}

            {/* Messages list when tab has messages */}
            {tab.messages.length > 0 && (
              <div
                className={clsx(
                  'w-full flex-grow flex flex-col pb-[27.5vh]',
                  isHarness ? 'pt-16' : 'pt-4'
                )}
              >
                {renderMissingFolderBanner()}
                {renderedMessages}
              </div>
            )}
          </div>

          {/* Input Bar Overlay when tab has messages */}
          {tab.messages.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 pb-6 pt-12 z-20 pointer-events-none bg-[linear-gradient(to_top,rgba(0,0,0,0.45)_0%,rgba(0,0,0,0.15)_50%,transparent_100%)] px-4">
              {showScrollButton && (
                <div className="absolute left-0 right-0 -top-10 flex justify-center pointer-events-none z-20 animate-soft-pop">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      isAtBottomRef.current = true
                      scrollToBottom('smooth')
                      setShowScrollButton(false)
                    }}
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-black/60 text-text-primary shadow-[var(--glass-shadow-md)] backdrop-blur-xl transition-all duration-150 hover:bg-white/[0.1] active:scale-95 cursor-pointer"
                    title="Scroll to bottom"
                  >
                    <CaretDown size={14} />
                  </button>
                </div>
              )}

              <div className="pointer-events-auto max-w-[800px] mx-auto flex flex-col gap-0">
                {/* AI Todo & Artifacts panel docked above InputBar */}
                <TodoPanel
                  todo={todo}
                  artifacts={tab.artifacts}
                  terminalProcesses={terminalProcesses}
                />
                {/* Questionnaire wizard card docked above InputBar */}
                {activeQuestionnaire && (
                  <QuestionnaireWizard
                    toolCall={activeQuestionnaire.toolCall}
                    chatId={activeQuestionnaire.chatId}
                  />
                )}
                <InputBar
                  ref={inputBarRef}
                  onSend={handleSendInputBar}
                  onCancel={onCancel}
                  isProcessing={tab.isProcessing}
                  isKeyMissing={isKeyMissing}
                  disabled={tab.isProcessing || isKeyMissing || !isOnline}
                  selectedModel={tab.selectedModel}
                  onModelChange={onModelChange}
                  reasoningLevel={
                    config?.modelReasoningLevels?.[tab.selectedModel] ||
                    config?.modelReasoningLevels?.[
                      tab.selectedModel.replace('prism_provider:', '')
                    ] ||
                    getDefaultThinkingLevelForModel(tab.selectedModel)
                  }
                  onReasoningLevelChange={(level) =>
                    onReasoningLevelChange(tab.selectedModel, level)
                  }
                  text={localInputText}
                  setText={handleSetTextInputBar}
                  quotedText={tab.quotedText}
                  onClearQuote={() => onUpdateTabQuote?.(tab.id, null)}
                  isSearchEnabled={tab.isSearchEnabled}
                  setIsSearchEnabled={(val) => onToggleSearch?.(val)}
                  isFullscreen={false}
                  onFullscreenToggle={() => {}}
                  attachedFile={tab.attachedFile}
                  onRemoveFile={() => onUpdateTabFile(tab.id, null)}
                  onAttachFile={(f) => onUpdateTabFile(tab.id, f)}
                  onOpenScreenshotModal={onOpenScreenshotModal}
                  onOpenYoutubeModal={onOpenYoutubeModal}
                  activeWorkflow={activeWorkflow}
                  setActiveWorkflow={setActiveWorkflow}
                  sessionMode={tab.sessionMode}
                  disciplinePath={tab.disciplinePath}
                  onModeChange={onModeChange}
                  onSelectFolder={onSelectFolder}
                  disabledSkills={tab.disabledSkills}
                  onDisabledSkillsChange={(skills) => onUpdateTabDisabledSkills?.(tab.id, skills)}
                  harnessPermissionMode={harnessPermissionMode}
                  onHarnessPermissionModeChange={onHarnessPermissionModeChange}
                  onOpenUpgradePlans={onOpenUpgradePlans}
                  isEnterprise={isEnterprise}
                  harnessExplorerContext={isHarness ? tab.harnessExplorerContext || [] : undefined}
                  onAddHarnessExplorerContext={onAddHarnessExplorerContext}
                  onRemoveHarnessExplorerContext={onRemoveHarnessExplorerContext}
                />
                {renderProjectDropdown('top')}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
)
