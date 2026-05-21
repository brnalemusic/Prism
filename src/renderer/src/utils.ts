/**
 * Helper function to check if a shortcut is pressed
 */
export const isShortcutPressed = (e: KeyboardEvent, shortcut: string): boolean => {
  if (!shortcut) return false

  const isMac = window.navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const parts = shortcut.split('+')
  const mainKey = parts.pop()?.toLowerCase()

  if (!mainKey) return false

  const hasControl = parts.includes('Control') || parts.includes('Ctrl')
  const hasCommand = parts.includes('Command') || parts.includes('Cmd') || parts.includes('Meta')
  const hasCommandOrControl = parts.includes('CommandOrControl') || parts.includes('CmdOrCtrl')
  const hasAlt = parts.includes('Alt')
  const hasShift = parts.includes('Shift')

  const ctrlPressed = e.ctrlKey
  const metaPressed = e.metaKey
  const altPressed = e.altKey
  const shiftPressed = e.shiftKey

  const cmdOrCtrlPressed = isMac ? metaPressed : ctrlPressed

  if (hasCommandOrControl && !cmdOrCtrlPressed) return false
  if (!hasCommandOrControl) {
    if (hasControl && !ctrlPressed) return false
    if (hasCommand && !metaPressed) return false
  }

  if (hasAlt && !altPressed) return false
  if (hasShift && !shiftPressed) return false

  // Check main key
  let eventKey = e.key.toLowerCase()
  if (eventKey === ' ') eventKey = 'space'

  return eventKey === mainKey
}
