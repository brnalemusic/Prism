import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Keyboard, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

interface KeyboardAwareViewProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

/**
 * Prism Mobile draws edge-to-edge on Android, where `adjustResize` no longer
 * shrinks the window on Android 15+, while older devices still resize it. This
 * container measures how much of itself the keyboard actually covers and pads
 * only that overlap, so both behaviours end up with the same layout.
 *
 * Measuring also covers the case `KeyboardAvoidingView` misses: a screen that
 * mounts while the keyboard is already open (for example sending from home into
 * a new conversation) starts with the correct padding instead of waiting for
 * the next show event.
 */
export function KeyboardAwareView({ children, style }: KeyboardAwareViewProps): React.JSX.Element {
  const ref = useRef<ComponentRef<typeof View>>(null)
  const keyboardTop = useRef<number | null>(null)
  const [paddingBottom, setPaddingBottom] = useState(0)

  const syncPadding = useCallback(() => {
    const top = keyboardTop.current
    const node = ref.current
    if (top === null || !node) {
      setPaddingBottom(0)
      return
    }
    node.measureInWindow((_x, y, _width, height) => {
      setPaddingBottom(Math.max(0, Math.round(y + height - top)))
    })
  }, [])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    let settle: ReturnType<typeof setTimeout> | undefined
    const show = Keyboard.addListener(showEvent, (event) => {
      keyboardTop.current = event.endCoordinates.screenY
      syncPadding()
      // A device that still resizes its window finishes that layout one frame
      // later; re-measuring then collapses the temporary overlap to zero.
      requestAnimationFrame(syncPadding)
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null
      setPaddingBottom(0)
    })

    // Mounting under an open keyboard is common on Android: navigating from
    // home into a new chat keeps the IME up. Seed the measurement once the
    // first layout is committed.
    if (Keyboard.isVisible()) {
      keyboardTop.current = Keyboard.metrics()?.screenY ?? null
      requestAnimationFrame(syncPadding)
      // A navigation transition can still be translating the screen when the
      // first measurement runs, so correct the padding once it settles.
      settle = setTimeout(syncPadding, 400)
    }

    return () => {
      show.remove()
      hide.remove()
      if (settle) clearTimeout(settle)
    }
  }, [syncPadding])

  const handleLayout = useCallback(() => {
    if (keyboardTop.current !== null) syncPadding()
  }, [syncPadding])

  return (
    <View ref={ref} onLayout={handleLayout} style={[styles.root, style, { paddingBottom }]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
})
