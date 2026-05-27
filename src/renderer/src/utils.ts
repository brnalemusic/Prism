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

/**
 * Parses an error message to extract the error code (e.g. 500, 429, 400, 404, etc.)
 */
export function parseErrorCode(error: any): string {
  if (!error) return '500'
  const errorStr = typeof error === 'string' ? error : error.message || String(error)
  
  // Look for a 3-digit status code (like 400, 429, 500, etc.)
  const match = errorStr.match(/\b(\d{3})\b/)
  if (match) {
    return match[1]
  }

  // Common mapping for known text errors to codes
  const lower = errorStr.toLowerCase()
  if (lower.includes('rate limit') || lower.includes('quota') || lower.includes('exhausted') || lower.includes('429')) {
    return '429'
  }
  if (lower.includes('unauthorized') || lower.includes('api key') || lower.includes('key missing') || lower.includes('401') || lower.includes('auth')) {
    return '401'
  }
  if (lower.includes('forbidden') || lower.includes('permission') || lower.includes('403')) {
    return '403'
  }
  if (lower.includes('not found') || lower.includes('404')) {
    return '404'
  }
  if (lower.includes('bad request') || lower.includes('invalid') || lower.includes('400')) {
    return '400'
  }
  if (lower.includes('timeout') || lower.includes('504')) {
    return '504'
  }
  if (lower.includes('internal') || lower.includes('service') || lower.includes('500') || lower.includes('503')) {
    return '500'
  }
  if (lower.includes('network') || lower.includes('connect')) {
    return '502' // Bad Gateway / connection issue
  }

  // Check for any 3-digit number
  const genericMatch = errorStr.match(/(\d{3})/)
  if (genericMatch) {
    return genericMatch[1]
  }

  // Default fallback code for generic/TTS errors
  return '500'
}

/**
 * Triggers a global error popup with only the error code in the message
 */
export const triggerErrorPopup = (error: any): void => {
  const code = parseErrorCode(error)
  const event = new CustomEvent('show-error-popup', { detail: { code } })
  window.dispatchEvent(event)
}

