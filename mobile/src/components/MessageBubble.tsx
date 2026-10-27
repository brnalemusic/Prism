import { memo, useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Ionicons } from '@expo/vector-icons'
import type { ChatMessage } from '../domain/types'
import { useTheme } from '../state/settings'
import { spacing, type as typography } from '../theme/tokens'
import { MarkdownBody } from './MarkdownBody'
import { PressableScale } from './PressableScale'

interface MessageBubbleProps {
  message: ChatMessage
  onRetry?: () => void
  onRegenerate?: () => void
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
  onRetry,
  onRegenerate
}: MessageBubbleProps): React.JSX.Element {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const copy = (): void => {
    void Clipboard.setStringAsync(message.content)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
  }

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View
          style={[
            styles.userBubble,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border }
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
      ) : isStreaming ? (
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
        <View style={styles.actions}>
          {message.status === 'stopped' ? (
            <Text style={[styles.meta, { color: theme.textMuted }]}>Stopped</Text>
          ) : null}
          <View style={styles.actionSpacer} />
          {message.content ? (
            <PressableScale
              onPress={copy}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied' : 'Copy message'}
              hitSlop={4}
              style={styles.action}
              scaleTo={0.9}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={15}
                color={copied ? theme.success : theme.textMuted}
              />
            </PressableScale>
          ) : null}
          {onRegenerate ? (
            <PressableScale
              onPress={onRegenerate}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel="Regenerate answer"
              hitSlop={4}
              style={styles.action}
              scaleTo={0.9}
            >
              <Ionicons name="refresh" size={15} color={theme.textMuted} />
            </PressableScale>
          ) : null}
        </View>
      ) : null}
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10
  },
  userText: {
    ...typography.body,
    fontSize: 15.5,
    lineHeight: 22
  },
  assistantRow: {
    width: '100%'
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.sm,
    minHeight: 26
  },
  actionSpacer: {
    flex: 1
  },
  action: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15
  },
  meta: {
    ...typography.caption,
    fontSize: 12
  },
  errorCard: {
    borderRadius: 16,
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
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: 2
  },
  retryLabel: {
    ...typography.caption,
    fontWeight: '600'
  }
})
