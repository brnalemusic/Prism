import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { CaretDown as ChevronDown, Check } from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { MODELS, MODEL_CATEGORIES } from '../constants'
import { isShortcutPressed } from '../utils'

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelId: string) => void
  disabled?: boolean
  hasGeminiKey?: boolean
  hasNvidiaNimKey?: boolean
  hasOpenaiKey?: boolean
  openaiModelId?: string
  openaiModelName?: string
}

export interface ModelSelectorHandle {
  open: () => void
}

export const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(
  (
    {
      selectedModel,
      onModelChange,
      disabled,
      hasGeminiKey,
      hasNvidiaNimKey,
      hasOpenaiKey,
      openaiModelId,
      openaiModelName
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false)
    const [shortcut, setShortcut] = useState('CommandOrControl+M')
    const containerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      open: () => {
        if (!disabled) {
          setIsOpen(true)
        }
      }
    }))

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
          setIsOpen(!isOpen)
          return
        }

        if (isOpen && e.key === 'Escape') {
          e.preventDefault()
          setIsOpen(false)
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [isOpen, selectedModel, shortcut, disabled])

    const availableCategories: string[] = []
    if (hasGeminiKey) availableCategories.push('gemini')
    if (hasNvidiaNimKey) availableCategories.push('nvidia-nim')
    if (hasOpenaiKey) availableCategories.push('openai-compatible')

    const availableModels = MODELS.filter((m) => {
      if (m.category === 'openai-compatible') return false
      return availableCategories.includes(m.category)
    })

    if (hasOpenaiKey && openaiModelId) {
      availableModels.push({
        id: openaiModelId,
        name: openaiModelName || openaiModelId,
        category: 'openai-compatible'
      })
    }

    const currentModel = availableModels.find((m) => m.id === selectedModel)

    const getDisplayName = (): string => {
      if (currentModel) return currentModel.name
      if (hasOpenaiKey && selectedModel === openaiModelId) {
        return openaiModelName || openaiModelId || selectedModel
      }
      return selectedModel
    }

    const groupedModels: Record<string, typeof availableModels> = {}
    for (const model of availableModels) {
      const cat = model.category
      if (!groupedModels[cat]) groupedModels[cat] = []
      groupedModels[cat].push(model)
    }

    const categoryOrder = ['gemini', 'nvidia-nim', 'openai-compatible']

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
          <span>{getDisplayName()}</span>
          <ChevronDown
            size={12}
            className={clsx(
              'text-text-secondary/70 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div className="model-menu-panel absolute bottom-full right-0 mb-4 z-50 w-72 p-2 animate-soft-pop text-left opacity-100 max-h-[60vh] overflow-y-auto custom-scrollbar">
            {categoryOrder.map((catKey) => {
              const models = groupedModels[catKey]
              if (!models || models.length === 0) return null
              const catLabel = MODEL_CATEGORIES[catKey] || catKey

              return (
                <div key={catKey}>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary/70 border-b border-white/[0.04] mb-1">
                    {catLabel}
                  </div>
                  {models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        onModelChange(model.id)
                        setIsOpen(false)
                      }}
                      className={clsx(
                        'w-full flex items-center rounded-xl px-3 py-2 transition-all text-left mt-0.5',
                        selectedModel === model.id
                          ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                          : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                      )}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="font-semibold text-xs">{model.name}</div>
                        {selectedModel === model.id && <Check size={12} />}
                      </div>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }
)

ModelSelector.displayName = 'ModelSelector'
