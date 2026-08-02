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
  Sparkle
} from '@phosphor-icons/react'
import type { UserProfile, UserAiUsageStatus } from '../../../shared/types'

interface UserProfileModalProps {
  isOpen: boolean
  user: UserProfile | null
  onClose: () => void
  onLoggedOut: () => void
  onProfileUpdated: (user: UserProfile) => void
}

function formatResetTime(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'Resets soon'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `Resets in ${days}d ${hours}h`
  }
  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`
  }
  return `Resets in ${minutes}m`
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
  const [aiUsage, setAiUsage] = useState<UserAiUsageStatus | null>(null)

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '')
      setCompanyName(user.companyName || '')
    }
  }, [user])

  useEffect(() => {
    if (isOpen && user) {
      window.api.getUserAiUsage()
        .then((usage) => {
          if (usage) setAiUsage(usage)
        })
        .catch((err) => console.error('Failed to load AI usage:', err))
    }
  }, [isOpen, user])

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (!isOpen || !user) return null

  const isEnterprise =
    user.accountType === 'enterprise' ||
    user.accountType === 'company'

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
      await window.api.authLogout()
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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-soft-pop">
      <div className="relative flex flex-col w-full max-w-md rounded-[28px] border border-white/[0.12] bg-[#0E0F12]/95 p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden space-y-5 text-text-primary">
        {/* Ambient glow background */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-56 w-56 rounded-full bg-purple-600/10 blur-3xl" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-text-muted hover:text-text-primary p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Top Header */}
        <div className="flex items-center gap-4 pt-1">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-primary/30 to-purple-600/30 border border-white/20 text-accent-primary font-bold text-lg shadow-inner">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName || user.email}
                className="h-full w-full rounded-2xl object-cover"
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
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  isEnterprise
                    ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary'
                    : 'border-white/10 bg-white/[0.05] text-text-muted'
                }`}
              >
                {isEnterprise ? 'ENTERPRISE ACCOUNT' : 'INDIVIDUAL ACCOUNT'}
              </span>
            </div>
          </div>
        </div>

        {/* Banners */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-status-error/30 bg-status-error/10 p-3 text-xs text-status-error animate-soft-pop">
            <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-tight">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-status-success/30 bg-status-success/10 p-3 text-xs text-status-success animate-soft-pop">
            <CheckCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-tight">{successMsg}</span>
          </div>
        )}

        {/* Prism Cloud AI Quota Card */}
        {!isEditing && (
          <div className="rounded-2xl border border-accent-primary/20 bg-accent-primary/[0.04] p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Sparkle size={16} className="text-accent-primary" weight="fill" />
                <span>Prism Cloud Quota</span>
              </div>
            </div>

            {/* 5-Hour Window Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-secondary font-medium">5-Hour Quota</span>
                  {aiUsage && aiUsage.percentage5h < 100 && aiUsage.reset5hSeconds !== undefined && (
                    <span className="text-[10px] font-mono text-text-muted/60 select-none">
                      • {formatResetTime(aiUsage.reset5hSeconds)}
                    </span>
                  )}
                </div>
                <span className="font-mono text-[11px] font-bold text-white">
                  {aiUsage ? `${aiUsage.percentage5h}% Remaining` : '100% Remaining'}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-primary to-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${aiUsage ? aiUsage.percentage5h : 100}%` }}
                />
              </div>
            </div>

            {/* Weekly Window Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-secondary font-medium">Weekly Quota</span>
                  {aiUsage && aiUsage.percentage1w < 100 && aiUsage.reset1wSeconds !== undefined && (
                    <span className="text-[10px] font-mono text-text-muted/60 select-none">
                      • {formatResetTime(aiUsage.reset1wSeconds)}
                    </span>
                  )}
                </div>
                <span className="font-mono text-[11px] font-bold text-white">
                  {aiUsage ? `${aiUsage.percentage1w}% Remaining` : '100% Remaining'}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-accent-primary rounded-full transition-all duration-500"
                  style={{ width: `${aiUsage ? aiUsage.percentage1w : 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Details or Edit Form */}
        {!isEditing ? (
          <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-black/40 p-4 text-xs">
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

            <div className="pt-1 flex items-center justify-end">
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
          <form onSubmit={handleSaveProfile} className="space-y-3.5 animate-soft-pop">
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
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-white bg-accent-primary hover:bg-accent-primary/90 rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? <CircleNotch size={16} className="animate-spin" /> : <><Check size={14} /> Save</>}
              </button>
            </div>
          </form>
        )}

        {/* Footer actions */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
          <button
            onClick={handleSignOut}
            disabled={loading}
            className="flex items-center gap-2 py-2 px-3 text-xs font-semibold text-status-error hover:bg-status-error/10 rounded-xl transition-all cursor-pointer"
          >
            <SignOut size={16} />
            <span>Sign Out</span>
          </button>

          <button
            onClick={onClose}
            className="py-2 px-4 text-xs font-medium text-text-secondary hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-xl transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
