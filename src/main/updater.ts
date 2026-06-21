import { BrowserWindow, ipcMain, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { spawn } from 'child_process'

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
    frame: false, // Frameless design
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#13151a',
    parent: mainWindow, // Set parent but keep non-modal
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Prevent closing unless we explicitly force it (like when installing or quitting the app)
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
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    updaterWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#updater`)
  } else {
    updaterWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'updater'
    })
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Override isUpdateAvailable to support Sentimental Versioning.
  // Instead of SemVer comparisons (greater than), we check if the latest version
  // is different from the currently installed version.
  const anyUpdater = autoUpdater as any

  anyUpdater.isUpdateAvailable = async function (
    this: typeof anyUpdater,
    updateInfo: { version: string }
  ): Promise<boolean> {
    const latestVersion = (updateInfo.version || '').trim()
    const currentVersion = (this.app.version || '').trim()

    this._logger.info(
      `[Sentimental Versioning] Checking if update is available. Current: ${currentVersion}, Latest: ${latestVersion}`
    )

    if (!latestVersion) {
      this._logger.info('[Sentimental Versioning] Latest version is not specified. No update.')
      return false
    }

    if (latestVersion === currentVersion) {
      this._logger.info('[Sentimental Versioning] Current version is equal to latest. No update.')
      return false
    }

    if (!(await Promise.resolve(this.isUpdateSupported(updateInfo)))) {
      this._logger.info('[Sentimental Versioning] Update is not supported on this system.')
      return false
    }

    const isUserWithinRollout = await Promise.resolve(this.isUserWithinRollout(updateInfo))
    if (!isUserWithinRollout) {
      this._logger.info('[Sentimental Versioning] User is not within rollout threshold.')
      return false
    }

    this._logger.info(`[Sentimental Versioning] Update is available! Proceeding to download.`)
    return true
  }

  // Set logger
  autoUpdater.logger = console

  // Disable auto-download so we can ask the user first
  autoUpdater.autoDownload = false

  // Setup IPC Handlers
  ipcMain.handle('get-updater-state', () => {
    return updaterState
  })

  ipcMain.on('download-update', () => {
    if (updaterState.status === 'available' || updaterState.status === 'error') {
      updaterState.status = 'downloading'
      if (updaterWindow && !updaterWindow.isDestroyed()) {
        updaterWindow.webContents.send('updater-state', updaterState)
      }
      autoUpdater.downloadUpdate()
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

    // Create a detached PowerShell script block that:
    // 1. Waits for the parent Prism process to exit so files aren't locked.
    // 2. Runs the silent installer (/S) and waits for it to finish installing.
    // 3. Automatically relaunches Prism.
    const cmd = `Start-Job -ScriptBlock {
      $pidToWait = ${process.pid}
      while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {
        Start-Sleep -Milliseconds 100
      }
      Start-Process -FilePath "${escapedInstallerPath}" -ArgumentList "/S" -Wait
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

  // Development simulation listeners
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
          // Mock a downloaded installer file path
          downloadedFile = join(app.getPath('temp'), 'prism-invisible-setup-mock.exe')
          updaterState.status = 'downloaded'
          if (updaterWindow && !updaterWindow.isDestroyed()) {
            updaterWindow.webContents.send('updater-state', updaterState)
          }
        }
      }, 150)
    })
  }

  // Register updater events
  autoUpdater.on('update-available', (info) => {
    console.log('Auto-updater: Update available:', info)
    const currentVersion = anyUpdater.app.version || app.getVersion()
    const latestVersion = info.version

    updaterState = {
      status: 'available',
      currentVersion,
      latestVersion,
      recommendationLevel: getRecommendationLevel(currentVersion, latestVersion),
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    }

    createUpdaterWindow(mainWindow)
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('Auto-updater: Update not available:', info)
    updaterState.status = 'not-available'
  })

  autoUpdater.on('download-progress', (progressObj) => {
    updaterState.status = 'downloading'
    updaterState.progress = {
      percent: Math.round(progressObj.percent),
      speed: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total
    }
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('updater-state', updaterState)
    }
  })

  autoUpdater.on('update-downloaded', (event: any) => {
    console.log('Auto-updater: Update downloaded:', event)
    downloadedFile = event.downloadedFile
    updaterState.status = 'downloaded'
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('updater-state', updaterState)
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
    updaterState.status = 'error'
    updaterState.error = err.message || String(err)
    if (updaterWindow && !updaterWindow.isDestroyed()) {
      updaterWindow.webContents.send('updater-state', updaterState)
    }
  })

  // In development mode, do not run check automatically
  if (is.dev) {
    return
  }

  // Start the check
  autoUpdater.checkForUpdatesAndNotify()
}
