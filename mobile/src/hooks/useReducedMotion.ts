import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * Mirrors the OS "reduce motion" preference and folds in the user's manual
 * Prism setting once it exists (Wave 4 wires that switch, but the hook
 * already accepts the manual flag so screens will not need rewiring).
 */
export function useReducedMotion(manualOverride = false): boolean {
  const [system, setSystem] = useState(false)

  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setSystem(Boolean(value))
      })
      .catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setSystem(Boolean(value))
    })
    return () => {
      alive = false
      subscription.remove()
    }
  }, [])

  return Boolean(manualOverride) || system
}
