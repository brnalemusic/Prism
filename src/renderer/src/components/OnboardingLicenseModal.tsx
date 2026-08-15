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
  const [stripeVerifyStep, setStripeVerifyStep] = useState<
    'opening' | 'polling' | 'success' | 'error'
  >('opening')
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPaymentVerificationInFlightRef = useRef(false)

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
    isPaymentVerificationInFlightRef.current = false
  }

  if (!isOpen) return null

  const startPaymentFlowAndPolling = async (plan: SubscriptionPlan): Promise<void> => {
    setCheckoutLoadingPlanId(plan.id)
    setLicenseError(null)
    setStripeVerifying(true)
    setStripeVerifyStep('opening')

    try {
      const email = authUser?.email || ''
      const company = authUser?.companyName || authUser?.fullName || 'Enterprise Licensee'

      const res = await window.api.createCheckoutSession(plan.id, email)

      if (res.success && res.checkoutUrl && res.sessionId) {
        // Open Stripe Checkout in user's browser
        const openResult = await window.api.openExternalUrl(res.checkoutUrl)
        if (!openResult.success) {
          setStripeVerifying(false)
          setLicenseError(openResult.error || 'Unable to open the checkout in your system browser.')
          return
        }

        setStripeVerifyStep('polling')

        // Start global polling every 2 seconds
        stopPolling()
        pollIntervalRef.current = setInterval(async () => {
          if (isPaymentVerificationInFlightRef.current) return
          isPaymentVerificationInFlightRef.current = true

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

              setTimeout(() => {
                setStripeVerifying(false)
                if (onLicenseActivated) onLicenseActivated()
                onClose()
              }, 1800)
            } else if (!verifyRes.pending) {
              stopPolling()
              setStripeVerifying(false)
              setLicenseError(verifyRes.error || 'Payment verification failed. Please try again.')
            }
          } catch (pollErr) {
            console.warn('[StripePolling] Payment verification failed:', pollErr)
            stopPolling()
            setStripeVerifying(false)
            setLicenseError('Unable to verify the payment. Please try again.')
          } finally {
            isPaymentVerificationInFlightRef.current = false
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
    <div className="prism-modal-backdrop fixed inset-0 z-[9990] flex items-center justify-center p-4 sm:p-6 animate-fade-in">
      <div className="prism-modal-panel relative flex max-h-[calc(100vh-32px)] w-full max-w-2xl flex-col overflow-y-auto p-6 sm:p-8 custom-scrollbar">
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
            Prism is{' '}
            <strong className="text-status-success font-semibold">
              100% free for personal and individual use
            </strong>
            . If you use Prism within a company or enterprise, a paid license is required.
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
                    'relative flex flex-col justify-between p-6 rounded-xl border transition-colors duration-200',
                    isPopular
                      ? 'border-accent-primary/40 bg-accent-primary/[0.07]'
                      : 'border-[var(--border-default)] bg-[var(--surface)] hover:border-[var(--border-strong)]'
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
                        $
                        {plan.priceUsd.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </span>
                      <span className="text-xs text-text-muted font-medium">
                        / {plan.billingInterval}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 font-mono text-[10px] text-text-muted">
                      <span>
                        {plan.seats} {plan.seats === 1 ? 'seat' : 'seats'}
                      </span>
                      <span>{plan.durationDays} days</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-4 border-t border-white/[0.06] mt-4">
                    {authUser ? (
                      <button
                        onClick={() => startPaymentFlowAndPolling(plan)}
                        disabled={isLoadingThis || stripeVerifying}
                        className={clsx(
                          'w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-xs font-bold transition-colors cursor-pointer',
                          isPopular
                            ? 'bg-white hover:bg-neutral-200 text-black'
                            : 'bg-[var(--surface-raised)] hover:border-[var(--border-strong)] text-text-primary border border-[var(--border-default)]'
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
        <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
          <div className="prism-modal-panel flex w-full max-w-sm flex-col items-center gap-5 p-8 text-center animate-soft-pop">
            {/* Animated Indicator */}
            {stripeVerifyStep === 'success' ? (
              <div className="w-14 h-14 rounded-2xl bg-status-success/15 border border-status-success/30 flex items-center justify-center text-status-success animate-bounce">
                <CheckCircle size={32} weight="fill" />
              </div>
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-accent-primary/15 border border-accent-primary/30 flex items-center justify-center">
                <CircleNotch size={28} className="animate-spin text-accent-primary" />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-bold text-text-primary">
                {stripeVerifyStep === 'success'
                  ? 'Payment Confirmed!'
                  : stripeVerifyStep === 'opening'
                    ? 'Preparing Checkout'
                    : 'Completing Checkout'}
              </h3>

              <p className="text-xs text-text-secondary/80 leading-relaxed max-w-xs">
                {stripeVerifyStep === 'success'
                  ? 'Your Enterprise license has been activated.'
                  : stripeVerifyStep === 'opening'
                    ? 'Creating your secure checkout session.'
                    : 'Please complete your payment in the browser window.'}
              </p>
            </div>

            {/* Cancel Button */}
            {stripeVerifyStep !== 'success' && (
              <button
                onClick={handleCancelWaiting}
                className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors py-1 cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
