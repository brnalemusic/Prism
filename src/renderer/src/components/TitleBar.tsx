import { Minus, X } from '@phosphor-icons/react'
import { useState, useEffect } from 'react'

interface TitleBarProps {
  onClose?: () => void
  onMinimize?: () => void
  onMaximize?: () => void
}

export function TitleBar({ onClose, onMinimize, onMaximize }: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

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
    <div className="fixed left-0 top-0 z-[100] flex h-10 w-full select-none items-center justify-between border-b border-white/[0.04] bg-[#09090b]/90 px-4 backdrop-blur-2xl drag-region">
      <div className="flex items-center gap-2.5 no-drag-region">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-primary/20 to-accent-secondary/10">
          <span className="text-[11px] font-bold prism-top-gradient">P</span>
        </div>
        <span className="text-[12px] font-medium text-text-muted">Prism</span>
      </div>

      <div className="flex items-center no-drag-region">
        <button
          onClick={handleMinimize}
          className="flex h-8 w-10 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary active:scale-95"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-8 w-10 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary active:scale-95"
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
    </div>
  )
}
