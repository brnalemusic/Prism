import clsx from 'clsx'

interface PrismBackgroundProps {
  isFocused?: boolean
  isProcessing?: boolean
  isFinishing?: boolean
  isYoutubeMode?: boolean
}

export function PrismBackground({
  isFocused = true,
  isProcessing = false,
  isFinishing = false,
  isYoutubeMode = false
}: PrismBackgroundProps): React.JSX.Element {
  const isActive = isProcessing || isFinishing

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-background-main">
      {/* Subtle noise texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")"
        }}
      />

      {/* Subtle grid */}
      <div
        className={clsx(
          'absolute inset-0 hairline-grid transition-opacity duration-1000',
          isFocused ? 'opacity-25' : 'opacity-8'
        )}
      />

      {/* Sidebar divider line */}
      <div className="absolute left-[278px] top-0 hidden h-full w-px bg-white/[0.04] md:block" />
      {/* Top bar line */}
      <div className="absolute inset-x-0 top-10 h-px bg-white/[0.04]" />

      {/* Processing indicator - subtle top accent */}
      <div
        className={clsx(
          'absolute left-[278px] right-0 top-10 h-px overflow-hidden transition-opacity duration-700',
          isActive ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div
          className={clsx(
            'h-px w-full bg-gradient-to-r from-transparent via-accent-primary/60 to-transparent',
            isActive && 'animate-[line-sweep_2200ms_cubic-bezier(0.22,1,0.36,1)_infinite]'
          )}
        />
      </div>

      {/* Mode right panel */}
      <div
        className={clsx(
          'absolute right-0 top-10 h-[calc(100%-2.5rem)] w-[88px] border-l transition-all duration-700',
          isYoutubeMode
            ? 'border-accent-primary/10 bg-accent-primary/[0.02] opacity-100'
            : 'border-transparent bg-transparent opacity-0'
        )}
      />

      {/* Mode overlay */}
      <div
        className={clsx(
          'absolute inset-0 transition-opacity duration-700',
          isYoutubeMode ? 'opacity-100 bg-accent-primary/[0.005]' : 'opacity-0'
        )}
      />
    </div>
  )
}
