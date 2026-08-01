import React from 'react'
import { Plus, Sparkle } from '@phosphor-icons/react'

interface EmptyTabStateProps {
  onNewTab: () => void
}

export const EmptyTabState: React.FC<EmptyTabStateProps> = ({ onNewTab }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none animate-fade-in text-center relative overflow-hidden">
      {/* Background ambient glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-accent-primary/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center max-w-md mx-auto">
        {/* Icon Container with subtle glass effect & glow */}
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/[0.08] bg-white/[0.03] shadow-[0_8px_32px_rgba(0,0,0,0.37)] backdrop-blur-xl group transition-transform duration-300 hover:scale-105">
          <Sparkle size={38} weight="duotone" className="text-accent-primary animate-pulse" />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary mb-2">
          Prism is Ready
        </h2>

        {/* Subtitle */}
        <p className="text-sm text-text-secondary mb-8 leading-relaxed max-w-sm">
          No open tabs. Start a new tab to begin asking questions, executing code, or browsing.
        </p>

        {/* Eye-catching Minimal Action Button */}
        <button
          type="button"
          onClick={onNewTab}
          className="group relative inline-flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-accent-primary hover:bg-accent-primary/95 text-white font-medium text-sm shadow-[0_0_24px_rgba(255,255,255,0.15)] hover:shadow-[0_0_32px_rgba(255,255,255,0.25)] transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer overflow-hidden"
        >
          <Plus size={18} weight="bold" className="transition-transform duration-200 group-hover:rotate-90" />
          <span>Open New Tab</span>
        </button>

        {/* Subtle Keyboard Hint */}
        <span className="mt-4 text-[11px] text-text-muted font-mono tracking-wide">
          Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-text-secondary">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-text-secondary">N</kbd> to open
        </span>
      </div>
    </div>
  )
}
