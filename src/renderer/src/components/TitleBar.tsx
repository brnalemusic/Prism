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
    <div className="fixed left-0 top-0 z-[100] flex h-10 w-full select-none items-center justify-between border-b border-white/[0.07] bg-black/25 backdrop-blur-2xl px-3 drag-region shadow-[inset_0_-1px_0_rgba(255,255,255,0.03)]">
      {isMac ? <div className="pl-[72px] no-drag-region" /> : <div className="no-drag-region" />}

      {title && (
        <div className="absolute left-1/2 top-1/2 flex max-w-[46vw] -translate-x-1/2 -translate-y-1/2 items-center justify-center truncate whitespace-nowrap text-xs font-medium text-text-secondary/90 tracking-wide pointer-events-none select-none">
          {isStreaming ? <StreamTitleWrapper title={title} /> : title}
        </div>
      )}

      {!isMac && (
        <div className="flex items-center gap-1 no-drag-region">
          <button
            onClick={handleMinimize}
            className="flex h-7 w-8 items-center justify-center rounded-lg text-text-secondary/60 transition-all duration-150 hover:bg-white/[0.06] hover:text-text-primary active:scale-95"
            title="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-7 w-8 items-center justify-center rounded-lg text-text-secondary/60 transition-all duration-150 hover:bg-white/[0.06] hover:text-text-primary active:scale-95"
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
            className="flex h-7 w-8 items-center justify-center rounded-lg text-text-secondary/60 transition-all duration-150 hover:bg-status-error/80 hover:text-white active:scale-95"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
