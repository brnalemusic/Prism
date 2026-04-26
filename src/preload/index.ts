import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse } from '../main/gemini'
import type { AppConfig } from '../main/config'

// Custom APIs for renderer
const api = {
  sendChatMessage: (message: string): void => ipcRenderer.send('chat-message', message),
  setModel: (modelKey: string): void => ipcRenderer.send('set-model', modelKey),
  clearChat: (): void => ipcRenderer.send('clear-chat'),
  onChatStart: (callback: () => void): void => {
    ipcRenderer.on('chat-reply-start', () => callback())
  },
  onChatChunk: (callback: (data: StructuredChatResponse) => void): void => {
    ipcRenderer.on('chat-reply-chunk', (_event, data) => callback(data))
  },
  onChatEnd: (callback: (data: StructuredChatResponse) => void): void => {
    ipcRenderer.on('chat-reply-end', (_event, data) => callback(data))
  },
  onChatError: (callback: (error: string) => void): void => {
    ipcRenderer.on('chat-reply-error', (_event, error) => callback(error))
  },
  onToolStart: (
    callback: (data: { name: string; args: Record<string, unknown> }) => void
  ): void => {
    ipcRenderer.on('chat-tool-start', (_event, data) => callback(data))
  },
  onToolEnd: (callback: (data: { name: string; result: string }) => void): void => {
    ipcRenderer.on('chat-tool-end', (_event, data) => callback(data))
  },
  onLauncherMessage: (callback: (message: string) => void): void => {
    ipcRenderer.on('launcher-message', (_event, message) => callback(message))
  },
  onLauncherFocus: (callback: () => void): void => {
    ipcRenderer.on('launcher-focus', () => callback())
  },
  onModelChanged: (callback: (modelKey: string) => void): void => {
    ipcRenderer.on('model-changed', (_event, modelKey) => callback(modelKey))
  },
  onConfigChanged: (callback: (config: AppConfig) => void): void => {
    ipcRenderer.on('config-changed', (_event, config) => callback(config))
  },
  submitLauncher: (message: string): void => ipcRenderer.send('launcher-submit', message),
  hideLauncher: (): void => ipcRenderer.send('hide-launcher'),
  minimizeApp: (): void => ipcRenderer.send('minimize-app'),
  closeApp: (): void => ipcRenderer.send('close-app'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  saveConfig: (config: AppConfig): Promise<boolean> => ipcRenderer.invoke('save-config', config),
  removeLauncherListeners: (): void => {
    ipcRenderer.removeAllListeners('launcher-message')
    ipcRenderer.removeAllListeners('launcher-focus')
  },
  removeAllChatListeners: (): void => {
    ipcRenderer.removeAllListeners('chat-reply-start')
    ipcRenderer.removeAllListeners('chat-reply-chunk')
    ipcRenderer.removeAllListeners('chat-reply-end')
    ipcRenderer.removeAllListeners('chat-reply-error')
    ipcRenderer.removeAllListeners('chat-tool-start')
    ipcRenderer.removeAllListeners('chat-tool-end')
    ipcRenderer.removeAllListeners('launcher-message')
    ipcRenderer.removeAllListeners('launcher-focus')
    ipcRenderer.removeAllListeners('model-changed')
    ipcRenderer.removeAllListeners('config-changed')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
