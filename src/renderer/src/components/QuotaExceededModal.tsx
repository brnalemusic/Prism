import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sparkle, Clock, Key, X, ArrowRight, Crown } from '@phosphor-icons/react'
import type { UserAiUsageStatus } from '../../../shared/types'

interface QuotaExceededModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenUpgradePlans?: () => void
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
  onOpenUpgradePlans
}) => {
  const [aiUsage, setAiUsage] = useState<UserAiUsageStatus | null>(null)
  const [isAiUsageUnavailable, setIsAiUsageUnavailable] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setAiUsage(null)
      setIsAiUsageUnavailable(false)
      window.api
        .getUserAiUsage()
        .then((usage) => {
          if (usage) {
            setAiUsage(usage)
          } else {
            setIsAiUsageUnavailable(true)
          }
        })
        .catch((err) => {
          console.error('Failed to load AI usage for quota modal:', err)
          setIsAiUsageUnavailable(true)
        })
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

  const isEnterprise =
    aiUsage?.tier?.toLowerCase().startsWith('enterprise') ||
    Boolean(aiUsage?.modelList?.some((m) => m.tier?.toLowerCase().startsWith('enterprise')))

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="prism-modal-panel relative w-full max-w-md overflow-y-auto p-6 text-text-primary animate-soft-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Accents */}
        <div className="pointer-events-none absolute -top-24 -left-24 h-48 w-48 rounded-full bg-accent-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-yellow-500/15 blur-3xl" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] text-text-muted hover:bg-white/10 hover:text-text-primary transition-all duration-200 cursor-pointer"
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
              {isEnterprise ? 'Enterprise rolling capacity reached' : 'Free tier request limit reached'}
            </p>
          </div>
        </div>

        {/* Notice Message */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-text-secondary space-y-2.5 mb-5">
          <p className="leading-relaxed text-text-primary font-medium">
            You've reached your Prism Cloud AI request limit for the current time window.
          </p>
          <p className="leading-relaxed">
            Your quota will automatically reset once the current rolling window expires. In the meantime,
            you can connect a BYOK provider in Settings for unlimited requests.
          </p>
        </div>

        {isAiUsageUnavailable && (
          <p className="mb-5 text-xs text-status-error">
            Usage details are temporarily unavailable. Please try again shortly.
          </p>
        )}

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
          {/* 1. Use a BYOK provider */}
          <button
            onClick={() => {
              onClose()
              onOpenSettings()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-xs font-semibold text-black hover:bg-accent-primary/90 transition-all duration-200 shadow-[0_0_20px_rgba(34,197,94,0.3)] cursor-pointer"
          >
            <Key size={16} weight="bold" />
            <span>Use a BYOK provider</span>
            <ArrowRight size={14} weight="bold" />
          </button>

          {/* 2. Upgrade my Plan (hidden if already Enterprise) */}
          {!isEnterprise && onOpenUpgradePlans && (
            <button
              onClick={() => {
                onClose()
                onOpenUpgradePlans()
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 hover:text-yellow-300 px-4 py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer shadow-sm"
            >
              <Crown size={16} weight="fill" />
              <span>Upgrade my Plan</span>
            </button>
          )}

          {/* 3. Close */}
          <button
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-medium text-text-muted hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
