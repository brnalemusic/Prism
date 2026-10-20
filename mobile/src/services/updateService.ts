import * as Application from 'expo-application'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { Linking, Platform } from 'react-native'
import { pickLatestRelease, type MobileRelease } from '../lib/updater'

const RELEASES_ENDPOINT = 'https://api.github.com/repos/brnalemusic/Prism/releases?per_page=30'
const REQUEST_TIMEOUT_MS = 10_000
const FLAG_GRANT_READ_URI_PERMISSION = 1

/** Native version baked into the installed build, or null outside a native build. */
export function getInstalledVersion(): string | null {
  return Application.nativeApplicationVersion
}

export function isUpdaterSupported(): boolean {
  return getInstalledVersion() !== null
}

export async function fetchLatestMobileRelease(): Promise<MobileRelease | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(RELEASES_ENDPOINT, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Prism-Mobile'
      },
      signal: controller.signal
    })
    if (response.status === 403 || response.status === 429) {
      throw new Error('GitHub is rate limiting update checks. Try again in a few minutes.')
    }
    if (!response.ok) {
      throw new Error(`The update check failed (HTTP ${response.status}).`)
    }
    const payload: unknown = await response.json()
    return pickLatestRelease(Array.isArray(payload) ? payload : [])
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The update check timed out. Check your connection and try again.')
    }
    if (error instanceof Error) throw error
    throw new Error('Could not reach GitHub to check for updates.')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Downloads the release APK into the app cache and hands it to the Android
 * package installer. Android always shows its own confirmation UI, so the app
 * cannot install silently — the OS owns that decision.
 */
export async function downloadAndInstallAndroid(
  release: MobileRelease,
  onProgress: (fraction: number) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Native installation is only available on Android.')
  }
  if (!release.apkUrl) {
    throw new Error('This release does not include an Android package.')
  }
  const cacheDirectory = FileSystem.cacheDirectory
  if (!cacheDirectory) {
    throw new Error('The device cache is unavailable, so the update cannot be saved.')
  }

  const target = `${cacheDirectory}prism-mobile-${release.version}.apk`
  const download = FileSystem.createDownloadResumable(release.apkUrl, target, {}, (progress) => {
    if (progress.totalBytesExpectedToWrite > 0) {
      onProgress(Math.min(1, progress.totalBytesWritten / progress.totalBytesExpectedToWrite))
    }
  })

  const result = await download.downloadAsync()
  if (!result?.uri) {
    throw new Error('The update download did not finish. Try again.')
  }

  const contentUri = await FileSystem.getContentUriAsync(result.uri)
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION
  })
}

export async function openReleasePage(url: string): Promise<void> {
  try {
    await Linking.openURL(url)
  } catch {
    throw new Error('Could not open the release page in a browser.')
  }
}
