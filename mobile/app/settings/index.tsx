import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { Card, Row, SectionLabel } from '../../src/components/Section'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import { ThemeRow, themeLabel } from '../../src/components/ThemePicker'
import { modelLabel } from '../../src/lib/models'
import { useSessions } from '../../src/state/sessions'
import { useSettings, useTheme } from '../../src/state/settings'
import { useUpdates } from '../../src/state/updates'
import { spacing, type as typography } from '../../src/theme/tokens'
import { chooseStorageFolder } from '../../src/tools/files'
import { forgetStorageGrant } from '../../src/tools/files'

export default function SettingsScreen(): React.JSX.Element {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const {
    providers,
    themeKey,
    defaultProviderId,
    defaultModelId,
    toolPermissionMode,
    storageGrants,
    setToolPermissionMode,
    removeStorageGrant,
    addStorageGrant
  } = useSettings()
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

  const enableYolo = (): void => {
    Alert.alert(
      'Enable YOLO mode?',
      'YOLO lets the model run supported tools without asking each time. Shell commands can modify or delete Prism-accessible files and consume resources. Android sandboxing and selected-folder grants still apply. Only enable this if you understand the risk.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable YOLO',
          style: 'destructive',
          onPress: () => setToolPermissionMode('yolo', true)
        }
      ]
    )
  }

  const addFolder = (): void => {
    void chooseStorageFolder()
      .then((grant) => {
        if (!grant) return
        addStorageGrant(grant)
        Alert.alert(
          'Folder access added',
          `${grant.label} is now available to file tools. You can revoke it in Settings.`
        )
      })
      .catch((error) =>
        Alert.alert(
          'Could not grant folder access',
          error instanceof Error ? error.message : String(error)
        )
      )
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader title="Settings" onBack={() => router.back()} />

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: spacing.xxxl + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <SectionLabel>AI PROVIDERS</SectionLabel>
            <Card>
              <Row
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
                title="Default model"
                subtitle="Used for new conversations"
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
                title="All themes"
                subtitle={`Currently ${themeLabel(themeKey)}`}
                onPress={() => router.push('/settings/appearance')}
                last
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionLabel>TOOLS & PERMISSIONS</SectionLabel>
            <Card>
              <Row
                title={toolPermissionMode === 'ask' ? 'Ask before tools' : 'YOLO mode is on'}
                subtitle={
                  toolPermissionMode === 'ask'
                    ? 'Review every tool call before it runs'
                    : 'Tool calls run without per-call approval'
                }
                value={toolPermissionMode === 'ask' ? 'Locked' : 'YOLO'}
                onPress={() =>
                  toolPermissionMode === 'yolo' ? setToolPermissionMode('ask') : enableYolo()
                }
              />
              <Row
                title="Grant a storage folder"
                subtitle="Choose folders such as Downloads or Documents. Android controls the exact scope."
                value="Add"
                onPress={addFolder}
                last={storageGrants.length === 0}
              />
              {storageGrants.map((grant, index) => (
                <Row
                  key={grant.id}
                  title={grant.label}
                  subtitle="Granted folder access"
                  value="Revoke"
                  onPress={() =>
                    Alert.alert(
                      'Revoke folder access?',
                      `${grant.label} will no longer be available to Prism tools.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Revoke',
                          style: 'destructive',
                          onPress: () => {
                            removeStorageGrant(grant.id)
                            void forgetStorageGrant(grant.id)
                          }
                        }
                      ]
                    )
                  }
                  last={index === storageGrants.length - 1}
                />
              ))}
            </Card>
          </View>

          <View style={styles.section}>
            <SectionLabel>PRIVACY & DATA</SectionLabel>
            <Card>
              <Row
                title="Keys stay on this device"
                subtitle="Stored in the OS keychain. Requests go straight to your provider."
              />
              <Row
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
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
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
