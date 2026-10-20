import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { PROTOCOL_LABELS } from '../ai/presets'
import { useTheme } from '../state/settings'
import { useSettings } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'
import { Sheet } from './Sheet'

interface ModelSheetProps {
  visible: boolean
  onClose: () => void
  providerId: string | null
  modelId: string | null
  onSelect: (providerId: string, modelId: string) => void
  onManage: () => void
}

export function ModelSheet({
  visible,
  onClose,
  providerId,
  modelId,
  onSelect,
  onManage
}: ModelSheetProps): React.JSX.Element {
  const theme = useTheme()
  const { providers, setDefaultModel } = useSettings()

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Choose a model"
      subtitle="Switching applies to this conversation and becomes your default for new chats."
    >
      <ScrollView showsVerticalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {providers.map((provider) => (
          <View key={provider.id} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={[styles.groupName, { color: theme.textSecondary }]}>
                {provider.name}
              </Text>
              <Text style={[styles.groupMeta, { color: theme.textMuted }]}>
                {PROTOCOL_LABELS[provider.protocol]}
              </Text>
            </View>
            {provider.models.length === 0 ? (
              <Text style={[styles.empty, { color: theme.textMuted }]}>
                No models configured yet.
              </Text>
            ) : null}
            {provider.models.map((model) => {
              const selected = provider.id === providerId && model.id === modelId
              return (
                <PressableScale
                  key={`${provider.id}:${model.id}`}
                  onPress={() => {
                    onSelect(provider.id, model.id)
                    setDefaultModel(provider.id, model.id)
                    onClose()
                  }}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={`${provider.name} ${model.label}`}
                  style={[
                    styles.modelRow,
                    {
                      backgroundColor: selected ? `${theme.accent}14` : 'transparent',
                      borderColor: selected ? `${theme.accent}55` : theme.border
                    }
                  ]}
                >
                  <View style={styles.modelText}>
                    <Text style={[styles.modelLabel, { color: theme.text }]} numberOfLines={1}>
                      {model.label}
                    </Text>
                    {model.label !== model.id ? (
                      <Text style={[styles.modelId, { color: theme.textMuted }]} numberOfLines={1}>
                        {model.id}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={theme.textMuted} />
                  )}
                </PressableScale>
              )
            })}
          </View>
        ))}
      </ScrollView>

      <PressableScale
        onPress={() => {
          onClose()
          onManage()
        }}
        haptic="selection"
        accessibilityRole="button"
        accessibilityLabel="Manage providers"
        style={[styles.manage, { borderColor: theme.borderStrong }]}
      >
        <Ionicons name="key-outline" size={16} color={theme.text} />
        <Text style={[styles.manageLabel, { color: theme.text }]}>Manage providers & keys</Text>
      </PressableScale>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  group: {
    gap: 6,
    marginBottom: spacing.md
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: 2
  },
  groupName: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.3
  },
  groupMeta: {
    ...typography.caption,
    fontSize: 11
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11
  },
  modelText: {
    flex: 1,
    gap: 1
  },
  modelLabel: {
    ...typography.body,
    fontSize: 15
  },
  modelId: {
    ...typography.mono,
    fontSize: 11.5
  },
  empty: {
    ...typography.caption,
    paddingHorizontal: 2,
    paddingVertical: 6
  },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: 13
  },
  manageLabel: {
    ...typography.callout,
    fontWeight: '600'
  }
})
