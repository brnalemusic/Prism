import { StyleSheet, View } from 'react-native'
import type { ReactNode } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '../state/settings'

interface ScreenBackgroundProps {
  children: ReactNode
  /** Adds the ambient accent light used on hero surfaces (home, onboarding). */
  ambient?: boolean
}

/**
 * Every Prism Mobile screen sits on the same deep gradient so navigation
 * transitions never flash a pale background between routes.
 */
export function ScreenBackground({
  children,
  ambient = false
}: ScreenBackgroundProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.backgroundTop, theme.background, theme.background]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      {ambient ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.orb, styles.orbTop, { backgroundColor: theme.glow }]}
          />
          <View
            pointerEvents="none"
            style={[styles.orb, styles.orbBottom, { backgroundColor: theme.glow }]}
          />
        </>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.9
  },
  orbTop: {
    width: 320,
    height: 320,
    top: -170,
    right: -120
  },
  orbBottom: {
    width: 260,
    height: 260,
    bottom: -160,
    left: -110,
    opacity: 0.55
  }
})
