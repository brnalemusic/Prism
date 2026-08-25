import React, { useState } from 'react'
import { CaretDown, Check, TerminalWindow, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { HarnessApprovalRequest } from '../../../shared/types'

export function HarnessApprovalDialog({
  request,
  onResolve
}: {
  request: HarnessApprovalRequest
  onResolve: (approved: boolean) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(request.items[0]?.callId || null)
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="harness-approval-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 id="harness-approval-title" className="text-sm font-semibold text-text-primary">
              Review Harness actions
            </h2>
            <p className="mt-1 truncate text-[11px] text-text-muted" title={request.projectPath}>
              {request.items.length} {request.items.length === 1 ? 'action' : 'actions'} in{' '}
              {request.projectPath.split(/[\\/]/).pop()}
            </p>
          </div>
          <TerminalWindow size={18} className="mt-0.5 text-accent-primary" />
        </header>

        <div className="max-h-[58vh] space-y-1 overflow-y-auto p-3 custom-scrollbar">
          {request.items.map((item, index) => {
            const isExpanded = expanded === item.callId
            return (
              <article key={item.callId} className="overflow-hidden rounded-xl bg-white/[0.025]">
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : item.callId)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/60"
                  aria-expanded={isExpanded}
                >
                  <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 text-xs font-medium text-text-secondary">
                    {item.label}
                  </span>
                  <code className="text-[10px] text-text-muted">{item.name}</code>
                  <CaretDown
                    size={12}
                    className={clsx(
                      'text-text-muted transition-transform',
                      isExpanded && 'rotate-180'
                    )}
                  />
                </button>
                {isExpanded && (
                  <div className="space-y-3 border-t border-white/[0.05] px-3.5 py-3">
                    <div>
                      <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">
                        Input
                      </span>
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/35 p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary custom-scrollbar">
                        {JSON.stringify(item.args, null, 2)}
                      </pre>
                    </div>
                    {item.preview && (
                      <div>
                        <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">
                          Proposed change
                        </span>
                        <pre className="max-h-64 overflow-auto whitespace-pre font-mono text-[10.5px] leading-relaxed text-text-secondary custom-scrollbar">
                          {item.preview}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-4 py-3.5">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="settings-secondary-button cursor-pointer"
          >
            <X size={13} />
            Decline
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className="settings-primary-button cursor-pointer"
          >
            <Check size={13} weight="bold" />
            Approve group
          </button>
        </footer>
      </section>
    </div>
  )
}
