import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  EnvelopeSimple,
  LockSimple,
  User,
  Buildings,
  ArrowRight,
  CircleNotch,
  CheckCircle,
  WarningCircle,
  ShieldCheck,
  Sparkle
} from '@phosphor-icons/react'
import type { UserProfile } from '../../../shared/types'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthSuccess: (user: UserProfile) => void
}

type AuthTab = 'signin' | 'signup' | 'forgot'

function formatAuthErrorMessage(rawError?: string | null): string {
  if (!rawError) return 'An unexpected error occurred.'
  const lower = rawError.toLowerCase()
  if (lower.includes('rate limit') || lower.includes('email_rate_limit')) {
    return 'The email verification service is currently busy due to rate limits. Please try again in a few minutes.'
  }
  return rawError
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [tab, setTab] = useState<AuthTab>('signin')

  // Form State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [accountType, setAccountType] = useState<'individual' | 'enterprise'>('individual')

  // UI state
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [showResendEmail, setShowResendEmail] = useState(false)

  if (!isOpen) return null

  const resetForm = () => {
    setErrorMsg(null)
    setSuccessMsg(null)
    setShowResendEmail(false)
  }

  const handleTabSwitch = (newTab: AuthTab) => {
    resetForm()
    setTab(newTab)
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    resetForm()

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.')
      return
    }

    setLoading(true)
    try {
      const res = await window.api.authLogin({ email, password })
      setLoading(false)

      if (!res.success || !res.user) {
        setErrorMsg(formatAuthErrorMessage(res.error || 'Failed to sign in. Please check your credentials.'))
        return
      }

      onAuthSuccess(res.user)
      onClose()
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(formatAuthErrorMessage(err?.message))
    }
  }

  const handleResendConfirmation = async () => {
    if (!email) {
      setErrorMsg('Please enter your email address to resend verification link.')
      return
    }
    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)
    try {
      const res = await window.api.authResendConfirmation(email)
      setLoading(false)
      if (res.success) {
        setSuccessMsg('Verification link sent! Check your email inbox to confirm your account.')
      } else {
        setErrorMsg(formatAuthErrorMessage(res.error || 'Failed to send verification email. Please check your email address.'))
      }
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(formatAuthErrorMessage(err?.message))
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    resetForm()

    if (!email || !password || !fullName) {
      setErrorMsg('Full name, email, and password are required.')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.')
      return
    }

    setLoading(true)
    try {
      const res = await window.api.authSignUp({
        email,
        password,
        fullName,
        companyName: companyName.trim(),
        accountType
      })
      setLoading(false)

      if (!res.success || !res.user) {
        setErrorMsg(formatAuthErrorMessage(res.error || 'Registration failed. Please try again.'))
        return
      }

      onAuthSuccess(res.user)
      if (!res.user.emailConfirmed) {
        setSuccessMsg('Account created! The email verification service is currently busy. You are logged in and can verify your email anytime later to unlock Prism Cloud AI models.')
      } else {
        onClose()
      }
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(formatAuthErrorMessage(err?.message))
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    resetForm()

    if (!email) {
      setErrorMsg('Please enter your account email address.')
      return
    }

    setLoading(true)
    try {
      const res = await window.api.authResetPassword(email)
      setLoading(false)

      if (!res.success) {
        setErrorMsg(formatAuthErrorMessage(res.error || 'Could not process password reset.'))
        return
      }

      setSuccessMsg('Password reset link sent! Check your email inbox.')
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(formatAuthErrorMessage(err?.message))
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-soft-pop">
      <div className="relative flex flex-col w-full max-w-md rounded-[28px] border border-white/[0.12] bg-[#0E0F12]/95 p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden space-y-5 text-text-primary">
        {/* Glow ambient background effect */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-56 w-56 rounded-full bg-purple-600/10 blur-3xl" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-text-muted hover:text-text-primary p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Top Header */}
        <div className="flex flex-col items-center text-center pt-2 space-y-1.5 select-none">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-primary/15 border border-accent-primary/30 text-accent-primary shadow-inner mb-1">
            <ShieldCheck size={26} weight="fill" />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Prism Account</h2>
          <p className="text-xs text-text-secondary max-w-xs leading-relaxed">
            {tab === 'signin' && 'Sign in to access corporate workspace features and sync.'}
            {tab === 'signup' && 'Create your Prism account for personal or company access.'}
            {tab === 'forgot' && 'Reset your account password.'}
          </p>
        </div>

        {/* Free AI Highlight Banner */}
        <div className="flex items-start gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-300">
          <Sparkle size={20} weight="fill" className="shrink-0 text-blue-400 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold text-white block">Unlock Free AI Access</span>
            <p className="text-[11px] text-blue-200/80 leading-snug">
              Sign in and verify your email to unlock free AI models powered by Prism Cloud (available for all verified accounts)!
            </p>
          </div>
        </div>

        {/* Navigation Tabs (SignIn vs SignUp) */}
        {tab !== 'forgot' && (
          <div className="flex w-full rounded-xl bg-white/[0.04] p-1 border border-white/[0.06] select-none">
            <button
              onClick={() => handleTabSwitch('signin')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                tab === 'signin'
                  ? 'bg-accent-primary text-white shadow-md'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => handleTabSwitch('signup')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                tab === 'signup'
                  ? 'bg-accent-primary text-white shadow-md'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Status Banners */}
        {errorMsg && (
          <div className="flex flex-col gap-2 rounded-xl border border-status-error/30 bg-status-error/10 p-3 text-xs text-status-error animate-soft-pop">
            <div className="flex items-start gap-2.5">
              <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
              <span className="leading-tight">{errorMsg}</span>
            </div>
            {showResendEmail && email && (
              <button
                type="button"
                onClick={handleResendConfirmation}
                className="self-end text-[11px] font-semibold text-accent-primary hover:underline cursor-pointer pt-1"
              >
                Resend Verification Email
              </button>
            )}
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-status-success/30 bg-status-success/10 p-3 text-xs text-status-success animate-soft-pop">
            <CheckCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-tight">{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        {tab === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Email Address
              </label>
              <div className="relative flex items-center">
                <EnvelopeSimple size={16} className="absolute left-3.5 text-text-muted" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => handleTabSwitch('forgot')}
                  className="text-[11px] text-accent-primary hover:underline cursor-pointer"
                >
                  Forgot?
                </button>
              </div>
              <div className="relative flex items-center">
                <LockSimple size={16} className="absolute left-3.5 text-text-muted" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary py-2.5 px-4 text-xs font-bold text-white hover:bg-accent-primary/90 transition-all shadow-md active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <CircleNotch size={18} className="animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
        )}

        {tab === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Full Name
              </label>
              <div className="relative flex items-center">
                <User size={16} className="absolute left-3.5 text-text-muted" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Work Email
              </label>
              <div className="relative flex items-center">
                <EnvelopeSimple size={16} className="absolute left-3.5 text-text-muted" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Password
              </label>
              <div className="relative flex items-center">
                <LockSimple size={16} className="absolute left-3.5 text-text-muted" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                />
              </div>
            </div>

            {/* Account Type Toggle */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Account Scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountType('individual')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                    accountType === 'individual'
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary font-semibold'
                      : 'border-white/10 bg-black/30 text-text-muted hover:text-text-primary'
                  }`}
                >
                  <User size={14} /> Individual
                </button>

                <button
                  type="button"
                  onClick={() => setAccountType('enterprise')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                    accountType === 'enterprise'
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary font-semibold'
                      : 'border-white/10 bg-black/30 text-text-muted hover:text-text-primary'
                  }`}
                >
                  <Buildings size={14} /> Enterprise / Org
                </button>
              </div>
            </div>

            {/* Company Name field for Enterprise */}
            {accountType === 'enterprise' && (
              <div className="space-y-1 animate-soft-pop">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  Company / Organization Name
                </label>
                <div className="relative flex items-center">
                  <Buildings size={16} className="absolute left-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary py-2.5 px-4 text-xs font-bold text-white hover:bg-accent-primary/90 transition-all shadow-md active:scale-[0.98] cursor-pointer disabled:opacity-50 mt-1"
            >
              {loading ? (
                <CircleNotch size={18} className="animate-spin" />
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight size={16} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
        )}

        {tab === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Email Address
              </label>
              <div className="relative flex items-center">
                <EnvelopeSimple size={16} className="absolute left-3.5 text-text-muted" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleTabSwitch('signin')}
                className="flex-1 py-2.5 px-3 text-xs font-semibold text-text-secondary bg-white/[0.05] hover:bg-white/[0.1] rounded-xl transition-all cursor-pointer"
              >
                Back to Sign In
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-bold text-white bg-accent-primary hover:bg-accent-primary/90 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                {loading ? <CircleNotch size={18} className="animate-spin" /> : <span>Send Reset Link</span>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
