import { contextBridge, ipcRenderer, IpcRendererEvent, webFrame } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse, StreamingToolCall } from '../main/ai'
import type { AppConfig } from '../main/config'
import type {
  ToolUpdate,
  DownloadProgress,
  MiniAppData,
  ApplicationInfo,
  FileSearchResult,
  SessionMode,
  TodoState,
  AttachedFile
} from '../shared/types'
import type { ChatSession } from '../main/history'
import type {
  DemoDownloadResult,
  DemoInstallProgress,
  DemoOpenResult,
  DemoProcessResult,
  Dependency,
  DemoDependencyProgress
} from '../shared/demo'
import mime from 'mime-types'


// Initialize Zoom Factor
const DEFAULT_ZOOM = 1.0
let currentZoom = DEFAULT_ZOOM

try {
  const config = ipcRenderer.sendSync('get-config-sync')
  if (config && typeof config.zoomFactor === 'number') {
    currentZoom = config.zoomFactor
  } else {
    const saved = localStorage.getItem('zoom-factor')
    if (saved) {
      const parsed = parseFloat(saved)
      if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 3.0) {
        currentZoom = parsed
      }
    }
  }
} catch (e) {
  console.error('Failed to read zoom factor from config or localStorage:', e)
}

try {
  webFrame.setZoomFactor(currentZoom)
} catch (e) {
  console.error('Failed to set zoom factor:', e)
}

// Keep zoom synchronized when config changes globally
ipcRenderer.on('config-changed', (_event, config) => {
  if (config && typeof config.zoomFactor === 'number' && config.zoomFactor !== currentZoom) {
    currentZoom = config.zoomFactor
    try {
      webFrame.setZoomFactor(currentZoom)
    } catch (e) {
      console.error('Failed to update zoom factor on config change:', e)
    }
  }
})

// Keydown listener for zoom shortcuts (supports multiple layouts and numpads)
window.addEventListener('keydown', (event) => {
  const isCtrlOrCmd = event.ctrlKey || event.metaKey
  if (!isCtrlOrCmd) return

  const key = event.key
  const code = event.code
  const keyCode = event.keyCode

  const isPlus =
    key === '=' ||
    key === '+' ||
    code === 'Equal' ||
    code === 'NumpadAdd' ||
    keyCode === 187 ||
    keyCode === 107

  const isMinus =
    key === '-' ||
    key === '_' ||
    code === 'Minus' ||
    code === 'NumpadSubtract' ||
    keyCode === 109

  const isZero =
    key === '0' || code === 'Digit0' || code === 'Numpad0' || keyCode === 48 || keyCode === 96

  let changed = false
  if (isPlus) {
    currentZoom = Math.min(3.0, currentZoom + 0.05)
    changed = true
  } else if (isMinus) {
    currentZoom = Math.max(0.5, currentZoom - 0.05)
    changed = true
  } else if (isZero) {
    currentZoom = DEFAULT_ZOOM
    changed = true
  }

  if (changed) {
    event.preventDefault()
    try {
      webFrame.setZoomFactor(currentZoom)
      localStorage.setItem('zoom-factor', currentZoom.toString())

      ipcRenderer
        .invoke('get-config')
        .then((config) => {
          if (config) {
            config.zoomFactor = currentZoom
            ipcRenderer.invoke('save-config', config)
          }
        })
        .catch((err) => console.error('Failed to update config zoom factor:', err))
    } catch (e) {
      console.error('Failed to update zoom factor:', e)
    }
  }
})

