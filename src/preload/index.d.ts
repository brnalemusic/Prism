import { ElectronAPI } from '@electron-toolkit/preload'
import type { StructuredChatResponse } from '../main/gemini'
import type { AppConfig } from '../main/config'
import type { ChatSession } from '../main/history'
import type { Content } from '@google/genai'
import type { SubagentMessage, MiniAppData, ToolUpdate } from '../shared/types'

export interface PrismAPI {
  sendChatMessage: (data: {
    message: string
    thinkMode?: boolean
    chatId?: string
    extendedSearch?: boolean
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
  onLauncherMessage: (
    callback: (data: { message: string; thinkMode?: boolean }) => void
  ) => () => void
  onLauncherFocus: (callback: () => void) => () => void
  onModelChanged: (callback: (modelKey: string) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  onChatSessionCreated: (callback: (data: { id: string }) => void) => () => void
  onChatTitleReceived: (callback: (data: { id: string; title: string }) => void) => () => void
  onSubagentMessage: (callback: (data: SubagentMessage) => void) => () => void
  submitLauncher: (data: { message: string; thinkMode?: boolean }) => void
  hideLauncher: () => void
  minimizeApp: () => void
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
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<boolean>
  getChats: () => Promise<Omit<ChatSession, 'messages'>[]>
  loadChat: (id: string) => Promise<Content[]>
  deleteChat: (id: string) => Promise<boolean>
  getRunningChats: () => Promise<string[]>
  setThinkMode: (val: boolean) => void
  setSearchEnabled: (val: boolean) => void
  setExtendedSearch: (val: boolean) => void
  onThinkModeChanged: (callback: (val: boolean) => void) => () => void
  onSearchEnabledChanged: (callback: (val: boolean) => void) => () => void
  onExtendedSearchChanged: (callback: (val: boolean) => void) => () => void
  removeLauncherListeners: () => void
  removeAllChatListeners: () => void
  launcherGetApps: () => Promise<any[]>
  launcherSearchFiles: (query: string) => Promise<any[]>
  launcherOpenApp: (appPath: string) => Promise<string>
  launcherOpenFile: (filePath: string) => Promise<string>
  sendLauncherChatMessage: (data: { message: string; thinkMode?: boolean }) => void
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
  onLauncherToolStart: (callback: (data: { name: string; args: any }) => void) => () => void
  onLauncherToolEnd: (callback: (data: { name: string; result: string }) => void) => () => void
  onOpenMainAppWithInstructions: (
    callback: (data: {
      instructions: string
      model: string
      thinkMode?: boolean
      searchEnabled?: boolean
      extendedSearch?: boolean
    }) => void
  ) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PrismAPI
  }
}
