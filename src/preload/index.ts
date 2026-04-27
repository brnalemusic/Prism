import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse } from '../main/gemini'
import type { AppConfig } from '../main/config'

// Custom APIs for renderer
const api = {
  sendChatMessage: (message: string): void => ipcRenderer.send('chat-message', message),
  setModel: (modelKey: string): void => ipcRenderer.send('set-model', modelKey),
  clearChat: (): void => ipcRenderer.send('clear-chat'),
  cancelChat: (): void => ipcRenderer.send('chat-cancel'),
  onChatStart: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('chat-reply-start', listener)
    return () => ipcRenderer.removeListener('chat-reply-start', listener)
  },
  onChatChunk: (callback: (data: StructuredChatResponse) => void): (() => void) => {
    const listener = (_event: any, data: StructuredChatResponse): void => callback(data)
    ipcRenderer.on('chat-reply-chunk', listener)
    return () => ipcRenderer.removeListener('chat-reply-chunk', listener)
  },
  onChatEnd: (callback: (data: StructuredChatResponse) => void): (() => void) => {
    const listener = (_event: any, data: StructuredChatResponse): void => callback(data)
    ipcRenderer.on('chat-reply-end', listener)
    return () => ipcRenderer.removeListener('chat-reply-end', listener)
  },
  onChatError: (callback: (error: string) => void): (() => void) => {
    const listener = (_event: any, error: string): void => callback(error)
    ipcRenderer.on('chat-reply-error', listener)
    return () => ipcRenderer.removeListener('chat-reply-error', listener)
  },
  onToolStart: (
    callback: (data: { name: string; args: Record<string, unknown> }) => void
  ): (() => void) => {
    const listener = (_event: any, data: { name: string; args: Record<string, unknown> }): void => callback(data)
    ipcRenderer.on('chat-tool-start', listener)
    return () => ipcRenderer.removeListener('chat-tool-start', listener)
  },
  onToolEnd: (callback: (data: { name: string; result: string }) => void): (() => void) => {
    const listener = (_event: any, data: { name: string; result: string }): void => callback(data)
    ipcRenderer.on('chat-tool-end', listener)
    return () => ipcRenderer.removeListener('chat-tool-end', listener)
  },
  onLauncherMessage: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: any, message: string): void => callback(message)
    ipcRenderer.on('launcher-message', listener)
    return () => ipcRenderer.removeListener('launcher-message', listener)
  },
  onLauncherFocus: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('launcher-focus', listener)
    return () => ipcRenderer.removeListener('launcher-focus', listener)
  },
  onModelChanged: (callback: (modelKey: string) => void): (() => void) => {
    const listener = (_event: any, modelKey: string): void => callback(modelKey)
    ipcRenderer.on('model-changed', listener)
    return () => ipcRenderer.removeListener('model-changed', listener)
  },
  onConfigChanged: (callback: (config: AppConfig) => void): (() => void) => {
    const listener = (_event: any, config: AppConfig): void => callback(config)
    ipcRenderer.on('config-changed', listener)
    return () => ipcRenderer.removeListener('config-changed', listener)
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
