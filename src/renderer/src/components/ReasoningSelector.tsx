import { useState, useRef, useEffect } from 'react'
import { CaretDown as ChevronDown, Check, Brain } from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { getDefaultThinkingLevelForModel, getThinkingLevelsForModel } from '../constants'

interface ReasoningSelectorProps {
  selectedModel: string
  value: string
  onChange: (level: string) => void
  disabled?: boolean
}

export function ReasoningSelector({
  selectedModel,
  value,
  onChange,
  disabled
}: ReasoningSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const levels = getThinkingLevelsForModel(selectedModel)
  const supportsReasoning = levels.length > 0
  const currentLevel = levels.find((l) => l.id === value) || {
    id: 'minimal' as const,
    name: getDefaultThinkingLevelForModel(selectedModel) === 'minimal' ? 'Minimal' : 'Off'
  }

  if (!supportsReasoning) {
    return null
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
        title="Reasoning depth"
      >
        <Brain
          size={12}
          className={clsx(
            'shrink-0 transition-all duration-300',
            value !== 'minimal' ? 'text-accent-primary animate-pulse' : 'text-text-secondary/70'
          )}
        />
        <span>{currentLevel.name}</span>
        <ChevronDown
          size={12}
          className={clsx(
            'text-text-secondary/70 transition-transform duration-200 shrink-0',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 p-2 animate-soft-pop text-left border border-white/[0.08] bg-[#141517] rounded-2xl shadow-xl"
          style={{ width: '8.5rem' }}
        >
          <div className="px-2.5 py-1 text-[10px] font-bold text-text-secondary/50 border-b border-white/[0.04] mb-1 select-none">
            THINKING LEVEL
          </div>
          {levels.map((level) => (
            <button
              key={level.id}
              onClick={() => {
                onChange(level.id)
                setIsOpen(false)
              }}
              className={clsx(
                'w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all text-left mt-0.5 font-semibold text-xs border border-transparent',
                value === level.id
                  ? 'bg-accent-primary/[0.12] text-accent-primary border-accent-primary/20 font-bold'
                  : 'hover:bg-white/[0.04] text-text-primary'
              )}
            >
              <span>{level.name}</span>
              {value === level.id && <Check size={11} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
