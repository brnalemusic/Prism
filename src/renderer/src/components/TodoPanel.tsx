import React from 'react'
import clsx from 'clsx'
import { ListChecks, Circle, CircleNotch, CheckCircle, SidebarSimple } from '@phosphor-icons/react'
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
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex h-16 w-6 items-center justify-center rounded-l-xl border border-r-0 border-white/[0.05] bg-white/[0.02] text-text-secondary shadow-lg backdrop-blur-md transition-all duration-300 hover:w-8 hover:bg-white/[0.05] hover:text-text-primary group todo-toggle-btn cursor-pointer"
          title="Open Todo List"
        >
          <div className="relative flex items-center justify-center">
            <ListChecks size={14} className="group-hover:scale-110 transition-transform text-text-muted group-hover:text-text-secondary" />
            {todo.tasks.some((t) => t.status === 'working') && (
              <span className="absolute -top-1.5 -right-1.5 h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
            )}
          </div>
        </button>
      )}

      {/* Right Sidebar */}
      <aside
        className={clsx(
          'relative h-full flex flex-col border-l border-white/[0.055] bg-background-main/95 shadow-[-18px_0_46px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden',
          isOpen ? 'w-[272px] opacity-100' : 'w-0 opacity-0 pointer-events-none border-l-0'
        )}
      >
        {/* Header - aligns with left sidebar header */}
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] select-none">
              <ListChecks size={15} className="text-accent-primary" weight="bold" />
            </div>
            <h1 className="text-base font-semibold text-text-primary tracking-wide">Todo</h1>
            <span className="text-[10px] text-text-muted bg-white/[0.04] px-1.5 py-0.5 rounded-md font-mono">
              {doneCount}/{total}
            </span>
          </div>
          {isOpen && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary hover:bg-white/[0.05] hover:text-text-primary transition-all duration-200 active:scale-95 cursor-pointer"
              title="Collapse sidebar"
            >
              <SidebarSimple size={18} weight="bold" className="scale-x-[-1]" />
            </button>
          )}
        </div>

        {/* Task list with visual identity matching left sidebar items */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5 todo-scroll">
          {todo.tasks.map((task, i) => (
            <div
              key={task.id}
              className={clsx(
                'group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200',
                task.status === 'working'
                  ? 'border-accent-primary/20 bg-accent-primary/[0.04] text-text-primary font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]'
                  : task.status === 'done'
                    ? 'border-transparent opacity-50 hover:opacity-75'
                    : 'border-transparent hover:bg-white/[0.025] text-text-secondary hover:text-text-primary'
              )}
            >
              <div className="flex items-center justify-center w-4 h-5 shrink-0 mt-0.5">
                {statusIcon(task.status, i)}
              </div>
              <span
                className={clsx(
                  'text-[13px] leading-relaxed select-text transition-all duration-200',
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

        {/* Footer with progress - matches height, borders and styling of left sidebar footer */}
        <div className="mt-auto p-4 shrink-0 border-t border-white/[0.04] bg-background-main/30 backdrop-blur-md flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-semibold text-text-secondary/80 px-1">
            <div className="flex items-center gap-1.5">
              <div className={clsx('h-1.5 w-1.5 rounded-full', statusDot(todo.tasks.find(t => t.status === 'working')?.status || todo.tasks[0]?.status || 'pending'))} />
              <span className="tracking-wide uppercase text-[9px] font-bold text-text-muted">
                {doneCount === total ? 'All Complete' : `${total - doneCount} Remaining`}
              </span>
            </div>
            <span className="text-[10px] font-mono text-text-muted">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </aside>
    </>
  )
}

export default React.memo(TodoPanel)
