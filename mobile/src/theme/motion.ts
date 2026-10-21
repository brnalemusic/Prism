import { Animated, Easing } from 'react-native'

/**
 * The motion vocabulary, ported from the desktop motion presets (DESIGN.md
 * §6.1–6.2). Everything here is transform/opacity only — native driver safe.
 */
export const EASING = {
  /** Rides in the front half of its duration: entrances that commit fast. */
  snappy: Easing.bezier(0.16, 1, 0.3, 1),
  outExpo: Easing.out(Easing.exp),
  inOutSine: Easing.inOut(Easing.sin),
  /** Press feedback: immediate, no linger. */
  pressOut: Easing.out(Easing.quad)
} as const

/** Durations in milliseconds (mirrors theme/tokens duration). */
export const DURATION = {
  press: 110,
  quick: 160,
  enter: 220,
  exit: 140,
  slow: 320
} as const

/**
 * Spring presets (DESIGN.md §6.2). All critically damped or near it — the
 * app has no bouncy overshoots, surfaces settle like glass.
 */
export const SPRING = {
  /** Bottom sheets and docked surfaces rising into place. */
  dockRise: { stiffness: 320, damping: 30, mass: 0.9 },
  /** Menus, sheets content and pop-overs. */
  menuPop: { stiffness: 460, damping: 32, mass: 0.8 },
  /** Press release: back to rest without overshoot. */
  press: { stiffness: 380, damping: 34, mass: 0.8 }
} as const

export type SpringPreset = keyof typeof SPRING

/** Start the default spring motion for an Animated value (native driven). */
export function springTo(value: Animated.Value, preset: SpringPreset, toValue: number): void {
  Animated.spring(value, {
    toValue,
    useNativeDriver: true,
    ...SPRING[preset]
  }).start()
}
