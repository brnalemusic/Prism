import { type ReactNode } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '../state/settings'
import { elevation, radius as radiusScale } from '../theme/tokens'
import { GlassRim } from './GlassRim'
import { useGlassBlurTarget } from './BlurTarget'

export type GlassVariant = 'bar' | 'card' | 'sheet' | 'floating' | 'composer'

interface GlassSurfaceProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  variant?: GlassVariant
  /** Legacy control kept for existing call sites; overrides the variant radius. */
  radiusSize?: number
  /** Legacy blur strength kept for existing call sites (iOS grade 0–100). */
  intensity?: number
  bordered?: boolean
  /** Spectral rim dispersion (faint cyan/magenta strokes). */
  chromatic?: boolean
  /** Contact shadow for surfaces that float above the screen content. */
  elevated?: boolean
}

/** Defaults per variant; explicit legacy props always win over these. */
const VARIANT_RADIUS: Record<GlassVariant, number> = {
  bar: radiusScale.pill,
  card: radiusScale.card,
  sheet: radiusScale.sheet,
  floating: radiusScale.container,
  composer: radiusScale.container
}

const VARIANT_INTENSITY: Record<GlassVariant, number> = {
  bar: 60,
  card: 36,
  sheet: 52,
  floating: 46,
  composer: 46
}

/**
 * Prism's glass language, translated for touch. There is no CSS backdrop
 * filter in React Native, so "liquid glass" is a four-layer composite:
 *
 *   L0  BlurView backdrop — real live blur (Android 12+ RenderEffect)
 *   L1  tint gradient — the material's thickness, thinnest at the top
 *   L2  spectral rim — chromatic dispersion + specular edge (GlassRim)
 *   L3  content
 *
 * On Android below SDK 31 the blur method degrades to a static tint
 * automatically and the layers above keep the glass reading correctly.
 */
export function GlassSurface({
  children,
  style,
  variant = 'card',
  radiusSize,
  intensity,
  bordered = true,
  chromatic = false,
  elevated = false
}: GlassSurfaceProps): React.JSX.Element {
  const theme = useTheme()
  const effectiveRadius = radiusSize ?? VARIANT_RADIUS[variant]
  const effectiveIntensity = intensity ?? VARIANT_INTENSITY[variant]
  // Dimezis blur only when a blur target exists (expo-blur v58 contract);
  // without one it renders a warning and silently degrades to "none".
  const blurTarget = useGlassBlurTarget()
  const blurMethod =
    Platform.OS === 'android' ? (blurTarget ? 'dimezisBlurViewSdk31Plus' : 'none') : 'none'

  const blur = (
    <BlurView
      style={[StyleSheet.absoluteFill, { borderRadius: effectiveRadius }]}
      intensity={effectiveIntensity}
      tint="dark"
      blurTarget={blurTarget}
      blurMethod={blurMethod}
      pointerEvents="none"
    />
  )

  return (
    <View
      style={[
        styles.shell,
        { borderRadius: effectiveRadius },
        elevated ? { boxShadow: elevation.md } : null,
        style
      ]}
    >
      {blur}
      <LinearGradient
        colors={[theme.glassTint, theme.glassTintStrong]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <GlassRim radius={effectiveRadius} strong={chromatic} />
      {children}
      {bordered ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: effectiveRadius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.borderStrong
            }
          ]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden'
  }
})
