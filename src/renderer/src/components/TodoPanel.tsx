import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import {
  dockRise,
  staggerChild,
  staggerParent,
  tabContent,
  terminalSuccessPop,
  TERMINAL_ERROR_SHAKE
} from '../motion/presets'
import {
  ListChecks,
  Circle,
  CircleNotch,
  CheckCircle,
  CaretDown,
  FilePdf,
  FilePpt,
  FolderOpen,
  ArrowSquareOut,
  Terminal,
  XCircle
} from '@phosphor-icons/react'
import type { TodoState, ArtifactItem, TerminalProcessSnapshot } from '../../../shared/types'

interface TodoPanelProps {
  todo?: TodoState | null
  artifacts?: ArtifactItem[]
  terminalProcesses?: TerminalProcessSnapshot[]
}

type PanelTab = 'todo' | 'artifacts' | 'terminal'

// Finished terminal rows linger briefly with a success/error treatment,
// then animate out instead of staying forever. Running rows and rows
// waiting for input are never auto-dismissed.
const TERMINAL_DISMISS_MS = 2000

function isTerminallyFinished(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

function TodoPanel({
  todo,
  artifacts = [],
  terminalProcesses = []
}: TodoPanelProps): React.ReactElement | null {
  const [dismissedRunIds, setDismissedRunIds] = useState<ReadonlySet<string>>(new Set())
  const [resolvingRunIds, setResolvingRunIds] = useState<ReadonlySet<string>>(new Set())
  const dismissTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const visibleTerminalProcesses = useMemo(
    () => terminalProcesses.filter((process) => !dismissedRunIds.has(process.runId)),
    [terminalProcesses, dismissedRunIds]
  )

  // Schedule the 2s resolve-then-dismiss cycle for newly finished rows.
  useEffect(() => {
    for (const process of terminalProcesses) {
      if (dismissedRunIds.has(process.runId) || resolvingRunIds.has(process.runId)) continue
      if (process.awaitingInput || process.status === 'running') continue
      if (!isTerminallyFinished(process.status)) continue
      setResolvingRunIds((prev) => {
        if (prev.has(process.runId)) return prev
        const next = new Set(prev)
        next.add(process.runId)
        return next
      })
      const timer = setTimeout(() => {
        dismissTimers.current.delete(process.runId)
        setDismissedRunIds((prev) => {
          if (prev.has(process.runId)) return prev
          const next = new Set(prev)
          next.add(process.runId)
          return next
        })
      }, TERMINAL_DISMISS_MS)
      dismissTimers.current.set(process.runId, timer)
    }
    return () => {
      for (const [runId, timer] of dismissTimers.current) {
        const stillPresent = terminalProcesses.some((p) => p.runId === runId)
        if (!stillPresent) {
          clearTimeout(timer)
          dismissTimers.current.delete(runId)
        }
      }
    }
  }, [terminalProcesses, dismissedRunIds, resolvingRunIds])

  useEffect(() => {
    const timers = dismissTimers.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const hasTodo = !!(todo && todo.tasks.length > 0)
  const hasArtifacts = artifacts.length > 0
  const hasTerminal = visibleTerminalProcesses.length > 0

  const [activeTab, setActiveTab] = useState<PanelTab>(() => {
    if (!hasTodo && hasArtifacts) return 'artifacts'
    if (!hasTodo && !hasArtifacts && hasTerminal) return 'terminal'
    return 'todo'
  })
  const [isExpanded, setIsExpanded] = useState(false)
  const latestTerminal = visibleTerminalProcesses[visibleTerminalProcesses.length - 1]

  const hasPanel = hasTodo || hasArtifacts || hasTerminal

  const displayedTab: PanelTab =
    (activeTab === 'todo' && hasTodo) ||
    (activeTab === 'artifacts' && hasArtifacts) ||
    (activeTab === 'terminal' && hasTerminal)
      ? activeTab
      : hasTodo
        ? 'todo'
        : hasArtifacts
          ? 'artifacts'
          : 'terminal'

  // Todo progress stats
  const totalTasks = todo?.tasks.length || 0
  const doneCount = todo?.tasks.filter((t) => t.status === 'done').length || 0
  const progress = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0

  const workingTask = todo?.tasks.find((t) => t.status === 'working')
  const doneTasks = todo?.tasks.filter((t) => t.status === 'done') || []
  const lastDoneTask = doneTasks.length > 0 ? doneTasks[doneTasks.length - 1] : null

  const compactText = workingTask
    ? workingTask.title
    : lastDoneTask
      ? lastDoneTask.title
      : 'AI has started a to-do list'

  const latestArtifact = artifacts.length > 0 ? artifacts[artifacts.length - 1] : null
  const activeTerminalCount = visibleTerminalProcesses.filter(
    (process) => process.status === 'running'
  ).length
  const waitingTerminalCount = visibleTerminalProcesses.filter(
    (process) => process.awaitingInput
  ).length

  const terminalStatusLabel = (process: TerminalProcessSnapshot): string => {
    if (process.awaitingInput) return 'Waiting for input'
    if (process.status === 'completed') return 'Completed'
    if (process.status === 'failed') return 'Failed'
    if (process.status === 'killed') return 'Stopped'
    return 'Running'
  }
  const panelTitle =
    displayedTab === 'todo' ? 'AI Tasks' : displayedTab === 'artifacts' ? 'Artifacts' : 'Terminal'
  const panelCount =
    displayedTab === 'todo'
      ? `${doneCount}/${totalTasks}`
      : displayedTab === 'artifacts'
        ? artifacts.length.toString()
        : waitingTerminalCount > 0
          ? `${waitingTerminalCount} waiting`
          : activeTerminalCount > 0
            ? `${activeTerminalCount} active`
            : visibleTerminalProcesses.length.toString()
  const panelCompactText =
    displayedTab === 'todo'
      ? compactText
      : displayedTab === 'artifacts'
        ? latestArtifact
          ? `Latest: ${latestArtifact.filename} (#${latestArtifact.id})`
          : 'No artifacts generated'
        : latestTerminal
          ? `${terminalStatusLabel(latestTerminal)} · ${latestTerminal.command}`
          : 'No background terminal commands'

  const handleOpenFile = (pathStr: string): void => {
    if (window.api?.openArtifactFile) {
      window.api.openArtifactFile(pathStr)
    }
  }

  const handleOpenFolder = (pathStr: string): void => {
    if (window.api?.showArtifactInFolder) {
      window.api.showArtifactInFolder(pathStr)
    }
  }

  const statusIcon = (status: string, index: number): React.ReactNode => {
    switch (status) {
      case 'done':
        return (
          <CheckCircle
            key={index}
            size={14}
            className="shrink-0 text-status-success"
            weight="fill"
          />
        )
      case 'working':
        return (
          <CircleNotch
            key={index}
            size={14}
            className="shrink-0 text-accent-primary animate-spin"
            weight="bold"
          />
        )
      default:
        return <Circle key={index} size={14} className="shrink-0 text-text-muted/60" />
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>
        {hasPanel && (
          <motion.div
            key="todo-panel"
            variants={dockRise}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="w-[70%] mx-auto relative select-none z-20 gpu-composed"
          >
            {/* Attached Card Docked Above InputBar */}
            <div className="liquid-glass-docked relative overflow-hidden rounded-t-2xl rounded-b-none">
        {/* Subtle internal theme center glow */}
        <div className="absolute inset-0 rounded-t-2xl overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 rounded-full blur-[36px] opacity-18 transition-all duration-300 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, var(--accent-primary) 0%, transparent 70%)'
            }}
          />
        </div>

        {/* Header Bar */}
        <div className="relative z-10 flex items-center justify-between px-5 py-2.5 border-b border-white/[0.08] bg-white/[0.02]">
          {/* Left Title / Summary (Clicking header toggles expanded dropdown) */}
          <div
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group"
            title={isExpanded ? 'Click to collapse panel' : 'Click to expand panel'}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary shrink-0">
              {displayedTab === 'todo' ? (
                workingTask ? (
                  <CircleNotch
                    size={15}
                    className="animate-spin text-accent-primary"
                    weight="bold"
                  />
                ) : lastDoneTask ? (
                  <CheckCircle size={15} className="text-status-success" weight="fill" />
                ) : (
                  <ListChecks size={15} className="text-accent-primary" weight="bold" />
                )
              ) : displayedTab === 'artifacts' ? (
                <FilePdf size={15} className="text-red-400" weight="bold" />
              ) : latestTerminal?.awaitingInput ? (
                <Terminal size={15} className="text-status-warning" weight="bold" />
              ) : latestTerminal?.status === 'failed' ? (
                <XCircle size={15} className="text-status-error" weight="fill" />
              ) : latestTerminal?.status === 'completed' ? (
                <CheckCircle size={15} className="text-status-success" weight="fill" />
              ) : (
                <CircleNotch size={15} className="animate-spin text-accent-primary" weight="bold" />
              )}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-primary tracking-wide">
                  {panelTitle}
                </span>
                <span className="text-[10px] text-text-muted bg-white/[0.06] px-1.5 py-0.5 rounded-md font-mono">
                  {panelCount}
                </span>
              </div>

              {!isExpanded && (
                <p className="text-xs text-text-secondary truncate mt-0.5 font-medium leading-tight">
                  {panelCompactText}
                </p>
              )}
            </div>
          </div>

          {/* Right Controls: Tab Switcher & Collapse Caret */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Tab Selector Buttons — Switching tabs DOES NOT force expand the panel */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
              {hasTodo && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveTab('todo')
                  }}
                  className={clsx(
                    'relative flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer',
                    displayedTab === 'todo'
                      ? 'text-accent-primary'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  {displayedTab === 'todo' && (
                    <motion.span
                      layoutId="todo-panel-tab-pill"
                      transition={{ type: 'spring', stiffness: 550, damping: 40 }}
                      className="absolute inset-0 rounded-md bg-accent-primary/20 border border-accent-primary/30 shadow-sm"
                    />
                  )}
                  <ListChecks size={13} weight="bold" className="relative" />
                  <span className="relative">To-Do List</span>
                </button>
              )}

              {hasArtifacts && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveTab('artifacts')
                  }}
                  className={clsx(
                    'relative flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer',
                    displayedTab === 'artifacts'
                      ? 'text-accent-primary'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  {displayedTab === 'artifacts' && (
                    <motion.span
                      layoutId="todo-panel-tab-pill"
                      transition={{ type: 'spring', stiffness: 550, damping: 40 }}
                      className="absolute inset-0 rounded-md bg-accent-primary/20 border border-accent-primary/30 shadow-sm"
                    />
                  )}
                  <FilePdf size={13} weight="bold" className="relative" />
                  <span className="relative">Artifacts</span>
                </button>
              )}

              {hasTerminal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveTab('terminal')
                  }}
                  className={clsx(
                    'relative flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer',
                    displayedTab === 'terminal'
                      ? 'text-accent-primary'
                      : waitingTerminalCount > 0
                        ? 'text-status-warning hover:text-text-primary'
                        : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  {displayedTab === 'terminal' && (
                    <motion.span
                      layoutId="todo-panel-tab-pill"
                      transition={{ type: 'spring', stiffness: 550, damping: 40 }}
                      className="absolute inset-0 rounded-md bg-accent-primary/20 border border-accent-primary/30 shadow-sm"
                    />
                  )}
                  <Terminal size={13} weight="bold" className="relative" />
                  <span className="relative">Terminal</span>
                </button>
              )}
            </div>

            {/* Expand / Collapse Caret */}
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <CaretDown
                size={15}
                className={clsx('transition-transform duration-200', isExpanded && 'rotate-180')}
              />
            </button>
          </div>
        </div>

        {/* Expanded View */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="todo-panel-expanded"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 flex flex-col border-t border-white/[0.06] overflow-hidden"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={displayedTab}
                  variants={tabContent}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
            {/* TO-DO TAB CONTENT */}
            {displayedTab === 'todo' && hasTodo && (
              <div className="flex flex-col">
                {/* Full progress bar */}
                <div className="w-full h-1 bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary"
                    initial={false}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                  />
                </div>

                {/* Task Items */}
                <div className="flex flex-col gap-1.5 p-4 max-h-[35vh] overflow-y-auto no-scrollbar">
                  {todo!.tasks.map((task, i) => (
                    <div
                      key={task.id}
                      className={clsx(
                        'flex items-center gap-3 rounded-xl border px-3.5 py-2 text-xs transition-all duration-200',
                        task.status === 'working'
                          ? 'border-accent-primary/35 bg-accent-primary/[0.12] text-text-primary font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : task.status === 'done'
                            ? 'border-white/[0.04] bg-white/[0.015] opacity-60 text-text-muted'
                            : 'border-white/[0.06] bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
                      )}
                    >
                      <div className="flex items-center justify-center w-4 h-4 shrink-0">
                        {statusIcon(task.status, i)}
                      </div>
                      <span
                        className={clsx(
                          'leading-relaxed select-text truncate',
                          task.status === 'done'
                            ? 'line-through text-text-muted/70'
                            : task.status === 'working'
                              ? 'text-text-primary font-medium'
                              : 'text-text-secondary'
                        )}
                      >
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ARTIFACTS TAB CONTENT */}
            {displayedTab === 'artifacts' && hasArtifacts && (
              <div className="flex flex-col p-4">
                <div className="flex flex-col gap-2 max-h-[35vh] overflow-y-auto no-scrollbar">
                  {artifacts.map((art) => (
                    <div
                      key={art.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] transition-all group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                        <div
                          className={clsx(
                            'flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                            art.type === 'pptx'
                              ? 'bg-orange-500/15 text-orange-400'
                              : 'bg-red-500/15 text-red-400'
                          )}
                        >
                          {art.type === 'pptx' ? (
                            <FilePpt size={16} weight="bold" />
                          ) : (
                            <FilePdf size={16} weight="bold" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-text-primary truncate">
                              {art.filename}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.08] text-accent-primary border border-white/[0.06]">
                              ID: #{art.id}
                            </span>
                          </div>
                          <span className="text-[11px] text-text-muted font-mono truncate">
                            {art.path}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenFile(art.path)}
                          className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer"
                          title={art.type === 'pptx' ? 'Open Presentation' : 'Open PDF'}
                        >
                          <ArrowSquareOut size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenFolder(art.path)}
                          className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer"
                          title="Show in Folder"
                        >
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TERMINAL TAB CONTENT */}
            {displayedTab === 'terminal' && hasTerminal && (
              <div className="flex flex-col p-4">
                <motion.div
                  variants={staggerParent}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-col gap-2 max-h-[35vh] overflow-y-auto no-scrollbar"
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {[...visibleTerminalProcesses].reverse().map((process) => {
                      const statusLabel = terminalStatusLabel(process)
                      const isFailed = process.status === 'failed' || process.status === 'killed'
                      const isResolving = resolvingRunIds.has(process.runId)
                      const showSuccess = isResolving && process.status === 'completed'
                      const showError = isResolving && isFailed
                      return (
                        <motion.div
                          key={process.runId}
                          variants={staggerChild}
                          exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.22 } }}
                          animate={
                            showError
                              ? { opacity: 1, scale: 1, y: 0, ...TERMINAL_ERROR_SHAKE }
                              : undefined
                          }
                          className={clsx(
                            'flex items-start gap-3 rounded-xl border px-3.5 py-3',
                            process.awaitingInput
                              ? 'border-status-warning/30 bg-status-warning/[0.08]'
                              : isFailed
                                ? 'border-status-error/25 bg-status-error/[0.08]'
                                : process.status === 'completed'
                                  ? 'border-status-success/20 bg-status-success/[0.06]'
                                  : 'border-accent-primary/30 bg-accent-primary/[0.08]'
                          )}
                        >
                        <div
                          className={clsx(
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                            process.awaitingInput
                              ? 'bg-status-warning/15 text-status-warning'
                              : isFailed
                                ? 'bg-status-error/15 text-status-error'
                                : process.status === 'completed'
                                  ? 'bg-status-success/15 text-status-success'
                                  : 'bg-accent-primary/15 text-accent-primary'
                          )}
                        >
                          {process.awaitingInput ? (
                            <Terminal size={14} weight="bold" />
                          ) : process.status === 'running' ? (
                            <CircleNotch size={14} className="animate-spin" weight="bold" />
                          ) : process.status === 'completed' ? (
                            showSuccess ? (
                              <motion.span
                                variants={terminalSuccessPop}
                                initial="hidden"
                                animate="visible"
                                className="flex"
                              >
                                <CheckCircle size={14} weight="fill" />
                              </motion.span>
                            ) : (
                              <CheckCircle size={14} weight="fill" />
                            )
                          ) : (
                            <XCircle size={14} weight="fill" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-text-primary select-text"
                              title={process.command}
                            >
                              {process.command}
                            </span>
                            <span
                              className={clsx(
                                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                                process.awaitingInput
                                  ? 'bg-status-warning/15 text-status-warning'
                                  : isFailed
                                    ? 'bg-status-error/15 text-status-error'
                                    : process.status === 'completed'
                                      ? 'bg-status-success/15 text-status-success'
                                      : 'bg-accent-primary/15 text-accent-primary'
                              )}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[10px] font-mono text-text-muted">
                            <span>Run ID: {process.runId}</span>
                            {process.exitCode !== null && (
                              <span>Exit code: {process.exitCode}</span>
                            )}
                          </div>

                          {process.awaitingInput && process.detectedPrompt && (
                            <p
                              className="truncate text-[11px] text-status-warning/90 select-text"
                              title={process.detectedPrompt}
                            >
                              Prompt: {process.detectedPrompt}
                            </p>
                          )}

                          {isResolving && !process.awaitingInput && (
                            <motion.p
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className={clsx(
                                'text-[10px] font-semibold',
                                process.status === 'completed'
                                  ? 'text-status-success'
                                  : 'text-status-error'
                              )}
                            >
                              {process.status === 'completed'
                                ? 'Confirmed — closing'
                                : 'Failed — closing'}
                            </motion.p>
                          )}
                        </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </motion.div>
              </div>
            )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
          </AnimatePresence>
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}

export default React.memo(TodoPanel)
