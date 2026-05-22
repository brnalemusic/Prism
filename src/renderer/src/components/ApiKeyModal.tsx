import { useState, useEffect } from 'react'
import { Key, Shield, Info, X } from 'lucide-react'
import clsx from 'clsx'

interface ApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (key: string) => void
}

export function ApiKeyModal({
  isOpen,
  onClose,
  onSave
}: ApiKeyModalProps): React.JSX.Element | null {
  const [apiKey, setApiKey] = useState('')
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 0)
      return () => clearTimeout(timer)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isVisible && !isOpen) return null

  const handleSave = (): void => {
    if (apiKey.trim()) {
      onSave(apiKey.trim())
      onClose()
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

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'premium-panel relative w-full max-w-md overflow-hidden rounded-[30px] transition-all duration-300 transform',
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
      >
        <div className="p-8 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[18px] border border-accent-primary/20 bg-accent-primary/[0.08] text-accent-primary">
                <Key size={20} />
              </div>
              <div className="flex flex-col">
                <h2 className="text-lg font-semibold text-text-primary">Gemini API Key</h2>
                <span className="text-xs font-medium text-accent-secondary/70">
                  Configure your own access
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-1 text-text-secondary/50 transition-colors hover:bg-white/[0.06] hover:text-text-primary"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              To continue using Prism without interruptions, you can configure your own API key.
            </p>

            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Insert your Gemini API Key here..."
                className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 rounded-[20px] border border-status-success/10 bg-status-success/[0.045] p-4">
                <Shield size={16} className="text-status-success shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-status-success/90">Total Security</span>
                  <p className="text-[11px] text-status-success/70 leading-normal">
                    Your key is saved only locally on your computer and encrypted by the system.
                    Prism uses its own internet connection to speak with the API, without passing
                    through any intermediate service or telemetry.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-[20px] border border-accent-primary/10 bg-accent-primary/[0.045] p-4">
                <Info size={16} className="text-accent-secondary shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-accent-secondary/90">How to get?</span>
                  <p className="text-[11px] text-accent-secondary/70 leading-normal">
                    You can create a free key at{' '}
                    <a
                      href="https://aistudio.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-accent-secondary transition-colors"
                    >
                      Google AI Studio
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-[18px] border border-white/[0.08] px-4 py-3 text-sm font-semibold text-text-secondary transition-all hover:bg-white/[0.055] hover:text-text-primary active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim()}
              className="flex-1 rounded-[18px] bg-text-primary px-4 py-3 text-sm font-semibold text-black transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
            >
              Save Key
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
