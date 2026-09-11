// Motion-driven streaming reveal for AI message text.
//
// Replaces the previous CSS @keyframes approach (opacity + color keyframes
// with a shared --streaming-character-delay var). The animation timeline
// (token order, quantized delays, live-span cap) still lives in
// AnimatedStreamingText.tsx; this module only maps a span's delay + mode to
// Motion initial/animate/transition props.
//
// Per-mode behavior (mode is read from the documentElement classes applied
// by usePerformanceMode, so spans pick it up at mount with zero subscription
// cost):
// - auto (Medium): fade-in 0.8s + letter tint 1.2s, no blur.
// - max (Maximum): fade-in 0.8s + letter tint 1.2s + unblur 1.0s (cinematic).
// - performance: fade-in only, fast, no tint and no blur.
// - auto under heavy load: fade-in only at the previous fast timing.
//
// The tint animates between two concrete colors because Motion cannot
// interpolate to `inherit`. The final color matches the prose body color;
// syntax-highlighted code blocks use the opacity-only element fade so token
// colors are never touched. Text inside links also uses the opacity-only
// path so link colors never drift.
import type { TargetAndTransition, Transition } from 'motion/react'

export type StreamingMotionMode = 'auto' | 'performance' | 'max'

export const STREAMING_FADE_IN_DURATION_S = 0.8
export const STREAMING_TINT_DURATION_S = 1.2
export const STREAMING_UNBLUR_DURATION_S = 1.0
export const STREAMING_PERFORMANCE_FADE_S = 0.2
export const STREAMING_UNDER_LOAD_FADE_S = 0.26

const SMOOTH_EASE: [number, number, number, number] = [0.2, 0.82, 0.2, 1]

// Final color of streaming body text. Matches `.prose :where(p, li)`.
const STREAMING_FINAL_COLOR = 'rgba(244, 241, 234, 0.9)'
const STREAMING_BLUR_FROM = 'blur(6px)'
const STREAMING_BLUR_TO = 'blur(0px)'
const ACCENT_FALLBACK = '#38bdf8'

let cachedTheme = ''
let cachedAccent = ACCENT_FALLBACK

// Resolves the current theme accent once per theme (not per span) so the
// tint always starts from the active theme color. The Hero theme rotates
// its accent continuously, so the cache also expires on a short interval.
let cachedAt = 0
const HERO_CACHE_TTL_MS = 200
export function getStreamingAccentColor(): string {
  try {
    const theme = document.documentElement.getAttribute('data-theme') || ''
    if (theme === 'hero' && Date.now() - cachedAt < HERO_CACHE_TTL_MS && cachedAccent) {
      return cachedAccent
    }
    if (theme === cachedTheme && theme !== 'hero' && cachedAccent) return cachedAccent
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent-primary')
      .trim()
    cachedTheme = theme
    cachedAccent = resolved || ACCENT_FALLBACK
    cachedAt = Date.now()
    return cachedAccent
  } catch {
    return ACCENT_FALLBACK
  }
}

export function readStreamingMotionMode(): StreamingMotionMode {
  try {
    const classes = document.documentElement.classList
    if (classes.contains('perf-performance')) return 'performance'
    if (classes.contains('perf-max')) return 'max'
  } catch {
    // DOM access is best-effort; fall through to auto.
  }
  return 'auto'
}

export function isStreamingUnderLoad(): boolean {
  try {
    return document.documentElement.classList.contains('perf-under-load')
  } catch {
    return false
  }
}

// Static reduced-motion check at mount time. Spans mount once and animate
// once, so no media-query subscription is needed; the global MotionConfig
// reducedMotion="user" wrappers remain the reactive layer elsewhere.
export function prefersReducedStreamingMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export interface StreamingMotionProps {
  initial: TargetAndTransition | false
  animate: TargetAndTransition
  transition: Transition
}

// Builds the Motion props for one streaming span. `tint` selects the full
// fade + tint (+ unblur in Maximum) path; `false` selects the opacity-only path
// used for code blocks, math, and link text.
export function getStreamingCharMotion(delayMs: number, tint: boolean): StreamingMotionProps {
  if (prefersReducedStreamingMotion()) {
    return { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
  }

  const mode = readStreamingMotionMode()
  const delay = Math.max(0, Number(delayMs) || 0) / 1000

  if (mode === 'performance') {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: STREAMING_PERFORMANCE_FADE_S, delay, ease: 'easeOut' }
    }
  }

  if (mode !== 'max' && isStreamingUnderLoad()) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: STREAMING_UNDER_LOAD_FADE_S, delay, ease: 'easeOut' }
    }
  }

  const unblur = tint && mode === 'max'
  const initial: TargetAndTransition = tint
    ? { opacity: 0, color: getStreamingAccentColor() }
    : { opacity: 0 }
  const animate: TargetAndTransition = tint
    ? { opacity: 1, color: STREAMING_FINAL_COLOR }
    : { opacity: 1 }
  if (unblur) {
    initial.filter = STREAMING_BLUR_FROM
    animate.filter = STREAMING_BLUR_TO
  }

  const transition = {
    opacity: { duration: STREAMING_FADE_IN_DURATION_S, delay, ease: 'easeOut' as const },
    ...(tint ? { color: { duration: STREAMING_TINT_DURATION_S, delay, ease: SMOOTH_EASE } } : {}),
    ...(unblur
      ? { filter: { duration: STREAMING_UNBLUR_DURATION_S, delay, ease: 'easeOut' as const } }
      : {})
  } as Transition

  return { initial, animate, transition }
}
