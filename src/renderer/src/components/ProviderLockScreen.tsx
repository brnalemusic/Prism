import React from 'react'
import { LockKey, Sparkle, Key, ShieldCheck } from '@phosphor-icons/react'

interface ProviderLockScreenProps {
  onOpenAuth: () => void
  onOpenWizard: () => void
}

export const ProviderLockScreen: React.FC<ProviderLockScreenProps> = ({
  onOpenAuth,
  onOpenWizard
}) => {
  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-[#090A0C]/95 backdrop-blur-2xl p-6 select-none animate-soft-pop">
      {/* Background glow accents */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-purple-600/10 blur-[120px]" />

      <div className="relative flex w-full max-w-lg flex-col items-center text-center rounded-[32px] border border-white/10 bg-[#0E1015]/90 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.8)] space-y-6 overflow-hidden">
        {/* Top Lock Icon Badge */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-primary/15 border border-accent-primary/30 text-accent-primary shadow-inner">
          <LockKey size={32} weight="fill" />
          <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-white shadow-md">
            <ShieldCheck size={14} weight="bold" />
          </div>
        </div>

        {/* Header Title & Description */}
        <div className="space-y-2 max-w-md">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            AI Provider Required
          </h1>
          <p className="text-xs text-text-secondary leading-relaxed">
            At least one active AI provider is mandatory to use Prism. Sign in to your account to instantly access free models or connect your custom API key.
          </p>
        </div>

        {/* Action Options */}
        <div className="flex flex-col w-full space-y-3 pt-2">
          {/* Primary Action: Login */}
          <button
            onClick={onOpenAuth}
            className="group flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-accent-primary p-3.5 text-xs font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98] cursor-pointer"
          >
            <Sparkle size={18} weight="fill" className="text-blue-200 group-hover:rotate-12 transition-transform" />
            <span>Sign In to Unlock Free AI Models</span>
          </button>

          {/* Secondary Action: Connect Custom API Key */}
          <button
            onClick={onOpenWizard}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 text-xs font-semibold text-text-primary hover:bg-white/[0.08] hover:border-white/20 transition-all active:scale-[0.98] cursor-pointer"
          >
            <Key size={18} weight="bold" className="text-text-muted" />
            <span>Connect Custom API Key or Provider</span>
          </button>
        </div>

        {/* Footer info tag */}
        <div className="pt-2 text-[11px] text-text-muted/60">
          Prism v8.0.0 • Enterprise Workspace Security
        </div>
      </div>
    </div>
  )
}
