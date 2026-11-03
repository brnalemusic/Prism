import type { BrowserWindow } from 'electron'

/**
 * Reference to the primary Prism window.
 *
 * Secondary windows (Launcher, Voice Overlay, Updater and Mini Apps) are
 * frameless, transparent and always-on-top. `BrowserWindow.getAllWindows()`
 * returns them before the main window, so picking an arbitrary entry from that
 * list can surface a decorative overlay across the user's desktop instead of
 * the Prism window that actually needs attention.
 */
let mainWindowRef: BrowserWindow | null = null

export function registerMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null
}

/** Brings the primary Prism window to the foreground. Secondary windows are never surfaced. */
export function focusMainWindow(options: { flash?: boolean } = {}): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  if (options.flash) win.flashFrame(true)
}
