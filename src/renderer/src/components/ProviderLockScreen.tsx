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
    <div className="prism-modal-backdrop fixed inset-0 z-[9990] flex items-center justify-center p-6 select-none animate-soft-pop">
      <div className="prism-modal-panel relative flex w-full max-w-lg flex-col items-center overflow-hidden p-8 text-center">
        {/* Top Lock Icon Badge */}
        <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
          <LockKey size={28} weight="duotone" />
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
            At least one active AI provider is mandatory to use Prism. Sign in to your account to
            instantly access free models or connect your custom API key.
          </p>
        </div>

        {/* Action Options */}
        <div className="flex flex-col w-full space-y-3 pt-2">
          {/* Primary Action: Login */}
          <button
            onClick={onOpenAuth}
            className="group flex w-full items-center justify-center gap-2.5 rounded-lg border border-white bg-white p-3.5 text-xs font-bold text-black transition-colors hover:bg-neutral-200 active:scale-[0.98] cursor-pointer"
          >
            <Sparkle
              size={18}
              weight="fill"
              className="text-blue-200 group-hover:rotate-12 transition-transform"
            />
            <span>Sign In to Unlock Free AI Models</span>
          </button>

          {/* Secondary Action: Connect Custom API Key */}
          <button
            onClick={onOpenWizard}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface)] p-3.5 text-xs font-semibold text-text-primary hover:bg-[var(--surface-raised)] hover:border-[var(--border-strong)] transition-colors active:scale-[0.98] cursor-pointer"
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
