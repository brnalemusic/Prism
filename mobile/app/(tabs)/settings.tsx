import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { Card, Row, SectionLabel } from '../../src/components/Section'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ThemeRow, themeLabel } from '../../src/components/ThemePicker'
import { modelLabel } from '../../src/lib/models'
import { useSessions } from '../../src/state/sessions'
import { useSettings, useTheme } from '../../src/state/settings'
import { useUpdates } from '../../src/state/updates'
import { spacing, type as typography } from '../../src/theme/tokens'

export default function SettingsScreen(): React.JSX.Element {
  const theme = useTheme()
  const { providers, themeKey, defaultProviderId, defaultModelId } = useSettings()
  const { clearHistory, sessions } = useSessions()
  const { status: updateStatus, release, openSheet } = useUpdates()

  const version = Constants.expoConfig?.version ?? '0.0.0'
  const defaultModel = providers.length
    ? modelLabel(providers, defaultProviderId, defaultModelId)
    : 'Not configured'

  const confirmClear = (): void => {
    Alert.alert(
      'Clear conversation history?',
      `All ${sessions.length} sessions on this device will be deleted. Providers and keys stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear everything', style: 'destructive', onPress: () => void clearHistory() }
      ]
    )
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Settings</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            Keys, models and the look of your pocket copilot.
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <SectionLabel>AI PROVIDERS</SectionLabel>
            <Card>
              <Row
                icon="key-outline"
                title="Providers & API keys"
                subtitle={
                  providers.length === 0
                    ? 'Add your first provider to start chatting'
                    : providers.map((provider) => provider.name).join(' · ')
                }
                value={providers.length === 0 ? 'Add' : `${providers.length}`}
                onPress={() => router.push('/settings/providers')}
              />
              <Row
                icon="sparkles-outline"
                title="Default model"
                subtitle="Used for new sessions"
                value={defaultModel}
                onPress={() => router.push('/settings/providers')}
                last
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionLabel>APPEARANCE</SectionLabel>
            <Card style={styles.themeCard}>
              <ThemeRow />
              <Row
                icon="color-palette-outline"
                title="All themes"
                subtitle={`Currently ${themeLabel(themeKey)}`}
                onPress={() => router.push('/settings/appearance')}
                last
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionLabel>PRIVACY & DATA</SectionLabel>
            <Card>
              <Row
                icon="shield-checkmark-outline"
                title="Keys stay on this device"
                subtitle="Stored in the OS keychain. Requests go straight to your provider."
              />
              <Row
                icon="trash-outline"
                title="Clear conversation history"
                subtitle={`${sessions.length} sessions stored locally`}
                onPress={confirmClear}
                destructive
                last
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionLabel>ABOUT</SectionLabel>
            <Card>
              <Row
                icon="cloud-download-outline"
                title="App updates"
                subtitle={
                  updateStatus === 'available'
                    ? `Version ${release?.version ?? ''} is available`
                    : updateStatus === 'downloading'
                      ? 'Downloading the latest build…'
                      : updateStatus === 'installing'
                        ? 'Finish in the Android installer'
                        : 'Check GitHub Releases for a newer build'
                }
                value={`v${version}`}
                onPress={openSheet}
              />
              <Row
                icon="information-circle-outline"
                title="About Prism Mobile"
                value={`v${version}`}
                onPress={() => router.push('/settings/about')}
                last
              />
            </Card>
          </View>

          <Text style={[styles.footer, { color: theme.textMuted }]}>
            Prism Mobile is a native companion app, built separately from the Prism desktop copilot.
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
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs
  },
  title: {
    ...typography.display,
    fontSize: 30,
    lineHeight: 35
  },
  subtitle: {
    ...typography.callout,
    fontSize: 14
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 132,
    gap: spacing.xl
  },
  section: {
    gap: spacing.sm
  },
  themeCard: {
    paddingTop: spacing.sm,
    paddingBottom: 0
  },
  footer: {
    ...typography.caption,
    fontSize: 11.5,
    textAlign: 'center',
    paddingHorizontal: spacing.lg
  }
})
