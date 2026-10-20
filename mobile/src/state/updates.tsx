import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Platform } from 'react-native'
import { isNewerVersion, type MobileRelease } from '../lib/updater'
import {
  downloadAndInstallAndroid,
  fetchLatestMobileRelease,
  getInstalledVersion,
  isUpdaterSupported,
  openReleasePage
} from '../services/updateService'
import { readJson, writeJson } from '../storage/preferences'

const LAST_CHECK_KEY = 'prism.mobile.updates.v1.lastCheck'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const AUTO_CHECK_DELAY_MS = 2_500

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'

interface UpdatesContextValue {
  currentVersion: string
  status: UpdateStatus
  release: MobileRelease | null
  progress: number
  error: string | null
  sheetVisible: boolean
  openSheet: () => void
  closeSheet: () => void
  checkForUpdate: (force?: boolean) => Promise<void>
  installUpdate: () => Promise<void>
  openDownloadPage: () => Promise<void>
}

const UpdatesContext = createContext<UpdatesContextValue | null>(null)

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong while checking for updates.'
}

export function UpdatesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const installedVersion = getInstalledVersion()
  const supported = isUpdaterSupported()
  const [status, setStatus] = useState<UpdateStatus>(supported ? 'idle' : 'unsupported')
  const [release, setRelease] = useState<MobileRelease | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const statusRef = useRef(status)
  const autoChecked = useRef(false)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const checkForUpdate = useCallback(
    async (force = false) => {
      if (statusRef.current === 'checking' || statusRef.current === 'downloading') return
      if (!supported) {
        setStatus('unsupported')
        return
      }

      if (!force) {
        const lastCheck = await readJson<number>(LAST_CHECK_KEY, 0)
        if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return
      }

      setStatus('checking')
      setError(null)
      try {
        const latest = await fetchLatestMobileRelease()
        await writeJson(LAST_CHECK_KEY, Date.now())
        setRelease(latest)
        if (latest && installedVersion && isNewerVersion(latest.version, installedVersion)) {
          setStatus('available')
        } else {
          setStatus('current')
        }
      } catch (caught) {
        setError(describeError(caught))
        setStatus('error')
      }
    },
    [installedVersion, supported]
  )

  useEffect(() => {
    if (!supported || autoChecked.current) return
    autoChecked.current = true
    const timer = setTimeout(() => {
      void checkForUpdate(false)
    }, AUTO_CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [checkForUpdate, supported])

  const installUpdate = useCallback(async () => {
    if (!release) return
    if (Platform.OS !== 'android' || !release.apkUrl) {
      await openReleasePage(release.pageUrl)
      return
    }
    if (statusRef.current === 'downloading') return

    setProgress(0)
    setError(null)
    setStatus('downloading')
    try {
      await downloadAndInstallAndroid(release, setProgress)
      setStatus('installing')
    } catch (caught) {
      setError(describeError(caught))
      setStatus('error')
    }
  }, [release])

  const openDownloadPage = useCallback(async () => {
    if (!release) {
      await openReleasePage('https://github.com/brnalemusic/Prism/releases')
      return
    }
    await openReleasePage(release.pageUrl)
  }, [release])

  const openSheet = useCallback(() => {
    setSheetVisible(true)
    if (supported && statusRef.current === 'idle') {
      void checkForUpdate(true)
    }
  }, [checkForUpdate, supported])

  const closeSheet = useCallback(() => setSheetVisible(false), [])

  const value = useMemo<UpdatesContextValue>(
    () => ({
      currentVersion: installedVersion ?? '0.0.0',
      status,
      release,
      progress,
      error,
      sheetVisible,
      openSheet,
      closeSheet,
      checkForUpdate,
      installUpdate,
      openDownloadPage
    }),
    [
      installedVersion,
      status,
      release,
      progress,
      error,
      sheetVisible,
      openSheet,
      closeSheet,
      checkForUpdate,
      installUpdate,
      openDownloadPage
    ]
  )

  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>
}

export function useUpdates(): UpdatesContextValue {
  const context = useContext(UpdatesContext)
  if (!context) throw new Error('useUpdates must be used inside UpdatesProvider')
  return context
}
