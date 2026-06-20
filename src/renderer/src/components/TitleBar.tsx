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
    <div className="fixed left-0 top-0 z-[100] flex h-10 w-full select-none items-center justify-between border-b border-white/[0.055] bg-background-main/80 px-4 shadow-[0_1px_0_rgba(255,255,255,0.018)] backdrop-blur-md drag-region">
      <div className={`flex items-center gap-2.5 no-drag-region ${isMac ? 'pl-[72px]' : ''}`}>
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.035]">
          <span className="text-[11px] font-bold prism-top-gradient">P</span>
        </div>
        <span className="text-[12px] font-medium text-text-secondary/75">Prism</span>
      </div>

      {title && (
        <div className="absolute left-1/2 top-1/2 flex max-w-[46vw] -translate-x-1/2 -translate-y-1/2 items-center justify-center truncate whitespace-nowrap text-[12.5px] font-medium text-text-primary/90 pointer-events-none select-none">
          {isStreaming ? <StreamTitleWrapper title={title} /> : title}
        </div>
      )}

      {!isMac && (
        <div className="flex items-center no-drag-region">
          <button
            onClick={handleMinimize}
            className="flex h-8 w-10 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-white/[0.055] hover:text-text-secondary active:scale-95"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-8 w-10 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-white/[0.055] hover:text-text-secondary active:scale-95"
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
            className="flex h-8 w-10 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-[#e81123]/90 hover:text-white active:scale-95"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
