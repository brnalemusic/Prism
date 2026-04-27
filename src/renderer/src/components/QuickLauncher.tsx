import { useState, useEffect, useRef } from 'react'
import { Command, ChevronRight, Cpu, Globe } from 'lucide-react'
import { MODELS } from '../constants'
import { isShortcutPressed } from '../utils'
import clsx from 'clsx'

export function QuickLauncher(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [activeModelId, setActiveModelId] = useState('gemma-3-27b-it')
  const [shortcut, setShortcut] = useState('CommandOrControl+M')
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = [
    { cmd: '/search', desc: 'Force web search', action: () => { setQuery('/search '); inputRef.current?.focus() } },
    { cmd: '/youtube', desc: 'YouTube search & play', action: () => { setQuery('/youtube '); inputRef.current?.focus() } },
    { cmd: '/clear', desc: 'Clear current chat', action: () => { window.api.submitLauncher('/clear'); setQuery(''); } }
  ]

  const showSlashMenu = query === '/'

  useEffect(() => {
    if (showSlashMenu) setSlashSelectedIndex(0)
  }, [showSlashMenu])

  useEffect(() => {
    // Initial config load
    window.api.getConfig().then(config => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
    })

    // Listen for config changes
    window.api.onConfigChanged((config) => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
    })

    // Listen for model changes from other parts of the app
    window.api.onModelChanged((modelId) => {
      setActiveModelId(modelId)
    })
  }, [])

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'transparent'
    
    const focusInput = (): void => {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const len = inputRef.current.value.length
          inputRef.current.setSelectionRange(len, len)
        }
      }, 50)
    }

    focusInput()

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

    window.api.onLauncherFocus(focusInput)
    window.addEventListener('focus', focusInput)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.api.removeLauncherListeners()
      window.removeEventListener('focus', focusInput)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.backgroundColor = ''
      document.documentElement.style.backgroundColor = ''
    }
  }, [isModelSelectorOpen, selectedIndex, activeModelId, shortcut, showSlashMenu, slashSelectedIndex])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (query.trim()) {
      const finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${query.trim()}` : query.trim()
      window.api.submitLauncher(finalMessage)
      setQuery('')
    }
  }

  return (
    <div 
      className="w-screen h-screen flex flex-col items-center justify-start bg-black/40 backdrop-blur-[20px] p-10 pt-[20vh] font-sans"
      onClick={() => window.api.hideLauncher()}
    >
      <div className="relative w-full max-w-[680px]" onClick={(e) => e.stopPropagation()}>
        {/* Web Search Status Indicator */}
        <div
          className={clsx(
            'absolute -top-10 left-1/2 -translate-x-1/2 transition-all duration-300 flex items-center gap-2 px-4 py-1.5 rounded-full border backdrop-blur-md z-40',
            isSearchEnabled
              ? 'opacity-100 translate-y-0 bg-accent-secondary/10 border-accent-secondary/30 text-accent-secondary shadow-[0_0_20px_rgba(0,212,255,0.1)]'
              : 'opacity-0 translate-y-2 pointer-events-none bg-surface/10 border-surface/20 text-text-secondary/40'
          )}
        >
          <Globe size={12} className="animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">
            Web Search Active
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
                      activeModelId === model.id ? 'text-accent-primary' : 'text-text-primary'
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
            'w-full bg-background-secondary/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex items-center px-6 py-5 gap-4 ring-1 ring-white/10 transition-all duration-300',
            isModelSelectorOpen && 'ring-accent-primary/40 border-accent-primary/20',
            isSearchEnabled && 'ring-accent-secondary/40 border-accent-secondary/20 shadow-[0_10px_40px_rgba(0,212,255,0.15)]'
          )}
        >
          <button
            onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-300',
              isModelSelectorOpen 
                ? 'bg-accent-primary/20 border-accent-primary/40 text-accent-primary' 
                : 'bg-white/5 border-white/10 text-text-secondary hover:bg-white/10 hover:border-white/20'
            )}
          >
            <Command size={14} />
            <span className="text-xs font-bold tracking-tight">
              {MODELS.find(m => m.id === activeModelId)?.name.split(' ').pop()}
            </span>
            <ChevronRight size={14} className={clsx('transition-transform duration-300', isModelSelectorOpen && 'rotate-90')} />
          </button>

          <form onSubmit={handleSubmit} className="flex-1">
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isModelSelectorOpen
                  ? 'Select a model...'
                  : isSearchEnabled 
                    ? 'What do you want to search on the web?'
                    : 'What can Prism do for you today?'
              }
              className={clsx(
                "w-full bg-transparent border-none outline-none text-xl font-medium transition-colors duration-300",
                isSearchEnabled ? "text-accent-secondary placeholder:text-accent-secondary/30" : "text-text-primary placeholder:text-text-secondary/40"
              )}
            />
          </form>

          {isSearchEnabled && (
            <div className="flex items-center justify-center w-9 h-9 text-accent-secondary animate-in zoom-in duration-300">
               <Globe size={20} className="animate-[spin_10s_linear_infinite]" />
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
              {commands.map((c, i) => (
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
