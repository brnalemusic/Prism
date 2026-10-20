import AsyncStorage from '@react-native-async-storage/async-storage'

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (error) {
    console.warn(`[storage] Could not read ${key}`, error)
    return fallback
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`[storage] Could not write ${key}`, error)
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key)
  } catch (error) {
    console.warn(`[storage] Could not remove ${key}`, error)
  }
}

export async function readString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}
