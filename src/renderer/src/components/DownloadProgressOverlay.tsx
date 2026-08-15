import React from 'react'
import clsx from 'clsx'
import { CheckCircle, CircleNotch, DownloadSimple, XCircle } from '@phosphor-icons/react'
import type { DownloadProgress } from '../../../shared/types'

interface DownloadProgressOverlayProps {
  downloads: DownloadProgress[]
  className?: string
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function getStatusLabel(download: DownloadProgress): string {
  switch (download.status) {
    case 'starting':
      return 'Starting...'
    case 'downloading':
      return typeof download.percent === 'number'
        ? `${Math.round(download.percent)}%`
        : 'Downloading'
    case 'saving':
      return 'Saving...'
    case 'completed':
      return 'Saved'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Downloading'
  }
}

function getIcon(download: DownloadProgress): React.JSX.Element {
  if (download.status === 'completed') {
    return <CheckCircle size={15} weight="fill" className="text-status-success" />
  }

  if (download.status === 'failed' || download.status === 'cancelled') {
    return <XCircle size={15} weight="fill" className="text-status-error" />
  }

  if (download.status === 'saving') {
    return <CircleNotch size={15} weight="bold" className="animate-spin text-accent-secondary" />
  }

  return <DownloadSimple size={15} weight="bold" className="text-accent-secondary" />
}

export function DownloadProgressOverlay({
  downloads,
  className = 'fixed right-4 top-28 z-40 w-[min(360px,calc(100vw-2rem))] sm:right-5'
}: DownloadProgressOverlayProps): React.JSX.Element | null {
  if (downloads.length === 0) return null

  return (
    <div className={clsx('pointer-events-none flex flex-col gap-2', className)}>
      {downloads.map((download) => {
        const isActive =
          download.status === 'starting' ||
          download.status === 'downloading' ||
          download.status === 'saving'
        const hasPercent = typeof download.percent === 'number'
        const received = formatBytes(download.receivedBytes)
        const total = formatBytes(download.totalBytes)
        const detail = download.error || (received && total ? `${received} / ${total}` : received)
        const progress = Math.max(0, Math.min(100, download.percent || 0))
        const isProblem = download.status === 'failed' || download.status === 'cancelled'

        return (
          <div
            key={download.id}
            title={download.targetPath || download.filename}
            className="animate-soft-pop overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[0_10px_28px_rgba(0,0,0,0.32)]"
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.045]">
                {getIcon(download)}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-text-primary">
                    {download.filename}
                  </span>
                  <span
                    className={`shrink-0 text-[10.5px] font-medium ${
                      isProblem ? 'text-status-error' : 'text-text-secondary'
                    }`}
                  >
                    {getStatusLabel(download)}
                  </span>
                </div>

                {detail && (
                  <div className="truncate text-[10.5px] leading-none text-text-secondary/70">
                    {detail}
                  </div>
                )}
              </div>
            </div>

            <div className="h-0.5 overflow-hidden bg-white/[0.07]">
              {hasPercent ? (
                <div
                  className={`h-full transition-[width] duration-200 ${
                    isProblem ? 'bg-status-error/80' : 'bg-accent-secondary'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              ) : (
                <div
                  className={
                    isActive
                      ? 'download-progress-indeterminate h-full bg-accent-secondary/80'
                      : `h-full w-full ${isProblem ? 'bg-status-error/70' : 'bg-status-success/70'}`
                  }
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
