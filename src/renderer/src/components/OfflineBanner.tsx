import React from 'react'
import { WarningCircle } from '@phosphor-icons/react'

/**
 * Persistent red banner shown when the user is offline. Surfaced at the root
 * shell level so it spans chat, tasks, and settings views. Messaging is
 * blocked separately in handleSend while this banner is visible.
 */
export function OfflineBanner(): React.JSX.Element {
  return (
    <div className="w-full px-6 pt-3 sm:px-12 animate-soft-pop">
      <div className="premium-panel-soft flex items-center gap-3 rounded-[22px] border-status-error/30 px-5 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-status-error/20 bg-status-error/[0.12] text-status-error">
          <WarningCircle size={18} weight="fill" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-status-error">No internet connection</span>
          <span className="text-xs text-status-error/70">
            Messaging is unavailable until you reconnect.
          </span>
        </div>
      </div>
    </div>
  )
}
