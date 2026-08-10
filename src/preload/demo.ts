import { contextBridge, ipcRenderer, type IpcRendererEvent, webFrame } from 'electron'
import type { AppConfig } from '../main/config'
import type {
  DemoDependencyProgress,
  DemoDownloadResult,
  DemoInstallProgress,
  DemoOpenResult,
  DemoProcessResult,
  Dependency
} from '../shared/demo'
import type { DownloadProgress } from '../shared/types'

const DEFAULT_ZOOM = 1
let currentZoom = DEFAULT_ZOOM

try {
  const config = ipcRenderer.sendSync('get-config-sync') as AppConfig | undefined
  if (typeof config?.zoomFactor === 'number') currentZoom = config.zoomFactor
  webFrame.setZoomFactor(currentZoom)
} catch (err) {
  console.error('[Demo] Failed to initialize zoom:', err)
}

ipcRenderer.on('config-changed', (_event, config: AppConfig) => {
  if (typeof config.zoomFactor !== 'number' || config.zoomFactor === currentZoom) return
  currentZoom = config.zoomFactor
  webFrame.setZoomFactor(currentZoom)
})

window.addEventListener('keydown', (event) => {
  if (!event.ctrlKey && !event.metaKey) return

  const isPlus = ['=', '+'].includes(event.key) || ['Equal', 'NumpadAdd'].includes(event.code)
  const isMinus = ['-', '_'].includes(event.key) || ['Minus', 'NumpadSubtract'].includes(event.code)
  const isReset = event.key === '0' || ['Digit0', 'Numpad0'].includes(event.code)
  if (!isPlus && !isMinus && !isReset) return

  event.preventDefault()
  currentZoom = isReset
    ? DEFAULT_ZOOM
    : isPlus
      ? Math.min(3, currentZoom + 0.05)
      : Math.max(0.5, currentZoom - 0.05)
  webFrame.setZoomFactor(currentZoom)
  void ipcRenderer
    .invoke('save-config', { zoomFactor: currentZoom })
    .catch((err) => console.error('[Demo] Failed to persist zoom:', err))
})

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  minimizeApp: (): void => ipcRenderer.send('minimize-app'),
  maximizeApp: (): void => ipcRenderer.send('maximize-app'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('is-maximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) =>
    subscribe('window-maximized-change', callback),
  closeApp: (): void => ipcRenderer.send('close-app'),
  demoDownloadPrism: (): Promise<DemoDownloadResult> => ipcRenderer.invoke('demo-download-prism'),
  demoRunPrismInstaller: (): Promise<DemoProcessResult> =>
    ipcRenderer.invoke('demo-run-prism-installer'),
  demoInstallCli: (): Promise<DemoProcessResult> => ipcRenderer.invoke('demo-install-cli'),
  demoOpenPrism: (): Promise<DemoOpenResult> => ipcRenderer.invoke('demo-open-prism'),
  demoQuitApp: (): Promise<void> => ipcRenderer.invoke('demo-quit-app'),
  demoGetPrismDependencies: (): Promise<{
    ok: boolean
    dependencies?: Dependency[]
    error?: string
  }> => ipcRenderer.invoke('demo-get-prism-dependencies'),
  demoInstallDependency: (dependencyId: string): Promise<DemoProcessResult> =>
    ipcRenderer.invoke('demo-install-dependency', dependencyId),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) =>
    subscribe('download-progress', callback),
  onDemoInstallProgress: (callback: (progress: DemoInstallProgress) => void): (() => void) =>
    subscribe('demo-install-progress', callback),
  onDemoDependencyProgress: (
    callback: (progress: DemoDependencyProgress) => void
  ): (() => void) => subscribe('demo-dependency-progress', callback)
}

contextBridge.exposeInMainWorld('api', api)
