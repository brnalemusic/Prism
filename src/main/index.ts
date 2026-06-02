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
import os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  initGemini,
  handleChatMessage,
  setGeminiModel,
  setSubagentModel,
  setUserApiKey,
  cancelChatMessage,
  loadChatIntoHistory,
  activeRuns,
  handleLauncherChatMessage,
  clearLauncherChat,
  generateTts,
  handleAiSearchChatMessage,
  cancelAiSearch,
  transcribeAudio
} from './gemini'
import {
  searchWorkspaceFiles,
  listApplications,
  openApplication,
  registerAppsUpdatedCallback,
  captureAppScreenshot
} from './systemTools'
import { loadConfig, saveConfig, AppConfig } from './config'
import { listChatSessions, deleteChatSession, searchChatsOffline } from './history'
import { SubagentMessage, ApplicationInfo } from '../shared/types'

import { initAutoUpdater } from './updater'

let currentConfig: AppConfig
let mainWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let subagentsWindow: BrowserWindow | null = null
let subagentSettingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let cachedApps: ApplicationInfo[] = []

const miniAppWindows = new Map<string, BrowserWindow>()
const miniAppDataMap = new Map<
  string,
  { id: string; title: string; html: string; css: string; js: string }
>()

function createMiniAppWindow(
  id: string,
  title: string,
  html: string,
  css: string,
  js: string
): void {
  console.log('[MiniApp] createMiniAppWindow called, id:', id)

  if (miniAppWindows.has(id)) {
    console.log('[MiniApp] Window already exists, focusing')
    miniAppWindows.get(id)?.focus()
    return
  }

  miniAppDataMap.set(id, { id, title, html, css, js })

  const miniAppWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0c0f',
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  miniAppWindows.set(id, miniAppWindow)
  console.log('[MiniApp] BrowserWindow created')

  miniAppWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer-MiniApp] [Level ${level}] ${message} (at ${sourceId}:${line})`)
  })

  let isShown = false
  const showWindow = (): void => {
    if (!isShown) {
      isShown = true
      console.log('[MiniApp] Showing window')
      miniAppWindow.show()
    }
  }

  miniAppWindow.on('ready-to-show', () => {
    console.log('[MiniApp] ready-to-show fired, showing window')
    showWindow()
  })

  miniAppWindow.webContents.on('did-finish-load', () => {
    console.log('[MiniApp] did-finish-load fired, sending mini-app-data')
    miniAppWindow.webContents.send('mini-app-data', { id, title, html, css, js })
    // Fallback: show the window if ready-to-show hasn't fired
    setTimeout(() => {
      showWindow()
    }, 150)
  })

  miniAppWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[MiniApp] did-fail-load:', errorCode, errorDescription)
  })

  miniAppWindow.on('closed', () => {
    console.log('[MiniApp] Window closed')
    miniAppWindows.delete(id)
    miniAppDataMap.delete(id)
    mainWindow?.webContents.send('mini-app-window-closed', id)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = `${process.env['ELECTRON_RENDERER_URL']}#mini-app`
    console.log('[MiniApp] Loading URL (dev):', url)
    miniAppWindow.loadURL(url)
  } else {
    const filePath = join(__dirname, '../renderer/index.html')
    console.log('[MiniApp] Loading file (prod):', filePath)
    miniAppWindow.loadFile(filePath, { hash: 'mini-app' })
  }
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(icon)
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Prism',
      click: (): void => {
        mainWindow?.show()
      }
    },
    {
      label: 'Toggle Launcher',
      click: (): void => {
        toggleLauncher()
      }
    },
    {
      label: 'Settings',
      click: (): void => {
        mainWindow?.show()
        mainWindow?.webContents.send('open-settings')
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: (): void => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Prism')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

function createSubagentsWindow(initialMessages?: SubagentMessage[]): void {
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

function createSubagentSettingsWindow(): void {
  if (subagentSettingsWindow) {
    subagentSettingsWindow.show()
    subagentSettingsWindow.focus()
    return
  }

  subagentSettingsWindow = new BrowserWindow({
    width: 430,
    height: 560,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0A0F',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  subagentSettingsWindow.on('ready-to-show', () => {
    subagentSettingsWindow?.show()
  })

  subagentSettingsWindow.on('closed', () => {
    subagentSettingsWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    subagentSettingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#subagent-settings`)
  } else {
    subagentSettingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'subagent-settings'
    })
  }
}

async function handleScreenshotShortcut(): Promise<void> {
  const mainWasVisible = mainWindow && mainWindow.isVisible()
  const launcherWasVisible = launcherWindow && launcherWindow.isVisible()

  if (mainWasVisible) mainWindow?.hide()
  if (launcherWasVisible) launcherWindow?.hide()

  // Wait for window hide animations to complete
  await new Promise((resolve) => setTimeout(resolve, 150))

  let capture: { result: string; base64?: string } = { result: 'Error' }
  try {
    capture = await captureAppScreenshot('Entire Screen')
  } catch (error) {
    console.error('Failed to capture screenshot during shortcut:', error)
  }

  if (launcherWindow) {
    const primaryDisplay = screen.getPrimaryDisplay()
    launcherWindow.setBounds(primaryDisplay.bounds)
    // Send screenshot-shortcut-triggered to display border glows instantly
    launcherWindow.webContents.send('screenshot-shortcut-triggered')
    launcherWindow.show()
    launcherWindow.focus()
    launcherWindow.webContents.send('launcher-focus')

    if (capture.base64) {
      launcherWindow.webContents.send('screenshot-captured', capture.base64)
    }
  }
}

function registerGlobalShortcuts(): void {
  globalShortcut.unregisterAll()

  // Launcher shortcut
  const lShortcut = currentConfig.launcherShortcut || 'CommandOrControl+Space'
  try {
    globalShortcut.register(lShortcut, () => {
      toggleLauncher()
    })
  } catch (error) {
    console.error('Failed to register launcher shortcut:', lShortcut, error)
    globalShortcut.register('CommandOrControl+Space', () => {
      toggleLauncher()
    })
  }

  // Screenshot shortcut
  const sShortcut = currentConfig.screenshotShortcut || 'Ctrl+Alt+Space'
  try {
    globalShortcut.register(sShortcut, () => {
      handleScreenshotShortcut().catch((err) => {
        console.error('Error handling screenshot shortcut:', err)
      })
    })
  } catch (error) {
    console.error('Failed to register screenshot shortcut:', sShortcut, error)
    globalShortcut.register('Ctrl+Alt+Space', () => {
      handleScreenshotShortcut().catch((err) => {
        console.error('Error handling screenshot shortcut:', err)
      })
    })
  }
}

function createWindow(): void {
  console.log('createWindow called')
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    show: true,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0c0f',
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
    console.log('ready-to-show event fired')
    mainWindow?.show()
    mainWindow?.focus()
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

  launcherWindow.on('show', () => {
    launcherWindow?.webContents.send('launcher-focus')
  })

  launcherWindow.on('focus', () => {
    launcherWindow?.webContents.send('launcher-focus')
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

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    console.log('Second instance event received')
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      // Force window focus on Windows
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
    } else {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.prism.app')

    // Set working directory to user home directory in production/packaged mode
    if (app.isPackaged) {
      try {
        process.chdir(os.homedir())
      } catch (err) {
        console.error('Failed to change working directory:', err)
      }
    }

    // Load config after app is ready
    currentConfig = loadConfig()

    // Enforce auto-launch state based on loaded configuration
    app.setLoginItemSettings({ openAtLogin: currentConfig.autoLaunch })

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
    ipcMain.on('set-think-mode', (_event, val) => {
      mainWindow?.webContents.send('think-mode-changed', val)
      launcherWindow?.webContents.send('think-mode-changed', val)
    })
    ipcMain.on('set-search-enabled', (_event, val) => {
      mainWindow?.webContents.send('search-enabled-changed', val)
      launcherWindow?.webContents.send('search-enabled-changed', val)
    })
    ipcMain.on('set-extended-search', (_event, val) => {
      mainWindow?.webContents.send('extended-search-changed', val)
      launcherWindow?.webContents.send('extended-search-changed', val)
    })
    ipcMain.on('clear-chat', () => initGemini())
    ipcMain.on('chat-cancel', (_event, chatId?: string) => cancelChatMessage(chatId))
    ipcMain.on('ai-search-message', (event, data) => {
      handleAiSearchChatMessage(event, data)
    })
    ipcMain.on('ai-search-cancel', () => {
      cancelAiSearch()
    })
    ipcMain.handle('search-chats-offline', (_event, query: string) => {
      return searchChatsOffline(query)
    })

    ipcMain.handle('get-chats', () => {
      return listChatSessions()
    })

    ipcMain.handle('load-chat', (_event, id: string) => {
      return loadChatIntoHistory(id)
    })

    ipcMain.handle('delete-chat', (_event, id: string) => {
      cancelChatMessage(id)
      return deleteChatSession(id)
    })

    ipcMain.handle('generate-tts', async (_event, text: string) => {
      return await generateTts(text)
    })

    ipcMain.handle('transcribe-audio', async (_event, audioBase64: string) => {
      console.log('[IPC] Handling transcribe-audio request')
      return await transcribeAudio(audioBase64)
    })

    ipcMain.handle('get-running-chats', () => {
      return Array.from(activeRuns.keys())
    })

    ipcMain.handle('launcher-get-apps', () => {
      return cachedApps
    })

    ipcMain.handle('launcher-get-app-icon', async (_event, appPath) => {
      try {
        const nativeImg = await app.getFileIcon(appPath, { size: 'normal' })
        return nativeImg.toDataURL()
      } catch {
        return null
      }
    })

    ipcMain.handle('launcher-search-files', async (_event, query) => {
      return await searchWorkspaceFiles(query)
    })

    ipcMain.handle('launcher-open-app', async (_event, appPath) => {
      return await openApplication(appPath)
    })

    ipcMain.handle('launcher-open-file', async (_event, filePath) => {
      try {
        const err = await shell.openPath(filePath)
        return err ? `Error: ${err}` : 'Success'
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    })

    ipcMain.on('launcher-chat-message', (event, data) => {
      handleLauncherChatMessage(event, data)
    })

    ipcMain.on('launcher-chat-clear', () => {
      clearLauncherChat()
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

    ipcMain.on('open-subagent-settings-window', () => {
      createSubagentSettingsWindow()
    })

    ipcMain.on('close-subagent-settings-window', () => {
      subagentSettingsWindow?.close()
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

    ipcMain.on('open-mini-app-window', (_event, { id, title, html, css, js }) => {
      console.log('[IPC] open-mini-app-window received, id:', id)
      createMiniAppWindow(id, title, html, css, js)
    })

    ipcMain.handle('get-mini-app-data', (event) => {
      const senderWebContents = event.sender
      for (const [id, win] of miniAppWindows.entries()) {
        if (win.webContents === senderWebContents) {
          return miniAppDataMap.get(id) || null
        }
      }
      return null
    })

    ipcMain.on('close-mini-app-window', (_event, id) => {
      const win = miniAppWindows.get(id)
      if (win) win.close()
    })

    ipcMain.on('minimize-mini-app-window', (_event, id) => {
      const win = miniAppWindows.get(id)
      if (win) win.minimize()
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
        envGeminiKey: process.env.GEMINI_API_KEY,
        username: os.userInfo().username,
        appVersion: app.getVersion()
      }
    })

    ipcMain.handle('save-config', (_event, config: AppConfig) => {
      currentConfig = config

      // Update the API key in the gemini module
      if (config.userGeminiKey) {
        setUserApiKey(config.userGeminiKey)
      }
      setSubagentModel(config.subagentModel)

      const success = saveConfig(config)
      if (success) {
        registerGlobalShortcuts()
        // Notify both windows
        mainWindow?.webContents.send('config-changed', config)
        launcherWindow?.webContents.send('config-changed', config)
        subagentSettingsWindow?.webContents.send('config-changed', config)
      }
      return success
    })

    ipcMain.on('update-config-from-tools', (_event, config: AppConfig) => {
      currentConfig = config
      registerGlobalShortcuts()
      app.setLoginItemSettings({ openAtLogin: config.autoLaunch })
      // Notify both windows
      mainWindow?.webContents.send('config-changed', config)
      launcherWindow?.webContents.send('config-changed', config)
      subagentSettingsWindow?.webContents.send('config-changed', config)
    })

    registerGlobalShortcuts()
    setGeminiModel(currentConfig.defaultModel)
    setSubagentModel(currentConfig.subagentModel)

    if (currentConfig.userGeminiKey) {
      setUserApiKey(currentConfig.userGeminiKey)
    }

    registerAppsUpdatedCallback((apps) => {
      cachedApps = apps
      launcherWindow?.webContents.send('launcher-apps-updated', cachedApps)
    })

    listApplications()
      .then((res) => {
        try {
          cachedApps = JSON.parse(res)
        } catch (e) {
          console.error('Failed to parse applications list:', e)
        }
      })
      .catch((e) => {
        console.error('Failed to cache applications:', e)
      })

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
}
