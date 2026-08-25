import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import {
  CaretDown as ChevronDown,
  Check,
  MagnifyingGlass,
  CheckCircle,
  Warning,
  Crown
} from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { isShortcutPressed } from '../utils'
import type { CompletionType } from '../../../shared/types'

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
  completionType: CompletionType
}

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelKey: string) => void
  onOpenUpgradePlans?: () => void
  isEnterprise?: boolean
  disabled?: boolean
  align?: 'left' | 'right'
  menuPlacement?: 'top' | 'bottom'
  allowedCompletionTypes?: CompletionType[]
  allowClear?: boolean
}

export interface ModelSelectorHandle {
  open: () => void
}

export const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(
  (
    {
      selectedModel,
      onModelChange,
      onOpenUpgradePlans,
      isEnterprise: isEnterpriseProp,
      disabled,
      align = 'right',
      menuPlacement = 'bottom',
      allowedCompletionTypes,
      allowClear = false
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false)
    const [shortcut, setShortcut] = useState('CommandOrControl+M')
    const [searchQuery, setSearchQuery] = useState('')
    const [activeModels, setActiveModels] = useState<ActiveModelItem[]>([])
    const [isEnterpriseInternal, setIsEnterpriseInternal] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const isEnterprise = isEnterpriseProp ?? isEnterpriseInternal

    useImperativeHandle(ref, () => ({
      open: () => {
        if (!disabled) setIsOpen(true)
      }
    }))

    const checkEnterpriseStatus = async (): Promise<void> => {
      try {
        const [usage, license, user] = await Promise.all([
          window.api.getUserAiUsage().catch(() => null),
          window.api.getLicenseInfo ? window.api.getLicenseInfo().catch(() => null) : Promise.resolve(null),
          window.api.getAuthUser ? window.api.getAuthUser().catch(() => null) : Promise.resolve(null)
        ])

        const isUsageEnt =
          usage?.tier?.toLowerCase().startsWith('enterprise') ||
          usage?.tier?.toLowerCase() === 'company' ||
          Boolean(
            usage?.modelList?.some(
              (m) =>
                m.tier?.toLowerCase().startsWith('enterprise') ||
                m.tier?.toLowerCase() === 'company'
            )
          )

        const isLicenseEnt = Boolean(
          license?.isActivated &&
            (license?.type?.toUpperCase() === 'ENTERPRISE' ||
              license?.type?.toUpperCase() === 'COMPANY')
        )

        const isUserEnt =
          user?.accountType?.toLowerCase() === 'enterprise' ||
          user?.accountType?.toLowerCase() === 'company'

        setIsEnterpriseInternal(isUsageEnt || isLicenseEnt || isUserEnt)
      } catch {
        setIsEnterpriseInternal(false)
      }
    }

    const loadActiveModels = async (): Promise<void> => {
      try {
        const list = await window.api.getActiveModels()
        setActiveModels(list || [])
      } catch (e) {
        console.error('Failed to fetch active models:', e)
      }
    }

    useEffect(() => {
      loadActiveModels()
      checkEnterpriseStatus()

      window.api.getConfig().then((config) => {
        if (config.modelSelectionShortcut) setShortcut(config.modelSelectionShortcut)
      })

      const unsubscribeConfig = window.api.onConfigChanged((config) => {
        if (config.modelSelectionShortcut) setShortcut(config.modelSelectionShortcut)
        loadActiveModels()
      })

      const unsubscribeAuth = window.api.onAuthSessionUpdated?.(() => {
        checkEnterpriseStatus()
        loadActiveModels()
      })

      return () => {
        unsubscribeConfig()
        unsubscribeAuth?.()
      }
    }, [])

    useEffect(() => {
      if (isOpen) {
        loadActiveModels()
        checkEnterpriseStatus()
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

    const eligibleModels = allowedCompletionTypes?.length
      ? activeModels.filter((item) => allowedCompletionTypes.includes(item.completionType))
      : activeModels

    // Find currently selected model display item
    const selectedItem = eligibleModels.find(
      (item) =>
        item.fullKey === selectedModel ||
        item.model.id === selectedModel ||
        item.model.name === selectedModel
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
    for (const item of eligibleModels) {
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
            'flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs sm:text-[13px] font-semibold outline-none transition-all duration-150 border cursor-pointer shadow-[var(--glass-specular-top)] active:scale-95',
            isOpen
              ? 'bg-white/[0.1] text-text-primary border-white/[0.2]'
              : 'bg-white/[0.04] text-text-primary border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15]',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="text-xs sm:text-[13px] font-bold tracking-wide truncate max-w-[160px] sm:max-w-[220px]">
            {displayName}
          </span>
          <ChevronDown
            size={13}
            className={clsx(
              'text-text-muted transition-transform duration-200 shrink-0',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div
            className={clsx(
              'glass-panel-floating absolute w-72 sm:w-80 z-[200] rounded-2xl border border-white/[0.16] shadow-[0_24px_60px_rgba(0,0,0,0.8),var(--glass-specular-top)] overflow-hidden flex flex-col max-h-96 animate-soft-pop',
              menuPlacement === 'top'
                ? 'bottom-full mb-2 origin-bottom'
                : 'top-full mt-2 origin-top',
              align === 'left' ? 'left-0' : 'right-0'
            )}
          >
            {/* Search Box */}
            <div className="border-b border-white/[0.08] bg-white/[0.02] p-2.5">
              <div className="relative">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models or providers..."
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-1.5 pl-9 pr-3 text-xs text-text-primary placeholder-text-muted focus:border-white/[0.2] focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            {/* Models list */}
            <div className="p-2 overflow-y-auto space-y-3 flex-1">
              {allowClear && (
                <button
                  type="button"
                  onClick={() => {
                    onModelChange('')
                    setIsOpen(false)
                  }}
                  className={clsx(
                    'w-full flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors cursor-pointer',
                    !selectedModel
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'text-text-secondary hover:bg-white/[0.05] hover:text-text-primary'
                  )}
                >
                  <span>Not configured</span>
                  {!selectedModel && <Check size={14} weight="bold" />}
                </button>
              )}
              {filteredGroupKeys.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">
                  {eligibleModels.length === 0
                    ? 'No active models found in API Settings.'
                    : 'No models match search.'}
                </div>
              ) : (
                filteredGroupKeys.map((pName) => {
                  const items = grouped[pName].filter(
                    (i) =>
                      i.model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (i.model.name &&
                        i.model.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
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
                              <CheckCircle
                                size={12}
                                weight="fill"
                                className="text-status-success cursor-help"
                              />
                            </span>
                          ) : (
                            <span title="This provider is not trusted by Prism.">
                              <Warning
                                size={12}
                                weight="fill"
                                className="text-status-warning cursor-help"
                              />
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
                        const isArcadia11 =
                          item.model.id === 'prism-ai/arcadia-1.1-flash' ||
                          item.model.id === 'arcadia-1.1-flash' ||
                          item.fullKey.includes('arcadia-1.1-flash')

                        const isLocked = isArcadia11 && !isEnterprise

                        return (
                          <button
                            key={item.fullKey}
                            type="button"
                            onClick={() => {
                              if (isLocked) {
                                setIsOpen(false)
                                if (onOpenUpgradePlans) {
                                  onOpenUpgradePlans()
                                }
                                return
                              }
                              onModelChange(item.fullKey)
                              setIsOpen(false)
                            }}
                            className={clsx(
                              'w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer',
                              isSelected
                                ? 'bg-accent-primary/15 text-accent-primary font-bold border border-accent-primary/30'
                                : isLocked
                                  ? 'text-text-secondary hover:bg-yellow-500/[0.08] hover:text-yellow-300 border border-transparent'
                                  : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary border border-transparent'
                            )}
                          >
                            <div className="truncate pr-2">
                              <div className="truncate font-semibold flex items-center gap-1.5">
                                <span>{mainLabel}</span>
                              </div>
                              {item.model.name && mainLabel !== subLabel && (
                                <div className="text-[10px] text-text-muted font-mono truncate">
                                  {subLabel}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isLocked && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 flex items-center gap-1 shrink-0">
                                  <Crown size={10} weight="fill" />
                                  <span>Enterprise</span>
                                </span>
                              )}
                              {isSelected && (
                                <Check
                                  size={14}
                                  weight="bold"
                                  className="text-accent-primary shrink-0"
                                />
                              )}
                            </div>
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
