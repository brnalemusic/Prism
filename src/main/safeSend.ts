import { BrowserWindow, WebContents } from 'electron'

type SendTarget = BrowserWindow | WebContents | null | undefined

/**
 * Safely sends an IPC message to a target window or webContents.
 * Checks whether the target and its webContents exist and are not destroyed
 * before emitting the event, preventing 'Object has been destroyed' exceptions.
 */
export function safeSend(target: SendTarget, channel: string, ...args: any[]): void {
  if (!target) return
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
