import { useEffect, useState, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { Check, WarningCircle, ArrowClockwise } from '@phosphor-icons/react'
import { Spinner } from './Spinner'
import { ApiKeyModal } from './ApiKeyModal'

/**
 * Boot-time loading screen shown in place of the old cosmetic intro. Runs the
 * real pre-launch sequence: connection probe → API key setup (if missing) →
 * Gemini connection test → on success, hands off to the app and the 2h
 * keep-alive window begins.
 */
type BootState = 'connecting' | 'needs-key' | 'testing' | 'failed' | 'ready'

interface StepStatus {
  label: string
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

  const steps = buildSteps(bootState)

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
        setBootState('needs-key')
        setShowKeyModal(true)
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
        'fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-background-main transition-opacity duration-600 ease-out',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div className="flex w-full max-w-sm flex-col items-center px-8">
        <h1 className="mb-1 text-2xl font-light text-text-primary tracking-wide">Loading Prism…</h1>
        <p className="mb-7 text-xs text-text-muted">
          {bootState === 'failed' ? 'Connection failed' : 'Preparing your workspace'}
        </p>

        <div className="flex w-full flex-col gap-3">
          {steps.map((step) => (
            <StepRow key={step.label} step={step} />
          ))}
        </div>

        {bootState === 'failed' && (
          <div className="mt-6 w-full animate-soft-pop rounded-[18px] border border-status-error/25 bg-status-error/[0.06] p-4">
            <div className="mb-3 flex items-start gap-2.5">
              <WarningCircle
                size={16}
                weight="fill"
                className="mt-0.5 shrink-0 text-status-error"
              />
              <p className="text-xs leading-relaxed text-status-error/80">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRetry}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-text-primary px-4 py-2.5 text-xs font-semibold text-black transition-all hover:bg-white active:scale-[0.98]"
              >
                <ArrowClockwise size={14} weight="bold" />
                Retry
              </button>
              <button
                onClick={() => {
                  setVisible(false)
                  setTimeout(() => onComplete(true), 600)
                }}
                className="flex-1 rounded-[14px] border border-white/[0.08] px-4 py-2.5 text-xs font-semibold text-text-secondary transition-all hover:bg-white/[0.055] hover:text-text-primary active:scale-[0.98]"
              >
                Open Prism anyway
              </button>
            </div>
          </div>
        )}
      </div>

      {showKeyModal && (
        <ApiKeyModal
          isOpen={showKeyModal}
          initialValue={apiKey}
          onClose={() => setShowKeyModal(false)}
          onSave={handleKeySaved}
        />
      )}
    </div>
  )
}

function StepRow({ step }: { step: StepStatus }): React.JSX.Element {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-[16px] border px-4 py-2.5 transition-all duration-300',
        step.state === 'done'
          ? 'border-status-success/20 bg-status-success/[0.05]'
          : step.state === 'active'
            ? 'border-accent-primary/25 bg-accent-primary/[0.05]'
            : step.state === 'error'
              ? 'border-status-error/25 bg-status-error/[0.05]'
              : 'border-white/[0.04] bg-white/[0.015]'
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center">
        {step.state === 'done' ? (
          <Check size={16} weight="bold" className="text-status-success" />
        ) : step.state === 'active' ? (
          <Spinner size="sm" />
        ) : step.state === 'error' ? (
          <WarningCircle size={16} weight="fill" className="text-status-error" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-text-muted/40" />
        )}
      </div>
      <span
        className={clsx(
          'text-sm transition-colors',
          step.state === 'done'
            ? 'text-status-success/90 font-medium'
            : step.state === 'active'
              ? 'text-text-primary font-medium'
              : step.state === 'error'
                ? 'text-status-error/90 font-medium'
                : 'text-text-muted'
        )}
      >
        {step.label}
      </span>
    </div>
  )
}

function buildSteps(state: BootState): StepStatus[] {
  const base: StepStatus[] = [
    { label: 'Establishing connection', state: 'pending' },
    { label: 'Verifying Gemini API key', state: 'pending' },
    { label: 'Testing connection', state: 'pending' },
    { label: 'Ready', state: 'pending' }
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
      base[1].state = 'done'
      base[2].state = 'error'
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
