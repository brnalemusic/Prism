import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { clsx } from 'clsx'
import { MODELS } from '../constants'
import { isShortcutPressed } from '../utils'

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelId: string) => void
  disabled?: boolean
}

export interface ModelSelectorHandle {
  open: () => void
}

export const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(
  ({ selectedModel, onModelChange, disabled }, ref) => {
    const [isOpen, setIsOpen] = useState(false)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [shortcut, setShortcut] = useState('CommandOrControl+M')
    const containerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      open: () => {
        if (!disabled) {
          setIsOpen(true)
          setSelectedIndex(MODELS.findIndex((m) => m.id === selectedModel))
        }
      }
    }))

    const currentModel = MODELS.find((m) => m.id === selectedModel) || MODELS[0]

    useEffect(() => {
      // Load config for shortcut
      window.api.getConfig().then((config) => {
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
    }, [])

    useEffect(() => {
      function handleClickOutside(event: MouseEvent): void {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false)
        }
      }

      const handleKeyDown = (e: KeyboardEvent): void => {
        if (disabled) return

        // Toggle with shortcut
        if (isShortcutPressed(e, shortcut)) {
          e.preventDefault()
          const newIsOpen = !isOpen
          setIsOpen(newIsOpen)
          if (newIsOpen) {
            setSelectedIndex(MODELS.findIndex((m) => m.id === selectedModel))
          }
          return
        }

        if (isOpen) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % MODELS.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + MODELS.length) % MODELS.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const selected = MODELS[selectedIndex]
            onModelChange(selected.id)
            setIsOpen(false)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setIsOpen(false)
          }
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [isOpen, selectedIndex, selectedModel, shortcut, disabled, onModelChange])

    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const newIsOpen = !isOpen
            setIsOpen(newIsOpen)
            if (newIsOpen) {
              setSelectedIndex(MODELS.findIndex((m) => m.id === selectedModel))
            }
          }}
          className={clsx(
            'flex items-center gap-3 px-4 py-2 rounded-xl border transition-all duration-300 outline-none',
            'bg-surface/30 backdrop-blur-md',
            isOpen
              ? 'border-accent-primary/50 prism-glow'
              : 'border-surface/50 hover:border-surface hover:bg-surface/50',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div className="flex flex-col items-start">
            <span className="text-[10px] uppercase tracking-widest text-text-secondary/60 font-bold leading-none mb-1">
              Active Intelligence
            </span>
            <span className="text-sm font-medium text-text-primary tracking-tight">
              {currentModel.name}
            </span>
          </div>

          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx(
              'text-text-secondary/50 transition-transform duration-300 ml-2',
              isOpen && 'rotate-180'
            )}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl border border-surface/50 bg-background-secondary/95 backdrop-blur-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-200 origin-top">
            <div className="px-4 py-2 mb-1 border-b border-surface/20">
              <span className="text-[9px] uppercase tracking-[0.2em] font-black text-text-secondary/40">
                Select Intelligence
              </span>
            </div>
            {MODELS.map((model, index) => (
              <button
                key={model.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  onModelChange(model.id)
                  setIsOpen(false)
                }}
                className={clsx(
                  'w-full px-4 py-3 flex flex-col items-start transition-all duration-200 group relative overflow-hidden',
                  selectedIndex === index ? 'bg-accent-primary/10' : 'hover:bg-surface/40'
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={clsx(
                      'text-sm font-bold tracking-tight',
                      model.id === 'prism-3' && 'prism-3-gradient animate-gradient-x',
                      selectedModel === model.id && model.id !== 'prism-3'
                        ? 'text-accent-primary'
                        : selectedModel !== model.id && model.id !== 'prism-3' && 'text-text-primary group-hover:text-accent-primary/80'
                    )}
                  >
                    {model.name}
                  </span>
                  {selectedModel === model.id && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
                  )}
                </div>
                <span className="text-[11px] text-text-secondary/70 font-medium leading-snug">
                  {model.description}
                </span>

                {selectedModel === model.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-primary" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
)
