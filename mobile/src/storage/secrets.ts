import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const keyFor = (providerId: string): string => `prism.mobile.provider-key.${providerId}`

/**
 * API keys never touch AsyncStorage: they live in Keychain (iOS) or the
 * Keystore-backed secure store (Android).
 */
export async function readApiKey(providerId: string): Promise<string> {
  if (Platform.OS === 'web') return ''
  try {
    return (await SecureStore.getItemAsync(keyFor(providerId))) ?? ''
  } catch (error) {
    console.warn('[secrets] Could not read provider key', error)
    return ''
  }
}

export async function saveApiKey(providerId: string, apiKey: string): Promise<void> {
  if (Platform.OS === 'web') return
  const value = apiKey.trim()
  try {
    if (!value) {
      await SecureStore.deleteItemAsync(keyFor(providerId))
      return
    }
    await SecureStore.setItemAsync(keyFor(providerId), value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    })
  } catch (error) {
    console.warn('[secrets] Could not save provider key', error)
    throw new Error('The secure keychain could not store this key.')
  }
}

export async function deleteApiKey(providerId: string): Promise<void> {
  await saveApiKey(providerId, '')
}
