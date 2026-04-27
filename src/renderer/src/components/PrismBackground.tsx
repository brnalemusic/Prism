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
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#0A0A0F]">
      {/* Abstract Prism Geometric Shapes */}
      <div
        className={clsx(
          'absolute top-[-10%] right-[-5%] w-[80vw] h-[80vw] rounded-full transition-all duration-[3000ms] ease-in-out',
          isYoutubeMode 
            ? 'bg-gradient-to-br from-red-600/20 to-red-900/10 blur-[120px]'
            : 'bg-gradient-to-br from-accent-primary/20 to-accent-secondary/10 blur-[120px]',
          isFocused ? 'opacity-100 scale-100' : 'opacity-40 scale-90',
          isFocused && 'animate-drift',
          isActive && !isYoutubeMode && 'animate-slow-pulse scale-110 from-accent-primary/30 to-accent-secondary/20',
          isActive && isYoutubeMode && 'animate-slow-pulse scale-110 from-red-500/30 to-red-600/20'
        )}
      />
      <div
        className={clsx(
          'absolute bottom-[-10%] left-[-10%] w-[70vw] h-[70vw] rounded-full transition-all duration-[3000ms] ease-in-out delay-500',
          isYoutubeMode
            ? 'bg-gradient-to-tr from-red-700/15 to-red-900/5 blur-[100px]'
            : 'bg-gradient-to-tr from-accent-secondary/15 to-accent-primary/5 blur-[100px]',
          isFocused ? 'opacity-100 scale-100 translate-x-0' : 'opacity-30 scale-95 -translate-x-10',
          isFocused && 'animate-drift [animation-direction:reverse] [animation-duration:15s]',
          isActive && !isYoutubeMode &&
            'animate-slow-pulse delay-1000 scale-105 from-accent-secondary/25 to-accent-primary/15',
          isActive && isYoutubeMode &&
            'animate-slow-pulse delay-1000 scale-105 from-red-600/25 to-red-500/15'
        )}
      />

      {/* Angular Prism Accents - Refraction lines */}
      <div
        className={clsx(
          'absolute top-1/4 left-1/4 w-px h-[40vh] bg-accent-primary/10 rotate-[30deg] blur-sm transition-all duration-[2000ms]',
          isYoutubeMode && 'bg-red-500/20',
          isFocused ? 'opacity-100 translate-y-0' : 'opacity-20 translate-y-10',
          isProcessing && 'animate-pulse h-[50vh] opacity-30'
        )}
      />
      <div
        className={clsx(
          'absolute bottom-1/3 right-1/4 w-px h-[30vh] bg-accent-secondary/10 rotate-[-45deg] blur-sm transition-all duration-[2000ms] delay-300',
          isYoutubeMode && 'bg-red-600/20',
          isFocused ? 'opacity-100 translate-x-0' : 'opacity-20 translate-x-10',
          isProcessing && 'animate-pulse delay-300 h-[40vh] opacity-30'
        )}
      />

      {/* Subtle Scanline Overlay - Only when focused */}
      <div
        className={clsx(
          'absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.02),rgba(0,255,0,0.01),rgba(0,0,255,0.02))] z-10 bg-[length:100%_2px,3px_100%] pointer-events-none transition-opacity duration-1000',
          isFocused ? 'opacity-20' : 'opacity-0'
        )}
      />

      {/* AI Working Glow Center */}
      <div
        className={clsx(
          'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[40vh] blur-[120px] rounded-full transition-all duration-[1500ms] ease-in-out',
          isYoutubeMode ? 'bg-red-500/10' : 'bg-accent-primary/10',
          isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
        )}
      />
    </div>
  )
}
