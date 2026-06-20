import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execSync, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type {
  DemoDownloadResult,
  DemoInstallProgress,
  DemoOpenResult,
  DemoProcessResult
} from '../shared/demo'
import type { DownloadProgress } from '../shared/types'

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size?: number
}

interface GithubRelease {
  tag_name?: string
  name?: string
  assets?: GithubReleaseAsset[]
}

const RELEASE_API_URL = 'https://api.github.com/repos/brnalemusic/Prism/releases/latest'
const DEMO_DOWNLOAD_ID = 'demo-prism-installer'

function emitDemoProgress(progress: Omit<DemoInstallProgress, 'updatedAt'>): void {
  const payload: DemoInstallProgress = {
    ...progress,
    updatedAt: Date.now()
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('demo-install-progress', payload)
    }
  }
}

function emitDownloadProgress(progress: DownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('download-progress', progress)
    }
  }
}

function getDownloadsFolder(): string {
  try {
    return app.getPath('downloads')
  } catch {
    return path.join(os.homedir(), 'Downloads')
  }
}

function sanitizeFilename(filename: string): string {
  const clean = path.basename(filename || 'Prism-setup.exe').replace(/[<>:"/\\|?*]+/g, '-')
  return clean.trim() || 'Prism-setup.exe'
}

function selectInstallerAsset(release: GithubRelease): GithubReleaseAsset | null {
  const assets = release.assets || []
  const executableAssets = assets.filter((asset) => /\.exe$/i.test(asset.name))
  const setupAsset =
    executableAssets.find((asset) => /setup/i.test(asset.name) && /prism/i.test(asset.name)) ||
    executableAssets.find((asset) => /setup|installer/i.test(asset.name)) ||
    executableAssets.find((asset) => /prism/i.test(asset.name))

  return setupAsset || executableAssets[0] || null
}

async function resolveLatestInstaller(): Promise<{
  asset: GithubReleaseAsset
  version?: string
}> {
  emitDemoProgress({
    stage: 'resolving-release',
    message: 'Finding the latest Prism release...'
  })

  const response = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Prism-Demo'
    }
  })

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with HTTP ${response.status}`)
  }

  const release = (await response.json()) as GithubRelease
  const asset = selectInstallerAsset(release)

  if (!asset?.browser_download_url) {
    throw new Error('No Windows Prism installer asset was found in the latest release.')
  }

  return {
    asset,
    version: release.tag_name || release.name
  }
}

async function downloadInstaller(asset: GithubReleaseAsset): Promise<{
  setupPath: string
  filename: string
}> {
  const filename = sanitizeFilename(asset.name)
  const downloadsFolder = getDownloadsFolder()
  await fs.mkdir(downloadsFolder, { recursive: true })
  const setupPath = path.join(downloadsFolder, filename)

  emitDemoProgress({
    stage: 'downloading',
    message: `Downloading ${filename}...`,
    setupPath
  })

  const response = await fetch(asset.browser_download_url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Prism-Demo'
    }
  })

  if (!response.ok) {
    throw new Error(`Installer download failed with HTTP ${response.status}`)
  }

  const totalHeader = Number(response.headers.get('content-length') || asset.size || 0)
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined
  const startedAt = Date.now()

  const updateProgress = (
    patch: Partial<DownloadProgress> & Pick<DownloadProgress, 'status'>
  ): void => {
    const receivedBytes = Math.max(0, patch.receivedBytes ?? 0)
    const percent =
      typeof patch.percent === 'number'
        ? patch.percent
        : totalBytes
          ? Math.min(100, (receivedBytes / totalBytes) * 100)
          : undefined

    emitDownloadProgress({
      id: DEMO_DOWNLOAD_ID,
      filename,
      url: response.url || asset.browser_download_url,
      targetPath: setupPath,
      receivedBytes,
      totalBytes,
      percent,
      status: patch.status,
      error: patch.error,
      startedAt,
      updatedAt: Date.now()
    })
  }

  updateProgress({ status: 'downloading', receivedBytes: 0 })

  const body = response.body
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(setupPath, buffer)
    updateProgress({
      status: 'completed',
      receivedBytes: buffer.length,
      percent: 100
    })
    return { setupPath, filename }
  }

  const file = await fs.open(setupPath, 'w')
  let receivedBytes = 0
  let lastProgressAt = 0

  try {
    const reader = body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const buffer = Buffer.from(value)
      await file.write(buffer)
      receivedBytes += buffer.length

      const now = Date.now()
      if (now - lastProgressAt > 220) {
        updateProgress({ status: 'downloading', receivedBytes })
        lastProgressAt = now
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    updateProgress({ status: 'failed', receivedBytes, error })
    await fs.unlink(setupPath).catch(() => {})
    throw err
  } finally {
    await file.close()
  }

  updateProgress({ status: 'completed', receivedBytes, percent: 100 })
  emitDemoProgress({
    stage: 'downloaded',
    message: 'Prism installer is ready.',
    setupPath
  })

  return { setupPath, filename }
}

function runProcess(
  command: string,
  args: string[],
  options: {
    stage: DemoInstallProgress['stage']
    message: string
    cwd?: string
    visibleWindow?: boolean
  }
): Promise<DemoProcessResult> {
  return new Promise((resolve) => {
    let output = ''

    emitDemoProgress({
      stage: options.stage,
      message: options.message
    })

    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: !options.visibleWindow,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
      emitDemoProgress({
        stage: options.stage,
        message: options.message,
        cliOutput: output.slice(-4000)
      })
    })

    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
      emitDemoProgress({
        stage: options.stage,
        message: options.message,
        cliOutput: output.slice(-4000)
      })
    })

    child.on('error', (err) => {
      resolve({
        ok: false,
        output,
        error: err.message
      })
    })

    child.on('close', (exitCode) => {
      resolve({
        ok: exitCode === 0,
        exitCode,
        output
      })
    })
  })
}

async function runInstaller(setupPath: string): Promise<DemoProcessResult> {
  const resolvedPath = path.resolve(setupPath)
  await fs.access(resolvedPath)

  const result = await runProcess(resolvedPath, [], {
    stage: 'installer-running',
    message: 'Prism installer is running...',
    cwd: path.dirname(resolvedPath),
    visibleWindow: true
  })

  if (result.ok) {
    emitDemoProgress({
      stage: 'installer-finished',
      message: 'Prism installer finished.',
      setupPath: resolvedPath
    })
    return result
  }

  if (/spawn|EACCES|UNKNOWN/i.test(result.error || '')) {
    const openError = await shell.openPath(resolvedPath)
    if (!openError) {
      emitDemoProgress({
        stage: 'installer-finished',
        message: 'Prism installer launched.',
        setupPath: resolvedPath
      })
      return { ok: true, exitCode: null, output: result.output }
    }
    return { ok: false, output: result.output, error: openError }
  }

  return {
    ...result,
    error: result.error || `Installer exited with code ${result.exitCode}`
  }
}

async function installPrismCli(): Promise<DemoProcessResult> {
  const result = await runProcess(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'iwr -useb bit.ly/prismcli | iex'],
    {
      stage: 'cli-running',
      message: 'Installing PrismCLI...',
      visibleWindow: true
    }
  )

  emitDemoProgress({
    stage: result.ok ? 'cli-finished' : 'failed',
    message: result.ok ? 'PrismCLI installation finished.' : 'PrismCLI installation failed.',
    cliOutput: (result.output || '').slice(-4000),
    error: result.ok ? undefined : result.error || `PrismCLI exited with code ${result.exitCode}`
  })

  return result.ok
    ? result
    : {
        ...result,
        error: result.error || `PrismCLI exited with code ${result.exitCode}`
      }
}

async function installDependencies(): Promise<DemoProcessResult> {
  emitDemoProgress({
    stage: 'deps-running',
    message: 'Checking browser dependencies...'
  })

  const commonPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
  ]

  const hasSystemBrowser = commonPaths.some((p) => {
    try {
      require('fs').accessSync(p)
      return true
    } catch {
      return false
    }
  })

  if (hasSystemBrowser) {
    emitDemoProgress({
      stage: 'deps-finished',
      message: 'System browser found. Dependencies are ready.'
    })
    return { ok: true, output: 'Compatible system browser found. No extra download needed.' }
  }

  emitDemoProgress({
    stage: 'deps-running',
    message: 'Installing Chromium browser dependency...'
  })

  try {
    const output = execSync('npx playwright install chromium', {
      timeout: 5 * 60 * 1000,
      encoding: 'utf-8'
    })
    emitDemoProgress({
      stage: 'deps-finished',
      message: 'Browser dependency installed.',
      cliOutput: (output || '').slice(-4000)
    })
    return { ok: true, output }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    emitDemoProgress({
      stage: 'failed',
      message: 'Failed to install browser dependency.',
      error
    })
    return { ok: false, error }
  }
}

async function openInstalledPrism(): Promise<DemoOpenResult> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

  const candidates = [
    path.join(localAppData, 'Programs', 'Prism', 'Prism.exe'),
    path.join(localAppData, 'Prism', 'Prism.exe'),
    path.join(programFiles, 'Prism', 'Prism.exe'),
    path.join(programFilesX86, 'Prism', 'Prism.exe'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Prism.lnk')
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      const error = await shell.openPath(candidate)
      if (error) return { ok: false, path: candidate, error }
      return { ok: true, path: candidate }
    } catch {
      // Try the next known install location.
    }
  }

  return {
    ok: false,
    error: 'Prism was not found in the usual Windows install locations.'
  }
}

async function resolveVersionFromHtmlRedirect(): Promise<string> {
  const response = await fetch('https://github.com/brnalemusic/Prism/releases/latest', {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Prism-Demo'
    }
  })
  const finalUrl = response.url
  const tagMatch = finalUrl.match(/\/releases\/tag\/(v?([0-9.]+))/i)
  if (!tagMatch) {
    throw new Error(`Could not parse tag from redirect URL: ${finalUrl}`)
  }
  return tagMatch[2] // e.g. "2.1.0"
}

export function registerDemoDownloadHandlers(): void {
  for (const channel of [
    'demo-download-prism',
    'demo-run-prism-installer',
    'demo-install-deps',
    'demo-install-cli',
    'demo-open-prism',
    'demo-quit-app'
  ]) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle('demo-download-prism', async (): Promise<DemoDownloadResult> => {
    try {
      const { asset, version } = await resolveLatestInstaller()
      const { setupPath, filename } = await downloadInstaller(asset)
      return {
        ok: true,
        setupPath,
        filename,
        version
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.warn('GitHub API lookup failed, trying HTML redirect lookup fallback. Error:', error)

      try {
        let appVersion: string
        try {
          appVersion = await resolveVersionFromHtmlRedirect()
          console.log('Resolved latest version from HTML redirect:', appVersion)
        } catch (redirectErr) {
          appVersion = app.getVersion()
          console.warn('HTML redirect lookup failed, falling back to local app version:', redirectErr)
        }

        const fallbackFilename = `Prism-${appVersion}-setup.exe`
        const fallbackUrl = `https://github.com/brnalemusic/Prism/releases/latest/download/${fallbackFilename}`

        emitDemoProgress({
          stage: 'downloading',
          message: 'GitHub API offline. Resolving mirrors...'
        })

        const fallbackAsset = {
          name: fallbackFilename,
          browser_download_url: fallbackUrl
        }

        const { setupPath, filename } = await downloadInstaller(fallbackAsset)
        return {
          ok: true,
          setupPath,
          filename,
          version: appVersion
        }
      } catch (fallbackErr) {
        const finalError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        emitDemoProgress({
          stage: 'failed',
          message: finalError,
          error: finalError
        })
        return { ok: false, error: finalError }
      }
    }
  })

  ipcMain.handle(
    'demo-run-prism-installer',
    async (_event, setupPath: string): Promise<DemoProcessResult> => {
      try {
        emitDemoProgress({
          stage: 'launching-installer',
          message: 'Launching Prism installer...',
          setupPath
        })
        return await runInstaller(setupPath)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        emitDemoProgress({
          stage: 'failed',
          message: error,
          setupPath,
          error
        })
        return { ok: false, error }
      }
    }
  )

  ipcMain.handle('demo-install-cli', async (): Promise<DemoProcessResult> => {
    try {
      return await installPrismCli()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      emitDemoProgress({
        stage: 'failed',
        message: error,
        error
      })
      return { ok: false, error }
    }
  })

  ipcMain.handle('demo-install-deps', async (): Promise<DemoProcessResult> => {
    try {
      return await installDependencies()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      emitDemoProgress({
        stage: 'failed',
        message: error,
        error
      })
      return { ok: false, error }
    }
  })

  ipcMain.handle('demo-open-prism', async (): Promise<DemoOpenResult> => {
    return await openInstalledPrism()
  })

  ipcMain.handle('demo-quit-app', async (): Promise<void> => {
    app.quit()
  })
}
