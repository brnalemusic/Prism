import React, { useState } from 'react'
import clsx from 'clsx'
import {
  ListChecks,
  Circle,
  CircleNotch,
  CheckCircle,
  CaretDown,
  FilePdf,
  FilePpt,
  FolderOpen,
  ArrowSquareOut
} from '@phosphor-icons/react'
import type { TodoState, ArtifactItem } from '../../../shared/types'

interface TodoPanelProps {
  todo?: TodoState | null
  artifacts?: ArtifactItem[]
  selectedArtifactId?: string | null
  onSelectArtifact?: (id: string | null) => void
}

function TodoPanel({
  todo,
  artifacts = [],
  onSelectArtifact
}: TodoPanelProps): React.ReactElement | null {
  const hasTodo = !!(todo && todo.tasks.length > 0)
  const hasArtifacts = artifacts.length > 0

  if (!hasTodo && !hasArtifacts) return null

  const [activeTab, setActiveTab] = useState<'todo' | 'artifacts'>(() => {
    if (!hasTodo && hasArtifacts) return 'artifacts'
    return 'todo'
  })

  const [isExpanded, setIsExpanded] = useState(false)

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

  const handleOpenFile = (pathStr: string) => {
    if (window.api?.openArtifactFile) {
      window.api.openArtifactFile(pathStr)
    }
  }

  const handleOpenFolder = (pathStr: string) => {
    if (window.api?.showArtifactInFolder) {
      window.api.showArtifactInFolder(pathStr)
    }
  }

  const statusIcon = (status: string, index: number) => {
    switch (status) {
      case 'done':
        return <CheckCircle key={index} size={14} className="shrink-0 text-status-success" weight="fill" />
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
    <div className="w-[70%] mx-auto relative select-none animate-fade-in z-20 transition-all duration-300">
      {/* Attached Card Docked Above InputBar */}
      <div className="relative overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-white/[0.08] bg-background-secondary/95 backdrop-blur-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.45)]">
        {/* Background accent glow */}
        <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-accent-primary/8 blur-[60px] pointer-events-none" />

        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.05] bg-white/[0.015]">
          {/* Left Title / Summary (Clicking header toggles expanded dropdown) */}
          <div
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group"
            title={isExpanded ? 'Click to collapse panel' : 'Click to expand panel'}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary shrink-0">
              {activeTab === 'todo' ? (
                workingTask ? (
                  <CircleNotch size={15} className="animate-spin text-accent-primary" weight="bold" />
                ) : lastDoneTask ? (
                  <CheckCircle size={15} className="text-status-success" weight="fill" />
                ) : (
                  <ListChecks size={15} className="text-accent-primary" weight="bold" />
                )
              ) : (
                <FilePdf size={15} className="text-red-400" weight="bold" />
              )}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-primary tracking-wide">
                  {activeTab === 'todo' ? 'AI Tasks' : 'Artifacts'}
                </span>
                <span className="text-[10px] text-text-muted bg-white/[0.06] px-1.5 py-0.5 rounded-md font-mono">
                  {activeTab === 'todo' ? `${doneCount}/${totalTasks}` : artifacts.length}
                </span>
              </div>

              {!isExpanded && (
                <p className="text-xs text-text-secondary truncate mt-0.5 font-medium leading-tight">
                  {activeTab === 'todo'
                    ? compactText
                    : latestArtifact
                      ? `Latest: ${latestArtifact.filename} (#${latestArtifact.id})`
                      : 'No artifacts generated'}
                </p>
              )}
            </div>
          </div>

          {/* Right Controls: Tab Switcher & Collapse Caret */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Tab Selector Buttons — Switching tabs DOES NOT force expand the panel */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.06]">
              {hasTodo && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveTab('todo')
                  }}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer',
                    activeTab === 'todo'
                      ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30 shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  <ListChecks size={13} weight="bold" />
                  <span>To-Do List</span>
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
                    'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer',
                    activeTab === 'artifacts'
                      ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30 shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  <FilePdf size={13} weight="bold" />
                  <span>Artifacts</span>
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
        {isExpanded && (
          <div className="flex flex-col border-t border-white/[0.05] animate-fade-in">
            {/* TO-DO TAB CONTENT */}
            {activeTab === 'todo' && hasTodo && (
              <div className="flex flex-col">
                {/* Full progress bar */}
                <div className="w-full h-1 bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
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
                          ? 'border-accent-primary/30 bg-accent-primary/[0.06] text-text-primary font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]'
                          : task.status === 'done'
                            ? 'border-transparent opacity-60 text-text-muted'
                            : 'border-white/[0.04] bg-white/[0.01] text-text-secondary hover:bg-white/[0.03]'
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
            {activeTab === 'artifacts' && hasArtifacts && (
              <div className="flex flex-col p-4">
                <div className="flex flex-col gap-2 max-h-[35vh] overflow-y-auto no-scrollbar">
                  {artifacts.map((art) => (
                    <div
                      key={art.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04] transition-all group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                        <div
                          className={clsx(
                            'flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                            art.type === 'pptx' ? 'bg-orange-500/15 text-orange-400' : 'bg-red-500/15 text-red-400'
                          )}
                        >
                          {art.type === 'pptx' ? <FilePpt size={16} weight="bold" /> : <FilePdf size={16} weight="bold" />}
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
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(TodoPanel)
