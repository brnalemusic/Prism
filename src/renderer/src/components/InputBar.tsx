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
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const commands = [
    { cmd: '/search', desc: 'Force web search', action: () => { setText('/search '); inputRef.current?.focus() } },
    { cmd: '/clear', desc: 'Clear current chat', action: () => { onSend('/clear'); setText(''); } }
  ]

  const showSlashMenu = text === '/'

  useEffect(() => {
    if (showSlashMenu) setSlashSelectedIndex(0)
  }, [showSlashMenu])

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
      const trimmedText = text.trim()
      
      let finalMessage = trimmedText
      if (trimmedText.startsWith('/search ')) {
         finalMessage = `[FORCE_SEARCH] ${trimmedText.substring(8).trim()}`
      } else if (trimmedText === '/search') {
         finalMessage = `[FORCE_SEARCH] ` 
      } else if (trimmedText === '/clear') {
         // Comando clear tratado no App.tsx
      } else {
         finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${trimmedText}` : trimmedText
      }

      onSend(finalMessage)
      setText('')
      
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % commands.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + commands.length) % commands.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commands[slashSelectedIndex].action()
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="w-full px-6 sm:px-12 z-20">
      {/* Slash Menu */}
      {showSlashMenu && (
        <div className="mb-2 bg-background-secondary border border-surface rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-text-muted border-b border-surface">Commands</div>
          {commands.map((c, i) => (
            <button 
              key={c.cmd}
              onClick={() => c.action()} 
              onMouseEnter={() => setSlashSelectedIndex(i)}
              className={clsx(
                "w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors",
                slashSelectedIndex === i ? 'bg-surface/50 text-white' : 'text-text-primary'
              )}
            >
              <span className={clsx(c.cmd === '/clear' ? 'text-status-error' : 'text-accent-secondary')}>{c.cmd}</span> 
              <span className="text-text-secondary text-xs">— {c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={clsx(
          'relative flex items-end gap-2 bg-background-secondary/40 backdrop-blur-xl rounded-xl border p-2 transition-all duration-300',
          disabled && 'opacity-60 cursor-not-allowed border-surface/30',
          !disabled && isFocused
            ? 'border-accent-primary/60 shadow-[0_0_20px_rgba(108,99,255,0.15)] bg-background-secondary/60'
            : 'border-surface/50 hover:border-surface',
          !disabled && text.trim() &&
            isFocused &&
            'shadow-[0_0_25px_rgba(108,99,255,0.25)] border-accent-primary',
          !disabled && isSearchEnabled && isFocused && 'border-accent-secondary/60 shadow-[0_0_20px_rgba(0,212,255,0.15)]'
        )}
      >
        {disabled && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background-main/20 backdrop-blur-[2px] rounded-xl">
             <div className="bg-surface/80 p-2 rounded-full border border-surface shadow-2xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
             </div>
          </div>
        )}

        {!disabled && text.length > 0 && isFocused && (
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
          placeholder={disabled ? "API Key Required..." : (isSearchEnabled ? "Search web with Prism..." : "Ask Prism...")}
          disabled={disabled}
          className="flex-1 max-h-48 min-h-[44px] bg-transparent text-text-primary placeholder-text-muted outline-none resize-none py-3 px-4 text-sm disabled:cursor-not-allowed relative z-10"
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
                : 'bg-surface/20 text-text-muted hover:bg-surface/40',
              disabled && 'opacity-50 cursor-not-allowed hover:bg-surface/20'
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
