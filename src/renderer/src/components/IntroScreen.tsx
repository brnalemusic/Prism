import { useEffect, useState, useCallback } from 'react'
import clsx from 'clsx'

export function IntroScreen({ onComplete }: { onComplete: () => void }): React.JSX.Element {
  const [stage, setStage] = useState<'initial' | 'active' | 'exit'>('initial')

  const barColors = [
    'rgba(143,180,255,0.15), rgba(143,180,255,0.5), rgba(143,180,255,0.85)',
    'rgba(255,255,255,0.15), rgba(255,255,255,0.5), rgba(255,255,255,0.9)',
    'rgba(120,224,194,0.15), rgba(120,224,194,0.5), rgba(120,224,194,0.85)',
    'rgba(228,187,106,0.15), rgba(228,187,106,0.5), rgba(228,187,106,0.8)',
    'rgba(239,127,120,0.15), rgba(239,127,120,0.5), rgba(239,127,120,0.8)'
  ]
  const barHeights = [0.72, 1, 0.82, 0.58, 0.9]

  const handleSkip = useCallback(() => {
    if (stage === 'active') {
      setStage('exit')
      setTimeout(() => onComplete(), 600)
    }
  }, [stage, onComplete])

  useEffect(() => {
    const timer1 = setTimeout(() => setStage('active'), 80)
    const timer2 = setTimeout(() => setStage('exit'), 2350)
    const timer3 = setTimeout(() => onComplete(), 2950)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [onComplete])

  return (
    <div
      onClick={handleSkip}
      className={clsx(
        'fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#0b0c0f] transition-opacity duration-700 ease-out gpu-composed cursor-pointer',
        stage === 'exit' ? 'opacity-0' : 'opacity-100'
      )}
    >
      <div className="absolute inset-0 hairline-grid opacity-35" />
      <div className="absolute inset-x-10 top-8 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <div className="absolute inset-x-10 bottom-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div
        className={clsx(
          'relative flex w-[min(520px,80vw)] flex-col items-center rounded-[28px] px-12 py-12 premium-panel gpu-composed',
          stage === 'active' && 'animate-[intro-shell_900ms_cubic-bezier(0.2,0.82,0.2,1)_both]',
          stage === 'initial' && 'opacity-0 scale-[0.985]'
        )}
      >
        {/* Radial glow behind bars */}
        <div
          className={clsx(
            'absolute inset-0 pointer-events-none transition-opacity duration-1000',
            stage === 'active' ? 'opacity-100' : 'opacity-0'
          )}
        >
          <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 h-48 w-48 rounded-full bg-accent-primary/[0.08] blur-[60px]" />
        </div>

        <div className="absolute inset-x-10 top-0 h-px overflow-hidden">
          <div
            className={clsx(
              'h-px w-full bg-gradient-to-r from-transparent via-accent-primary to-transparent',
              stage === 'active' &&
                'animate-[line-sweep_1800ms_cubic-bezier(0.2,0.82,0.2,1)_220ms_both]'
            )}
          />
        </div>

        <div className="mb-8 flex h-20 items-end gap-2">
          {barHeights.map((scale, index) => (
            <span
              key={index}
              className={clsx(
                'block w-3 origin-bottom rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] gpu-composed',
                stage === 'active' && 'animate-[intro-bar_820ms_cubic-bezier(0.2,0.82,0.2,1)_both]',
                stage === 'initial' && 'opacity-0'
              )}
              style={{
                height: `${54 * scale}px`,
                animationDelay: `${160 + index * 95}ms`,
                background: `linear-gradient(to top, ${barColors[index]})`
              }}
            />
          ))}
        </div>

        <div className="relative overflow-hidden px-2 pb-1">
          <h1
            className={clsx(
              'text-[54px] font-semibold leading-none text-text-primary gpu-composed',
              stage === 'active' &&
                'animate-[intro-word_760ms_cubic-bezier(0.2,0.82,0.2,1)_620ms_both]',
              stage === 'initial' && 'opacity-0'
            )}
          >
            Prism
          </h1>
        </div>

        <div
          className={clsx(
            'mt-5 h-[3px] w-28 rounded-full bg-gradient-to-r from-accent-primary via-status-warning/60 to-accent-secondary transition-all duration-700 ease-out gpu-composed',
            stage === 'active' ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
          )}
        />

        <p
          className={clsx(
            'mt-5 text-xs font-medium text-text-secondary transition-all duration-700 ease-out gpu-composed',
            stage === 'active' ? 'opacity-80 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          Ready for precise work.
        </p>
      </div>
    </div>
  )
}
