import { Platform, type TextStyle, type BoxShadowValue } from 'react-native'

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 44
} as const

/**
 * Radius scale. The semantic names mirror the desktop glass language
 * (DESIGN.md §4.1); the short numeric aliases below are kept for the
 * existing call sites and are migrated screen by screen.
 */
export const radius = {
  control: 10,
  card: 16,
  container: 24,
  sheet: 28,
  pill: 999,
  // Legacy aliases kept for existing call sites.
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28
} as const

/** Minimum target in points for every touchable control (DESIGN.md §8). */
export const hit = {
  minimum: 44
} as const

/**
 * Prism Mobile deliberately uses the platform text stack (SF Pro on iOS,
 * Roboto on Android) instead of shipping the desktop typeface: the phone
 * should read like a native app first and a brand object second.
 * (The desktop ships Geist/JetBrains as .woff2 only, which React Native
 * cannot load — see resources/docs/19_mobile_app.md §2.)
 */
export const font = Platform.select({
  ios: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
    mono: 'Menlo'
  },
  default: {
    regular: 'sans-serif',
    medium: 'sans-serif-medium',
    semibold: 'sans-serif-medium',
    bold: 'sans-serif',
    mono: 'monospace'
  }
}) as {
  regular: string
  medium: string
  semibold: string
  bold: string
  mono: string
}

export const type = {
  display: {
    fontFamily: font.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.9
  } satisfies TextStyle,
  title: {
    fontFamily: font.semibold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5
  } satisfies TextStyle,
  headline: {
    fontFamily: font.semibold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2
  } satisfies TextStyle,
  body: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.1
  } satisfies TextStyle,
  /** Long-form AI answers: slightly taller leading so code blocks breathe. */
  prose: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 25,
    letterSpacing: -0.1
  } satisfies TextStyle,
  callout: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 21
  } satisfies TextStyle,
  caption: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18
  } satisfies TextStyle,
  micro: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: 'uppercase'
  } satisfies TextStyle,
  mono: {
    fontFamily: font.mono,
    fontSize: 13,
    lineHeight: 19
  } satisfies TextStyle
} as const

/**
 * Motion vocabulary in milliseconds (DESIGN.md §6). Entrances are longer
 * than exits; press feedback lands in the first sixth of a beat.
 * The legacy fast/base keys are kept as fallbacks.
 */
export const duration = {
  press: 110,
  quick: 160,
  enter: 220,
  exit: 140,
  slow: 320,
  // Legacy aliases kept for existing call sites.
  fast: 160,
  base: 220
} as const

/**
 * Contact shadows expressed as RN boxShadow values (New Architecture renders
 * them on Android). Wide, low-opacity, no spread — elevation instead of glow.
 */
export const elevation: {
  sm: ReadonlyArray<BoxShadowValue>
  md: ReadonlyArray<BoxShadowValue>
  lg: ReadonlyArray<BoxShadowValue>
} = {
  sm: [{ offsetX: 0, offsetY: 6, blurRadius: 16, spreadDistance: -3, color: 'rgba(0, 6, 16, 0.42)' }],
  md: [{ offsetX: 0, offsetY: 12, blurRadius: 28, spreadDistance: -6, color: 'rgba(0, 6, 16, 0.48)' }],
  lg: [{ offsetX: 0, offsetY: 20, blurRadius: 40, spreadDistance: -8, color: 'rgba(0, 6, 16, 0.55)' }]
}
