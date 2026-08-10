interface StartupShellProps {
  isDemo: boolean
}

export function StartupShell({ isDemo }: StartupShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-background-main font-sans text-text-primary">
      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/10 border-t-accent-secondary" />
        <div className="text-sm font-medium tracking-wide text-text-secondary">
          {isDemo ? 'Loading Prism Demo...' : 'Loading Prism...'}
        </div>
      </div>
    </div>
  )
}
