import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import { SendHorizontal, Globe } from 'lucide-react'
import clsx from 'clsx'

interface InputBarProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export interface InputBarHandle {
  focus: () => void
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(({ onSend, disabled }, ref) => {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: (): void => {
      inputRef.current?.focus()
    }
  }))

  // Keyboard shortcut for Ctrl+S
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        setIsSearchEnabled((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // Auto-focus when re-enabled
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus()
    }
  }, [disabled])

  const handleSend = (): void => {
    if (text.trim() && !disabled) {
      const finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${text.trim()}` : text.trim()
      onSend(finalMessage)
      setText('')
      // Mantém o estado de busca se o usuário quiser, ou podemos resetar?
      // Vou manter ativado conforme solicitado ("até ser desativado")
      
      // Mantém o foco no input após o envio
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="w-full px-6 sm:px-12 z-20">
      <div
        className={clsx(
          'relative flex items-end gap-2 bg-background-secondary/40 backdrop-blur-xl rounded-xl border p-2 transition-all duration-300',
          isFocused
            ? 'border-accent-primary/60 shadow-[0_0_20px_rgba(108,99,255,0.15)] bg-background-secondary/60'
            : 'border-surface/50 hover:border-surface',
          text.trim() &&
            isFocused &&
            'shadow-[0_0_25px_rgba(108,99,255,0.25)] border-accent-primary',
          isSearchEnabled && isFocused && 'border-accent-secondary/60 shadow-[0_0_20px_rgba(0,212,255,0.15)]'
        )}
      >
        {/* Subtle inner glow for typing or searching */}
        {text.length > 0 && isFocused && (
          <div className={clsx(
            "absolute inset-0 rounded-xl pointer-events-none animate-pulse",
            isSearchEnabled ? "bg-accent-secondary/5" : "bg-accent-primary/5"
          )} />
        )}

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e): void => setText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={isSearchEnabled ? "Search web with Prism..." : "Ask Prism..."}
          disabled={disabled}
          className="flex-1 max-h-48 min-h-[44px] bg-transparent text-text-primary placeholder-text-muted outline-none resize-none py-3 px-4 text-sm disabled:opacity-50 relative z-10"
          rows={1}
        />

        <div className="flex gap-2 mb-[2px] mr-[2px] relative z-10">
          <button
            onClick={() => setIsSearchEnabled(!isSearchEnabled)}
            disabled={disabled}
            title="Toggle Web Search (Ctrl+S)"
            className={clsx(
              'p-3 rounded-lg flex-shrink-0 transition-all duration-300 relative group overflow-hidden',
              isSearchEnabled
                ? 'bg-accent-secondary/20 text-accent-secondary shadow-[0_0_15px_rgba(0,212,255,0.2)]'
                : 'bg-surface/20 text-text-muted hover:bg-surface/40'
            )}
          >
            {isSearchEnabled && (
              <span className="absolute inset-0 bg-accent-secondary/10 animate-pulse" />
            )}
            <Globe size={18} className={clsx(
              "transition-transform duration-500",
              isSearchEnabled && "rotate-[360deg] scale-110"
            )} />
          </button>

          <button
            onClick={() => handleSend()}
            disabled={!text.trim() || disabled}
            className={clsx(
              'p-3 rounded-lg flex-shrink-0 transition-all duration-300',
              text.trim() && !disabled
                ? isSearchEnabled 
                  ? 'bg-accent-secondary text-white shadow-[0_0_15px_rgba(0,212,255,0.4)] hover:shadow-[0_0_20px_rgba(0,212,255,0.6)] hover:scale-105'
                  : 'bg-accent-primary text-white shadow-[0_0_15px_rgba(108,99,255,0.4)] hover:shadow-[0_0_20px_rgba(108,99,255,0.6)] hover:scale-105'
                : 'bg-surface/50 text-text-muted cursor-not-allowed'
            )}
          >
            <SendHorizontal size={18} />
          </button>
        </div>
      </div>
      
      {isSearchEnabled && (
        <div className="flex justify-center mt-2 animate-in fade-in slide-in-from-top-1 duration-300">
           <span className="text-[9px] uppercase tracking-[0.2em] font-black text-accent-secondary/60 flex items-center gap-2">
             <span className="w-1 h-1 rounded-full bg-accent-secondary animate-ping" />
             Web Search Active
           </span>
        </div>
      )}
    </div>
  )
})

InputBar.displayName = 'InputBar'
