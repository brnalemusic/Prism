import { dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
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

  autoUpdater.on('update-downloaded', (info) => {
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

  // Start the check
  autoUpdater.checkForUpdatesAndNotify()
}
