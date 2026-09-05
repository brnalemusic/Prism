import React from 'react'
import { Brain, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import type { MemoryReviewStatus } from '../../../shared/memoryCore'

export function MemoryReviewActivity({
  status,
  className = ''
}: {
  status: MemoryReviewStatus | null
  className?: string
}): React.JSX.Element | null {
  if (!status) return null

  const active = status.state === 'started' || status.state === 'progress'
  const failed = status.state === 'failed'
  const label = active
    ? 'Updating memory…'
    : failed
      ? 'Memory update will retry'
      : 'Memory updated'
  const detail = active
    ? `${status.chatsProcessed}/${status.chatsTotal} chats`
    : failed
      ? status.error || 'The next scheduled review will retry.'
      : `${status.memoriesSaved} ${status.memoriesSaved === 1 ? 'memory' : 'memories'} saved`

  return (
    <div
      role="status"
      aria-live="polite"
      className={`memory-review-activity pointer-events-none flex max-w-[330px] items-center gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-lowest)] px-3 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.36)] ${className}`}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10">
        {active ? (
          <Brain size={15} weight="duotone" className="memory-review-brain text-accent-primary" />
        ) : failed ? (
          <WarningCircle size={15} weight="fill" className="text-status-warning" />
        ) : (
          <CheckCircle size={15} weight="fill" className="text-status-success" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={active ? 'memory-review-shimmer-text text-xs font-semibold' : 'text-xs font-semibold text-text-primary'}>
          {label}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] text-text-muted">{detail}</div>
      </div>
    </div>
  )
}
