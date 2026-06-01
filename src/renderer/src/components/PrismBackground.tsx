import clsx from 'clsx'

interface PrismBackgroundProps {
  isFocused?: boolean
  isProcessing?: boolean
  isFinishing?: boolean
  isYoutubeMode?: boolean
}

export function PrismBackground({
  isYoutubeMode = false
}: PrismBackgroundProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-background-main">
      {/* Mode right panel */}
      <div
        className={clsx(
          'absolute right-0 top-10 h-[calc(100%-2.5rem)] w-[88px] border-l transition-all duration-700',
          isYoutubeMode
            ? 'border-accent-primary/10 bg-accent-primary/[0.02] opacity-100'
            : 'border-transparent bg-transparent opacity-0'
        )}
      />
    </div>
  )
}
