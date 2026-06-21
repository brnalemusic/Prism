import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { CaretDown as ChevronDown, Check, CaretLeft } from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { MODELS } from '../constants'
import { isShortcutPressed } from '../utils'

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelId: string) => void
  isThinkMode?: boolean
  onThinkModeToggle?: (val: boolean) => void
  disabled?: boolean
}

export interface ModelSelectorHandle {
  open: () => void
}

export const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(
  ({ selectedModel, onModelChange, isThinkMode = false, onThinkModeToggle, disabled }, ref) => {
    const [isOpen, setIsOpen] = useState(false)
    const [isSubmenuOpen, setIsSubmenuOpen] = useState(false)
    const [shortcut, setShortcut] = useState('CommandOrControl+M')
    const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      open: () => {
        if (!disabled) {
          setIsOpen(true)
        }
      }
    }))

    const currentModel = MODELS.find((m) => m.id === selectedModel) || MODELS[0]

    useEffect(() => {
      window.api.getConfig().then((config) => {
        if (config.modelSelectionShortcut) {
          setShortcut(config.modelSelectionShortcut)
        }
      })

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
          setIsSubmenuOpen(false)
        }
      }

      const handleKeyDown = (e: KeyboardEvent): void => {
        if (disabled) return

        if (isShortcutPressed(e, shortcut)) {
          e.preventDefault()
          setIsOpen(!isOpen)
          return
        }

        if (isOpen && e.key === 'Escape') {
          e.preventDefault()
          setIsOpen(false)
          setIsSubmenuOpen(false)
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [isOpen, selectedModel, shortcut, disabled])

    // Close submenu when main menu closes
    useEffect(() => {
      if (!isOpen) {
        setIsSubmenuOpen(false)
      }
    }, [isOpen])

    const handleSubmenuEnter = () => {
      if (submenuCloseTimer.current) {
        clearTimeout(submenuCloseTimer.current)
        submenuCloseTimer.current = null
      }
      setIsSubmenuOpen(true)
    }

    const handleSubmenuLeave = () => {
      submenuCloseTimer.current = setTimeout(() => {
        setIsSubmenuOpen(false)
      }, 120)
    }

    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          className={clsx(
            'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all duration-200 border border-transparent hover:bg-white/[0.05] hover:border-white/[0.09]',
            isOpen
              ? 'bg-white/[0.08] text-text-primary border-white/10'
              : 'bg-transparent text-text-secondary',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <span>{isThinkMode ? `${currentModel.name} (Extended)` : currentModel.name}</span>
          <ChevronDown
            size={12}
            className={clsx(
              'text-text-secondary/70 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div className="model-menu-panel absolute bottom-full right-0 mb-4 z-50 w-72 p-2 animate-soft-pop text-left opacity-100">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary/70 border-b border-white/[0.04] mb-1">
              Select Prism Engine
            </div>
            {MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  onModelChange(model.id)
                }}
                className={clsx(
                  'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2 transition-all text-left mt-0.5',
                  selectedModel === model.id
                    ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                    : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs">
                    {selectedModel === model.id && isThinkMode
                      ? `${model.name} (Extended)`
                      : model.name}
                  </div>
                  {selectedModel === model.id && <Check size={12} />}
                </div>
                <div className="text-[10px] text-text-secondary/70 leading-normal font-medium mt-0.5">
                  {model.shortDescription || model.description}
                </div>
              </button>
            ))}

            {/* Thinking Mode submenu — hover-stable via React state + close delay */}
            <div
              className="relative mt-2 border-t border-white/[0.04] pt-2"
              onMouseEnter={handleSubmenuEnter}
              onMouseLeave={handleSubmenuLeave}
            >
              <button
                type="button"
                className="w-full flex items-center justify-between rounded-xl px-3 py-2 transition-all text-left border border-transparent hover:bg-white/[0.04] text-text-primary"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-xs text-text-primary">Thinking Mode</span>
                  <span className="text-[10px] text-text-secondary/70 leading-normal font-medium animate-pulse">
                    {isThinkMode ? 'Extended' : 'Default'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-text-secondary/50 font-medium">Configure</span>
                  <CaretLeft
                    size={12}
                    className={clsx(
                      'text-text-secondary/70 transition-transform duration-200',
                      isSubmenuOpen && '-translate-x-0.5'
                    )}
                  />
                </div>
              </button>

              {isSubmenuOpen && (
                <div
                  className="absolute right-full top-0 mr-1.5 z-[60] w-64 model-menu-panel p-2 animate-soft-pop text-left"
                  onMouseEnter={handleSubmenuEnter}
                  onMouseLeave={handleSubmenuLeave}
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary/70 border-b border-white/[0.04] mb-1">
                    Select Thinking Mode
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onThinkModeToggle?.(false)
                      setIsSubmenuOpen(false)
                      setIsOpen(false)
                    }}
                    className={clsx(
                      'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2 transition-all text-left mt-0.5',
                      !isThinkMode
                        ? 'bg-white/[0.08] text-text-primary border border-white/10'
                        : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-xs">Default</div>
                      {!isThinkMode && <Check size={12} />}
                    </div>
                    <div className="text-[10px] text-text-secondary/70 leading-normal font-medium mt-0.5">
                      Minimal thinking for speed. Recommended for simple tasks.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onThinkModeToggle?.(true)
                      setIsSubmenuOpen(false)
                      setIsOpen(false)
                    }}
                    className={clsx(
                      'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2 transition-all text-left mt-1',
                      isThinkMode
                        ? 'bg-status-warning/[0.12] text-status-warning border border-status-warning/20'
                        : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-xs">Extended</div>
                      {isThinkMode && <Check size={12} />}
                    </div>
                    <div className="text-[10px] text-text-secondary/70 leading-normal font-medium mt-0.5">
                      Careful thinking before response. Best for heavy tasks.
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }
)

ModelSelector.displayName = 'ModelSelector'
