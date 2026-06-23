import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
  dialog,
  type NativeImage
} from 'electron'
import { join, dirname } from 'path'
import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import { DEPENDENCIES } from './dependenciesManifest'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
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
  captureAppScreenshot,
  detectAvailableTerminals
} from './systemTools'
import { loadConfig, saveConfig, AppConfig } from './config'
import { toolsManifest } from './toolsManifest'
import { listChatSessions, deleteChatSession, searchChatsOffline } from './history'
import {
  testGeminiConnection,
  setConnectionApiKey,
  markConnectionActive,
  stopKeepAlive,
  checkInternetConnectivity
} from './connection'
import { SubagentMessage, ApplicationInfo } from '../shared/types'
import { IS_DEMO } from '../shared/demo'

import { initAutoUpdater } from './updater'
import { registerDemoDownloadHandlers } from './demoDownload'

const APP_DATA_DIR_NAME = IS_DEMO ? 'PrismDemo' : 'PrismDesktop'
const WINDOW_STATE_FILE = join(
  process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'),
  APP_DATA_DIR_NAME,
  'window-state.json'
)

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: IS_DEMO ? 1080 : 1200,
  height: IS_DEMO ? 700 : 900,
  isMaximized: false
}

function isWindowStateVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true
  const displays = screen.getAllDisplays()
  return displays.some((display) => {
    const bounds = display.bounds
    return (
      state.x! >= bounds.x &&
      state.x! < bounds.x + bounds.width &&
      state.y! >= bounds.y &&
      state.y! < bounds.y + bounds.height
    )
  })
}

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(WINDOW_STATE_FILE)) {
      const data = fs.readFileSync(WINDOW_STATE_FILE, 'utf8')
      const state = JSON.parse(data)
      if (isWindowStateVisible(state)) {
        return state
      }
    }
  } catch (e) {
    console.error('Failed to load window state:', e)
  }
  return DEFAULT_WINDOW_STATE
}

