import React, { useState, useEffect } from 'react'
import { Monitor, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Spinner } from './Spinner'

interface ScreenshotModalProps {
  isOpen: boolean
  onClose: () => void
  onCapture: (base64: string) => void
}

interface WindowSource {
  id: string
  name: string
  thumbnail: string
}

export function ScreenshotModal({
  isOpen,
  onClose,
  onCapture
}: ScreenshotModalProps): React.JSX.Element | null {
  const [windows, setWindows] = useState<WindowSource[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Sync open state animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setIsLoading(true)
      window.api
        .getOpenWindows()
        .then((wins) => {
          // Filter out empty name windows if necessary, but keep major ones
          setWindows(wins || [])
        })
        .catch((err) => console.error('Failed to get open windows:', err))
        .finally(() => setIsLoading(false))
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isOpen])

  if (!isOpen && !isVisible) return null

  const handleSelectWindow = async (id: string): Promise<void> => {
    setIsLoading(true)
    try {
      const base64 = await window.api.captureWindow(id)
      onCapture(base64)
      onClose()
    } catch (err) {
      console.error('Failed to capture window:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300',
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/[0.55] backdrop-blur-xl" onClick={onClose} />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'premium-panel relative w-full max-w-2xl overflow-hidden rounded-[30px] transition-all duration-300 transform bg-background-main border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col max-h-[80vh]',
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/[0.04] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-text-secondary">
              <Monitor size={18} />
            </div>
            <h2 className="text-base font-semibold text-text-primary">
              Capture Application Window
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary/50 transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && windows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-secondary">
              <Spinner size="md" />
              <span className="text-sm font-light animate-pulse text-text-secondary/70">
                Fetching active windows...
              </span>
            </div>
          ) : windows.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {windows.map((win) => (
                <button
                  key={win.id}
                  onClick={() => handleSelectWindow(win.id)}
                  disabled={isLoading}
                  className="premium-panel-soft group rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3 flex flex-col gap-2 hover:border-accent-primary/35 hover:bg-white/[0.04] transition-all duration-300 cursor-pointer animate-fade-in text-left focus:outline-none w-full"
                >
                  <div className="relative aspect-video rounded-lg overflow-hidden border border-white/5 bg-black/40 flex items-center justify-center w-full">
                    {win.thumbnail ? (
                      <img
                        src={win.thumbnail}
                        alt={win.name}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                      />
                    ) : (
                      <Monitor size={48} className="text-text-muted/40" />
                    )}
                  </div>
                  <span
                    className="text-xs font-semibold text-text-primary group-hover:text-accent-primary transition-colors truncate px-1 block w-full"
                    title={win.name}
                  >
                    {win.name || 'Unnamed Window'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-text-muted">
              <X size={24} className="opacity-40" />
              <span className="text-sm font-light">No open windows found.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
