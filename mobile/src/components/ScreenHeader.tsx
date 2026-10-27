import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../state/settings'
import { spacing, type as typography } from '../theme/tokens'
import { IconButton } from './Buttons'

interface ScreenHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: ReactNode
  centerTitle?: boolean
  backVariant?: 'surface' | 'ghost'
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  centerTitle = false,
  backVariant = 'surface'
}: ScreenHeaderProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.root}>
      <View style={styles.side}>
        {onBack ? (
          <IconButton icon="chevron-back" label="Go back" onPress={onBack} variant={backVariant} />
        ) : null}
      </View>
      <View style={[styles.titleBlock, centerTitle ? styles.centered : null]}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.rightSide]}>{right}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm
  },
  side: {
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center'
  },
  rightSide: {
    justifyContent: 'flex-end',
    gap: spacing.sm
  },
  titleBlock: {
    flex: 1,
    gap: 1
  },
  centered: {
    alignItems: 'center'
  },
  title: {
    ...typography.headline
  },
  subtitle: {
    ...typography.caption
  }
})
