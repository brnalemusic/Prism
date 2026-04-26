import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  Tray,
  Menu,
  nativeImage
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initGemini, handleChatMessage, setGeminiModel, setUserApiKey } from './gemini'
import { loadConfig, saveConfig, AppConfig } from './config'

import { initAutoUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let currentConfig: AppConfig = loadConfig()

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(icon)
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Prism',
      click: (): void => {
        mainWindow?.show()
      }
    },
    {
      label: 'Alternar Launcher',
      click: (): void => {
        toggleLauncher()
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: (): void => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Prism System')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

function registerLauncherShortcut(shortcut: string): void {
  globalShortcut.unregisterAll()
  try {
    globalShortcut.register(shortcut, () => {
      toggleLauncher()
    })
  } catch (error) {
    console.error('Failed to register shortcut:', shortcut, error)
    // Fallback to default if custom fails
    globalShortcut.register('CommandOrControl+Space', () => {
      toggleLauncher()
    })
  }
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (mainWindow) initAutoUpdater(mainWindow)
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && currentConfig.minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
    return false
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createLauncherWindow(): void {
  launcherWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  launcherWindow.setAlwaysOnTop(true, 'screen-saver')

  launcherWindow.on('blur', () => {
    launcherWindow?.hide()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    launcherWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#launcher`)
  } else {
    launcherWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'launcher' })
  }
}

function toggleLauncher(): void {
  if (!launcherWindow) return

  if (launcherWindow.isVisible()) {
    launcherWindow.hide()
  } else {
    const primaryDisplay = screen.getPrimaryDisplay()
    launcherWindow.setBounds(primaryDisplay.bounds)
    launcherWindow.show()
    launcherWindow.focus()
    launcherWindow.webContents.send('launcher-focus')
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.prism.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers
  ipcMain.on('chat-message', handleChatMessage)
  ipcMain.on('set-model', (_event, modelKey) => {
    setGeminiModel(modelKey)
    mainWindow?.webContents.send('model-changed', modelKey)
  })
  ipcMain.on('clear-chat', () => initGemini())

  ipcMain.on('launcher-submit', (_event, message) => {
    launcherWindow?.hide()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('launcher-message', message)
    }
  })

  ipcMain.on('hide-launcher', () => {
    launcherWindow?.hide()
  })

  ipcMain.on('minimize-app', () => {
    mainWindow?.minimize()
  })

  ipcMain.on('close-app', () => {
    if (currentConfig.minimizeToTray) {
      mainWindow?.hide()
    } else {
      isQuitting = true
      app.quit()
    }
  })

  ipcMain.handle('get-config', () => {
    return {
      ...currentConfig,
      envGeminiKey: process.env.GEMINI_API_KEY
    }
  })

  ipcMain.handle('save-config', (_event, config: AppConfig) => {
    currentConfig = config
    
    // Update the API key in the gemini module
    if (config.userGeminiKey) {
      setUserApiKey(config.userGeminiKey)
    }

    const success = saveConfig(config)
    if (success) {
      registerLauncherShortcut(config.launcherShortcut)
      // Notify both windows
      mainWindow?.webContents.send('config-changed', config)
      launcherWindow?.webContents.send('config-changed', config)
    }
    return success
  })

  registerLauncherShortcut(currentConfig.launcherShortcut)
  setGeminiModel(currentConfig.defaultModel)
  
  if (currentConfig.userGeminiKey) {
    setUserApiKey(currentConfig.userGeminiKey)
  }

  initGemini()
  createWindow()
  createLauncherWindow()
  createTray()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
