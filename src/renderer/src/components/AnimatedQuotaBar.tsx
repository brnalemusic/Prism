import React, { useState, useEffect, useRef } from 'react'

interface AnimatedQuotaBarProps {
  label: string
  resetSeconds?: number
  targetPercentage?: number
  isUnavailable?: boolean
  barGradient: string
  formatResetTime: (seconds?: number) => string
}

export const AnimatedQuotaBar: React.FC<AnimatedQuotaBarProps> = ({
  label,
  resetSeconds,
  targetPercentage,
  isUnavailable = false,
  barGradient,
  formatResetTime
}) => {
  const [displayPercent, setDisplayPercent] = useState<number | null>(
    targetPercentage !== undefined ? targetPercentage : null
  )
  const prevTargetRef = useRef<number | null>(
    targetPercentage !== undefined ? targetPercentage : null
  )
  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (targetPercentage === undefined) {
      setDisplayPercent(null)
      return
    }

    const startValue =
      prevTargetRef.current !== null && prevTargetRef.current !== undefined
        ? prevTargetRef.current
        : 0

    const endValue = targetPercentage
    prevTargetRef.current = targetPercentage

    if (startValue === endValue && displayPercent === endValue) {
      setDisplayPercent(endValue)
      return
    }

    const startTime = performance.now()
    const duration = 850 // ms

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3)
      const current = Math.round(startValue + (endValue - startValue) * ease)

      setDisplayPercent(current)

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate)
      } else {
        setDisplayPercent(endValue)
      }
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [targetPercentage])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary font-medium">{label}</span>
          {resetSeconds !== undefined && resetSeconds > 0 && (
            <span className="text-[10px] font-mono text-text-muted/70 select-none">
              • {formatResetTime(resetSeconds)}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] font-bold text-white transition-all">
          {displayPercent !== null
            ? `${displayPercent}% Remaining`
            : isUnavailable
              ? 'Unavailable'
              : 'Loading…'}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden relative">
        {displayPercent !== null ? (
          <div
            className={`h-full bg-gradient-to-r ${barGradient} rounded-full transition-all duration-700 ease-out`}
            style={{ width: `${displayPercent}%` }}
          />
        ) : (
          <div className="h-full w-full bg-white/5 animate-pulse rounded-full" />
        )}
      </div>
    </div>
  )
}
