import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import {
  SendHorizontal,
  Search,
  Square,
  Brain,
  CirclePlay,
  Lock,
  Bot,
  Globe,
  Maximize2,
  Minimize2
} from 'lucide-react'
import clsx from 'clsx'

type InputBadge = 'youtube' | 'search' | 'think' | 'extended'

interface InputBarProps {
  onSend: (
    message: string,
    thinkMode?: boolean,
    searchEnabled?: boolean,
    extendedSearch?: boolean,
    screenshot?: string
  ) => void
  onCancel?: () => void
  disabled?: boolean
  isProcessing?: boolean
  isKeyMissing?: boolean
  isThinkMode?: boolean
  onThinkModeToggle?: (val: boolean) => void
  onOpenSubagentSettings?: () => void
  selectedModel?: string
  showModeBadge?: boolean
  text: string
  setText: (val: string) => void
  isSearchEnabled: boolean
  setIsSearchEnabled: (val: boolean) => void
  isExtendedSearch: boolean
  setIsExtendedSearch: (val: boolean) => void
  isFullscreen: boolean
  onFullscreenToggle: () => void
  screenshot?: string | null
  onRemoveScreenshot?: () => void
  onAttachScreenshot?: (base64: string) => void
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
      showModeBadge = true,
      text,
      setText,
      isSearchEnabled,
      setIsSearchEnabled,
      isExtendedSearch,
      setIsExtendedSearch,
      isFullscreen,
      onFullscreenToggle,
      screenshot,
      onRemoveScreenshot,
      onAttachScreenshot
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false)
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
    const [showFullscreenBtn, setShowFullscreenBtn] = useState(false)
    const [showSearchDropdown, setShowSearchDropdown] = useState(false)
    const [isWrapped, setIsWrapped] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const actionsRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const isYoutubeMode = text.startsWith('/youtube')
    const activeBadges: InputBadge[] = [
      ...(isYoutubeMode ? (['youtube'] as const) : []),
      ...(isExtendedSearch
        ? (['extended'] as const)
        : isSearchEnabled
          ? (['search'] as const)
          : []),
      ...(isThinkMode ? (['think'] as const) : [])
    ]
    const isSearchAndThinkMode = isSearchEnabled && isThinkMode
    const activeMode = isYoutubeMode
      ? 'youtube'
      : isExtendedSearch
        ? 'extended'
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
        desc: 'Find and play a video',
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

    // ResizeObserver for actions container and wrapping detection
    useEffect(() => {
      const actions = actionsRef.current
      const input = inputRef.current
      const container = containerRef.current
      if (!actions || !input || !container) return

      const observer = new ResizeObserver(() => {
        const aRect = actions.getBoundingClientRect()
        const iRect = input.getBoundingClientRect()

        // Detect wrapping by comparing vertical positions
        // We use a small threshold (20px) to avoid jitter during resize
        const wrapped = aRect.top > iRect.top + 20
        setIsWrapped(wrapped)
      })

      observer.observe(actions)
      observer.observe(container)
      return () => observer.disconnect()
    }, [])

    // Textarea height auto-resizer and Scroll Detection
    useEffect(() => {
      const textarea = inputRef.current
      if (!textarea) return

      if (!isFullscreen) {
        // Reset height to get correct scrollHeight
        textarea.style.height = 'auto'
        const nextHeight = Math.max(64, Math.min(textarea.scrollHeight, 300))
        textarea.style.height = `${nextHeight}px`

        if (textarea.scrollHeight > 300) {
          textarea.style.overflowY = 'auto'
        } else {
          textarea.style.overflowY = 'hidden'
        }

        const hasScroll =
          textarea.scrollHeight > 300 ||
          (textarea.scrollHeight > textarea.clientHeight && textarea.clientHeight >= 280)
        setShowFullscreenBtn(hasScroll)
      } else {
        textarea.style.height = '100%'
        textarea.style.overflowY = 'auto'
        setShowFullscreenBtn(false)
      }
    }, [text, isFullscreen, isFocused])

    // Escape key listener for fullscreen mode
    useEffect(() => {
      if (!isFullscreen) return
      const handleEsc = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onFullscreenToggle()
        }
      }
      window.addEventListener('keydown', handleEsc)
      return () => window.removeEventListener('keydown', handleEsc)
    }, [isFullscreen, onFullscreenToggle])

    // Global keyboard shortcuts (Ctrl+S, Ctrl+E, Ctrl+T)
    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent): void => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          const nextVal = !isSearchEnabled
          setIsSearchEnabled(nextVal)
          if (!nextVal) {
            setIsExtendedSearch(false)
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault()
          const nextVal = !isExtendedSearch
          setIsExtendedSearch(nextVal)
          if (nextVal) {
            setIsSearchEnabled(true)
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
          e.preventDefault()
          onThinkModeToggle?.(!isThinkMode)
        }
      }
      window.addEventListener('keydown', handleGlobalKeyDown)
      return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [
      isThinkMode,
      onThinkModeToggle,
      selectedModel,
      isSearchEnabled,
      isExtendedSearch,
      setIsSearchEnabled,
      setIsExtendedSearch
    ])

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent): void => {
        const isClickInsideDropdown =
          dropdownRef.current && dropdownRef.current.contains(event.target as Node)
        const isClickOnButton =
          buttonRef.current && buttonRef.current.contains(event.target as Node)

        if (!isClickInsideDropdown && !isClickOnButton) {
          setShowSearchDropdown(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
      if (!disabled) {
        inputRef.current?.focus()
      }
    }, [disabled])

    const handleSend = (): void => {
      if ((text.trim() || screenshot) && !disabled) {
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
        } else if (trimmedText !== '/clear' && trimmedText !== '') {
          finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${trimmedText}` : trimmedText
        }

        onSend(
          finalMessage,
          isThinkMode,
          isSearchEnabled,
          isExtendedSearch,
          screenshot || undefined
        )
        setText('')

        if (isFullscreen) {
          onFullscreenToggle()
        }

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

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      if (disabled) return
      const items = e.clipboardData.items
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile()
          if (file && onAttachScreenshot) {
            const reader = new FileReader()
            reader.onload = (event) => {
              if (event.target?.result) {
                const base64 = (event.target.result as string).split(',')[1]
                onAttachScreenshot(base64)
              }
            }
            reader.readAsDataURL(file)
          }
        }
      }
    }



    const getPlaceholder = (): string => {
      if (isKeyMissing) return 'API key required'
      if (isProcessing) return 'Prism is responding'
      if (isYoutubeMode) return 'Search and play videos'
      if (isExtendedSearch) return 'Search deeply with Extended Search'
      if (isSearchEnabled) return 'Search the web with Prism'
      if (isThinkMode) return 'Ask Prism to think deeply'
      return 'Ask Prism'
    }

    const modeStyles = {
      youtube: 'border-accent-primary/30 bg-accent-primary/[0.045] text-accent-primary',
      extended: 'border-accent-primary/35 bg-accent-primary/[0.045] text-accent-primary',
      search: isSearchAndThinkMode
        ? 'border-[#8ee8b0]/25 bg-[linear-gradient(110deg,rgba(45,212,191,0.055),rgba(245,158,11,0.06))] text-[#d9c77a]'
        : 'border-accent-secondary/30 bg-accent-secondary/[0.045] text-accent-secondary',
      think: 'border-status-warning/30 bg-status-warning/[0.045] text-status-warning',
      default: 'border-white/[0.09] bg-white/[0.035] text-text-primary'
    }[activeMode]

    if (isFullscreen) {
      return (
        <div className="flex-1 flex flex-col w-full h-full p-6 animate-fade-in relative z-20">
          {/* Custom header */}
          <div className="flex items-center justify-between border-b border-white/[0.055] pb-4 mb-4 select-none">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-text-primary">Message Editor</h2>
              {isExtendedSearch && (
                <span className="rounded-full border border-accent-primary/20 bg-accent-primary/[0.06] px-2.5 py-1 text-xs font-semibold text-accent-primary flex items-center gap-1.5 shadow-[0_0_18px_rgba(143,180,255,0.08)]">
                  <Globe size={12} className="animate-[spin_12s_linear_infinite]" />
                  Extended Search
                </span>
              )}
              {!isExtendedSearch && isSearchEnabled && (
                <span className="rounded-full border border-accent-secondary/20 bg-accent-secondary/[0.06] px-2.5 py-1 text-xs font-semibold text-accent-secondary flex items-center gap-1.5">
                  <Search size={12} />
                  Search enabled
                </span>
              )}
              {isThinkMode && (
                <span className="rounded-full border border-status-warning/20 bg-status-warning/[0.06] px-2.5 py-1 text-xs font-semibold text-status-warning flex items-center gap-1.5">
                  <Brain size={12} className="animate-slow-pulse" />
                  Thinking enabled
                </span>
              )}
            </div>
            <button
              onClick={onFullscreenToggle}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-all duration-200 active:scale-95"
              title="Exit fullscreen"
            >
              <Minimize2 size={14} />
              Minimize
            </button>
          </div>

          {/* Large panel containing textarea */}
          <div
            className={clsx(
              'premium-panel flex-1 flex flex-col rounded-[24px] border p-4 transition-all duration-300 relative input-border-glow',
              modeStyles,
              isFocused && 'prism-glow active',
              disabled && 'opacity-60'
            )}
          >
            {screenshot && (
              <div className="relative mb-3 flex items-center justify-start self-start bg-white/[0.03] border border-white/[0.08] p-1.5 rounded-xl pr-8 animate-soft-pop group/thumb">
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt="Screenshot preview"
                  className="h-14 w-auto rounded-lg object-cover shadow-md border border-white/10"
                />
                <button
                  type="button"
                  onClick={onRemoveScreenshot}
                  className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-text-secondary hover:text-white transition-colors text-xs font-bold leading-none cursor-pointer"
                >
                  &times;
                </button>
              </div>
            )}
            {showSearchDropdown && !disabled && (
              <div
                ref={dropdownRef}
                className="absolute bottom-24 right-4 z-[60] w-72 rounded-2xl border border-white/[0.12] bg-background-main p-2 shadow-2xl animate-soft-pop text-left opacity-100"
              >
                <div className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary/70 border-b border-white/[0.04] mb-1">
                  Web Search Mode
                </div>
                <button
                  onClick={() => {
                    setIsSearchEnabled(true)
                    setIsExtendedSearch(false)
                    setShowSearchDropdown(false)
                  }}
                  className={clsx(
                    'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left',
                    isSearchEnabled && !isExtendedSearch
                      ? 'bg-accent-secondary/[0.12] text-accent-secondary border border-accent-secondary/20'
                      : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                  )}
                >
                  <div className="font-semibold text-xs text-text-primary">Default</div>
                  <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
                    Search on Web in Default Mode. Commonly faster.
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsSearchEnabled(true)
                    setIsExtendedSearch(true)
                    setShowSearchDropdown(false)
                  }}
                  className={clsx(
                    'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left mt-1',
                    isSearchEnabled && isExtendedSearch
                      ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                      : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                  )}
                >
                  <div className="font-semibold text-xs text-text-primary">Extended</div>
                  <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
                    Super deep grounding and analisys for ultra-detailed outputs. Can be very slow.
                  </div>
                </button>

                <button
                  onClick={() => {
                    setText('/youtube ')
                    setIsSearchEnabled(false)
                    setIsExtendedSearch(false)
                    setShowSearchDropdown(false)
                    setTimeout(() => inputRef.current?.focus(), 50)
                  }}
                  className={clsx(
                    'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left mt-1',
                    isYoutubeMode
                      ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                      : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                  )}
                >
                  <div className="font-semibold text-xs text-text-primary">YouTube</div>
                  <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
                    Search for videos in YouTube with AI and open in your Browser
                  </div>
                </button>

                {(isSearchEnabled || isYoutubeMode) && (
                  <button
                    onClick={() => {
                      setIsSearchEnabled(false)
                      setIsExtendedSearch(false)
                      if (isYoutubeMode) {
                        setText(text.replace(/^\/youtube\s*/i, ''))
                      }
                      setShowSearchDropdown(false)
                    }}
                    className="w-full mt-2 rounded-xl px-3 py-2 text-xs font-semibold text-center text-status-error hover:bg-status-error/[0.08] transition-all border border-transparent hover:border-status-error/10"
                  >
                    Disable Search
                  </button>
                )}
              </div>
            )}
            {/* Background line sweep for active modes */}

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
                          activeMode === 'extended' &&
                            'animate-[line-sweep_1200ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                          activeMode === 'youtube' &&
                            'animate-[line-sweep_1350ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                        ]
                  )}
                />
              </div>
            )}

            {isKeyMissing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[24px] bg-background-main/35 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-text-secondary">
                  <Lock size={14} />
                  API key required
                </div>
              </div>
            )}

            {showSlashMenu && (
              <div className="premium-panel-soft mb-3 w-full overflow-hidden rounded-[22px] animate-soft-pop z-30">
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
                          ? 'bg-accent-primary/[0.12] text-accent-primary'
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

            <div className="flex-1 relative flex flex-col">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e): void => setText(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={getPlaceholder()}
                disabled={disabled}
                className={clsx(
                  'w-full flex-1 resize-none bg-transparent px-4 py-3 text-lg font-medium outline-none border-0 border-transparent m-0 shadow-none leading-relaxed placeholder:text-text-muted disabled:cursor-not-allowed cursor-text text-text-primary selection:bg-accent-primary/30 whitespace-pre-wrap break-words',
                  isSearchAndThinkMode ? 'caret-[#d9c77a]' : 
                  activeMode === 'search' ? 'caret-accent-secondary' : 
                  activeMode === 'think' ? 'caret-status-warning' : 
                  activeMode !== 'default' ? 'caret-accent-primary' : 'caret-white'
                )}
              />
            </div>

            {/* Fullscreen footer */}
            <div className="mt-3 pt-3 border-t border-white/[0.055] flex items-center justify-between select-none">
              <div className="text-xs text-text-muted font-medium">
                {text.length} characters | Press{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Esc</kbd>{' '}
                to exit |{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Enter</kbd>{' '}
                to send
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onThinkModeToggle?.(!isThinkMode)
                  }}
                  disabled={disabled}
                  title="Toggle Think Mode (Ctrl+T)"
                  className={clsx(
                    'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-90',
                    isThinkMode
                      ? 'border-status-warning/30 bg-status-warning/[0.12] text-status-warning'
                      : 'border-white/[0.07] bg-white/[0.035] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary',
                    disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <Brain size={18} className={clsx(isThinkMode && 'animate-slow-pulse')} />
                </button>

                <div className="relative">
                  <button
                    ref={buttonRef}
                    onClick={() => setShowSearchDropdown(!showSearchDropdown)}
                    disabled={disabled}
                    title="Search Mode"
                    className={clsx(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-90',
                      isYoutubeMode
                        ? 'border-accent-primary/25 bg-accent-primary/[0.12] text-accent-primary'
                        : isSearchEnabled
                          ? isExtendedSearch
                            ? 'border-accent-primary/30 bg-accent-primary/[0.12] text-accent-primary shadow-[0_0_12px_rgba(143,180,255,0.15)]'
                            : 'border-accent-secondary/30 bg-accent-secondary/[0.12] text-accent-secondary shadow-[0_0_12px_rgba(184,213,110,0.15)]'
                          : 'border-white/[0.07] bg-white/[0.035] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary',
                      disabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    {isYoutubeMode ? (
                      <CirclePlay size={18} />
                    ) : isExtendedSearch ? (
                      <Globe
                        size={18}
                        className={clsx(isSearchEnabled && 'animate-[spin_12s_linear_infinite]')}
                      />
                    ) : (
                      <Search size={18} className={clsx(isSearchEnabled && 'animate-slow-pulse')} />
                    )}
                  </button>
                </div>

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
                    disabled={(!text.trim() && !screenshot) || disabled}
                    className={clsx(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] transition-all duration-200',
                      text.trim() && !disabled
                        ? activeMode === 'youtube'
                          ? 'bg-accent-primary text-black hover:bg-accent-primary/90 active:scale-95'
                          : activeMode === 'extended'
                            ? 'bg-accent-primary text-black hover:bg-accent-primary/90 active:scale-95'
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
          </div>
        </div>
      )
    }

    return (
      <div className="relative z-20 w-full max-w-4xl mx-auto px-6 sm:px-12">
        {showFullscreenBtn && (
          <button
            onClick={onFullscreenToggle}
            className="absolute -top-10 left-6 sm:left-12 flex items-center gap-1.5 rounded-full border border-white/10 bg-background-secondary/90 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-all duration-200 shadow-md backdrop-blur-md animate-soft-pop z-30"
          >
            <Maximize2 size={13} />
            Fullscreen
          </button>
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
                      ? 'bg-accent-primary/[0.12] text-accent-primary'
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

        <div className="relative">
          {showSearchDropdown && !disabled && (
            <div
              ref={dropdownRef}
              className="absolute bottom-full right-0 mb-4 z-50 w-72 rounded-2xl border border-white/[0.12] bg-background-main p-2 shadow-2xl animate-soft-pop text-left opacity-100"
            >
              <div className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary/70 border-b border-white/[0.04] mb-1">
                Web Search Mode
              </div>
              <button
                onClick={() => {
                  setIsSearchEnabled(true)
                  setIsExtendedSearch(false)
                  setShowSearchDropdown(false)
                }}
                className={clsx(
                  'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left',
                  isSearchEnabled && !isExtendedSearch
                    ? 'bg-accent-secondary/[0.12] text-accent-secondary border border-accent-secondary/20'
                    : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                )}
              >
                <div className="font-semibold text-xs text-text-primary">Default</div>
                <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
                  Search on Web in Default Mode. Commonly faster.
                </div>
              </button>

              <button
                onClick={() => {
                  setIsSearchEnabled(true)
                  setIsExtendedSearch(true)
                  setShowSearchDropdown(false)
                }}
                className={clsx(
                  'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left mt-1',
                  isSearchEnabled && isExtendedSearch
                    ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                    : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                )}
              >
                <div className="font-semibold text-xs text-text-primary">Extended</div>
                <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
                  Super deep grounding and analisys for ultra-detailed outputs. Can be very slow.
                </div>
              </button>

              <button
                onClick={() => {
                  setText('/youtube ')
                  setIsSearchEnabled(false)
                  setIsExtendedSearch(false)
                  setShowSearchDropdown(false)
                  setTimeout(() => inputRef.current?.focus(), 50)
                }}
                className={clsx(
                  'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left mt-1',
                  isYoutubeMode
                    ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                    : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                )}
              >
                <div className="font-semibold text-xs text-text-primary">YouTube</div>
                <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
                  Search for videos in YouTube with AI and open in your Browser
                </div>
              </button>

              {(isSearchEnabled || isYoutubeMode) && (
                <button
                  onClick={() => {
                    setIsSearchEnabled(false)
                    setIsExtendedSearch(false)
                    if (isYoutubeMode) {
                      setText(text.replace(/^\/youtube\s*/i, ''))
                    }
                    setShowSearchDropdown(false)
                  }}
                  className="w-full mt-2 rounded-xl px-3 py-2 text-xs font-semibold text-center text-status-error hover:bg-status-error/[0.08] transition-all border border-transparent hover:border-status-error/10"
                >
                  Disable Search
                </button>
              )}
            </div>
          )}

          <div
            ref={containerRef}
            className={clsx(
              'premium-panel relative rounded-[32px] border transition-all duration-300 input-border-glow flex flex-wrap items-end overflow-hidden',
              modeStyles,
              isFocused && !disabled && 'prism-glow active',
              disabled && 'opacity-60'
            )}
          >
            {screenshot && (
              <div className="w-full px-8 pt-4 pb-2 border-b border-white/[0.03] bg-white/[0.01] flex items-center justify-start relative animate-soft-pop select-none">
                <div className="relative group/thumb">
                  <img
                    src={`data:image/png;base64,${screenshot}`}
                    alt="Screenshot preview"
                    className="h-14 w-auto rounded-lg object-cover shadow-md border border-white/10"
                  />
                  <button
                    type="button"
                    onClick={onRemoveScreenshot}
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-text-secondary hover:text-white transition-colors text-xs font-bold leading-none cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}
            {isKeyMissing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background-main/35 backdrop-blur-sm">
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
                          activeMode === 'extended' &&
                            'animate-[line-sweep_1200ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                          activeMode === 'youtube' &&
                            'animate-[line-sweep_1350ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                        ]
                  )}
                />
              </div>
            )}

            <div className="flex-1 relative flex items-center min-w-[280px] self-stretch overflow-hidden">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e): void => setText(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={getPlaceholder()}
                disabled={disabled}
                className={clsx(
                  'relative z-10 w-full resize-none bg-transparent pl-8 pr-8 py-5 text-base font-medium outline-none border-0 border-transparent m-0 shadow-none leading-relaxed placeholder:text-text-muted disabled:cursor-not-allowed cursor-text block min-h-[64px] max-h-[300px] text-text-primary selection:bg-accent-primary/30 whitespace-pre-wrap break-words',
                  isWrapped && 'pb-2',
                  isSearchAndThinkMode ? 'caret-[#d9c77a]' : 
                  activeMode === 'search' ? 'caret-accent-secondary' : 
                  activeMode === 'think' ? 'caret-status-warning' : 
                  activeMode !== 'default' ? 'caret-accent-primary' : 'caret-white'
                )}
                rows={1}
              />
            </div>

            <div
              ref={actionsRef}
              className={clsx(
                'flex items-center gap-2.5 pl-4 pr-6 pb-2.5 pt-2.5 relative z-20 ml-auto transition-all duration-300 pointer-events-auto',
                isWrapped
                  ? 'w-full justify-end border-t border-white/[0.03] bg-white/[0.01]'
                  : 'h-full'
              )}
            >
              <button
                onClick={() => {
                  onThinkModeToggle?.(!isThinkMode)
                }}
                disabled={disabled}
                title="Toggle Think Mode (Ctrl+T)"
                className={clsx(
                  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-90',
                  isThinkMode
                    ? 'border-status-warning/30 bg-status-warning/[0.12] text-status-warning'
                    : 'border-white/[0.07] bg-white/[0.035] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
              >
                <Brain size={18} className={clsx(isThinkMode && 'animate-slow-pulse')} />
              </button>

              <div className="relative">
                <button
                  ref={buttonRef}
                  onClick={() => setShowSearchDropdown(!showSearchDropdown)}
                  disabled={disabled}
                  title="Search Mode"
                  className={clsx(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border transition-all duration-200 active:scale-90',
                    isYoutubeMode
                      ? 'border-accent-primary/25 bg-accent-primary/[0.12] text-accent-primary'
                      : isSearchEnabled
                        ? isExtendedSearch
                          ? 'border-accent-primary/30 bg-accent-primary/[0.12] text-accent-primary shadow-[0_0_12px_rgba(143,180,255,0.15)]'
                          : 'border-accent-secondary/30 bg-accent-secondary/[0.12] text-accent-secondary shadow-[0_0_12px_rgba(184,213,110,0.15)]'
                        : 'border-white/[0.07] bg-white/[0.035] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary',
                    disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  {isYoutubeMode ? (
                    <CirclePlay size={18} />
                  ) : isExtendedSearch ? (
                    <Globe
                      size={18}
                      className={clsx(isSearchEnabled && 'animate-[spin_12s_linear_infinite]')}
                    />
                  ) : (
                    <Search size={18} className={clsx(isSearchEnabled && 'animate-slow-pulse')} />
                  )}
                </button>
              </div>

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
                  disabled={(!text.trim() && !screenshot) || disabled}
                  className={clsx(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] transition-all duration-200',
                    text.trim() && !disabled
                      ? activeMode === 'youtube'
                        ? 'bg-accent-primary text-black hover:bg-accent-primary/90 active:scale-95'
                        : activeMode === 'extended'
                          ? 'bg-accent-primary text-black hover:bg-accent-primary/90 active:scale-95'
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
        </div>
        {showModeBadge && activeBadges.length > 0 && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 flex justify-center gap-2 animate-soft-pop z-30">
            {activeBadges.map((badge) => (
              <span
                key={badge}
                className={clsx(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap',
                  isSearchAndThinkMode && badge !== 'youtube' && badge !== 'extended'
                    ? 'border-transparent bg-gradient-to-r from-accent-secondary/[0.12] via-[#b8d56e]/[0.11] to-status-warning/[0.13] text-[#d9c77a] shadow-[0_0_18px_rgba(245,158,11,0.08)]'
                    : badge === 'youtube'
                      ? 'border-accent-primary/20 bg-accent-primary/[0.06] text-accent-primary'
                      : badge === 'extended'
                        ? 'border-accent-primary/20 bg-accent-primary/[0.06] text-accent-primary shadow-[0_0_18px_rgba(143,180,255,0.08)]'
                        : badge === 'search'
                          ? 'border-accent-secondary/20 bg-accent-secondary/[0.06] text-accent-secondary'
                          : 'border-status-warning/20 bg-status-warning/[0.06] text-status-warning'
                )}
              >
                {badge === 'youtube' ? (
                  <CirclePlay size={13} />
                ) : badge === 'extended' ? (
                  <Globe size={13} className="animate-[spin_12s_linear_infinite]" />
                ) : badge === 'search' ? (
                  <Search size={13} />
                ) : (
                  <Brain size={13} />
                )}
                {badge === 'youtube'
                  ? 'Video search active'
                  : badge === 'extended'
                    ? 'Extended Search active'
                    : badge === 'search'
                      ? 'Search enabled'
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
