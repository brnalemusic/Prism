import { Minus, X } from '@phosphor-icons/react'

interface TitleBarProps {
  onClose?: () => void
  onMinimize?: () => void
}

export function TitleBar({ onClose, onMinimize }: TitleBarProps): React.JSX.Element {
  const handleMinimize = (): void => {
    if (onMinimize) {
      onMinimize()
    } else {
      window.api.minimizeApp()
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
