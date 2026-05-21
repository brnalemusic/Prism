import { useState, useEffect, useRef } from 'react'
import { Command, ChevronRight, Cpu, Search, Brain, CirclePlay, Check, Bot } from 'lucide-react'
import { MODELS } from '../constants'
import { isShortcutPressed } from '../utils'
import youtubeLogo from '../assets/youtube.png'
import clsx from 'clsx'

type LauncherBadge = 'youtube' | 'search' | 'think'

export function QuickLauncher(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isThinkMode, setIsThinkMode] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [activeModelId, setActiveModelId] = useState('prism-5')
  const [shortcut, setShortcut] = useState('CommandOrControl+M')
  const inputRef = useRef<HTMLInputElement>(null)

  const isYoutubeMode = query.startsWith('/youtube')
  const activeMode = isYoutubeMode
    ? 'youtube'
    : isSearchEnabled
      ? 'search'
      : isThinkMode
        ? 'think'
        : 'default'
  const activeBadges: LauncherBadge[] = [
    ...(isYoutubeMode ? (['youtube'] as const) : []),
    ...(isSearchEnabled ? (['search'] as const) : []),
    ...(isThinkMode ? (['think'] as const) : [])
  ]
  const isSearchAndThinkMode = isSearchEnabled && isThinkMode
  const activeModel = MODELS.find((m) => m.id === activeModelId) || MODELS[0]

  const commands = [
    {
      cmd: '/search',
      desc: 'Force a web search',
      action: () => {
        setQuery('/search ')
        inputRef.current?.focus()
      }
    },
    {
      cmd: '/youtube',
      desc: 'Find and play a YouTube result',
      action: () => {
        setQuery('/youtube ')
        inputRef.current?.focus()
      }
    },
    {
      cmd: '/subagents',
      desc: 'Change the subagent model',
      action: () => {
        window.api.openSubagentSettingsWindow()
        window.api.hideLauncher()
        setQuery('')
      }
    }
  ]

  const filteredCommands = query.startsWith('/')
    ? commands.filter((c) => c.cmd.toLowerCase().startsWith(query.toLowerCase().split(' ')[0]))
    : []

  const showSlashMenu = query.startsWith('/') && filteredCommands.length > 0 && !query.includes(' ')

  useEffect(() => {
    if (showSlashMenu) setSlashSelectedIndex(0)
  }, [showSlashMenu, query])

  useEffect(() => {
    window.api.getConfig().then((config) => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
      if (config.defaultModel) {
        setActiveModelId(config.defaultModel)
      }
    })

    window.api.onConfigChanged((config) => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
      if (config.defaultModel) {
        setActiveModelId(config.defaultModel)
      }
    })

    window.api.onModelChanged((modelId) => {
      setActiveModelId(modelId)
    })
  }, [])

  useEffect(() => {
    const handleInitialFocus = (): void => {
      setIsThinkMode(false)
      setIsSearchEnabled(false)

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const len = inputRef.current.value.length
          inputRef.current.setSelectionRange(len, len)
        }
      }, 50)
    }

    handleInitialFocus()
    const removeFocusListener = window.api.onLauncherFocus(handleInitialFocus)

    return () => {
      removeFocusListener()
    }
  }, [])

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isShortcutPressed(e, shortcut)) {
        e.preventDefault()
        setIsModelSelectorOpen((prev) => !prev)
        setSelectedIndex(
          Math.max(
            0,
            MODELS.findIndex((m) => m.id === activeModelId)
          )
        )
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        setIsSearchEnabled((prev) => !prev)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setIsThinkMode((prev) => !prev)
        return
      }

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
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setQuery('')
        }
        return
      }

      if (isModelSelectorOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % MODELS.length)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + MODELS.length) % MODELS.length)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const selectedModel = MODELS[selectedIndex]
          setActiveModelId(selectedModel.id)
          window.api.setModel(selectedModel.id)
          setIsModelSelectorOpen(false)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setIsModelSelectorOpen(false)
        }
        return
      }

      if (e.key === 'Escape') {
        window.api.hideLauncher()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.api.removeLauncherListeners()
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.background = ''
      document.documentElement.style.background = ''
    }
  }, [
    isModelSelectorOpen,
    selectedIndex,
    activeModelId,
    shortcut,
    showSlashMenu,
    slashSelectedIndex,
    query,
    filteredCommands
  ])

  const buildMessage = (): string => {
    const trimmed = query.trim()
    if (trimmed.startsWith('/search ')) return `[FORCE_SEARCH] ${trimmed.substring(8).trim()}`
    if (trimmed === '/search') return '[FORCE_SEARCH] '
    return isSearchEnabled ? `[FORCE_SEARCH] ${trimmed}` : trimmed
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (query.trim()) {
      if (query.trim() === '/subagents') {
        window.api.openSubagentSettingsWindow()
        window.api.hideLauncher()
        setQuery('')
        return
      }

      window.api.submitLauncher({ message: buildMessage(), thinkMode: isThinkMode })
      setQuery('')
    }
  }

  const modeClasses = {
    youtube: 'border-red-400/30 bg-red-500/[0.055] text-red-300',
    search: isSearchAndThinkMode
      ? 'border-[#8ee8b0]/25 bg-[linear-gradient(110deg,rgba(45,212,191,0.06),rgba(245,158,11,0.065))] text-[#d9c77a]'
      : 'border-accent-secondary/30 bg-accent-secondary/[0.055] text-accent-secondary',
    think: 'border-status-warning/30 bg-status-warning/[0.055] text-status-warning',
    default: 'border-white/[0.09] bg-white/[0.045] text-text-primary'
  }[activeMode]

  return (
    <div
      className="flex h-screen w-screen flex-col items-center justify-start bg-transparent p-8 pt-[20vh] font-sans"
      onClick={() => window.api.hideLauncher()}
    >
      <div className="relative w-full max-w-[720px]" onClick={(e) => e.stopPropagation()}>
        {isYoutubeMode && (
          <div className="pointer-events-none absolute left-1/2 top-full z-0 mt-5 h-36 w-36 -translate-x-1/2 opacity-[0.08] animate-fade-in">
            <img src={youtubeLogo} alt="YouTube" className="h-full w-full object-contain" />
          </div>
        )}

        <div
          className={clsx(
            'absolute -top-12 left-1/2 z-40 flex -translate-x-1/2 items-center justify-center gap-2 transition-all duration-200',
            activeBadges.length === 0
              ? 'pointer-events-none translate-y-2 opacity-0'
              : 'translate-y-0 opacity-100'
          )}
        >
          {activeBadges.map((badge) => (
            <span
              key={badge}
              className={clsx(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap',
                isSearchAndThinkMode && badge !== 'youtube'
                  ? 'border-transparent bg-gradient-to-r from-accent-secondary/[0.14] via-[#b8d56e]/[0.12] to-status-warning/[0.15] text-[#d9c77a] shadow-[0_0_22px_rgba(245,158,11,0.09)]'
                  : badge === 'youtube'
                    ? 'border-red-400/20 bg-red-500/[0.08] text-red-300'
                    : badge === 'search'
                      ? 'border-accent-secondary/20 bg-accent-secondary/[0.08] text-accent-secondary'
                      : 'border-status-warning/20 bg-status-warning/[0.08] text-status-warning'
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
                  : 'Thinking enabled'}
            </span>
          ))}
        </div>

        <div
          className={clsx(
            'model-menu-panel absolute left-0 top-full z-50 mt-3 w-80 origin-top overflow-hidden rounded-[24px] py-2 transition-all duration-200',
            isModelSelectorOpen
              ? 'translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0'
          )}
        >
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-xs font-semibold text-text-secondary/70">
            <Cpu size={14} className="text-accent-primary" />
            Prism engines
          </div>
          {MODELS.map((model, index) => (
            <button
              key={model.id}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => {
                setActiveModelId(model.id)
                window.api.setModel(model.id)
                setIsModelSelectorOpen(false)
              }}
              className={clsx(
                'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-all duration-200',
                model.id === 'prism-5'
                  ? [
                      'prism-5-model-option prism-5-menu-option',
                      selectedIndex === index && 'prism-5-model-option-active'
                    ]
                  : selectedIndex === index
                    ? 'bg-white/[0.065]'
                    : 'hover:bg-white/[0.04]'
              )}
            >
              <span
                className={clsx(
                  'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                  model.id === 'prism-5'
                    ? ['prism-5-dot', activeModelId === model.id ? 'opacity-100' : 'opacity-70']
                    : activeModelId === model.id
                      ? 'bg-accent-secondary'
                      : 'bg-white/[0.18]'
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={clsx(
                    'block text-sm font-semibold',
                    model.id === 'prism-5' ? 'prism-5-title-gradient' : 'text-text-primary'
                  )}
                >
                  {model.name}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-text-secondary/70">
                  {model.description}
                </span>
              </span>
              {activeModelId === model.id && (
                <Check size={15} className="mt-0.5 text-accent-secondary" />
              )}
            </button>
          ))}
        </div>

        <div
          className={clsx(
            'premium-panel relative flex w-full items-center gap-4 overflow-hidden rounded-[30px] border px-4 py-4 transition-all duration-300',
            modeClasses,
            isModelSelectorOpen && 'prism-glow'
          )}
        >
          {activeMode !== 'default' && (
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px overflow-hidden">
              <div
                className={clsx(
                  'h-px w-full animate-[line-sweep_1600ms_cubic-bezier(0.2,0.82,0.2,1)_infinite] opacity-80',
                  isSearchAndThinkMode
                    ? 'bg-gradient-to-r from-transparent via-accent-secondary to-status-warning'
                    : 'bg-gradient-to-r from-transparent via-current to-transparent'
                )}
              />
            </div>
          )}

          <button
            onClick={() => {
              setIsModelSelectorOpen(!isModelSelectorOpen)
              setSelectedIndex(
                Math.max(
                  0,
                  MODELS.findIndex((m) => m.id === activeModelId)
                )
              )
            }}
            className={clsx(
              'flex h-10 shrink-0 items-center gap-2 rounded-[16px] border px-3 text-sm font-semibold transition-all duration-200',
              isModelSelectorOpen
                ? 'border-accent-primary/35 bg-accent-primary/[0.12] text-accent-primary'
                : 'border-white/[0.08] bg-white/[0.045] text-text-secondary hover:bg-white/[0.07] hover:text-text-primary'
            )}
          >
            <Command size={15} />
            <span
              className={activeModel.id === 'prism-5' ? 'prism-top-gradient' : 'text-text-primary'}
            >
              {activeModel.name.replace('Prism ', '')}
            </span>
            <ChevronRight
              size={15}
              className={clsx(
                'transition-transform duration-200',
                isModelSelectorOpen && 'rotate-90'
              )}
            />
          </button>

          <form onSubmit={handleSubmit} className="relative z-10 flex-1">
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isModelSelectorOpen
                  ? 'Select a Prism model'
                  : isYoutubeMode
                    ? 'Search YouTube'
                    : isSearchEnabled
                      ? 'Search the web'
                      : isThinkMode
                        ? 'Think with Prism'
                        : 'What should Prism do?'
              }
              className={clsx(
                'w-full border-none bg-transparent text-[22px] font-medium outline-none transition-colors duration-200 placeholder:text-text-muted',
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
            />
          </form>

          {activeBadges.length > 0 && (
            <div
              className={clsx(
                'relative z-10 flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[16px] border px-2',
                isSearchAndThinkMode
                  ? 'border-transparent bg-gradient-to-r from-accent-secondary/[0.13] to-status-warning/[0.15] text-[#d9c77a]'
                  : 'border-current/20 bg-current/[0.08]'
              )}
            >
              {activeBadges.map((badge) =>
                badge === 'youtube' ? (
                  <CirclePlay key={badge} size={19} />
                ) : badge === 'search' ? (
                  <Search key={badge} size={19} className="animate-slow-pulse" />
                ) : (
                  <Brain key={badge} size={19} className="animate-slow-pulse" />
                )
              )}
            </div>
          )}
        </div>

        {showSlashMenu && (
          <div className="premium-panel-soft absolute left-0 top-[calc(100%+12px)] z-50 w-80 overflow-hidden rounded-[24px] animate-soft-pop">
            <div className="border-b border-white/[0.055] px-4 py-3 text-xs font-semibold text-text-secondary/70">
              Slash commands
            </div>
            <div className="py-1">
              {filteredCommands.map((c, i) => (
                <button
                  key={c.cmd}
                  onClick={() => c.action()}
                  onMouseEnter={() => setSlashSelectedIndex(i)}
                  className={clsx(
                    'flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors',
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
          </div>
        )}
      </div>
    </div>
  )
}
