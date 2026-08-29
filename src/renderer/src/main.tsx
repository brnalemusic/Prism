import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/rubik-spray-paint'
import './assets/main.css'

import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_DEMO } from '../../shared/demo'
import { UpdaterView } from './components/UpdaterView'
import { StartupShell } from './components/StartupShell'

const RootApp = lazy(async () => {
  if (IS_DEMO) {
    const { DemoApp } = await import('./components/demo/DemoApp')
    return { default: DemoApp }
  }

  // Secondary BrowserWindows use focused entrypoints so the launcher and
  // voice overlay do not parse the full chat application at startup.
  switch (window.location.hash) {
    case '#launcher': {
      const { QuickLauncher } = await import('./components/QuickLauncher')
      return { default: QuickLauncher }
    }
    case '#voice-overlay': {
      const { DiscordVoiceGlowOverlay } = await import('./components/DiscordVoiceGlowOverlay')
      return { default: DiscordVoiceGlowOverlay }
    }
    case '#updater':
      return { default: UpdaterView }
  }

  return await import('./App')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<StartupShell isDemo={IS_DEMO} />}>
      <RootApp />
    </Suspense>
  </StrictMode>
)
