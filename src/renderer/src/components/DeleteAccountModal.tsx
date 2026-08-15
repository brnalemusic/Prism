import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Trash,
  WarningCircle,
  CheckCircle,
  CircleNotch,
  EnvelopeSimple,
  PaperPlaneRight,
  Key
} from '@phosphor-icons/react'
import type { UserProfile } from '../../../shared/types'

interface DeleteAccountModalProps {
  isOpen: boolean
  user: UserProfile | null
  onClose: () => void
  onAccountDeleted: () => void
}

export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
  isOpen,
  user,
  onClose,
  onAccountDeleted
}) => {
  const [confirmMode, setConfirmMode] = useState<'email' | 'password'>('email')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<'request' | 'sent'>('request')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  if (!isOpen || !user) return null

  const isEmailMatching = confirmEmail.trim().toLowerCase() === user.email.toLowerCase()

  const handleRequestEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isEmailMatching) {
      setErrorMsg('Please enter your exact account email address to confirm.')
      return
    }

    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await window.api.authRequestDeleteAccountEmail(user.email)
      setLoading(false)
      if (res.success) {
        setStep('sent')
        setSuccessMsg(
          `Confirmation email sent to ${user.email}! Open your email and click the confirmation link to permanently delete your account.`
        )
      } else {
        const err = res.error || 'Failed to send confirmation email.'
        if (err.toLowerCase().includes('rate limit')) {
          setErrorMsg(
            'Supabase email limit reached (too many emails sent recently). Confirm account deletion with your password below:'
          )
          setConfirmMode('password')
        } else {
          setErrorMsg(err)
        }
      }
    } catch (err: any) {
      setLoading(false)
      const errMsg = err?.message || 'Failed to send confirmation email.'
      if (errMsg.toLowerCase().includes('rate limit')) {
        setErrorMsg(
          'Supabase email limit reached. Confirm account deletion with your password below:'
        )
        setConfirmMode('password')
      } else {
        setErrorMsg(errMsg)
      }
    }
  }

  const handleConfirmWithCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpCode.trim()) {
      setErrorMsg('Please enter the confirmation code from your email.')
      return
    }

    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await window.api.authConfirmDeleteAccount(otpCode.trim())
      setLoading(false)
      if (res.success) {
        onAccountDeleted()
        onClose()
      } else {
        setErrorMsg(res.error || 'Failed to delete account. Invalid code or expired link.')
      }
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(err?.message || 'Failed to delete account.')
    }
  }

  const handleConfirmWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) {
      setErrorMsg('Please enter your account password.')
      return
    }

    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await window.api.authConfirmDeleteAccountWithPassword(password)
      setLoading(false)
      if (res.success) {
        onAccountDeleted()
        onClose()
      } else {
        setErrorMsg(res.error || 'Failed to delete account. Incorrect password.')
      }
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(err?.message || 'Failed to delete account.')
    }
  }

  const handleCloseModal = () => {
    setConfirmEmail('')
    setPassword('')
    setOtpCode('')
    setConfirmMode('email')
    setStep('request')
    setErrorMsg(null)
    setSuccessMsg(null)
    onClose()
  }

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-soft-pop">
      <div className="prism-modal-panel danger-modal-panel relative flex max-h-[calc(100vh-32px)] w-full max-w-md flex-col overflow-y-auto border-red-500/35 p-6 text-text-primary">
        {/* Close button */}
        <button
          onClick={handleCloseModal}
          className="absolute right-4 top-4 z-10 text-text-muted hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 pt-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-red-500/30 bg-red-500/10 text-red-400">
            <Trash size={20} weight="duotone" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Delete Account</h2>
            <p className="text-xs text-text-secondary">Permanently delete your Prism account</p>
          </div>
        </div>

        {/* Status Banners */}
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

        {/* Danger Warning Box */}
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.05] p-3.5 space-y-1.5 text-xs text-red-200">
          <span className="font-bold block text-white">Warning: This action is permanent!</span>
          <p className="text-[11px] text-red-200/80 leading-relaxed">
            Deleting your account will remove your profile, licenses, and access to Prism Cloud
            models. This action CANNOT be reversed.
          </p>
        </div>

        {/* Confirmation Method Tabs */}
        {step === 'request' && (
          <div className="flex w-full rounded-xl bg-white/[0.04] p-1 border border-white/[0.06] select-none text-xs">
            <button
              type="button"
              onClick={() => {
                setConfirmMode('email')
                setErrorMsg(null)
              }}
              className={`flex-1 py-1.5 font-semibold rounded-lg transition-all cursor-pointer ${
                confirmMode === 'email'
                  ? 'bg-red-600/80 text-white shadow-md'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              Confirm via Email
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmMode('password')
                setErrorMsg(null)
              }}
              className={`flex-1 py-1.5 font-semibold rounded-lg transition-all cursor-pointer ${
                confirmMode === 'password'
                  ? 'bg-red-600/80 text-white shadow-md'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              Confirm via Password
            </button>
          </div>
        )}

        {/* Mode 1: Confirm via Email Link */}
        {step === 'request' && confirmMode === 'email' && (
          <form onSubmit={handleRequestEmail} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                Type your email to confirm (
                <span className="text-white select-all">{user.email}</span>):
              </label>
              <div className="relative">
                <EnvelopeSimple
                  size={18}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="email"
                  placeholder={user.email}
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-white placeholder:text-text-muted/40 focus:border-red-500 focus:outline-none transition-all"
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 py-2.5 text-xs font-semibold text-text-secondary hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={loading || !isEmailMatching}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
              >
                {loading ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <>
                    <PaperPlaneRight size={15} weight="bold" />
                    <span>Send Deletion Link</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Mode 2: Confirm via Account Password */}
        {step === 'request' && confirmMode === 'password' && (
          <form onSubmit={handleConfirmWithPassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                Enter your account password to confirm deletion:
              </label>
              <div className="relative">
                <Key
                  size={18}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="password"
                  placeholder="Account password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-3 text-xs text-white placeholder:text-text-muted/40 focus:border-red-500 focus:outline-none transition-all"
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 py-2.5 text-xs font-semibold text-text-secondary hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={loading || !password.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
              >
                {loading ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <>
                    <Trash size={15} weight="bold" />
                    <span>Permanently Delete</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Email Sent View + Code Input Option */}
        {step === 'sent' && (
          <div className="space-y-4">
            <form onSubmit={handleConfirmWithCode} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                  Optionally enter code from email:
                </label>
                <input
                  type="text"
                  placeholder="Enter code from email"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 px-3 text-xs text-white placeholder:text-text-muted/40 focus:border-red-500 focus:outline-none font-mono transition-all"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-2.5 text-xs font-semibold text-text-secondary hover:text-white bg-white/[0.05] hover:bg-white/[0.1] rounded-xl transition-all cursor-pointer"
                >
                  Close
                </button>

                <button
                  type="submit"
                  disabled={loading || !otpCode.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                >
                  {loading ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Trash size={15} weight="bold" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
