import { type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '../state/settings'
import { elevation, radius as radiusScale } from '../theme/tokens'
import { GlassRim } from './GlassRim'

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
 *   L0  BlurView backdrop — live blur on iOS; on Android expo-blur renders
 *       a translucent surface ("none" method)
 *   L1  tint gradient — the material's thickness, thinnest at the top
 *   L2  spectral rim — chromatic dispersion + specular edge (GlassRim)
 *   L3  content
 *
 * Android's dimezis blur method is intentionally not enabled: when the
 * blur target subtree contains the glass surfaces themselves, the GPU
 * render tree preparation recurses without bound and the RenderThread
 * crashes with a stack overflow (SIGSEGV traced down to
 * RenderNode::prepareTreeImpl). The tint layers above keep the glass
 * reading correctly without it.
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

  const blur = (
    <BlurView
      style={[StyleSheet.absoluteFill, { borderRadius: effectiveRadius }]}
      intensity={effectiveIntensity}
      tint="dark"
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
