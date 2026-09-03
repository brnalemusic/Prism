import React, { useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { ArrowRight, CheckCircle, CircleNotch, PaperPlaneRight, X } from '@phosphor-icons/react'
import type { HarnessPhase } from '../../../shared/types'
import { StaticMarkdownComponents } from './AnimatedStreamingText'

interface ImplementationPlanCardProps {
  markdown?: string
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
  markdown = '',
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
  const [isApprovedPlanExpanded, setIsApprovedPlanExpanded] = useState(false)
  const isPlan = phase === 'plan'
  const hasPlan = Boolean(markdown.trim())
  const isLoading = isPreparing && !hasPlan
  const feedbackId = useId()

  const submitFeedback = (): void => {
    const value = feedback.trim()
    if (!value || isPreparing) return
    onFeedback(value)
    setFeedback('')
  }

  if (!isPlan) {
    return (
      <section
        className="implementation-plan-surface implementation-plan-surface--approved"
        aria-label="Approved Implementation Plan"
      >
        <header className="implementation-plan-surface__approved-header">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="implementation-plan-surface__status-icon">
              <CheckCircle size={15} weight="fill" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-text-primary">
                Implementation Plan approved
              </h3>
              <p className="mt-0.5 text-[10.5px] text-text-muted">
                This session is ready to continue in Build.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-expanded={isApprovedPlanExpanded}
            onClick={() => setIsApprovedPlanExpanded((expanded) => !expanded)}
            className="implementation-plan-surface__text-action"
          >
            {isApprovedPlanExpanded ? 'Hide plan' : 'View plan'}
          </button>
        </header>

        {isApprovedPlanExpanded && (
          <div className="implementation-plan-surface__body implementation-plan-surface__body--approved custom-scrollbar select-text">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={StaticMarkdownComponents}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      className="implementation-plan-surface"
      aria-label="Implementation Plan review"
      aria-busy={isPreparing}
    >
      <header className="implementation-plan-surface__header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="implementation-plan-surface__status-icon">
            {isPreparing ? (
              <CircleNotch size={16} className="motion-safe:animate-spin" />
            ) : (
              <CheckCircle size={16} weight="fill" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-text-primary">
              Implementation Plan
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
              {isPreparing ? busyLabel : 'Review the proposed work before implementation begins.'}
            </p>
          </div>
        </div>
        <span className="implementation-plan-surface__badge">
          {isPreparing ? 'Preparing' : 'Review'}
        </span>
      </header>

      <div className="implementation-plan-surface__body custom-scrollbar select-text">
        {isLoading ? (
          <div className="implementation-plan-surface__skeleton" aria-label={busyLabel}>
            <span className="implementation-plan-surface__skeleton-line w-[42%]" />
            <span className="implementation-plan-surface__skeleton-line w-full" />
            <span className="implementation-plan-surface__skeleton-line w-[88%]" />
            <span className="implementation-plan-surface__skeleton-line w-[68%]" />
            <span className="implementation-plan-surface__skeleton-block" />
            <span className="implementation-plan-surface__skeleton-line w-[76%]" />
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={StaticMarkdownComponents}
          >
            {markdown}
          </ReactMarkdown>
        )}
      </div>

      <footer className="implementation-plan-surface__footer">
        {error && (
          <p className="implementation-plan-surface__error" role="alert">
            {error}
          </p>
        )}

        <div className="implementation-plan-surface__feedback">
          <label htmlFor={feedbackId}>Request a revision</label>
          <div className="implementation-plan-surface__feedback-control">
            <textarea
              id={feedbackId}
              rows={2}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  submitFeedback()
                }
              }}
              disabled={isPreparing}
              placeholder="Describe what should change in this plan…"
              className="implementation-plan-surface__textarea"
            />
            <button
              type="button"
              disabled={isPreparing || !feedback.trim()}
              onClick={submitFeedback}
              className="implementation-plan-surface__feedback-submit"
              title="Request changes"
              aria-label="Request changes to the Implementation Plan"
            >
              <PaperPlaneRight size={15} weight="fill" />
              <span>Request changes</span>
            </button>
          </div>
          <p className="implementation-plan-surface__feedback-hint">
            Press Ctrl or Cmd + Enter to send.
          </p>
        </div>

        <div className="implementation-plan-surface__actions">
          <button type="button" onClick={onCancel} className="implementation-plan-surface__cancel">
            <X size={13} weight="bold" />
            Cancel
          </button>
          <div className="implementation-plan-surface__accept-actions">
            <button
              type="button"
              disabled={isPreparing || !hasPlan}
              onClick={onAcceptNewChat}
              className="implementation-plan-surface__secondary-action"
              aria-label="Accept plan and continue in a new Build chat"
            >
              New Build Chat
              <ArrowRight size={13} weight="bold" />
            </button>
            <button
              type="button"
              disabled={isPreparing || !hasPlan}
              onClick={onAcceptHere}
              className="implementation-plan-surface__primary-action"
              aria-label="Accept plan and continue in this chat"
            >
              <CheckCircle size={14} weight="fill" />
              Accept &amp; Continue
            </button>
          </div>
        </div>
      </footer>
    </section>
  )
}
