import React, { useState, useEffect } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { clsx } from 'clsx'

export function ErrorPopup(): React.JSX.Element | null {
  const [error, setError] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout

    const handleShowError = (e: Event): void => {
      const customEvent = e as CustomEvent<{ code: string }>
      setError(customEvent.detail.code)
      setIsVisible(true)

      // Clear existing timer if any
      clearTimeout(timer)

      // Auto-hide after 4 seconds
      timer = setTimeout(() => {
        setIsVisible(false)
      }, 4000)
    }

    window.addEventListener('show-error-popup', handleShowError)

    return () => {
      window.removeEventListener('show-error-popup', handleShowError)
      clearTimeout(timer)
    }
  }, [])

  // Once animation completes and isVisible is false, clear the error string
  useEffect(() => {
    if (!isVisible) {
      const timer = setTimeout(() => {
        setError(null)
      }, 300) // matches transition duration
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isVisible])

  if (!error) return null

  return (
    <div
      className={clsx(
        'fixed bottom-6 right-6 z-[9999] max-w-[280px] w-full pointer-events-auto',
        'transition-all duration-300 ease-out transform',
        isVisible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-4 opacity-0 scale-95'
      )}
    >
      <div className="premium-panel-soft flex items-start gap-3.5 p-4 rounded-[22px] border border-status-error/30 bg-status-error/[0.06] backdrop-blur-2xl shadow-[0_12px_40px_rgba(239,127,120,0.12)]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] border border-status-error/20 bg-status-error/[0.12] text-status-error">
          <AlertCircle size={16} />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-status-error/70 leading-none mb-1.5">
            Error
          </span>
          <span className="text-xl font-bold font-mono text-text-primary leading-tight">
            {error}
          </span>
        </div>

        <button
          onClick={() => setIsVisible(false)}
          className="text-text-secondary/40 hover:text-text-primary p-0.5 rounded-lg hover:bg-white/5 transition-all"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
