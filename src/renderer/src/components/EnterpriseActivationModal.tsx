import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, Clock, Check, X } from '@phosphor-icons/react'
import type { LicenseInfo } from '../../../shared/types'

interface EnterpriseActivationModalProps {
  licenseInfo: LicenseInfo
  onClose: () => void
}

function useLicenseCountdown(expiresAt?: string): string {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft('')
      return
    }

    const update = () => {
      const now = Date.now()
      const expiry = new Date(expiresAt).getTime()
      const diff = expiry - now

      if (diff <= 0) {
        setTimeLeft('Expired')
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      const pad = (n: number) => String(n).padStart(2, '0')

      if (days > 0) {
        setTimeLeft(`${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`)
      } else if (hours > 0) {
        setTimeLeft(`${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`)
      } else {
        setTimeLeft(`${pad(minutes)}m ${pad(seconds)}s`)
      }
    }

    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  return timeLeft
}

export const EnterpriseActivationModal: React.FC<EnterpriseActivationModalProps> = ({
  licenseInfo,
  onClose
}) => {
  const countdownText = useLicenseCountdown(licenseInfo.expiresAt)

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-soft-pop">
      <div className="prism-modal-panel relative flex max-h-[calc(100vh-32px)] w-full max-w-md flex-col overflow-y-auto p-6 text-text-primary">
        {/* Glow ambient background effect */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-56 w-56 rounded-full bg-accent-primary/5 blur-3xl" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-text-muted hover:text-text-primary p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5 pt-1">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-primary/15 border border-accent-primary/30 text-accent-primary shadow-inner">
            <CheckCircle size={28} weight="fill" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-lg font-bold text-text-primary tracking-tight">
              Enterprise License Activated!
            </h2>
            <p className="text-xs text-text-secondary/80 leading-relaxed">
              Cryptographic signature verified and registered.
            </p>
          </div>
        </div>

        {/* Real-Time Countdown Card */}
        <div className="flex items-center justify-between rounded-2xl border border-accent-primary/25 bg-accent-primary/[0.07] px-4 py-3 shadow-inner">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-accent-primary animate-pulse" />
            <span className="text-xs font-semibold text-text-secondary">Time Remaining:</span>
          </div>
          <span className="font-mono text-sm font-bold text-accent-primary tracking-wider">
            {countdownText || 'Calculating...'}
          </span>
        </div>

        {/* Detailed Metadata Grid */}
        <div className="grid grid-cols-2 gap-3.5 rounded-2xl border border-white/[0.08] bg-black/40 p-4 text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Licensee / Company
            </span>
            <span className="font-bold text-text-primary truncate" title={licenseInfo.licensee}>
              {licenseInfo.licensee}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Authorized Email
            </span>
            <span className="font-medium text-text-primary truncate" title={licenseInfo.email}>
              {licenseInfo.email}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              License Type
            </span>
            <span className="font-mono font-bold text-accent-primary">{licenseInfo.type}</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Seats Authorized
            </span>
            <span className="font-semibold text-text-primary">{licenseInfo.seats} Seat(s)</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              License ID
            </span>
            <span
              className="font-mono text-[11px] text-text-secondary truncate"
              title={licenseInfo.id}
            >
              {licenseInfo.id}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Signature Status
            </span>
            <span className="font-medium text-status-success flex items-center gap-1">
              <Check size={13} weight="bold" /> Verified (Ed25519)
            </span>
          </div>

          <div className="flex flex-col gap-0.5 col-span-2 border-t border-white/[0.06] pt-2 mt-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                Issued Date:
              </span>
              <span className="text-[11px] text-text-secondary font-mono">
                {new Date(licenseInfo.issuedAt).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                Expiration Date:
              </span>
              <span className="text-[11px] text-text-secondary font-mono">
                {new Date(licenseInfo.expiresAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 text-xs font-bold text-white bg-accent-primary hover:bg-accent-primary/90 rounded-2xl transition-all shadow-md hover:shadow-accent-primary/25 cursor-pointer active:scale-[0.98]"
        >
          Continue using Prism Enterprise
        </button>
      </div>
    </div>,
    document.body
  )
}
