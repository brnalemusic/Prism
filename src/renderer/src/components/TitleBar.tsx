import { Minus, X } from 'lucide-react'

export function TitleBar(): React.JSX.Element {
  const handleMinimize = (): void => {
    window.api.minimizeApp()
  }

  const handleClose = (): void => {
    window.api.closeApp()
  }

  return (
    <div className="h-10 w-full flex items-center justify-between px-4 bg-background-main/50 backdrop-blur-md border-b border-white/5 select-none drag-region fixed top-0 left-0 z-[100]">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-accent-primary opacity-50" />
        <span className="text-[10px] font-bold tracking-widest text-text-secondary/60 uppercase">
          Prism System
        </span>
      </div>

      <div className="flex items-center no-drag-region">
        <button
          onClick={handleMinimize}
          className="p-2 hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleClose}
          className="p-2 hover:bg-status-error/20 text-text-secondary hover:text-status-error transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <style>{`
        .drag-region {
          -webkit-app-region: drag;
        }
        .no-drag-region {
          -webkit-app-region: no-drag;
        }
      `}</style>
    </div>
  )
}
