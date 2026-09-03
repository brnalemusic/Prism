import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { dirname, join } from 'path'
import fs from 'fs'
import os from 'os'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { registerDemoDownloadHandlers } from './demoDownload'
import { safeSend } from './safeSend'
import { installProcessOutputGuards } from './brokenPipeGuard'

installProcessOutputGuards()

const WINDOW_STATE_FILE = join(
  process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'),
  'PrismDemo',
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
  width: 1080,
  height: 700,
  isMaximized: false
}

let currentConfig: AppConfig
let mainWindow: BrowserWindow | null = null

function isWindowStateVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true

  return screen.getAllDisplays().some(({ bounds }) => {
    return (
      state.x! >= bounds.x &&
      state.x! < bounds.x + bounds.width &&
      state.y! >= bounds.y &&
      state.y! < bounds.y + bounds.height
    )
  })
}

function isValidWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<WindowState>
  return (
    typeof state.width === 'number' &&
    Number.isFinite(state.width) &&
    state.width >= 800 &&
    typeof state.height === 'number' &&
    Number.isFinite(state.height) &&
    state.height >= 600 &&
    typeof state.isMaximized === 'boolean' &&
    (state.x === undefined || (typeof state.x === 'number' && Number.isFinite(state.x))) &&
    (state.y === undefined || (typeof state.y === 'number' && Number.isFinite(state.y)))
  )
}

function loadWindowState(): WindowState {
  try {
    if (!fs.existsSync(WINDOW_STATE_FILE)) return DEFAULT_WINDOW_STATE
    const candidate: unknown = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'))
    return isValidWindowState(candidate) && isWindowStateVisible(candidate)
      ? candidate
      : DEFAULT_WINDOW_STATE
  } catch (err) {
    console.error('[Demo] Failed to load window state:', err)
    return DEFAULT_WINDOW_STATE
  }
}

function saveWindowState(state: WindowState): void {
  try {
    fs.mkdirSync(dirname(WINDOW_STATE_FILE), { recursive: true })
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[Demo] Failed to save window state:', err)
  }
}

function getIconPath(): string {
  const configuredTheme = currentConfig.theme || 'marine'
  const theme =
    configuredTheme === 'rgb' &&
    !(currentConfig.rgbThemeExpiry && Date.now() < currentConfig.rgbThemeExpiry)
      ? 'marine'
      : configuredTheme
  const extension = process.platform === 'win32' ? 'ico' : 'png'
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icons', `prism-${theme}.${extension}`)
    : join(__dirname, '../../resources/icons', `prism-${theme}.${extension}`)
}

function registerWindowHandlers(): void {
  ipcMain.on('minimize-app', () => mainWindow?.minimize())
  ipcMain.handle('is-maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.on('maximize-app', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('close-app', () => app.quit())

  const getRendererConfig = (): Pick<AppConfig, 'theme' | 'zoomFactor'> & {
    username: string
    appVersion: string
  } => ({
    theme: currentConfig.theme,
    zoomFactor: currentConfig.zoomFactor,
    username: os.userInfo().username,
    appVersion: app.getVersion()
  })

  ipcMain.handle('get-config', getRendererConfig)
  ipcMain.on('get-config-sync', (event) => {
    event.returnValue = getRendererConfig()
  })
  ipcMain.handle('save-config', (_event, config: Partial<AppConfig>) => {
    const zoomFactor = config.zoomFactor
    if (typeof zoomFactor !== 'number' || zoomFactor < 0.5 || zoomFactor > 3) return false

    const saved = saveConfig({ zoomFactor }, currentConfig)
    if (saved) {
      currentConfig = loadConfig()
      safeSend(mainWindow, 'config-changed', currentConfig)
    }
    return saved
  })
}

function createWindow(): void {
  const windowState = loadWindowState()
  let normalBounds = {
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y
  }

  mainWindow = new BrowserWindow({
    ...normalBounds,
    minWidth: 800,
    minHeight: 600,
    show: true,
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'win32' ? undefined : 'hidden',
    backgroundColor: '#0b0c0f',
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  if (windowState.isMaximized) mainWindow.maximize()

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      normalBounds = mainWindow.getBounds()
    }
  })
  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      normalBounds = mainWindow.getBounds()
    }
  })
  mainWindow.on('maximize', () => safeSend(mainWindow, 'window-maximized-change', true))
  mainWindow.on('unmaximize', () => safeSend(mainWindow, 'window-maximized-change', false))
  mainWindow.on('close', () => {
    if (!mainWindow) return
    saveWindowState({ ...normalBounds, isMaximized: mainWindow.isMaximized() })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'http:' || target.protocol === 'https:') {
        void shell.openExternal(url)
      }
    } catch (err) {
      console.warn('[Demo] Blocked malformed external URL:', url, err)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const target = new URL(targetUrl)
      const devOrigin = process.env['ELECTRON_RENDERER_URL']
        ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
        : null
      const trusted = is.dev ? target.origin === devOrigin : target.protocol === 'file:'
      if (!trusted) event.preventDefault()
    } catch (err) {
      event.preventDefault()
      console.warn('[Demo] Blocked invalid renderer navigation:', targetUrl, err)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.prism.demo.app')
    currentConfig = loadConfig()
    registerWindowHandlers()
    registerDemoDownloadHandlers()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window, { zoom: true })
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
