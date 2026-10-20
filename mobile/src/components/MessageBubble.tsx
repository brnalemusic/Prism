import { memo, useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Ionicons } from '@expo/vector-icons'
import type { ChatMessage } from '../domain/types'
import { useTheme } from '../state/settings'
import { formatDuration } from '../lib/text'
import { radius, spacing, type as typography } from '../theme/tokens'
import { MarkdownBody } from './MarkdownBody'
import { PressableScale } from './PressableScale'
import { PrismMark } from './PrismMark'

interface MessageBubbleProps {
  message: ChatMessage
  onRetry?: () => void
}

function StreamingCaret({ color }: { color: string }): React.JSX.Element {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration: 520, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={[styles.caret, { backgroundColor: color, opacity }]} />
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onRetry
}: MessageBubbleProps): React.JSX.Element {
  const theme = useTheme()
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const showPlainText = isStreaming

  const copy = (): void => {
    void Clipboard.setStringAsync(message.content)
  }

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View
          style={[
            styles.userBubble,
            { backgroundColor: `${theme.accent}1A`, borderColor: `${theme.accent}40` }
          ]}
        >
          <Text style={[styles.userText, { color: theme.text }]} selectable>
            {message.content}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.assistantRow}>
      <View style={[styles.avatar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <PrismMark size={20} />
      </View>
      <View style={styles.assistantBody}>
        {isError ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: `${theme.danger}14`, borderColor: `${theme.danger}44` }
            ]}
          >
            <View style={styles.errorHeader}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
              <Text style={[styles.errorTitle, { color: theme.danger }]}>Request failed</Text>
            </View>
            <Text style={[styles.errorText, { color: theme.textSecondary }]}>
              {message.error ?? 'The model did not answer. Try again.'}
            </Text>
            {message.content ? (
              <Text style={[styles.errorText, { color: theme.textMuted }]} numberOfLines={4}>
                {message.content}
              </Text>
            ) : null}
            {onRetry ? (
              <PressableScale
                onPress={onRetry}
                haptic="medium"
                accessibilityRole="button"
                accessibilityLabel="Retry message"
                style={[styles.retryButton, { borderColor: `${theme.danger}66` }]}
              >
                <Ionicons name="refresh" size={14} color={theme.danger} />
                <Text style={[styles.retryLabel, { color: theme.danger }]}>Try again</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : showPlainText ? (
          <View style={styles.streamingTextWrap}>
            <Text
              style={[
                styles.streamingText,
                { color: message.content ? theme.text : theme.textMuted }
              ]}
              selectable
            >
              {message.content || 'Thinking…'}
            </Text>
            <StreamingCaret color={theme.accent} />
          </View>
        ) : (
          <MarkdownBody content={message.content} />
        )}

        {!isStreaming && !isError ? (
          <View style={styles.footer}>
            <Text style={[styles.meta, { color: theme.textMuted }]}>
              {message.status === 'stopped'
                ? 'Stopped'
                : message.durationMs
                  ? formatDuration(message.durationMs)
                  : ''}
            </Text>
            {message.content ? (
              <PressableScale
                onPress={copy}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel="Copy message"
                style={styles.footerAction}
              >
                <Ionicons name="copy-outline" size={14} color={theme.textMuted} />
                <Text style={[styles.meta, { color: theme.textMuted }]}>Copy</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  userRow: {
    alignItems: 'flex-end',
    paddingLeft: 48
  },
  userBubble: {
    maxWidth: '100%',
    borderRadius: radius.lg,
    borderTopRightRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11
  },
  userText: {
    ...typography.body,
    fontSize: 15.5
  },
  assistantRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingRight: spacing.md
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2
  },
  assistantBody: {
    flex: 1,
    paddingTop: 2
  },
  streamingTextWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end'
  },
  streamingText: {
    ...typography.body,
    fontSize: 15.5,
    lineHeight: 23,
    flexShrink: 1
  },
  caret: {
    width: 6,
    height: 15,
    borderRadius: 2,
    marginLeft: 3,
    marginBottom: 3
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    minHeight: 20
  },
  footerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  meta: {
    ...typography.caption,
    fontSize: 12
  },
  errorCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: 6
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  errorTitle: {
    ...typography.caption,
    fontWeight: '600'
  },
  errorText: {
    ...typography.callout,
    fontSize: 14,
    lineHeight: 20
  },
  retryButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: 2
  },
  retryLabel: {
    ...typography.caption,
    fontWeight: '600'
  }
})
