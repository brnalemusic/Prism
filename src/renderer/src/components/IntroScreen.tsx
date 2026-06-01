import { useEffect, useState, useCallback } from 'react'
import clsx from 'clsx'

export function IntroScreen({
  onComplete,
  username
}: {
  onComplete: () => void
  username?: string
}): React.JSX.Element {
  const [stage, setStage] = useState<'initial' | 'active' | 'exit'>('initial')
  const displayUsername = username || 'user'

  const handleSkip = useCallback(() => {
    if (stage === 'active') {
      setStage('exit')
      setTimeout(() => onComplete(), 600)
    }
  }, [stage, onComplete])

  useEffect(() => {
    const timer1 = setTimeout(() => setStage('active'), 80)
    const timer2 = setTimeout(() => setStage('exit'), 2000)
    const timer3 = setTimeout(() => onComplete(), 2600)

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
        'fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-background-main transition-opacity duration-700 ease-out cursor-pointer',
        stage === 'exit' ? 'opacity-0' : 'opacity-100'
      )}
    >
      <div
        className={clsx(
          'relative flex flex-col items-center justify-center transition-all duration-700',
          stage === 'active' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        )}
      >
        <h1 className="text-3xl font-light text-text-primary tracking-wide">
          Let&apos;s Work,{' '}
          <span className="font-medium text-accent-primary">{displayUsername}</span>.
        </h1>
      </div>
    </div>
  )
}
