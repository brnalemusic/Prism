import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Copy, Terminal } from 'lucide-react'
import clsx from 'clsx'

interface ErrorMessageProps {
  error: string
  onFixClick?: () => void
}

export function ErrorMessage({ error, onFixClick }: ErrorMessageProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)

  const isCancellation = error === '-------------- You cancelled AI response ----------------'

  // Parse error to extract code if possible (e.g., "429 Too Many Requests")
  const getErrorCode = (err: string): string => {
    if (isCancellation) return 'STOP'
    const match = err.match(/(\d{3})/)
    return match ? match[1] : '???'
  }

  const getErrorSummary = (err: string): string => {
    if (isCancellation) return 'The AI response was interrupted by the user.'
    if (err.includes('429')) return 'Too Many Requests - Rate limit exceeded.'
    if (err.includes('401') || err.includes('403'))
      return 'Authentication Error - Check your API key.'
    if (err.includes('500') || err.includes('503'))
      return 'Service Unavailable - Google AI is having issues.'
    if (err.includes('400')) return 'Invalid Request - The prompt or parameters are invalid.'
    if (err.includes('Safety')) return 'Content Blocked - The request triggered safety filters.'
    if (err.includes('Key missing')) return 'API Key Missing - Please configure your own key.'
    return 'An unexpected API error occurred.'
  }

  const errorCode = getErrorCode(error)
  const summary = getErrorSummary(error)
  const isRateLimit = errorCode === '429'

  return (
    <div className="my-2 w-full animate-soft-pop">
      <div
        className={clsx(
          'premium-panel-soft overflow-hidden rounded-[22px] border transition-all duration-300',
          isCancellation
            ? 'border-white/[0.06]'
            : isOpen
              ? 'border-status-error/35 bg-status-error/[0.08]'
              : 'border-status-error/20 bg-status-error/[0.045] hover:bg-status-error/[0.07] hover:border-status-error/30'
        )}
      >
        {/* Header/Dropdown Trigger */}
        <div className="flex items-center">
          <button
            onClick={() => !isCancellation && setIsOpen(!isOpen)}
            disabled={isCancellation}
            className={clsx(
              'flex-1 px-4 py-3 flex items-center justify-between gap-3 text-left',
              isCancellation ? 'cursor-default' : 'cursor-pointer'
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-[16px] border',
                  isCancellation
                    ? 'border-white/[0.08] bg-white/[0.035] text-text-muted'
                    : 'border-status-error/20 bg-status-error/[0.12] text-status-error'
                )}
              >
                <AlertCircle size={18} />
              </div>
              <div className="flex flex-col">
                <span
                  className={clsx(
                    'mb-1 text-[11px] font-semibold leading-none',
                    isCancellation ? 'text-text-muted/70' : 'text-status-error/70'
                  )}
                >
                  {isCancellation ? 'User Action' : 'Prism Exception'}
                </span>
                <span className="text-sm font-semibold text-text-primary/90">
                  {isCancellation ? summary : `Error ${errorCode}: ${summary}`}
                </span>
              </div>
            </div>
            {!isCancellation && (
              <div className="text-text-secondary/40">
                {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
            )}
          </button>

          {onFixClick && !isCancellation && (
            <button
              onClick={onFixClick}
              className={clsx(
                'mr-4 rounded-[14px] px-3 py-1.5 text-[11px] font-semibold transition-colors',
                isRateLimit
                  ? 'bg-accent-primary/[0.12] text-accent-primary hover:bg-accent-primary/[0.18]'
                  : 'bg-status-error/[0.12] text-status-error hover:bg-status-error/[0.18]'
              )}
            >
              {isRateLimit ? 'Change Model' : 'Change API Key'}
            </button>
          )}
        </div>

        {/* Collapsible Content */}
        {!isCancellation && (
          <div
            className={clsx(
              'grid transition-all duration-300 ease-in-out',
              isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            )}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-4 pt-1 ml-11">
                <div className="relative group">
                  <div className="absolute -left-3 top-0 bottom-0 w-[2px] bg-status-error/20" />
                  <div className="flex flex-col gap-2 rounded-[18px] border border-white/[0.055] bg-black/15 p-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary/50">
                        <Terminal size={10} />
                        Raw Provider Response
                      </span>
                      <button
                        onClick={() => navigator.clipboard.writeText(error)}
                        className="text-text-secondary/30 hover:text-text-primary transition-colors"
                        title="Copy Error"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-status-error/80 whitespace-pre-wrap break-all leading-relaxed">
                      {error}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
