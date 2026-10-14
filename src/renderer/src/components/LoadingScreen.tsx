import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import clsx from 'clsx'
import { Check, WarningCircle, ArrowClockwise, Sparkle } from '@phosphor-icons/react'
import { Spinner } from './Spinner'
import { ApiKeyModal } from './ApiKeyModal'
import { PrismMark, PrismMarkTone } from './PrismMark'

/**
 * Boot-time loading screen shown in place of the old cosmetic intro. Runs the
 * real pre-launch sequence: connection probe → API key setup (if missing) →
 * Gemini connection test → on success, hands off to the app and the 2h
 * keep-alive window begins.
 */
type BootState = 'connecting' | 'needs-key' | 'testing' | 'failed' | 'ready'

interface StepStatus {
  id: string
  label: string
  detail: string
  state: 'pending' | 'active' | 'done' | 'error'
}

interface LoadingScreenProps {
  onComplete: (connectionFailed?: boolean) => void
  isKeyMissing: boolean
  apiKey: string
  onApiKeySave: (key: string) => void
  configLoaded: boolean
}

export function LoadingScreen({
  onComplete,
  isKeyMissing,
  apiKey,
  onApiKeySave,
  configLoaded
}: LoadingScreenProps): React.JSX.Element {
  const [visible, setVisible] = useState(true)
  const [bootState, setBootState] = useState<BootState>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [keyMissing, setKeyMissing] = useState(isKeyMissing)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [keyFailed, setKeyFailed] = useState(false)

  // Keep mutable references to prevent recreating callback instances from triggering resets.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const onApiKeySaveRef = useRef(onApiKeySave)
  onApiKeySaveRef.current = onApiKeySave

  const isMounted = useRef(true)
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  // Sync state if parent resolves isKeyMissing after loading config.
  useEffect(() => {
    setKeyMissing(isKeyMissing)
  }, [isKeyMissing])

  const steps = useMemo(() => buildSteps(bootState, keyFailed), [bootState, keyFailed])

  const { litBeams, tone, progressPercent } = useMemo(() => {
    switch (bootState) {
      case 'connecting':
        return { litBeams: 2, tone: 'live' as PrismMarkTone, progressPercent: 25 }
      case 'needs-key':
        return { litBeams: 4, tone: 'live' as PrismMarkTone, progressPercent: 50 }
      case 'testing':
        return { litBeams: 5, tone: 'live' as PrismMarkTone, progressPercent: 75 }
      case 'ready':
        return { litBeams: 7, tone: 'live' as PrismMarkTone, progressPercent: 100 }
      case 'failed':
      default:
        return { litBeams: keyFailed ? 3 : 5, tone: 'error' as PrismMarkTone, progressPercent: 60 }
    }
  }, [bootState, keyFailed])

  // Run (or re-run, after retry) the Gemini connection test.
  const runConnectionTest = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.testGeminiConnection()
      if (!isMounted.current) return
      if (result.ok) {
        setBootState('ready')
        // Allow the fade-out to play before handing off.
        setTimeout(() => {
          if (!isMounted.current) return
          setVisible(false)
          setTimeout(() => {
            if (isMounted.current) {
              onCompleteRef.current()
            }
          }, 600)
        }, 500)
      } else {
        setErrorMsg(result.message || 'Could not reach the Gemini API.')
        setBootState('failed')
      }
    } catch (err) {
      if (!isMounted.current) return
      setErrorMsg(err instanceof Error ? err.message : 'Could not reach the Gemini API.')
      setBootState('failed')
    }
  }, [])

  // Drive the staged boot flow.
  useEffect(() => {
    if (!configLoaded) return

    let active = true

    const run = async (): Promise<void> => {
      await delay(500)
      if (!active) return

      if (keyMissing) {
        setBootState('ready')
        setTimeout(() => {
          if (!isMounted.current) return
          setVisible(false)
          setTimeout(() => {
            if (isMounted.current) {
              onCompleteRef.current()
            }
          }, 400)
        }, 300)
        return
      }

      setBootState('testing')
      await runConnectionTest()
    }

    run()

    return () => {
      active = false
    }
  }, [configLoaded, keyMissing, runConnectionTest])

  const handleRetry = useCallback(async (): Promise<void> => {
    setErrorMsg('')
    setBootState('connecting')
    await delay(400)
    if (!isMounted.current) return
    if (keyMissing) {
      setBootState('needs-key')
      setShowKeyModal(true)
      return
    }
    setBootState('testing')
    await runConnectionTest()
  }, [keyMissing, runConnectionTest])

  // When the user saves a key from the inline modal, persist it, then resume.
  const handleKeySaved = useCallback(
    (key: string): void => {
      onApiKeySaveRef.current(key)
      setKeyMissing(false)
      setShowKeyModal(false)
      setBootState('testing')
      void runConnectionTest()
    },
    [runConnectionTest]
  )

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-background-main transition-opacity duration-600 ease-out select-none',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {/* Background atmospheric lighting and subtle texture */}
      <div className="prism-boot-grain" />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[720px] h-[480px] rounded-full blur-[120px] opacity-25"
        style={{
          background:
            'radial-gradient(circle, var(--accent-glow, rgba(56,189,248,0.3)) 0%, transparent 70%)'
        }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[320px] rounded-full blur-[100px] opacity-15"
        style={{
          background:
            'radial-gradient(circle, var(--home-glow-color-2, rgba(125,211,252,0.25)) 0%, transparent 70%)'
        }}
      />

      {/* Main double-bezel hardware container */}
      <div className="relative z-10 w-full max-w-[420px] px-4">
        <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.025] p-2 backdrop-blur-2xl shadow-[0_28px_64px_-16px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.08)]">
          <div className="rounded-[22px] border border-white/[0.04] bg-[#03060c]/90 px-6 py-7 sm:px-7">
            {/* Header with animated brand mark */}
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-5 flex items-center justify-center">
                <PrismMark
                  size={68}
                  lit={litBeams}
                  tone={tone}
                  sweeping={bootState === 'connecting' || bootState === 'testing'}
                />
              </div>

              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-accent-primary">
                <Sparkle size={11} weight="fill" />
                <span>Workspace Engine</span>
              </div>

              <h1 className="text-xl font-medium tracking-tight text-text-primary">
                Initializing Prism
              </h1>
              <p className="mt-1 text-xs text-text-muted">
                {bootState === 'failed'
                  ? keyFailed
                    ? 'API provider configuration required'
                    : 'Network diagnostic failed'
                  : bootState === 'ready'
                    ? 'Environment verified & ready'
                    : 'Configuring workspace diagnostics'}
              </p>

              {/* Linear Progress Track */}
              <div className="relative mt-5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-primary transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
                {bootState !== 'ready' && bootState !== 'failed' && (
                  <span className="prism-boot-progress-shimmer" />
                )}
              </div>
            </div>

            {/* Diagnostic Steps */}
            <div className="mt-6 flex flex-col gap-2.5">
              {steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>

            {/* Error & Recovery Surface */}
            {bootState === 'failed' && (
              <div className="mt-6 animate-soft-pop rounded-[18px] border border-status-error/30 bg-status-error/[0.07] p-4 shadow-[0_12px_28px_-8px_rgba(248,113,113,0.18)]">
                <div className="mb-3.5 flex items-start gap-2.5">
                  <WarningCircle
                    size={16}
                    weight="fill"
                    className="mt-0.5 shrink-0 text-status-error"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-status-error">Diagnostic Notice</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary/90">
                      {errorMsg}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {keyFailed ? (
                    <>
                      <button
                        type="button"
                        onClick={() => window.api.closeApp()}
                        className="flex flex-1 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-text-secondary transition-interactive hover:bg-white/[0.08] hover:text-text-primary active:scale-[0.98] cursor-pointer"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setKeyFailed(false)
                          setErrorMsg('')
                          setBootState('needs-key')
                          setShowKeyModal(true)
                        }}
                        className="flex flex-1 items-center justify-center rounded-xl bg-text-primary px-3.5 py-2 text-xs font-semibold text-black transition-interactive hover:bg-white active:scale-[0.98] cursor-pointer shadow-[0_4px_16px_rgba(255,255,255,0.15)]"
                      >
                        Configure API
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-text-primary px-3.5 py-2 text-xs font-semibold text-black transition-interactive hover:bg-white active:scale-[0.98] cursor-pointer shadow-[0_4px_16px_rgba(255,255,255,0.15)]"
                      >
                        <ArrowClockwise size={13} weight="bold" />
                        <span>Retry Probe</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVisible(false)
                          setTimeout(() => onComplete(true), 600)
                        }}
                        className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-text-secondary transition-interactive hover:bg-white/[0.08] hover:text-text-primary active:scale-[0.98] cursor-pointer"
                      >
                        Bypass
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Ambient system status footer */}
        <div className="mt-4 flex items-center justify-between px-2 text-[11px] text-text-muted/60 font-mono">
          <span>Prism Desktop</span>
          <span className="flex items-center gap-1.5">
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                bootState === 'ready'
                  ? 'bg-status-success'
                  : bootState === 'failed'
                    ? 'bg-status-error'
                    : 'bg-accent-primary animate-pulse'
              )}
            />
            {bootState === 'ready' ? 'Online' : bootState === 'failed' ? 'Interrupted' : 'Syncing'}
          </span>
        </div>
      </div>

      {showKeyModal && (
        <ApiKeyModal
          isOpen={showKeyModal}
          initialValue={apiKey}
          onClose={() => {
            setShowKeyModal(false)
            if (keyMissing) {
              setKeyFailed(true)
              setErrorMsg(
                'No active API provider configured. Prism requires a valid API key to continue.'
              )
              setBootState('failed')
            }
          }}
          onSave={handleKeySaved}
        />
      )}
    </div>
  )
}

