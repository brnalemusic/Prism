import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Tracks whether the soft keyboard is on screen. Surfaces that sit against the
 * bottom edge use this to trade their safe-area padding for keyboard spacing
 * instead of leaving an extra navigation-bar gap above the keyboard.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible())

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, () => setVisible(true))
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return visible
}
