import { Platform, type TextStyle } from 'react-native'

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 44
} as const

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999
} as const

export const hit = {
  minimum: 44
} as const

/**
 * Prism Mobile deliberately uses the platform text stack (SF Pro on iOS,
 * Roboto on Android) instead of shipping the desktop typeface: the phone
 * should read like a native app first and a brand object second.
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

export const duration = {
  fast: 160,
  base: 240,
  slow: 380
} as const
