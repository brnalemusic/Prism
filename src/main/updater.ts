import { dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Override isUpdateAvailable to support Sentimental Versioning.
  // Instead of SemVer comparisons (greater than), we check if the latest version
  // is different from the currently installed version.
  const anyUpdater = autoUpdater as unknown as {
    isUpdateAvailable: (updateInfo: { version: string }) => Promise<boolean>
    app: { version: string }
    isUpdateSupported: (updateInfo: { version: string }) => Promise<boolean>
    isUserWithinRollout: (updateInfo: { version: string }) => Promise<boolean>
    _logger: { info: (message: string) => void }
  }

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

  // In development mode, we generally don't want to check for updates
  // unless we are specifically testing the updater
  if (is.dev) {
    // To test in dev, you can comment out the return below
    // But remember that electron-updater needs a packaged app to work 100%
    return
  }

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info)
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) of Prism is available. Would you like to download it now?`,
        buttons: ['Yes', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available:', info)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info)
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded and is ready to be installed. Would you like to restart and install now?`,
        buttons: ['Restart and Install', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-Updater Error:', err)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    console.log(
      `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`
    )
  })

  // Start the check
  autoUpdater.checkForUpdatesAndNotify()
}
