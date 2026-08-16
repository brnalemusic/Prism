import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  User,
  Buildings,
  SignOut,
  ShieldCheck,
  CheckCircle,
  WarningCircle,
  CircleNotch,
  EnvelopeSimple,
  PencilSimple,
  Check,
  Sparkle,
  Trash,
  ArrowSquareOut,
  Key,
  ShieldWarning
} from '@phosphor-icons/react'
import { DeleteAccountModal } from './DeleteAccountModal'
import type { UserProfile } from '../../../shared/types'

interface UserProfileModalProps {
  isOpen: boolean
  user: UserProfile | null
  onClose: () => void
  onLoggedOut: () => void
  onProfileUpdated: (user: UserProfile) => void
}

function formatActivationInput(val: string): string {
  const digits = val.replace(/\D/g, '').slice(0, 6)
  if (digits.length <= 3) return digits
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  user,
  onClose,
  onLoggedOut,
  onProfileUpdated
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [fullName, setFullName] = useState(user?.fullName || '')
  const [companyName, setCompanyName] = useState(user?.companyName || '')
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Activation flow state
  const [activationCode, setActivationCode] = useState('')
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [activationSuccess, setActivationSuccess] = useState<string | null>(null)
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0)

  const isActivated = user?.activationStatus === 'active'

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '')
      setCompanyName(user.companyName || '')
    }
  }, [user])

  // Countdown timer for rate limiting
  useEffect(() => {
    if (rateLimitSeconds <= 0) return
    const interval = setInterval(() => {
      setRateLimitSeconds((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [rateLimitSeconds])

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (!isOpen || !user) return null

  const isEnterprise = user.accountType === 'enterprise' || user.accountType === 'company'

  const initials = user.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : user.email.slice(0, 2).toUpperCase()

  const handleSignOut = async () => {
    setLoading(true)
    try {
      const signedOut = await window.api.authLogout()
      if (!signedOut) {
        setLoading(false)
        setErrorMsg(
          'Unable to securely sign out while the local license entitlement is still active. Please reconnect and try again.'
        )
        return
      }
      setLoading(false)
      onLoggedOut()
      onClose()
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(err?.message || 'Failed to sign out.')
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await window.api.authUpdateProfile({
        fullName,
        companyName
      })
      setLoading(false)

      if (!res.success || !res.user) {
        setErrorMsg(res.error || 'Failed to update profile.')
        return
      }

      setSuccessMsg('Profile updated successfully!')
      setIsEditing(false)
      onProfileUpdated(res.user)
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(err?.message || 'An unexpected error occurred.')
    }
  }

  const handleActivateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setActivationError(null)
    setActivationSuccess(null)

    const cleanedCode = activationCode.trim()
    if (!/^\d{3}-\d{3}$/.test(cleanedCode)) {
      setActivationError('Please enter a valid 6-digit code in XXX-XXX format.')
      return
    }

    if (rateLimitSeconds > 0) {
      setActivationError(`Rate limit exceeded. Please wait ${rateLimitSeconds}s before trying again.`)
      return
    }

    setActivating(true)
    try {
      const res = await window.api.authActivateAccount(cleanedCode)
      setActivating(false)

      if (res.success && res.status === 'active') {
        setActivationSuccess('Account activated successfully! Prism Cloud models are now active.')
        setActivationCode('')
        onProfileUpdated({
          ...user,
          activationStatus: 'active',
          activatedAt: res.activatedAt ?? new Date().toISOString()
        })
      } else {
        if (res.retryAfter) {
          setRateLimitSeconds(res.retryAfter)
        }
        setActivationError(res.error || 'Invalid or expired activation code.')
      }
    } catch (err: any) {
      setActivating(false)
      setActivationError(err?.message || 'Failed to activate account.')
    }
  }

  const handleOpenWebSettings = () => {
    void window.api.openExternalUrl('https://prismagent.vercel.app/account/settings')
  }

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-soft-pop">
      <div className="prism-modal-panel profile-modal-panel relative flex max-h-[calc(100vh-32px)] w-full max-w-[520px] flex-col overflow-y-auto p-6 text-text-primary scrollbar-none">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-text-muted hover:text-text-primary p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Top Header */}
        <div className="flex items-center gap-4 pt-1">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] text-lg font-semibold text-accent-primary">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName || user.email}
                className="h-full w-full rounded-xl object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
            {isEnterprise && (
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-[10px] text-white shadow-md">
                <ShieldCheck size={13} weight="fill" />
              </span>
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <h2 className="text-lg font-bold text-white tracking-tight truncate">
              {user.fullName || 'Prism User'}
            </h2>
            <p className="text-xs text-text-secondary truncate">{user.email}</p>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span
                className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  isEnterprise
                    ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary'
                    : 'border-white/10 bg-white/[0.05] text-text-muted'
                }`}
              >
                {isEnterprise ? 'ENTERPRISE ACCOUNT' : 'INDIVIDUAL ACCOUNT'}
              </span>

              {isActivated ? (
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
                  ACCOUNT ACTIVE
                </span>
              ) : (
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-300">
                  ACTIVATION REQUIRED
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status Banners */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-status-error/30 bg-status-error/10 p-3 text-xs text-status-error animate-soft-pop my-2">
            <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-tight">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-status-success/30 bg-status-success/10 p-3 text-xs text-status-success animate-soft-pop my-2">
            <CheckCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-tight">{successMsg}</span>
          </div>
        )}

        {/* Account Activation Section (If Inactive) */}
        {!isActivated && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-3 my-3 animate-soft-pop">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
              <div className="flex items-center gap-2">
                <ShieldWarning size={18} className="text-amber-400" weight="fill" />
                <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">
                  Prism Cloud Activation
                </span>
              </div>
              <button
                type="button"
                onClick={handleOpenWebSettings}
                className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-100 font-semibold transition-colors cursor-pointer"
              >
                <span>Get code on Web</span>
                <ArrowSquareOut size={13} />
              </button>
            </div>

            <p className="text-xs text-text-secondary leading-relaxed">
              Prism Cloud AI models require account activation. Generate a 1-minute activation code in your web account settings and enter it below.
            </p>

            <form onSubmit={handleActivateAccount} className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Key size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={activationCode}
                    onChange={(e) => setActivationCode(formatActivationInput(e.target.value))}
                    placeholder="XXX-XXX"
                    maxLength={7}
                    className="w-full rounded-xl border border-white/10 bg-black/50 py-2 pl-10 pr-3 font-mono text-sm tracking-widest text-white placeholder:text-text-muted/50 focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={activating || activationCode.length < 7 || rateLimitSeconds > 0}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 transition-all cursor-pointer disabled:opacity-40"
                >
                  {activating ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : rateLimitSeconds > 0 ? (
                    <span>Wait {rateLimitSeconds}s</span>
                  ) : (
                    <span>Activate</span>
                  )}
                </button>
              </div>

              {activationError && (
                <div className="flex items-center gap-1.5 text-xs text-status-error pt-1 animate-soft-pop">
                  <WarningCircle size={14} weight="fill" className="shrink-0" />
                  <span>{activationError}</span>
                </div>
              )}

              {activationSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 pt-1 animate-soft-pop">
                  <CheckCircle size={14} weight="fill" className="shrink-0" />
                  <span>{activationSuccess}</span>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Prism Cloud AI Quota Action Card */}
        {!isEditing && isActivated && (
          <div className="rounded-2xl border border-accent-primary/20 bg-accent-primary/[0.04] p-4 my-2 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkle size={16} className="text-accent-primary" weight="fill" />
                <span className="text-xs font-bold text-white tracking-wide">
                  Prism Cloud AI Limits & Quotas
                </span>
              </div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
                Cloud Managed
              </span>
            </div>

            <p className="text-xs text-text-secondary leading-relaxed">
              Live model capacity, 5-hour rolling reset windows, and weekly allocations across all Arcadia models are managed securely on Prism Cloud.
            </p>

            <button
              type="button"
              onClick={() => {
                void window.api.openExternalUrl('https://prismagent.vercel.app/account/quota')
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-accent-primary/40 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary hover:text-white py-2.5 text-xs font-semibold transition-all duration-200 cursor-pointer shadow-sm"
            >
              <span>View Quotas & Limits in Prism Cloud</span>
              <ArrowSquareOut size={14} weight="bold" />
            </button>
          </div>
        )}

        {/* Details or Edit Form */}
        {!isEditing ? (
          <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-black p-4 text-xs my-2">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
              <div className="flex items-center gap-2 text-text-muted">
                <User size={15} />
                <span>Full Name:</span>
              </div>
              <span className="font-semibold text-white truncate max-w-[200px]">
                {user.fullName || '—'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
              <div className="flex items-center gap-2 text-text-muted">
                <EnvelopeSimple size={15} />
                <span>Email:</span>
              </div>
              <span className="font-medium text-white truncate max-w-[200px]">{user.email}</span>
            </div>

            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
              <div className="flex items-center gap-2 text-text-muted">
                <Buildings size={15} />
                <span>Company / Org:</span>
              </div>
              <span className="font-semibold text-white truncate max-w-[200px]">
                {user.companyName || '—'}
              </span>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={handleOpenWebSettings}
                className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-white transition-colors cursor-pointer"
              >
                <ArrowSquareOut size={14} /> Manage web settings
              </button>

              <button
                type="button"
                onClick={() => {
                  setFullName(user.fullName || '')
                  setCompanyName(user.companyName || '')
                  setIsEditing(true)
                }}
                className="flex items-center gap-1.5 text-xs text-accent-primary hover:underline font-semibold cursor-pointer"
              >
                <PencilSimple size={14} /> Edit Profile
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveProfile} className="space-y-3.5 animate-soft-pop my-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-3 pr-3 text-xs text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Company / Organization Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-3 pr-3 text-xs text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="flex-1 py-2 text-xs font-medium text-text-muted bg-white/[0.04] hover:bg-white/[0.08] rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-black bg-accent-primary hover:bg-accent-primary/90 rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <>
                    <Check size={14} /> Save
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Footer actions */}
        <div className="flex flex-col gap-3 border-t border-[var(--border-default)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSignOut}
              disabled={loading}
              className="flex items-center gap-1.5 py-2 px-3 text-xs font-semibold text-status-error hover:bg-status-error/10 rounded-xl transition-all cursor-pointer"
            >
              <SignOut size={16} />
              <span>Sign Out</span>
            </button>

            <button
              onClick={() => setIsDeleteModalOpen(true)}
              disabled={loading}
              className="flex items-center gap-1.5 py-2 px-3 text-xs font-semibold text-red-400 hover:bg-red-500/10 rounded-xl transition-all cursor-pointer"
            >
              <Trash size={15} />
              <span>Delete Account</span>
            </button>
          </div>

          <button onClick={onClose} className="settings-secondary-button">
            Close
          </button>
        </div>

        {/* Separate Delete Account Modal */}
        <DeleteAccountModal
          isOpen={isDeleteModalOpen}
          user={user}
          onClose={() => setIsDeleteModalOpen(false)}
          onAccountDeleted={() => {
            onLoggedOut()
            onClose()
          }}
        />
      </div>
    </div>,
    document.body
  )
}
