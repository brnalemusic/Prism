// Shared motion presets for Prism transitions.
// All interface copy stays in English. Real animations via the `motion` library
// (successor of Framer Motion) with both enter AND exit states so panels never
// pop in or vanish abruptly. Every preset respects `prefers-reduced-motion`
// through MotionConfig reducedMotion="user" at the call site.
//
// PERFORMANCE: presets animate transform and opacity ONLY (GPU-composited).
// Never animate `filter: blur()` here — on this Electron/Chromium target with
// heavy backdrop-blur surfaces, animated blur forces full repaints per frame
// and causes severe lag on weaker machines.
import type { Transition, Variants } from 'motion/react'

// Fast, physical ease used across docked panels and mode swaps.
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1]

export const DOCK_ENTER_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.9
}

export const DOCK_EXIT_TRANSITION: Transition = {
  duration: 0.22,
  ease: EASE_OUT_EXPO
}

// Docked card above the InputBar (TodoPanel, Questionnaire, Plan).
// Rises on enter, settles down on exit. Transform + opacity only.
export const dockRise: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: DOCK_ENTER_TRANSITION
  },
  exit: {
    opacity: 0,
    y: 12,
    scale: 0.98,
    transition: DOCK_EXIT_TRANSITION
  }
}

// Full content swap (Harness <-> Chat, plan <-> build review).
// Old content lifts out, new content rises in. Used with mode="wait".
export const modeSwap: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: EASE_OUT_EXPO }
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: { duration: 0.2, ease: EASE_OUT_EXPO }
  }
}

// Questionnaire step slide. `custom` carries direction: +1 forward, -1 back.
export const stepSlide: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? 28 : -28
  }),
  center: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.26, ease: EASE_OUT_EXPO }
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? -24 : 24,
    transition: { duration: 0.2, ease: EASE_OUT_EXPO }
  })
}

// Terminal resolution treatments.
export const terminalSuccessPop: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 500, damping: 22 }
  }
}

// Error shake keyframes applied via `animate` on the failing row.
export const TERMINAL_ERROR_SHAKE = {
  x: [0, -6, 6, -3, 3, 0],
  transition: { duration: 0.4, ease: 'easeOut' as const }
}

// Small tab content crossfade for TodoPanel tabs.
export const tabContent: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: EASE_OUT_EXPO }
  },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: EASE_OUT_EXPO } }
}

// Stagger container for lists (terminal rows, artifacts, plan blocks).
export const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
  exit: {}
}

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: EASE_OUT_EXPO }
  },
  exit: { opacity: 0, y: 6, transition: { duration: 0.16, ease: EASE_OUT_EXPO } }
}
