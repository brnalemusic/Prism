import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ShieldCheck,
  Sparkle,
  ArrowSquareOut,
  CircleNotch,
  WarningCircle,
  Browsers,
  LockKey,
  CheckCircle
} from '@phosphor-icons/react'
import type { UserProfile } from '../../../shared/types'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthSuccess: (user: UserProfile) => Promise<boolean>
}

type AuthFlowStage = 'idle' | 'waiting' | 'verifying' | 'success'

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess: _onAuthSuccess }) => {
  const [stage, setStage] = useState<AuthFlowStage>('idle')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setStage('idle')
      setErrorMsg(null)
      setLoading(false)
      setConnectedEmail(null)
    }
  }, [isOpen])

  // Listen for the instant callback notification from main process
  useEffect(() => {
    if (!isOpen) return

    if (window.api?.onAuthCallbackReceived) {
      const unsub = window.api.onAuthCallbackReceived(() => {
        setStage('verifying')
        setErrorMsg(null)
      })
      return unsub
    }
    return () => {}
  }, [isOpen])

  if (!isOpen) return null

  const handleBeginWebLogin = async () => {
    setErrorMsg(null)
    setLoading(true)

    try {
      const res = await window.api.authBeginWebLogin()
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to launch browser authentication.')
        setLoading(false)
        return
      }

      setStage('waiting')
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
      setErrorMsg(err?.message || 'Unable to open browser.')
    }
  }

  const handleCancel = async () => {
    try {
      await window.api.authCancelWebLogin()
    } catch {
      // ignore
    }
    setStage('idle')
    setErrorMsg(null)
  }

  const handleClose = () => {
    if (stage === 'waiting' || stage === 'verifying') {
      void handleCancel()
    }
    onClose()
  }

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-soft-pop">
      <div className="prism-modal-panel auth-modal-panel relative flex max-h-[calc(100vh-32px)] w-full max-w-md flex-col overflow-y-auto p-6 text-text-primary">
        {/* Close Button */}
        {stage !== 'verifying' && stage !== 'success' && (
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 z-10 text-text-muted hover:text-text-primary p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        )}

        {/* Top Header */}
        <div className="flex flex-col items-center text-center pt-2 space-y-1.5 select-none">
          <div className="settings-icon-box mb-2">
            <ShieldCheck size={24} weight="duotone" />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Prism Account</h2>
          <p className="text-xs text-text-secondary max-w-xs leading-relaxed">
            {stage === 'verifying'
              ? 'Validating browser credentials and linking your session...'
              : stage === 'success'
                ? 'Your account has been verified and connected.'
                : 'Sign in or create your account on Prism Web to securely connect Prism Desktop.'}
          </p>
        </div>

        {/* Highlight Banner */}
        {stage === 'idle' && (
          <div className="flex items-start gap-3 rounded-xl border border-accent-primary/25 bg-accent-primary/[0.07] p-3.5 text-xs text-accent-primary my-4">
            <Sparkle size={20} weight="duotone" className="mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <span className="font-bold text-white block">Prism Cloud & AI Integration</span>
              <p className="text-[11px] leading-snug text-text-secondary">
                Authenticate safely on the web with Turnstile protection and activate access to Gemini models.
              </p>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-status-error/30 bg-status-error/10 p-3 text-xs text-status-error animate-soft-pop my-3">
            <WarningCircle size={18} weight="fill" className="shrink-0 mt-0.5" />
            <span className="leading-tight">{errorMsg}</span>
          </div>
        )}

        {/* Stage: Idle */}
        {stage === 'idle' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-text-muted space-y-2.5">
              <div className="flex items-center gap-2.5 text-text-secondary">
                <LockKey size={16} className="text-accent-primary shrink-0" />
                <span>Zero password storage in desktop app</span>
              </div>
              <div className="flex items-center gap-2.5 text-text-secondary">
                <Browsers size={16} className="text-accent-primary shrink-0" />
                <span>Protected authorization with PKCE</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleBeginWebLogin}
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent-primary py-3 px-4 text-xs font-bold text-black hover:bg-accent-primary/90 transition-all shadow-md active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <CircleNotch size={18} className="animate-spin" />
              ) : (
                <>
                  <span>Continue in Browser</span>
                  <ArrowSquareOut size={16} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>
        )}

        {/* Stage: Waiting for Browser */}
        {stage === 'waiting' && (
          <div className="space-y-4 py-2 text-center animate-soft-pop">
            <div className="flex flex-col items-center justify-center space-y-3 py-4">
              <CircleNotch size={36} className="text-accent-primary animate-spin" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">Waiting for browser sign in...</h3>
                <p className="text-xs text-text-muted max-w-xs">
                  Complete authentication on Prism Web. Your desktop session will link automatically upon authorization.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 py-2 px-3 text-xs font-semibold text-text-secondary bg-white/[0.05] hover:bg-white/[0.1] rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBeginWebLogin}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10 rounded-xl transition-all cursor-pointer"
              >
                <ArrowSquareOut size={14} />
                <span>Reopen Browser</span>
              </button>
            </div>
          </div>
        )}

        {/* Stage: Verifying Authorization (Information Received) */}
        {stage === 'verifying' && (
          <div className="space-y-4 py-3 text-center animate-soft-pop my-2">
            <div className="flex flex-col items-center justify-center space-y-3 py-2">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-12 h-12 rounded-full bg-accent-primary/20 animate-ping opacity-60" />
                <CircleNotch size={38} className="text-accent-primary animate-spin relative z-10" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">Authorization Received</h3>
                <p className="text-xs text-text-muted max-w-xs leading-relaxed">
                  Browser authorization received. Validating cryptographic proof and linking your secure session...
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs space-y-2 text-left">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle size={15} weight="fill" />
                <span>Browser sign-in approved</span>
              </div>
              <div className="flex items-center gap-2 text-accent-primary animate-pulse">
                <CircleNotch size={15} className="animate-spin" />
                <span>Verifying PKCE exchange & session tokens...</span>
              </div>
            </div>
          </div>
        )}

        {/* Stage: Success */}
        {stage === 'success' && (
          <div className="space-y-4 py-3 text-center animate-soft-pop my-2">
            <div className="flex flex-col items-center justify-center space-y-2 py-2">
              <CheckCircle size={44} weight="duotone" className="text-emerald-400" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">Successfully Connected!</h3>
                {connectedEmail && (
                  <p className="text-xs text-text-muted">
                    Signed in as <strong className="text-white">{connectedEmail}</strong>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
