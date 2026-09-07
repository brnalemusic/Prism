import { useCallback, useEffect, useState } from 'react'

export type PerformanceMode = 'auto' | 'max'

const STORAGE_KEY = 'prism-performance-mode'
const UNDER_LOAD_CLASS = 'perf-under-load'
const MAX_CLASS = 'perf-max'

function readStoredMode(): PerformanceMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'max' ? 'max' : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Performance mode with the current look as default.
 * - auto: full visuals when idle, temporary imperceptible step-down
 *   (blur 44px -> 28px, opacity-only streaming fade) during heavy load.
 * - max: keeps the same idle look with stronger containment applied.
 */
export function usePerformanceMode(): {
  mode: PerformanceMode
  setMode: (mode: PerformanceMode) => void
} {
  const [mode, setModeState] = useState<PerformanceMode>(() => readStoredMode())

  useEffect(() => {
    document.documentElement.classList.toggle(MAX_CLASS, mode === 'max')
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
 * stays pixel-identical.
 */
export function usePerformanceLoad(active: boolean, restoreDelayMs = 800): void {
  useEffect(() => {
    let timer: number | undefined
    if (active) {
      document.documentElement.classList.add(UNDER_LOAD_CLASS)
    } else {
      timer = window.setTimeout(() => {
        document.documentElement.classList.remove(UNDER_LOAD_CLASS)
      }, restoreDelayMs)
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [active, restoreDelayMs])
}
