import '@fontsource/outfit'
import './assets/main.css'

import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_DEMO } from '../../shared/demo'
import { StartupShell } from './components/StartupShell'

const RootApp = lazy(async () => {
  if (IS_DEMO) {
    const { DemoApp } = await import('./components/demo/DemoApp')
    return { default: DemoApp }
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
