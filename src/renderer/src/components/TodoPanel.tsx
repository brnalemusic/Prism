import React from 'react'
import clsx from 'clsx'
import { ListChecks, Circle, CircleNotch, CheckCircle, CaretRight, X } from '@phosphor-icons/react'
import type { TodoState } from '../../../shared/types'

interface TodoPanelProps {
  todo: TodoState | null
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}

function TodoPanel({ todo, isOpen, onToggle, onClose }: TodoPanelProps): React.ReactElement | null {
  if (!todo || !todo.active) return null

  const total = todo.tasks.length
  const doneCount = todo.tasks.filter((t) => t.status === 'done').length
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const statusIcon = (status: string, index: number) => {
    switch (status) {
      case 'done':
        return <CheckCircle key={index} size={14} className="shrink-0 text-status-success" weight="fill" />
      case 'working':
        return (
          <CircleNotch
            key={index}
            size={14}
            className="shrink-0 text-accent-primary animate-spin-slow"
            weight="bold"
          />
        )
      default:
        return <Circle key={index} size={14} className="shrink-0 text-text-muted/60" />
    }
  }

  const statusDot = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-status-success'
      case 'working':
        return 'bg-accent-primary animate-pulse'
      default:
        return 'bg-text-muted/30'
    }
  }

  return (
    <>
      {/* Toggle button (appears when panel is closed and todo is active) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-30 flex h-16 w-6 items-center justify-center rounded-l-xl border border-r-0 border-white/[0.05] bg-white/[0.02] text-text-secondary shadow-lg backdrop-blur-md transition-all duration-300 hover:w-8 hover:bg-white/[0.05] hover:text-text-primary group todo-toggle-btn"
          title="Show Todo List"
        >
          <div className="relative flex items-center justify-center">
            <ListChecks size={13} className="group-hover:scale-110 transition-transform" />
            {todo.tasks.some((t) => t.status === 'working') && (
              <span className="absolute -top-1 -right-2 h-2 w-2 rounded-full bg-accent-primary animate-pulse" />
            )}
          </div>
        </button>
      )}

      {/* Panel */}
      <div
        className={clsx(
          'fixed right-0 top-0 h-full z-30 flex flex-col transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: '280px' }}
      >
        {/* Backdrop overlay when panel is open */}
        {isOpen && (
          <div
            className="absolute inset-0 -left-[100vw] bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
        )}

        {/* Panel content */}
        <div className="relative ml-auto h-full w-full bg-background-secondary/95 backdrop-blur-xl border-l border-white/[0.06] shadow-2xl flex flex-col todo-panel">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-white/[0.05]">
            <div className="flex items-center gap-2.5">
              <ListChecks size={15} className="text-accent-primary" weight="bold" />
              <span className="text-[12.5px] font-semibold text-text-primary tracking-tight">Todo</span>
              <span className="text-[10.5px] font-medium text-text-muted/70 tabular-nums">
                {doneCount}/{total}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onToggle}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-all duration-200 active:scale-95"
                title="Collapse"
              >
                <CaretRight size={13} />
              </button>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-all duration-200 active:scale-95"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="shrink-0 px-4 pt-3 pb-2">
            <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-primary transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5 todo-scroll">
            {todo.tasks.map((task, i) => (
              <div
                key={task.id}
                className={clsx(
                  'group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-all duration-200',
                  task.status === 'working' && 'bg-accent-primary/[0.06] border border-accent-primary/[0.1]',
                  task.status === 'done' && 'opacity-60',
                  task.status === 'pending' && 'hover:bg-white/[0.02]'
                )}
              >
                <div className="flex items-center justify-center w-4 h-5 shrink-0 mt-0.5">
                  {statusIcon(task.status, i)}
                </div>
                <span
                  className={clsx(
                    'text-[12.5px] leading-relaxed select-text transition-all duration-200',
                    task.status === 'done'
                      ? 'line-through text-text-muted/50'
                      : task.status === 'working'
                        ? 'text-text-primary font-medium'
                        : 'text-text-secondary/80'
                  )}
                >
                  {task.title}
                </span>
              </div>
            ))}
          </div>

          {/* Footer with status */}
          <div className="shrink-0 px-4 py-2.5 border-t border-white/[0.05] flex items-center gap-2">
            <div className={clsx('h-1.5 w-1.5 rounded-full', statusDot(todo.tasks.find(t => t.status === 'working')?.status || todo.tasks[0]?.status || 'pending'))} />
            <span className="text-[10px] font-medium text-text-muted/60 tracking-wide uppercase">
              {doneCount === total
                ? 'All complete'
                : `${total - doneCount} remaining`}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

export default React.memo(TodoPanel)
