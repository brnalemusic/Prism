import { useCallback, useEffect, useState } from 'react'

export type PerformanceMode = 'auto' | 'performance' | 'max'

const STORAGE_KEY = 'prism-performance-mode'
const UNDER_LOAD_CLASS = 'perf-under-load'
const MAX_CLASS = 'perf-max'
const PERFORMANCE_CLASS = 'perf-performance'

function readStoredMode(): PerformanceMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'max' || stored === 'performance') return stored
    return 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Performance mode with the current look as default.
 * - auto: full visuals when idle, temporary imperceptible step-down
 *   (blur 44px -> 28px, opacity-only streaming fade) during heavy load.
 * - performance (Beta): lightweight look, no backdrop blur or glassmorphism,
 *   opacity-only streaming fade for maximum fluidity.
 * - max: cinematic streaming (fade + tint + unblur) with stronger
 *   containment applied.
 */
export function usePerformanceMode(): {
  mode: PerformanceMode
  setMode: (mode: PerformanceMode) => void
} {
  const [mode, setModeState] = useState<PerformanceMode>(() => readStoredMode())

  useEffect(() => {
    document.documentElement.classList.toggle(MAX_CLASS, mode === 'max')
    document.documentElement.classList.toggle(PERFORMANCE_CLASS, mode === 'performance')
  }, [mode])

  const setMode = useCallback((next: PerformanceMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage is best-effort; mode still applies for this session.
    }
  }, [])

  return { mode, setMode }
}

/**
 * Toggles the temporary under-load state while streaming or scrolling fast.
 * Restores full quality shortly after activity stops so the idle look
 * stays pixel-identical. Disabled in Performance mode, which is already
 * fully lightweight.
 */
export function usePerformanceLoad(active: boolean, restoreDelayMs = 800, enabled = true): void {
  useEffect(() => {
    let timer: number | undefined
    if (active && enabled) {
      document.documentElement.classList.add(UNDER_LOAD_CLASS)
    } else {
      timer = window.setTimeout(() => {
        document.documentElement.classList.remove(UNDER_LOAD_CLASS)
      }, restoreDelayMs)
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [active, restoreDelayMs, enabled])
}
