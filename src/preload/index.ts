import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse } from '../main/gemini'
import type { AppConfig } from '../main/config'
import type { ToolUpdate, SubagentMessage, MiniAppData } from '../shared/types'
import type { ChatSession } from '../main/history'
import type { Content } from '@google/genai'

// Custom APIs for renderer
const api = {
  sendChatMessage: (data: {
    message: string
    thinkMode?: boolean
    chatId?: string
    extendedSearch?: boolean
  }): void => ipcRenderer.send('chat-message', data),
  setModel: (modelKey: string): void => ipcRenderer.send('set-model', modelKey),
  clearChat: (): void => ipcRenderer.send('clear-chat'),
  cancelChat: (chatId?: string): void => ipcRenderer.send('chat-cancel', chatId),
  onChatStart: (callback: (data: { chatId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { chatId: string }): void => callback(data)
    ipcRenderer.on('chat-reply-start', listener)
    return () => ipcRenderer.removeListener('chat-reply-start', listener)
  },
  onChatChunk: (
    callback: (data: StructuredChatResponse & { chatId: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: StructuredChatResponse & { chatId: string }
    ): void => callback(data)
    ipcRenderer.on('chat-reply-chunk', listener)
    return () => ipcRenderer.removeListener('chat-reply-chunk', listener)
  },
  onChatEnd: (
    callback: (data: StructuredChatResponse & { chatId: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: StructuredChatResponse & { chatId: string }
    ): void => callback(data)
    ipcRenderer.on('chat-reply-end', listener)
    return () => ipcRenderer.removeListener('chat-reply-end', listener)
  },
  onChatError: (callback: (data: { error: string; chatId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { error: string; chatId: string }): void =>
      callback(data)
    ipcRenderer.on('chat-reply-error', listener)
    return () => ipcRenderer.removeListener('chat-reply-error', listener)
  },
  onToolStart: (
    callback: (data: {
      name: string
      args: Record<string, unknown>
      timestamp?: number
      chatId: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { name: string; args: Record<string, unknown>; timestamp?: number; chatId: string }
    ): void => callback(data)
    ipcRenderer.on('chat-tool-start', listener)
    return () => ipcRenderer.removeListener('chat-tool-start', listener)
  },
  onToolEnd: (
    callback: (data: { name: string; result: string; chatId: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { name: string; result: string; chatId: string }
    ): void => callback(data)
    ipcRenderer.on('chat-tool-end', listener)
    return () => ipcRenderer.removeListener('chat-tool-end', listener)
  },
  onToolUpdate: (callback: (data: ToolUpdate & { chatId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: ToolUpdate & { chatId: string }): void =>
      callback(data)
    ipcRenderer.on('chat-tool-update', listener)
    return () => ipcRenderer.removeListener('chat-tool-update', listener)
  },
  onLauncherMessage: (
    callback: (data: { message: string; thinkMode?: boolean }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { message: string; thinkMode?: boolean }
    ): void => callback(data)
    ipcRenderer.on('launcher-message', listener)
    return () => ipcRenderer.removeListener('launcher-message', listener)
  },
  onLauncherFocus: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('launcher-focus', listener)
    return () => ipcRenderer.removeListener('launcher-focus', listener)
  },
  onModelChanged: (callback: (modelKey: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, modelKey: string): void => callback(modelKey)
    ipcRenderer.on('model-changed', listener)
    return () => ipcRenderer.removeListener('model-changed', listener)
  },
  onConfigChanged: (callback: (config: AppConfig) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, config: AppConfig): void => callback(config)
    ipcRenderer.on('config-changed', listener)
    return () => ipcRenderer.removeListener('config-changed', listener)
  },
  onChatSessionCreated: (callback: (data: { id: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { id: string }): void => callback(data)
    ipcRenderer.on('chat-session-created', listener)
    return () => ipcRenderer.removeListener('chat-session-created', listener)
  },
  onChatTitleReceived: (callback: (data: { id: string; title: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { id: string; title: string }): void =>
      callback(data)
    ipcRenderer.on('chat-title-received', listener)
    return () => ipcRenderer.removeListener('chat-title-received', listener)
  },
  onSubagentMessage: (callback: (data: SubagentMessage) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: SubagentMessage): void => callback(data)
    ipcRenderer.on('subagent-message', listener)
    return () => ipcRenderer.removeListener('subagent-message', listener)
  },
  submitLauncher: (data: { message: string; thinkMode?: boolean }): void =>
    ipcRenderer.send('launcher-submit', data),
  hideLauncher: (): void => ipcRenderer.send('hide-launcher'),
  minimizeApp: (): void => ipcRenderer.send('minimize-app'),
  minimizeSubagentsWindow: (): void => ipcRenderer.send('minimize-subagents-window'),
  openSubagentsWindow: (initialMessages?: SubagentMessage[]): void =>
    ipcRenderer.send('open-subagents-window', initialMessages),
  openSubagentSettingsWindow: (): void => ipcRenderer.send('open-subagent-settings-window'),
  broadcastSubagentMessage: (data: SubagentMessage): void =>
    ipcRenderer.send('subagent-message-broadcast', data),
  closeApp: (): void => ipcRenderer.send('close-app'),
  closeSubagentsWindow: (): void => ipcRenderer.send('close-subagents-window'),
  closeSubagentSettingsWindow: (): void => ipcRenderer.send('close-subagent-settings-window'),
  openMiniAppWindow: (data: MiniAppData): void => ipcRenderer.send('open-mini-app-window', data),
  closeMiniAppWindow: (id: string): void => ipcRenderer.send('close-mini-app-window', id),
  minimizeMiniAppWindow: (id: string): void => ipcRenderer.send('minimize-mini-app-window', id),
  onMiniAppData: (callback: (data: MiniAppData) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: MiniAppData): void => callback(data)
    ipcRenderer.on('mini-app-data', listener)
    return () => ipcRenderer.removeListener('mini-app-data', listener)
  },
  onMiniAppWindowClosed: (callback: (id: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('mini-app-window-closed', listener)
    return () => ipcRenderer.removeListener('mini-app-window-closed', listener)
  },
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  saveConfig: (config: AppConfig): Promise<boolean> => ipcRenderer.invoke('save-config', config),
  getChats: (): Promise<Omit<ChatSession, 'messages'>[]> => ipcRenderer.invoke('get-chats'),
  loadChat: (id: string): Promise<Content[]> => ipcRenderer.invoke('load-chat', id),
  deleteChat: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-chat', id),
  getRunningChats: (): Promise<string[]> => ipcRenderer.invoke('get-running-chats'),
  setThinkMode: (val: boolean): void => ipcRenderer.send('set-think-mode', val),
  setSearchEnabled: (val: boolean): void => ipcRenderer.send('set-search-enabled', val),
  setExtendedSearch: (val: boolean): void => ipcRenderer.send('set-extended-search', val),
  onThinkModeChanged: (callback: (val: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, val: boolean): void => callback(val)
    ipcRenderer.on('think-mode-changed', listener)
    return () => ipcRenderer.removeListener('think-mode-changed', listener)
  },
  onSearchEnabledChanged: (callback: (val: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, val: boolean): void => callback(val)
    ipcRenderer.on('search-enabled-changed', listener)
    return () => ipcRenderer.removeListener('search-enabled-changed', listener)
  },
  onExtendedSearchChanged: (callback: (val: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, val: boolean): void => callback(val)
    ipcRenderer.on('extended-search-changed', listener)
    return () => ipcRenderer.removeListener('extended-search-changed', listener)
  },
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
    ipcRenderer.removeAllListeners('chat-tool-update')
    ipcRenderer.removeAllListeners('launcher-message')
    ipcRenderer.removeAllListeners('launcher-focus')
    ipcRenderer.removeAllListeners('model-changed')
    ipcRenderer.removeAllListeners('config-changed')
    ipcRenderer.removeAllListeners('think-mode-changed')
    ipcRenderer.removeAllListeners('search-enabled-changed')
    ipcRenderer.removeAllListeners('extended-search-changed')
  },
  launcherGetApps: (): Promise<any[]> => ipcRenderer.invoke('launcher-get-apps'),
  onAppsUpdated: (callback: (apps: any[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, apps: any[]): void => callback(apps)
    ipcRenderer.on('launcher-apps-updated', listener)
    return () => ipcRenderer.removeListener('launcher-apps-updated', listener)
  },
  launcherGetAppIcon: (appPath: string): Promise<string | null> =>
    ipcRenderer.invoke('launcher-get-app-icon', appPath),
  launcherSearchFiles: (query: string): Promise<any[]> =>
    ipcRenderer.invoke('launcher-search-files', query),
  launcherOpenApp: (appPath: string): Promise<string> =>
    ipcRenderer.invoke('launcher-open-app', appPath),
  launcherOpenFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('launcher-open-file', filePath),
  sendLauncherChatMessage: (data: { message: string; thinkMode?: boolean }): void =>
    ipcRenderer.send('launcher-chat-message', data),
  clearLauncherChat: (): void => ipcRenderer.send('launcher-chat-clear'),
  onLauncherReplyStart: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('launcher-reply-start', listener)
    return () => ipcRenderer.removeListener('launcher-reply-start', listener)
  },
  onLauncherReplyChunk: (
    callback: (data: {
      thoughts: string
      finalResponse: string
      isThinking: boolean
      isWritingToolCall?: boolean
      toolType?: 'task' | 'search' | 'mini-app'
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: {
        thoughts: string
        finalResponse: string
        isThinking: boolean
        isWritingToolCall?: boolean
        toolType?: 'task' | 'search' | 'mini-app'
      }
    ): void => callback(data)
    ipcRenderer.on('launcher-reply-chunk', listener)
    return () => ipcRenderer.removeListener('launcher-reply-chunk', listener)
  },
  onLauncherReplyEnd: (
    callback: (data: { thoughts: string; finalResponse: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { thoughts: string; finalResponse: string }
    ): void => callback(data)
    ipcRenderer.on('launcher-reply-end', listener)
    return () => ipcRenderer.removeListener('launcher-reply-end', listener)
  },
  onLauncherReplyError: (callback: (data: { error: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { error: string }): void => callback(data)
    ipcRenderer.on('launcher-reply-error', listener)
    return () => ipcRenderer.removeListener('launcher-reply-error', listener)
  },
  onLauncherToolStart: (callback: (data: { name: string; args: any }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { name: string; args: any }): void =>
      callback(data)
    ipcRenderer.on('launcher-tool-start', listener)
    return () => ipcRenderer.removeListener('launcher-tool-start', listener)
  },
  onLauncherToolEnd: (callback: (data: { name: string; result: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { name: string; result: string }): void =>
      callback(data)
    ipcRenderer.on('launcher-tool-end', listener)
    return () => ipcRenderer.removeListener('launcher-tool-end', listener)
  },
  onOpenMainAppWithInstructions: (
    callback: (data: {
      instructions: string
      model: string
      thinkMode?: boolean
      searchEnabled?: boolean
      extendedSearch?: boolean
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: {
        instructions: string
        model: string
        thinkMode?: boolean
        searchEnabled?: boolean
        extendedSearch?: boolean
      }
    ): void => callback(data)
    ipcRenderer.on('open-main-app-with-instructions', listener)
    return () => ipcRenderer.removeListener('open-main-app-with-instructions', listener)
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
