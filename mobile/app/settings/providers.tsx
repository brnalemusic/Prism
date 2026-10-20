import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { PROTOCOL_LABELS } from '../../src/ai/presets'
import { PrimaryButton } from '../../src/components/Buttons'
import { PressableScale } from '../../src/components/PressableScale'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import { useSettings, useTheme } from '../../src/state/settings'
import { radius, spacing, type as typography } from '../../src/theme/tokens'

export default function ProvidersScreen(): React.JSX.Element {
  const theme = useTheme()
  const { providers, defaultProviderId } = useSettings()

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader
          title="Providers"
          subtitle="Bring your own key — one per provider"
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {providers.length === 0 ? (
            <View style={styles.empty}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: theme.surface, borderColor: theme.border }
                ]}
              >
                <Ionicons name="key-outline" size={26} color={theme.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No providers yet</Text>
              <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
                Prism Mobile talks to Gemini, OpenAI-compatible endpoints and Anthropic directly
                from this device. Add a key to start.
              </Text>
            </View>
          ) : null}

          {providers.map((provider) => {
            const isDefault = provider.id === defaultProviderId
            return (
              <PressableScale
                key={provider.id}
                onPress={() =>
                  router.push({ pathname: '/settings/provider', params: { id: provider.id } })
                }
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel={`Edit ${provider.name}`}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardIdentity}>
                    <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>
                      {provider.name}
                    </Text>
                    <Text style={[styles.cardMeta, { color: theme.textMuted }]} numberOfLines={1}>
                      {PROTOCOL_LABELS[provider.protocol]}
                    </Text>
                  </View>
                  {isDefault ? (
                    <View style={[styles.defaultBadge, { backgroundColor: `${theme.accent}1F` }]}>
                      <Text style={[styles.defaultLabel, { color: theme.accent }]}>DEFAULT</Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
                </View>
                <Text style={[styles.cardUrl, { color: theme.textSecondary }]} numberOfLines={1}>
                  {provider.baseUrl || 'No base URL'}
                </Text>
                <Text style={[styles.cardModels, { color: theme.textMuted }]}>
                  {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'} ·{' '}
                  {provider.models
                    .slice(0, 2)
                    .map((model) => model.label)
                    .join(', ')}
                  {provider.models.length > 2 ? '…' : ''}
                </Text>
              </PressableScale>
            )
          })}

          <PrimaryButton
            label={providers.length === 0 ? 'Add your first provider' : 'Add another provider'}
            icon="add"
            onPress={() => router.push('/settings/provider')}
          />

          <Text style={[styles.footnote, { color: theme.textMuted }]}>
            Keys are stored in the iOS Keychain or Android Keystore and are only sent to the
            provider you configured.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.md
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs
  },
  emptyTitle: {
    ...typography.title,
    fontSize: 20
  },
  emptyBody: {
    ...typography.callout,
    textAlign: 'center'
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: 4
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  cardIdentity: {
    flex: 1,
    gap: 1
  },
  cardName: {
    ...typography.headline,
    fontSize: 16.5
  },
  cardMeta: {
    ...typography.caption,
    fontSize: 11.5
  },
  defaultBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  defaultLabel: {
    ...typography.micro,
    fontSize: 9
  },
  cardUrl: {
    ...typography.mono,
    fontSize: 11.5
  },
  cardModels: {
    ...typography.caption,
    fontSize: 12
  },
  footnote: {
    ...typography.caption,
    fontSize: 11.5,
    textAlign: 'center',
    paddingHorizontal: spacing.md
  }
})
