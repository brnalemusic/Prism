import { BrowserWindow, ipcMain, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as https from 'https'

/** Escapes all RegExp special characters in a string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Constants ───────────────────────────────────────────────────────────────
const GITHUB_OWNER = 'brnalemusic'
const GITHUB_REPO = 'Prism'

// ─── State ───────────────────────────────────────────────────────────────────
let updaterWindow: BrowserWindow | null = null
let downloadedFile: string | null = null
let isForceClosing = false

interface UpdaterState {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'
  currentVersion: string
  latestVersion: string
  recommendationLevel: 'patch' | 'minor' | 'major'
  releaseNotes: string
  progress?: {
    percent: number
    speed: number
    transferred: number
    total: number
  }
  error?: string
}

let updaterState: UpdaterState = {
  status: 'checking',
  currentVersion: '',
  latestVersion: '',
  recommendationLevel: 'patch',
  releaseNotes: ''
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAppIconPath(): string {
  const iconExt = process.platform === 'win32' ? 'ico' : 'png'
  const iconName = `prism-marine.${iconExt}`
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icons', iconName)
    : join(__dirname, '../../resources/icons', iconName)
}

function getRecommendationLevel(current: string, latest: string): 'patch' | 'minor' | 'major' {
  const currentClean = current.replace(/[^0-9.]/g, '')
  const latestClean = latest.replace(/[^0-9.]/g, '')

  const currentParts = currentClean.split('.').map(Number)
  const latestParts = latestClean.split('.').map(Number)

  const cMajor = currentParts[0] || 0
  const cMinor = currentParts[1] || 0

  const lMajor = latestParts[0] || 0
  const lMinor = latestParts[1] || 0

  if (lMajor !== cMajor) {
    return 'major'
  } else if (lMinor !== cMinor) {
    return 'minor'
  } else {
    return 'patch'
  }
}

/** Performs a GET request and returns the response body as a string. */
function fetchUrl(url: string, redirects = 0): Promise<string> {
  if (redirects > 5) return Promise.reject(new Error(`Too many redirects for ${url}`))
  return new Promise((resolve, reject) => {
    const options = new URL(url)
    const req = https.get(
      {
        hostname: options.hostname,
        path: options.pathname + options.search,
        headers: {
          'User-Agent': `Prism/${app.getVersion()} Electron Updater`,
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect securely
          try {
            const redirectUrl = new URL(res.headers.location, url)
            if (
              redirectUrl.protocol === 'https:' &&
              (redirectUrl.hostname === 'github.com' ||
                redirectUrl.hostname === 'api.github.com' ||
                redirectUrl.hostname.endsWith('.githubusercontent.com'))
            ) {
              fetchUrl(redirectUrl.toString(), redirects + 1).then(resolve).catch(reject)
            } else {
              reject(new Error(`Insecure redirect to ${redirectUrl.toString()}`))
            }
          } catch (e) {
            reject(new Error(`Invalid redirect URL: ${res.headers.location}`))
          }
          res.resume()
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end()
  })
}

interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  assets: Array<{ name: string; browser_download_url: string; size: number }>
}

/** Fetches the latest release info from GitHub. */
async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  const body = await fetchUrl(url)
  return JSON.parse(body) as GitHubRelease
}

/**
 * Resolves the download URL for the installer asset.
 *
 * Priority:
 *   1. Primary pattern:  prism-invisible-setup-${version}.exe
 *   2. Fallback pattern: prism-${version}-setup.exe
 *
 * Returns null if neither is found (triggers error screen).
 */
function resolveInstallerUrl(
  assets: GitHubRelease['assets'],
  version: string
): { url: string; size: number; pattern: 'primary' | 'fallback' } | null {
  // Primary: new invisible-setup naming convention
  const primaryPattern = new RegExp(`^prism-invisible-setup-${escapeRegExp(version)}\\.(exe)$`, 'i')
  const primaryAsset = assets.find((a) => primaryPattern.test(a.name))
  if (primaryAsset) {
    return { url: primaryAsset.browser_download_url, size: primaryAsset.size, pattern: 'primary' }
  }

  // Fallback: legacy naming convention
  const fallbackPattern = new RegExp(`^prism-${escapeRegExp(version)}-setup\\.(exe)$`, 'i')
  const fallbackAsset = assets.find((a) => fallbackPattern.test(a.name))
  if (fallbackAsset) {
    return { url: fallbackAsset.browser_download_url, size: fallbackAsset.size, pattern: 'fallback' }
  }

  return null
}

/** Downloads a file from a URL to a destination path, reporting progress. */
function downloadFile(
  url: string,
  dest: string,
  totalSize: number,
  onProgress: (transferred: number, speed: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doDownload = (downloadUrl: string, redirects = 0): void => {
      if (redirects > 5) return reject(new Error('Too many redirects'))
      const parsedUrl = new URL(downloadUrl)
      const req = https.get(
        {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          headers: { 'User-Agent': `Prism/${app.getVersion()} Electron Updater` }
        },
        (res) => {
          // Follow redirects securely
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume()
            try {
              const redirectUrl = new URL(res.headers.location, downloadUrl)
              if (
                redirectUrl.protocol === 'https:' &&
                (redirectUrl.hostname === 'github.com' ||
                  redirectUrl.hostname === 'api.github.com' ||
                  redirectUrl.hostname.endsWith('.githubusercontent.com'))
              ) {
                doDownload(redirectUrl.toString(), redirects + 1)
              } else {
                reject(new Error(`Insecure redirect to ${redirectUrl.toString()}`))
              }
            } catch (e) {
              reject(new Error(`Invalid redirect URL: ${res.headers.location}`))
            }
            return
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} while downloading installer`))
            res.resume()
            return
          }

          const fileStream = fs.createWriteStream(dest)
          let transferred = 0
          let lastTime = Date.now()
          let lastTransferred = 0

          res.on('data', (chunk: Buffer) => {
            transferred += chunk.length
            const now = Date.now()
            const elapsed = (now - lastTime) / 1000
            if (elapsed >= 0.5) {
              const speed = (transferred - lastTransferred) / elapsed
              onProgress(transferred, speed)
              lastTime = now
              lastTransferred = transferred
            }
          })

          res.pipe(fileStream)
          fileStream.on('finish', () => {
            fileStream.close()
            onProgress(totalSize, 0)
            resolve()
          })
          fileStream.on('error', reject)
          res.on('error', reject)
        }
      )
      req.on('error', reject)
      req.end()
    }

    doDownload(url)
  })
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createUpdaterWindow(mainWindow: BrowserWindow): void {
  if (updaterWindow) {
    updaterWindow.focus()
    return
  }

  updaterWindow = new BrowserWindow({
    width: 520,
    height: 400,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#13151a',
    parent: mainWindow,
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Prevent closing unless we explicitly force it
  updaterWindow.on('close', (e) => {
    if (!isForceClosing) {
      e.preventDefault()
    }
  })

  updaterWindow.on('ready-to-show', () => {
    updaterWindow?.show()
  })

  updaterWindow.on('closed', () => {
    updaterWindow = null
    isForceClosing = false
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    updaterWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#updater`)
  } else {
    updaterWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'updater'
    })
  }
}

// ─── Core update logic ────────────────────────────────────────────────────────

let pendingDownload: { url: string; size: number } | null = null

async function checkForUpdates(mainWindow: BrowserWindow): Promise<void> {
  const currentVersion = app.getVersion()
  console.log(`[Auto-Updater] Checking for updates. Current version: ${currentVersion}`)

  let release: GitHubRelease
  try {
    release = await fetchLatestRelease()
  } catch (err) {
    console.error('[Auto-Updater] Failed to fetch latest release:', err)
    // Don't open the updater window if we couldn't even reach GitHub
    return
  }

  const latestVersion = (release.tag_name || release.name || '').replace(/^v/, '').trim()
  console.log(`[Auto-Updater] Latest version on GitHub: ${latestVersion}`)

  if (!latestVersion) {
    console.warn('[Auto-Updater] Could not determine latest version from GitHub release.')
    return
  }

  // Sentimental Versioning: trigger on any difference, not just "newer"
  if (latestVersion === currentVersion) {
    console.log('[Auto-Updater] Already on the latest version. No update needed.')
    updaterState = { ...updaterState, status: 'not-available', currentVersion, latestVersion }
    return
  }

  console.log(
    `[Auto-Updater] Version mismatch detected (${currentVersion} → ${latestVersion}). Looking for installer asset…`
  )

  const resolved = resolveInstallerUrl(release.assets, latestVersion)

  if (!resolved) {
    // Could not find installer with either naming pattern — show error screen
    // so at least we know the updater *fired* and detected the version difference.
    console.warn(
      `[Auto-Updater] Could not find installer asset for v${latestVersion}. Neither primary nor fallback pattern matched. Showing error screen.`
    )
    updaterState = {
      status: 'error',
      currentVersion,
      latestVersion,
      recommendationLevel: getRecommendationLevel(currentVersion, latestVersion),
      releaseNotes: typeof release.body === 'string' ? release.body : '',
      error: `Installer not found for v${latestVersion}. Expected: prism-invisible-setup-${latestVersion}.exe or prism-${latestVersion}-setup.exe`
    }
    createUpdaterWindow(mainWindow)
    return
  }

  console.log(
    `[Auto-Updater] Found installer via '${resolved.pattern}' pattern: ${resolved.url}`
  )

  pendingDownload = { url: resolved.url, size: resolved.size }

  updaterState = {
    status: 'available',
    currentVersion,
    latestVersion,
    recommendationLevel: getRecommendationLevel(currentVersion, latestVersion),
    releaseNotes: typeof release.body === 'string' ? release.body : ''
  }

  createUpdaterWindow(mainWindow)
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // ── IPC Handlers ────────────────────────────────────────────────────────────
  ipcMain.handle('get-updater-state', () => {
    return updaterState
  })

  ipcMain.on('download-update', async () => {
    if (updaterState.status !== 'available' && updaterState.status !== 'error') return
    if (!pendingDownload) {
      console.error('[Auto-Updater] download-update fired but pendingDownload is null.')
      return
    }

    updaterState.status = 'downloading'
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('updater-state', updaterState)
    }

    const tempDir = app.getPath('temp')
    const fileName = pendingDownload.url.split('/').pop() || `prism-setup-${updaterState.latestVersion}.exe`
    const destPath = join(tempDir, fileName)
    const totalSize = pendingDownload.size

    try {
      await downloadFile(pendingDownload.url, destPath, totalSize, (transferred, speed) => {
        const percent = totalSize > 0 ? Math.round((transferred / totalSize) * 100) : 0
        updaterState.status = 'downloading'
        updaterState.progress = { percent, speed, transferred, total: totalSize }
        if (updaterWindow && !updaterWindow.isDestroyed()) {
          updaterWindow.webContents.send('updater-state', { ...updaterState })
        }
      })

      downloadedFile = destPath
      updaterState.status = 'downloaded'
      updaterState.progress = { percent: 100, speed: 0, transferred: totalSize, total: totalSize }
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.webContents.send('updater-state', { ...updaterState })
      }
      console.log(`[Auto-Updater] Download complete: ${destPath}`)
    } catch (err: any) {
      console.error('[Auto-Updater] Download failed:', err)
      updaterState.status = 'error'
      updaterState.error = err?.message || String(err)
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.webContents.send('updater-state', { ...updaterState })
      }
    }
  })

  ipcMain.on('install-update', () => {
    if (!downloadedFile) {
      console.error('[Auto-Updater] Cannot install: downloaded file path is missing.')
      return
    }

    isForceClosing = true

    const appPath = process.execPath
    const escapedInstallerPath = downloadedFile.replace(/"/g, '`"')
    const escapedAppPath = appPath.replace(/"/g, '`"')

    console.log(`[Auto-Updater] Preparing post-install command for installer: ${downloadedFile}`)

    // Detached PowerShell script that:
    // 1. Waits for Prism to exit (so files aren't locked).
    // 2. Runs the silent installer and waits for it to finish.
    // 3. Relaunches Prism.
    const cmd = `Start-Job -ScriptBlock {
      $pidToWait = ${process.pid}
      while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {
        Start-Sleep -Milliseconds 100
      }
      Start-Process -FilePath "${escapedInstallerPath}" -Wait
      Start-Process -FilePath "${escapedAppPath}"
    }`

    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.close()
    }
    app.quit()
  })

  ipcMain.on('close-updater-window', () => {
    isForceClosing = true
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.close()
    }
  })

  // ── Dev simulation listeners ────────────────────────────────────────────────
  if (is.dev) {
    ipcMain.on('dev-trigger-updater-ui', (_event, level: 'patch' | 'minor' | 'major') => {
      updaterState = {
        status: 'available',
        currentVersion: '3.0.0',
        latestVersion: level === 'major' ? '4.0.0' : level === 'minor' ? '3.1.0' : '3.0.1',
        recommendationLevel: level,
        releaseNotes: 'Esta é uma atualização simulada no modo de desenvolvimento do Prism.'
      }
      createUpdaterWindow(mainWindow)
    })

    ipcMain.on('dev-simulate-updater-progress', () => {
      let percent = 0
      const interval = setInterval(() => {
        percent += 5
        updaterState.status = 'downloading'
        updaterState.progress = {
          percent,
          speed: 1024 * 1024 * 3.4, // 3.4 MB/s
          transferred: Math.round(1024 * 1024 * 45 * (percent / 100)),
          total: 1024 * 1024 * 45
        }
        if (updaterWindow && !updaterWindow.isDestroyed()) {
          updaterWindow.webContents.send('updater-state', updaterState)
        }
        if (percent >= 100) {
          clearInterval(interval)
          downloadedFile = join(app.getPath('temp'), 'prism-invisible-setup-mock.exe')
          updaterState.status = 'downloaded'
          if (updaterWindow && !updaterWindow.isDestroyed()) {
            updaterWindow.webContents.send('updater-state', updaterState)
          }
        }
      }, 150)
    })

    // In development mode, don't check automatically
    return
  }

  // ── Production: kick off the check ─────────────────────────────────────────
  checkForUpdates(mainWindow).catch((err) => {
    console.error('[Auto-Updater] Unhandled error in checkForUpdates:', err)
  })
}
