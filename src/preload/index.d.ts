import { ElectronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse } from '../main/gemini'
import type { AppConfig } from '../main/config'

export interface ToolUpdate {
  toolCallName: string
  update: {
    agentIndex: number
    phase: 'thinking' | 'tool_use' | 'done' | 'error'
    command?: string
    output?: string
  }
}

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error'
  subagentMessages?: any[]
  agentUpdates?: Record<number, {
    phase: 'thinking' | 'tool_use' | 'done' | 'error'
    command?: string
    output?: string
  }>
}

export interface PrismAPI {
  sendChatMessage: (data: { message: string; thinkMode?: boolean }) => void
  setModel: (modelKey: string) => void
  clearChat: () => void
  cancelChat: () => void
  onChatStart: (callback: () => void) => () => void

  onChatChunk: (callback: (data: StructuredChatResponse) => void) => () => void
  onChatEnd: (callback: (data: StructuredChatResponse) => void) => () => void
  onChatError: (callback: (error: string) => void) => () => void
  onToolStart: (callback: (data: { name: string; args: Record<string, unknown>; timestamp?: number }) => void) => () => void
  onToolEnd: (callback: (data: { name: string; result: string }) => void) => () => void
  onToolUpdate: (callback: (data: ToolUpdate) => void) => () => void
  onLauncherMessage: (callback: (data: { message: string; thinkMode?: boolean }) => void) => () => void
  onLauncherFocus: (callback: () => void) => () => void
  onModelChanged: (callback: (modelKey: string) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  onChatSessionCreated: (callback: (data: { id: string }) => void) => () => void
  onChatTitleReceived: (callback: (data: { id: string; title: string }) => void) => () => void
  onSubagentMessage: (callback: (data: any) => void) => () => void
  submitLauncher: (data: { message: string; thinkMode?: boolean }) => void
  hideLauncher: () => void
  minimizeApp: () => void
  minimizeSubagentsWindow: () => void
  openSubagentsWindow: (initialMessages?: any[]) => void
  broadcastSubagentMessage: (data: any) => void
  closeApp: () => void
  closeSubagentsWindow: () => void
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<boolean>
  getChats: () => Promise<any[]>
  loadChat: (id: string) => Promise<any[]>
  deleteChat: (id: string) => Promise<boolean>
  removeLauncherListeners: () => void
  removeAllChatListeners: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PrismAPI
  }
}
