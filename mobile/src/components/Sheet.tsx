import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { GlassSurface } from './GlassSurface'

interface SheetProps {
  visible: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
  maxHeightRatio?: number
}

/**
 * One sheet primitive for model picking, renaming and confirmations so every
 * overlay in the app enters the same way and is dismissed by tapping outside.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightRatio = 0.72
}: SheetProps): React.JSX.Element {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const translate = useRef(new Animated.Value(36)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    translate.setValue(36)
    opacity.setValue(0)
    Animated.parallel([
      Animated.spring(translate, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 5 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true })
    ]).start()
  }, [visible, opacity, translate])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.58)' }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <Animated.View
          style={{
            opacity,
            transform: [{ translateY: translate }],
            paddingBottom: Math.max(insets.bottom, spacing.md),
            paddingHorizontal: spacing.md
          }}
        >
          <GlassSurface
            radiusSize={radius.xl}
            intensity={52}
            style={{
              padding: spacing.lg,
              maxHeight: `${Math.round(maxHeightRatio * 100)}%` as const
            }}
          >
            <View style={[styles.handle, { backgroundColor: theme.borderStrong }]} />
            {title ? (
              <View style={{ gap: 2, marginBottom: spacing.md }}>
                <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
                {subtitle ? (
                  <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
                ) : null}
              </View>
            ) : null}
            {children}
          </GlassSurface>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md
  },
  title: {
    ...typography.headline
  },
  subtitle: {
    ...typography.caption
  }
})
