import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Check,
  Crown,
  Sparkle,
  ArrowRight,
  Lightning,
  ShieldCheck,
  Certificate
} from '@phosphor-icons/react'

interface PrismPlansModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenLicenseSettings?: () => void
  isEnterprise?: boolean
}

export const PrismPlansModal: React.FC<PrismPlansModalProps> = ({
  isOpen,
  onClose,
  onOpenLicenseSettings,
  isEnterprise = false
}) => {
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

  const handleGoToLicense = (): void => {
    onClose()
    if (onOpenLicenseSettings) {
      onOpenLicenseSettings()
    } else {
      window.dispatchEvent(new CustomEvent('prism:open-license'))
    }
  }

  return createPortal(
    <div
      className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-8 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="prism-modal-panel relative w-full max-w-5xl my-auto overflow-hidden rounded-3xl border border-white/10 bg-[#0c0d13] p-7 sm:p-9 lg:p-10 text-text-primary shadow-[0_30px_90px_rgba(0,0,0,0.9)] animate-soft-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Lighting */}
        <div className="pointer-events-none absolute -top-40 -left-40 h-80 w-80 rounded-full bg-accent-primary/15 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-yellow-500/15 blur-[100px]" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-text-muted hover:bg-white/12 hover:text-white transition-all duration-200 cursor-pointer z-10"
          title="Close"
        >
          <X size={18} weight="bold" />
        </button>

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-9">
          <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest text-yellow-400 mb-3.5 shadow-sm">
            <Crown size={15} weight="fill" />
            <span>Prism Intelligence Plans</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Scale Your AI Reasoning &amp; Quotas
          </h2>
          <p className="text-xs sm:text-sm text-text-secondary mt-2 leading-relaxed">
            Upgrade your Prism experience with next-generation Arcadia models, massive rolling quotas, and priority cloud execution.
          </p>
        </div>

        {/* Comparison Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 mb-8">
          {/* Free Tier Card */}
          <div className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  Developer Edition
                </span>
                {!isEnterprise && (
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-white/20 bg-white/10 text-white">
                    Current Active Tier
                  </span>
                )}
              </div>

              <div>
                <h3 className="text-xl font-bold text-white">Free Plan</h3>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  Everyday developer tools, standard quotas, and BYOK custom providers.
                </p>
              </div>

              <div className="pt-4 border-t border-white/[0.06] space-y-3">
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-accent-primary shrink-0 mt-0.5" />
                  <span>
                    Access to <strong className="text-white">Arcadia-1.0 Mini, Flash &amp; Pro</strong>
                  </span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-accent-primary shrink-0 mt-0.5" />
                  <span>Standard 5-hour rolling request capacity</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-accent-primary shrink-0 mt-0.5" />
                  <span>Unlimited Custom API Keys (BYOK direct provider mode)</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-accent-primary shrink-0 mt-0.5" />
                  <span>Full desktop workspace execution, terminal guards &amp; local tools</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/[0.06]">
              <div className="w-full text-center py-3 rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-text-muted">
                {isEnterprise ? 'Included Baseline' : 'Active on this Device'}
              </div>
            </div>
          </div>

          {/* Enterprise Subscription Card (Highlighted) */}
          <div className="relative rounded-2xl border border-yellow-500/40 bg-gradient-to-b from-yellow-500/[0.08] via-white/[0.02] to-transparent p-6 sm:p-8 flex flex-col justify-between space-y-6 shadow-[0_0_40px_rgba(234,179,8,0.12)]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-yellow-400">
                  <Sparkle size={14} weight="fill" />
                  <span>Frontier Power</span>
                </span>
                {isEnterprise ? (
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-yellow-500/40 bg-yellow-500/20 text-yellow-300">
                    Active Plan
                  </span>
                ) : (
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                    Enterprise Exclusive
                  </span>
                )}
              </div>

              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <span>Enterprise Subscription</span>
                  <Crown size={20} weight="fill" className="text-yellow-400" />
                </h3>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  Maximum reasoning throughput, exclusive frontier models, and massive quota limits.
                </p>
              </div>

              <div className="pt-4 border-t border-white/[0.06] space-y-3">
                <div className="flex items-start gap-2.5 text-xs text-white font-medium">
                  <Check size={16} weight="bold" className="text-yellow-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-yellow-300">Exclusive Arcadia-1.1 Flash</strong> Access (Next-Gen Reasoning Engine)
                  </span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-yellow-400 shrink-0 mt-0.5" />
                  <span>Massive up to 150x more quota in frontier models</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-yellow-400 shrink-0 mt-0.5" />
                  <span>Dedicated high-speed cloud capacity with zero queue delays</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-text-secondary">
                  <Check size={16} weight="bold" className="text-yellow-400 shrink-0 mt-0.5" />
                  <span>Automatic cross-device sync &amp; multi-seat license management</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/[0.06] space-y-2">
              {isEnterprise ? (
                <div className="flex flex-col gap-2">
                  <div className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
                    <ShieldCheck size={18} weight="bold" />
                    <span>Enterprise Subscription Active</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoToLicense}
                    className="w-full flex items-center justify-center gap-2 py-2 text-xs text-text-secondary hover:text-white transition-colors cursor-pointer"
                  >
                    <Certificate size={14} />
                    <span>Manage License in Settings</span>
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleGoToLicense}
                    className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400 text-black text-xs font-bold transition-all duration-200 shadow-[0_0_25px_rgba(234,179,8,0.3)] cursor-pointer"
                  >
                    <Certificate size={16} weight="fill" />
                    <span>Purchase in Settings → License</span>
                    <ArrowRight size={15} weight="bold" />
                  </button>
                  <p className="text-[11px] text-center text-text-muted">
                    Takes you directly to Prism Settings &gt; License to choose your plan.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 text-xs text-text-muted border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Lightning size={15} className="text-yellow-400 shrink-0" />
            <span>Subscriptions are securely managed in Prism Settings under the License tab.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-white transition-colors cursor-pointer text-xs font-medium"
          >
            Close Window
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
