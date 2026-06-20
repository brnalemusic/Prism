import { useState, useEffect } from 'react'
import type { DemoScript } from '../../../../shared/demo'
import { PrismBackground } from '../PrismBackground'
import { TitleBar } from '../TitleBar'
import { demoScripts } from '../../demo/scripts'
import { DemoHome } from './DemoHome'
import { DemoChatView } from './DemoChatView'
import { InstallOverlay } from './InstallOverlay'

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
          <DemoChatView
            key={selectedScript.id}
            script={selectedScript}
            onBack={() => setSelectedScript(null)}
            onDownload={() => setIsInstallOpen(true)}
          />
        ) : (
          <DemoHome
            scripts={demoScripts}
            onSelectScript={setSelectedScript}
            onDownload={() => setIsInstallOpen(true)}
            username={username}
          />
        )}
      </div>

      {isInstallOpen && <InstallOverlay onClose={() => setIsInstallOpen(false)} />}
    </div>
  )
}
