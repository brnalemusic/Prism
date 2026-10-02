import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { _electron as electron } from 'playwright'
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), tailwind()], server: { host: '127.0.0.1', port: 5199, strictPort: true }, logLevel: 'error' })
await server.listen()
const app = await electron.launch({ args: [path.resolve('scripts/fixtures/liquid-glass-electron.cjs')], env: { ...process.env, PRISM_GLASS_TEST_URL: 'http://127.0.0.1:5199/scripts/fixtures/liquid-glass.html' }, timeout: 30000 })
const page = await app.firstWindow()
await page.getByRole('button', { name: 'max', exact: true }).click()
await page.getByRole('button', { name: 'Real InputBar', exact: true }).click()
await page.waitForTimeout(600)
// Drag WITHOUT the pill mounted (fixture guard) to isolate selection mechanics
const box = await page.locator('#ai-messages p').first().boundingBox()
const y = box.y + box.height / 2
await page.mouse.move(box.x + 5, y)
await page.mouse.down()
for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + 5 + i * 10, y, { steps: 2 }); await page.waitForTimeout(16) }
await page.mouse.up()
console.log('RAW SELECTION:', JSON.stringify(await page.evaluate(() => window.getSelection()?.toString() ?? '')))
// Now with pill mounted: does the drag still select?
await page.evaluate(() => { (document.getElementById('force-pill-mount') as HTMLButtonElement)?.click() })
await page.waitForTimeout(200)
await page.mouse.move(box.x + 5, y)
await page.mouse.down()
for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + 5 + i * 10, y, { steps: 2 }); await page.waitForTimeout(16) }
await page.mouse.up()
console.log('WITH PILL SELECTION:', JSON.stringify(await page.evaluate(() => window.getSelection()?.toString() ?? '')))
console.log('PILL VISIBLE:', await page.evaluate(() => { const p = document.querySelector('[aria-label="Answer Prism"]') as HTMLElement; return p ? !p.classList.contains('hidden') : 'no-pill' }))
await app.close(); await server.close(); process.exit(0)
