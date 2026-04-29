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
import { initGemini, handleChatMessage, setGeminiModel, setUserApiKey, cancelChatMessage, loadChatIntoHistory } from './gemini'
import { loadConfig, saveConfig, AppConfig } from './config'
import { listChatSessions, deleteChatSession } from './history'

import { initAutoUpdater } from './updater'

let currentConfig: AppConfig
let mainWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let subagentsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

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

function createSubagentsWindow(initialMessages?: any[]): void {
  if (subagentsWindow) {
    subagentsWindow.show()
    subagentsWindow.focus()
    if (initialMessages) {
      subagentsWindow.webContents.send('subagent-initial-messages', initialMessages)
    }
    return
  }

  subagentsWindow = new BrowserWindow({
    width: 400,
    height: 650,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0A0F',
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  subagentsWindow.on('ready-to-show', () => {
    subagentsWindow?.show()
    if (initialMessages) {
      subagentsWindow?.webContents.send('subagent-initial-messages', initialMessages)
    }
  })

  subagentsWindow.on('closed', () => {
    subagentsWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    subagentsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#subagents`)
  } else {
    subagentsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'subagents' })
  }
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

  // Load config after app is ready
  currentConfig = loadConfig()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers
  ipcMain.on('chat-message', handleChatMessage)
  ipcMain.on('set-model', (_event, modelKey) => {
    setGeminiModel(modelKey)
    mainWindow?.webContents.send('model-changed', modelKey)
    launcherWindow?.webContents.send('model-changed', modelKey)
  })
  ipcMain.on('clear-chat', () => initGemini())
  ipcMain.on('chat-cancel', () => cancelChatMessage())

  ipcMain.handle('get-chats', () => {
    return listChatSessions()
  })

  ipcMain.handle('load-chat', (_event, id: string) => {
    return loadChatIntoHistory(id)
  })

  ipcMain.handle('delete-chat', (_event, id: string) => {
    return deleteChatSession(id)
  })

  ipcMain.on('launcher-submit', (_event, data) => {
    launcherWindow?.hide()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('launcher-message', data)
    }
  })

  ipcMain.on('hide-launcher', () => {
    launcherWindow?.hide()
  })

  ipcMain.on('minimize-app', () => {
    mainWindow?.minimize()
  })

  ipcMain.on('minimize-subagents-window', () => {
    subagentsWindow?.minimize()
  })

  ipcMain.on('close-subagents-window', () => {
    subagentsWindow?.close()
  })

  ipcMain.on('open-subagents-window', (_event, initialMessages) => {
    createSubagentsWindow(initialMessages)
  })

  ipcMain.on('subagent-message-broadcast', (_event, data) => {
    subagentsWindow?.webContents.send('subagent-message', data)
    mainWindow?.webContents.send('subagent-message', data)
  })

  ipcMain.on('auto-minimize-trigger', () => {
    setTimeout(() => {
      mainWindow?.minimize()
    }, 200)
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
