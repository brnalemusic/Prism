import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'

export type IconName = ComponentProps<typeof Ionicons>['name']

interface IconButtonProps {
  icon: IconName
  onPress: () => void
  label: string
  size?: number
  variant?: 'surface' | 'ghost' | 'accent'
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function IconButton({
  icon,
  onPress,
  label,
  size = 42,
  variant = 'surface',
  disabled,
  style
}: IconButtonProps): React.JSX.Element {
  const theme = useTheme()
  const backgroundColor =
    variant === 'accent' ? theme.accent : variant === 'surface' ? theme.surface : 'transparent'
  const iconColor = variant === 'accent' ? theme.background : theme.text

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          borderColor: variant === 'accent' ? 'transparent' : theme.border
        },
        style
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.46)} color={iconColor} />
    </PressableScale>
  )
}

interface PrimaryButtonProps {
  label: string
  onPress: () => void
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  variant?: 'accent' | 'surface' | 'danger'
  style?: StyleProp<ViewStyle>
  trailing?: ReactNode
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  loading,
  variant = 'accent',
  style,
  trailing
}: PrimaryButtonProps): React.JSX.Element {
  const theme = useTheme()
  const backgroundColor =
    variant === 'accent' ? theme.accent : variant === 'danger' ? theme.danger : theme.surface
  const foreground =
    variant === 'surface' ? theme.text : variant === 'danger' ? '#2A0507' : theme.background

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      haptic="medium"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.primary,
        {
          backgroundColor,
          borderColor: variant === 'surface' ? theme.borderStrong : 'transparent'
        },
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.primaryContent}>
          {icon ? <Ionicons name={icon} size={18} color={foreground} /> : null}
          <Text style={[styles.primaryLabel, { color: foreground }]} numberOfLines={1}>
            {label}
          </Text>
          {trailing}
        </View>
      )}
    </PressableScale>
  )
}

interface PillProps {
  label: string
  icon?: IconName
  active?: boolean
  onPress?: () => void
  tint?: string
}

export function Pill({ label, icon, active = false, onPress, tint }: PillProps): React.JSX.Element {
  const theme = useTheme()
  const color = tint ?? theme.accent
  const content = (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: active ? `${color}22` : theme.surface,
          borderColor: active ? `${color}66` : theme.border
        }
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={14} color={active ? color : theme.textSecondary} />
      ) : null}
      <Text
        style={[styles.pillLabel, { color: active ? color : theme.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )

  if (!onPress) return content
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {content}
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth
  },
  primary: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg
  },
  primaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  primaryLabel: {
    ...typography.headline,
    fontSize: 16
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220
  },
  pillLabel: {
    ...typography.caption,
    fontWeight: '600'
  }
})
