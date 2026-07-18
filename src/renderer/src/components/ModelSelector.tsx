import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useLayoutEffect } from 'react'
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
    const [searchQuery, setSearchQuery] = useState('')
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
      if (!isOpen) {
        setSearchQuery('')
      }
    }, [isOpen])

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

    const totalModels = availableModels.length
    const itemHeight = 44
    const headerHeight = 24
    const padding = 8
    const searchBoxHeight = 46

    const contentHeight = categoryOrder.reduce((acc, catKey) => {
      const models = groupedModels[catKey] || []
      const matchingModels = models.filter((m) =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.id.toLowerCase().includes(searchQuery.toLowerCase())
      )
      if (matchingModels.length === 0) return acc
      return acc + headerHeight + matchingModels.length * itemHeight
    }, padding * 2 + searchBoxHeight)

    const [dropdownMaxHeight, setDropdownMaxHeight] = useState(300)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
      if (!isOpen) return

      const measure = (): void => {
        const containerRect = containerRef.current?.getBoundingClientRect()
        if (!containerRect) return

        const spaceBelow = window.innerHeight - containerRect.bottom
        const bottomBuffer = 48
        const computed = Math.min(
          Math.max(contentHeight, 80),
          Math.floor(spaceBelow - bottomBuffer),
          Math.floor(window.innerHeight * 0.5)
        )
        setDropdownMaxHeight(Math.max(computed, 120))
      }

      measure()
    }, [isOpen, contentHeight])

    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          className={clsx(
            'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold outline-none transition-all duration-200 border border-transparent hover:bg-white/[0.05] hover:border-white/[0.09]',
            isOpen
              ? 'bg-white/[0.08] text-text-primary border-white/10'
              : 'bg-transparent text-text-primary/95',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="text-[13.5px] font-bold tracking-wide">{getDisplayName()}</span>
          <ChevronDown
            size={13}
            className={clsx(
              'text-text-secondary/75 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            className="model-menu-panel absolute top-full left-0 mt-2 z-50 p-2.5 animate-soft-pop text-left opacity-100 overflow-y-auto custom-scrollbar model-selector-dropdown flex flex-col"
            style={{ maxHeight: `${dropdownMaxHeight}px`, width: '18rem' }}
          >
            {/* Search input */}
            <div className="px-1 pb-2.5 mb-2 border-b border-white/[0.04] shrink-0">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-accent-primary/45 focus:bg-white/[0.05] transition-all duration-200 select-text"
                onClick={(e) => e.stopPropagation()} // Prevent dropdown closing on click
              />
            </div>

            <div className="flex-grow overflow-y-auto custom-scrollbar pr-0.5">
              {totalModels === 0 && (
                <div className="px-3 py-4 text-xs text-text-secondary/60 text-center select-none">
                  No models available. Configure an API key in Settings.
                </div>
              )}
              {categoryOrder.map((catKey) => {
                const models = groupedModels[catKey] || []
                const matchingModels = models.filter((m) =>
                  m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  m.id.toLowerCase().includes(searchQuery.toLowerCase())
                )
                if (matchingModels.length === 0) return null
                const catLabel = MODEL_CATEGORIES[catKey] || catKey

                return (
                  <div key={catKey} className="mb-2.5 last:mb-0">
                    <div className="px-3 py-1 text-[9px] font-bold text-text-secondary/40 uppercase tracking-widest select-none">
                      {catLabel}
                    </div>
                    {matchingModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onModelChange(model.id)
                          setIsOpen(false)
                        }}
                        className={clsx(
                          'w-full flex items-center justify-between rounded-xl px-3 py-1.5 transition-all text-left mt-0.5 select-none cursor-pointer',
                          selectedModel === model.id
                            ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
                            : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
                        )}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <div className="font-semibold text-xs text-text-primary/90">{model.name}</div>
                          <div className="text-[9px] text-text-secondary/40 font-mono mt-0.5 truncate">{model.id}</div>
                        </div>
                        {selectedModel === model.id && <Check size={12} className="shrink-0 text-accent-primary" />}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }
)

ModelSelector.displayName = 'ModelSelector'
