export type ThemeKey = 'marine' | 'fire' | 'lava' | 'gold' | 'forest' | 'indigo' | 'violet' | 'mono'

export interface ThemePalette {
  key: ThemeKey
  name: string
  tagline: string
  accent: string
  accentSoft: string
  accentDeep: string
  glow: string
  background: string
  backgroundTop: string
  surface: string
  surfaceStrong: string
  surfaceRaised: string
  border: string
  borderStrong: string
  text: string
  textSecondary: string
  textMuted: string
  danger: string
  success: string
}

/**
 * Prism Mobile is dark-first on purpose: OLED phones, thumb-first reading
 * at night, and one continuous "glass over deep space" surface per theme.
 * The accents follow the desktop spectral themes so both apps feel like the
 * same family, while the surfaces are tuned for a phone rather than a desktop.
 */
export const THEMES: Record<ThemeKey, ThemePalette> = {
  marine: {
    key: 'marine',
    name: 'Marine',
    tagline: 'Deep ocean glass',
    accent: '#38BDF8',
    accentSoft: '#7DD3FC',
    accentDeep: '#0C4A6E',
    glow: 'rgba(56, 189, 248, 0.20)',
    background: '#030D15',
    backgroundTop: '#061A26',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(9, 30, 43, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#F4FBFF',
    textSecondary: 'rgba(226, 243, 255, 0.72)',
    textMuted: 'rgba(198, 226, 243, 0.48)',
    danger: '#FB7185',
    success: '#4ADE80'
  },
  fire: {
    key: 'fire',
    name: 'Fire Red',
    tagline: 'Crimson ember',
    accent: '#FF3B2F',
    accentSoft: '#FF6B35',
    accentDeep: '#5B110C',
    glow: 'rgba(255, 59, 47, 0.20)',
    background: '#150607',
    backgroundTop: '#25090A',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(38, 10, 11, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#FFF6F4',
    textSecondary: 'rgba(255, 231, 226, 0.72)',
    textMuted: 'rgba(255, 214, 205, 0.46)',
    danger: '#FCA5A5',
    success: '#4ADE80'
  },
  lava: {
    key: 'lava',
    name: 'Lava Orange',
    tagline: 'Amber heat',
    accent: '#FF6B00',
    accentSoft: '#FFAE42',
    accentDeep: '#5A2500',
    glow: 'rgba(255, 107, 0, 0.20)',
    background: '#160900',
    backgroundTop: '#261100',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(40, 18, 3, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#FFF8F1',
    textSecondary: 'rgba(255, 237, 218, 0.74)',
    textMuted: 'rgba(255, 224, 194, 0.46)',
    danger: '#FB923C',
    success: '#4ADE80'
  },
  gold: {
    key: 'gold',
    name: 'Corporate Gold',
    tagline: 'Champagne executive',
    accent: '#F5C518',
    accentSoft: '#FFE066',
    accentDeep: '#4A3700',
    glow: 'rgba(245, 197, 24, 0.18)',
    background: '#151100',
    backgroundTop: '#221A00',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(35, 28, 4, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#FFFDF2',
    textSecondary: 'rgba(255, 246, 210, 0.74)',
    textMuted: 'rgba(255, 240, 184, 0.46)',
    danger: '#FB7185',
    success: '#4ADE80'
  },
  forest: {
    key: 'forest',
    name: 'Forest Green',
    tagline: 'Emerald mint',
    accent: '#22C55E',
    accentSoft: '#86EFAC',
    accentDeep: '#06381B',
    glow: 'rgba(34, 197, 94, 0.18)',
    background: '#04120A',
    backgroundTop: '#082115',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(8, 32, 20, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#F3FFF7',
    textSecondary: 'rgba(222, 255, 235, 0.72)',
    textMuted: 'rgba(191, 240, 209, 0.46)',
    danger: '#FB7185',
    success: '#86EFAC'
  },
  indigo: {
    key: 'indigo',
    name: 'Indigo',
    tagline: 'Sapphire twilight',
    accent: '#6366F1',
    accentSoft: '#A5B4FC',
    accentDeep: '#1E1B70',
    glow: 'rgba(99, 102, 241, 0.22)',
    background: '#070918',
    backgroundTop: '#0E1230',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(15, 18, 45, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#F5F6FF',
    textSecondary: 'rgba(228, 230, 255, 0.72)',
    textMuted: 'rgba(204, 208, 255, 0.46)',
    danger: '#FB7185',
    success: '#4ADE80'
  },
  violet: {
    key: 'violet',
    name: 'Soft Violet',
    tagline: 'Amethyst orchid',
    accent: '#A855F7',
    accentSoft: '#D8B4FE',
    accentDeep: '#43126B',
    glow: 'rgba(168, 85, 247, 0.20)',
    background: '#100718',
    backgroundTop: '#1C0C2A',
    surface: 'rgba(255, 255, 255, 0.055)',
    surfaceStrong: 'rgba(28, 12, 42, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#FCF6FF',
    textSecondary: 'rgba(243, 229, 255, 0.72)',
    textMuted: 'rgba(226, 202, 255, 0.46)',
    danger: '#FB7185',
    success: '#4ADE80'
  },
  mono: {
    key: 'mono',
    name: 'Classic White',
    tagline: 'Pure monochrome',
    accent: '#FFFFFF',
    accentSoft: '#E4E4E7',
    accentDeep: '#27272A',
    glow: 'rgba(255, 255, 255, 0.14)',
    background: '#080808',
    backgroundTop: '#141414',
    surface: 'rgba(255, 255, 255, 0.06)',
    surfaceStrong: 'rgba(20, 20, 22, 0.94)',
    surfaceRaised: 'rgba(255, 255, 255, 0.10)',
    border: 'rgba(255, 255, 255, 0.10)',
    borderStrong: 'rgba(255, 255, 255, 0.20)',
    text: '#FAFAFA',
    textSecondary: 'rgba(244, 244, 245, 0.72)',
    textMuted: 'rgba(228, 228, 231, 0.46)',
    danger: '#FB7185',
    success: '#4ADE80'
  }
}

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[]

export const THEME_LIST: ThemePalette[] = THEME_KEYS.map((key) => THEMES[key])

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEMES, value)
}

export const DEFAULT_THEME: ThemeKey = 'marine'
