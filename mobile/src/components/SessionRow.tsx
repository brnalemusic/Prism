import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ChatSession } from '../domain/types'
import { formatRelativeTime } from '../lib/text'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'

interface SessionRowProps {
  session: ChatSession
  modelLabel: string
  onPress: () => void
  onLongPress: () => void
}

export function SessionRow({
  session,
  modelLabel,
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
      style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: `${theme.accent}33` }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={theme.accent} />
        </View>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={[styles.time, { color: theme.textMuted }]}>
          {formatRelativeTime(session.updatedAt)}
        </Text>
      </View>
      {session.preview ? (
        <Text style={[styles.preview, { color: theme.textSecondary }]} numberOfLines={2}>
          {session.preview}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <Text style={[styles.model, { color: theme.textMuted }]} numberOfLines={1}>
          {modelLabel}
        </Text>
        <Text style={[styles.count, { color: theme.textMuted }]}>
          {session.messageCount > 0 ? `${Math.ceil(session.messageCount / 2)} turns` : 'empty'}
        </Text>
      </View>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  row: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: 6
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    ...typography.headline,
    fontSize: 16,
    flex: 1
  },
  time: {
    ...typography.caption,
    fontSize: 12
  },
  preview: {
    ...typography.callout,
    fontSize: 14,
    lineHeight: 20,
    paddingLeft: 34
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 34,
    gap: spacing.md
  },
  model: {
    ...typography.caption,
    fontSize: 11.5,
    flex: 1
  },
  count: {
    ...typography.caption,
    fontSize: 11.5
  }
})
