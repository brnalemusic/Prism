import { Minus, X } from 'lucide-react'

export function TitleBar(): React.JSX.Element {
  const handleMinimize = (): void => {
    window.api.minimizeApp()
  }

  const handleClose = (): void => {
    window.api.closeApp()
  }

  return (
    <div className="fixed left-0 top-0 z-[100] flex h-10 w-full select-none items-center justify-between border-b border-white/[0.055] bg-background-main/[0.72] px-4 backdrop-blur-2xl drag-region">
      <div className="flex items-center gap-2.5 no-drag-region">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.07]">
          <span className="text-[11px] font-bold prism-top-gradient">P</span>
        </div>
        <span className="text-[12px] font-semibold text-text-secondary/80">Prism</span>
      </div>

      <div className="flex items-center no-drag-region">
        <button
          onClick={handleMinimize}
          className="flex h-8 w-10 items-center justify-center rounded-lg text-text-secondary/70 transition-all duration-150 hover:bg-white/[0.08] hover:text-text-primary active:scale-95"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleClose}
          className="flex h-8 w-10 items-center justify-center rounded-lg text-text-secondary/70 transition-all duration-150 hover:bg-[#e81123] hover:text-white active:scale-95"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
