import React from 'react'
import { Plus, Sparkle, MagnifyingGlass, FolderOpen } from '@phosphor-icons/react'
import { PrismMark } from './PrismMark'

interface EmptyTabStateProps {
  onNewTab: () => void
}

export const EmptyTabState: React.FC<EmptyTabStateProps> = ({ onNewTab }) => {
  return (
    <div className="relative flex-1 flex flex-col items-center justify-center p-6 select-none animate-fade-in text-center overflow-hidden bg-transparent">
      {/* Ambient background depth */}
      <div className="prism-boot-grain" />
      <div
        className="pointer-events-none absolute w-[480px] h-[480px] rounded-full blur-[100px] opacity-25"
        style={{
          background:
            'radial-gradient(circle, var(--accent-glow, rgba(56,189,248,0.35)) 0%, transparent 70%)'
        }}
      />
      <div
        className="pointer-events-none absolute bottom-12 w-[380px] h-[260px] rounded-full blur-[90px] opacity-20"
        style={{
          background:
            'radial-gradient(circle, var(--home-glow-color-2, rgba(125,211,252,0.3)) 0%, transparent 70%)'
        }}
      />

      <div className="relative z-10 flex flex-col items-center max-w-lg mx-auto">
        {/* Brand emblem with ambient spectral bloom */}
        <div className="mb-6">
          <PrismMark size={76} lit={7} sweeping={false} />
        </div>

        {/* Eyebrow badge */}
        <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-accent-primary">
          <Sparkle size={11} weight="fill" />
          <span>Workspace Idle</span>
        </div>

        {/* Heading */}
        <h2 className="text-3xl font-light tracking-tight text-text-primary mb-2">
          Prism is ready
        </h2>

        {/* Subtitle */}
        <p className="text-sm text-text-secondary/80 mb-8 leading-relaxed max-w-sm">
          No open tabs right now. Open a workspace tab to begin chatting, planning architectures, or executing code.
        </p>

        {/* Primary Action Button (Button-in-Button architecture) */}
        <button
          type="button"
          onClick={onNewTab}
          className="group relative inline-flex items-center gap-3 pl-5 pr-2 py-2 rounded-full bg-white hover:bg-neutral-100 text-black font-semibold text-sm transition-interactive duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-[0_16px_36px_rgba(255,255,255,0.16)] cursor-pointer"
        >
          <span className="tracking-tight">Open New Tab</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 group-hover:bg-black/15 transition-transform duration-200 group-hover:rotate-90">
            <Plus size={16} weight="bold" className="text-black" />
          </span>
        </button>

        {/* Ambient shortcut pill bar */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-[11px] text-text-muted">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 backdrop-blur-sm">
            <kbd className="font-mono font-semibold text-text-secondary">Ctrl + N</kbd>
            <span>New Tab</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 backdrop-blur-sm">
            <MagnifyingGlass size={12} className="text-text-muted" />
            <kbd className="font-mono font-semibold text-text-secondary">Ctrl + K</kbd>
            <span>Search</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 backdrop-blur-sm">
            <FolderOpen size={12} className="text-text-muted" />
            <kbd className="font-mono font-semibold text-text-secondary">Ctrl + O</kbd>
            <span>Open Project</span>
          </div>
        </div>
      </div>
    </div>
  )
}