function saveWindowState(state: WindowState): void {
  try {
    const dir = dirname(WINDOW_STATE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.error('Failed to save window state:', e)
  }
}

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

function getEffectiveIconTheme(config?: AppConfig): AppConfig['theme'] {
  const theme = config?.theme || 'marine'

  if (theme === 'rgb' && !(config?.rgbThemeExpiry && Date.now() < config.rgbThemeExpiry)) {
    return 'marine'
  }

  return theme
}

function getIconResourcePath(iconName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icons', iconName)
    : join(__dirname, '../../resources/icons', iconName)
}

function getAppIconPath(config: AppConfig | undefined = currentConfig): string {
  const iconExt = process.platform === 'win32' ? 'ico' : 'png'
  return getIconResourcePath(`prism-${getEffectiveIconTheme(config)}.${iconExt}`)
}

function getFallbackAppIconPath(): string {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', iconName)
    : join(__dirname, '../../resources', iconName)
}

function getAppNativeIcon(config?: AppConfig): NativeImage {
  const themedIcon = nativeImage.createFromPath(getAppIconPath(config))
  if (!themedIcon.isEmpty()) {
    return themedIcon
  }

  const fallbackIcon = nativeImage.createFromPath(getFallbackAppIconPath())
  if (fallbackIcon.isEmpty()) {
    console.warn('Failed to load Prism app icon:', getAppIconPath(config))
  }
  return fallbackIcon
}

function updateNativeIcons(): void {
  const appIcon = getAppNativeIcon(currentConfig)

  if (tray && !appIcon.isEmpty()) {
    tray.setImage(appIcon.resize({ width: 16, height: 16 }))
  }

  const windows = [
    mainWindow,
    launcherWindow,
    subagentsWindow,
    subagentSettingsWindow,
    ...miniAppWindows.values()
  ]

  windows.forEach((window) => {
    if (window && !window.isDestroyed() && !appIcon.isEmpty()) {
      window.setIcon(appIcon)
    }
  })
}

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
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? undefined : 'hidden',
    backgroundColor: '#0b0c0f',
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
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
  const iconPath = getAppIconPath()
  const trayIcon = nativeImage.createFromPath(iconPath)
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
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? undefined : 'hidden',
    backgroundColor: '#0A0A0F',
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
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
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? undefined : 'hidden',
    backgroundColor: '#0A0A0F',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
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

  const windowState = loadWindowState()

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? undefined : 'hidden',
    backgroundColor: '#0b0c0f',
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  let normalBounds = {
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y
  }

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      const bounds = mainWindow.getBounds()
      normalBounds = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y
      }
    }
  })

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      const bounds = mainWindow.getBounds()
      normalBounds = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y
      }
    }
  })

  if (windowState.isMaximized) {
    mainWindow.maximize()
  } else {
    mainWindow.show()
  }

  mainWindow.on('ready-to-show', () => {
    console.log('ready-to-show event fired')
    mainWindow?.focus()
    if (mainWindow && !IS_DEMO) initAutoUpdater(mainWindow)
  })

  mainWindow.on('close', (event) => {
    if (mainWindow) {
      const isMaximized = mainWindow.isMaximized()
      saveWindowState({
        ...normalBounds,
        isMaximized
      })
    }

    if (!IS_DEMO && !isQuitting && currentConfig.minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
    return false
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      /* ignore malformed URLs */
    }
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
    ...(process.platform === 'linux' || process.platform === 'win32'
      ? { icon: getAppIconPath() }
      : {}),
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

if (process.argv.includes('--get-dependencies')) {
  app.whenReady().then(async () => {
    console.log(JSON.stringify(DEPENDENCIES))
    app.exit(0)
  })
}

if (process.argv.includes('--install-playwright-browsers')) {
  app.whenReady().then(async () => {
    const commonPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
    ]

    const hasSystemBrowser = commonPaths.some((p) => fs.existsSync(p))
    if (hasSystemBrowser) {
      console.log('install-playwright-browsers: Compatible system browser found. Skipping install.')
      app.exit(0)
      return
    }

    const response = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Yes', 'No'],
      title: 'Prism Setup - Browser Dependency Required',
      message:
        'No compatible web browser (Chrome, Edge, or Firefox) was found on your system.\n\nPrism needs to install Chromium to enable web search and page reading. A command prompt window will open to download the browser.\n\nDo you want to proceed?',
      defaultId: 0,
      cancelId: 1
    })

    if (response === 0) {
      const cmd =
        'cmd.exe /c start /wait cmd.exe /c "echo Prism is downloading the Chromium browser dependency... && npx playwright install chromium && exit"'
      try {
        execSync(cmd)
        app.exit(0)
      } catch (err) {
        console.error('Failed to run browser installer:', err)
        app.exit(1)
      }
    } else {
      app.exit(0)
    }
  })
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
    electronApp.setAppUserModelId(IS_DEMO ? 'com.prism.demo.app' : 'com.prism.app')

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
    if (!IS_DEMO) {
      app.setLoginItemSettings({ openAtLogin: currentConfig.autoLaunch })
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window, { zoom: true })
      window.on('maximize', () => {
        window.webContents.send('window-maximized-change', true)
      })
      window.on('unmaximize', () => {
        window.webContents.send('window-maximized-change', false)
      })
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

    ipcMain.handle('is-maximized', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win ? win.isMaximized() : false
    })

    ipcMain.on('maximize-app', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        if (win.isMaximized()) {
          win.unmaximize()
        } else {
          win.maximize()
        }
      }
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
      if (!IS_DEMO && currentConfig.minimizeToTray) {
        mainWindow?.hide()
      } else {
        isQuitting = true
        app.quit()
      }
    })

    ipcMain.handle('get-available-terminals', async () => {
      return await detectAvailableTerminals()
    })

    ipcMain.handle('get-open-windows', async () => {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 }
      })
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL()
      }))
    })

    ipcMain.handle('capture-window', async (_event, sourceId: string) => {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      const source = sources.find((s) => s.id === sourceId)
      if (source) {
        return source.thumbnail.toPNG().toString('base64')
      }
      throw new Error('Window source not found')
    })

    ipcMain.handle('get-config', () => {
      return {
        ...currentConfig,
        envGeminiKey: process.env.GEMINI_API_KEY ? 'present' : 'none',
        username: os.userInfo().username,
        appVersion: app.getVersion()
      }
    })

    ipcMain.on('get-config-sync', (event) => {
      event.returnValue = {
        ...currentConfig,
        envGeminiKey: process.env.GEMINI_API_KEY ? 'present' : 'none',
        username: os.userInfo().username,
        appVersion: app.getVersion()
      }
    })

    ipcMain.handle('save-config', (_event, config: AppConfig) => {
      currentConfig = config

      // Update the API key in the gemini module
      if (config.userGeminiKey) {
        setUserApiKey(config.userGeminiKey)
        setConnectionApiKey(config.userGeminiKey)
      }
      setSubagentModel(config.subagentModel)

      const success = saveConfig(config)
      if (success) {
        if (!IS_DEMO) registerGlobalShortcuts()
        updateNativeIcons()
        // Notify both windows
        mainWindow?.webContents.send('config-changed', config)
        launcherWindow?.webContents.send('config-changed', config)
        subagentSettingsWindow?.webContents.send('config-changed', config)
      }
      return success
    })

    ipcMain.handle('get-tool-definitions', () => {
      return toolsManifest
    })

    // Pre-launch connection test used by the loading screen.
    ipcMain.handle('test-gemini-connection', async () => {
      const res = await testGeminiConnection()
      if (res.ok) {
        markConnectionActive()
      }
      return res
    })

    ipcMain.on('update-config-from-tools', (_event, config: AppConfig) => {
      currentConfig = config
      if (!IS_DEMO) {
        registerGlobalShortcuts()
        app.setLoginItemSettings({ openAtLogin: config.autoLaunch })
      }
      updateNativeIcons()
      // Notify both windows
      mainWindow?.webContents.send('config-changed', config)
      launcherWindow?.webContents.send('config-changed', config)
      subagentSettingsWindow?.webContents.send('config-changed', config)
    })

    if (IS_DEMO) {
      registerDemoDownloadHandlers()
    } else {
      registerGlobalShortcuts()
      setGeminiModel(currentConfig.defaultModel)
      setSubagentModel(currentConfig.subagentModel)

      if (currentConfig.userGeminiKey) {
        setUserApiKey(currentConfig.userGeminiKey)
        setConnectionApiKey(currentConfig.userGeminiKey)
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
    }
    createWindow()
    if (!IS_DEMO) {
      createLauncherWindow()
      createTray()
    }
    updateNativeIcons()

    // ── Connectivity monitor ──────────────────────────────────────────────────
    // Polls for internet connectivity every 5 seconds and pushes state changes
    // to the renderer via IPC. Uses a lightweight fetch (no Gemini API call)
    // so it's safe to run frequently without side effects.
    let lastConnectivityState: boolean | null = null
    setInterval(async () => {
      const online = await checkInternetConnectivity()
      if (online !== lastConnectivityState) {
        lastConnectivityState = online
        mainWindow?.webContents.send('connectivity-changed', online)
      }
    }, 5000)

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
    stopKeepAlive()
  })
}
