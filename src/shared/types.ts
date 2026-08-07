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
  }
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

export interface PaymentVerificationResult {
  success: boolean
  licenseKey?: string
  error?: string
}

export interface UserAiUsageStatus {
  percentageRemaining: number
  percentage5h: number
  percentage1w: number
  count5h: number
  count1w: number
  remaining5h: number
  remaining1w: number
  reset5hSeconds?: number
  reset1wSeconds?: number
}
