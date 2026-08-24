export interface MiniAppData {
  id: string
  title: string
  html: string
  css: string
  js: string
}

export interface ToolUpdate {
  toolCallName: string
  update: {
    agentIndex?: number
    phase?: 'thinking' | 'tool_use' | 'done' | 'error'
    command?: string
    output?: string
    // New: continuous web_search progress
    searchTitle?: string
    outputChunk?: string
    runId?: string
  }
}

export type TerminalProcessStatus = 'running' | 'completed' | 'failed' | 'killed'

export interface TerminalProcessSnapshot {
  runId: string
  chatId: string
  command: string
  status: TerminalProcessStatus
  exitCode: number | null
  startedAt: number
  completedAt: number | null
  isBackgrounded: boolean
  awaitingInput: boolean
  detectedPrompt?: string
  outputTruncated: boolean
}

export type DownloadProgressStatus =
  | 'starting'
  | 'downloading'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadProgress {
  id: string
  filename: string
  url?: string
  targetPath?: string
  receivedBytes: number
  totalBytes?: number
  percent?: number
  status: DownloadProgressStatus
  error?: string
  startedAt: number
  updatedAt: number
}

export interface ToolCall {
  id?: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error' | 'cancelled'
  agentUpdates?: Record<
    number,
    {
      phase: 'thinking' | 'tool_use' | 'done' | 'error'
      command?: string
      output?: string
    }
  >
  terminalOutput?: string
}

export interface ToolImageAttachment {
  kind: 'image'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  data: string
  width?: number
  height?: number
  byteLength?: number
}

export type ToolAttachment = ToolImageAttachment

export interface SaveGeneratedImageRequest extends ToolImageAttachment {
  suggestedName?: string
}

export interface SaveGeneratedImageResult {
  saved: boolean
  path?: string
  error?: string
}

export interface RetryImageGenerationRequest {
  chatId: string
  callId: string
}

export interface ApplicationInfo {
  name: string
  version?: string
  path: string
}

export interface FileSearchResult {
  name: string
  path: string
  relativePath: string
}

export interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

export type SessionMode = 'conversation' | 'execution' | 'discipline'

export type PrismThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export interface TodoTask {
  id: string
  title: string
  status: 'pending' | 'working' | 'done'
}

export interface TodoState {
  tasks: TodoTask[]
  createdAt: number
  active: boolean
  chatId?: string
}

export type CompletionType =
  | 'chat_completions'
  | 'responses'
  | 'anthropic_messages'
  | 'gemini_native'
  | 'puter_native'

export interface ProviderModel {
  id: string
  name?: string
  enabled: boolean
  isTrusted: boolean
}

export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  completionType: CompletionType
  isTrusted: boolean
  isOfficial?: boolean
  models: ProviderModel[]
}

export type BrowserActionType =
  | 'open'
  | 'navigate'
  | 'click'
  | 'type'
  | 'scroll'
  | 'back'
  | 'press'
  | 'script'
  | 'screenshot'
  | 'close'

export interface BrowserAction {
  type: BrowserActionType
  /** Base64 JPEG screenshot of the current browser view */
  screenshot?: string
  /** Normalized [0..1] click/pointer coords relative to browser viewport */
  clickX?: number
  clickY?: number
  /** For 'script' actions: the JS code executed */
  script?: string
  /** For 'script' actions: the return value / error */
  scriptResult?: string
  /** Current page URL */
  url?: string
  /** Current page title */
  title?: string
  timestamp: number
}

export interface StreamToolCallDelta {
  index: number
  id?: string
  name?: string
  argsDelta: string
}

export interface ArtifactItem {
  id: string
  type: 'pdf' | 'pptx'
  filename: string
  path: string
  htmlContent: string
  createdAt: number
  updatedAt: number
}

export interface ArtifactState {
  artifacts: ArtifactItem[]
  chatId: string
}

export interface LicenseInfo {
  id: string
  licensee: string
  email: string
  type: 'ENTERPRISE' | string
  seats: number
  issuedAt: string
  expiresAt: string
  isActivated: boolean
  key?: string
}

export interface ActivationResult {
  success: boolean
  info?: LicenseInfo
  error?: string
}

export interface UserProfile {
  id: string
  email: string
  fullName: string
  companyName: string
  accountType: 'individual' | 'enterprise' | 'company' | string
  emailConfirmed?: boolean
  avatarUrl?: string
  createdAt?: string
  updatedAt?: string
  activationStatus?: 'active' | 'inactive'
  activatedAt?: string | null
}

export interface WebLoginBeginResult {
  success: boolean
  url?: string
  error?: string
}

export interface ActivationStatusResult {
  status: 'active' | 'inactive'
  activatedAt?: string | null
  error?: string
}

export interface AccountActivationResult {
  success: boolean
  status?: 'active' | 'inactive'
  activatedAt?: string | null
  error?: string
  code?: string
  retryAfter?: number
}

export interface AuthState {
  isAuthenticated: boolean
  user: UserProfile | null
  token?: string
}

export interface AuthResponse {
  success: boolean
  user?: UserProfile
  error?: string
}

export interface SignUpData {
  email: string
  password: string
  fullName: string
  companyName?: string
  accountType?: 'individual' | 'enterprise' | 'company'
}

export interface LoginData {
  email: string
  password: string
}

export interface SubscriptionPlan {
  id: string
  name: string
  description: string
  priceUsd: number
  billingInterval: 'month' | 'year' | 'decade' | string
  durationDays: number
  seats: number
  badge?: string
  isActive: boolean
}

export interface CheckoutSessionResult {
  success: boolean
  checkoutUrl?: string
  sessionId?: string
  error?: string
}

export interface OpenExternalUrlResult {
  success: boolean
  error?: string
}

export interface PaymentVerificationResult {
  success: boolean
  pending?: boolean
  licenseKey?: string
  error?: string
}

export interface ModelAiUsageStatus {
  modelId: string
  modelName: string
  tier: string
  count5h: number
  count1w: number
  remaining5h: number
  remaining1w: number
  max5h: number
  max1w: number
  percentage5h: number
  percentage1w: number
  percentageRemaining: number
  reset5hSeconds?: number
  reset1wSeconds?: number
}

export interface UserAiUsageStatus {
  tier?: string
  percentageRemaining: number
  percentage5h: number
  percentage1w: number
  count5h: number
  count1w: number
  remaining5h: number
  remaining1w: number
  max5h?: number
  max1w?: number
  reset5hSeconds?: number
  reset1wSeconds?: number
  models?: Record<string, ModelAiUsageStatus>
  modelList?: ModelAiUsageStatus[]
}

export interface BrowserGenStartEvent {
  sessionId: string
  prompt: string
}

export interface BrowserGenChunkEvent {
  sessionId: string
  chunk: string
  fullHtml: string
}

export interface BrowserGenEndEvent {
  sessionId: string
  fullHtml: string
}

export interface BrowserGenErrorEvent {
  sessionId: string
  error: string
}

