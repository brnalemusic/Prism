import clsx from 'clsx'
import youtubeLogo from '../assets/youtube.png'

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
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055)_0%,rgba(255,255,255,0.015)_42%,rgba(0,0,0,0.22)_100%)]" />
      <div
        className={clsx(
          'absolute inset-0 hairline-grid transition-opacity duration-700',
          isFocused ? 'opacity-35' : 'opacity-12'
        )}
      />

      <div className="absolute left-[260px] top-0 hidden h-full w-px bg-white/[0.045] md:block" />
      <div className="absolute inset-x-0 top-10 h-px bg-white/[0.055]" />
      <div className="absolute inset-x-0 bottom-28 h-px bg-white/[0.035]" />

      <div
        className={clsx(
          'absolute left-[18%] right-[10%] top-[18%] h-[42%] rounded-[36px] border border-white/[0.035] bg-white/[0.018] transition-all duration-700',
          isFocused ? 'opacity-100 translate-y-0' : 'opacity-35 translate-y-2',
          isActive && 'border-accent-primary/15 bg-accent-primary/[0.025]'
        )}
      />

      <div
        className={clsx(
          'absolute left-[18%] right-[10%] top-[18%] h-px overflow-hidden transition-opacity duration-500',
          isActive ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div
          className={clsx(
            'h-px w-full bg-gradient-to-r from-transparent via-accent-primary to-transparent',
            isActive && 'animate-[line-sweep_1900ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
          )}
        />
      </div>

      <div
        className={clsx(
          'absolute right-0 top-10 h-[calc(100%-7rem)] w-[96px] border-l transition-all duration-500',
          isYoutubeMode
            ? 'border-red-400/20 bg-red-500/[0.055] opacity-100'
            : 'border-white/[0.035] bg-white/[0.018] opacity-70'
        )}
      />

      <div
        className={clsx(
          'absolute right-8 top-1/2 h-28 w-28 -translate-y-1/2 transition-all duration-500',
          isYoutubeMode ? 'opacity-[0.14] scale-100' : 'opacity-0 scale-95'
        )}
      >
        <img src={youtubeLogo} alt="" className="h-full w-full object-contain" />
      </div>

      <div
        className={clsx(
          'absolute inset-0 transition-opacity duration-500',
          isYoutubeMode ? 'opacity-100 bg-red-500/[0.025]' : 'opacity-0'
        )}
      />
    </div>
  )
}
