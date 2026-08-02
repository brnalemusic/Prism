import { ElectronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse, StreamingToolCall } from '../main/gemini'
import type { AppConfig } from '../main/config'
import type { ChatSession } from '../main/history'
import type { Content } from '@google/genai'
import type {
  MiniAppData,
  ToolUpdate,
  DownloadProgress,
  ApplicationInfo,
  FileSearchResult,
  SessionMode,
  TodoState
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
    chatId?: string
    screenshot?: string
    attachedFile?: AttachedFile
    quote?: string
    appMode?: string
    sessionMode?: SessionMode
    disciplinePath?: string
    modelKey?: string
    reasoningLevel?: string
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
      screenshot?: string
      appMode?: string
    }) => void
  ) => () => void
  onLauncherFocus: (callback: () => void) => () => void
  onModelChanged: (callback: (modelKey: string) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  onChatSessionCreated: (callback: (data: { id: string }) => void) => () => void
  onChatTitleReceived: (callback: (data: { id: string; title: string }) => void) => () => void
  submitLauncher: (data: {
    message: string
    screenshot?: string
    appMode?: string
  }) => void
  hideLauncher: () => void
  minimizeApp: () => void
  maximizeApp: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
  onCloseTabShortcut: (callback: () => void) => () => void
  closeApp: () => void
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
  saveConfig: (config: Partial<AppConfig>) => Promise<boolean>
  selectFolder: () => Promise<string | null>
  setSessionMode: (mode: SessionMode, disciplinePath?: string) => void
  getSessionMode: () => Promise<{ mode: SessionMode; disciplinePath?: string }>
  testGeminiConnection: () => Promise<{
    ok: boolean
    errorType?: 'offline' | 'invalid-key' | 'server' | 'unknown'
    message?: string
  }>
  getToolDefinitions: () => Promise<any[]>
  getChats: () => Promise<Omit<ChatSession, 'messages'>[]>
  loadChat: (id: string) => Promise<any[]>
  getChatModel: (id: string) => Promise<string | undefined>
  deleteChat: (id: string) => Promise<boolean>
  getRunningChats: () => Promise<string[]>
  setThinkMode: (val: boolean) => void
  setSearchEnabled: (val: boolean) => void
  onThinkModeChanged: (callback: (val: boolean) => void) => () => void
  onSearchEnabledChanged: (callback: (val: boolean) => void) => () => void
  removeLauncherListeners: () => void
  removeAllChatListeners: () => void
  launcherGetApps: () => Promise<ApplicationInfo[]>
  forceRescanApps: () => Promise<ApplicationInfo[]>
  onAppsUpdated: (callback: (apps: ApplicationInfo[]) => void) => () => void
  onScreenshotCaptured: (callback: (base64Image: string) => void) => () => void
  onScreenshotShortcutTriggered: (callback: () => void) => () => void
  launcherGetAppIcon: (appPath: string) => Promise<string | null>
  launcherSearchFiles: (query: string) => Promise<FileSearchResult[]>
  launcherOpenApp: (appPath: string) => Promise<string>
  launcherOpenFile: (filePath: string) => Promise<string>
  sendLauncherChatMessage: (data: {
    message: string
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
      streamingToolCalls?: StreamingToolCall[]
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
  onConnectivityChanged: (callback: (online: boolean) => void) => () => void
  onTodoUpdate: (callback: (data: TodoState) => void) => () => void
  onTodoComplete: (callback: (data: { chatId: string }) => void) => () => void
  getTodoForChat: (chatId: string) => Promise<TodoState | null>
  onArtifactsUpdate: (callback: (data: { chatId: string; artifacts: import('../shared/types').ArtifactItem[] }) => void) => () => void
  getArtifactsForChat: (chatId: string) => Promise<import('../shared/types').ArtifactItem[]>
  openArtifactFile: (filePath: string) => Promise<void>
  showArtifactInFolder: (filePath: string) => Promise<void>
  getProviders: () => Promise<import('../shared/types').ProviderConfig[]>
  saveProviders: (providers: import('../shared/types').ProviderConfig[]) => Promise<boolean>
  deleteProvider: (providerId: string) => Promise<boolean>
  fetchProviderModels: (params: { baseUrl: string; apiKey: string; completionType: import('../shared/types').CompletionType }) => Promise<{ success: boolean; models: import('../shared/types').ProviderModel[]; error?: string }>
  getActiveModels: () => Promise<Array<{ providerId: string; providerName: string; isProviderTrusted: boolean; model: import('../shared/types').ProviderModel; fullKey: string }>>
  onToolCallDelta: (callback: (delta: import('../shared/types').StreamToolCallDelta & { chatId: string }) => void) => () => void
  onBrowserAction: (callback: (action: import('../shared/types').BrowserAction) => void) => () => void
  onBrowserExecCommand: (callback: (data: { requestId: string; command: any }) => void) => () => void
  sendBrowserExecResult: (requestId: string, result: any) => void
  openBrowser: (url?: string) => Promise<string>
  closeBrowser: () => Promise<string>
  resetBrowserIdle: () => void
  activateLicense: (key: string) => Promise<import('../shared/types').ActivationResult>
  deactivateLicense: () => Promise<boolean>
  getLicenseInfo: () => Promise<import('../shared/types').LicenseInfo | null>
  authLogin: (data: import('../shared/types').LoginData) => Promise<import('../shared/types').AuthResponse>
  authSignUp: (data: import('../shared/types').SignUpData) => Promise<import('../shared/types').AuthResponse>
  authLogout: () => Promise<boolean>
  getAuthUser: () => Promise<import('../shared/types').UserProfile | null>
  authResetPassword: (email: string) => Promise<{ success: boolean; error?: string }>
  authUpdateProfile: (
    updates: Partial<import('../shared/types').UserProfile>
  ) => Promise<import('../shared/types').AuthResponse>
  getUserAiUsage: () => Promise<import('../shared/types').UserAiUsageStatus | null>
  authResendConfirmation: (email: string) => Promise<{ success: boolean; error?: string }>
  onAuthSessionUpdated: (
    callback: (user: import('../shared/types').UserProfile | null) => void
  ) => () => void
  getSubscriptionPlans: () => Promise<import('../shared/types').SubscriptionPlan[]>
  createCheckoutSession: (
    planId: string,
    email?: string
  ) => Promise<import('../shared/types').CheckoutSessionResult>
  verifyAndActivatePayment: (
    planId: string,
    sessionId: string,
    email: string,
    company?: string
  ) => Promise<{ success: boolean; licenseKey?: string; error?: string }>
}


declare global {
  interface Window {
    electron: ElectronAPI
    api: PrismAPI
  }
}
