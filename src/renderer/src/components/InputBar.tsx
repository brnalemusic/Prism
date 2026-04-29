import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import { SendHorizontal, Globe, Square, Brain } from 'lucide-react'
import youtubeLogo from '../assets/youtube.png'
import clsx from 'clsx'

interface InputBarProps {
  onSend: (message: string) => void
  onCancel?: () => void
  disabled?: boolean
  isProcessing?: boolean
  isKeyMissing?: boolean
  isThinkMode?: boolean
  onThinkModeToggle?: (val: boolean) => void
}

export interface InputBarHandle {
  focus: () => void
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(({ 
  onSend, 
  onCancel, 
  disabled, 
  isProcessing, 
  isKeyMissing,
  isThinkMode = false,
  onThinkModeToggle
}, ref) => {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isYoutubeMode = text.startsWith('/youtube')

  const commands = [
    { cmd: '/search', desc: 'Force web search', action: () => { setText('/search '); inputRef.current?.focus() } },
    { cmd: '/youtube', desc: 'YouTube search & play', action: () => { setText('/youtube '); inputRef.current?.focus() } }
  ]

  const filteredCommands = text.startsWith('/') 
    ? commands.filter(c => c.cmd.toLowerCase().startsWith(text.toLowerCase().split(' ')[0]))
    : []

  const showSlashMenu = text.startsWith('/') && filteredCommands.length > 0 && !text.includes(' ')

  useEffect(() => {
    if (showSlashMenu) setSlashSelectedIndex(0)
  }, [showSlashMenu, text])

  useImperativeHandle(ref, () => ({
    focus: (): void => {
      inputRef.current?.focus()
    }
  }))

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      // Ctrl+S for Search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        setIsSearchEnabled((prev) => !prev)
      }
      // Ctrl+T for Think Mode
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault()
        onThinkModeToggle?.(!isThinkMode)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isThinkMode, onThinkModeToggle])

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
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        filteredCommands[slashSelectedIndex].action()
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const getPlaceholder = (): string => {
    if (isKeyMissing) return "API Key Required..."
    if (isProcessing) return "Awaiting AI Response..."
    if (isYoutubeMode) return "Search on YouTube..."
    if (isSearchEnabled) return "Search web with Prism..."
    if (isThinkMode) return "Think with Prism..."
    return "Ask Prism..."
  }

  return (
    <div className="w-full px-6 sm:px-12 z-20 relative">
      {/* YouTube Logo Overlay - Bottom */}
      {isYoutubeMode && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-4 w-48 h-48 pointer-events-none animate-fade-in z-0 opacity-10">
          <img src={youtubeLogo} alt="YouTube" className="w-full h-full object-contain" />
        </div>
      )}

      {/* Slash Menu */}
      {showSlashMenu && (
        <div className="mb-2 bg-background-secondary border border-surface rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-text-muted border-b border-surface">Commands</div>
          {filteredCommands.map((c, i) => (
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
          'relative flex items-end gap-2 bg-background-secondary/40 backdrop-blur-xl rounded-xl border p-2 transition-all duration-700 overflow-hidden',
          disabled && 'opacity-60 border-surface/30',
          !disabled && isFocused
            ? isYoutubeMode ? 'border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.15)] bg-background-secondary/60' :
              isSearchEnabled ? 'border-accent-secondary/60 shadow-[0_0_20px_rgba(0,212,255,0.15)] bg-background-secondary/60' :
              isThinkMode ? 'border-yellow-500/50 shadow-[0_0_25px_rgba(234,179,8,0.2)] bg-background-secondary/70' :
              'border-accent-primary/60 shadow-[0_0_20px_rgba(108,99,255,0.15)] bg-background-secondary/60'
            : isThinkMode ? 'border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.1)]' : 'border-surface/50 hover:border-surface',
          !disabled && text.trim() &&
            isFocused &&
            (isYoutubeMode ? 'shadow-[0_0_25px_rgba(239,68,68,0.25)] border-red-500' :
             isSearchEnabled ? 'shadow-[0_0_25px_rgba(0,212,255,0.25)] border-accent-secondary' :
             isThinkMode ? 'shadow-[0_0_35px_rgba(234,179,8,0.3)] border-yellow-400' :
             'shadow-[0_0_25px_rgba(108,99,255,0.25)] border-accent-primary'),
          isThinkMode && 'ring-1 ring-yellow-500/20'
        )}
      >
        {isKeyMissing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background-main/20 backdrop-blur-[2px] rounded-xl cursor-not-allowed">
             <div className="bg-surface/80 p-2 rounded-full border border-surface shadow-2xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
             </div>
          </div>
        )}

        {/* Improved Glow Effect for Think Mode - Now contained within overflow-hidden parent */}
        {!disabled && isThinkMode && (
          <div className="absolute inset-0 rounded-xl pointer-events-none z-0">
             <div className="absolute inset-0 rounded-xl border border-yellow-500/40 animate-pulse" />
             <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-yellow-500/10 to-transparent animate-[shimmer_2s_infinite] opacity-50" 
                  style={{ backgroundSize: '200% 100%' }} />
          </div>
        )}

        {!disabled && text.length > 0 && isFocused && (
          <div className={clsx(
            "absolute inset-0 rounded-xl pointer-events-none animate-pulse",
            isYoutubeMode ? "bg-red-500/5" : isSearchEnabled ? "bg-accent-secondary/5" : isThinkMode ? "bg-yellow-500/5" : "bg-accent-primary/5"
          )} />
        )}

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e): void => setText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={disabled}
          className={clsx(
            "flex-1 max-h-48 min-h-[44px] bg-transparent placeholder-text-muted outline-none resize-none py-3 px-4 text-sm disabled:cursor-not-allowed relative z-10 transition-colors duration-500",
            isYoutubeMode ? "text-red-500" : (isThinkMode && !isFocused) ? "text-yellow-500/80" : "text-text-primary"
          )}
          rows={1}
        />

        <div className="flex gap-2 mb-[2px] mr-[2px] relative z-10">
          <button
            onClick={() => onThinkModeToggle?.(!isThinkMode)}
            disabled={disabled}
            title="Toggle Think Mode (Ctrl+T)"
            className={clsx(
              'p-3 rounded-lg flex-shrink-0 transition-all duration-300 relative group overflow-hidden',
              isThinkMode
                ? 'bg-yellow-500/20 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                : 'bg-surface/20 text-text-muted hover:bg-surface/40',
              disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface/40'
            )}
          >
            {isThinkMode && (
              <span className="absolute inset-0 animate-pulse bg-yellow-500/10" />
            )}
            <Brain size={18} className={clsx(
              "transition-all duration-500",
              isThinkMode && "scale-110 rotate-[10deg]"
            )} />
          </button>

          <button
            onClick={() => setIsSearchEnabled(!isSearchEnabled)}
            disabled={disabled}
            title="Toggle Web Search (Ctrl+S)"
            className={clsx(
              'p-3 rounded-lg flex-shrink-0 transition-all duration-300 relative group overflow-hidden',
              isYoutubeMode ? 'bg-red-500/20 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]' :
              isSearchEnabled
                ? 'bg-accent-secondary/20 text-accent-secondary shadow-[0_0_15px_rgba(0,212,255,0.2)]'
                : 'bg-surface/20 text-text-muted hover:bg-surface/40',
              disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface/40'
            )}
          >
            {(isSearchEnabled || isYoutubeMode) && (
              <span className={clsx("absolute inset-0 animate-pulse", isYoutubeMode ? "bg-red-500/10" : "bg-accent-secondary/10")} />
            )}
            <Globe size={18} className={clsx(
              "transition-transform duration-500",
              (isSearchEnabled || isYoutubeMode) && "rotate-[360deg] scale-110",
              isYoutubeMode && "text-red-500"
            )} />
          </button>

          {isProcessing ? (
            <button
              onClick={() => onCancel?.()}
              className="p-3 rounded-lg flex-shrink-0 transition-all duration-300 bg-status-error/20 text-status-error hover:bg-status-error/30 hover:scale-105 shadow-[0_0_15px_rgba(239,68,68,0.2)] cursor-pointer active:scale-95"
              title="Stop Generation"
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!text.trim() || disabled}
              className={clsx(
                'p-3 rounded-lg flex-shrink-0 transition-all duration-300',
                text.trim() && !disabled
                  ? isYoutubeMode 
                    ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_20px_rgba(239,68,68,0.6)] hover:scale-105'
                    : isSearchEnabled 
                      ? 'bg-accent-secondary text-white shadow-[0_0_15px_rgba(0,212,255,0.4)] hover:shadow-[0_0_20px_rgba(0,212,255,0.6)] hover:scale-105'
                      : isThinkMode
                        ? 'bg-yellow-500 text-white shadow-[0_0_15px_rgba(234,179,8,0.4)] hover:shadow-[0_0_20px_rgba(234,179,8,0.6)] hover:scale-105'
                        : 'bg-accent-primary text-white shadow-[0_0_15px_rgba(108,99,255,0.4)] hover:shadow-[0_0_20px_rgba(108,99,255,0.6)] hover:scale-105'
                  : 'bg-surface/50 text-text-muted cursor-not-allowed'
              )}
            >
              <SendHorizontal size={18} />
            </button>
          )}
        </div>
      </div>
      
      {(isSearchEnabled || isYoutubeMode || isThinkMode) && (
        <div className="flex justify-center mt-2 animate-in fade-in slide-in-from-top-1 duration-300">
           <span className={clsx(
             "text-[9px] uppercase tracking-[0.2em] font-black flex items-center gap-2",
             isYoutubeMode ? "text-red-500/60" : isSearchEnabled ? "text-accent-secondary/60" : "text-yellow-500/60"
           )}>
             <span className={clsx("w-1 h-1 rounded-full animate-ping", isYoutubeMode ? "bg-red-500" : isSearchEnabled ? "bg-accent-secondary" : "bg-yellow-500")} />
             {isYoutubeMode ? 'YouTube Search Active' : isSearchEnabled ? 'Web Search Active' : 'Think Mode Active'}
           </span>
        </div>
      )}
    </div>
  )
})

InputBar.displayName = 'InputBar'