function StepRow({ step }: { step: StepStatus }): React.JSX.Element {
  const isDone = step.state === 'done'
  const isActive = step.state === 'active'
  const isError = step.state === 'error'

  return (
    <div
      className={clsx(
        'group flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        isDone
          ? 'border-status-success/20 bg-status-success/[0.04]'
          : isActive
            ? 'border-accent-primary/30 bg-accent-primary/[0.06] shadow-[0_0_20px_-4px_var(--accent-glow)]'
            : isError
              ? 'border-status-error/30 bg-status-error/[0.06]'
              : 'border-white/[0.04] bg-white/[0.015]'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
          {isDone ? (
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-status-success/20 text-status-success">
              <Check size={11} weight="bold" />
            </div>
          ) : isActive ? (
            <Spinner size="sm" />
          ) : isError ? (
            <WarningCircle size={15} weight="fill" className="text-status-error" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-text-muted/30 group-hover:bg-text-muted/50 transition-colors" />
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span
            className={clsx(
              'text-xs tracking-tight transition-colors truncate',
              isDone
                ? 'font-medium text-status-success/90'
                : isActive
                  ? 'font-medium text-text-primary'
                  : isError
                    ? 'font-medium text-status-error/90'
                    : 'text-text-muted'
            )}
          >
            {step.label}
          </span>
          <span className="text-[10px] text-text-muted/70 truncate">{step.detail}</span>
        </div>
      </div>

      <div className="shrink-0 pl-2">
        <span
          className={clsx(
            'text-[10px] font-mono tracking-wider uppercase',
            isDone
              ? 'text-status-success/75'
              : isActive
                ? 'text-accent-primary'
                : isError
                  ? 'text-status-error'
                  : 'text-text-muted/40'
          )}
        >
          {isDone ? 'Pass' : isActive ? 'Active' : isError ? 'Fail' : 'Standby'}
        </span>
      </div>
    </div>
  )
}

function buildSteps(state: BootState, keyFailed?: boolean): StepStatus[] {
  const base: StepStatus[] = [
    {
      id: 'connection',
      label: 'Network Core',
      detail: 'Establishing desktop runtime channels',
      state: 'pending'
    },
    {
      id: 'keys',
      label: 'Provider Credentials',
      detail: 'Verifying active API keys & configuration',
      state: 'pending'
    },
    {
      id: 'models',
      label: 'Model Diagnostic',
      detail: 'Testing Gemini endpoint reachability',
      state: 'pending'
    },
    {
      id: 'ready',
      label: 'System Ready',
      detail: 'Workspace initialization complete',
      state: 'pending'
    }
  ]

  switch (state) {
    case 'connecting':
      base[0].state = 'active'
      break
    case 'needs-key':
      base[0].state = 'done'
      base[1].state = 'active'
      break
    case 'testing':
      base[0].state = 'done'
      base[1].state = 'done'
      base[2].state = 'active'
      break
    case 'failed':
      base[0].state = 'done'
      if (keyFailed) {
        base[1].state = 'error'
      } else {
        base[1].state = 'done'
        base[2].state = 'error'
      }
      break
    case 'ready':
      base[0].state = 'done'
      base[1].state = 'done'
      base[2].state = 'done'
      base[3].state = 'done'
      break
  }
  return base
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
