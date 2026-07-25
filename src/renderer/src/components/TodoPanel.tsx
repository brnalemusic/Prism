import React, { useState } from 'react'
import clsx from 'clsx'
import {
  ListChecks,
  Circle,
  CircleNotch,
  CheckCircle,
  CaretDown
} from '@phosphor-icons/react'
import type { TodoState } from '../../../shared/types'

interface TodoPanelProps {
  todo: TodoState | null
}

function TodoPanel({ todo }: TodoPanelProps): React.ReactElement | null {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!todo || !todo.active || todo.tasks.length === 0) return null

  const total = todo.tasks.length
  const doneCount = todo.tasks.filter((t) => t.status === 'done').length
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const workingTask = todo.tasks.find((t) => t.status === 'working')
  const doneTasks = todo.tasks.filter((t) => t.status === 'done')
  const lastDoneTask = doneTasks.length > 0 ? doneTasks[doneTasks.length - 1] : null

  // Compact Mode display text logic:
  // 1. Currently working task
  // 2. Or last completed task
  // 3. Fallback: "AI has started a to-do list"
  const compactText = workingTask
    ? workingTask.title
    : lastDoneTask
      ? lastDoneTask.title
      : 'AI has started a to-do list'

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
    <div className="w-[70%] mx-auto relative select-none animate-fade-in z-20">
      {/* Attached Card Docked Above InputBar */}
      <div className="relative overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-white/[0.08] bg-background-secondary/90 backdrop-blur-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.45)]">
        {/* Background accent glow */}
        <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-accent-primary/8 blur-[60px] pointer-events-none" />

        {/* Top Clickable Header Bar (Expands / Compacts on Click) */}
        <div
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center justify-between px-5 py-3 cursor-pointer group hover:bg-white/[0.025] transition-colors"
          title={isExpanded ? 'Click to collapse to-do list' : 'Click to expand full to-do list'}
        >
          {/* Left info area */}
          <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary shrink-0">
              {workingTask ? (
                <CircleNotch size={15} className="animate-spin text-accent-primary" weight="bold" />
              ) : lastDoneTask ? (
                <CheckCircle size={15} className="text-status-success" weight="fill" />
              ) : (
                <ListChecks size={15} className="text-accent-primary" weight="bold" />
              )}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-primary tracking-wide">
                  AI Tasks
                </span>
                <span className="text-[10px] text-text-muted bg-white/[0.06] px-1.5 py-0.5 rounded-md font-mono">
                  {doneCount}/{total}
                </span>
              </div>

              {/* Compact Mode Text (Always shown when collapsed, or as status line) */}
              {!isExpanded && (
                <p className="text-xs text-text-secondary truncate mt-0.5 font-medium leading-tight">
                  {compactText}
                </p>
              )}
            </div>
          </div>

          {/* Right progress indicator & expand toggle button */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Progress bar in header */}
            <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden hidden sm:block">
              <div
                className="h-full bg-accent-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-muted">{progress}%</span>
            <CaretDown
              size={14}
              className={clsx(
                'text-text-muted transition-transform duration-200 group-hover:text-text-primary',
                isExpanded && 'rotate-180'
              )}
            />
          </div>
        </div>

        {/* Expanded Mode: Full Task List & Details */}
        {isExpanded && (
          <div className="flex flex-col border-t border-white/[0.05] animate-fade-in">
            {/* Full progress bar */}
            <div className="w-full h-1 bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Task Items */}
            <div className="flex flex-col gap-1.5 p-4 max-h-[35vh] overflow-y-auto no-scrollbar">
              {todo.tasks.map((task, i) => (
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
      </div>
    </div>
  )
}

export default React.memo(TodoPanel)
