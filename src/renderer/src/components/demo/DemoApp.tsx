import { lazy, Suspense, useEffect, useState } from 'react'
import type { DemoScript } from '../../../../shared/demo'
import { PrismBackground } from '../PrismBackground'
import { TitleBar } from '../TitleBar'
import { demoScripts } from '../../demo/scripts'
import { DemoHome } from './DemoHome'

const DemoChatView = lazy(async () => {
  const module = await import('./DemoChatView')
  return { default: module.DemoChatView }
})

const InstallOverlay = lazy(async () => {
  const module = await import('./InstallOverlay')
  return { default: module.InstallOverlay }
})

function DemoModuleFallback(): React.JSX.Element {
  return (
    <div
      className="flex h-full w-full items-center justify-center text-sm text-text-secondary"
      role="status"
      aria-live="polite"
    >
      Loading demo...
    </div>
  )
}

function InstallModuleFallback(): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background-main/90 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-text-secondary">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-accent-secondary" />
        Preparing installer...
      </div>
    </div>
  )
}

export function DemoApp(): React.JSX.Element {
  const [selectedScript, setSelectedScript] = useState<DemoScript | null>(null)
  const [isInstallOpen, setIsInstallOpen] = useState(false)
  const [username, setUsername] = useState('user')

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const cfg = await window.api.getConfig()
        if (cfg?.username) {
          setUsername(cfg.username)
        }
      } catch (err) {
        console.error('Failed to load config in demo app:', err)
      }
    }
    init()
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-main font-sans text-text-primary selection:bg-accent-primary/30">
      <TitleBar title="Prism Demo" />
      <PrismBackground />

      <div className="relative z-10 h-full w-full overflow-hidden">
        {selectedScript ? (
          <Suspense fallback={<DemoModuleFallback />}>
            <DemoChatView
              key={selectedScript.id}
              script={selectedScript}
              onBack={() => setSelectedScript(null)}
              onDownload={() => setIsInstallOpen(true)}
            />
          </Suspense>
        ) : (
          <DemoHome
            scripts={demoScripts}
            onSelectScript={setSelectedScript}
            onDownload={() => setIsInstallOpen(true)}
            username={username}
          />
        )}
      </div>

      {isInstallOpen && (
        <Suspense fallback={<InstallModuleFallback />}>
          <InstallOverlay onClose={() => setIsInstallOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
