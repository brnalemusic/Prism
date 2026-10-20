import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { Card, Row, SectionLabel } from '../../src/components/Section'
import { PrismMark } from '../../src/components/PrismMark'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import { useSettings, useTheme } from '../../src/state/settings'
import { useUpdates } from '../../src/state/updates'
import { radius, spacing, type as typography } from '../../src/theme/tokens'

const REPO_URL = 'https://github.com/brnalemusic/Prism'
const RELEASES_URL = 'https://github.com/brnalemusic/Prism/releases'

export default function AboutScreen(): React.JSX.Element {
  const theme = useTheme()
  const { providers } = useSettings()
  const { openSheet: openUpdateSheet } = useUpdates()
  const version = Constants.expoConfig?.version ?? '0.0.0'
  const sdkVersion = Constants.expoConfig?.sdkVersion ?? ''

  const open = (url: string): void => {
    void Linking.openURL(url).catch(() => undefined)
  }

  return (
    <ScreenBackground ambient>
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader title="About" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View
              style={[
                styles.markTile,
                { backgroundColor: theme.surface, borderColor: theme.border }
              ]}
            >
              <PrismMark size={46} glow />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Prism Mobile</Text>
            <Text style={[styles.version, { color: theme.accent }]}>
              v{version}
              {sdkVersion ? ` · ${sdkVersion}` : ''}
            </Text>
            <Text style={[styles.tagline, { color: theme.textSecondary }]}>
              A native companion to the Prism desktop copilot. Built for the phone from scratch, not
              wrapped around the desktop window.
            </Text>
          </View>

          <View style={styles.section}>
            <SectionLabel>WHAT THIS APP IS</SectionLabel>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Prism Mobile is its own codebase: native navigation, native gestures, haptics and a
              single-column reading surface designed for one hand. It keeps a deliberately smaller
              surface than the desktop app — conversation, prompt library, providers and themes —
              instead of shrinking the desktop workspace.
            </Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Conversations live on this device. API keys live in the OS keychain, and requests go
              straight from your phone to the provider you configured. There is no Prism relay in
              between, no analytics and no account.
            </Text>
          </View>

          <View style={styles.section}>
            <SectionLabel>LINKS</SectionLabel>
            <Card>
              <Row
                icon="cloud-download-outline"
                title="Check for updates"
                subtitle="Compares this build with GitHub Releases"
                value={`v${version}`}
                onPress={openUpdateSheet}
              />
              <Row
                icon="logo-github"
                title="Source code"
                subtitle="brnalemusic/Prism"
                onPress={() => open(REPO_URL)}
              />
              <Row
                icon="download-outline"
                title="Releases"
                subtitle="Desktop installers and mobile builds"
                onPress={() => open(RELEASES_URL)}
                last
              />
            </Card>
          </View>

          <View style={styles.section}>
            <SectionLabel>THIS DEVICE</SectionLabel>
            <Card>
              <Row icon="key-outline" title="Providers configured" value={`${providers.length}`} />
              <Row icon="phone-portrait-outline" title="Build" value="Native mobile" last />
            </Card>
          </View>

          <Text style={[styles.footer, { color: theme.textMuted }]}>
            Created by Breno Alexandre. Open source under the repository license.
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
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md
  },
  markTile: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  title: {
    ...typography.display,
    fontSize: 28,
    lineHeight: 33
  },
  version: {
    ...typography.micro,
    letterSpacing: 1.2
  },
  tagline: {
    ...typography.callout,
    textAlign: 'center',
    maxWidth: 320
  },
  section: {
    gap: spacing.sm
  },
  body: {
    ...typography.callout,
    fontSize: 14.5,
    lineHeight: 22
  },
  footer: {
    ...typography.caption,
    textAlign: 'center',
    fontSize: 11.5
  }
})
