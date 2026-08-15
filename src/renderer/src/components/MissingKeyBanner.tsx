import React from 'react'
import { ArrowRight, Key } from '@phosphor-icons/react'

interface MissingKeyBannerProps {
  onAddKey: () => void
}

export function MissingKeyBanner({ onAddKey }: MissingKeyBannerProps): React.JSX.Element {
  return (
    <div className="w-full px-6 pt-4 sm:px-12 animate-soft-pop">
      <button
        type="button"
        onClick={onAddKey}
        className="group flex w-full items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface)] px-5 py-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="settings-icon-box">
            <Key size={18} weight="duotone" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">
              Connect an AI provider
            </span>
            <span className="mt-0.5 block text-xs text-text-secondary">
              Add a provider key to start using Prism.
            </span>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-accent-primary">
          Set up
          <ArrowRight size={14} />
        </span>
      </button>
    </div>
  )
}
