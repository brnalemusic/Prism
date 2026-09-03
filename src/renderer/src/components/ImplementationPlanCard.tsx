import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  PaperPlaneRight,
  X
} from '@phosphor-icons/react'
import type { HarnessPhase } from '../../../shared/types'
import { StaticMarkdownComponents } from './AnimatedStreamingText'

interface ImplementationPlanCardProps {
  markdown: string
  phase: HarnessPhase
  isPreparing?: boolean
  busyLabel?: string
  error?: string | null
  onAcceptHere: () => void
  onAcceptNewChat: () => void
  onFeedback: (feedback: string) => void
  onCancel: () => void
}

export function ImplementationPlanCard({
  markdown,
  phase,
  isPreparing = false,
  busyLabel = 'Updating implementation plan…',
  error,
  onAcceptHere,
  onAcceptNewChat,
  onFeedback,
  onCancel
}: ImplementationPlanCardProps): React.JSX.Element {
  const [feedback, setFeedback] = useState('')
  const isPlan = phase === 'plan'

  return (
    <section
      className="liquid-glass-docked relative max-h-[58vh] overflow-hidden rounded-t-2xl border border-white/[0.1] bg-black/70 shadow-[0_-18px_60px_rgba(0,0,0,0.42)]"
      aria-label="Implementation Plan"
    >
      <header className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary">
            {isPreparing ? (
              <CircleNotch size={15} className="animate-spin" />
            ) : (
              <CheckCircle size={15} weight="fill" />
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-text-primary">Implementation Plan</h3>
            <p className="mt-0.5 text-[10px] text-text-muted">
              {isPreparing
                ? busyLabel
                : isPlan
                  ? 'Review the plan before implementation begins.'
                  : 'Approved for implementation in this session.'}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          {isPlan ? 'Plan' : 'Approved'}
        </span>
      </header>

      <div className="max-h-[32vh] overflow-y-auto px-5 py-4 text-[12.5px] leading-relaxed text-text-secondary select-text">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={StaticMarkdownComponents}
        >
          {markdown}
        </ReactMarkdown>
      </div>

      {error && (
        <p className="mx-5 mb-3 rounded-lg border border-status-error/20 bg-status-error/[0.06] px-3 py-2 text-[11px] text-status-error">
          {error}
        </p>
      )}

      {isPlan && (
        <footer className="border-t border-white/[0.07] bg-black/25 px-4 py-3">
          <div className="mb-2 flex gap-2">
            <textarea
              rows={2}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={isPreparing}
              placeholder="Describe what should change in this plan…"
              className="min-h-16 flex-1 resize-none rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent-primary/60 focus:ring-1 focus:ring-accent-primary/30 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={isPreparing || !feedback.trim()}
              onClick={() => {
                const value = feedback.trim()
                if (!value) return
                onFeedback(value)
                setFeedback('')
              }}
              className="flex w-10 items-center justify-center rounded-xl border border-accent-primary/25 bg-accent-primary/10 text-accent-primary transition-colors hover:bg-accent-primary/20 disabled:pointer-events-none disabled:opacity-35"
              title="Send feedback"
              aria-label="Send feedback"
            >
              <PaperPlaneRight size={15} weight="fill" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="mr-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-primary"
            >
              <X size={12} weight="bold" />
              Cancel
            </button>
            <button
              type="button"
              disabled={isPreparing}
              onClick={onAcceptHere}
              className="rounded-xl border border-white/[0.11] bg-white/[0.045] px-3.5 py-2 text-[11px] font-semibold text-text-primary transition-colors hover:bg-white/[0.09] disabled:opacity-40"
            >
              Accept &amp; Continue Here
            </button>
            <button
              type="button"
              disabled={isPreparing}
              onClick={onAcceptNewChat}
              className="flex items-center gap-1.5 rounded-xl border border-accent-primary/30 bg-accent-primary/15 px-3.5 py-2 text-[11px] font-semibold text-accent-primary transition-colors hover:bg-accent-primary/25 disabled:opacity-40"
            >
              Accept &amp; Continue in New Chat
              <ArrowRight size={12} weight="bold" />
            </button>
          </div>
        </footer>
      )}
    </section>
  )
}
