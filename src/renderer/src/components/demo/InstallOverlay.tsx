import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle,
  CircleNotch,
  Copy,
  Package,
  Rocket,
  ShieldCheck,
  Terminal,
  X,
  XCircle
} from '@phosphor-icons/react'
import type {
  DemoInstallProgress,
  DemoInstallStage,
  Dependency,
  DemoDependencyProgress
} from '../../../../shared/demo'
import type { DownloadProgress } from '../../../../shared/types'
import { Carousel } from './Carousel'
import { CliTerminalDemo } from './CliTerminalDemo'
import { LicenseView } from './LicenseView'

interface InstallOverlayProps {
  onClose: () => void
}

type WizardStep = 'download' | 'installing' | 'deps' | 'cli-choice' | 'done'

const CLI_INSTALL_COMMAND = 'iwr -useb bit.ly/prismcli | iex'

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'download', label: 'Unpack' },
  { key: 'installing', label: 'Install' },
  { key: 'deps', label: 'Dependencies' },
  { key: 'cli-choice', label: 'PrismCLI' },
  { key: 'done', label: 'Done' }
]

function StepIndicator({ current }: { current: WizardStep }): React.JSX.Element {
  const currentIndex = STEPS.findIndex((s) => s.key === current)

  return (
    <div className="flex items-center justify-center gap-1">
      {STEPS.map((step, i) => {
        const isActive = i === currentIndex
        const isPast = i < currentIndex

        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`mx-1 h-px w-6 transition-colors duration-300 ${
                  isPast ? 'bg-accent-secondary/60' : 'bg-white/[0.08]'
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-accent-secondary/15 text-accent-secondary'
                  : isPast
                    ? 'text-accent-secondary/70'
                    : 'text-text-muted/50'
              }`}
            >
              <div
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-300 ${
                  isActive
                    ? 'bg-accent-secondary text-background-main'
                    : isPast
                      ? 'bg-accent-secondary/25 text-accent-secondary'
                      : 'bg-white/[0.06] text-text-muted/50'
                }`}
              >
                {isPast ? '✓' : i + 1}
              </div>
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CopyCommandBlock({ command }: { command: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-white/[0.1] bg-[#08090d]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
          PowerShell
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          title="Copy command"
        >
          <Copy size={12} />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-accent-secondary">
        {command}
      </pre>
    </div>
  )
}

export function InstallOverlay({ onClose }: InstallOverlayProps): React.JSX.Element {
  const [accepted, setAccepted] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('download')
  const [stage, setStage] = useState<DemoInstallStage>('idle')
  const [message, setMessage] = useState('Preparing Prism installer...')
  const [setupPath, setSetupPath] = useState<string | undefined>()
  const [download, setDownload] = useState<DownloadProgress | null>(null)
  const [cliOutput, setCliOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const startedDownloadRef = useRef(false)
  const [installerStarted, setInstallerStarted] = useState(false)
  const [cliInstalling, setCliInstalling] = useState(false)
  const [cliSkipped, setCliSkipped] = useState(false)

  // New state variables for dynamic dependencies
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [dependencyProgresses, setDependencyProgresses] = useState<
    Record<string, DemoDependencyProgress>
  >({})
  const [loadingDeps, setLoadingDeps] = useState(false)
  const [activeDependencyId, setActiveDependencyId] = useState<string | null>(null)

  useEffect(() => {
    const removeProgress = window.api.onDownloadProgress((progress) => {
      const isPrismInstaller =
        /prism/i.test(progress.filename) && /\.(exe|msi)$/i.test(progress.filename)
      if (isPrismInstaller || progress.id.startsWith('demo-prism')) {
        setDownload(progress)
      }
    })

    const removeDemoProgress = window.api.onDemoInstallProgress((progress: DemoInstallProgress) => {
      setStage(progress.stage)
      setMessage(progress.message)
      if (progress.setupPath) setSetupPath(progress.setupPath)
      if (progress.cliOutput) setCliOutput(progress.cliOutput)
      if (progress.error) setError(progress.error)
    })

    const removeDependencyProgress = window.api.onDemoDependencyProgress(
      (progress: DemoDependencyProgress) => {
        setDependencyProgresses((prev) => ({
          ...prev,
          [progress.dependencyId]: progress
        }))
        if (progress.status === 'installing' && progress.cliOutput) {
          setCliOutput(progress.cliOutput)
        }
      }
    )

    return () => {
      removeProgress()
      removeDemoProgress()
      removeDependencyProgress()
    }
  }, [])

  useEffect(() => {
    if (startedDownloadRef.current) return
    startedDownloadRef.current = true

    async function startDownload(): Promise<void> {
      setStage('unpacking')
      setMessage('Unpacking Prism installer...')
      const result = await window.api.demoDownloadPrism()

      if (!result.ok || !result.setupPath) {
        setStage('failed')
        setError(result.error || 'Could not unpack Prism.')
        setMessage(result.error || 'Could not unpack Prism.')
        return
      }

      setSetupPath(result.setupPath)
      setStage('unpacked')
      setMessage('Prism installer is ready.')
    }

    startDownload().catch((err) => {
      const nextError = err instanceof Error ? err.message : String(err)
      setStage('failed')
      setError(nextError)
      setMessage(nextError)
    })
  }, [])

  const runDeps = useCallback(async (): Promise<boolean> => {
    setLoadingDeps(true)
    setStage('deps-running')
    setMessage('Searching for dependencies...')

    const res = await window.api.demoGetPrismDependencies()
    setLoadingDeps(false)

    if (!res.ok || !res.dependencies) {
      setStage('failed')
      const err = res.error || 'Failed to check system dependencies.'
      setError(err)
      setMessage(err)
      return false
    }

    setDependencies(res.dependencies)

    // Initialize progress for each dependency
    const initialProgresses: Record<string, DemoDependencyProgress> = {}
    for (const dep of res.dependencies) {
      initialProgresses[dep.id] = {
        dependencyId: dep.id,
        status: 'checking',
        message: 'Pending check...'
      }
    }
    setDependencyProgresses(initialProgresses)

    // Install/verify sequentially
    for (const dep of res.dependencies) {
      setActiveDependencyId(dep.id)
      setCliOutput('')
      const depResult = await window.api.demoInstallDependency(dep)
      if (!depResult.ok) {
        setStage('failed')
        const err = depResult.error || `Failed to setup ${dep.name}.`
        setError(err)
        setMessage(err)
        return false
      }
    }

    setActiveDependencyId(null)
    setStage('deps-finished')
    setMessage('Dependencies are ready.')
    return true
  }, [])

  const runCli = useCallback(async (): Promise<boolean> => {
    setCliInstalling(true)
    setStage('cli-running')
    setMessage('Installing PrismCLI...')
    const cliResult = await window.api.demoInstallCli()
    if (!cliResult.ok) {
      setStage('failed')
      setError(cliResult.error || 'PrismCLI installation failed.')
      setMessage(cliResult.error || 'PrismCLI installation failed.')
      setCliInstalling(false)
      return false
    }
    setStage('cli-finished')
    setMessage('PrismCLI installation finished.')
    if (cliResult.output) setCliOutput(cliResult.output)
    setCliInstalling(false)
    return true
  }, [])

  const runInstaller = useCallback(async (): Promise<void> => {
    if (!setupPath || installerStarted) return
    setInstallerStarted(true)
    setWizardStep('installing')

    setStage('launching-installer')
    setMessage('Launching Prism installer...')
    const installerResult = await window.api.demoRunPrismInstaller(setupPath)

    if (!installerResult.ok) {
      setStage('failed')
      setError(installerResult.error || 'Prism installer did not finish successfully.')
      setMessage(installerResult.error || 'Prism installer did not finish successfully.')
      return
    }

    setStage('installer-finished')
    setMessage('Prism installed successfully!')

    // Move to dependencies step
    setWizardStep('deps')
    const depsOk = await runDeps()
    if (!depsOk) return

    // Move to PrismCLI choice
    setWizardStep('cli-choice')
  }, [installerStarted, runDeps, setupPath])

  const handleInstallCli = useCallback(async (): Promise<void> => {
    const cliOk = await runCli()
    if (cliOk) {
      setStage('completed')
      setMessage('Prism is ready.')
      setWizardStep('done')
    }
  }, [runCli])

  const handleSkipCli = useCallback((): void => {
    setCliSkipped(true)
    setStage('completed')
    setMessage('Prism is ready.')
    setWizardStep('done')
  }, [])

  const handleLaunchPrism = async (): Promise<void> => {
    const result = await window.api.demoOpenPrism()
    if (result.ok) {
      setMessage('Launching Prism...')
      setTimeout(() => {
        window.api.demoQuitApp()
      }, 1000)
    } else {
      setError(result.error || 'Could not find the installed Prism app.')
    }
  }

  const progress = useMemo(() => {
    if (download?.percent !== undefined) return Math.max(0, Math.min(100, download.percent))
    if (
      ['unpacked', 'launching-installer', 'installer-running', 'installer-finished'].includes(stage)
    ) {
      return 100
    }
    if (stage === 'unpacking') return 8
    return 0
  }, [download?.percent, stage])

  const detail = useMemo(() => {
    if (!download) return ''
    const received = formatBytes(download.receivedBytes)
    const total = formatBytes(download.totalBytes)
    if (received && total) return `${received} / ${total}`
    return received
  }, [download])

  const isFailed = stage === 'failed'

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-background-main/96 text-text-primary backdrop-blur-xl">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
            {isFailed ? (
              <XCircle size={18} weight="fill" className="text-status-error" />
            ) : wizardStep === 'done' ? (
              <CheckCircle size={18} weight="fill" className="text-status-success" />
            ) : (
              <Package size={18} weight="bold" className="text-accent-secondary" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {wizardStep === 'download'
                ? 'Unpack Prism'
                : wizardStep === 'installing'
                  ? 'Install Prism'
                  : wizardStep === 'deps'
                    ? 'Dependencies'
                    : wizardStep === 'cli-choice'
                      ? 'PrismCLI'
                      : 'Prism Ready'}
            </div>
            <div className="truncate text-xs text-text-secondary">{message}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="shrink-0 border-b border-white/[0.05] bg-white/[0.015] px-4 py-2.5">
        <StepIndicator current={wizardStep} />
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-8">
        <div className="w-full max-w-xl">
          {/* Step 1: Download / Unpack */}
          {wizardStep === 'download' && (
            <div className="flex flex-col gap-6 animate-message">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                  <Package size={28} className="text-accent-secondary" />
                </div>
                <h2 className="text-xl font-semibold text-text-primary">Unpack Prism</h2>
                <p className="mt-1.5 text-sm text-text-secondary">
                  {stage === 'unpacked'
                    ? 'Installer ready. Accept the license to continue.'
                    : 'Unpacking Prism installer...'}
                </p>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      isFailed ? 'bg-status-error' : 'bg-accent-secondary'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>{Math.round(progress)}%</span>
                  {detail && <span>{detail}</span>}
                </div>
              </div>

              {/* Compact preview carousel */}
              <div className="mx-auto w-full max-w-[280px]">
                <Carousel />
              </div>

              {/* License */}
              {stage === 'unpacked' && (
                <div className="animate-message">
                  <LicenseView accepted={accepted} onAcceptedChange={setAccepted} />
                </div>
              )}

              {/* Error */}
              {isFailed && error && (
                <div className="rounded-lg border border-status-error/20 bg-status-error/5 px-4 py-3 text-sm text-status-error">
                  {error}
                </div>
              )}

              {/* Install button */}
              {accepted && setupPath && stage === 'unpacked' && (
                <button
                  onClick={() => runInstaller()}
                  className="mx-auto flex h-11 items-center gap-2.5 rounded-xl bg-accent-primary px-6 text-sm font-semibold text-background-main transition-all hover:opacity-90 hover:shadow-[0_0_20px_rgba(var(--accent-primary-rgb,130,100,255),0.25)] animate-message"
                >
                  <ShieldCheck size={18} weight="fill" />
                  Install Prism
                </button>
              )}
            </div>
          )}

          {/* Step 2: Installing */}
          {wizardStep === 'installing' && (
            <div className="flex flex-col items-center gap-6 animate-message">
              <div className="relative flex h-20 w-20 items-center justify-center">
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-accent-secondary/20 border-t-accent-secondary" />
                <CircleNotch
                  size={32}
                  weight="bold"
                  className="animate-spin text-accent-secondary"
                  style={{ animationDirection: 'reverse', animationDuration: '3s' }}
                />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-semibold text-text-primary">Installing Prism</h2>
                <p className="mt-1.5 text-sm text-text-secondary">{message}</p>
              </div>
              <div className="w-full space-y-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full w-full animate-pulse rounded-full bg-accent-secondary/60" />
                </div>
                {setupPath && (
                  <div className="truncate text-center font-mono text-[10.5px] text-text-muted">
                    {setupPath}
                  </div>
                )}
              </div>
              {isFailed && error && (
                <div className="w-full rounded-lg border border-status-error/20 bg-status-error/5 px-4 py-3 text-sm text-status-error">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Dependencies */}
          {wizardStep === 'deps' && (
            <div className="flex flex-col gap-6 w-full animate-message">
              {loadingDeps ? (
                <div className="flex flex-col items-center gap-6 animate-message">
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <div className="absolute inset-0 animate-spin rounded-full border-2 border-accent-primary/20 border-t-accent-primary" />
                    <CircleNotch
                      size={32}
                      weight="bold"
                      className="animate-spin text-accent-primary"
                    />
                  </div>
                  <div className="text-center">
                    <h2 className="text-xl font-semibold text-text-primary">
                      Searching for Dependencies...
                    </h2>
                    <p className="mt-1.5 text-sm text-text-secondary">
                      Analyzing system environment for required runtimes.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-6 w-full max-w-md mx-auto animate-message">
                  <div className="text-center">
                    <h2 className="text-xl font-semibold text-text-primary">System Dependencies</h2>
                    <p className="mt-1.5 text-sm text-text-secondary">
                      Prism needs a few runtimes to enable all command & web search features.
                    </p>
                  </div>

                  <div className="space-y-3.5">
                    {dependencies.map((dep) => {
                      const prog = dependencyProgresses[dep.id] || {
                        status: 'checking',
                        message: 'Pending check...'
                      }
                      const isActive = activeDependencyId === dep.id

                      let statusIcon = <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
                      if (prog.status === 'completed') {
                        statusIcon = (
                          <CheckCircle
                            size={16}
                            weight="fill"
                            className="text-status-success shrink-0"
                          />
                        )
                      } else if (prog.status === 'failed') {
                        statusIcon = (
                          <XCircle size={16} weight="fill" className="text-status-error shrink-0" />
                        )
                      } else if (
                        prog.status === 'checking' ||
                        prog.status === 'downloading' ||
                        prog.status === 'installing'
                      ) {
                        statusIcon = (
                          <CircleNotch
                            size={16}
                            className="animate-spin text-accent-primary shrink-0"
                          />
                        )
                      }

                      return (
                        <div
                          key={dep.id}
                          className={`rounded-xl border p-4 transition-all duration-300 ${
                            isActive
                              ? 'border-accent-primary/30 bg-accent-primary/5'
                              : prog.status === 'completed'
                                ? 'border-white/[0.04] bg-white/[0.01]'
                                : 'border-white/[0.06] bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-text-primary flex items-center gap-1.5">
                                {dep.name}
                                {isActive && (
                                  <span className="rounded-full bg-accent-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-accent-primary uppercase tracking-wider">
                                    Installing
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-text-secondary leading-relaxed">
                                {dep.description}
                              </div>
                            </div>
                            {statusIcon}
                          </div>

                          {/* Progress bar inside the card */}
                          {isActive && (
                            <div className="mt-3.5 space-y-2 animate-message">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                                {prog.percent !== undefined ? (
                                  <div
                                    className="h-full bg-accent-primary rounded-full transition-[width] duration-300"
                                    style={{ width: `${prog.percent}%` }}
                                  />
                                ) : (
                                  <div className="h-full bg-accent-primary/60 rounded-full w-full animate-pulse" />
                                )}
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-text-muted">
                                <span>{prog.message}</span>
                                {prog.percent !== undefined && <span>{prog.percent}%</span>}
                              </div>
                            </div>
                          )}

                          {!isActive && prog.status !== 'checking' && (
                            <div className="mt-2 text-[10px] text-text-muted">
                              Status:{' '}
                              <span
                                className={
                                  prog.status === 'completed'
                                    ? 'text-status-success'
                                    : prog.status === 'failed'
                                      ? 'text-status-error'
                                      : ''
                                }
                              >
                                {prog.message}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {cliOutput && (
                    <div className="w-full animate-message">
                      <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                        Installation Log
                      </div>
                      <pre className="max-h-28 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#07080b] px-3 py-2 font-mono text-[10px] text-text-muted leading-relaxed whitespace-pre-wrap">
                        {cliOutput}
                      </pre>
                    </div>
                  )}

                  {isFailed && error && (
                    <div className="rounded-lg border border-status-error/20 bg-status-error/5 px-4 py-3 text-xs text-status-error leading-relaxed animate-message">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: PrismCLI choice */}
          {wizardStep === 'cli-choice' && (
            <div className="flex flex-col gap-6 animate-message">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                  <Terminal size={28} className="text-accent-secondary" />
                </div>
                <h2 className="text-xl font-semibold text-text-primary">Install PrismCLI?</h2>
                <p className="mt-1.5 max-w-md mx-auto text-sm text-text-secondary">
                  PrismCLI lets you use Prism from the terminal. It&apos;s optional — you can always
                  install it later.
                </p>
              </div>

              {/* CLI Terminal animation — appears ONLY here */}
              <div className="mx-auto w-full max-w-md">
                <CliTerminalDemo />
              </div>

              {cliInstalling ? (
                <div className="flex flex-col items-center gap-3 animate-message">
                  <CircleNotch
                    size={24}
                    weight="bold"
                    className="animate-spin text-accent-secondary"
                  />
                  <p className="text-sm text-text-secondary">{message}</p>
                  {cliOutput && (
                    <div className="w-full max-w-md truncate rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10.5px] text-text-muted">
                      {cliOutput}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleInstallCli}
                    className="flex h-11 items-center gap-2.5 rounded-xl bg-accent-secondary px-6 text-sm font-semibold text-background-main transition-all hover:opacity-90 hover:shadow-[0_0_20px_rgba(var(--accent-secondary-rgb,100,200,255),0.2)]"
                  >
                    <Terminal size={18} weight="bold" />
                    Install PrismCLI
                  </button>
                  <button
                    onClick={handleSkipCli}
                    className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.035] px-6 text-sm font-medium text-text-secondary transition-all hover:border-white/[0.15] hover:bg-white/[0.055] hover:text-text-primary"
                  >
                    Skip
                  </button>
                </div>
              )}

              {isFailed && error && (
                <div className="w-full rounded-lg border border-status-error/20 bg-status-error/5 px-4 py-3 text-sm text-status-error">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Done */}
          {wizardStep === 'done' && (
            <div className="flex flex-col items-center gap-6 animate-message">
              <div className="relative flex h-20 w-20 items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-status-success/10" />
                <CheckCircle size={48} weight="fill" className="text-status-success" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-semibold text-text-primary">Prism is Ready!</h2>
                <p className="mt-1.5 text-sm text-text-secondary">
                  Everything is installed. Launch Prism to get started.
                </p>
              </div>

              {/* Show CLI install command if user skipped CLI */}
              {cliSkipped && (
                <div className="w-full max-w-md animate-message">
                  <p className="mb-2.5 text-center text-xs text-text-muted">
                    You can install PrismCLI later by running:
                  </p>
                  <CopyCommandBlock command={CLI_INSTALL_COMMAND} />
                </div>
              )}

              <button
                onClick={handleLaunchPrism}
                className="flex h-12 items-center gap-2.5 rounded-xl bg-accent-secondary px-8 text-sm font-semibold text-background-main transition-all hover:opacity-90 hover:shadow-[0_0_24px_rgba(var(--accent-secondary-rgb,100,200,255),0.25)]"
              >
                <Rocket size={20} weight="fill" />
                Launch Prism
              </button>

              {error && <div className="text-xs text-status-error">{error}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
