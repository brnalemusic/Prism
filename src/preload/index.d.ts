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
  HarnessPhase,
  TodoState,
  TerminalProcessSnapshot,
  ToolAttachment,
  HarnessApprovalRequest,
  HarnessProjectConfig,
  HarnessProjectOverrides,
  HarnessInstructionStatus,
  HarnessContextSnapshot,
  HarnessSettings,
  RetryImageGenerationRequest,
  SaveGeneratedImageRequest,
  SaveGeneratedImageResult,
  WorkspaceKind,
  HarnessExplorerSelection,
  HarnessExplorerDirectoryResult,
  HarnessExplorerActionResult
} from '../shared/types'
import type {
  MemoryEntry,
  MemoryListOptions,
  MemoryPatch,
  MemoryStats,
  MemoryStoreEvent
} from '../shared/memoryCore'
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

export interface DiscordVoiceStateEvent {
  chatId: string
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
}

export interface DiscordVoiceSpeakingEvent {
  chatId: string
  speaking: boolean
}

export interface DiscordVoiceAudioLevelEvent {
  chatId: string
  level: number
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
    disabledSkills?: string[]
  }) => void
  sendHarnessMessage: (data: {
    message: string
    chatId?: string
    projectPath: string
    attachedFile?: AttachedFile
    quote?: string
    modelKey?: string
    reasoningLevel?: string
    explorerContext?: HarnessExplorerSelection[]
    harnessPhase?: HarnessPhase
  }) => void
  setHarnessSessionPhase: (chatId: string, phase: HarnessPhase) => Promise<boolean>
  prepareHarnessPlanHandoff: (data: {
    chatId: string
    projectPath: string
    modelKey: string
    plan: string
  }) => Promise<{ context: string }>
  cancelHarnessPlanHandoff: (chatId: string) => void
  setHarnessSessionModel: (chatId: string, modelKey: string) => Promise<boolean>

  setModel: (modelKey: string) => void
  clearChat: () => void
  cancelChat: (chatId?: string) => void
  onChatStart: (
    callback: (data: {
      chatId: string
      workspace: WorkspaceKind
      userMessage?: { role: 'user'; content: string }
    }) => void
  ) => () => void

  onChatChunk: (
    callback: (
      data: StructuredChatResponse & {
        chatId: string
        workspace: WorkspaceKind
        harnessRound?: number
        harnessRoundContent?: string
        harnessRoundThoughts?: string
      }
    ) => void
  ) => () => void
  onChatEnd: (
    callback: (
      data: StructuredChatResponse & {
        chatId: string
        workspace: WorkspaceKind
        harnessRoundContent?: string
        harnessRoundThoughts?: string
      }
    ) => void
  ) => () => void
  onChatError: (
    callback: (data: { error: string; chatId: string; workspace: WorkspaceKind }) => void
  ) => () => void
  onToolStart: (
    callback: (data: {
      callId: string
      name: string
      args: Record<string, unknown>
      timestamp?: number
      chatId: string
      workspace: WorkspaceKind
      round?: number
    }) => void
  ) => () => void
  onToolEnd: (
    callback: (data: {
      callId: string
      name: string
      result: string
      attachments?: ToolAttachment[]
      chatId: string
      workspace: WorkspaceKind
      round?: number
    }) => void
  ) => () => void
  onDiscordVoiceState: (callback: (data: DiscordVoiceStateEvent) => void) => () => void
  onDiscordVoiceSpeaking: (callback: (data: DiscordVoiceSpeakingEvent) => void) => () => void
  onDiscordVoiceAudioLevel: (callback: (data: DiscordVoiceAudioLevelEvent) => void) => () => void
  onDiscordVoiceOutput: (callback: (data: { chatId: string }) => void) => () => void
  onToolUpdate: (callback: (data: ToolUpdate & { chatId: string }) => void) => () => void
  onHarnessApprovalRequest: (callback: (data: HarnessApprovalRequest) => void) => () => void
  resolveHarnessApproval: (requestId: string, approved: boolean) => void
  onHarnessPromptWarning: (
    callback: (data: {
      chatId: string
      warnings: string[]
      repoInstructionsLoaded: boolean
    }) => void
  ) => () => void
  onHarnessContextInjection: (
    callback: (data: { chatId: string; snapshot: HarnessContextSnapshot }) => void
  ) => () => void
  createHarnessProject: (name: string) => Promise<{ project: HarnessProjectConfig }>
  openHarnessProject: (projectPath?: string) => Promise<{ project: HarnessProjectConfig } | null>
  getHarnessProject: (projectPath?: string) => Promise<HarnessProjectConfig | null>
  getHarnessInstructionStatus: (projectPath?: string) => Promise<HarnessInstructionStatus | null>
  updateHarnessProject: (
    projectPath: string,
    overrides: HarnessProjectOverrides
  ) => Promise<{ project: HarnessProjectConfig }>
  deleteHarnessProject: (rootPath: string) => Promise<HarnessSettings>
  checkHarnessProject: (
    rootPath: string
  ) => Promise<{ exists: boolean; isDirectory: boolean; isGit: boolean }>
  checkAllHarnessProjects: () => Promise<
    Record<string, { exists: boolean; isDirectory: boolean; isGit: boolean }>
  >
  recreateHarnessProjectFolder: (rootPath: string) => Promise<{ project: HarnessProjectConfig }>
  resolveHarnessStartupProject: () => Promise<HarnessProjectConfig | null>
  listHarnessDirectory: (
    projectPath: string,
    relativePath?: string
  ) => Promise<HarnessExplorerDirectoryResult>
  openHarnessExplorerFile: (
    projectPath: string,
    selection: HarnessExplorerSelection
  ) => Promise<HarnessExplorerActionResult>
  copyHarnessExplorerPath: (
    projectPath: string,
    selection: HarnessExplorerSelection
  ) => Promise<HarnessExplorerActionResult>
  showHarnessExplorerItem: (
    projectPath: string,
    selection: HarnessExplorerSelection
  ) => Promise<HarnessExplorerActionResult>
  openFolderInExplorer: (folderPath: string) => Promise<string>
  onDownloadProgress: (callback: (data: DownloadProgress) => void) => () => void
  demoDownloadPrism: () => Promise<DemoDownloadResult>
  demoRunPrismInstaller: () => Promise<DemoProcessResult>
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
  demoInstallDependency: (dependencyId: string) => Promise<DemoProcessResult>
  onDemoDependencyProgress: (callback: (data: DemoDependencyProgress) => void) => () => void
  onLauncherMessage: (
    callback: (data: { message: string; screenshot?: string; appMode?: string }) => void
  ) => () => void
  onLauncherFocus: (callback: () => void) => () => void
  onModelChanged: (callback: (modelKey: string) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  onChatSessionCreated: (callback: (data: { id: string }) => void) => () => void
  onChatTitleReceived: (callback: (data: { id: string; title: string }) => void) => () => void
  submitLauncher: (data: { message: string; screenshot?: string; appMode?: string }) => void
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
  memoryList: (options?: MemoryListOptions) => Promise<MemoryEntry[]>
  memoryUpdate: (id: string, patch: MemoryPatch) => Promise<MemoryEntry | null>
  memoryArchive: (id: string) => Promise<boolean>
  memoryRestore: (id: string) => Promise<boolean>
  memoryDelete: (id: string) => Promise<boolean>
  memoryStats: () => Promise<MemoryStats>
  memoryToggleAuto: (enabled: boolean) => Promise<boolean>
  onMemoryEvent: (callback: (event: MemoryStoreEvent) => void) => () => void
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
  getHarnessSessions: () => Promise<Omit<ChatSession, 'messages'>[]>
  loadHarnessSession: (id: string) => Promise<any[]>
  searchHarnessSessions: (query: string) => Promise<any>
  isChatRunning: (id: string) => Promise<boolean>
  getChatModel: (id: string) => Promise<string | undefined>
  deleteChat: (id: string) => Promise<boolean>
  deleteHarnessSession: (id: string) => Promise<boolean>
  retryImageGeneration: (
    request: RetryImageGenerationRequest
  ) => Promise<{ started: boolean; error?: string }>
  saveGeneratedImage: (request: SaveGeneratedImageRequest) => Promise<SaveGeneratedImageResult>
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
    callback: (data: { callId: string; name: string; args: Record<string, unknown> }) => void
  ) => () => void
  onLauncherToolEnd: (
    callback: (data: { callId: string; name: string; result: string }) => void
  ) => () => void
  onOpenMainAppWithInstructions: (
    callback: (data: { instructions: string; model: string; searchEnabled?: boolean }) => void
  ) => () => void
  submitQuestionnaire: (data: {
    chatId: string
    sessionId: string
    responses: Record<string, string | string[]>
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
    callback: (data: {
      callId: string
      name: string
      args: Record<string, unknown>
      timestamp?: number
    }) => void
  ) => () => void
  onAiSearchToolEnd: (
    callback: (data: { callId: string; name: string; result: string }) => void
  ) => () => void
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
  onTerminalProcessUpdate: (callback: (data: TerminalProcessSnapshot) => void) => () => void
  getTerminalProcessesForChat: (chatId: string) => Promise<TerminalProcessSnapshot[]>
  onArtifactsUpdate: (
    callback: (data: {
      chatId: string
      artifacts: import('../shared/types').ArtifactItem[]
    }) => void
  ) => () => void
  getArtifactsForChat: (chatId: string) => Promise<import('../shared/types').ArtifactItem[]>
  openArtifactFile: (filePath: string) => Promise<void>
  showArtifactInFolder: (filePath: string) => Promise<void>
  getProviders: () => Promise<import('../shared/types').ProviderConfig[]>
  saveProviders: (providers: import('../shared/types').ProviderConfig[]) => Promise<boolean>
  deleteProvider: (providerId: string) => Promise<boolean>
  fetchProviderModels: (params: {
    baseUrl: string
    apiKey: string
    puterAuthToken?: string
    completionType: import('../shared/types').CompletionType
  }) => Promise<{
    success: boolean
    models: import('../shared/types').ProviderModel[]
    error?: string
  }>
  loginWithPuter: () => Promise<{
    success: boolean
    token?: string
    username?: string
    user?: any
    error?: string
  }>
  cancelPuterLogin: () => Promise<boolean>
  getActiveModels: () => Promise<
    Array<{
      providerId: string
      providerName: string
      isProviderTrusted: boolean
      model: import('../shared/types').ProviderModel
      fullKey: string
      completionType: import('../shared/types').CompletionType
    }>
  >
  onToolCallDelta: (
    callback: (
      delta: import('../shared/types').StreamToolCallDelta & {
        chatId: string
        workspace: WorkspaceKind
      }
    ) => void
  ) => () => void
  onBrowserAction: (
    callback: (action: import('../shared/types').BrowserAction) => void
  ) => () => void
  onBrowserExecCommand: (
    callback: (data: { requestId: string; command: any }) => void
  ) => () => void
  sendBrowserExecResult: (requestId: string, result: any) => void
  openBrowser: (url?: string) => Promise<string>
  openExternalUrl: (url: string) => Promise<import('../shared/types').OpenExternalUrlResult>
  closeBrowser: () => Promise<string>
  resetBrowserIdle: () => void
  generateBrowserSite: (data: { prompt: string; sessionId: string; history?: any[] }) => void
  cancelBrowserGeneration: (sessionId?: string) => void
  onBrowserGenStart: (
    callback: (data: import('../shared/types').BrowserGenStartEvent) => void
  ) => () => void
  onBrowserGenChunk: (
    callback: (data: import('../shared/types').BrowserGenChunkEvent) => void
  ) => () => void
  onBrowserGenEnd: (
    callback: (data: import('../shared/types').BrowserGenEndEvent) => void
  ) => () => void
  onBrowserGenError: (
    callback: (data: import('../shared/types').BrowserGenErrorEvent) => void
  ) => () => void
  activateLicense: (key: string) => Promise<import('../shared/types').ActivationResult>
  deactivateLicense: () => Promise<boolean>
  getLicenseInfo: () => Promise<import('../shared/types').LicenseInfo | null>
  authBeginWebLogin: () => Promise<import('../shared/types').WebLoginBeginResult>
  authCancelWebLogin: () => Promise<boolean>
  authGetActivationStatus: () => Promise<import('../shared/types').ActivationStatusResult>
  authActivateAccount: (code: string) => Promise<import('../shared/types').AccountActivationResult>
  authLogout: () => Promise<boolean>
  getAuthUser: () => Promise<import('../shared/types').UserProfile | null>
  authResetPassword: (email: string) => Promise<{ success: boolean; error?: string }>
  authUpdateProfile: (
    updates: Partial<import('../shared/types').UserProfile>
  ) => Promise<import('../shared/types').AuthResponse>
  getUserAiUsage: () => Promise<import('../shared/types').UserAiUsageStatus | null>
  authRequestDeleteAccountEmail: (email: string) => Promise<{ success: boolean; error?: string }>
  authConfirmDeleteAccount: (otpCode: string) => Promise<{ success: boolean; error?: string }>
  authConfirmDeleteAccountWithPassword: (
    password: string
  ) => Promise<{ success: boolean; error?: string }>
  onAuthSessionUpdated: (
    callback: (user: import('../shared/types').UserProfile | null) => void
  ) => () => void
  onAuthCallbackReceived: (callback: () => void) => () => void
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
  ) => Promise<import('../shared/types').PaymentVerificationResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PrismAPI
  }
}
