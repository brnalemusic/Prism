import { useEffect, useId, useRef } from 'react'
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '../state/settings'
import { EASING } from '../theme/motion'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface AuraLayerProps {
  /** Ambient keeps the desktop calibration; hero pushes the light sources. */
  intensity: 'ambient' | 'hero'
}

interface OrbGeometry {
  left: DimensionValue
  top: DimensionValue
  width: DimensionValue
  height: DimensionValue
  /** Peak stop alpha (ambient calibration), lifted from the desktop recipe. */
  peak: number
  /** Full breathe cycle in ms; null leaves the orb at rest. */
  cycle: number | null
}

const ORBS: OrbGeometry[] = [
  { left: '35%', top: '-15%', width: '55%', height: '55%', peak: 0.26, cycle: 12000 },
  { left: '15%', top: '60%', width: '60%', height: '60%', peak: 0.22, cycle: 16000 },
  { left: '-10%', top: '20%', width: '35%', height: '50%', peak: 0.18, cycle: null }
]

const PULSE_FLOOR = 0.55
const HERO_GAIN = 1.45
/** Reduced motion: auras sit at a calm mid value instead of breathing. */
const RESTING_OPACITY = 0.8

function AuraOrb({
  color,
  geometry,
  strong
}: {
  color: string
  geometry: OrbGeometry
  strong: boolean
}): React.JSX.Element {
  const rawId = useId()
  const gradientId = `aura-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const breath = useRef(new Animated.Value(RESTING_OPACITY)).current
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced || !geometry.cycle) {
      breath.setValue(RESTING_OPACITY)
      return
    }
    const half = geometry.cycle / 2
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: PULSE_FLOOR,
          duration: half,
          easing: EASING.inOutSine,
          useNativeDriver: true
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: half,
          easing: EASING.inOutSine,
          useNativeDriver: true
        })
      ])
    )
    breathe.start()
    return () => {
      breathe.stop()
    }
  }, [breath, geometry.cycle, reduced])

  const peak = strong ? geometry.peak * HERO_GAIN : geometry.peak
  const { left, top, width, height } = geometry

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.orb, { left, top, width, height }, { opacity: breath }]}
    >
      <Svg style={styles.field} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={gradientId} cx="50" cy="50" r="50">
            <Stop offset="0" stopColor={color} stopOpacity={peak} />
            <Stop offset="0.55" stopColor={color} stopOpacity={peak * 0.45} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  )
}

/**
 * The Prism atmosphere (DESIGN.md §7.12) redrawn for native: three auratic
 * light sources with the same geometry as the desktop background, breathing
 * on 12 s / 16 s cycles. CSS blur is unnecessary here — the radial falloff
 * itself carries the softness, and opacity runs on the native driver.
 */
export function AuraLayer({ intensity }: AuraLayerProps): React.JSX.Element {
  const theme = useTheme()
  const strong = intensity === 'hero'
  const orbs = ORBS.map((geometry, index) => {
    const color = index === 1 ? theme.aura2 : theme.aura1
    return <AuraOrb key={index} color={color} geometry={geometry} strong={strong} />
  })
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {orbs}
    </View>
  )
}

const styles = StyleSheet.create({
  orb: {
    position: 'absolute'
  },
  field: {
    flex: 1
  }
})
