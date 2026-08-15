import React from 'react'
import { Hexagon, Plus } from '@phosphor-icons/react'

interface EmptyTabStateProps {
  onNewTab: () => void
}

export const EmptyTabState: React.FC<EmptyTabStateProps> = ({ onNewTab }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none animate-fade-in text-center relative overflow-hidden bg-black">
      <div className="relative z-10 flex flex-col items-center max-w-md mx-auto">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface)]">
          <Hexagon size={28} weight="duotone" className="text-accent-primary" />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary mb-2">
          Prism is ready
        </h2>

        {/* Subtitle */}
        <p className="text-sm text-text-secondary mb-8 leading-relaxed max-w-sm">
          No open tabs. Start a new tab to begin asking questions, executing code, or browsing.
        </p>

        {/* Eye-catching Minimal Action Button */}
        <button
          type="button"
          onClick={onNewTab}
          className="group relative inline-flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold text-sm transition-colors duration-200 cursor-pointer"
        >
          <Plus
            size={18}
            weight="bold"
            className="transition-transform duration-200 group-hover:rotate-90"
          />
          <span>Open New Tab</span>
        </button>

        {/* Subtle Keyboard Hint */}
        <span className="mt-4 text-[11px] text-text-muted font-mono tracking-wide">
          Press{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-text-secondary">
            Ctrl
          </kbd>{' '}
          +{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-text-secondary">
            N
          </kbd>{' '}
          to open
        </span>
      </div>
    </div>
  )
}
