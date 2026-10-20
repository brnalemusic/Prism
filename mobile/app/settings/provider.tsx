import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { PrimaryButton } from '../../src/components/Buttons'
import { ProviderForm } from '../../src/components/ProviderForm'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import type { ProviderDraft } from '../../src/domain/types'
import { readApiKey } from '../../src/storage/secrets'
import { useSettings, useTheme } from '../../src/state/settings'
import { spacing, type as typography } from '../../src/theme/tokens'

export default function ProviderEditorScreen(): React.JSX.Element {
  const theme = useTheme()
  const params = useLocalSearchParams<{ id?: string }>()
  const providerId = typeof params.id === 'string' ? params.id : undefined
  const { providers, saveProvider, removeProvider } = useSettings()
  const provider = providers.find((candidate) => candidate.id === providerId)
  const [hasStoredKey, setHasStoredKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!providerId) {
      setHasStoredKey(false)
      return
    }
    void readApiKey(providerId).then((key) => {
      if (!cancelled) setHasStoredKey(key.length > 0)
    })
    return () => {
      cancelled = true
    }
  }, [providerId])

  if (providerId && !provider) {
    return (
      <ScreenBackground>
        <SafeAreaView style={styles.root} edges={['top']}>
          <ScreenHeader title="Provider" onBack={() => router.back()} />
          <View style={styles.missing}>
            <Text style={[styles.missingText, { color: theme.textSecondary }]}>
              This provider was removed.
            </Text>
            <PrimaryButton
              label="Back to providers"
              onPress={() => router.replace('/settings/providers')}
            />
          </View>
        </SafeAreaView>
      </ScreenBackground>
    )
  }

  const handleSubmit = async (draft: ProviderDraft): Promise<void> => {
    await saveProvider(draft)
    router.back()
  }

  const handleDelete = (): void => {
    if (!provider) return
    Alert.alert('Remove provider?', `${provider.name} and its stored key will be deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void removeProvider(provider.id).then(() => router.back())
        }
      }
    ])
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader
          title={provider ? 'Edit provider' : 'Add provider'}
          subtitle={provider ? provider.name : 'Keys stay on this device'}
          onBack={() => router.back()}
        />
        <ProviderForm
          initial={provider}
          initialPresetKey={provider ? undefined : 'google'}
          hasStoredKey={hasStoredKey}
          submitLabel={provider ? 'Save changes' : 'Add provider'}
          onSubmit={handleSubmit}
          onDelete={provider ? handleDelete : undefined}
        />
      </SafeAreaView>
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl
  },
  missingText: {
    ...typography.callout,
    textAlign: 'center'
  }
})
