import { Minus, X } from '@phosphor-icons/react'
import React, { useState, useEffect } from 'react'
import { StreamContext, AnimatedStreamingText, useStreamStats } from './AnimatedStreamingText'

interface TitleBarProps {
  onClose?: () => void
  onMinimize?: () => void
  onMaximize?: () => void
  title?: string
  isStreaming?: boolean
}

interface StreamTitleWrapperProps {
  title: string
}

const StreamTitleWrapper = React.memo(function StreamTitleWrapper({
  title
}: StreamTitleWrapperProps) {
  const streamStats = useStreamStats(title, true)
  return (
    <StreamContext.Provider value={streamStats}>
      <AnimatedStreamingText text={title} isStreaming={true} mode="chars" />
    </StreamContext.Provider>
  )
})

export function TitleBar({
  onClose,
  onMinimize,
  onMaximize,
  title,
  isStreaming
}: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const isMac = navigator.userAgent.toLowerCase().includes('mac')

  useEffect(() => {
    // Check initial state on mount
    if (window.api && window.api.isMaximized) {
      window.api.isMaximized().then(setIsMaximized).catch(console.error)
    }

    if (window.api && window.api.onMaximizedChange) {
      const removeListener = window.api.onMaximizedChange((maximized) => {
        setIsMaximized(maximized)
      })
      return () => removeListener()
    }
    return
  }, [])

  const handleMinimize = (): void => {
    if (onMinimize) {
      onMinimize()
    } else {
      window.api.minimizeApp()
    }
  }

  const handleMaximize = (): void => {
    if (onMaximize) {
      onMaximize()
    } else {
      window.api.maximizeApp()
    }
  }

  const handleClose = (): void => {
    if (onClose) {
      onClose()
    } else {
      window.api.closeApp()
    }
  }

  return (
    <div className="fixed left-0 top-0 z-[100] flex h-10 w-full select-none items-center justify-between border-b border-[var(--border-subtle)] bg-black px-3 drag-region">
      {isMac ? <div className="pl-[72px] no-drag-region" /> : <div className="no-drag-region" />}

      {title && (
        <div className="absolute left-1/2 top-1/2 flex max-w-[46vw] -translate-x-1/2 -translate-y-1/2 items-center justify-center truncate whitespace-nowrap text-xs font-medium text-text-secondary pointer-events-none select-none">
          {isStreaming ? <StreamTitleWrapper title={title} /> : title}
        </div>
      )}

      {!isMac && (
        <div className="flex items-center no-drag-region">
          <button
            onClick={handleMinimize}
            className="flex h-8 w-10 items-center justify-center rounded-md text-text-muted transition-colors duration-200 hover:bg-[var(--surface-raised)] hover:text-text-primary"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-8 w-10 items-center justify-center rounded-md text-text-muted transition-colors duration-200 hover:bg-[var(--surface-raised)] hover:text-text-primary"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M3 1.5H8.5V7" stroke="currentColor" strokeWidth="1" />
                <rect
                  x="1.5"
                  y="3"
                  width="5.5"
                  height="5.5"
                  stroke="currentColor"
                  strokeWidth="1"
                  fill="none"
                />
              </svg>
            ) : (
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            onClick={handleClose}
            className="flex h-8 w-10 items-center justify-center rounded-md text-text-muted transition-colors duration-200 hover:bg-[#e81123] hover:text-white"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
