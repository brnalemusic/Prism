import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, type StyleProp, type ViewStyle } from 'react-native'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { DURATION, EASING } from '../theme/motion'

interface FadeSlideInProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /** Stagger delay in ms when several items mount together (40 ms max 10). */
  delay?: number
  /** Resting slide distance in points. Defaults to 10. */
  offset?: number
}

/**
 * Shared enter primitive for rows, cards and chat turns: fade in from
 * { opacity 0, y 10, scale 0.98 } to rest in 220 ms with the snappy curve.
 * There is no symmetric exit — React Native has no removal hook, so lists
 * drop items instantly; screens that need exits animate them explicitly.
 */
export function FadeSlideIn({
  children,
  style,
  delay = 0,
  offset = 10
}: FadeSlideInProps): React.JSX.Element {
  const progress = useRef(new Animated.Value(0)).current
  const reduced = useReducedMotion()

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 120 : DURATION.enter,
      delay: reduced ? 0 : delay,
      easing: reduced ? EASING.outExpo : EASING.snappy,
      useNativeDriver: true
    })
    animation.start()
    return () => {
      animation.stop()
    }
  }, [delay, progress, reduced])

  // Reduced motion: cross-fade only, never transform.
  const opacity = progress
  const transform = reduced
    ? []
    : [
        {
          translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] })
        },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }
      ]

  return (
    <Animated.View style={[style as StyleProp<ViewStyle>, { opacity }, { transform }]}>
      {children}
    </Animated.View>
  )
}
