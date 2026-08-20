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
  session,
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
  setChatModel,
  cancelChatMessage,
  activeRuns,
  handleLauncherChatMessage,
  setSessionMode,
  clearLauncherChat,
  generateTts,
  handleAiSearchChatMessage,
  cancelAiSearch,
  transcribeAudio,
  getChatModel,
  getAllProviders,
  saveProviders,
  deleteProvider,
  fetchModelsFromProvider,
  getActiveModels
} from './ai'
import {
  searchWorkspaceFiles,
  openApplication,
  captureAppScreenshot,
  detectAvailableTerminals,
  getTodoForChat,
  setBrowserActionEmitter,
  openBrowser,
  closePersistentBrowser,
  _resetIdleTimer,
  setupSessionDownloadHandler
} from './systemTools'
import { asDataUrl } from './toolAttachments'

import { initAppScanner, registerAppsUpdatedCallback, forceRescan, getAppsList } from './appScanner'
import { loadConfig, saveConfig, AppConfig } from './config'
import {
  activateLicenseKey,
  deactivateLicense,
  getLicenseInfo,
  startLicenseExpirationMonitor,
  syncLocalLicenseWithSupabase,
  revokeLocalLicenseFromSupabase,
  verifyLicenseKey
} from './license'
import { toolsManifest } from './toolsManifest'
import { listChatSessions, loadChatSession, deleteChatSession, searchChatsOffline } from './history'
import {
  testGeminiConnection,
  markConnectionActive,
  stopKeepAlive,
  initializePrismCloudTransport,
  closePrismCloudTransport,
  checkInternetConnectivity
} from './connection'
import type { ApplicationInfo } from '../shared/types'
import { IS_DEMO } from '../shared/demo'
import { safeSend } from './safeSend'
import { getTerminalProcessesForChat } from './terminalProcessManager'

if (process.platform === 'win32') {
  try {
    if (process.env.TEMP && fs.existsSync(process.env.TEMP)) {
      process.env.TEMP = fs.realpathSync.native(process.env.TEMP)
    }
    if (process.env.TMP && fs.existsSync(process.env.TMP)) {
      process.env.TMP = fs.realpathSync.native(process.env.TMP)
    }
  } catch (e) {
    console.warn('[Startup] Failed to resolve long paths for TEMP/TMP:', e)
  }
}

import {
  initializeAuthSession,
  authBeginWebLogin,
  authCancelWebLogin,
  getAccountActivationStatus,
  activateAccountWithCode,
  authLogout,
  getCurrentAuthUser,
  authResetPassword,
  authUpdateProfile,
  getUserAiUsage,
  handleDeepLinkAuth,
  getAuthAccessToken,
  isUserAuthenticated,
  authRequestDeleteAccountEmail,
  authConfirmDeleteAccount,
  authConfirmDeleteAccountWithPassword
} from './supabaseAuth'
import {
  fetchSubscriptionPlans,
  createStripeCheckoutSession,
  verifyAndActivatePayment
} from './licensePayment'

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
let launcherShowWhenReady = false
let launcherLoadListenerAttached = false
export let voiceOverlayWindow: BrowserWindow | null = null

type DiscordGatewayModule = typeof import('./discordGateway')

let discordGatewayModule: DiscordGatewayModule | null = null
let discordGatewayModulePromise: Promise<DiscordGatewayModule> | null = null
let discordGatewayRequestId = 0
let discordGatewayFingerprint = ''

function getDiscordGatewayFingerprint(config: AppConfig): string {
  return `${config.discordGatewayEnabled ? 'enabled' : 'disabled'}:${config.discordBotToken?.trim() || ''}`
}

