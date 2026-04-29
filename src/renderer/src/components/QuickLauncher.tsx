import { useState, useEffect, useRef } from 'react'
import { Command, ChevronRight, Cpu, Globe, Brain } from 'lucide-react'
import { MODELS } from '../constants'
import { isShortcutPressed } from '../utils'
import youtubeLogo from '../assets/youtube.png'
import clsx from 'clsx'

export function QuickLauncher(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isThinkMode, setIsThinkMode] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [activeModelId, setActiveModelId] = useState('prism-3')
  const [shortcut, setShortcut] = useState('CommandOrControl+M')
  const inputRef = useRef<HTMLInputElement>(null)

  const isYoutubeMode = query.startsWith('/youtube')

  const commands = [
    { cmd: '/search', desc: 'Force web search', action: () => { setQuery('/search '); inputRef.current?.focus() } },
    { cmd: '/youtube', desc: 'YouTube search & play', action: () => { setQuery('/youtube '); inputRef.current?.focus() } }
  ]

  const filteredCommands = query.startsWith('/') 
    ? commands.filter(c => c.cmd.toLowerCase().startsWith(query.toLowerCase().split(' ')[0]))
    : []

  const showSlashMenu = query.startsWith('/') && filteredCommands.length > 0 && !query.includes(' ')

  useEffect(() => {
    if (showSlashMenu) setSlashSelectedIndex(0)
  }, [showSlashMenu, query])

  useEffect(() => {
    // Initial config load
    window.api.getConfig().then(config => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
      if (config.defaultModel) {
        setActiveModelId(config.defaultModel)
      }
    })

    // Listen for config changes
    window.api.onConfigChanged((config) => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
      if (config.defaultModel) {
        setActiveModelId(config.defaultModel)
      }
    })

    // Listen for model changes from other parts of the app
    window.api.onModelChanged((modelId) => {
      setActiveModelId(modelId)
    })
  }, [])

  // 1. Lifecycle & IPC Focus Effect: Resets only on launch or IPC signal
  useEffect(() => {
    const handleInitialFocus = (): void => {
      // Launcher always starts with Think Mode OFF ONLY on a fresh launch/focus signal
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

    // Call on mount
    handleInitialFocus()

    // Listen for global focus signal from main process
    const removeFocusListener = window.api.onLauncherFocus(handleInitialFocus)

    return () => {
      removeFocusListener()
    }
  }, [])

  // 2. Main Interaction & Keyboard Effect
  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'transparent'
    
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Toggle Model Selector with configurable shortcut
      if (isShortcutPressed(e, shortcut)) {
        e.preventDefault()
        setIsModelSelectorOpen((prev) => !prev)
        setSelectedIndex(MODELS.findIndex((m) => m.id === activeModelId))
        return
      }

      // Ctrl+S to toggle Web Search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        setIsSearchEnabled((prev) => !prev)
        return
      }

      // Ctrl+T to toggle Think Mode
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
          setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
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
      document.body.style.backgroundColor = ''
      document.documentElement.style.backgroundColor = ''
    }
  }, [isModelSelectorOpen, selectedIndex, activeModelId, shortcut, showSlashMenu, slashSelectedIndex, query])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (query.trim()) {
      const finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${query.trim()}` : query.trim()
      window.api.submitLauncher({ message: finalMessage, thinkMode: isThinkMode })
      setQuery('')
    }
  }

  return (
    <div 
      className="w-screen h-screen flex flex-col items-center justify-start bg-black/40 backdrop-blur-[20px] p-10 pt-[20vh] font-sans"
      onClick={() => window.api.hideLauncher()}
    >
      <div className="relative w-full max-w-[680px]" onClick={(e) => e.stopPropagation()}>
        {/* YouTube Logo Overlay - Bottom */}
        {isYoutubeMode && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-4 w-48 h-48 pointer-events-none animate-fade-in z-0 opacity-10">
            <img src={youtubeLogo} alt="YouTube" className="w-full h-full object-contain" />
          </div>
        )}

        {/* Status Indicator */}
        <div
          className={clsx(
            'absolute -top-10 left-1/2 -translate-x-1/2 transition-all duration-300 flex items-center gap-2 px-4 py-1.5 rounded-full border backdrop-blur-md z-40',
            isYoutubeMode
              ? 'opacity-100 translate-y-0 bg-red-500/10 border-red-500/30 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.1)]'
              : isSearchEnabled
                ? 'opacity-100 translate-y-0 bg-accent-secondary/10 border-accent-secondary/30 text-accent-secondary shadow-[0_0_20px_rgba(0,212,255,0.1)]'
                : isThinkMode
                  ? 'opacity-100 translate-y-0 bg-yellow-500/10 border-yellow-500/30 text-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.1)]'
                  : 'opacity-0 translate-y-2 pointer-events-none bg-surface/10 border-surface/20 text-text-secondary/40'
          )}
        >
          {isThinkMode ? <Brain size={12} className="animate-pulse" /> : <Globe size={12} className="animate-pulse" />}
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">
            {isYoutubeMode ? 'YouTube Search Active' : isSearchEnabled ? 'Web Search Active' : 'Think Mode Active'}
          </span>
        </div>

        {/* Model Selector Popover */}
        <div
          className={clsx(
            'absolute top-full left-0 mt-3 w-72 bg-background-secondary/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 origin-top-left z-50',
            isModelSelectorOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-4 pointer-events-none'
          )}
        >
          <div className="px-4 py-3 border-b border-white/5 bg-white/5">
            <span className="text-[10px] uppercase tracking-[0.2em] font-black text-accent-primary flex items-center gap-2">
              <Cpu size={12} />
              Switch Intelligence
            </span>
          </div>
          <div className="py-2">
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
                  'w-full px-4 py-3 flex items-center justify-between transition-all duration-150 relative',
                  selectedIndex === index ? 'bg-accent-primary/20' : 'hover:bg-white/5'
                )}
              >
                <div className="flex flex-col items-start text-left">
                  <span
                    className={clsx(
                      'text-sm font-bold tracking-tight',
                      model.id === 'prism-3' && 'prism-3-gradient animate-gradient-x',
                      activeModelId === model.id && model.id !== 'prism-3'
                        ? 'text-accent-primary'
                        : activeModelId !== model.id && model.id !== 'prism-3' && 'text-text-primary'
                    )}
                  >
                    {model.name}
                  </span>
                  <span className="text-[10px] text-text-secondary/60 font-medium">
                    {model.description}
                  </span>
                </div>
                {activeModelId === model.id && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-accent-primary rounded-r" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Main Launcher Bar */}
        <div
          className={clsx(
            'relative w-full bg-background-secondary/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex items-center px-6 py-5 gap-4 ring-1 ring-white/10 transition-all duration-500 overflow-hidden',
            isModelSelectorOpen && 'ring-accent-primary/40 border-accent-primary/20',
            isYoutubeMode ? 'ring-red-500/40 border-red-500/20 shadow-[0_10px_40px_rgba(239,68,68,0.15)]' :
            isSearchEnabled ? 'ring-accent-secondary/40 border-accent-secondary/20 shadow-[0_10px_40px_rgba(0,212,255,0.15)]' :
            isThinkMode ? 'ring-yellow-500/40 border-yellow-500/30 shadow-[0_10px_40px_rgba(234,179,8,0.2)]' : ''
          )}
        >
          {/* Improved Glow Effect for Think Mode */}
          {isThinkMode && (
            <div className="absolute inset-0 rounded-2xl pointer-events-none z-0">
               <div className="absolute inset-0 rounded-2xl border border-yellow-500/30 animate-pulse" />
               <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-yellow-500/10 to-transparent animate-[shimmer_2s_infinite] opacity-30" 
                    style={{ backgroundSize: '200% 100%' }} />
            </div>
          )}

          <button
            onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
            className={clsx(
              'relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-300',
              isModelSelectorOpen 
                ? 'bg-accent-primary/20 border-accent-primary/40 text-accent-primary' 
                : 'bg-white/5 border-white/10 text-text-secondary hover:bg-white/10 hover:border-white/20'
            )}
          >
            <Command size={14} />
            <span className="text-xs font-bold tracking-tight">
              {MODELS.find(m => m.id === activeModelId)?.name.replace('Prism ', '')}
            </span>
            <ChevronRight size={14} className={clsx('transition-transform duration-300', isModelSelectorOpen && 'rotate-90')} />
          </button>

          <form onSubmit={handleSubmit} className="flex-1 relative z-10">
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isModelSelectorOpen
                  ? 'Select a model...'
                  : isYoutubeMode
                    ? 'Search on YouTube...'
                    : isSearchEnabled 
                      ? 'What do you want to search on the web?'
                      : isThinkMode
                        ? 'Think with Prism...'
                        : 'What can Prism do for you today?'
              }
              className={clsx(
                "w-full bg-transparent border-none outline-none text-xl font-medium transition-colors duration-500",
                isYoutubeMode ? "text-red-500 placeholder:text-red-500/30" :
                isSearchEnabled ? "text-accent-secondary placeholder:text-accent-secondary/30" : 
                isThinkMode ? "text-yellow-500 placeholder:text-yellow-500/30" : "text-text-primary placeholder:text-text-secondary/40"
              )}
            />
          </form>

          {(isSearchEnabled || isYoutubeMode || isThinkMode) && (
            <div className={clsx(
              "relative z-10 flex items-center justify-center w-9 h-9 animate-in zoom-in duration-300",
              isYoutubeMode ? "text-red-500" : isSearchEnabled ? "text-accent-secondary" : "text-yellow-500"
            )}>
               {isThinkMode ? (
                 <Brain size={20} className="animate-pulse" />
               ) : (
                 <Globe size={20} className={clsx("animate-[spin_10s_linear_infinite]", isYoutubeMode && "text-red-500")} />
               )}
            </div>
          )}
        </div>

        {/* Slash Menu */}
        {showSlashMenu && (
          <div className="absolute top-[calc(100%+12px)] left-0 w-72 bg-background-secondary/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-50">
            <div className="px-4 py-3 border-b border-white/5 bg-white/5 text-[10px] uppercase tracking-[0.2em] font-black text-text-muted">
              Commands
            </div>
            <div className="py-2">
              {filteredCommands.map((c, i) => (
                <button
                  key={c.cmd}
                  onClick={() => c.action()}
                  onMouseEnter={() => setSlashSelectedIndex(i)}
                  className={clsx(
                    "w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition-colors",
                    slashSelectedIndex === i ? 'bg-accent-primary/20 text-accent-primary' : 'text-text-primary hover:bg-white/5'
                  )}
                >
                  <span className={clsx("font-bold", c.cmd === '/clear' ? 'text-red-400' : 'text-accent-secondary')}>{c.cmd}</span>
                  <span className="text-text-secondary text-xs">— {c.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
