import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'
import type { IconName } from './Buttons'

export function SectionLabel({
  children,
  style
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const theme = useTheme()
  return <Text style={[styles.label, { color: theme.textMuted }, style]}>{children}</Text>
}

export function Card({
  children,
  style
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
    >
      {children}
    </View>
  )
}

interface RowProps {
  icon?: IconName
  title: string
  subtitle?: string
  value?: string
  onPress?: () => void
  right?: ReactNode
  last?: boolean
  destructive?: boolean
  tint?: string
}

export function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  right,
  last = false,
  destructive = false,
  tint
}: RowProps): React.JSX.Element {
  const theme = useTheme()
  const titleColor = destructive ? theme.danger : theme.text

  const content = (
    <View
      style={[
        styles.row,
        !last
          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
          : null
      ]}
    >
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: `${tint ?? theme.accent}1F` }]}>
          <Ionicons
            name={icon}
            size={17}
            color={destructive ? theme.danger : (tint ?? theme.accent)}
          />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: theme.textMuted }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: theme.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right ??
        (onPress ? <Ionicons name="chevron-forward" size={17} color={theme.textMuted} /> : null)}
    </View>
  )

  if (!onPress) return content
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {content}
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  label: {
    ...typography.micro,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    minHeight: 54
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowText: {
    flex: 1,
    gap: 2
  },
  rowTitle: {
    ...typography.body,
    fontSize: 15.5,
    lineHeight: 21
  },
  rowSubtitle: {
    ...typography.caption
  },
  value: {
    ...typography.caption,
    maxWidth: 120
  }
})
