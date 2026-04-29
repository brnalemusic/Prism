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
    <div className="w-full max-w-2xl my-2 animate-in fade-in slide-in-from-top-2 duration-300">
      <div
        className={clsx(
          'overflow-hidden rounded-xl border transition-all duration-300',
          isCancellation 
            ? 'border-surface/20 bg-surface/5'
            : isOpen
              ? 'border-status-error/40 bg-status-error/10 shadow-[0_0_20px_-5px_rgba(248,113,113,0.2)]'
              : 'border-status-error/20 bg-status-error/5 hover:bg-status-error/10 hover:border-status-error/30'
        )}
      >
        {/* Header/Dropdown Trigger */}
        <div className="flex items-center">
          <button
            onClick={() => !isCancellation && setIsOpen(!isOpen)}
            disabled={isCancellation}
            className={clsx(
              "flex-1 px-4 py-3 flex items-center justify-between gap-3 text-left",
              isCancellation ? "cursor-default" : "cursor-pointer"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={clsx(
                "flex items-center justify-center w-8 h-8 rounded-lg shrink-0",
                isCancellation ? "bg-surface/20 text-text-muted" : "bg-status-error/20 text-status-error"
              )}>
                <AlertCircle size={18} />
              </div>
              <div className="flex flex-col">
                <span className={clsx(
                  "text-[10px] uppercase tracking-widest font-black leading-none mb-1",
                  isCancellation ? "text-text-muted/70" : "text-status-error/70"
                )}>
                  {isCancellation ? "User Action" : "Prism Exception"}
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
                "mr-4 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-bold transition-colors",
                isRateLimit 
                  ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                  : "bg-status-error/20 text-status-error hover:bg-status-error/30"
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
                  <div className="bg-black/20 rounded-lg p-3 border border-white/5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-wider font-bold text-text-secondary/50 flex items-center gap-1.5">
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
