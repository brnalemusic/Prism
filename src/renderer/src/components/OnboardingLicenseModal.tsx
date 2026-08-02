import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  CreditCard,
  CheckCircle,
  CircleNotch,
  Building,
  User,
  Check,
  X,
  ArrowSquareOut,
  Sparkle
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type { SubscriptionPlan, UserProfile } from '../../../shared/types'
import type { AppConfig } from '../../../main/config'

interface OnboardingLicenseModalProps {
  isOpen: boolean
  onClose: () => void
  authUser: UserProfile | null
  config: AppConfig | null
  onOpenAuthModal: () => void
  onLicenseActivated?: () => void
}

export function OnboardingLicenseModal({
  isOpen,
  onClose,
  authUser,
  config,
  onOpenAuthModal,
  onLicenseActivated
}: OnboardingLicenseModalProps): React.JSX.Element | null {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [isLoadingPlans, setIsLoadingPlans] = useState(false)
  const [checkoutLoadingPlanId, setCheckoutLoadingPlanId] = useState<string | null>(null)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  // Stripe automated verification & polling state
  const [stripeVerifying, setStripeVerifying] = useState(false)
  const [stripeVerifyStep, setStripeVerifyStep] = useState<'opening' | 'polling' | 'success' | 'error'>('opening')
  const [stripeVerifyMessage, setStripeVerifyMessage] = useState('')
  const [activePlanName, setActivePlanName] = useState('')
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isOpen) {
      setIsLoadingPlans(true)
      window.api
        .getSubscriptionPlans()
        .then((fetchedPlans) => setPlans(fetchedPlans))
        .catch((err) => console.error('[OnboardingModal] Failed to load subscription plans:', err))
        .finally(() => setIsLoadingPlans(false))
    }
    return () => {
      stopPolling()
    }
  }, [isOpen])

  const stopPolling = (): void => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  if (!isOpen) return null

  const startPaymentFlowAndPolling = async (plan: SubscriptionPlan): Promise<void> => {
    setCheckoutLoadingPlanId(plan.id)
    setLicenseError(null)
    setActivePlanName(plan.name)
    setStripeVerifying(true)
    setStripeVerifyStep('opening')
    setStripeVerifyMessage(`Initializing Stripe Checkout for ${plan.name}...`)

    try {
      const email = authUser?.email || ''
      const company = authUser?.companyName || authUser?.fullName || 'Enterprise Licensee'

      const res = await window.api.createCheckoutSession(plan.id, email)

      if (res.success && res.checkoutUrl && res.sessionId) {
        // Open Stripe Checkout in user's browser
        window.open(res.checkoutUrl, '_blank')

        setStripeVerifyStep('polling')
        setStripeVerifyMessage('Checkout opened in your browser. Waiting for payment completion...')

        // Start global polling every 2 seconds
        stopPolling()
        pollIntervalRef.current = setInterval(async () => {
          try {
            const verifyRes = await window.api.verifyAndActivatePayment(
              plan.id,
              res.sessionId!,
              email || 'customer@prism.app',
              company
            )

            if (verifyRes.success) {
              stopPolling()
              setStripeVerifyStep('success')
              setStripeVerifyMessage('Payment Confirmed! Enterprise License Activated.')

              setTimeout(() => {
                setStripeVerifying(false)
                if (onLicenseActivated) onLicenseActivated()
                onClose()
              }, 1800)
            }
          } catch (pollErr) {
            console.warn('[StripePolling] Retrying verify step...', pollErr)
          }
        }, 2000)
      } else {
        stopPolling()
        setStripeVerifying(false)
        setLicenseError(res.error || 'Failed to launch Stripe Checkout.')
      }
    } catch (err: any) {
      stopPolling()
      setStripeVerifying(false)
      setLicenseError(err?.message || 'Error initializing checkout.')
    } finally {
      setCheckoutLoadingPlanId(null)
    }
  }

  const handleCancelWaiting = (): void => {
    stopPolling()
    setStripeVerifying(false)
  }

  const handleContinueFree = async (): Promise<void> => {
    if (dontShowAgain && config) {
      try {
        await window.api.saveConfig({ ...config, suppressLicenseModal: true })
      } catch (err) {
        console.error('Failed to save suppressLicenseModal config:', err)
      }
    }
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-2xl animate-fade-in">
      <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[32px] border border-white/10 bg-[#0c0d14]/95 shadow-[0_30px_90px_-15px_rgba(0,0,0,0.9)] p-6 sm:p-8 custom-scrollbar">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full text-text-muted hover:text-text-primary hover:bg-white/10 transition-all cursor-pointer"
          title="Close modal"
        >
          <X size={20} />
        </button>

        {/* Header Badge */}
        <div className="flex flex-col items-center text-center gap-3 mb-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-accent-primary/10 border border-accent-primary/25 text-accent-primary text-xs font-mono font-semibold uppercase tracking-wider shadow-sm">
            <Building size={14} />
            <span>Prism Enterprise Licensing</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">
            Choose Your Prism Plan
          </h2>

          <p className="text-xs sm:text-sm text-text-secondary/80 max-w-lg leading-relaxed">
            Prism is <strong className="text-status-success font-semibold">100% free for personal and individual use</strong>.
            If you use Prism within a company or enterprise, a paid license is required.
          </p>
        </div>

        {/* Error Banner */}
        {licenseError && (
          <div className="mb-5 p-4 rounded-2xl border border-status-error/30 bg-status-error/10 text-xs text-status-error text-center animate-soft-pop">
            {licenseError}
          </div>
        )}

        {/* Plans Grid */}
        {isLoadingPlans ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <CircleNotch size={32} className="animate-spin text-accent-primary" />
            <span className="text-xs text-text-muted">Loading license plans...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {plans.map((plan) => {
              const isPopular = plan.badge === 'Best Value' || plan.id === 'enterprise_yearly'
              const isLoadingThis = checkoutLoadingPlanId === plan.id

              return (
                <div
                  key={plan.id}
                  className={clsx(
                    'relative flex flex-col justify-between p-6 rounded-[24px] border transition-all duration-200',
                    isPopular
                      ? 'border-accent-primary/40 bg-accent-primary/[0.07] shadow-xl shadow-accent-primary/5'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15]'
                  )}
                >
                  {plan.badge && (
                    <div className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-accent-primary text-[10px] font-mono font-bold uppercase tracking-wider text-white shadow-md flex items-center gap-1">
                      <Sparkle size={10} weight="fill" />
                      <span>{plan.badge}</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <span className="text-base font-bold text-text-primary">{plan.name}</span>
                    <p className="text-xs text-text-secondary/70 leading-relaxed min-h-[36px]">
                      {plan.description}
                    </p>

                    <div className="flex items-baseline gap-1 my-2">
                      <span className="text-3xl font-extrabold text-text-primary font-mono tracking-tight">
                        ${plan.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-xs text-text-muted font-medium">
                        / {plan.billingInterval}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-4 border-t border-white/[0.06] mt-4">
                    {authUser ? (
                      <button
                        onClick={() => startPaymentFlowAndPolling(plan)}
                        disabled={isLoadingThis || stripeVerifying}
                        className={clsx(
                          'w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer',
                          isPopular
                            ? 'bg-accent-primary hover:bg-accent-primary/90 text-white shadow-accent-primary/20'
                            : 'bg-white/10 hover:bg-white/15 text-text-primary border border-white/10'
                        )}
                      >
                        {isLoadingThis ? (
                          <CircleNotch size={16} className="animate-spin" />
                        ) : (
                          <CreditCard size={16} />
                        )}
                        <span>{isLoadingThis ? 'Opening Checkout...' : 'Buy via Stripe'}</span>
                      </button>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 py-1 text-center">
                        <span className="text-[11px] text-text-muted">
                          Sign in to purchase a license
                        </span>
                        <button
                          onClick={onOpenAuthModal}
                          className="text-[11px] font-semibold text-accent-primary hover:underline cursor-pointer"
                        >
                          Sign In / Create Account &rarr;
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Bottom Actions & Custom Checkbox */}
        <div className="flex flex-col items-center gap-4 border-t border-white/[0.08] pt-5 mt-2 text-center">
          {/* Custom Styled Checkbox Toggle */}
          <button
            type="button"
            onClick={() => setDontShowAgain(!dontShowAgain)}
            className="inline-flex items-center gap-3 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer select-none group"
          >
            <div
              className={clsx(
                'w-4 h-4 rounded-md border flex items-center justify-center transition-all duration-150',
                dontShowAgain
                  ? 'bg-accent-primary border-accent-primary shadow-sm shadow-accent-primary/40'
                  : 'border-white/20 bg-white/5 group-hover:border-white/40'
              )}
            >
              {dontShowAgain && <Check size={11} weight="bold" className="text-white" />}
            </div>
            <span className="font-medium">Don't show this again on startup</span>
          </button>

          {/* Continue for free (individual) button */}
          <button
            onClick={handleContinueFree}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors py-1 cursor-pointer"
          >
            <User size={14} />
            <span>Continue for free (individual)</span>
          </button>
        </div>
      </div>

      {/* Global Automated Payment Verification Portal Overlay */}
      {stripeVerifying && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-2xl animate-fade-in p-4">
          <div className="flex flex-col items-center gap-6 p-8 sm:p-10 rounded-[32px] border border-white/10 bg-[#0a0b12]/95 shadow-[0_30px_90px_-10px_rgba(0,0,0,0.95)] text-center max-w-md w-full animate-soft-pop">
            {/* Animated Indicator */}
            {stripeVerifyStep === 'success' ? (
              <div className="w-16 h-16 rounded-2xl bg-status-success/15 border border-status-success/30 flex items-center justify-center text-status-success animate-bounce">
                <CheckCircle size={36} weight="fill" />
              </div>
            ) : (
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-[#635BFF]/15 border border-[#635BFF]/30 flex items-center justify-center">
                  <CircleNotch size={32} className="animate-spin text-[#635BFF]" />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] font-bold tracking-widest text-[#635BFF] uppercase">
                {stripeVerifyStep === 'success' ? 'Subscription Active' : 'Stripe Automatic Verification'}
              </span>

              <h3 className="text-lg font-bold text-text-primary">
                {stripeVerifyStep === 'success'
                  ? 'Payment Verified Successfully!'
                  : `Waiting for ${activePlanName} Payment...`}
              </h3>

              <p className="text-xs text-text-secondary/80 leading-relaxed max-w-xs">
                {stripeVerifyMessage ||
                  (stripeVerifyStep === 'success'
                    ? 'Your Enterprise license has been issued and applied automatically.'
                    : 'Please complete your checkout in the browser window. Prism is automatically checking your payment status every 2 seconds.')}
              </p>
            </div>

            {/* Browser Reminder Badge */}
            {stripeVerifyStep !== 'success' && (
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[11px] text-text-secondary">
                <ArrowSquareOut size={14} className="text-[#635BFF]" />
                <span>Keep your browser window open during checkout</span>
              </div>
            )}

            {/* Cancel Button */}
            {stripeVerifyStep !== 'success' && (
              <button
                onClick={handleCancelWaiting}
                className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors py-1 cursor-pointer"
              >
                Cancel / Close Waiting Window
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
