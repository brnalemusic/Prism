import type { ReactNode } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { useTheme } from '../state/settings'
import { radius } from '../theme/tokens'

interface GlassSurfaceProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  radiusSize?: number
  /** iOS blur intensity; Android falls back to the themed solid surface. */
  intensity?: number
  bordered?: boolean
}

/**
 * Prism's glass language, translated for touch: real blur on iOS, a tuned
 * translucent solid on Android where live blur costs battery for little gain.
 */
export function GlassSurface({
  children,
  style,
  radiusSize = radius.lg,
  intensity = 36,
  bordered = true
}: GlassSurfaceProps): React.JSX.Element {
  const theme = useTheme()
  const border = bordered
    ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong }
    : null

  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={intensity}
        tint="dark"
        style={[
          styles.base,
          { borderRadius: radiusSize, backgroundColor: theme.surface },
          border,
          style
        ]}
      >
        {children}
      </BlurView>
    )
  }

  return (
    <View
      style={[
        styles.base,
        { borderRadius: radiusSize, backgroundColor: theme.surfaceStrong },
        border,
        style
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden'
  }
})
