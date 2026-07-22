import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { CaretDown as ChevronDown, Check, MagnifyingGlass, CheckCircle, Warning } from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { isShortcutPressed } from '../utils'

interface ActiveModelItem {
  providerId: string
  providerName: string
  isProviderTrusted: boolean
  model: {
    id: string
    name?: string
    enabled: boolean
    isTrusted: boolean
  }
  fullKey: string
}

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelKey: string) => void
  disabled?: boolean
  align?: 'left' | 'right'
}

export interface ModelSelectorHandle {
  open: () => void
}

export const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(
  ({ selectedModel, onModelChange, disabled, align = 'right' }, ref) => {
    const [isOpen, setIsOpen] = useState(false)
    const [shortcut, setShortcut] = useState('CommandOrControl+M')
    const [searchQuery, setSearchQuery] = useState('')
    const [activeModels, setActiveModels] = useState<ActiveModelItem[]>([])
    const containerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => ({
      open: () => {
        if (!disabled) setIsOpen(true)
      }
    }))

    const loadActiveModels = async () => {
      try {
        const list = await window.api.getActiveModels()
        setActiveModels(list || [])
      } catch (e) {
        console.error('Failed to fetch active models:', e)
      }
    }

    useEffect(() => {
      loadActiveModels()

      window.api.getConfig().then((config) => {
        if (config.modelSelectionShortcut) setShortcut(config.modelSelectionShortcut)
      })

      const unsubscribeConfig = window.api.onConfigChanged((config) => {
        if (config.modelSelectionShortcut) setShortcut(config.modelSelectionShortcut)
        loadActiveModels()
      })

      return () => {
        unsubscribeConfig()
      }
    }, [])

    useEffect(() => {
      if (isOpen) {
        loadActiveModels()
      } else {
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
    }, [isOpen, shortcut, disabled])

    // Find currently selected model display item
    const selectedItem = activeModels.find(
      (item) => item.fullKey === selectedModel || item.model.id === selectedModel || item.model.name === selectedModel
    )

    const rawDisplayName = selectedItem
      ? selectedItem.model.name || selectedItem.model.id
      : selectedModel || 'Select Model'

    const getModelOnly = (val: string): string => {
      if (!val) return ''
      if (val.includes('/')) {
        const parts = val.split('/')
        return parts[parts.length - 1]
      }
      return val
    }

    const displayName = getModelOnly(rawDisplayName)

    // Group active models by provider
    const grouped: Record<string, ActiveModelItem[]> = {}
    for (const item of activeModels) {
      if (!grouped[item.providerName]) grouped[item.providerName] = []
      grouped[item.providerName].push(item)
    }

    const filteredGroupKeys = Object.keys(grouped).filter((providerName) => {
      const items = grouped[providerName]
      return items.some(
        (i) =>
          i.model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (i.model.name && i.model.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
          providerName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })

    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          className={clsx(
            'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold outline-none transition-all duration-200 border border-transparent hover:bg-white/[0.05] hover:border-white/[0.09]',
            isOpen ? 'bg-white/[0.08] text-text-primary border-white/10' : 'bg-transparent text-text-primary',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="text-xs sm:text-[13.5px] font-bold tracking-wide truncate max-w-[160px] sm:max-w-[220px]">{displayName}</span>
          <ChevronDown
            size={13}
            className={clsx('text-text-muted transition-transform duration-200 shrink-0', isOpen && 'rotate-180')}
          />
        </button>

        {isOpen && (
          <div className={clsx(
            "absolute top-full mt-2 w-72 sm:w-80 z-[100] rounded-2xl border border-white/[0.12] bg-surface backdrop-blur-2xl shadow-2xl overflow-hidden flex flex-col max-h-96 animate-soft-pop",
            align === 'left' ? 'left-0' : 'right-0'
          )}>
            {/* Search Box */}
            <div className="p-2.5 border-b border-white/[0.08] bg-black/20">
              <div className="relative">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models or providers..."
                  className="w-full pl-9 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.1] rounded-xl text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                  autoFocus
                />
              </div>
            </div>

            {/* Models list */}
            <div className="p-2 overflow-y-auto space-y-3 flex-1">
              {filteredGroupKeys.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">
                  {activeModels.length === 0 ? 'No active models found in API Settings.' : 'No models match search.'}
                </div>
              ) : (
                filteredGroupKeys.map((pName) => {
                  const items = grouped[pName].filter(
                    (i) =>
                      i.model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (i.model.name && i.model.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                      pName.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  if (!items.length) return null
                  const isTrusted = items[0]?.isProviderTrusted

                  return (
                    <div key={pName} className="space-y-1">
                      <div className="px-3 py-1 flex items-center justify-between text-[10px] font-bold tracking-wider text-text-muted uppercase">
                        <span className="flex items-center gap-1.5">
                          {pName}
                          {isTrusted ? (
                            <span title="This provider is trusted by Prism.">
                              <CheckCircle size={12} weight="fill" className="text-status-success cursor-help" />
                            </span>
                          ) : (
                            <span title="This provider is not trusted by Prism.">
                              <Warning size={12} weight="fill" className="text-status-warning cursor-help" />
                            </span>
                          )}
                        </span>
                      </div>

                      {items.map((item) => {
                        const isSelected =
                          selectedModel === item.fullKey ||
                          selectedModel === item.model.id ||
                          selectedModel === item.model.name

                        const mainLabel = getModelOnly(item.model.name || item.model.id)
                        const subLabel = getModelOnly(item.model.id)

                        return (
                          <button
                            key={item.fullKey}
                            type="button"
                            onClick={() => {
                              onModelChange(item.fullKey)
                              setIsOpen(false)
                            }}
                            className={clsx(
                              'w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-all',
                              isSelected
                                ? 'bg-accent-primary/15 text-accent-primary font-bold border border-accent-primary/30'
                                : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary border border-transparent'
                            )}
                          >
                            <div className="truncate pr-2">
                              <div className="truncate font-semibold">{mainLabel}</div>
                              {item.model.name && mainLabel !== subLabel && (
                                <div className="text-[10px] text-text-muted font-mono truncate">{subLabel}</div>
                              )}
                            </div>
                            {isSelected && <Check size={14} weight="bold" className="text-accent-primary shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    )
  }
)

ModelSelector.displayName = 'ModelSelector'
