import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'

type FixtureWindow = Window & { actions: { confirmation?: string }[]; setRecovery: (update: Record<string, unknown>) => void }

const root = process.cwd().replaceAll('\\', '/')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-git-ui-'))
await fs.writeFile(path.join(temporary, 'index.html'), '<html><head></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>')
await fs.writeFile(path.join(temporary, 'fixture.tsx'), `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HarnessGitRecoveryCard } from '/@fs/${root}/src/renderer/src/components/HarnessGitRecoveryCard.tsx'
import '/@fs/${root}/src/renderer/src/assets/main.css'
window.actions = []
window.api = { runHarnessGitAction: async (project, action) => {
  window.actions.push(action)
  await new Promise(resolve => setTimeout(resolve, 300))
  return { ok: true, snapshot: {} }
}}
const initial = { id: 'test', revision: 1, projectPath: 'fixture', repoRoot: 'fixture', action: 'merge', step: 'continue', state: 'ready', branch: 'feature/prism', operation: { kind: 'merge' }, canRetry: true, canAbort: true, canResolve: false, chatIds: ['build'], cards: [], generation: 1 }
function Fixture() {
 const [record, setRecord] = useState(initial)
 window.setRecovery = update => setRecord({...initial, ...update})
 return <main style={{maxWidth: 720, margin: '100px auto', padding: 24}}><p className="text-text-secondary">The approved implementation has finished. Git checks passed.</p><HarnessGitRecoveryCard recovery={record} /><p className="text-text-muted">Conversation continues here.</p></main>
}
createRoot(document.getElementById('root')).render(<Fixture />)
`)
// Vite ignores `port: 0` and always fixes 5173; when another Prism thread already
// holds that port, the fixture would silently load a foreign dev server (or fail to
// load at all). Reserve a genuinely free port ourselves and require it via strictPort.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port: 0 }, () => {
      const port = (probe.address() as net.AddressInfo).port
      probe.close(() => resolve(port))
    })
  })
}
const port = await freePort()
const server = await createServer({
  configFile: false, root: temporary, plugins: [react(), tailwind()],
  resolve: { alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') }, dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root, temporary] } }, logLevel: 'error'
})
const assignedPort = (): number => {
  const address = server.httpServer?.address()
  return address && typeof address !== 'string' ? address.port : 0
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await server.listen()
  // strictPort guarantees the reserved port; refuse anything else so the fixture
  // can never silently load a foreign dev server.
  assert.equal(assignedPort(), port)
  const address = server.httpServer!.address()
  assert.ok(address && typeof address !== 'string')
  try { browser = await chromium.launch({ headless: true }) }
  catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }) }
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(20000)
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()) })
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message) })
  await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${address.port}`) ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  for (const theme of ['marine', 'fire', 'lava', 'gold', 'forest', 'indigo', 'violet', 'white']) {
    await page.evaluate((theme) => { document.documentElement.setAttribute('data-theme', theme) }, theme)
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isEnabled(), true)
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'violet'))
  await page.mouse.move(630, 220)
  await page.waitForTimeout(100)
  const screenshot = path.join(os.tmpdir(), 'prism-git-recovery-card.png')
  await page.screenshot({ path: screenshot })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Working…' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Abort', exact: true }).click()
  assert.equal(await page.evaluate(() => (window as FixtureWindow).actions.length), 1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Abort', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Abort', exact: true }).click()
  await page.waitForTimeout(350)
  assert.equal(await page.evaluate(() => (window as FixtureWindow).actions[1]?.confirmation), 'ABORT')
  await page.evaluate((update) => (window as FixtureWindow).setRecovery(update), { state: 'blocked', canRetry: false, reason: 'The approved checks have not completed.' })
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isDisabled(), true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 360, height: 740 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.keyboard.press('Tab')
  await page.evaluate(() => (window as FixtureWindow).setRecovery({ state: 'completed' }))
  await page.getByText('Operation finished', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, themes: 8, screenshot, checks: ['Retry dispatch', 'busy lock', 'Abort confirmation', 'blocked Retry', 'terminal state', 'narrow viewport', 'reduced motion', 'no browser exceptions'] }))
} finally {
  await browser?.close()
  await server.close()
  assert.ok(temporary.startsWith(path.join(os.tmpdir(), 'prism-git-ui-')))
  await fs.rm(temporary, { recursive: true, force: true })
}
