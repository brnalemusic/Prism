import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { PrimaryButton } from '../src/components/Buttons'
import { PressableScale } from '../src/components/PressableScale'
import { PrismMark } from '../src/components/PrismMark'
import { ProviderForm } from '../src/components/ProviderForm'
import { ScreenBackground } from '../src/components/ScreenBackground'
import { ScreenHeader } from '../src/components/ScreenHeader'
import type { ProviderDraft } from '../src/domain/types'
import { useSettings, useTheme } from '../src/state/settings'
import { radius, spacing, type as typography } from '../src/theme/tokens'

const PILLARS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'phone-portrait-outline',
    title: 'Native, not a port',
    body: 'Thumb-reachable controls, native transitions and haptics — a phone app from the first line.'
  },
  {
    icon: 'key-outline',
    title: 'Your keys, your device',
    body: 'Bring a Gemini, OpenAI-compatible or Anthropic key. It stays in the OS keychain.'
  },
  {
    icon: 'flash-outline',
    title: 'Answers that stream',
    body: 'Replies appear as they are written, with Markdown, code blocks and one-tap copy.'
  }
]

export default function OnboardingScreen(): React.JSX.Element {
  const theme = useTheme()
  const { onboardingComplete, completeOnboarding, saveProvider } = useSettings()
  const [step, setStep] = useState<'welcome' | 'provider'>('welcome')
  const [saving, setSaving] = useState(false)

  if (onboardingComplete && step === 'welcome') {
    return <Redirect href="/" />
  }

  const skip = (): void => {
    completeOnboarding()
    router.replace('/')
  }

  const finish = async (draft: ProviderDraft): Promise<void> => {
    setSaving(true)
    try {
      await saveProvider(draft)
      completeOnboarding()
      router.replace('/')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'provider') {
    return (
      <ScreenBackground>
        <SafeAreaView style={styles.root} edges={['top']}>
          <ScreenHeader
            title="Connect a provider"
            subtitle="Two fields, then you are in"
            onBack={() => setStep('welcome')}
          />
          <ProviderForm
            initialPresetKey="google"
            hasStoredKey={false}
            submitLabel={saving ? 'Connecting…' : 'Save key and start'}
            onSubmit={finish}
          />
        </SafeAreaView>
      </ScreenBackground>
    )
  }

  return (
    <ScreenBackground ambient>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.topBar}>
          <View style={styles.wordmarkRow}>
            <PrismMark size={20} />
            <Text style={[styles.wordmark, { color: theme.text }]}>Prism</Text>
          </View>
          <PressableScale
            onPress={skip}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            style={styles.skip}
          >
            <Text style={[styles.skipLabel, { color: theme.textMuted }]}>Skip for now</Text>
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View
            style={[styles.markTile, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <PrismMark size={62} glow />
          </View>
          <Text style={[styles.eyebrow, { color: theme.accent }]}>PRISM MOBILE</Text>
          <Text style={[styles.title, { color: theme.text }]}>
            Your copilot, now in your pocket.
          </Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            A separate native app for the moments when the desktop is closed: quick answers, drafts
            and decisions, with your own provider keys.
          </Text>

          <View style={styles.pillars}>
            {PILLARS.map((pillar) => (
              <View key={pillar.title} style={styles.pillar}>
                <View style={[styles.pillarIcon, { backgroundColor: `${theme.accent}18` }]}>
                  <Ionicons name={pillar.icon} size={18} color={theme.accent} />
                </View>
                <View style={styles.pillarText}>
                  <Text style={[styles.pillarTitle, { color: theme.text }]}>{pillar.title}</Text>
                  <Text style={[styles.pillarBody, { color: theme.textSecondary }]}>
                    {pillar.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <PrimaryButton
            label="Connect a provider"
            icon="key-outline"
            onPress={() => setStep('provider')}
          />
          <PressableScale
            onPress={skip}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel="Explore without a key"
            style={styles.secondary}
          >
            <Text style={[styles.secondaryLabel, { color: theme.textSecondary }]}>
              Explore first, add a key later
            </Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  wordmark: {
    ...typography.headline,
    fontSize: 17
  },
  skip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm
  },
  skipLabel: {
    ...typography.caption,
    fontWeight: '600'
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md
  },
  markTile: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  eyebrow: {
    ...typography.micro,
    letterSpacing: 1.8
  },
  title: {
    ...typography.display,
    fontSize: 34,
    lineHeight: 39
  },
  body: {
    ...typography.callout,
    fontSize: 15.5,
    lineHeight: 23
  },
  pillars: {
    gap: spacing.lg,
    marginTop: spacing.md
  },
  pillar: {
    flexDirection: 'row',
    gap: spacing.md
  },
  pillarIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pillarText: {
    flex: 1,
    gap: 2
  },
  pillarTitle: {
    ...typography.headline,
    fontSize: 15.5
  },
  pillarBody: {
    ...typography.caption,
    lineHeight: 18
  },
  actions: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xs
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: spacing.sm
  },
  secondaryLabel: {
    ...typography.caption,
    fontWeight: '600'
  }
})