// Custom APIs for renderer
const api = {
  platform: process.platform,
  getMimeType: (fileName: string): string | false => {
    return mime.lookup(fileName)
  },
  sendChatMessage: (data: {
    message: string
    chatId?: string
    screenshot?: string
    attachedFile?: AttachedFile
    quote?: string
    appMode?: string
    sessionMode?: SessionMode
    disciplinePath?: string
    modelKey?: string
    reasoningLevel?: string
  }): void => ipcRenderer.send('chat-message', data),
  setModel: (modelKey: string): void => ipcRenderer.send('set-model', modelKey),
  clearChat: (): void => ipcRenderer.send('clear-chat'),
  cancelChat: (chatId?: string): void => ipcRenderer.send('chat-cancel', chatId),
  onChatStart: (
    callback: (data: { chatId: string; userMessage?: { role: 'user'; content: string } }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { chatId: string; userMessage?: { role: 'user'; content: string } }
    ): void => callback(data)
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
      callId: string
      name: string
      args: Record<string, unknown>
      timestamp?: number
      chatId: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { callId: string; name: string; args: Record<string, unknown>; timestamp?: number; chatId: string }
    ): void => callback(data)
    ipcRenderer.on('chat-tool-start', listener)
    return () => ipcRenderer.removeListener('chat-tool-start', listener)
  },
  onToolEnd: (
    callback: (data: { callId: string; name: string; result: string; chatId: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { callId: string; name: string; result: string; chatId: string }
    ): void => callback(data)
    ipcRenderer.on('chat-tool-end', listener)
    return () => ipcRenderer.removeListener('chat-tool-end', listener)
  },
  onDiscordVoiceState: (
    callback: (data: {
      chatId: string
      state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { chatId: string; state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' }
    ): void => callback(data)
    ipcRenderer.on('discord-voice-state', listener)
    return () => ipcRenderer.removeListener('discord-voice-state', listener)
  },
  onDiscordVoiceSpeaking: (
    callback: (data: { chatId: string; speaking: boolean }) => void
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { chatId: string; speaking: boolean }): void =>
      callback(data)
    ipcRenderer.on('discord-voice-speaking', listener)
    return () => ipcRenderer.removeListener('discord-voice-speaking', listener)
  },
  onDiscordVoiceAudioLevel: (
    callback: (data: { chatId: string; level: number }) => void
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { chatId: string; level: number }): void =>
      callback(data)
    ipcRenderer.on('discord-voice-audio-level', listener)
    return () => ipcRenderer.removeListener('discord-voice-audio-level', listener)
  },
  onDiscordVoiceOutput: (callback: (data: { chatId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { chatId: string }): void => callback(data)
    ipcRenderer.on('discord-voice-output', listener)
    return () => ipcRenderer.removeListener('discord-voice-output', listener)
  },
  onToolUpdate: (callback: (data: ToolUpdate & { chatId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: ToolUpdate & { chatId: string }): void =>
      callback(data)
    ipcRenderer.on('chat-tool-update', listener)
    return () => ipcRenderer.removeListener('chat-tool-update', listener)
  },
  onDownloadProgress: (callback: (data: DownloadProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: DownloadProgress): void => callback(data)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },
  demoDownloadPrism: (): Promise<DemoDownloadResult> => ipcRenderer.invoke('demo-download-prism'),
  demoRunPrismInstaller: (): Promise<DemoProcessResult> =>
    ipcRenderer.invoke('demo-run-prism-installer'),
  demoInstallCli: (): Promise<DemoProcessResult> => ipcRenderer.invoke('demo-install-cli'),
  demoInstallDeps: (): Promise<DemoProcessResult> => ipcRenderer.invoke('demo-install-deps'),
  demoOpenPrism: (): Promise<DemoOpenResult> => ipcRenderer.invoke('demo-open-prism'),
  demoQuitApp: (): Promise<void> => ipcRenderer.invoke('demo-quit-app'),
  onDemoInstallProgress: (callback: (data: DemoInstallProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: DemoInstallProgress): void => callback(data)
    ipcRenderer.on('demo-install-progress', listener)
    return () => ipcRenderer.removeListener('demo-install-progress', listener)
  },
  demoGetPrismDependencies: (): Promise<{
    ok: boolean
    dependencies?: Dependency[]
    error?: string
  }> => ipcRenderer.invoke('demo-get-prism-dependencies'),
  demoInstallDependency: (dependencyId: string): Promise<DemoProcessResult> =>
    ipcRenderer.invoke('demo-install-dependency', dependencyId),
  onDemoDependencyProgress: (callback: (data: DemoDependencyProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: DemoDependencyProgress): void =>
      callback(data)
    ipcRenderer.on('demo-dependency-progress', listener)
    return () => ipcRenderer.removeListener('demo-dependency-progress', listener)
  },
  onLauncherMessage: (
    callback: (data: {
      message: string
      screenshot?: string
      appMode?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { message: string; screenshot?: string; appMode?: string }
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
  submitLauncher: (data: {
    message: string
    screenshot?: string
    appMode?: string
  }): void => ipcRenderer.send('launcher-submit', data),
  hideLauncher: (): void => ipcRenderer.send('hide-launcher'),
  minimizeApp: (): void => ipcRenderer.send('minimize-app'),
  maximizeApp: (): void => ipcRenderer.send('maximize-app'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('is-maximized'),
  onMaximizedChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, isMaximized: boolean): void => callback(isMaximized)
    ipcRenderer.on('window-maximized-change', listener)
    return () => ipcRenderer.removeListener('window-maximized-change', listener)
  },
  onCloseTabShortcut: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('close-tab-shortcut', listener)
    return () => ipcRenderer.removeListener('close-tab-shortcut', listener)
  },
  closeApp: (): void => ipcRenderer.send('close-app'),
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
  getMiniAppData: (): Promise<MiniAppData | null> => ipcRenderer.invoke('get-mini-app-data'),
  getAvailableTerminals: (): Promise<Array<{ id: string; name: string; path: string }>> =>
    ipcRenderer.invoke('get-available-terminals'),
  getOpenWindows: (): Promise<Array<{ id: string; name: string; thumbnail: string }>> =>
    ipcRenderer.invoke('get-open-windows'),
  captureWindow: (sourceId: string): Promise<string> =>
    ipcRenderer.invoke('capture-window', sourceId),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  saveConfig: (config: Partial<AppConfig>): Promise<boolean> => ipcRenderer.invoke('save-config', config),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  setSessionMode: (mode: SessionMode, disciplinePath?: string): void =>
    ipcRenderer.send('set-session-mode', { mode, disciplinePath }),
  getSessionMode: (): Promise<{ mode: SessionMode; disciplinePath?: string }> =>
    ipcRenderer.invoke('get-session-mode'),
  testGeminiConnection: (): Promise<{
    ok: boolean
    errorType?: 'offline' | 'invalid-key' | 'server' | 'unknown'
    message?: string
  }> => ipcRenderer.invoke('test-gemini-connection'),
  getToolDefinitions: (): Promise<any[]> => ipcRenderer.invoke('get-tool-definitions'),
  getChats: (): Promise<Omit<ChatSession, 'messages'>[]> => ipcRenderer.invoke('get-chats'),
  loadChat: (id: string): Promise<any[]> => ipcRenderer.invoke('load-chat', id),
  isChatRunning: (id: string): Promise<boolean> => ipcRenderer.invoke('is-chat-running', id),
  getChatModel: (id: string): Promise<string | undefined> => ipcRenderer.invoke('get-chat-model', id),
  deleteChat: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-chat', id),
  getRunningChats: (): Promise<string[]> => ipcRenderer.invoke('get-running-chats'),
  setThinkMode: (val: boolean): void => ipcRenderer.send('set-think-mode', val),
  setSearchEnabled: (val: boolean): void => ipcRenderer.send('set-search-enabled', val),
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
    ipcRenderer.removeAllListeners('discord-voice-state')
    ipcRenderer.removeAllListeners('discord-voice-speaking')
    ipcRenderer.removeAllListeners('discord-voice-audio-level')
    ipcRenderer.removeAllListeners('discord-voice-output')
    ipcRenderer.removeAllListeners('launcher-message')
    ipcRenderer.removeAllListeners('launcher-focus')
    ipcRenderer.removeAllListeners('model-changed')
    ipcRenderer.removeAllListeners('config-changed')
    ipcRenderer.removeAllListeners('demo-install-progress')
    ipcRenderer.removeAllListeners('think-mode-changed')
    ipcRenderer.removeAllListeners('search-enabled-changed')
    ipcRenderer.removeAllListeners('window-maximized-change')
    ipcRenderer.removeAllListeners('chat-todo-update')
    ipcRenderer.removeAllListeners('chat-todo-complete')
    ipcRenderer.removeAllListeners('browser-action')
  },

  launcherGetApps: (): Promise<ApplicationInfo[]> => ipcRenderer.invoke('launcher-get-apps'),
  forceRescanApps: (): Promise<ApplicationInfo[]> => ipcRenderer.invoke('force-rescan-apps'),
  onAppsUpdated: (callback: (apps: ApplicationInfo[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, apps: ApplicationInfo[]): void => callback(apps)
    ipcRenderer.on('launcher-apps-updated', listener)
    return () => ipcRenderer.removeListener('launcher-apps-updated', listener)
  },
  onScreenshotCaptured: (callback: (base64Image: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, base64Image: string): void => callback(base64Image)
    ipcRenderer.on('screenshot-captured', listener)
    return () => ipcRenderer.removeListener('screenshot-captured', listener)
  },
  onScreenshotShortcutTriggered: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('screenshot-shortcut-triggered', listener)
    return () => ipcRenderer.removeListener('screenshot-shortcut-triggered', listener)
  },
  launcherGetAppIcon: (appPath: string): Promise<string | null> =>
    ipcRenderer.invoke('launcher-get-app-icon', appPath),
  launcherSearchFiles: (query: string): Promise<FileSearchResult[]> =>
    ipcRenderer.invoke('launcher-search-files', query),
  launcherOpenApp: (appPath: string): Promise<string> =>
    ipcRenderer.invoke('launcher-open-app', appPath),
  launcherOpenFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('launcher-open-file', filePath),
  sendLauncherChatMessage: (data: {
    message: string
    screenshot?: string
    appMode?: string
  }): void => ipcRenderer.send('launcher-chat-message', data),
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
      streamingToolCalls?: StreamingToolCall[]
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
        streamingToolCalls?: StreamingToolCall[]
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
  onLauncherToolStart: (
    callback: (data: { callId: string; name: string; args: Record<string, unknown> }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { callId: string; name: string; args: Record<string, unknown> }
    ): void => callback(data)
    ipcRenderer.on('launcher-tool-start', listener)
    return () => ipcRenderer.removeListener('launcher-tool-start', listener)
  },
  onLauncherToolEnd: (callback: (data: { callId: string; name: string; result: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { callId: string; name: string; result: string }): void =>
      callback(data)
    ipcRenderer.on('launcher-tool-end', listener)
    return () => ipcRenderer.removeListener('launcher-tool-end', listener)
  },
  onOpenMainAppWithInstructions: (
    callback: (data: {
      instructions: string
      model: string
      searchEnabled?: boolean
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: {
        instructions: string
        model: string
        searchEnabled?: boolean
      }
    ): void => callback(data)
    ipcRenderer.on('open-main-app-with-instructions', listener)
    return () => ipcRenderer.removeListener('open-main-app-with-instructions', listener)
  },
  submitQuestionnaire: (data: {
    chatId: string
    sessionId: string
    responses: Record<string, string>
  }): void => ipcRenderer.send('submit-questionnaire', data),
  generateTts: (text: string): Promise<string> => ipcRenderer.invoke('generate-tts', text),
  transcribeAudio: (audioBase64: string): Promise<string> =>
    ipcRenderer.invoke('transcribe-audio', audioBase64),
  searchChatsOffline: (query: string): Promise<{ results: any[]; didYouMean?: string }> =>
    ipcRenderer.invoke('search-chats-offline', query),
  sendAiSearchMessage: (data: string | { message: string }): void =>
    ipcRenderer.send('ai-search-message', data),
  cancelAiSearch: (): void => {
    ipcRenderer.send('ai-search-cancel')
  },
  onAiSearchStart: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('ai-search-reply-start', listener)
    return () => ipcRenderer.removeListener('ai-search-reply-start', listener)
  },
  onAiSearchChunk: (
    callback: (data: {
      thoughts: string
      finalResponse: string
      isThinking: boolean
      isWritingToolCall?: boolean
      toolType?: 'task' | 'search'
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: {
        thoughts: string
        finalResponse: string
        isThinking: boolean
        isWritingToolCall?: boolean
        toolType?: 'task' | 'search'
      }
    ): void => callback(data)
    ipcRenderer.on('ai-search-reply-chunk', listener)
    return () => ipcRenderer.removeListener('ai-search-reply-chunk', listener)
  },
  onAiSearchEnd: (
    callback: (data: { thoughts: string; finalResponse: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { thoughts: string; finalResponse: string }
    ): void => callback(data)
    ipcRenderer.on('ai-search-reply-end', listener)
    return () => ipcRenderer.removeListener('ai-search-reply-end', listener)
  },
  onAiSearchError: (callback: (data: { error: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { error: string }): void => callback(data)
    ipcRenderer.on('ai-search-reply-error', listener)
    return () => ipcRenderer.removeListener('ai-search-reply-error', listener)
  },
  onAiSearchToolStart: (
    callback: (data: { callId: string; name: string; args: Record<string, unknown>; timestamp?: number }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { callId: string; name: string; args: Record<string, unknown>; timestamp?: number }
    ): void => callback(data)
    ipcRenderer.on('ai-search-tool-start', listener)
    return () => ipcRenderer.removeListener('ai-search-tool-start', listener)
  },
  onAiSearchToolEnd: (callback: (data: { callId: string; name: string; result: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { callId: string; name: string; result: string }): void =>
      callback(data)
    ipcRenderer.on('ai-search-tool-end', listener)
    return () => ipcRenderer.removeListener('ai-search-tool-end', listener)
  },
  getUpdaterState: (): Promise<any> => {
    return ipcRenderer.invoke('get-updater-state')
  },
  downloadUpdate: (): void => {
    ipcRenderer.send('download-update')
  },
  installUpdate: (): void => {
    ipcRenderer.send('install-update')
  },
  onUpdaterState: (callback: (state: any) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: any): void => callback(state)
    ipcRenderer.on('updater-state', listener)
    return () => ipcRenderer.removeListener('updater-state', listener)
  },
  devTriggerUpdaterUi: (level: 'patch' | 'minor' | 'major'): void => {
    ipcRenderer.send('dev-trigger-updater-ui', level)
  },
  devSimulateUpdaterProgress: (): void => {
    ipcRenderer.send('dev-simulate-updater-progress')
  },
  onConnectivityChanged: (callback: (online: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, online: boolean): void => callback(online)
    ipcRenderer.on('connectivity-changed', listener)
    return () => ipcRenderer.removeListener('connectivity-changed', listener)
  },
  onTodoUpdate: (callback: (data: TodoState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: TodoState): void => callback(data)
    ipcRenderer.on('chat-todo-update', listener)
    return () => ipcRenderer.removeListener('chat-todo-update', listener)
  },
  onTodoComplete: (callback: (data: { chatId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { chatId: string }): void => callback(data)
    ipcRenderer.on('chat-todo-complete', listener)
    return () => ipcRenderer.removeListener('chat-todo-complete', listener)
  },
  getTodoForChat: (chatId: string): Promise<TodoState | null> => {
    return ipcRenderer.invoke('get-todo-for-chat', chatId)
  },
  onArtifactsUpdate: (
    callback: (data: { chatId: string; artifacts: import('../shared/types').ArtifactItem[] }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { chatId: string; artifacts: import('../shared/types').ArtifactItem[] }
    ): void => callback(data)
    ipcRenderer.on('chat-artifacts-update', listener)
    return () => ipcRenderer.removeListener('chat-artifacts-update', listener)
  },
  getArtifactsForChat: (chatId: string): Promise<import('../shared/types').ArtifactItem[]> => {
    return ipcRenderer.invoke('get-chat-artifacts', chatId)
  },
  openArtifactFile: (filePath: string): Promise<void> => {
    return ipcRenderer.invoke('open-artifact-file', filePath)
  },
  showArtifactInFolder: (filePath: string): Promise<void> => {
    return ipcRenderer.invoke('show-artifact-in-folder', filePath)
  },
  getProviders: (): Promise<any> => {
    return ipcRenderer.invoke('get-providers')
  },
  saveProviders: (providers: any): Promise<boolean> => {
    return ipcRenderer.invoke('save-providers', providers)
  },
  deleteProvider: (providerId: string): Promise<boolean> => {
    return ipcRenderer.invoke('delete-provider', providerId)
  },
  fetchProviderModels: (params: any): Promise<any> => {
    return ipcRenderer.invoke('fetch-provider-models', params)
  },
  getActiveModels: (): Promise<any> => {
    return ipcRenderer.invoke('get-active-models')
  },
  onToolCallDelta: (callback: (delta: any) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, delta: any): void => callback(delta)
    ipcRenderer.on('chat-tool-call-delta', listener)
    return () => ipcRenderer.removeListener('chat-tool-call-delta', listener)
  },
  onBrowserAction: (callback: (action: import('../shared/types').BrowserAction) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, action: import('../shared/types').BrowserAction): void =>
      callback(action)
    ipcRenderer.on('browser-action', listener)
    return () => ipcRenderer.removeListener('browser-action', listener)
  },
  onBrowserExecCommand: (callback: (data: { requestId: string; command: any }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { requestId: string; command: any }): void =>
      callback(data)
    ipcRenderer.on('browser-exec-command', listener)
    return () => ipcRenderer.removeListener('browser-exec-command', listener)
  },
  sendBrowserExecResult: (requestId: string, result: any): void => {
    ipcRenderer.send('browser-exec-result', { requestId, result })
  },
  openBrowser: (url?: string): Promise<string> => ipcRenderer.invoke('open-browser', url),
  openExternalUrl: (url: string): Promise<import('../shared/types').OpenExternalUrlResult> =>
    ipcRenderer.invoke('open-external-url', url),
  closeBrowser: (): Promise<string> => ipcRenderer.invoke('close-browser'),
  resetBrowserIdle: (): void => ipcRenderer.send('reset-browser-idle'),
  activateLicense: (key: string): Promise<import('../shared/types').ActivationResult> =>
    ipcRenderer.invoke('activate-license', key),
  deactivateLicense: (): Promise<boolean> => ipcRenderer.invoke('deactivate-license'),
  getLicenseInfo: (): Promise<import('../shared/types').LicenseInfo | null> =>
    ipcRenderer.invoke('get-license-info'),
  authLogin: (data: import('../shared/types').LoginData): Promise<import('../shared/types').AuthResponse> =>
    ipcRenderer.invoke('auth-login', data),
  authSignUp: (data: import('../shared/types').SignUpData): Promise<import('../shared/types').AuthResponse> =>
    ipcRenderer.invoke('auth-signup', data),
  authLogout: (): Promise<boolean> => ipcRenderer.invoke('auth-logout'),
  getAuthUser: (): Promise<import('../shared/types').UserProfile | null> =>
    ipcRenderer.invoke('auth-get-user'),
  authResetPassword: (email: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('auth-reset-password', email),
  authUpdateProfile: (
    updates: Partial<import('../shared/types').UserProfile>
  ): Promise<import('../shared/types').AuthResponse> => ipcRenderer.invoke('auth-update-profile', updates),
  getUserAiUsage: (): Promise<import('../shared/types').UserAiUsageStatus | null> =>
    ipcRenderer.invoke('auth-get-ai-usage'),
  authResendConfirmation: (email: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('auth-resend-confirmation', email),
  authRequestDeleteAccountEmail: (email: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('auth-request-delete-email', email),
  authConfirmDeleteAccount: (otpCode: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('auth-confirm-delete-account', otpCode),
  authConfirmDeleteAccountWithPassword: (password: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('auth-confirm-delete-password', password),
  onAuthSessionUpdated: (
    callback: (user: import('../shared/types').UserProfile | null) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      user: import('../shared/types').UserProfile | null
    ): void => callback(user)
    ipcRenderer.on('auth-session-updated', listener)
    return () => ipcRenderer.removeListener('auth-session-updated', listener)
  },
  getSubscriptionPlans: (): Promise<import('../shared/types').SubscriptionPlan[]> =>
    ipcRenderer.invoke('get-subscription-plans'),
  createCheckoutSession: (
    planId: string,
    email?: string
  ): Promise<import('../shared/types').CheckoutSessionResult> =>
    ipcRenderer.invoke('create-checkout-session', planId, email),
  verifyAndActivatePayment: (
    planId: string,
    sessionId: string,
    email: string,
    company?: string
  ): Promise<import('../shared/types').PaymentVerificationResult> =>
    ipcRenderer.invoke('verify-and-activate-payment', planId, sessionId, email, company)
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