function reconcileDiscordGateway(config: AppConfig): void {
  currentConfig = config
  const enabled = Boolean(config.discordGatewayEnabled && config.discordBotToken?.trim())
  const fingerprint = getDiscordGatewayFingerprint(config)

  if (!enabled) {
    discordGatewayFingerprint = fingerprint
    discordGatewayRequestId += 1
    discordGatewayModule?.stopDiscordGateway()
    return
  }

  if (fingerprint === discordGatewayFingerprint && discordGatewayModule) {
    // The Gateway keeps its connection when unrelated settings or its model change.
    discordGatewayModule.startDiscordGateway(config)
    return
  }

  discordGatewayFingerprint = fingerprint
  const requestId = ++discordGatewayRequestId
  const loadModule = discordGatewayModule
    ? Promise.resolve(discordGatewayModule)
    : (discordGatewayModulePromise ||= import('./discordGateway'))

  void loadModule
    .then((module) => {
      discordGatewayModule = module
      if (requestId !== discordGatewayRequestId || currentConfig !== config) return
      module.startDiscordGateway(config)
    })
    .catch((error) => {
      if (requestId === discordGatewayRequestId) {
        console.error('[Discord Gateway] Failed to load Gateway module:', error)
      }
    })
}

function scheduleDiscordGatewayStart(): void {
  if (IS_DEMO || !currentConfig || isQuitting) return
  setTimeout(() => reconcileDiscordGateway(currentConfig), 0)
}

let tray: Tray | null = null
let isQuitting = false
let cachedApps: ApplicationInfo[] = []
let stopLicenseMonitor: (() => void) | null = null
// Stored so we can clear it in will-quit to prevent lingering timers
let connectivityIntervalId: ReturnType<typeof setInterval> | null = null

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

  const windows = [mainWindow, launcherWindow, ...miniAppWindows.values()]

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
    safeSend(mainWindow, 'mini-app-window-closed', id)
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
        safeSend(mainWindow, 'open-settings')
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

async function handleScreenshotShortcut(): Promise<void> {
  const mainWasVisible = mainWindow && mainWindow.isVisible()
  const launcherWasVisible = launcherWindow && launcherWindow.isVisible()

  if (mainWasVisible) mainWindow?.hide()
  if (launcherWasVisible) launcherWindow?.hide()

  // Wait for window hide animations to complete
  await new Promise((resolve) => setTimeout(resolve, 150))

  let capture: Awaited<ReturnType<typeof captureAppScreenshot>> = { result: 'Error' }
  try {
    capture = await captureAppScreenshot()
  } catch (error) {
    console.error('Failed to capture screenshot during shortcut:', error)
  }

  if (launcherWindow) {
    const primaryDisplay = screen.getPrimaryDisplay()
    launcherWindow.setBounds(primaryDisplay.bounds)
    // Send screenshot-shortcut-triggered to display border glows instantly
    safeSend(launcherWindow, 'screenshot-shortcut-triggered')
    launcherWindow.show()
    launcherWindow.focus()
    safeSend(launcherWindow, 'launcher-focus')

    if (capture.attachment) {
      safeSend(launcherWindow, 'screenshot-captured', asDataUrl(capture.attachment))
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: !IS_DEMO,
      // Disable spellcheck to reduce background Chromium memory overhead
      spellcheck: false
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.control || input.meta) &&
      input.key.toLowerCase() === 'w'
    ) {
      event.preventDefault()
      safeSend(mainWindow, 'close-tab-shortcut')
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
  }
  mainWindow.show()

  mainWindow.on('ready-to-show', () => {
    console.log('ready-to-show event fired')
    mainWindow?.focus()
    if (mainWindow && !IS_DEMO) {
      const readyWindow = mainWindow
      void import('./updater')
        .then(({ initAutoUpdater }) => initAutoUpdater(readyWindow))
        .catch((error) => console.error('[Updater] Failed to initialize:', error))
    }
    scheduleDiscordGatewayStart()
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
    } catch (err) {
      console.warn('[Navigation] Blocked malformed external URL:', details.url, err)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const target = new URL(targetUrl)
      const devOrigin = process.env['ELECTRON_RENDERER_URL']
        ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
        : null
      const isTrusted = is.dev ? target.origin === devOrigin : target.protocol === 'file:'

      if (!isTrusted) {
        event.preventDefault()
        console.warn('[Navigation] Blocked renderer navigation:', targetUrl)
      }
    } catch (err) {
      event.preventDefault()
      console.warn('[Navigation] Blocked invalid renderer navigation:', targetUrl, err)
    }
  })

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true

    try {
      const source = new URL(params.src)
      if (!['http:', 'https:', 'about:'].includes(source.protocol)) {
        event.preventDefault()
        console.warn('[Webview] Blocked unsupported source:', params.src)
      }
    } catch (err) {
      event.preventDefault()
      console.warn('[Webview] Blocked invalid source:', params.src, err)
    }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createLauncherWindow(): void {
  if (launcherWindow && !launcherWindow.isDestroyed()) return

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
      sandbox: false,
      // Disable spellcheck to reduce background Chromium memory overhead
      spellcheck: false
    }
  })

  launcherWindow.setAlwaysOnTop(true, 'screen-saver')

  launcherWindow.on('blur', () => {
    launcherWindow?.hide()
  })

  launcherWindow.on('show', () => {
    safeSend(launcherWindow, 'launcher-focus')
  })

  launcherWindow.on('focus', () => {
    safeSend(launcherWindow, 'launcher-focus')
  })

  launcherWindow.on('closed', () => {
    launcherWindow = null
    launcherShowWhenReady = false
    launcherLoadListenerAttached = false
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    launcherWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#launcher`)
  } else {
    launcherWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'launcher' })
  }
}

