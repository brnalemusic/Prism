import { useId, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '../state/settings'
import { AuraLayer } from './AuraLayer'

export type ScreenVariant = 'flat' | 'ambient' | 'hero'

interface ScreenBackgroundProps {
  children: ReactNode
  /** Kept for the pre-variant call sites: `ambient` ≡ variant "ambient". */
  ambient?: boolean
  variant?: ScreenVariant
}

function cleanId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '')
}

/**
 * Every Prism Mobile screen sits on the same atmosphere so navigation
 * transitions never flash a pale background between routes:
 *
 *   1. The drifting base radial (ellipse at 50% -10%, aura3 → base → black)
 *   2. Ambient/hero: the three themed aura orbs (two breathing, AuraLayer)
 *   3. Hero only: a center vignette that anchors content toward the middle
 *
 * The desktop grain veil is intentionally not ported: react-native-svg
 * cannot render feTurbulence filters on Android, and vignette + auras carry
 * the same depth for a fraction of the cost.
 */
export function ScreenBackground({
  children,
  ambient,
  variant
}: ScreenBackgroundProps): React.JSX.Element {
  const theme = useTheme()
  const resolved: ScreenVariant = variant ?? (ambient ? 'ambient' : 'flat')
  const suffix = cleanId(useId())
  const baseGradientId = `base-${suffix}`
  const vignetteGradientId = `vignette-${suffix}`

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg style={styles.field} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={baseGradientId} cx="50" cy="-10" rx="50" ry="110">
              <Stop offset="0" stopColor={theme.aura3} stopOpacity={1} />
              <Stop offset="0.5" stopColor={theme.background} stopOpacity={1} />
              <Stop offset="1" stopColor="#000000" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill={`url(#${baseGradientId})`} />
        </Svg>
      </View>
      {resolved !== 'flat' ? <AuraLayer intensity={resolved} /> : null}
      {resolved === 'hero' ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg style={styles.field} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <RadialGradient id={vignetteGradientId} cx="50" cy="50" r="70.7">
                <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0.42} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill={`url(#${vignetteGradientId})`} />
          </Svg>
        </View>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  field: {
    flex: 1
  }
})
