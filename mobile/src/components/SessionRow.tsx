import { StyleSheet, Text } from 'react-native'
import type { ChatSession } from '../domain/types'
import { useTheme } from '../state/settings'
import { spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'

interface SessionRowProps {
  session: ChatSession
  active?: boolean
  onPress: () => void
  onLongPress: () => void
}

/**
 * History rows stay intentionally plain: one line of title, no model badges
 * or timestamps. The drawer should scan like a list of thoughts, not a
 * dashboard.
 */
export function SessionRow({
  session,
  active = false,
  onPress,
  onLongPress
}: SessionRowProps): React.JSX.Element {
  const theme = useTheme()

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={session.title}
      accessibilityHint="Long press to delete this conversation"
      style={[styles.row, active ? { backgroundColor: `${theme.accent}14` } : null]}
    >
      <Text style={[styles.title, { color: active ? theme.accent : theme.text }]} numberOfLines={1}>
        {session.title}
      </Text>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 10,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: 'center'
  },
  title: {
    ...typography.callout,
    fontSize: 14.5,
    lineHeight: 19
  }
})