function toggleLauncher(): void {
  if (!launcherWindow) createLauncherWindow()
  if (!launcherWindow) return

  if (launcherWindow.isVisible()) {
    launcherWindow.hide()
  } else {
    const primaryDisplay = screen.getPrimaryDisplay()
    const showLauncher = (): void => {
      if (!launcherWindow || launcherWindow.isDestroyed()) return
      launcherWindow.setBounds(primaryDisplay.bounds)
      launcherWindow.show()
      launcherWindow.focus()
      safeSend(launcherWindow, 'launcher-focus')
    }

    if (launcherWindow.webContents.isLoading()) {
      launcherShowWhenReady = true
      if (!launcherLoadListenerAttached) {
        launcherLoadListenerAttached = true
        launcherWindow.webContents.once('did-finish-load', () => {
          launcherLoadListenerAttached = false
          if (!launcherShowWhenReady) return
          launcherShowWhenReady = false
          showLauncher()
        })
      }
    } else {
      launcherShowWhenReady = false
      showLauncher()
    }
  }
}

export function createVoiceOverlayWindowInstance(): void {
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) return

  voiceOverlayWindow = new BrowserWindow({
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
      sandbox: false,
      spellcheck: false
    }
  })

  voiceOverlayWindow.setAlwaysOnTop(true, 'screen-saver')
  voiceOverlayWindow.setIgnoreMouseEvents(true, { forward: true })

  if (process.platform === 'darwin') {
    voiceOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  voiceOverlayWindow.on('closed', () => {
    voiceOverlayWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    voiceOverlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#voice-overlay`)
  } else {
    voiceOverlayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'voice-overlay'
    })
  }
}

export function createVoiceOverlayWindow(): void {
  createVoiceOverlayWindowInstance()

  if (!voiceOverlayWindow || voiceOverlayWindow.isDestroyed()) return

  const primaryDisplay = screen.getPrimaryDisplay()
  voiceOverlayWindow.setBounds(primaryDisplay.bounds)
  voiceOverlayWindow.setAlwaysOnTop(true, 'screen-saver')
  voiceOverlayWindow.setIgnoreMouseEvents(true, { forward: true })
  if (!voiceOverlayWindow.isVisible()) {
    voiceOverlayWindow.showInactive()
  }
}

