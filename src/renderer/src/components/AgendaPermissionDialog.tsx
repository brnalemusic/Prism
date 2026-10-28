import React, { useEffect, useMemo, useState } from 'react'
import {
  CalendarPlus,
  Check,
  Lightning,
  Plug,
  ShieldCheck,
  TerminalWindow,
  Warning,
  X
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type {
  AgendaPermissionChoice,
  AgendaPermissionKind,
  AgendaPermissionRequest
} from '../../../shared/agendaTypes'

const KIND_META: Record<
  AgendaPermissionKind,
  { label: string; icon: React.ReactNode; accent: string }
> = {
  terminal: {
    label: 'Terminal command',
    icon: <TerminalWindow size={14} />,
    accent: 'text-accent-primary'
  },
  mcp_tool: {
    label: 'MCP tool',
    icon: <Plug size={14} />,
    accent: 'text-accent-primary'
  },
  mcp_install: {
    label: 'MCP install',
    icon: <Plug size={14} weight="bold" />,
    accent: 'text-amber-300'
  },
  schedule_create: {
    label: 'Scheduled task',
    icon: <CalendarPlus size={14} />,
    accent: 'text-accent-primary'
  }
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Blocking prompt shown whenever an Agenda action needs the user's approval
 * while Prism runs in Safe mode. The action stays paused until this closes.
 */
export function AgendaPermissionDialog({
  request,
  onResolve
}: {
  request: AgendaPermissionRequest
  onResolve: (choice: AgendaPermissionChoice) => void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const meta = KIND_META[request.kind] ?? KIND_META.terminal
  const remaining = useMemo(() => formatRemaining(request.expiresAt - now), [request.expiresAt, now])

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-permission-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  meta.accent
                )}
              >
                {meta.icon}
                {meta.label}
              </span>
              {request.taskTitle && (
                <span className="truncate text-[10px] text-text-muted">{request.taskTitle}</span>
              )}
            </div>
            <h2
              id="agenda-permission-title"
              className="mt-2 text-sm font-semibold text-text-primary"
            >
              {request.title}
            </h2>
            <p className="mt-1 break-words text-[11px] leading-relaxed text-text-secondary">
              {request.summary}
            </p>
          </div>
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent-primary" />
        </header>

        {request.detail && (
          <div className="max-h-[40vh] overflow-auto border-b border-white/[0.05] px-4 py-3 custom-scrollbar">
            <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">Details</span>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/35 p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary">
              {request.detail}
            </pre>
          </div>
        )}

        <div className="flex items-center gap-2 border-b border-white/[0.05] px-5 py-2.5 text-[10px] text-text-muted">
          <Warning size={12} className="text-amber-300" />
          Agenda has full access to this computer. Approve only what you understand.
          <span className="ml-auto font-mono tabular-nums">{remaining}</span>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 px-4 py-3.5">
          <button
            type="button"
            onClick={() => onResolve('yolo')}
            className="mr-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-amber-300/90 transition-colors hover:bg-amber-300/10"
          >
            <Lightning size={12} weight="fill" />
            Switch to YOLO
          </button>
          <button
            type="button"
            onClick={() => onResolve('stop')}
            className="settings-secondary-button cursor-pointer"
          >
            <X size={13} />
            Stop
          </button>
          <button
            type="button"
            onClick={() => onResolve('continue')}
            className="settings-primary-button cursor-pointer"
          >
            <Check size={13} weight="bold" />
            Continue
          </button>
        </footer>
      </section>
    </div>
  )
}
