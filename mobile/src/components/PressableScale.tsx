import { useRef } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import * as Haptics from 'expo-haptics'

type HapticStyle = 'none' | 'light' | 'medium' | 'selection'

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  scaleTo?: number
  haptic?: HapticStyle
}

function fireHaptic(style: HapticStyle): void {
  if (style === 'none') return
  const promise =
    style === 'selection'
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(
          style === 'medium'
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light
        )
  void promise.catch(() => undefined)
}

/**
 * The single press surface used across the app: native spring feedback plus
 * a haptic tick, so controls feel physical instead of web-like.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  haptic = 'none',
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps): React.JSX.Element {
  const scale = useRef(new Animated.Value(1)).current

  const animate = (to: number): void => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4
    }).start()
  }

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) {
          animate(scaleTo)
          fireHaptic(haptic)
        }
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        animate(1)
        onPressOut?.(event)
      }}
    >
      <Animated.View
        style={[style, { transform: [{ scale }] }, disabled ? { opacity: 0.45 } : null]}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}
