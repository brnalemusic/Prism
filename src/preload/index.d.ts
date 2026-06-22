import { ElectronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse } from '../main/gemini'
import type { AppConfig } from '../main/config'
import type { ChatSession } from '../main/history'
import type { Content } from '@google/genai'
import type {
  SubagentMessage,
  MiniAppData,
  ToolUpdate,
  DownloadProgress,
  ApplicationInfo,
  FileSearchResult
} from '../shared/types'
import type {
  DemoDownloadResult,
  DemoInstallProgress,
  DemoOpenResult,
  DemoProcessResult,
  Dependency,
  DemoDependencyProgress
} from '../shared/demo'

export interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

export interface PrismAPI {
  platform: string
  getMimeType: (fileName: string) => string | false
  sendChatMessage: (data: {
    message: string
    thinkMode?: boolean
    chatId?: string
    screenshot?: string
    attachedFile?: AttachedFile
    quote?: string
    appMode?: string
  }) => void
  setModel: (modelKey: string) => void
  clearChat: () => void
  cancelChat: (chatId?: string) => void
  onChatStart: (callback: (data: { chatId: string }) => void) => () => void

  onChatChunk: (callback: (data: StructuredChatResponse & { chatId: string }) => void) => () => void
  onChatEnd: (callback: (data: StructuredChatResponse & { chatId: string }) => void) => () => void
  onChatError: (callback: (data: { error: string; chatId: string }) => void) => () => void
  onToolStart: (
    callback: (data: {
      name: string
      args: Record<string, unknown>
      timestamp?: number
      chatId: string
    }) => void
  ) => () => void
  onToolEnd: (
    callback: (data: { name: string; result: string; chatId: string }) => void
  ) => () => void
  onToolUpdate: (callback: (data: ToolUpdate & { chatId: string }) => void) => () => void
  onDownloadProgress: (callback: (data: DownloadProgress) => void) => () => void
  demoDownloadPrism: () => Promise<DemoDownloadResult>
  demoRunPrismInstaller: (setupPath: string) => Promise<DemoProcessResult>
  demoInstallCli: () => Promise<DemoProcessResult>
  demoInstallDeps: () => Promise<DemoProcessResult>
  demoOpenPrism: () => Promise<DemoOpenResult>
  demoQuitApp: () => Promise<void>
  onDemoInstallProgress: (callback: (data: DemoInstallProgress) => void) => () => void
  demoGetPrismDependencies: () => Promise<{
    ok: boolean
    dependencies?: Dependency[]
    error?: string
  }>
  demoInstallDependency: (dependency: Dependency) => Promise<DemoProcessResult>
  onDemoDependencyProgress: (callback: (data: DemoDependencyProgress) => void) => () => void
  onLauncherMessage: (
    callback: (data: {
      message: string
      thinkMode?: boolean
      screenshot?: string
      appMode?: string
    }) => void
  ) => () => void
  onLauncherFocus: (callback: () => void) => () => void
  onModelChanged: (callback: (modelKey: string) => void) => () => void
  onChatFallbackActivated: (
    callback: (data: { chatId: string; previousModel: string; newModel: string }) => void
  ) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  onChatSessionCreated: (callback: (data: { id: string }) => void) => () => void
  onChatTitleReceived: (callback: (data: { id: string; title: string }) => void) => () => void
  onSubagentMessage: (callback: (data: SubagentMessage) => void) => () => void
  submitLauncher: (data: {
    message: string
    thinkMode?: boolean
    screenshot?: string
    appMode?: string
  }) => void
  hideLauncher: () => void
  minimizeApp: () => void
  maximizeApp: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
  minimizeSubagentsWindow: () => void
  openSubagentsWindow: (initialMessages?: SubagentMessage[]) => void
  openSubagentSettingsWindow: () => void
  broadcastSubagentMessage: (data: SubagentMessage) => void
  closeApp: () => void
  closeSubagentsWindow: () => void
  closeSubagentSettingsWindow: () => void
  openMiniAppWindow: (data: MiniAppData) => void
  closeMiniAppWindow: (id: string) => void
  minimizeMiniAppWindow: (id: string) => void
  onMiniAppData: (callback: (data: MiniAppData) => void) => () => void
  onMiniAppWindowClosed: (callback: (id: string) => void) => () => void
  getMiniAppData: () => Promise<MiniAppData | null>
  getAvailableTerminals: () => Promise<Array<{ id: string; name: string; path: string }>>
  getOpenWindows: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>
  captureWindow: (sourceId: string) => Promise<string>
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<boolean>
  getToolDefinitions: () => Promise<any[]>
  getChats: () => Promise<Omit<ChatSession, 'messages'>[]>
  loadChat: (id: string) => Promise<Content[]>
  deleteChat: (id: string) => Promise<boolean>
  getRunningChats: () => Promise<string[]>
  setThinkMode: (val: boolean) => void
  setSearchEnabled: (val: boolean) => void
  onThinkModeChanged: (callback: (val: boolean) => void) => () => void
  onSearchEnabledChanged: (callback: (val: boolean) => void) => () => void
  removeLauncherListeners: () => void
  removeAllChatListeners: () => void
  launcherGetApps: () => Promise<ApplicationInfo[]>
  onAppsUpdated: (callback: (apps: ApplicationInfo[]) => void) => () => void
  onScreenshotCaptured: (callback: (base64Image: string) => void) => () => void
  onScreenshotShortcutTriggered: (callback: () => void) => () => void
  launcherGetAppIcon: (appPath: string) => Promise<string | null>
  launcherSearchFiles: (query: string) => Promise<FileSearchResult[]>
  launcherOpenApp: (appPath: string) => Promise<string>
  launcherOpenFile: (filePath: string) => Promise<string>
  sendLauncherChatMessage: (data: {
    message: string
    thinkMode?: boolean
    screenshot?: string
    appMode?: string
  }) => void
  clearLauncherChat: () => void
  onLauncherReplyStart: (callback: () => void) => () => void
  onLauncherReplyChunk: (
    callback: (data: {
      thoughts: string
      finalResponse: string
      isThinking: boolean
      isWritingToolCall?: boolean
      toolType?: 'task' | 'search' | 'mini-app'
    }) => void
  ) => () => void
  onLauncherReplyEnd: (
    callback: (data: { thoughts: string; finalResponse: string }) => void
  ) => () => void
  onLauncherReplyError: (callback: (data: { error: string }) => void) => () => void
  onLauncherToolStart: (
    callback: (data: { name: string; args: Record<string, unknown> }) => void
  ) => () => void
  onLauncherToolEnd: (callback: (data: { name: string; result: string }) => void) => () => void
  onOpenMainAppWithInstructions: (
    callback: (data: {
      instructions: string
      model: string
      thinkMode?: boolean
      searchEnabled?: boolean
    }) => void
  ) => () => void
  submitQuestionnaire: (data: {
    chatId: string
    sessionId: string
    responses: Record<string, string>
  }) => void
  generateTts: (text: string) => Promise<string>
  transcribeAudio: (audioBase64: string) => Promise<string>
  searchChatsOffline: (query: string) => Promise<{ results: any[]; didYouMean?: string }>
  sendAiSearchMessage: (data: string | { message: string }) => void
  cancelAiSearch: () => void
  onAiSearchStart: (callback: () => void) => () => void
  onAiSearchChunk: (
    callback: (data: {
      thoughts: string
      finalResponse: string
      isThinking: boolean
      isWritingToolCall?: boolean
      toolType?: 'task' | 'search'
    }) => void
  ) => () => void
  onAiSearchEnd: (
    callback: (data: { thoughts: string; finalResponse: string }) => void
  ) => () => void
  onAiSearchError: (callback: (data: { error: string }) => void) => () => void
  onAiSearchToolStart: (
    callback: (data: { name: string; args: Record<string, unknown>; timestamp?: number }) => void
  ) => () => void
  onAiSearchToolEnd: (callback: (data: { name: string; result: string }) => void) => () => void
  getUpdaterState: () => Promise<any>
  downloadUpdate: () => void
  installUpdate: () => void
  onUpdaterState: (callback: (state: any) => void) => () => void
  devTriggerUpdaterUi?: (level: 'patch' | 'minor' | 'major') => void
  devSimulateUpdaterProgress?: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PrismAPI
  }
}
