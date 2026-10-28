import { BrowserWindow, WebContents } from 'electron'

type SendTarget = BrowserWindow | WebContents | null | undefined

/**
 * Safely sends an IPC message to a target window or webContents.
 * Checks whether the target and its webContents exist and are not destroyed
 * before emitting the event, preventing 'Object has been destroyed' exceptions.
 */
export function safeSend(target: SendTarget, channel: string, ...args: any[]): void {
  if (!target) return
  // Agenda runs reuse the chat pipeline with hidden `agenda-*` sessions. Their
  // streaming events must never reach the chat UI, which would otherwise adopt
  // the run into the active tab. The run drawer reads the persisted transcript.
  if (isHiddenAgendaEvent(channel, args)) return
  try {
    const webContents: WebContents | null =
      'webContents' in target ? target.webContents : target

    if (
      webContents &&
      !webContents.isDestroyed() &&
      (!('isDestroyed' in target) || !target.isDestroyed())
    ) {
      webContents.send(channel, ...args)
    }
  } catch (err) {
    console.warn(`[safeSend] Suppressed error sending on channel '${channel}':`, err)
  }
}

/**
 * Safely broadcasts an IPC message to all open BrowserWindow instances.
 */
export function broadcastIpc(channel: string, ...args: any[]): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    safeSend(win, channel, ...args)
  }
}

function isHiddenAgendaEvent(channel: string, args: unknown[]): boolean {
  if (!channel.startsWith('chat-')) return false
  const payload = args[0]
  if (!payload || typeof payload !== 'object') return false
  const record = payload as { chatId?: unknown; id?: unknown }
  const chatId = typeof record.chatId === 'string' ? record.chatId : record.id
  return typeof chatId === 'string' && chatId.startsWith('agenda-')
}
