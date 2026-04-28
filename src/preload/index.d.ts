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

export interface PrismAPI {
  sendChatMessage: (data: { message: string; thinkMode?: boolean }) => void
  setModel: (modelKey: string) => void
  clearChat: () => void
  cancelChat: () => void
  onChatStart: (callback: () => void) => () => void

  onChatChunk: (callback: (data: StructuredChatResponse) => void) => () => void
  onChatEnd: (callback: (data: StructuredChatResponse) => void) => () => void
  onChatError: (callback: (error: string) => void) => () => void
  onToolStart: (callback: (data: { name: string; args: Record<string, unknown> }) => void) => () => void
  onToolEnd: (callback: (data: { name: string; result: string }) => void) => () => void
  onToolUpdate: (callback: (data: ToolUpdate) => void) => () => void
  onLauncherMessage: (callback: (data: { message: string; thinkMode?: boolean }) => void) => () => void
  onLauncherFocus: (callback: () => void) => () => void
  onModelChanged: (callback: (modelKey: string) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  submitLauncher: (data: { message: string; thinkMode?: boolean }) => void
  hideLauncher: () => void
  minimizeApp: () => void
  closeApp: () => void
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<boolean>
  removeLauncherListeners: () => void
  removeAllChatListeners: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PrismAPI
  }
}
