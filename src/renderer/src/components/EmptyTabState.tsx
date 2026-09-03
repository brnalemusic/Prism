import React from 'react'
import { Hexagon, Plus } from '@phosphor-icons/react'

interface EmptyTabStateProps {
  onNewTab: () => void
}

export const EmptyTabState: React.FC<EmptyTabStateProps> = ({ onNewTab }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none animate-fade-in text-center relative overflow-hidden bg-transparent">
      {/* Soft central ambient glow */}
      <div className="absolute w-[360px] h-[360px] rounded-full bg-[radial-gradient(circle,var(--home-glow-color-2)_0%,transparent_70%)] blur-[60px] pointer-events-none opacity-80" />

      <div className="relative z-10 flex flex-col items-center max-w-md mx-auto">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-xl shadow-[var(--glass-specular-top),0_0_28px_var(--accent-glow)]">
          <Hexagon size={32} weight="duotone" className="text-accent-primary" />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-bold tracking-tight text-text-primary mb-2.5">
          Prism is ready
        </h2>

        {/* Subtitle */}
        <p className="text-sm text-text-secondary/80 mb-8 leading-relaxed max-w-sm">
          No open tabs. Start a new tab to begin asking questions, executing code, or browsing.
        </p>

        {/* Eye-catching Minimal Action Button */}
        <button
          type="button"
          onClick={onNewTab}
          className="group relative inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white hover:bg-neutral-100 text-black font-semibold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-[0_12px_32px_rgba(255,255,255,0.18)] cursor-pointer"
        >
          <Plus
            size={18}
            weight="bold"
            className="transition-transform duration-200 group-hover:rotate-90"
          />
          <span>Open New Tab</span>
        </button>

        {/* Subtle Keyboard Hint */}
        <span className="mt-5 text-[11px] text-text-muted font-mono tracking-wide">
          Press{' '}
          <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-text-secondary font-semibold">
            Ctrl
          </kbd>{' '}
          +{' '}
          <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-text-secondary font-semibold">
            N
          </kbd>{' '}
          to open
        </span>
      </div>
    </div>
  )
}
