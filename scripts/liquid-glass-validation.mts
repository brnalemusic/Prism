import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { _electron as electron } from 'playwright'

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [react(), tailwind()],
  server: { host: '127.0.0.1', port: 5198, strictPort: true },
  logLevel: 'error'
})
await server.listen()
const env = {
  ...process.env,
  PRISM_GLASS_TEST_URL: 'http://127.0.0.1:5198/scripts/fixtures/liquid-glass.html'
}
delete env.ELECTRON_RUN_AS_NODE
let app: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  console.log('Launching Electron optical fixture')
  app = await electron.launch({
    args: [path.resolve('scripts/fixtures/liquid-glass-electron.cjs')],
    env,
    timeout: 30000
  })
  console.log('Electron connected')
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  console.log('Fixture window ready')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: 'max', exact: true }).click()
  await page.locator('[data-liquid-glass="active"]').waitFor()
  await page.waitForTimeout(500)
  const screenshot = path.join(os.tmpdir(), 'prism-liquid-glass-electron.png')
  await page.screenshot({ path: screenshot })
  const refracted = await page.screenshot()
  await page.evaluate(() =>
    document
      .querySelectorAll('feDisplacementMap')
      .forEach((node) => node.setAttribute('scale', '0'))
  )
  await page.waitForTimeout(150)
  const neutral = await page.screenshot()
  assert.notDeepEqual(refracted, neutral, 'Displacement must change real backdrop pixels')
  // Decode both frames with Electron itself; compare the edge ROI, not PNG metadata.
  const difference = await app.evaluate(
    ({ nativeImage }, frames) => {
      const a = nativeImage.createFromBuffer(Buffer.from(frames[0], 'base64'))
      const b = nativeImage.createFromBuffer(Buffer.from(frames[1], 'base64'))
      const size = a.getSize()
      const aa = a.toBitmap(),
        bb = b.toBitmap()
      let changed = 0
      for (let y = 260; y < 370; y++)
        for (let x = 162; x < 184; x++) {
          const offset = (y * size.width + x) * 4
          if (
            Math.abs(aa[offset] - bb[offset]) +
              Math.abs(aa[offset + 1] - bb[offset + 1]) +
              Math.abs(aa[offset + 2] - bb[offset + 2]) >
            12
          )
            changed++
        }
      return changed
    },
    [refracted.toString('base64'), neutral.toString('base64')]
  )
  assert.ok(difference > 100, `Expected refracted edge pixels; found ${difference}`)
  console.log(`Optical comparison passed: ${difference} edge pixels`)
  for (const mode of ['auto', 'performance']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.waitForTimeout(100)
    assert.equal(await page.locator('feDisplacementMap').count(), 0)
    assert.equal(await page.locator('[data-liquid-glass]').count(), 0)
    await page.getByRole('button', { name: 'max', exact: true }).click()
    await page.locator('[data-liquid-glass="active"]').waitFor()
  }
  const beforeScroll = await page.screenshot()
  await page.evaluate(() => window.scrollTo(0, 115))
  await page.waitForTimeout(100)
  assert.notDeepEqual(beforeScroll, await page.screenshot())
  await page.evaluate(() => {
    document.getElementById('glass')!.style.width = '420px'
  })
  await page.waitForTimeout(150)
  assert.equal(await page.locator('filter').getAttribute('width'), '420')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  await page.locator('filter').waitFor({ state: 'detached' })
  assert.equal(await page.locator('feDisplacementMap').count(), 0)
  console.log('Mode, resize and reduced-motion checks passed')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Real InputBar', exact: true }).click()
  await page.locator('#real-input [data-liquid-glass="active"]').waitFor()
  await page
    .locator('textarea')
    .fill('A real expandable input\nSecond line\nThird line\nFourth line')
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(os.tmpdir(), 'prism-liquid-glass-inputbar.png') })
  await page.getByTitle('Reasoning depth').click()
  await page.locator('.glass-dropdown-panel[data-liquid-glass="active"]').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(os.tmpdir(), 'prism-liquid-glass-menu.png') })
  console.log('Real InputBar and reasoning menu rendered')
  await page.getByTitle('Reasoning depth').click()
  await page.getByRole('button', { name: 'Toggle fullscreen', exact: true }).click()
  await page.locator('#real-input [data-liquid-glass="active"]').waitFor()
  await page.getByRole('button', { name: 'Toggle fullscreen', exact: true }).click()
  await page.locator('#real-input textarea').fill('')
  await page.evaluate(() => {
    const backdrop = document.getElementById('backdrop')!
    backdrop.style.background = '#000'
    const lines = [
      'A good agent should have:',
      '1. Clear objectives',
      '2. Well-described tools',
      '3. Controlled memory',
      '4. Minimum permissions',
      '5. Confirmation before destructive actions',
      '6. Logs and undo',
      '7. Clear success criteria',
      'In practice, there are three levels:',
      '1. Assistant with tools',
      'Responds, searches, edits files and runs commands.'
    ]
    backdrop.replaceChildren(
      ...Array.from({ length: 5 }, () => lines)
        .flat()
        .map((text) => {
          const paragraph = document.createElement('p')
          paragraph.textContent = text
          paragraph.style.cssText = 'font: 15px Arial; padding: 8px 16px; margin: 0; color: white'
          return paragraph
        })
    )
    window.scrollTo(0, 0)
    const input = document.getElementById('real-input')!
    input.style.left = '0px'
    input.style.width = '960px'
    input.style.top = '260px'
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(os.tmpdir(), 'prism-liquid-glass-reference.png') })
  const timings: Record<string, number> = {}
  for (const mode of ['auto', 'max']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const samples = await page.evaluate(async () => {
      const intervals: number[] = []
      let last = performance.now()
      for (let frame = 0; frame < 90; frame++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame((now) => {
            intervals.push(now - last)
            last = now
            window.scrollTo(0, frame * 1.5)
            resolve()
          })
        )
      }
      return intervals.slice(10).sort((a, b) => a - b)
    })
    timings[mode] = samples[Math.floor(samples.length * 0.95)]
  }
  await page.screenshot({
    path: path.join(os.tmpdir(), 'prism-liquid-glass-reference-scrolled.png')
  })
  await page.waitForTimeout(200)
  assert.equal(await page.locator('#real-input [data-liquid-glass="active"]').count(), 1)
  // Repeated mounts must return to the same filter count.
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: 'auto', exact: true }).click()
    await page.locator('filter').waitFor({ state: 'detached' })
    assert.equal(await page.locator('filter').count(), 0)
    await page.getByRole('button', { name: 'max', exact: true }).click()
    await page.locator('#real-input [data-liquid-glass="active"]').waitFor()
    assert.equal(await page.locator('filter').count(), 1)
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      edgePixelsChanged: difference,
      scrollFrameIntervalP95Ms: timings,
      screenshot,
      checks: [
        'live backdrop displacement',
        'mode teardown and restart',
        'scroll',
        'resize',
        'reduced motion',
        'no renderer errors'
      ]
    })
  )
} finally {
  await app?.close()
  await server.close()
}
