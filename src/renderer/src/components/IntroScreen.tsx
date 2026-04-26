import { useEffect, useState } from 'react'
import clsx from 'clsx'

export function IntroScreen({ onComplete }: { onComplete: () => void }): React.JSX.Element {
  const [stage, setStage] = useState<'initial' | 'animate' | 'exit'>('initial')

  useEffect(() => {
    const timer1 = setTimeout(() => setStage('animate'), 100)
    const timer2 = setTimeout(() => setStage('exit'), 2800)
    const timer3 = setTimeout(() => onComplete(), 3500)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [onComplete])

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[9999] flex items-center justify-center bg-[#0A0A0F] transition-opacity duration-700 ease-in-out',
        stage === 'exit' ? 'opacity-0' : 'opacity-100'
      )}
    >
      {/* Background Refraction Shapes */}
      <div
        className={clsx(
          'absolute w-[40vw] h-[40vw] rounded-full bg-accent-primary/20 blur-[100px] transition-all duration-[2000ms] ease-out',
          stage === 'animate' ? 'scale-150 opacity-40' : 'scale-50 opacity-0'
        )}
      />
      <div
        className={clsx(
          'absolute w-[30vw] h-[30vw] rounded-full bg-accent-secondary/20 blur-[80px] transition-all duration-[2500ms] ease-out delay-300',
          stage === 'animate'
            ? 'translate-x-20 -translate-y-20 scale-125 opacity-30'
            : 'scale-50 opacity-0'
        )}
      />

      {/* Main Logo/Text Container */}
      <div className="relative flex flex-col items-center">
        <div
          className={clsx(
            'relative transition-all duration-1000 ease-out',
            stage === 'animate' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}
        >
          {/* Logo Prism Shape */}
          <div className="relative w-32 h-32 mb-8 mx-auto">
            <div
              className={clsx(
                'absolute inset-0 border-2 border-accent-primary/40 rotate-45 transition-all duration-[2000ms] ease-out',
                stage === 'animate'
                  ? 'rotate-[225deg] scale-100 opacity-100'
                  : 'rotate-45 scale-50 opacity-0'
              )}
            />
            <div
              className={clsx(
                'absolute inset-0 border-2 border-accent-secondary/40 -rotate-45 transition-all duration-[2000ms] ease-out delay-150',
                stage === 'animate'
                  ? 'rotate-[-225deg] scale-90 opacity-80'
                  : '-rotate-45 scale-50 opacity-0'
              )}
            />
            <div
              className={clsx(
                'absolute inset-4 bg-gradient-to-br from-accent-primary to-accent-secondary blur-2xl opacity-20 transition-all duration-1000 delay-500',
                stage === 'animate' ? 'scale-110 opacity-40' : 'scale-50 opacity-0'
              )}
            />
          </div>

          {/* Text with Refraction Effect */}
          <div className="relative px-12 py-4">
            <h1 className="relative text-7xl font-black tracking-[0.3em] text-white overflow-hidden">
              <span className="relative z-10">PRISM</span>
              {/* Refraction layers */}
              <span
                className={clsx(
                  'absolute inset-0 z-0 text-accent-primary/40 blur-[4px] mix-blend-screen transition-all duration-[2500ms] ease-out',
                  stage === 'animate'
                    ? 'translate-x-2 -translate-y-1 scale-110 opacity-100'
                    : 'translate-x-0 translate-y-0 scale-100 opacity-0'
                )}
              >
                PRISM
              </span>
              <span
                className={clsx(
                  'absolute inset-0 z-0 text-accent-secondary/40 blur-[8px] mix-blend-screen transition-all duration-[3000ms] ease-out',
                  stage === 'animate'
                    ? '-translate-x-2 translate-y-1 scale-125 opacity-100'
                    : 'translate-x-0 translate-y-0 scale-100 opacity-0'
                )}
              >
                PRISM
              </span>

              {/* Shiny scanline effect */}
              <div
                className={clsx(
                  'absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 transition-all duration-[1500ms] ease-in-out',
                  stage === 'animate' ? 'translate-x-[200%]' : '-translate-x-full'
                )}
              />
            </h1>
          </div>

          {/* Subtitle / Line */}
          <div
            className={clsx(
              'mt-2 h-px bg-gradient-to-r from-transparent via-accent-primary/50 to-transparent mx-auto transition-all duration-[2000ms] ease-in-out delay-700',
              stage === 'animate' ? 'w-80 opacity-100' : 'w-0 opacity-0'
            )}
          />
          <p
            className={clsx(
              'mt-4 text-[10px] uppercase tracking-[0.5em] text-text-secondary/40 text-center font-bold transition-all duration-1000 delay-1000',
              stage === 'animate' ? 'opacity-100 tracking-[0.8em]' : 'opacity-0 tracking-[0.5em]'
            )}
          >
            Intelligence Refracted
          </p>
        </div>
      </div>

      {/* Decorative lines */}
      <div
        className={clsx(
          'absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-accent-primary/10 to-transparent transition-all duration-[2000ms] ease-in-out',
          stage === 'animate' ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        className={clsx(
          'absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-accent-secondary/10 to-transparent transition-all duration-[2000ms] ease-in-out delay-300',
          stage === 'animate' ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  )
}
