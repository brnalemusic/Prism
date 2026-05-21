import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import { SendHorizontal, Search, Square, Brain, CirclePlay, Lock, Bot } from 'lucide-react'
import youtubeLogo from '../assets/youtube.png'
import clsx from 'clsx'

type InputBadge = 'youtube' | 'search' | 'think'

interface InputBarProps {
  onSend: (message: string) => void
  onCancel?: () => void
  disabled?: boolean
  isProcessing?: boolean
  isKeyMissing?: boolean
  isThinkMode?: boolean
  onThinkModeToggle?: (val: boolean) => void
  onOpenSubagentSettings?: () => void
  selectedModel?: string
  showModeBadge?: boolean
}

export interface InputBarHandle {
  focus: () => void
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(
  (
    {
      onSend,
      onCancel,
      disabled,
      isProcessing,
      isKeyMissing,
      isThinkMode = false,
      onThinkModeToggle,
      onOpenSubagentSettings,
      selectedModel,
      showModeBadge = true
    },
    ref
  ) => {
    const [text, setText] = useState('')
    const [isFocused, setIsFocused] = useState(false)
    const [isSearchEnabled, setIsSearchEnabled] = useState(false)
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    const isYoutubeMode = text.startsWith('/youtube')
    const activeBadges: InputBadge[] = [
      ...(isYoutubeMode ? (['youtube'] as const) : []),
      ...(isSearchEnabled ? (['search'] as const) : []),
      ...(isThinkMode ? (['think'] as const) : [])
    ]
    const isSearchAndThinkMode = isSearchEnabled && isThinkMode
    const activeMode = isYoutubeMode
      ? 'youtube'
      : isSearchEnabled
        ? 'search'
        : isThinkMode
          ? 'think'
          : 'default'

    const commands = [
      {
        cmd: '/search',
        desc: 'Force a web search',
        action: () => {
          setText('/search ')
          inputRef.current?.focus()
        }
      },
      {
        cmd: '/youtube',
        desc: 'Find and play a YouTube result',
        action: () => {
          setText('/youtube ')
          inputRef.current?.focus()
        }
      },
      {
        cmd: '/subagents',
        desc: 'Change the subagent model',
        action: () => {
          onOpenSubagentSettings?.()
          setText('')
          inputRef.current?.focus()
        }
      }
    ]

    const filteredCommands = text.startsWith('/')
      ? commands.filter((c) => c.cmd.toLowerCase().startsWith(text.toLowerCase().split(' ')[0]))
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

    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent): void => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          setIsSearchEnabled((prev) => !prev)
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
          e.preventDefault()
          if (selectedModel !== 'prism-4.3') {
            onThinkModeToggle?.(!isThinkMode)
          }
        }
      }
      window.addEventListener('keydown', handleGlobalKeyDown)
      return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [isThinkMode, onThinkModeToggle, selectedModel])

    useEffect(() => {
      if (!disabled) {
        inputRef.current?.focus()
      }
    }, [disabled])

    const handleSend = (): void => {
      if (text.trim() && !disabled) {
        const trimmedText = text.trim()

        if (trimmedText === '/subagents') {
          onOpenSubagentSettings?.()
          setText('')
          setTimeout(() => {
            inputRef.current?.focus()
          }, 0)
          return
        }

        let finalMessage = trimmedText
        if (trimmedText.startsWith('/search ')) {
          finalMessage = `[FORCE_SEARCH] ${trimmedText.substring(8).trim()}`
        } else if (trimmedText === '/search') {
          finalMessage = `[FORCE_SEARCH] `
        } else if (trimmedText !== '/clear') {
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
          setSlashSelectedIndex(
            (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length
          )
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
      if (isKeyMissing) return 'API key required'
      if (isProcessing) return 'Prism is responding'
      if (isYoutubeMode) return 'Search YouTube'
      if (isSearchEnabled) return 'Search the web with Prism'
      if (isThinkMode) return 'Ask Prism to think deeply'
      return 'Ask Prism'
    }

    const modeStyles = {
      youtube: 'border-red-400/30 bg-red-500/[0.045] text-red-300',
      search: isSearchAndThinkMode
        ? 'border-[#8ee8b0]/25 bg-[linear-gradient(110deg,rgba(45,212,191,0.055),rgba(245,158,11,0.06))] text-[#d9c77a]'
        : 'border-accent-secondary/30 bg-accent-secondary/[0.045] text-accent-secondary',
      think: 'border-status-warning/30 bg-status-warning/[0.045] text-status-warning',
      default: 'border-white/[0.09] bg-white/[0.035] text-text-primary'
    }[activeMode]

    return (
      <div className="relative z-20 w-full px-6 sm:px-12">
        {isYoutubeMode && (
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 h-28 w-28 -translate-x-1/2 opacity-[0.09] animate-fade-in">
            <img src={youtubeLogo} alt="YouTube" className="h-full w-full object-contain" />
          </div>
        )}

        {showSlashMenu && (
          <div className="premium-panel-soft mb-3 w-full overflow-hidden rounded-[22px] animate-soft-pop">
            <div className="border-b border-white/[0.055] px-4 py-3 text-xs font-semibold text-text-secondary/70">
              Slash commands
            </div>
            {filteredCommands.map((c, i) => (
              <button
                key={c.cmd}
                onClick={() => c.action()}
                onMouseEnter={() => setSlashSelectedIndex(i)}
                className={clsx(
                  'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-200',
                  slashSelectedIndex === i
                    ? 'bg-white/[0.065] text-text-primary'
                    : 'text-text-secondary hover:bg-white/[0.04]'
                )}
              >
                <span
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-2xl',
                    c.cmd === '/youtube'
                      ? 'bg-red-500/[0.12] text-red-300'
                      : c.cmd === '/subagents'
                        ? 'bg-accent-primary/[0.12] text-accent-primary'
                        : 'bg-accent-secondary/[0.12] text-accent-secondary'
                  )}
                >
                  {c.cmd === '/youtube' ? (
                    <CirclePlay size={16} />
                  ) : c.cmd === '/subagents' ? (
                    <Bot size={16} />
                  ) : (
                    <Search size={16} />
                  )}
                </span>
                <span className="font-semibold text-text-primary">{c.cmd}</span>
                <span className="text-xs text-text-secondary/70">{c.desc}</span>
              </button>
            ))}
          </div>
        )}

        <div
          className={clsx(
            'premium-panel relative flex items-end gap-2 overflow-hidden rounded-[28px] border p-2 transition-all duration-300',
            modeStyles,
            isFocused && !disabled && 'prism-glow',
            disabled && 'opacity-60'
          )}
        >
          {isKeyMissing && (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[28px] bg-background-main/35 backdrop-blur-sm">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-text-secondary">
                <Lock size={14} />
                API key required
              </div>
            </div>
          )}

          {!disabled && activeMode !== 'default' && (
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px overflow-hidden">
              <div
                className={clsx(
                  'h-px w-full opacity-80',
                  isSearchAndThinkMode
                    ? 'animate-[line-sweep_1800ms_cubic-bezier(0.2,0.82,0.2,1)_infinite] bg-gradient-to-r from-transparent via-accent-secondary to-status-warning'
                    : [
                        'bg-gradient-to-r from-transparent via-current to-transparent',
                        activeMode === 'think' &&
                          'animate-[line-sweep_2100ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                        activeMode === 'search' &&
                          'animate-[line-sweep_1500ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                        activeMode === 'youtube' &&
                          'animate-[line-sweep_1350ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                      ]
                )}
              />
            </div>
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
              'relative z-10 min-h-[48px] max-h-48 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] font-medium outline-none placeholder:text-text-muted disabled:cursor-not-allowed cursor-text',
              activeMode === 'youtube'
                ? 'text-red-200 placeholder:text-red-300/40'
                : isSearchAndThinkMode
                  ? 'text-[#d9c77a] placeholder:text-[#d9c77a]/45'
                  : activeMode === 'search'
                  ? 'text-accent-secondary placeholder:text-accent-secondary/40'
                  : activeMode === 'think'
                    ? 'text-status-warning placeholder:text-status-warning/40'
                    : 'text-text-primary'
            )}
            rows={1}
          />

          <div className="relative z-10 mb-0.5 mr-0.5 flex gap-2">
            <button
              onClick={() => {
                if (selectedModel !== 'prism-4.3') {
                  onThinkModeToggle?.(!isThinkMode)
                }
              }}
              disabled={disabled}
              title={
                selectedModel === 'prism-4.3'
                  ? 'Thinking mode required for Prism 4.3'
                  : 'Toggle Think Mode (Ctrl+T)'
              }
              className={clsx(
                'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-90',
                isThinkMode
                  ? 'border-status-warning/30 bg-status-warning/[0.12] text-status-warning'
                  : 'border-white/[0.07] bg-white/[0.035] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              <Brain size={18} className={clsx(isThinkMode && 'animate-slow-pulse')} />
              {selectedModel === 'prism-4.3' && (
                <Lock size={9} className="absolute bottom-1.5 right-1.5 text-status-warning" />
              )}
            </button>

            <button
              onClick={() => setIsSearchEnabled(!isSearchEnabled)}
              disabled={disabled}
              title="Toggle Web Search (Ctrl+S)"
              className={clsx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-90',
                isYoutubeMode
                  ? 'border-red-400/25 bg-red-500/[0.12] text-red-300'
                  : isSearchEnabled
                    ? 'border-accent-secondary/30 bg-accent-secondary/[0.12] text-accent-secondary'
                    : 'border-white/[0.07] bg-white/[0.035] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {isYoutubeMode ? (
                <CirclePlay size={18} />
              ) : (
                <Search size={18} className={clsx(isSearchEnabled && 'animate-slow-pulse')} />
              )}
            </button>

            {isProcessing ? (
              <button
                onClick={() => onCancel?.()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-status-error/25 bg-status-error/[0.12] text-status-error transition-all duration-200 hover:bg-status-error/[0.18] active:scale-95"
                title="Stop generation"
              >
                <Square size={17} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!text.trim() || disabled}
                className={clsx(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] transition-all duration-200',
                  text.trim() && !disabled
                    ? activeMode === 'youtube'
                      ? 'bg-red-400 text-black hover:bg-red-300 active:scale-95'
                      : activeMode === 'search'
                        ? 'bg-accent-secondary text-black hover:bg-accent-secondary/90 active:scale-95'
                        : activeMode === 'think'
                          ? 'bg-status-warning text-black hover:bg-status-warning/90 active:scale-95'
                          : 'bg-text-primary text-black hover:bg-white active:scale-95'
                    : 'bg-white/[0.055] text-text-muted'
                )}
              >
                <SendHorizontal size={18} />
              </button>
            )}
          </div>
        </div>

        {showModeBadge && activeBadges.length > 0 && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 flex justify-center gap-2 animate-soft-pop z-30">
            {activeBadges.map((badge) => (
              <span
                key={badge}
                className={clsx(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap',
                  isSearchAndThinkMode && badge !== 'youtube'
                    ? 'border-transparent bg-gradient-to-r from-accent-secondary/[0.12] via-[#b8d56e]/[0.11] to-status-warning/[0.13] text-[#d9c77a] shadow-[0_0_18px_rgba(245,158,11,0.08)]'
                    : badge === 'youtube'
                      ? 'border-red-400/20 bg-red-500/[0.06] text-red-300'
                      : badge === 'search'
                        ? 'border-accent-secondary/20 bg-accent-secondary/[0.06] text-accent-secondary'
                        : 'border-status-warning/20 bg-status-warning/[0.06] text-status-warning'
                )}
              >
                {badge === 'youtube' ? (
                  <CirclePlay size={13} />
                ) : badge === 'search' ? (
                  <Search size={13} />
                ) : (
                  <Brain size={13} />
                )}
                {badge === 'youtube'
                  ? 'YouTube command active'
                  : badge === 'search'
                    ? 'Search enabled'
                    : selectedModel === 'prism-4.3'
                      ? 'Think required'
                      : 'Thinking enabled'}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }
)

InputBar.displayName = 'InputBar'
