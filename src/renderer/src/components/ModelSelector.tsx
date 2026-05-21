import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { ChevronDown, Check, Cpu } from 'lucide-react'
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
          setSelectedIndex(
            Math.max(
              0,
              MODELS.findIndex((m) => m.id === selectedModel)
            )
          )
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
        }
      }

      const handleKeyDown = (e: KeyboardEvent): void => {
        if (disabled) return

        if (isShortcutPressed(e, shortcut)) {
          e.preventDefault()
          const newIsOpen = !isOpen
          setIsOpen(newIsOpen)
          if (newIsOpen) {
            setSelectedIndex(
              Math.max(
                0,
                MODELS.findIndex((m) => m.id === selectedModel)
              )
            )
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
              setSelectedIndex(
                Math.max(
                  0,
                  MODELS.findIndex((m) => m.id === selectedModel)
                )
              )
            }
          }}
          className={clsx(
            'premium-control flex min-w-[218px] items-center gap-3 rounded-[18px] px-4 py-2.5 text-left outline-none transition-all duration-200 hover:border-white/[0.15]',
            isOpen && 'prism-glow',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/[0.055] text-accent-primary">
            <Cpu size={16} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium text-text-secondary/70">Active Model</span>
            <span
              className={clsx(
                'truncate text-sm font-semibold',
                currentModel.id === 'prism-5' ? 'prism-top-gradient' : 'text-text-primary'
              )}
            >
              {currentModel.name}
            </span>
          </span>
          <ChevronDown
            size={16}
            className={clsx(
              'text-text-secondary/50 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div className="model-menu-panel absolute left-1/2 top-full z-50 mt-2 w-80 -translate-x-1/2 origin-top overflow-hidden rounded-[24px] py-2 animate-soft-pop">
            <div className="border-b border-white/[0.06] px-4 py-3">
              <span className="text-xs font-semibold text-text-secondary/70">
                Choose Prism engine
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
                  'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-all duration-150 active:bg-white/[0.09]',
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
                    'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full',
                    model.id === 'prism-5'
                      ? ['prism-5-dot', selectedModel === model.id ? 'opacity-100' : 'opacity-70']
                      : selectedModel === model.id
                        ? 'bg-accent-secondary'
                        : 'bg-white/[0.18]'
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={clsx(
                      'text-sm font-semibold',
                      model.id === 'prism-5' ? 'prism-5-title-gradient' : 'text-text-primary'
                    )}
                  >
                    {model.name}
                  </span>
                  <span className="mt-0.5 text-xs leading-snug text-text-secondary/70">
                    {model.description}
                  </span>
                </span>
                {selectedModel === model.id && (
                  <Check size={15} className="mt-0.5 text-accent-secondary" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
)
