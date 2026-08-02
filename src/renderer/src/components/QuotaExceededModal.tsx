import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Sparkle,
  Clock,
  Key,
  X,
  ArrowRight,
  User
} from '@phosphor-icons/react'
import type { UserAiUsageStatus } from '../../../shared/types'

interface QuotaExceededModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenProfile: () => void
}

function formatResetTime(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'Resets soon'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export const QuotaExceededModal: React.FC<QuotaExceededModalProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenProfile
}) => {
  const [aiUsage, setAiUsage] = useState<UserAiUsageStatus | null>(null)

  useEffect(() => {
    if (isOpen) {
      window.api.getUserAiUsage()
        .then((usage) => {
          if (usage) setAiUsage(usage)
        })
        .catch((err) => console.error('Failed to load AI usage for quota modal:', err))
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fade-in">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-accent-primary/30 bg-card-bg/95 p-6 shadow-[0_0_50px_rgba(34,197,94,0.12)] text-text-primary backdrop-blur-2xl animate-soft-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Accents */}
        <div className="pointer-events-none absolute -top-24 -left-24 h-48 w-48 rounded-full bg-accent-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-purple-500/15 blur-3xl" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] text-text-muted hover:bg-white/10 hover:text-text-primary transition-all duration-200"
          title="Close"
        >
          <X size={16} weight="bold" />
        </button>

        {/* Header Icon & Title */}
        <div className="flex items-center gap-3.5 mb-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent-primary/30 bg-accent-primary/10 text-accent-primary shadow-[0_0_20px_rgba(34,197,94,0.2)]">
            <Sparkle size={24} weight="fill" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-wide">
              Prism Cloud Quota Limit
            </h3>
            <p className="text-xs text-text-secondary">
              Free tier request limit reached
            </p>
          </div>
        </div>

        {/* Notice Message */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-text-secondary space-y-2.5 mb-5">
          <p className="leading-relaxed text-text-primary font-medium">
            You've reached your Prism Cloud AI request limit for the current time window.
          </p>
          <p className="leading-relaxed">
            Your quota will automatically reset once the current window expires. In the meantime, you can add your custom API keys in Settings for unlimited requests.
          </p>
        </div>

        {/* Reset Countdown Cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-3.5 flex flex-col justify-between space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted text-[11px] font-medium">
              <Clock size={14} className="text-accent-primary" />
              <span>5-Hour Reset</span>
            </div>
            <span className="font-mono text-sm font-bold text-white">
              {aiUsage?.reset5hSeconds ? formatResetTime(aiUsage.reset5hSeconds) : 'Resets soon'}
            </span>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-3.5 flex flex-col justify-between space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted text-[11px] font-medium">
              <Clock size={14} className="text-purple-400" />
              <span>Weekly Reset</span>
            </div>
            <span className="font-mono text-sm font-bold text-white">
              {aiUsage?.reset1wSeconds ? formatResetTime(aiUsage.reset1wSeconds) : 'Resets soon'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          <button
            onClick={() => {
              onClose()
              onOpenSettings()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-xs font-semibold text-black hover:bg-accent-primary/90 transition-all duration-200 shadow-[0_0_20px_rgba(34,197,94,0.3)] cursor-pointer"
          >
            <Key size={16} weight="bold" />
            <span>Use Custom API Keys in Settings</span>
            <ArrowRight size={14} weight="bold" />
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose()
                onOpenProfile()
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-text-secondary hover:bg-white/10 hover:text-white transition-all duration-200 cursor-pointer"
            >
              <User size={14} />
              <span>View Quota Details</span>
            </button>

            <button
              onClick={onClose}
              className="flex flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-medium text-text-muted hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
