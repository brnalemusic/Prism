import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { CreditCard, LockKey, ShieldCheck, CheckCircle as CheckCircle2, CircleNotch, X } from '@phosphor-icons/react'
import type { SubscriptionPlan, UserProfile } from '../../../shared/types'

interface StripeCheckoutModalProps {
  plan: SubscriptionPlan
  userProfile?: UserProfile | null
  onClose: () => void
  onConfirmPayment: (planId: string, email: string, companyName: string) => Promise<void>
}

export const StripeCheckoutModal: React.FC<StripeCheckoutModalProps> = ({
  plan,
  userProfile,
  onClose,
  onConfirmPayment
}) => {
  const [email, setEmail] = useState(userProfile?.email || 'customer@prism.app')
  const [companyName, setCompanyName] = useState(userProfile?.companyName || userProfile?.fullName || 'Enterprise Licensee')
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242')
  const [cardExpiry, setCardExpiry] = useState('12/28')
  const [cardCvc, setCardCvc] = useState('123')
  const [isProcessing, setIsProcessing] = useState(false)

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsProcessing(true)
    try {
      await onConfirmPayment(plan.id, email, companyName)
    } finally {
      setIsProcessing(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-soft-pop">
      <div className="relative flex flex-col w-full max-w-lg rounded-[28px] border border-white/[0.12] bg-[#0F1015]/95 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden text-text-primary">
        
        {/* Stripe Brand Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#635BFF]/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#635BFF] text-white shadow-sm font-extrabold text-sm">
              S
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-text-primary tracking-tight flex items-center gap-1.5">
                Stripe Checkout
                <span className="text-[10px] font-mono font-bold bg-[#635BFF]/20 text-[#635BFF] border border-[#635BFF]/30 px-2 py-0.5 rounded-full uppercase">
                  Secure SSL
                </span>
              </span>
              <span className="text-[11px] text-text-secondary/70">
                Powered by Stripe & Supabase Database
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handlePay} className="p-6 space-y-5">
          {/* Order Summary Box */}
          <div className="flex items-center justify-between p-4 rounded-2xl border border-white/[0.08] bg-black/40 shadow-inner">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-text-primary">{plan.name}</span>
              <span className="text-[11px] text-text-secondary/80">{plan.description}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono text-xl font-extrabold text-accent-primary">
                ${plan.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">
                USD / {plan.billingInterval}
              </span>
            </div>
          </div>

          {/* Customer Info Input Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-muted">Account Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/[0.1] bg-black/50 p-2.5 text-xs text-text-primary placeholder:text-text-muted/40 focus:border-[#635BFF] focus:outline-none transition-colors font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-muted">Company / Licensee Name</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-xl border border-white/[0.1] bg-black/50 p-2.5 text-xs text-text-primary placeholder:text-text-muted/40 focus:border-[#635BFF] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Card Payment Section */}
          <div className="flex flex-col gap-2.5 pt-1">
            <label className="text-[11px] font-semibold text-text-muted flex items-center justify-between">
              <span>Card Details</span>
              <span className="flex items-center gap-1 text-[10px] text-status-success font-normal">
                <ShieldCheck size={13} /> 256-bit Encrypted
              </span>
            </label>

            <div className="flex flex-col rounded-xl border border-white/[0.1] bg-black/50 overflow-hidden divide-y divide-white/[0.08]">
              <div className="relative flex items-center px-3.5 py-2.5">
                <CreditCard size={18} className="text-[#635BFF] mr-2.5 shrink-0" />
                <input
                  type="text"
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="w-full bg-transparent font-mono text-xs text-text-primary focus:outline-none"
                  placeholder="4242 4242 4242 4242"
                />
                <LockKey size={14} className="text-text-muted shrink-0 ml-2" />
              </div>

              <div className="grid grid-cols-2 divide-x divide-white/[0.08] px-1 py-1">
                <input
                  type="text"
                  required
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(e.target.value)}
                  className="w-full bg-transparent px-3 py-1.5 font-mono text-xs text-text-primary focus:outline-none text-center"
                  placeholder="MM / YY"
                />
                <input
                  type="text"
                  required
                  value={cardCvc}
                  onChange={(e) => setCardCvc(e.target.value)}
                  className="w-full bg-transparent px-3 py-1.5 font-mono text-xs text-text-primary focus:outline-none text-center"
                  placeholder="CVC"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="submit"
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 text-xs font-bold text-white bg-[#635BFF] hover:bg-[#534be0] disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl transition-all shadow-lg shadow-[#635BFF]/25 cursor-pointer active:scale-[0.99]"
            >
              {isProcessing ? (
                <>
                  <CircleNotch size={16} className="animate-spin" />
                  <span>Processing Payment via Stripe...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>
                    Pay ${plan.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} & Activate
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full text-center text-xs text-text-muted hover:text-text-primary py-1.5 transition-colors cursor-pointer"
            >
              Cancel Payment
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
