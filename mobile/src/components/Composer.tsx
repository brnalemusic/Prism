import { useEffect, useRef, type ComponentRef } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'

interface ComposerProps {
  value: string
  onChangeText: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  modelLabel: string
  onOpenModel: () => void
  disabled?: boolean
  autoFocus?: boolean
  /** Increment to focus the input, e.g. after tapping a suggested prompt. */
  focusSignal?: number
  placeholder?: string
}

/**
 * The composer is the centre of the app, so it carries no toolbar chrome:
 * one text field, a quiet model selector and a single send/stop control.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  streaming,
  modelLabel,
  onOpenModel,
  disabled = false,
  autoFocus = false,
  focusSignal,
  placeholder = 'Ask anything…'
}: ComposerProps): React.JSX.Element {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null)
  const canSend = value.trim().length > 0 && !streaming && !disabled

  useEffect(() => {
    if (focusSignal && focusSignal > 0) inputRef.current?.focus()
  }, [focusSignal])

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View
        style={[
          styles.surface,
          { backgroundColor: theme.surfaceRaised, borderColor: theme.border }
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text }]}
          multiline
          autoFocus={autoFocus}
          editable={!disabled}
          maxLength={8000}
          selectionColor={theme.accent}
          textAlignVertical="top"
          accessibilityLabel="Message"
        />
        <View style={styles.toolbar}>
          <PressableScale
            onPress={onOpenModel}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel="Choose model"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={styles.modelButton}
          >
            <Ionicons name="sparkles" size={13} color={theme.accent} />
            <Text style={[styles.modelLabel, { color: theme.textSecondary }]} numberOfLines={1}>
              {modelLabel}
            </Text>
            <Ionicons name="chevron-down" size={12} color={theme.textMuted} />
          </PressableScale>

          {streaming ? (
            <PressableScale
              onPress={onStop}
              haptic="medium"
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              hitSlop={6}
              style={[
                styles.actionButton,
                { backgroundColor: theme.surfaceStrong, borderColor: theme.borderStrong }
              ]}
            >
              <Ionicons name="stop" size={15} color={theme.text} />
            </PressableScale>
          ) : (
            <PressableScale
              onPress={onSend}
              disabled={!canSend}
              haptic="medium"
              accessibilityRole="button"
              accessibilityLabel="Send message"
              hitSlop={6}
              style={[
                styles.actionButton,
                {
                  backgroundColor: canSend ? theme.accent : theme.surface,
                  borderColor: canSend ? theme.accent : theme.border
                }
              ]}
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={canSend ? theme.background : theme.textMuted}
              />
            </PressableScale>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm
  },
  surface: {
    borderRadius: radius.container,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm
  },
  input: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 28,
    maxHeight: 148,
    paddingTop: 2,
    paddingBottom: 6
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingRight: 4,
    maxWidth: 210
  },
  modelLabel: {
    ...typography.caption,
    fontSize: 12.5,
    fontWeight: '600',
    flexShrink: 1
  },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
