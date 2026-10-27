import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { DURATION, EASING, SPRING } from '../theme/motion'

type HapticStyle = 'none' | 'light' | 'medium' | 'selection'

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  scaleTo?: number
  haptic?: HapticStyle
}

/** Dimming applied on press-in so the glass tones down, not just shrinks. */
const PRESS_DIM = 0.92
const DISABLED_DIM = 0.45

/**
 * The press bar is a single animated Pressable so the caller's `style` keeps
 * plain Pressable semantics: layout props (flex, margin, width) resolve
 * against the parent AND content props (row direction, padding, background)
 * apply to the direct children. An intermediate wrapper view would swallow
 * those props and collapse flex children to content width.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

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
 * The single press surface used across the app. Feedback lands on press-in
 * (scale into 0.96 + dim, within 110 ms), release springs back with the
 * critically damped `press` preset so surfaces settle like glass instead of
 * bouncing. Reduce motion keeps the dim and drops the scale.
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
  const dim = useRef(new Animated.Value(1)).current
  const reduced = useReducedMotion()

  useEffect(() => {
    if (disabled) dim.setValue(DISABLED_DIM)
  }, [disabled, dim])

  const press = (): void => {
    const steps: Array<Animated.CompositeAnimation> = [
      Animated.timing(dim, {
        toValue: PRESS_DIM,
        duration: DURATION.press,
        easing: EASING.pressOut,
        useNativeDriver: true
      })
    ]
    if (!reduced) {
      steps.push(
        Animated.timing(scale, {
          toValue: scaleTo,
          duration: DURATION.press,
          easing: EASING.pressOut,
          useNativeDriver: true
        })
      )
    }
    Animated.parallel(steps).start()
  }

  const release = (): void => {
    const steps: Array<Animated.CompositeAnimation> = [
      Animated.timing(dim, {
        toValue: 1,
        duration: DURATION.exit,
        easing: EASING.outExpo,
        useNativeDriver: true
      })
    ]
    if (!reduced) {
      steps.push(Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...SPRING.press }))
    }
    Animated.parallel(steps).start()
  }

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, { opacity: dim }, reduced ? null : { transform: [{ scale }] }]}
      onPressIn={(event) => {
        if (!disabled) {
          press()
          fireHaptic(haptic)
        }
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        if (!disabled) release()
        onPressOut?.(event)
      }}
    >
      {children}
    </AnimatedPressable>
  )
}
