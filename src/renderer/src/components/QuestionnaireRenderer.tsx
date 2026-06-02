import React, { useState } from 'react'
import { clsx } from 'clsx'
import { Check, ClipboardText, CircleNotch } from '@phosphor-icons/react'
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

export function QuestionnaireRenderer({
  toolCall,
  chatId
}: QuestionnaireRendererProps): React.JSX.Element {
  const sessionId = (toolCall.args.session_id as string) || ''
  
  // Parse questions from JSON string argument
  let questions: Question[] = []
  try {
    const rawQuestions = toolCall.args.questions
    questions =
      typeof rawQuestions === 'string'
        ? JSON.parse(rawQuestions)
        : (rawQuestions as Question[])
  } catch (err) {
    console.error('Failed to parse questionnaire questions:', err)
  }

  // Local state for answers: questionId -> value
  const [answers, setAnswers] = useState<Record<string, string>>({})
  // Local state for custom input values: questionId -> customValueText
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // If already done, parse the result responses for summary display
  let submittedResponses: Record<string, string> = {}
  if (toolCall.status === 'done' && toolCall.result) {
    try {
      const parsed = JSON.parse(toolCall.result)
      submittedResponses = parsed.responses || {}
    } catch (e) {
      console.error('Failed to parse questionnaire submitted responses:', e)
    }
  }

  const handleSelectOption = (questionId: string, value: string): void => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
    setValidationErrors((prev) => {
      const next = { ...prev }
      delete next[questionId]
      return next
    })
  };

  const handleCustomInputChange = (questionId: string, text: string): void => {
    setCustomValues((prev) => ({ ...prev, [questionId]: text }))
    setValidationErrors((prev) => {
      const next = { ...prev }
      delete next[questionId]
      return next
    })
  };

  const handleEssayChange = (questionId: string, text: string): void => {
    setAnswers((prev) => ({ ...prev, [questionId]: text }))
    setValidationErrors((prev) => {
      const next = { ...prev }
      delete next[questionId]
      return next
    })
  };

  const handleSubmit = (): void => {
    // Validate
    const errors: Record<string, string> = {}
    for (const q of questions) {
      const val = answers[q.id] || ''
      if (q.type === 'multiple-choice') {
        if (!val) {
          errors[q.id] = 'Please select an option'
        } else {
          // If custom input is allowed and chosen, check write-in text
          const chosenOpt = q.options?.find((o) => o.value === val)
          if (chosenOpt?.allow_custom_input) {
            const customText = customValues[q.id] || ''
            if (!customText.trim()) {
              errors[q.id] = 'Please specify your answer'
            }
          }
        }
      } else if (q.type === 'essay') {
        if (!val.trim()) {
          errors[q.id] = 'Please fill out this field'
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      return
    }

    setIsSubmitting(true)
    
    // Assemble final responses
    const finalResponses: Record<string, string> = {}
    for (const q of questions) {
      const val = answers[q.id]
      if (q.type === 'multiple-choice') {
        const chosenOpt = q.options?.find((o) => o.value === val)
        if (chosenOpt?.allow_custom_input) {
          finalResponses[q.id] = customValues[q.id] || ''
        } else {
          finalResponses[q.id] = chosenOpt?.label || val
        }
      } else {
        finalResponses[q.id] = val
      }
    }

    // Submit via Preload API
    if (window.api && window.api.submitQuestionnaire) {
      window.api.submitQuestionnaire({
        chatId,
        sessionId,
        responses: finalResponses
      })
    } else {
      console.error('submitQuestionnaire API is not available')
      setIsSubmitting(false)
    }
  };

  // --- RENDER READ-ONLY SUMMARY (STATUS = DONE) ---
  if (toolCall.status === 'done') {
    return (
      <div className="premium-panel-soft w-full max-w-xl rounded-2xl border border-status-success/20 bg-status-success/[0.015] p-5 shadow-lg backdrop-blur-md transition-all duration-500 my-3 select-text">
        <div className="flex items-center gap-2.5 border-b border-white/[0.05] pb-3 mb-4 select-none">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-status-success/15 text-status-success">
            <Check size={16} weight="bold" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-primary">Questionnaire Completed</h4>
            <p className="text-[10px] text-text-muted font-mono mt-0.5">Session: {sessionId.substring(0, 8)}...</p>
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

  // --- RENDER BLOCKED QUESTIONNAIRE FORM (STATUS = RUNNING / WRITING) ---
  return (
    <div
      className={clsx(
        'premium-panel-soft w-full max-w-xl rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-500 my-3 relative overflow-hidden select-none',
        toolCall.status === 'writing' && 'opacity-60 pointer-events-none'
      )}
    >
      {/* Background Radial Glow */}
      <div className="absolute -top-16 -right-16 w-36 h-36 rounded-full bg-accent-primary/10 blur-[40px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.05] pb-3 mb-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary">
          <ClipboardText size={16} weight="regular" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-text-primary">Required Questionnaire</h4>
          <p className="text-[10px] text-text-muted font-mono mt-0.5">Please fill in details to resume reasoning</p>
        </div>
      </div>

      {/* Questions list */}
      <div className="flex flex-col gap-6">
        {questions.length === 0 ? (
          <div className="text-xs text-text-muted italic py-2 text-center">
            Initializing questionnaire...
          </div>
        ) : (
          questions.map((q) => {
            const hasError = !!validationErrors[q.id]
            const selectedVal = answers[q.id] || ''

            return (
              <div key={q.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-secondary">
                    {q.title || 'Question'}
                  </span>
                  {hasError && (
                    <span className="text-[10px] text-status-error font-medium animate-pulse">
                      {validationErrors[q.id]}
                    </span>
                  )}
                </div>
                <label className="text-[13px] font-semibold text-text-primary/95 leading-relaxed">
                  {q.prompt}
                </label>

                {/* Multiple choice inputs */}
                {q.type === 'multiple-choice' && q.options && (
                  <div className="flex flex-col gap-2 mt-1">
                    {q.options.map((opt) => {
                      const isSelected = selectedVal === opt.value
                      const hasCustomField = opt.allow_custom_input && isSelected

                      return (
                        <div key={opt.value} className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectOption(q.id, opt.value)}
                            className={clsx(
                              'w-full flex items-center justify-between px-3.5 py-3 rounded-xl border text-left transition-all duration-300 text-xs font-medium cursor-pointer',
                              isSelected
                                ? 'border-accent-primary bg-accent-primary/5 text-text-primary shadow-[0_0_12px_rgba(143,180,255,0.06)]'
                                : 'border-white/[0.04] bg-white/[0.01] text-text-secondary hover:bg-white/[0.04] hover:border-white/[0.08] hover:text-text-primary'
                            )}
                          >
                            <span>{opt.label}</span>
                            <div
                              className={clsx(
                                'h-4.5 w-4.5 rounded-full border flex items-center justify-center transition-all duration-300',
                                isSelected
                                  ? 'border-accent-primary bg-accent-primary text-background-main'
                                  : 'border-white/20 bg-black/20'
                              )}
                            >
                              {isSelected && <Check size={11} weight="bold" />}
                            </div>
                          </button>

                          {/* Write-in field if allowed and option is selected */}
                          {hasCustomField && (
                            <div className="pl-3 animate-fade-in">
                              <input
                                type="text"
                                placeholder={q.placeholder || 'Specify your custom choice...'}
                                value={customValues[q.id] || ''}
                                onChange={(e) => handleCustomInputChange(q.id, e.target.value)}
                                className={clsx(
                                  'w-full bg-black/25 text-xs text-text-primary rounded-lg border px-3.5 py-2.5 placeholder:text-text-muted focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all duration-300',
                                  hasError && !customValues[q.id]?.trim() ? 'border-status-error/45' : 'border-white/[0.06]'
                                )}
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
                    onChange={(e) => handleEssayChange(q.id, e.target.value)}
                    className={clsx(
                      'w-full bg-black/25 text-xs text-text-primary rounded-xl border px-3.5 py-3 placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all duration-300 leading-relaxed',
                      hasError ? 'border-status-error/45' : 'border-white/[0.06]'
                    )}
                  />
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer / Submit Button */}
      {questions.length > 0 && (
        <div className="mt-6 border-t border-white/[0.05] pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || toolCall.status === 'writing'}
            className={clsx(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-background-main bg-gradient-to-r from-accent-primary to-accent-secondary cursor-pointer shadow-[0_4px_16px_rgba(143,180,255,0.2)] select-none transition-all duration-300 hover:shadow-[0_4px_24px_rgba(143,180,255,0.35)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:scale-100'
            )}
          >
            {isSubmitting ? (
              <>
                <CircleNotch size={14} className="animate-spin" />
                <span>Submitting answers...</span>
              </>
            ) : (
              <span>Submit Responses</span>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
