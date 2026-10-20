import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { GlassSurface } from './GlassSurface'
import { PressableScale } from './PressableScale'

interface ComposerProps {
  value: string
  onChangeText: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  modelLabel: string
  providerLabel: string
  onOpenModel: () => void
  disabled?: boolean
  autoFocus?: boolean
}

export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  streaming,
  modelLabel,
  providerLabel,
  onOpenModel,
  disabled = false,
  autoFocus = false
}: ComposerProps): React.JSX.Element {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const canSend = value.trim().length > 0 && !streaming && !disabled

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <GlassSurface radiusSize={radius.xl} intensity={46} style={styles.surface}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Ask anything…"
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
            style={[
              styles.modelButton,
              { backgroundColor: theme.surface, borderColor: theme.border }
            ]}
          >
            <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
            <Text style={[styles.modelLabel, { color: theme.textSecondary }]} numberOfLines={1}>
              {modelLabel}
            </Text>
            <Ionicons name="chevron-up" size={13} color={theme.textMuted} />
          </PressableScale>

          <Text style={[styles.provider, { color: theme.textMuted }]} numberOfLines={1}>
            {providerLabel}
          </Text>

          {streaming ? (
            <PressableScale
              onPress={onStop}
              haptic="medium"
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              style={[
                styles.actionButton,
                { backgroundColor: theme.surfaceRaised, borderColor: theme.borderStrong }
              ]}
            >
              <Ionicons name="stop" size={18} color={theme.text} />
            </PressableScale>
          ) : (
            <PressableScale
              onPress={onSend}
              disabled={!canSend}
              haptic="medium"
              accessibilityRole="button"
              accessibilityLabel="Send message"
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
                size={20}
                color={canSend ? theme.background : theme.textMuted}
              />
            </PressableScale>
          )}
        </View>
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm
  },
  surface: {
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 8
  },
  input: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 40,
    maxHeight: 148,
    paddingTop: 4,
    paddingBottom: 4
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 190
  },
  modelLabel: {
    ...typography.caption,
    fontWeight: '600',
    flexShrink: 1
  },
  provider: {
    ...typography.caption,
    fontSize: 11.5,
    flex: 1
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