export function closeVoiceOverlayWindow(): void {
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
    voiceOverlayWindow.hide()
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

// Register 'prism://' custom protocol scheme for email verification and OAuth callbacks
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('prism', process.execPath, [join(__dirname, '../../')])
  }
} else {
  app.setAsDefaultProtocolClient('prism')
}

async function processDeepLinkUrl(urlStr: string): Promise<void> {
  if (!urlStr || !urlStr.startsWith('prism://')) return
  console.log('[Auth] Processing OAuth deep link callback')
  safeSend(mainWindow, 'auth-callback-received')
  safeSend(launcherWindow, 'auth-callback-received')
  const updatedUser = await handleDeepLinkAuth(urlStr)
  if (updatedUser) {
    initializePrismCloudTransport()
    markConnectionActive()
    currentConfig = loadConfig()
    safeSend(mainWindow, 'auth-session-updated', updatedUser)
    safeSend(launcherWindow, 'auth-session-updated', updatedUser)
    safeSend(mainWindow, 'config-changed', currentConfig)
    safeSend(launcherWindow, 'config-changed', currentConfig)

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  }
}

app.on('open-url', (event, urlStr) => {
  event.preventDefault()
  processDeepLinkUrl(urlStr).catch((err) =>
    console.error('[Auth] Failed to process open-url:', err)
  )
})

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    console.log('Second instance event received')
    const deepLink = commandLine.find((arg) => arg.startsWith('prism://'))
    if (deepLink) {
      processDeepLinkUrl(deepLink).catch((err) =>
        console.error('[Auth] Failed to process deep link:', err)
      )
    }
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

    // Check if app was launched via deep link URL (Windows / Linux process.argv)
    const initialDeepLink = !IS_DEMO
      ? process.argv.find((arg) => arg.startsWith('prism://'))
      : undefined
    if (initialDeepLink) {
      processDeepLinkUrl(initialDeepLink).catch((err) =>
        console.error('[Auth] Failed to process initial deep link:', err)
      )
    }

    if (!IS_DEMO) {
      // Start real-time license expiration monitor only for the full application.
      stopLicenseMonitor = startLicenseExpirationMonitor(() => {
        void (async () => {
          const token = await getAuthAccessToken()
          if (token) await revokeLocalLicenseFromSupabase(token)
        })()
        currentConfig = loadConfig()
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      })

      // The Demo uses its own local installer flow and does not need browser download hooks.
      setupSessionDownloadHandler(session.defaultSession)
      setupSessionDownloadHandler(session.fromPartition('persist:prism-ai-browser'))
    }

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
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: currentConfig.autoLaunch })
      } else {
        // Clean up dev-mode startup entries
        app.setLoginItemSettings({ openAtLogin: false })
      }
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window, { zoom: true })
      window.on('maximize', () => {
        safeSend(window, 'window-maximized-change', true)
      })
      window.on('unmaximize', () => {
        safeSend(window, 'window-maximized-change', false)
      })
    })

    // IPC Handlers
    ipcMain.on('chat-message', handleChatMessage)

    // Register browser session action emitter so the renderer can watch AI browser interactions
    setBrowserActionEmitter((action) => {
      safeSend(mainWindow, 'browser-action', action)
    })

    ipcMain.handle('open-browser', (_event, url?: string) => {
      return openBrowser(url)
    })

    ipcMain.handle('open-external-url', async (_event, url: string) => {
      try {
        const targetUrl = new URL(url)
        if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
          return { success: false, error: 'Only HTTP and HTTPS links can be opened externally.' }
        }

        await shell.openExternal(targetUrl.toString())
        return { success: true }
      } catch (error) {
        console.error('[Navigation] Failed to open external URL:', url, error)
        return { success: false, error: 'Unable to open the checkout in your system browser.' }
      }
    })

    ipcMain.handle('close-browser', () => {
      return closePersistentBrowser()
    })

    ipcMain.on('reset-browser-idle', () => {
      _resetIdleTimer()
    })

    ipcMain.on('set-model', (_event, modelKey) => {
      setChatModel(modelKey)
      saveConfig({ lastSelectedChatModel: modelKey })
      currentConfig = loadConfig()
      safeSend(mainWindow, 'model-changed', modelKey)
      safeSend(launcherWindow, 'model-changed', modelKey)
      safeSend(mainWindow, 'config-changed', currentConfig)
      safeSend(launcherWindow, 'config-changed', currentConfig)
    })
    ipcMain.on('set-think-mode', (_event, val) => {
      safeSend(mainWindow, 'think-mode-changed', val)
      safeSend(launcherWindow, 'think-mode-changed', val)
    })
    ipcMain.on('set-search-enabled', (_event, val) => {
      safeSend(mainWindow, 'search-enabled-changed', val)
      safeSend(launcherWindow, 'search-enabled-changed', val)
    })

    ipcMain.on('clear-chat', () => initGemini())
    ipcMain.on('chat-cancel', (_event, chatId?: string) => cancelChatMessage(chatId))
    ipcMain.on('ai-search-message', (event, data) => {
      handleAiSearchChatMessage(event, data)
    })
    ipcMain.on('ai-search-cancel', () => {
      cancelAiSearch()
    })

    ipcMain.on('overlay-log', (_event, msg) => {
      console.log(`[Overlay React]: ${msg}`)
    })

    // The voice overlay is created on demand. Replay the latest lightweight
    // state after its isolated renderer has mounted so no connection event is
    // lost while the BrowserWindow is loading.
    ipcMain.on('voice-overlay-ready', () => {
      void import('./discordGateway')
        .then(({ replayVoiceOverlayState }) => replayVoiceOverlayState())
        .catch((error) =>
          console.error('[Discord Gateway] Failed to restore overlay state:', error)
        )
    })

    ipcMain.handle('search-chats-offline', (_event, query: string) => {
      return searchChatsOffline(query)
    })

    ipcMain.handle('get-chats', () => {
      return listChatSessions()
    })

    ipcMain.handle('load-chat', (_event, id: string) => {
      const session = loadChatSession(id)
      return session ? session.messages : []
    })

    ipcMain.handle('is-chat-running', (_event, id: string) => {
      return activeRuns.has(id)
    })

    ipcMain.handle('get-todo-for-chat', (_event, id: string) => {
      return getTodoForChat(id)
    })

    ipcMain.handle('get-terminal-processes-for-chat', (_event, id: string) => {
      return getTerminalProcessesForChat(id)
    })

    ipcMain.handle('get-chat-model', (_event, id: string) => {
      return getChatModel(id)
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
      return getAppsList()
    })

    ipcMain.handle('force-rescan-apps', async () => {
      return await forceRescan()
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
      const win = launcherWindow || BrowserWindow.fromWebContents(event.sender)!
      const msg = typeof data === 'string' ? data : data.message
      handleLauncherChatMessage(win, msg)
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
        safeSend(mainWindow, 'launcher-message', data)
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
        envNvidiaNimKey: process.env.NVIDIA_API_KEY ? 'present' : 'none',
        envOpenaiKey: process.env.OPENAI_API_KEY ? 'present' : 'none',
        username: os.userInfo().username,
        appVersion: app.getVersion()
      }
    })

    ipcMain.on('get-config-sync', (event) => {
      event.returnValue = {
        ...currentConfig,
        envGeminiKey: process.env.GEMINI_API_KEY ? 'present' : 'none',
        envNvidiaNimKey: process.env.NVIDIA_API_KEY ? 'present' : 'none',
        envOpenaiKey: process.env.OPENAI_API_KEY ? 'present' : 'none',
        username: os.userInfo().username,
        appVersion: app.getVersion()
      }
    })

    ipcMain.handle('save-config', (_event, config: Partial<AppConfig>) => {
      // Pass currentConfig to avoid saveConfig re-reading the disk unnecessarily
      const success = saveConfig(config, currentConfig)
      if (success) {
        currentConfig = loadConfig()
        if (!IS_DEMO) registerGlobalShortcuts()
        updateNativeIcons()
        if (!IS_DEMO) reconcileDiscordGateway(currentConfig)
        // Notify windows with merged config
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return success
    })

    ipcMain.handle('get-tool-definitions', () => {
      return toolsManifest
    })

    ipcMain.handle('get-providers', () => {
      return getAllProviders()
    })

    ipcMain.handle('save-providers', (_event, providers: any) => {
      const success = saveProviders(providers)
      if (success) {
        currentConfig = loadConfig()
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return success
    })

    ipcMain.handle('delete-provider', (_event, providerId: string) => {
      const success = deleteProvider(providerId)
      if (success) {
        currentConfig = loadConfig()
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return success
    })

    ipcMain.handle(
      'fetch-provider-models',
      async (_event, { baseUrl, apiKey, completionType }: any) => {
        return await fetchModelsFromProvider(baseUrl, apiKey, completionType)
      }
    )

    ipcMain.handle('get-active-models', () => {
      return getActiveModels()
    })

    // Pre-launch connection test used by the loading screen.
    ipcMain.handle('test-gemini-connection', async () => {
      const res = await testGeminiConnection()
      if (res.ok) {
        markConnectionActive()
      }
      return res
    })

    ipcMain.handle('select-folder', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    })

    ipcMain.handle('get-session-mode', () => {
      return {
        mode: currentConfig.sessionMode,
        disciplinePath: currentConfig.disciplinePath
      }
    })

    ipcMain.handle('activate-license', async (_event, key: string) => {
      const verification = verifyLicenseKey(key)
      if (!verification.valid) {
        return {
          success: false,
          error: verification.error || 'Invalid license key.'
        }
      }

      const token = await getAuthAccessToken()
      if (!token && isUserAuthenticated()) {
        return {
          success: false,
          error:
            'Your Prism session could not be validated. Please check your connection and try again.'
        }
      }

      if (token) {
        // Make the Supabase entitlement the source of truth before reporting a
        // successful local activation to an authenticated user.
        const syncResult = await syncLocalLicenseWithSupabase(token, key)
        if (!syncResult.success) {
          return {
            success: false,
            error:
              syncResult.error ||
              'The license could not be linked to your Prism account. Please try again while connected.'
          }
        }
      }

      const result = activateLicenseKey(key)
      if (result.success) {
        currentConfig = loadConfig()
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return result
    })

    ipcMain.handle('deactivate-license', async () => {
      const token = await getAuthAccessToken()
      if (token) {
        const revoked = await revokeLocalLicenseFromSupabase(token)
        if (!revoked) return false
      }
      const success = deactivateLicense()
      if (success) {
        currentConfig = loadConfig()
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return success
    })

    ipcMain.handle('get-license-info', () => {
      return getLicenseInfo()
    })

    ipcMain.handle('get-subscription-plans', async () => {
      return await fetchSubscriptionPlans()
    })

    ipcMain.handle('create-checkout-session', async (_event, planId: string, email?: string) => {
      const token = await getAuthAccessToken()
      if (!token) {
        return {
          success: false,
          error: 'Please sign in before purchasing an Enterprise subscription.'
        }
      }
      return await createStripeCheckoutSession(planId, email, token)
    })

    ipcMain.handle(
      'verify-and-activate-payment',
      async (_event, planId: string, sessionId: string, email: string, company?: string) => {
        if (!sessionId) {
          return {
            success: false,
            error: 'No Stripe session ID provided. Please complete checkout first.'
          }
        }
        const token = await getAuthAccessToken()
        if (!token) {
          return {
            success: false,
            error: 'Please sign in before verifying an Enterprise subscription.'
          }
        }
        const res = await verifyAndActivatePayment(planId, sessionId, email, company, token)
        if (res.success) {
          currentConfig = loadConfig()
          safeSend(mainWindow, 'config-changed', currentConfig)
          safeSend(launcherWindow, 'config-changed', currentConfig)
        }
        return res
      }
    )

    // Supabase Auth IPC Handlers (OAuth 2.1 Web Login & Activation)
    ipcMain.handle('auth-begin-web-login', async () => {
      return await authBeginWebLogin()
    })

    ipcMain.handle('auth-cancel-web-login', async () => {
      return await authCancelWebLogin()
    })

    ipcMain.handle('auth-get-activation-status', async () => {
      return await getAccountActivationStatus()
    })

    ipcMain.handle('auth-activate-account', async (_event, code: string) => {
      const res = await activateAccountWithCode(code)
      if (res.success) {
        const user = await getCurrentAuthUser()
        if (user) {
          safeSend(mainWindow, 'auth-session-updated', user)
          safeSend(launcherWindow, 'auth-session-updated', user)
        }
      }
      return res
    })

    ipcMain.handle('auth-logout', async () => {
      const result = await authLogout()
      if (!result) return false

      safeSend(mainWindow, 'auth-session-updated', null)
      safeSend(launcherWindow, 'auth-session-updated', null)
      await closePrismCloudTransport()
      currentConfig = loadConfig()
      safeSend(mainWindow, 'config-changed', currentConfig)
      safeSend(launcherWindow, 'config-changed', currentConfig)
      return result
    })

    ipcMain.handle('auth-get-user', async () => {
      return await getCurrentAuthUser()
    })

    ipcMain.handle('auth-reset-password', async (_event, email: string) => {
      return await authResetPassword(email)
    })

    ipcMain.handle('auth-update-profile', async (_event, updates) => {
      return await authUpdateProfile(updates)
    })

    ipcMain.handle('auth-get-ai-usage', async () => {
      return await getUserAiUsage()
    })

    ipcMain.handle('auth-request-delete-email', async (_event, email: string) => {
      return await authRequestDeleteAccountEmail(email)
    })

    ipcMain.handle('auth-confirm-delete-account', async (_event, otpCode: string) => {
      const res = await authConfirmDeleteAccount(otpCode)
      if (res.success) {
        currentConfig = loadConfig()
        safeSend(mainWindow, 'auth-session-updated', null)
        safeSend(launcherWindow, 'auth-session-updated', null)
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return res
    })

    ipcMain.handle('auth-confirm-delete-password', async (_event, password: string) => {
      const res = await authConfirmDeleteAccountWithPassword(password)
      if (res.success) {
        currentConfig = loadConfig()
        safeSend(mainWindow, 'auth-session-updated', null)
        safeSend(launcherWindow, 'auth-session-updated', null)
        safeSend(mainWindow, 'config-changed', currentConfig)
        safeSend(launcherWindow, 'config-changed', currentConfig)
      }
      return res
    })

    ipcMain.on('set-session-mode', (_event, { mode, disciplinePath }) => {
      currentConfig.sessionMode = mode
      if (disciplinePath !== undefined) {
        currentConfig.disciplinePath = disciplinePath
      }
      saveConfig(currentConfig)
      setSessionMode(mode, disciplinePath)

      // Notify windows of config-changed to keep states synchronized
      safeSend(mainWindow, 'config-changed', currentConfig)
      safeSend(launcherWindow, 'config-changed', currentConfig)
    })

    ipcMain.on('update-config-from-tools', (_event, config: AppConfig) => {
      currentConfig = config
      if (!IS_DEMO) {
        registerGlobalShortcuts()
        if (app.isPackaged) {
          app.setLoginItemSettings({ openAtLogin: config.autoLaunch })
        } else {
          app.setLoginItemSettings({ openAtLogin: false })
        }
      }
      updateNativeIcons()
      if (!IS_DEMO) reconcileDiscordGateway(config)
      // Notify both windows
      safeSend(mainWindow, 'config-changed', config)
      safeSend(launcherWindow, 'config-changed', config)
    })

    // Start loading the renderer as soon as all synchronous IPC contracts are registered.
    createWindow()
    if (!IS_DEMO) {
      // Safety fallback for unusual renderer startup failures where
      // ready-to-show is never emitted.
      setTimeout(scheduleDiscordGatewayStart, 5000)
    }

    if (IS_DEMO) {
      void import('./demoDownload')
        .then(({ registerDemoDownloadHandlers }) => registerDemoDownloadHandlers())
        .catch((error) => console.error('[Demo] Failed to initialize download handlers:', error))
    } else {
      registerGlobalShortcuts()

      registerAppsUpdatedCallback((apps) => {
        cachedApps = apps
        safeSend(launcherWindow, 'launcher-apps-updated', cachedApps)
      })

      // Network-backed services and disk-heavy discovery start only after the
      // primary window has reached its first paint. The timeout is a safety
      // fallback for environments where ready-to-show is delayed indefinitely.
      let deferredServicesStarted = false
      let deferredServicesFallback: ReturnType<typeof setTimeout> | null = null
      const startDeferredServices = (): void => {
        if (deferredServicesStarted) return
        deferredServicesStarted = true
        if (deferredServicesFallback) {
          clearTimeout(deferredServicesFallback)
          deferredServicesFallback = null
        }

        initializePrismCloudTransport()
        initializeAuthSession()
          .then((user) => {
            if (user) markConnectionActive()
          })
          .catch((err) => {
            console.error('[Auth] Error restoring session on launch:', err)
          })

        initAppScanner().catch((e) => {
          console.error('Failed to initialize app scanner:', e)
        })

        initGemini()
      }

      mainWindow?.once('ready-to-show', startDeferredServices)
      deferredServicesFallback = setTimeout(startDeferredServices, 5000)
    }
    if (!IS_DEMO) {
      createTray()
    }
    updateNativeIcons()

    // ── Connectivity monitor ──────────────────────────────────────────────────
    // Polls for internet connectivity and pushes state changes to the renderer.
    // Interval adapts: 5s when offline (fast recovery detection), 15s when
    // online (stable connection requires less frequent checks).
    let lastConnectivityState: boolean | null = null
    const checkConnectivity = async (): Promise<void> => {
      const online = await checkInternetConnectivity()
      if (online !== lastConnectivityState) {
        lastConnectivityState = online
        safeSend(mainWindow, 'connectivity-changed', online)
      }
    }

    // Start with a 5s interval; adjust dynamically based on state
    const startConnectivityPoller = (): void => {
      if (connectivityIntervalId) clearInterval(connectivityIntervalId)
      const intervalMs = lastConnectivityState === false ? 5000 : 15000
      connectivityIntervalId = setInterval(async () => {
        const prevState = lastConnectivityState
        await checkConnectivity()
        // Restart with new interval if state changed (offline→online or vice versa)
        if (lastConnectivityState !== prevState) {
          startConnectivityPoller()
        }
      }, intervalMs)
    }

    // The scripted Demo is fully local and must remain idle without network polling.
    if (!IS_DEMO) {
      let connectivityStarted = false
      const startConnectivityMonitoring = (): void => {
        if (connectivityStarted) return
        connectivityStarted = true
        void checkConnectivity()
          .then(() => startConnectivityPoller())
          .catch((err) => console.error('[Connectivity] Initial check failed:', err))
      }

      mainWindow?.once('ready-to-show', startConnectivityMonitoring)
      setTimeout(startConnectivityMonitoring, 5000)
    }

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else {
        mainWindow?.show()
      }
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopLicenseMonitor?.()
    stopLicenseMonitor = null
    stopKeepAlive()
    void closePrismCloudTransport()
    // Clean up connectivity poller to prevent lingering timers after quit
    if (connectivityIntervalId) {
      clearInterval(connectivityIntervalId)
      connectivityIntervalId = null
    }
  })
}
