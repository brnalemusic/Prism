import '@fontsource-variable/geist'
import '@fontsource-variable/jetbrains-mono'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_DEMO } from '../../shared/demo'
import { UpdaterView } from './components/UpdaterView'
import { QuickLauncher } from './components/QuickLauncher'
import { DiscordVoiceGlowOverlay } from './components/DiscordVoiceGlowOverlay'
import { DemoApp } from './components/demo/DemoApp'
import App from './App'

function RootApp(): React.JSX.Element {
  if (IS_DEMO) {
    return <DemoApp />
  }

  // Secondary BrowserWindows use focused entrypoints so the launcher and
  // voice overlay do not parse the full chat application at startup.
  switch (window.location.hash) {
    case '#launcher':
      return <QuickLauncher />
    case '#voice-overlay':
      return <DiscordVoiceGlowOverlay />
    case '#updater':
      return <UpdaterView />
    default:
      return <App />
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
)
