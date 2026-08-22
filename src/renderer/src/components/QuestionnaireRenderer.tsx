import React, { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Check,
  ClipboardText,
  CircleNotch,
  ArrowLeft,
  ArrowRight,
  CheckCircle
} from '@phosphor-icons/react'
import type { ToolCall } from './ActionLoader'

interface QuestionOption {
  value: string
  label: string
  allow_custom_input?: boolean
}

interface Question {
  id: string
  type: 'multiple-choice' | 'essay'
  title: string
  prompt: string
  options?: QuestionOption[]
  placeholder?: string
}

interface QuestionnaireRendererProps {
  toolCall: ToolCall
  chatId: string
}

// --------------------------------------------------------------------------
// Read-only done-state summary (shown inline in chat after submission)
// --------------------------------------------------------------------------
export function DoneSummary({
  questions,
  submittedResponses,
  sessionId
}: {
  questions: Question[]
  submittedResponses: Record<string, string>
  sessionId: string
}): React.JSX.Element {
  return (
    <div className="premium-panel-soft my-3 w-full max-w-xl rounded-xl border border-status-success/20 bg-status-success/[0.015] p-5 transition-all duration-500 select-text">
      <div className="flex items-center gap-2.5 border-b border-white/[0.05] pb-3 mb-4 select-none">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-status-success/15 text-status-success">
          <Check size={16} weight="bold" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-text-primary">Questionnaire Completed</h4>
          <p className="text-[10px] text-text-muted font-mono mt-0.5">
            Session: {sessionId.substring(0, 8)}...
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 select-text">
        {questions.map((q) => {
          const answer = submittedResponses[q.id] || 'No response'
          return (
            <div key={q.id} className="flex flex-col gap-1">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-secondary">
                {q.title || 'Question'}
              </span>
              <p className="text-[13px] font-medium text-text-primary/95">{q.prompt}</p>
              <div className="mt-1.5 rounded-xl border border-white/[0.04] bg-white/[0.01] px-3.5 py-2.5 text-xs text-text-secondary select-text">
                {answer}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Active wizard card (shown docked above InputBar via ChatPane)
// --------------------------------------------------------------------------
export function QuestionnaireCard({
  questions,
  answers,
  customValues,
  currentStep,
  validationError,
  isSubmitting,
  onSelectOption,
  onCustomInputChange,
  onEssayChange,
  onNext,
  onBack,
  onSubmit,
  onEditStep
}: {
  questions: Question[]
  answers: Record<string, string>
  customValues: Record<string, string>
  currentStep: number
  validationError: string | null
  isSubmitting: boolean
  onSelectOption: (id: string, value: string) => void
  onCustomInputChange: (id: string, text: string) => void
  onEssayChange: (id: string, text: string) => void
  onNext: () => void
  onBack: () => void
  onSubmit: () => void
  onEditStep: (step: number) => void
}): React.JSX.Element {
  const totalSteps = questions.length
  const isReviewStep = currentStep === totalSteps

  return (
    <div className="w-[70%] mx-auto relative select-none animate-fade-in z-20 transition-all duration-300">
      {/* Card */}
      <div className="liquid-glass-docked relative overflow-hidden rounded-t-2xl rounded-b-none px-5 py-4">
        {/* Subtle internal theme center glow */}
        <div className="absolute inset-0 rounded-t-2xl overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 rounded-full blur-[36px] opacity-18 transition-all duration-300 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, var(--accent-primary) 0%, transparent 70%)'
            }}
          />
        </div>

        {/* Header row */}
        <div className="flex items-center justify-between mb-3 select-none">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary">
              <ClipboardText size={14} weight="regular" />
            </div>
            <span className="text-xs font-semibold text-text-primary">
              {isReviewStep ? 'Review Your Answers' : 'Required Questionnaire'}
            </span>
          </div>

          {/* Step progress */}
          <span className="text-[10px] font-mono text-text-muted">
            {isReviewStep
              ? `${totalSteps} / ${totalSteps} • Review`
              : `${currentStep + 1} / ${totalSteps}`}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-0.5 bg-white/[0.06] rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary rounded-full transition-all duration-500 ease-out"
            style={{
              width: isReviewStep ? '100%' : `${((currentStep + 1) / totalSteps) * 100}%`
            }}
          />
        </div>

        {/* ---- REVIEW STEP ---- */}
        {isReviewStep ? (
          <div className="flex flex-col gap-3 mb-4 max-h-[40vh] overflow-y-auto no-scrollbar pr-0.5">
            {questions.map((q, idx) => {
              const rawVal = answers[q.id] || ''
              let displayVal = rawVal
              if (q.type === 'multiple-choice' && rawVal) {
                const opt = q.options?.find((o) => o.value === rawVal)
                if (opt?.allow_custom_input && customValues[q.id]) {
                  displayVal = customValues[q.id]
                } else {
                  displayVal = opt?.label || rawVal
                }
              }
              return (
                <div
                  key={q.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-2.5"
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-muted">
                      {q.title || `Step ${idx + 1}`}
                    </span>
                    <p className="text-xs text-text-secondary truncate">{q.prompt}</p>
                    <p className="text-xs font-semibold text-text-primary mt-0.5 truncate">
                      {displayVal || <span className="italic text-status-error/80">No answer</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEditStep(idx)}
                    className="shrink-0 text-[10px] font-semibold text-accent-primary hover:text-accent-secondary transition-colors duration-200 cursor-pointer mt-0.5 select-none"
                  >
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          /* ---- QUESTION STEP ---- */
          (() => {
            const q = questions[currentStep]
            const selectedVal = answers[q.id] || ''
            return (
              <div className="flex flex-col gap-3 mb-4 animate-fade-in">
                {/* Category label */}
                {q.title && (
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-muted select-none">
                    {q.title}
                  </span>
                )}
                {/* Question prompt */}
                <p className="text-sm font-semibold text-text-primary leading-snug">{q.prompt}</p>

                {/* Validation error */}
                {validationError && (
                  <p className="text-[10px] font-medium text-status-error animate-pulse">
                    {validationError}
                  </p>
                )}

                {/* Multiple-choice options */}
                {q.type === 'multiple-choice' && q.options && (
                  <div className="flex flex-col gap-1.5">
                    {q.options.map((opt) => {
                      const isSelected = selectedVal === opt.value
                      return (
                        <div key={opt.value} className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectOption(q.id, opt.value)}
                            className={clsx(
                              'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-all duration-250 text-xs font-medium cursor-pointer select-none',
                              isSelected
                                ? 'border-accent-primary bg-accent-primary/8 text-text-primary shadow-[0_0_10px_rgba(143,180,255,0.06)]'
                                : 'border-white/[0.05] bg-white/[0.01] text-text-secondary hover:bg-white/[0.04] hover:border-white/[0.09] hover:text-text-primary'
                            )}
                          >
                            <span>{opt.label}</span>
                            <div
                              className={clsx(
                                'h-4 w-4 rounded-full border flex items-center justify-center transition-all duration-250 shrink-0',
                                isSelected
                                  ? 'border-accent-primary bg-accent-primary text-background-main'
                                  : 'border-white/20 bg-black/20'
                              )}
                            >
                              {isSelected && <Check size={10} weight="bold" />}
                            </div>
                          </button>

                          {/* Write-in field for custom option */}
                          {opt.allow_custom_input && isSelected && (
                            <div className="pl-3 animate-fade-in">
                              <input
                                type="text"
                                placeholder={q.placeholder || 'Specify your answer...'}
                                value={customValues[q.id] || ''}
                                onChange={(e) => onCustomInputChange(q.id, e.target.value)}
                                className="w-full bg-black/30 text-xs text-text-primary rounded-lg border border-white/[0.06] px-3 py-2 placeholder:text-text-muted focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all duration-250"
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Essay input */}
                {q.type === 'essay' && (
                  <textarea
                    rows={3}
                    placeholder={q.placeholder || 'Write your response here...'}
                    value={selectedVal}
                    onChange={(e) => onEssayChange(q.id, e.target.value)}
                    className="w-full bg-black/25 text-xs text-text-primary rounded-xl border border-white/[0.06] px-3.5 py-2.5 placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all duration-250 leading-relaxed"
                  />
                )}
              </div>
            )
          })()
        )}

        {/* Footer buttons */}
        <div className="flex items-center justify-between gap-2 select-none">
          {/* Back button */}
          <button
            type="button"
            onClick={onBack}
            disabled={currentStep === 0}
            className={clsx(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all duration-200 cursor-pointer',
              currentStep === 0
                ? 'border-white/[0.04] text-text-muted opacity-40 pointer-events-none'
                : 'border-white/[0.06] text-text-secondary hover:border-white/[0.12] hover:text-text-primary'
            )}
          >
            <ArrowLeft size={12} weight="bold" />
            <span>Back</span>
          </button>

          {/* Next / Confirm */}
          {isReviewStep ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-background-main bg-gradient-to-r from-accent-primary to-accent-secondary cursor-pointer shadow-[0_4px_14px_rgba(143,180,255,0.22)] transition-all duration-250 hover:shadow-[0_4px_22px_rgba(143,180,255,0.38)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:scale-100 select-none"
            >
              {isSubmitting ? (
                <>
                  <CircleNotch size={13} className="animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={13} weight="bold" />
                  <span>Confirm &amp; Submit</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-primary/12 border border-accent-primary/25 text-xs font-semibold text-accent-primary hover:bg-accent-primary/20 hover:border-accent-primary/45 transition-all duration-200 cursor-pointer select-none"
            >
              <span>{currentStep === totalSteps - 1 ? 'Review Answers' : 'Next'}</span>
              <ArrowRight size={12} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Main export: always returns null — the questionnaire is handled entirely
// by the wizard card docked above the InputBar (ChatPane). No inline chat
// rendering is needed after submission.
// --------------------------------------------------------------------------
export function QuestionnaireRenderer(
  _props: QuestionnaireRendererProps
): React.JSX.Element | null {
  return null
}

// --------------------------------------------------------------------------
// Wizard stateful wrapper used by ChatPane when questionnaire is active
// --------------------------------------------------------------------------
export function QuestionnaireWizard({
  toolCall,
  chatId
}: QuestionnaireRendererProps): React.JSX.Element | null {
  const sessionId = (toolCall.args.session_id as string) || ''

  let questions: Question[] = []
  try {
    const raw = toolCall.args.questions
    questions = typeof raw === 'string' ? JSON.parse(raw) : (raw as Question[])
  } catch {
    // ignore
  }

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [currentStep, setCurrentStep] = useState(0)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSelectOption = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    setValidationError(null)
  }, [])

  const handleCustomInputChange = useCallback((questionId: string, text: string) => {
    setCustomValues((prev) => ({ ...prev, [questionId]: text }))
    setValidationError(null)
  }, [])

  const handleEssayChange = useCallback((questionId: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: text }))
    setValidationError(null)
  }, [])

  const validateCurrentStep = (): boolean => {
    if (currentStep >= questions.length) return true
    const q = questions[currentStep]
    const val = answers[q.id] || ''
    if (q.type === 'multiple-choice') {
      if (!val) {
        setValidationError('Please select an option')
        return false
      }
      const opt = q.options?.find((o) => o.value === val)
      if (opt?.allow_custom_input && !(customValues[q.id] || '').trim()) {
        setValidationError('Please specify your answer')
        return false
      }
    } else if (q.type === 'essay') {
      if (!val.trim()) {
        setValidationError('Please fill out this field')
        return false
      }
    }
    setValidationError(null)
    return true
  }

  const handleNext = () => {
    if (!validateCurrentStep()) return
    setCurrentStep((s) => s + 1)
  }

  const handleBack = () => {
    setValidationError(null)
    setCurrentStep((s) => Math.max(0, s - 1))
  }

  const handleEditStep = (step: number) => {
    setCurrentStep(step)
  }

  const handleSubmit = () => {
    // Build final responses
    const finalResponses: Record<string, string> = {}
    for (const q of questions) {
      const val = answers[q.id] || ''
      if (q.type === 'multiple-choice') {
        const opt = q.options?.find((o) => o.value === val)
        finalResponses[q.id] = opt?.allow_custom_input
          ? customValues[q.id] || ''
          : opt?.label || val
      } else {
        finalResponses[q.id] = val
      }
    }

    setIsSubmitting(true)
    if (window.api?.submitQuestionnaire) {
      window.api.submitQuestionnaire({ chatId, sessionId, responses: finalResponses })
    } else {
      console.error('submitQuestionnaire API is not available')
      setIsSubmitting(false)
    }
  }

  if (questions.length === 0) return null

  return (
    <QuestionnaireCard
      questions={questions}
      answers={answers}
      customValues={customValues}
      currentStep={currentStep}
      validationError={validationError}
      isSubmitting={isSubmitting}
      onSelectOption={handleSelectOption}
      onCustomInputChange={handleCustomInputChange}
      onEssayChange={handleEssayChange}
      onNext={handleNext}
      onBack={handleBack}
      onSubmit={handleSubmit}
      onEditStep={handleEditStep}
    />
  )
}
