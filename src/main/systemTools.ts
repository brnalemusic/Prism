import { exec, execFile } from 'child_process'
import { shell, desktopCapturer, app, BrowserWindow, ipcMain } from 'electron'

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { toolsManifest } from './toolsManifest'
import { BrowserAction, DownloadProgress, SessionMode, TodoState } from '../shared/types'

import { loadConfig, saveConfig, SlashWorkflow } from './config'
import { searchChatHistory, searchChatMemory, loadChatSession } from './history'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Download,
  type Page
} from 'playwright'
import {
  assertSafeBulkMutationPath,
  assertSafeFileMutationPath,
  getLocalCommandSandboxSummary,
  getShellSyntaxSummary,
  runGuardedTerminalCommand
} from './localCommandSandbox'

function getDownloadsFolder(): string {
  try {
    return app.getPath('downloads')
  } catch (err) {
    return path.join(os.homedir(), 'Downloads')
  }
}

let downloadSequence = 0
let downloadCdpSession: CDPSession | null = null
let downloadCdpBrowser: Browser | null = null
const trackedDownloads = new Map<string, DownloadProgress>()
const provisionalDownloadIds = new Map<string, string>()
const cdpGuidToDownloadId = new Map<string, string>()
const activeDownloadSaves = new WeakMap<Download, Promise<string>>()
const consumedDownloadResults = new Set<string>()

type DownloadCompletionResult =
  | { success: true; filePath: string; filename: string }
  | { success: false; error: string }

let downloadCompleteListeners: Array<(id: string, result: DownloadCompletionResult) => void> = []
const DIRECT_DOWNLOAD_EXTENSIONS = new Set([
  '.7z',
  '.apk',
  '.bin',
  '.csv',
  '.deb',
  '.dmg',
  '.doc',
  '.docx',
  '.exe',
  '.gz',
  '.img',
  '.iso',
  '.msi',
  '.pkg',
  '.ppt',
  '.pptx',
  '.rar',
  '.rpm',
  '.tar',
  '.tgz',
  '.tsv',
  '.xls',
  '.xlsx',
  '.zip'
])

function createDownloadId(seed = 'download'): string {
  downloadSequence += 1
  return `${seed}-${Date.now()}-${downloadSequence}`
}

function normalizeDownloadFilename(filename: string): string {
  const cleanName = path.basename(filename || 'download').trim()
  return cleanName || 'download'
}

function getDownloadKey(url: string | undefined, filename: string): string {
  return `${url || 'unknown'}::${filename}`
}

function emitDownloadProgress(progress: DownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('download-progress', progress)
    }
  }
}

function cleanupTrackedDownload(progress: DownloadProgress): void {
  if (!['completed', 'failed', 'cancelled'].includes(progress.status)) return

  setTimeout(() => {
    const current = trackedDownloads.get(progress.id)
    if (!current || current.updatedAt !== progress.updatedAt) return

    trackedDownloads.delete(progress.id)
    for (const [key, id] of provisionalDownloadIds.entries()) {
      if (id === progress.id) provisionalDownloadIds.delete(key)
    }
    for (const [guid, id] of cdpGuidToDownloadId.entries()) {
      if (id === progress.id) cdpGuidToDownloadId.delete(guid)
    }
  }, 60_000)
}

function getCompletedDownload(): DownloadCompletionResult | null {
  for (const progress of trackedDownloads.values()) {
    if (consumedDownloadResults.has(progress.id)) continue
    if (progress.status === 'completed') {
      consumedDownloadResults.add(progress.id)
      return { success: true, filePath: progress.targetPath || '', filename: progress.filename }
    }
    if (progress.status === 'failed' || progress.status === 'cancelled') {
      consumedDownloadResults.add(progress.id)
      return { success: false, error: progress.error || `Download ${progress.status}` }
    }
  }
  return null
}

export async function _waitForDownloadCompletion(timeoutMs = 10000): Promise<DownloadCompletionResult | null> {
  const existingResult = getCompletedDownload()
  if (existingResult) return existingResult

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      downloadCompleteListeners = downloadCompleteListeners.filter((fn) => fn !== onComplete)
      resolve(getCompletedDownload())
    }, timeoutMs)

    const onComplete = (id: string, result: DownloadCompletionResult) => {
      clearTimeout(timer)
      consumedDownloadResults.add(id)
      resolve(result)
    }

    downloadCompleteListeners.push(onComplete)
  })
}

function updateTrackedDownload(
  id: string,
  patch: Partial<DownloadProgress> & { filename?: string }
): DownloadProgress {
  const now = Date.now()
  const previous = trackedDownloads.get(id)
  const receivedBytes = Math.max(0, patch.receivedBytes ?? previous?.receivedBytes ?? 0)
  const totalBytes =
    patch.totalBytes && patch.totalBytes > 0 ? patch.totalBytes : previous?.totalBytes
  const computedPercent =
    totalBytes && totalBytes > 0 ? Math.min(100, (receivedBytes / totalBytes) * 100) : undefined

  const progress: DownloadProgress = {
    id,
    filename: patch.filename || previous?.filename || 'download',
    url: patch.url ?? previous?.url,
    targetPath: patch.targetPath ?? previous?.targetPath,
    receivedBytes,
    totalBytes,
    percent:
      typeof patch.percent === 'number'
        ? Math.max(0, Math.min(100, patch.percent))
        : (computedPercent ?? previous?.percent),
    status: patch.status || previous?.status || 'starting',
    error: patch.error,
    startedAt: previous?.startedAt ?? patch.startedAt ?? now,
    updatedAt: now
  }

  if (progress.status === 'completed') {
    progress.percent = 100
    if (progress.totalBytes && progress.receivedBytes < progress.totalBytes) {
      progress.receivedBytes = progress.totalBytes
    }
  }

  trackedDownloads.set(id, progress)
  emitDownloadProgress(progress)
  cleanupTrackedDownload(progress)

  if (['completed', 'failed', 'cancelled'].includes(progress.status)) {
    const result: DownloadCompletionResult =
      progress.status === 'completed'
        ? { success: true, filePath: progress.targetPath || '', filename: progress.filename }
        : { success: false, error: progress.error || `Download ${progress.status}` }
    const listeners = downloadCompleteListeners
    downloadCompleteListeners = []
    listeners.forEach((fn) => fn(progress.id, result))
  }

  return progress
}

function resolveDownloadProgressId(
  url: string | undefined,
  filename: string,
  preferredId?: string
): string {
  const key = getDownloadKey(url, filename)
  let id = provisionalDownloadIds.get(key)
  if (!id) {
    id = preferredId || createDownloadId('download')
    provisionalDownloadIds.set(key, id)
  }
  return id
}

function getChromiumBrowserContextId(context?: BrowserContext): string | undefined {
  const privateContext = context as
    | (BrowserContext & {
        _browserContextId?: string
        _impl?: { _browserContextId?: string }
      })
    | undefined

  return privateContext?._browserContextId || privateContext?._impl?._browserContextId
}

async function configureDownloadProgressEvents(
  browser: Browser,
  context?: BrowserContext
): Promise<void> {
  if (downloadCdpSession && downloadCdpBrowser === browser) return

  try {
    const downloadsFolder = getDownloadsFolder()
    await fs.mkdir(downloadsFolder, { recursive: true })

    const session = await browser.newBrowserCDPSession()
    downloadCdpSession = session
    downloadCdpBrowser = browser

    session.on('Browser.downloadWillBegin', (event) => {
      const filename = normalizeDownloadFilename(event.suggestedFilename)
      const id = resolveDownloadProgressId(event.url, filename, `download-${event.guid}`)
      cdpGuidToDownloadId.set(event.guid, id)
      updateTrackedDownload(id, {
        filename,
        url: event.url,
        targetPath: path.join(downloadsFolder, filename),
        receivedBytes: 0,
        status: 'downloading'
      })
    })

    session.on('Browser.downloadProgress', (event) => {
      const id = cdpGuidToDownloadId.get(event.guid) || `download-${event.guid}`
      const previous = trackedDownloads.get(id)
      const status =
        event.state === 'completed'
          ? 'saving'
          : event.state === 'canceled'
            ? 'cancelled'
            : 'downloading'

      updateTrackedDownload(id, {
        filename: previous?.filename,
        receivedBytes: event.receivedBytes,
        totalBytes: event.totalBytes > 0 ? event.totalBytes : undefined,
        percent: event.state === 'completed' ? 100 : undefined,
        status,
        targetPath: previous?.targetPath || event.filePath
      })
    })

    const params = {
      behavior: 'allow' as const,
      downloadPath: downloadsFolder,
      eventsEnabled: true
    }

    await session.send('Browser.setDownloadBehavior', params)

    const browserContextId = getChromiumBrowserContextId(context)
    if (browserContextId) {
      await session
        .send('Browser.setDownloadBehavior', { ...params, browserContextId })
        .catch((err) => {
          console.warn('Unable to scope download behavior to browser context:', err)
        })
    }
  } catch (err) {
    downloadCdpSession = null
    downloadCdpBrowser = null
    console.warn('Download progress events are unavailable for this browser session:', err)
  }
}

async function savePlaywrightDownload(download: Download): Promise<string> {
  const existingSave = activeDownloadSaves.get(download)
  if (existingSave) return existingSave

  const savePromise = (async () => {
    const downloadsFolder = getDownloadsFolder()
    await fs.mkdir(downloadsFolder, { recursive: true })

    const filename = normalizeDownloadFilename(download.suggestedFilename())
    const url = download.url()
    const targetPath = path.join(downloadsFolder, filename)
    const id = resolveDownloadProgressId(url, filename)

    updateTrackedDownload(id, {
      filename,
      url,
      targetPath,
      receivedBytes: 0,
      status: 'downloading'
    })

    try {
      await download.saveAs(targetPath)
      updateTrackedDownload(id, {
        filename,
        url,
        targetPath,
        percent: 100,
        status: 'completed'
      })
      return targetPath
    } catch (err) {
      const failure = await download.failure().catch(() => null)
      updateTrackedDownload(id, {
        filename,
        url,
        targetPath,
        status: failure === 'canceled' ? 'cancelled' : 'failed',
        error: failure || (err instanceof Error ? err.message : String(err))
      })
      throw err
    }
  })()

  activeDownloadSaves.set(download, savePromise)
  return savePromise
}

function getUrlPathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

function hasDirectDownloadExtension(url: string): boolean {
  const pathname = getUrlPathname(url).toLowerCase()
  if (pathname.endsWith('.tar.gz')) return true
  return DIRECT_DOWNLOAD_EXTENSIONS.has(path.posix.extname(pathname))
}

function getFilenameFromUrl(url: string): string | undefined {
  const basename = path.posix.basename(getUrlPathname(url))
  if (!basename || basename === '/' || basename === '.') return undefined

  try {
    return decodeURIComponent(basename)
  } catch {
    return basename
  }
}

function decodeHeaderFilename(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function getFilenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined

  const filenameStar = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)
  if (filenameStar?.[1]) {
    return decodeHeaderFilename(filenameStar[1])
  }

  const filename = header.match(/filename\s*=\s*([^;]+)/i)
  return filename?.[1] ? decodeHeaderFilename(filename[1]) : undefined
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return mime === 'text/html' || mime === 'application/xhtml+xml'
}

export async function _getCookieHeaderForUrl(url: string): Promise<string | undefined> {
  if (!persistentContext) return undefined

  const cookies = await persistentContext.cookies(url).catch(() => [])
  if (cookies.length === 0) return undefined
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

export async function _getElementDownloadCandidate(
  locator: ReturnType<Page['locator']>
): Promise<{ url: string; filename?: string } | null> {
  const candidate = await locator
    .evaluate((el) => {
      const anchor = el.closest('a[href]') as HTMLAnchorElement | null
      const href =
        anchor?.href ||
        ((el as HTMLElement).getAttribute('href')
          ? new URL((el as HTMLElement).getAttribute('href') || '', window.location.href).href
          : '')
      const downloadAttribute =
        anchor?.getAttribute('download') || (el as HTMLElement).getAttribute('download')

      return {
        url: href,
        filename:
          downloadAttribute && downloadAttribute.trim() ? downloadAttribute.trim() : undefined
      }
    })
    .catch(() => null)

  if (!candidate?.url || !/^https?:\/\//i.test(candidate.url)) return null
  if (!candidate.filename && !hasDirectDownloadExtension(candidate.url)) return null
  return candidate
}

export async function _downloadUrlToDownloads(
  url: string,
  options: { filename?: string; referer?: string; cookieHeader?: string } = {}
): Promise<string> {
  const downloadsFolder = getDownloadsFolder()
  await fs.mkdir(downloadsFolder, { recursive: true })

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  }
  if (options.referer) headers.Referer = options.referer
  if (options.cookieHeader) headers.Cookie = options.cookieHeader

  const response = await fetch(url, { redirect: 'follow', headers })
  if (!response.ok) {
    throw new Error(`Download request failed with HTTP ${response.status}`)
  }
  if (isHtmlContentType(response.headers.get('content-type'))) {
    throw new Error('Download link returned an HTML page instead of a file')
  }

  const resolvedUrl = response.url || url
  const filename = normalizeDownloadFilename(
    options.filename ||
      getFilenameFromContentDisposition(response.headers.get('content-disposition')) ||
      getFilenameFromUrl(resolvedUrl) ||
      getFilenameFromUrl(url) ||
      'download'
  )
  const targetPath = path.join(downloadsFolder, filename)
  const id = resolveDownloadProgressId(resolvedUrl, filename, createDownloadId('direct-download'))
  const totalBytesHeader = Number(response.headers.get('content-length') || 0)
  const totalBytes =
    Number.isFinite(totalBytesHeader) && totalBytesHeader > 0 ? totalBytesHeader : undefined

  updateTrackedDownload(id, {
    filename,
    url: resolvedUrl,
    targetPath,
    receivedBytes: 0,
    totalBytes,
    status: 'downloading'
  })

  const body = response.body
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(targetPath, buffer)
    updateTrackedDownload(id, {
      filename,
      url: resolvedUrl,
      targetPath,
      receivedBytes: buffer.length,
      totalBytes: totalBytes || buffer.length,
      percent: 100,
      status: 'completed'
    })
    return targetPath
  }

  const file = await fs.open(targetPath, 'w')
  let receivedBytes = 0
  let lastProgressAt = 0

  try {
    const reader = body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const buffer = Buffer.from(value)
      await file.write(buffer)
      receivedBytes += buffer.length

      const now = Date.now()
      if (now - lastProgressAt > 250) {
        updateTrackedDownload(id, {
          filename,
          url: resolvedUrl,
          targetPath,
          receivedBytes,
          totalBytes,
          status: 'downloading'
        })
        lastProgressAt = now
      }
    }
  } catch (err) {
    updateTrackedDownload(id, {
      filename,
      url: resolvedUrl,
      targetPath,
      receivedBytes,
      totalBytes,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err)
    })
    await fs.unlink(targetPath).catch(() => {})
    throw err
  } finally {
    await file.close()
  }

  updateTrackedDownload(id, {
    filename,
    url: resolvedUrl,
    targetPath,
    receivedBytes,
    totalBytes: totalBytes || receivedBytes,
    percent: 100,
    status: 'completed'
  })

  return targetPath
}

export interface TerminalOption {
  id: string
  name: string
  path: string
}

function checkIfExecutableExists(exeName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('where', [exeName], (error) => {
      resolve(!error)
    })
  })
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function detectAvailableTerminals(): Promise<TerminalOption[]> {
  const terminals: TerminalOption[] = []
  const isWindows = process.platform === 'win32'

  if (!isWindows) {
    terminals.push({ id: 'sh', name: 'System Shell', path: '/bin/sh' })
    return terminals
  }

  terminals.push({
    id: 'powershell',
    name: 'PowerShell do Windows',
    path: 'powershell.exe'
  })

  terminals.push({
    id: 'cmd',
    name: 'CMD',
    path: 'cmd.exe'
  })

  if (await checkIfExecutableExists('pwsh.exe')) {
    terminals.push({
      id: 'pwsh',
      name: 'Pwsh 7',
      path: 'pwsh.exe'
    })
  } else {
    const commonPwshPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell\\7\\pwsh.exe'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'PowerShell\\7\\pwsh.exe'
      )
    ]
    for (const p of commonPwshPaths) {
      if (await fileExists(p)) {
        terminals.push({
          id: 'pwsh',
          name: 'Pwsh 7',
          path: p
        })
        break
      }
    }
  }

  if (await checkIfExecutableExists('bash.exe')) {
    terminals.push({
      id: 'gitbash',
      name: 'Git Bash',
      path: 'bash.exe'
    })
  } else {
    const commonBashPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git\\bin\\bash.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git\\git-bash.exe'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Git\\bin\\bash.exe'
      ),
      path.join(os.homedir(), 'AppData\\Local\\Programs\\Git\\bin\\bash.exe')
    ]
    for (const p of commonBashPaths) {
      if (await fileExists(p)) {
        terminals.push({
          id: 'gitbash',
          name: 'Git Bash',
          path: p
        })
        break
      }
    }
  }

  if (await checkIfExecutableExists('wsl.exe')) {
    terminals.push({
      id: 'wsl',
      name: 'WSL (Bash)',
      path: 'wsl.exe'
    })
  } else {
    const wslPath = 'C:\\Windows\\System32\\wsl.exe'
    if (await fileExists(wslPath)) {
      terminals.push({
        id: 'wsl',
        name: 'WSL (Bash)',
        path: wslPath
      })
    }
  }

  return terminals
}

/**
 * Executes a terminal command and returns the output.
 */
export async function runTerminalCommand(
  command: string,
  apiKey?: string,
  signal?: AbortSignal,
  event?: any,
  chatId?: string
): Promise<string> {
  const config = loadConfig()
  const isWindows = process.platform === 'win32'
  const shellToUse = config.terminalShell || (isWindows ? 'powershell.exe' : undefined)
  const fallbackApiKey = process.env.GEMINI_API_KEY || ''
  const activeApiKey = apiKey || fallbackApiKey

  return runGuardedTerminalCommand(command, {
    shell: shellToUse,
    apiKey: activeApiKey,
    signal,
    cwd: activeCwd,
    event,
    chatId
  })
}

let activeCwd: string = process.cwd()

export function setActiveCwd(dir: string): void {
  activeCwd = dir
}

export function getActiveCwd(): string {
  return activeCwd
}

function resolveRequiredPath(input: string, label: string): string {
  const cleaned = input.trim()
  if (!cleaned) {
    throw new Error(`Missing required ${label}. Provide a complete path.`)
  }

  if (/^(PATH|FILE|DIR|DIRECTORY|SOURCE|DESTINATION|TARGET)([_-]?\w+)?$/i.test(cleaned)) {
    throw new Error(`Invalid ${label}: "${input}". Replace placeholders with a real path.`)
  }

  return path.resolve(activeCwd, cleaned)
}

function createAbortError(): Error {
  const error = new Error('AbortError')
  error.name = 'AbortError'
  return error
}

function parseToolBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return /^(true|1|yes|y|sim)$/i.test(value.trim())
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw createAbortError()
}

function describeStats(fullPath: string, stats: Awaited<ReturnType<typeof fs.stat>>): string {
  const type = stats.isFile()
    ? 'file'
    : stats.isDirectory()
      ? 'directory'
      : stats.isSymbolicLink()
        ? 'symlink'
        : 'other'

  return JSON.stringify(
    {
      path: fullPath,
      name: path.basename(fullPath),
      parent: path.dirname(fullPath),
      type,
      extension: path.extname(fullPath),
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      accessedAt: stats.atime.toISOString(),
      permissions: `0${(Number(stats.mode) & 0o777).toString(8)}`
    },
    null,
    2
  )
}

function normalizeHttpUrl(input: string, label: string): string {
  const cleaned = input.trim()
  if (!cleaned) {
    throw new Error(`Missing required ${label}. Provide a complete URL.`)
  }

  if (/^(URL|LINK|WEBPAGE|TARGET)([_-]?\w+)?$/i.test(cleaned)) {
    throw new Error(`Invalid ${label}: "${input}". Replace placeholders with a real URL.`)
  }

  const hasHttpScheme = /^https?:\/\//i.test(cleaned)
  const localhostWithoutScheme = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(cleaned)
  const candidate = hasHttpScheme
    ? cleaned
    : localhostWithoutScheme
      ? `http://${cleaned}`
      : `https://${cleaned}`

  const parsed = new URL(candidate)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported ${label} protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

/**
 * COMPUTER USE: Create a new file with content.
 */
export async function computerCreateFile(
  filePath: string,
  content: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertSafeFileMutationPath(fullPath, 'path')
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, { encoding: 'utf8', flag: 'wx', signal })
    return `File created successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error creating file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Create a new directory.
 */
export async function computerCreateDirectory(
  dirPath: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(dirPath, 'path')
    assertSafeFileMutationPath(fullPath, 'path')
    throwIfAborted(signal)
    await fs.mkdir(fullPath, { recursive: true })
    throwIfAborted(signal)
    return `Directory created successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error creating directory: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Remove a file.
 */
export async function computerRemoveFile(filePath: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertSafeBulkMutationPath(fullPath, 'path')
    throwIfAborted(signal)
    await fs.unlink(fullPath)
    throwIfAborted(signal)
    return `File removed successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error removing file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Remove a directory.
 */
export async function computerRemoveDirectory(
  dirPath: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(dirPath, 'path')
    assertSafeBulkMutationPath(fullPath, 'path')
    throwIfAborted(signal)
    await fs.rm(fullPath, { recursive: true, force: false })
    throwIfAborted(signal)
    return `Directory removed successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error removing directory: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Save/Overwrite a file.
 */
export async function computerSaveFile(
  filePath: string,
  content: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertSafeFileMutationPath(fullPath, 'path')
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, { encoding: 'utf8', signal })
    return `File saved successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error saving file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Append text to a file.
 */
export async function computerAppendToFile(
  filePath: string,
  content: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertSafeFileMutationPath(fullPath, 'path')
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    throwIfAborted(signal)
    await fs.appendFile(fullPath, content, { encoding: 'utf8' })
    throwIfAborted(signal)
    return `Content appended successfully to: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error appending to file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Copy a file or directory.
 */
export async function computerCopyFile(
  sourcePath: string,
  destinationPath: string,
  overwrite: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  try {
    const sourceFullPath = resolveRequiredPath(sourcePath, 'sourcePath')
    const destinationFullPath = resolveRequiredPath(destinationPath, 'destinationPath')
    assertSafeFileMutationPath(destinationFullPath, 'destinationPath')

    throwIfAborted(signal)
    await fs.stat(sourceFullPath)
    await fs.mkdir(path.dirname(destinationFullPath), { recursive: true })

    const shouldOverwrite = parseToolBoolean(overwrite, false)
    await fs.cp(sourceFullPath, destinationFullPath, {
      recursive: true,
      force: shouldOverwrite,
      errorOnExist: !shouldOverwrite,
      verbatimSymlinks: true
    })

    throwIfAborted(signal)
    return `Copied successfully: ${sourceFullPath} -> ${destinationFullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error copying file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Move or rename a file or directory.
 */
export async function computerMoveFile(
  sourcePath: string,
  destinationPath: string,
  overwrite: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  try {
    const sourceFullPath = resolveRequiredPath(sourcePath, 'sourcePath')
    const destinationFullPath = resolveRequiredPath(destinationPath, 'destinationPath')
    assertSafeBulkMutationPath(sourceFullPath, 'sourcePath')
    assertSafeFileMutationPath(destinationFullPath, 'destinationPath')

    throwIfAborted(signal)
    await fs.stat(sourceFullPath)
    await fs.mkdir(path.dirname(destinationFullPath), { recursive: true })

    const shouldOverwrite = parseToolBoolean(overwrite, false)
    try {
      await fs.stat(destinationFullPath)
      if (!shouldOverwrite) {
        return `Error moving file: destination already exists: ${destinationFullPath}`
      }
      assertSafeBulkMutationPath(destinationFullPath, 'destinationPath')
      await fs.rm(destinationFullPath, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await fs.rename(sourceFullPath, destinationFullPath)
    throwIfAborted(signal)
    return `Moved successfully: ${sourceFullPath} -> ${destinationFullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error moving file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Get file or directory metadata.
 */
export async function computerGetFileInfo(filePath: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    throwIfAborted(signal)
    const stats = await fs.stat(fullPath)
    return describeStats(fullPath, stats)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error getting file info: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: List directory contents.
 */
export async function computerListDirectory(
  dirPath: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(dirPath, 'path')
    throwIfAborted(signal)
    const files = await fs.readdir(fullPath, { withFileTypes: true })
    throwIfAborted(signal)
    const list = files.map((f) => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`)
    return list.join('\n') || 'Directory is empty.'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function computerReadFile(
  filePath: string,
  startLine: number,
  limit?: number,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    const content = await fs.readFile(fullPath, { encoding: 'utf8', signal })

    const lines = content.split('\n')
    const totalLines = lines.length

    if (startLine > totalLines) {
      return `Error reading file: startLine (${startLine}) exceeds the total number of lines in the file (${totalLines}).`
    }

    const actualLimit = limit !== undefined ? limit : 200
    const startIdx = startLine - 1
    const endIdx = Math.min(startLine + actualLimit - 1, totalLines - 1)

    const sliceOfLines = lines.slice(startIdx, endIdx + 1)
    const selectedContent = sliceOfLines.join('\n')

    if (selectedContent.length > 8000) {
      return `Content Locked: The requested range contains ${selectedContent.length} characters, which exceeds the limit of 8,000 characters. Please request a smaller limit to read less content.`
    }

    const numberedLines = sliceOfLines.map((line, index) => `${startLine + index}: ${line}`)
    const body = numberedLines.join('\n')

    const showingStart = startLine
    const showingEnd = endIdx + 1

    const header = `File: ${fullPath}\nTotal lines: ${totalLines}\nShowing lines: ${showingStart} to ${showingEnd}\n\n`
    return header + body
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error reading file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Edit specific lines in a file.
 */
export async function computerEditFile(
  filePath: string,
  startLineStr: string,
  endLineStr: string,
  newContent: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertSafeFileMutationPath(fullPath, 'path')

    const startLine = parseInt(startLineStr, 10)
    const endLine = parseInt(endLineStr, 10)

    if (isNaN(startLine) || isNaN(endLine)) {
      return 'Error editing file lines: startLine and endLine must be valid numbers.'
    }
    if (startLine < 1 || endLine < startLine) {
      return 'Error editing file lines: Invalid line range. startLine must be >= 1 and endLine must be >= startLine.'
    }

    const content = await fs.readFile(fullPath, { encoding: 'utf8', signal })
    const lines = content.split('\n')

    if (startLine > lines.length) {
      return `Error editing file lines: startLine (${startLine}) is beyond the end of the file (${lines.length} lines).`
    }

    const newLines = newContent.split('\n')
    const originalFirstLine = lines[startLine - 1] || ''
    const originalIndent = originalFirstLine.match(/^[ \t]+/)?.[0] || ''
    const shouldPreserveIndent = originalIndent && newLines.some((line) => line.trim().length > 0)
    const adjustedNewLines = shouldPreserveIndent
      ? newLines.map((line) => {
          if (!line.trim()) return line
          if (/^[ \t]/.test(line)) return line
          return originalIndent + line
        })
      : newLines

    lines.splice(startLine - 1, endLine - startLine + 1, ...adjustedNewLines)
    await fs.writeFile(fullPath, lines.join('\n'), { encoding: 'utf8', signal })

    return `Lines ${startLine} to ${endLine} replaced successfully in: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error editing file lines: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Opens an application given its executable path.
 */
export async function openApplication(appPath: string): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(appPath, 'appPath')
    const error = await shell.openPath(fullPath)
    if (error) {
      return `Error opening application: ${error}`
    }
    return `Application opened successfully: ${fullPath}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error trying to open application: ${message}`
  }
}

/**
 * Opens a URL in the user's default system browser.
 */
export async function openBrowserLink(url: string): Promise<string> {
  try {
    const targetUrl = normalizeHttpUrl(url, 'url')
    await shell.openExternal(targetUrl)
    return `Link opened successfully in browser: ${targetUrl}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error opening link in browser: ${message}`
  }
}

/**
 * Helper function to launch a Chromium browser using Playwright.
 * It implements a fallback chain:
 * 1. Google Chrome
 * 2. Microsoft Edge
 * 3. Firefox
 * 4. Playwright default Chromium
 * 5. Programmatic install of Playwright Chromium
 */
async function launchBrowser(headless: boolean = true): Promise<Browser> {
  const launchOptions = {
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }


  // 1. Google Chrome
  try {
    console.log('launchBrowser: Trying system Google Chrome...')
    return await chromium.launch({ ...launchOptions, channel: 'chrome' })
  } catch (err) {
    console.warn('launchBrowser: Google Chrome failed:', err)
  }

  // 2. Microsoft Edge
  try {
    console.log('launchBrowser: Trying system Microsoft Edge...')
    return await chromium.launch({ ...launchOptions, channel: 'msedge' })
  } catch (err) {
    console.warn('launchBrowser: Microsoft Edge failed:', err)
  }

  // 3. Firefox
  try {
    console.log('launchBrowser: Trying system Firefox...')
    return await chromium.launch({ ...launchOptions, channel: 'firefox' })
  } catch (err) {
    console.warn('launchBrowser: Firefox failed:', err)
  }

  // 4. Playwright default Chromium
  try {
    console.log('launchBrowser: Trying default Playwright Chromium...')
    return await chromium.launch(launchOptions)
  } catch (err) {
    console.warn('launchBrowser: Default Playwright Chromium failed:', err)
  }

  // 5. Install Playwright Chromium if all else fails
  console.log('launchBrowser: Downloading Chromium dependency...')
  await new Promise<void>((resolve, reject) => {
    exec('npx playwright install chromium', (error) => {
      if (error) {
        console.error('Playwright Chromium installation failed:', error)
        reject(error)
      } else {
        console.log('Playwright Chromium installation complete.')
        resolve()
      }
    })
  })
  return await chromium.launch(launchOptions)
}

/**
 * Helper to create a browser context with a realistic user-agent and standard configurations
 * to avoid bot detection and browser support warnings (e.g. on SoundCloud).
 */
async function createBrowserContext(browser: Browser) {
  return await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    locale: 'en-US',
    acceptDownloads: true
  })
}

let persistentBrowser: Browser | null = null
let persistentContext: BrowserContext | null = null
let persistentPage: Page | null = null
let idleTimer: NodeJS.Timeout | null = null

/** Callback set by index.ts to broadcast browser events to the renderer window. */
let _browserActionEmitter: ((action: BrowserAction) => void) | null = null

export function setBrowserActionEmitter(fn: (action: BrowserAction) => void): void {
  _browserActionEmitter = fn
}

/**
 * Captures the current page screenshot and emits a BrowserAction event to the renderer.
 * Silently skips if there is no emitter or no active page.
 */
async function emitBrowserAction(actionData: Omit<BrowserAction, 'timestamp' | 'screenshot'>): Promise<void> {
  if (!_browserActionEmitter) return
  try {
    let screenshot: string | undefined
    if (persistentPage && !persistentPage.isClosed()) {
      let buf = await persistentPage.screenshot({ type: 'jpeg', quality: 70, timeout: 3000 }).catch(() => null)
      if (!buf) {
        buf = await persistentPage.screenshot({ type: 'png', timeout: 3000 }).catch(() => null)
      }
      if (buf) screenshot = buf.toString('base64')
      const url = persistentPage.url()
      const title = await persistentPage.title().catch(() => '')
      _browserActionEmitter({
        ...actionData,
        screenshot,
        url,
        title,
        timestamp: Date.now()
      })
    } else {
      _browserActionEmitter({ ...actionData, timestamp: Date.now() })
    }
  } catch (err) {
    console.warn('emitBrowserAction error:', err)
  }
}



export function _setupBrowserAbortHandler(signal?: AbortSignal): (() => void) | null {
  if (!signal || signal.aborted) {
    if (signal?.aborted) {
      if (persistentPage && !persistentPage.isClosed()) {
        persistentPage.close().catch(() => {})
      }
      closePersistentBrowser().catch(() => {})
    }
    return null
  }
  const handler = () => {
    if (persistentPage && !persistentPage.isClosed()) {
      persistentPage.close().catch(() => {})
    }
    closePersistentBrowser().catch(() => {})
  }
  signal.addEventListener('abort', handler)
  return () => {
    signal.removeEventListener('abort', handler)
  }
}

export function _resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer)
  }
  idleTimer = setTimeout(
    async () => {
      console.log('Browser persistent session idle for 5 minutes, closing automatically...')
      await closePersistentBrowser()
    },
    5 * 60 * 1000
  ) // 5 minutes
}

export async function _getOrCreatePersistentPage(): Promise<Page> {
  if (persistentPage && !persistentPage.isClosed()) {
    return persistentPage
  }

  if (persistentBrowser) {
    try {
      await persistentBrowser.close()
    } catch (err) {
      console.warn('Error closing stale persistent browser:', err)
    }
    persistentBrowser = null
  }

  persistentBrowser = await launchBrowser()
  persistentContext = await createBrowserContext(persistentBrowser)
  await configureDownloadProgressEvents(persistentBrowser, persistentContext)
  persistentPage = await persistentContext.newPage()

  // Set up standard anti-bot features at the context level to cover all pages/tabs
  await persistentContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    ;(window as any).chrome = { runtime: {} }
  })

  // Auto-broadcast screenshot whenever page loads or navigates
  const triggerAutoScreenshot = () => {
    emitBrowserAction({ type: 'navigate' }).catch(() => {})
  }
  persistentPage.on('domcontentloaded', triggerAutoScreenshot)
  persistentPage.on('load', triggerAutoScreenshot)
  persistentPage.on('framenavigated', triggerAutoScreenshot)

  // Set up automatic background download handler on context level to catch downloads from all tabs/redirects
  persistentContext.on('download', async (download) => {
    try {
      const targetPath = await savePlaywrightDownload(download)
      const filename = path.basename(targetPath)
      console.log(`Auto-download saved: ${filename} to ${targetPath}`)
    } catch (err) {
      console.warn('Background download auto-save did not complete (possibly already saved):', err)
    }
  })

  return persistentPage
}

let isPersistentBrowserActive = false

const activeBrowserCmdResolvers = new Map<string, (result: any) => void>()

ipcMain.on('browser-exec-result', (_event, data: { requestId: string; result: any }) => {
  const resolver = activeBrowserCmdResolvers.get(data.requestId)
  if (resolver) {
    resolver(data.result)
    activeBrowserCmdResolvers.delete(data.requestId)
  }
})

export async function sendBrowserCommandToRenderer(
  command: {
    type:
      | 'open'
      | 'navigate'
      | 'click'
      | 'type'
      | 'press'
      | 'scroll'
      | 'back'
      | 'script'
      | 'snapshot'
      | 'screenshot'
      | 'close'
    url?: string
    elementId?: string
    text?: string
    key?: string
    direction?: 'up' | 'down'
    amount?: string
    script?: string
    full?: boolean
  },
  signal?: AbortSignal
): Promise<any> {
  const wins = BrowserWindow.getAllWindows()
  const targetWin = wins.find((w) => !w.webContents.getURL().includes('#launcher')) || wins[0]
  if (!targetWin) {
    return 'Error: No renderer window available'
  }

  const requestId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      activeBrowserCmdResolvers.delete(requestId)
      reject(new Error('AbortError'))
    }

    if (signal) {
      if (signal.aborted) return reject(new Error('AbortError'))
      signal.addEventListener('abort', onAbort)
    }

    const timeout = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      activeBrowserCmdResolvers.delete(requestId)
      resolve(`Error: Browser action "${command.type}" timed out.`)
    }, 30000)

    activeBrowserCmdResolvers.set(requestId, (result) => {
      clearTimeout(timeout)
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve(result)
    })

    targetWin.webContents.send('browser-exec-command', { requestId, command })
  })
}

export async function openBrowser(url?: string, signal?: AbortSignal): Promise<string> {
  isPersistentBrowserActive = true
  emitBrowserAction({ type: 'open', url }).catch(() => {})
  const result = await sendBrowserCommandToRenderer({ type: 'open', url }, signal)
  return typeof result === 'string' ? result : 'Browser session opened successfully.'
}

export async function browserNavigate(url: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  emitBrowserAction({ type: 'navigate', url }).catch(() => {})
  const result = await sendBrowserCommandToRenderer({ type: 'navigate', url }, signal)
  return typeof result === 'string' ? result : `Navigated to ${url} successfully.`
}

export async function browserSnapshot(full?: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer(
    { type: 'snapshot', full: full === 'true' },
    signal
  )
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export async function browserClick(elementId: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'click', elementId }, signal)
  return typeof result === 'string' ? result : `Clicked element ${elementId} successfully.`
}

export async function browserType(elementId: string, text: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'type', elementId, text }, signal)
  return typeof result === 'string' ? result : `Typed into element ${elementId} successfully.`
}

export async function browserPress(key: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'press', key }, signal)
  return typeof result === 'string' ? result : `Pressed key "${key}" successfully.`
}

export async function browserScroll(direction: 'up' | 'down', amount?: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'scroll', direction, amount }, signal)
  return typeof result === 'string' ? result : `Scrolled page ${direction} successfully.`
}

export async function browserBack(signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'back' }, signal)
  return typeof result === 'string' ? result : 'Navigated back in browser history successfully.'
}

export async function browserScreenshot(signal?: AbortSignal): Promise<{ result: string; base64?: string }> {
  if (!isPersistentBrowserActive) {
    return {
      result:
        'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
  }
  const res = await sendBrowserCommandToRenderer({ type: 'screenshot' }, signal)
  if (typeof res === 'object' && res?.base64) {
    return {
      result: 'Screenshot captured successfully and attached to context.',
      base64: res.base64
    }
  }
  return { result: typeof res === 'string' ? res : 'Screenshot captured successfully.' }
}

export async function closePersistentBrowser(): Promise<string> {
  isPersistentBrowserActive = false
  await sendBrowserCommandToRenderer({ type: 'close' }).catch(() => {})
  _browserActionEmitter?.({ type: 'close', timestamp: Date.now() })
  return 'Browser session closed successfully.'
}

export async function webScript(url: string, script: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'script', url, script }, signal)
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export async function detailedDomPage(url?: string, signal?: AbortSignal): Promise<string> {
  if (!isPersistentBrowserActive) {
    return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
  }
  const result = await sendBrowserCommandToRenderer({ type: 'snapshot', url, full: true }, signal)
  return typeof result === 'string' ? result : JSON.stringify(result)
}

/**
 * Automatically clicks common cookie consent banners to expose the main page content.
 */
async function handleConsentBanners(page: any) {
  try {
    const selectors = [
      'button:has-text("Accept all")',
      'button:has-text("Aceitar tudo")',
      'button:has-text("Aceptar todo")',
      'button:has-text("I agree")',
      'button:has-text("Concordo")',
      'button:has-text("Concordar")',
      'button:has-text("Accept")',
      'button:has-text("Aceitar")',
      'button:has-text("Agree")',
      'button:has-text("Aceito")',
      'button:has-text("Accept All")'
    ]

    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        console.log(`handleConsentBanners: Clicking consent button matching "${selector}"`)
        await locator.click()
        await page.waitForTimeout(1000).catch(() => {})
        break
      }
    }
  } catch (err) {
    console.warn('handleConsentBanners: Error handling banners:', err)
  }
}

/**
 * Fetches and returns text content from a URL using Playwright.
 */
export async function sawLinkFromUrl(url: string, signal?: AbortSignal): Promise<string> {
  let browser: Browser | null = null

  // Handle abort logic
  const onAbort = () => {
    console.log('sawLinkFromUrl: Abort requested, closing browser.')
    browser?.close().catch(() => {})
  }

  try {
    const targetUrl = normalizeHttpUrl(url, 'url')

    if (signal) {
      if (signal.aborted) throw new Error('AbortError')
      signal.addEventListener('abort', onAbort)
    }

    browser = await launchBrowser()
    const context = await createBrowserContext(browser)
    const page = await context.newPage()

    // Spoof navigator.webdriver to bypass automated browser detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      ;(window as any).chrome = { runtime: {} }
    })

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })

    // Try to auto-dismiss any cookie banners to avoid text cluttering
    await handleConsentBanners(page)

    // Clean page and extract text
    const text = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script, style, iframe, noscript, svg, path')
      scripts.forEach((el) => el.remove())
      return document.body.innerText || ''
    })

    const cleaned = text.replace(/\s+/g, ' ').trim()
    const MAX_CONTENT = 20000
    return cleaned.length > MAX_CONTENT
      ? cleaned.substring(0, MAX_CONTENT) + '... (truncated)'
      : cleaned
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : String(error)
    return `Error fetching URL: ${message}`
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

/**
 * Performs a single web search query using Google Search and Playwright.
 * Returns the formatted results string (or an error message on failure).
 *
 * Reused by the continuous `webSearch` (one call per search term) and kept as
 * a standalone export for surfaces that still use the legacy `{query}` shape
 * (e.g. the AI Search modal and the Launcher).
 */
export async function webSearchSingle(query: string, signal?: AbortSignal): Promise<string> {
  let browser: Browser | null = null

  // Handle abort logic
  const onAbort = () => {
    console.log('webSearchSingle: Abort requested, closing browser.')
    browser?.close().catch(() => {})
  }

  try {
    if (signal) {
      if (signal.aborted) throw new Error('AbortError')
      signal.addEventListener('abort', onAbort)
    }

    browser = await launchBrowser()
    const context = await createBrowserContext(browser)
    const page = await context.newPage()

    // Spoof navigator.webdriver to bypass automated browser detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      ;(window as any).chrome = { runtime: {} }
    })

    // Perform Google Search
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    })

    // Handle Google's redirect consent walls or overlay banners
    const currentHost = (() => { try { return new URL(page.url()).hostname } catch { return '' } })()
    if (currentHost === 'consent.google.com') {
      console.log('webSearchSingle: Redirected to Google consent page. Clicking accept...')
      await handleConsentBanners(page)
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 })
        .catch(() => {})
    } else {
      await handleConsentBanners(page)
    }

    // Extract organic search results immediately (no waiting for Gemini / AI Overview)
    let results = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a h3'))
      const seenLinks = new Set<string>()
      const list: { title: string; link: string; snippet: string }[] = []

      for (const h3 of links) {
        const anchor = h3.closest('a')
        if (!anchor) continue
        const link = anchor.getAttribute('href')
        if (!link || seenLinks.has(link)) continue
        seenLinks.add(link)

        // Climb up DOM to search for description snippet
        let container = h3.parentElement
        let snippet = ''
        let attempts = 0
        while (container && attempts < 6) {
          const descEl = container.querySelector(
            '.VwiC3b, .yD3nu, div[style*="-webkit-line-clamp"]'
          )
          if (descEl) {
            snippet = descEl.textContent || ''
            break
          }
          container = container.parentElement
          attempts++
        }

        list.push({
          title: h3.textContent || '',
          link,
          snippet
        })
        if (list.length >= 5) break
      }
      return list
    })

    if (results.length === 0) {
      console.log(
        'webSearchSingle: Google search yielded no results. Trying DuckDuckGo fallback...'
      )
      await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      })

      results = await page.evaluate(() => {
        const list: { title: string; link: string; snippet: string }[] = []
        const resultElements = Array.from(document.querySelectorAll('.result'))
        for (const el of resultElements) {
          const titleEl = el.querySelector('.result__title a') as HTMLAnchorElement
          const snippetEl = el.querySelector('.result__snippet')
          if (!titleEl) continue
          let link = titleEl.getAttribute('href') || ''
          if (link.includes('uddg=')) {
            const match = link.match(/uddg=([^&]+)/)
            if (match && match[1]) {
              try {
                link = decodeURIComponent(match[1])
              } catch (e) {
                // ignore
              }
            }
          }
          const title = titleEl.textContent || ''
          const snippet = snippetEl?.textContent || ''
          list.push({ title, link, snippet })
          if (list.length >= 5) break
        }
        return list
      })
    }

    if (results.length === 0) {
      return 'No results found.'
    }

    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   Link: ${r.link}\n   Snippet: ${r.snippet}`)
      .join('\n\n')
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : String(error)
    return `Error performing web search: ${message}`
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort)
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

/**
 * Backwards-compatible alias for `webSearchSingle`. Kept so existing imports
 * (Launcher, AI Search modal, tests) continue to work untouched.
 */
export async function webSearch(query: string, signal?: AbortSignal): Promise<string> {
  return webSearchSingle(query, signal)
}

/**
 * A single continuous web search session. Each entry carries a human-friendly
 * `title` (what the user sees in the UI) and the actual `query` keywords sent
 * to Google.
 */
export interface WebSearchEntry {
  title: string
  query: string
}

/**
 * Performs a continuous web search across multiple terms. Each search runs
 * sequentially via `webSearchSingle`; before every term, `onProgress(title)`
 * fires so the UI can append the friendly title to the live "Searching Web"
 * list. All results are concatenated under per-title headers and returned as
 * one string for the model to consume.
 */
export async function webSearchContinuous(
  searches: WebSearchEntry[],
  opts: { onProgress?: (title: string) => void; signal?: AbortSignal } = {}
): Promise<string> {
  if (!searches || searches.length === 0) {
    return 'No search terms provided.'
  }

  const sections: string[] = []

  for (const entry of searches) {
    if (opts.signal?.aborted) throw new Error('AbortError')

    // Notify the UI a new search is starting before actually running it.
    try {
      opts.onProgress?.(entry.title)
    } catch (e) {
      // onProgress failures must never break the search itself.
    }

    const result = await webSearchSingle(entry.query, opts.signal)

    const header = searches.length > 1 ? `### ${entry.title}\n(Query: ${entry.query})\n\n` : ''

    sections.push(`${header}${result}`)
  }

  return sections.join('\n\n---\n\n')
}

/**
 * Returns the system prompt configured with the correct model identity.
 */
export function getSystemToolsPrompt(
  modelKey: string,
  target: 'main' | 'subagent' | 'both' | 'launcher' = 'main',
  allowedTools?: string[],
  sessionMode: SessionMode = 'execution',
  disciplinePath?: string
): string {
  let shellName = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  try {
    const config = loadConfig()
    shellName = config.terminalShell || shellName
  } catch (err) {
    console.error('Failed to load config for terminal prompt:', err)
  }
  const terminalSummary = getLocalCommandSandboxSummary(shellName)
  const shellSyntax = getShellSyntaxSummary(shellName)
  const name = 'Prism AI'
  const modelName = modelKey || 'AI Assistant'

  const toolsPrompt = toolsManifest
    .filter((t) => {
      if (allowedTools && allowedTools.length > 0) {
        if (!allowedTools.includes(t.name)) {
          return false
        }
      }
      if (target === 'launcher') {
        return true
      }
      return !t.target || t.target === 'both' || t.target === target
    })
    .map((t) => {
      const p = Object.entries(t.parameters)
        .map(([k, d]) => `${k}:${typeof d === 'string' ? d : d.description || d.type}`)
        .join(',')
      return `${t.name}: ${t.description} | ${t.usage}${p ? ` | ${p}` : ''}`
    })
    .join('\n')

  const username = os.userInfo().username
  const platform = process.platform
  const homeDir = os.homedir()
  
  let cwd = process.cwd()
  if (sessionMode === 'discipline' && disciplinePath) {
    cwd = disciplinePath
  } else if (sessionMode === 'execution') {
    cwd = os.homedir()
  }

  const date = new Date().toLocaleString('en-US', {
    timeZoneName: 'short',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  if (target === 'launcher') {
    return `# Identity & Context
Role: Prism AI (${modelName}), running in the Quick Launcher (full capabilities).
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd} | Terminal: ${terminalSummary}

# Rules
- **Simple Markdown Only:** Respond ONLY using traditional simple Markdown.
- **Auto-Open:** If an app, link, or path is sent in isolation, IMMEDIATELY open it via open_browser_link or open_application.
- **Transitions:** For long-running or complex tasks, call open_main_app to continue in the main application.
- **Full Tool Access:** You have access to all tools — terminal, files, browser, search, apps, and more.

# Tool Protocol & Execution
- **Native Tool Calling**: You have access to native tool calling. Call functions natively when needed. Do NOT write [PRISM_EXECUTE_TOOL] blocks yourself, the system handles function execution natively.
- **Requirements**: Absolute paths are required for all file operations.
- **Terminal CLI**: Commands run in user's terminal \`${shellName}\`; use ${shellSyntax} syntax.
- **Filesystem Safety**: \`computer_use_*\` file tools modify files only at explicit paths.
- **Persistent Browser**: For browser_* actions (except browser_close) and web_script, call open_browser first and browser_close when done.
- **Parallelism**: You can call multiple functions natively in parallel to speed up tasks.

Tools:
${toolsPrompt}`
  }

  if (sessionMode === 'conversation' && target === 'main') {
    return `# Identity & Context
Role: ${name} (${modelName}), running in Conversation Mode.
Context: ${date} | ${platform} | Home: ${homeDir} | CWD: ${cwd}

# Rules
- **Conversation Mode**: You are running in Conversation Mode. You do NOT have access to any tools. Do NOT attempt to perform any tool/function calls. Reply to the user using text/Markdown.
- Match user's language. Be direct, factual, and concise.
- Simple Markdown: Use standard Markdown for all replies.`
  }

  const parallelRule =
    '- Parallelism: You can call multiple functions natively in parallel to speed up tasks.'

  const disciplineRule =
    sessionMode === 'discipline' && disciplinePath
      ? `\n- **Discipline Mode**: You are operating in Discipline Mode. All operations and commands run directly in: ${disciplinePath}. Perform modifications relative to this path.`
      : ''

  return `# Identity & Context
Role: ${name} (${modelName}), a concise, tool-capable desktop assistant.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd} | Terminal: ${terminalSummary}

# Visual & Interaction Protocol
1. **Simple Markdown (95% of replies):** Use for answers, code, and explanations. NEVER wrap standard text in HTML/CSS.
2. **Rich Markdown (HTML/CSS):** Use for cards, in-app designs, or when showing something visually within the message itself. You MUST write the HTML/CSS code directly inside the message Markdown (without wrapping it in code blocks like \`\`\`html) so that the application renders it inline directly to the user.
3. **Mini Apps:** You have access to the \`create_mini_app\` native tool. Use it ONLY for interactive, stateful widgets (calculators, dashboards, forms, games). Do NOT write raw HTML/CSS/JS in text or use text-based XML markers for mini-apps; instead, call the \`create_mini_app\` tool natively with the appropriate parameters.

# Operating Rules
- Match user's language. Be direct, factual, and concise; prefer action over commentary.${disciplineRule}
- **Auto-Open:** If an app, link, or path is sent in isolation, IMMEDIATELY open it via open_browser_link, open_application, or relevant tool.
- Preserve file indentation exactly.
- Do not expose thoughts/reasoning; provide conclusions and evidence.
- Never invent tool results, paths, or citations.


# Search Protocols
1. **Active Search:** Search using web_search and read page contents using saw_link_from_url. Do not rely solely on snippets.
2. **Deep Research (If enabled):**
   - Step 1: Search for context.
   - Step 2: Present a Research Plan and explicitly ask user if they approve. Stop generation immediately.
   - Step 3 (After approval): Run at least 10 search/read iterations.
   - Step 4: Output a dense Markdown report.
# Tool Protocol & Execution
- **Native Tool Calling**: You have access to native tool calling. Call functions natively when needed. Do NOT write [PRISM_EXECUTE_TOOL] blocks yourself, the system handles function execution natively.
- **Requirements**: Absolute paths are required for all file operations.
- **Terminal CLI**: Commands run in user's terminal \`${shellName}\`; use ${shellSyntax} syntax.
- **Filesystem Safety**: \`computer_use_*\` file tools modify files only at explicit paths (no filesystem roots or protected system paths).
- **Persistent Browser**: For browser_* actions (except browser_close) and web_script, call open_browser first and browser_close when done.
${parallelRule}

# Prism Internal Knowledge
For Prism-specific questions (features, themes, shortcuts, architecture), you MUST use \`internal_docs_list\` and \`internal_docs_read\`. Do NOT hallucinate facts.

# Dynamic Surveys (to_ask)
Use to_ask for structured user preferences/feedback. Blocks execution.
Schema: {"session_id": "UUID", "questions": [{"id": "q1", "type": "multiple-choice | essay", "title": "Category", "prompt": "Prompt text", "options": [{"value": "val", "label": "Label"}], "placeholder": "Text"}]}

Tools:
${toolsPrompt}`
}

/**
 * Searches files in the current workspace (CWD).
 */
export async function searchWorkspaceFiles(
  query: string
): Promise<{ name: string; path: string; relativePath: string }[]> {
  const rootDir = process.cwd()
  const results: { name: string; path: string; relativePath: string }[] = []
  const maxMatches = 10
  const maxScanned = 1500
  let scannedCount = 0
  const ignoredDirs = new Set([
    'node_modules',
    '.git',
    'out',
    'build',
    'dist',
    '.npm',
    '.gemini',
    'resources'
  ])

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || results.length >= maxMatches || scannedCount >= maxScanned) return
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= maxMatches || scannedCount >= maxScanned) return
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const nameLower = entry.name.toLowerCase()
          if (
            !ignoredDirs.has(entry.name) &&
            !entry.name.startsWith('.') &&
            nameLower !== 'appdata' &&
            nameLower !== 'library' &&
            nameLower !== 'local settings' &&
            nameLower !== 'application data'
          ) {
            await walk(fullPath, depth + 1)
          }
        } else if (entry.isFile()) {
          scannedCount++
          if (entry.name.toLowerCase().includes(query.toLowerCase())) {
            const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/')
            results.push({
              name: entry.name,
              path: fullPath.replace(/\\/g, '/'),
              relativePath: relPath
            })
          }
        }
      }
    } catch {
      // ignore
    }
  }

  await walk(rootDir, 0)
  return results
}

/**
 * Captures a screenshot of a specific application window or the entire screen.
 */
export async function captureAppScreenshot(
  appName: string
): Promise<{ result: string; base64?: string }> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    let targetSource = sources.find((s) => {
      const nameLower = s.name.toLowerCase()
      const appNameLower = appName.toLowerCase()
      return nameLower.includes(appNameLower) && s.id.startsWith('window')
    })

    if (
      !targetSource &&
      (appName.toLowerCase() === 'entire screen' ||
        appName.toLowerCase() === 'screen' ||
        appName.toLowerCase() === 'desktop' ||
        appName.toLowerCase() === 'entire_screen')
    ) {
      targetSource = sources.find((s) => s.id.startsWith('screen'))
    }

    if (!targetSource) {
      // Fallback: search across all sources (including screens) for matching name
      targetSource = sources.find((s) => s.name.toLowerCase().includes(appName.toLowerCase()))
    }

    if (!targetSource) {
      // Final fallback: first available screen or any source
      targetSource = sources.find((s) => s.id.startsWith('screen')) || sources[0]
    }

    if (!targetSource) {
      return { result: 'Error: No screens or windows available to capture.' }
    }

    const image = targetSource.thumbnail
    const base64 = image.toPNG().toString('base64')
    return {
      result: `Screenshot of "${targetSource.name}" captured successfully.`,
      base64
    }
  } catch (error) {
    return {
      result: `Error capturing screenshot: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ── Todo System ──────────────────────────────────────────────────────────────
export const sessionTodos = new Map<string, TodoState>()

export function getTodoForChat(chatId: string): TodoState | null {
  return sessionTodos.get(chatId) || null
}

let _currentSessionIdForTodo = ''
export function setCurrentSessionIdForTodo(id: string): void {
  _currentSessionIdForTodo = id
}

export function buildTodoReminder(chatId?: string): string {
  const todo = sessionTodos.get(chatId || _currentSessionIdForTodo)
  if (!todo || !todo.active) return ''
  const pendingCount = todo.tasks.filter((t) => t.status !== 'done').length
  if (pendingCount === 0) return ''

  const working = todo.tasks.find((t) => t.status === 'working')
  const statusStr = working
    ? `Current: "${working.title}". (${pendingCount} pending)`
    : `${pendingCount} tasks remaining.`

  return `[Todo Status: ${statusStr}]`
}

export async function executeSystemTool(
  toolName: string,
  args: Record<string, any>,
  event?: any,
  apiKey?: string,
  signal?: AbortSignal,
  chatId?: string
): Promise<string> {
  switch (toolName) {
    // Terminal
    case 'execute_terminal_command':
      return await runTerminalCommand(args.command || '', apiKey, signal, event, chatId)

    // File operations
    case 'computer_use_create_file':
      return await computerCreateFile(args.path || args.filePath || '', args.content || '', signal)
    case 'computer_use_create_directory':
      return await computerCreateDirectory(args.path || '', signal)
    case 'computer_use_remove_file':
      return await computerRemoveFile(args.path || args.filePath || '', signal)
    case 'computer_use_remove_directory':
      return await computerRemoveDirectory(args.path || '', signal)
    case 'computer_use_save_file':
      return await computerSaveFile(args.path || args.filePath || '', args.content || '', signal)
    case 'computer_use_append_file':
      return await computerAppendToFile(args.path || args.filePath || '', args.content || '', signal)
    case 'computer_use_read_file': {
      const startLine = args.startLine !== undefined ? Number(args.startLine) : 1
      const limit = args.limit !== undefined ? Number(args.limit) : 200
      return await computerReadFile(
        args.path || args.filePath || '',
        isNaN(startLine) ? 1 : startLine,
        isNaN(limit) ? 200 : limit,
        signal
      )
    }
    case 'computer_use_edit_file':
      return await computerEditFile(args.path || args.filePath || '', args.startLine || '1', args.endLine || '1', args.content || args.newContent || '', signal)
    case 'computer_use_copy_file':
      return await computerCopyFile(args.sourcePath || '', args.destinationPath || '', args.overwrite, signal)
    case 'computer_use_move_file':
      return await computerMoveFile(args.sourcePath || '', args.destinationPath || '', args.overwrite, signal)
    case 'computer_use_get_file_info':
      return await computerGetFileInfo(args.path || args.filePath || '', signal)
    case 'computer_use_list_directory':
      return await computerListDirectory(args.path || '.', signal)

    // Applications & links
    case 'open_application':
      return await openApplication(args.appPath || args.appName || '')
    case 'open_browser_link':
      return await openBrowserLink(args.url || '')
    case 'open_main_app': {
      try {
        const instructions = args.instructions || ''
        const model = args.model || ''
        const searchEnabled = args.searchEnabled === 'true'

        const wins = BrowserWindow.getAllWindows()
        const mainWin = wins.find(
          (w) => !w.webContents.getURL().includes('#launcher') && !w.webContents.getURL().includes('#subagents') && !w.webContents.getURL().includes('#mini-app')
        ) || wins[0]

        if (!mainWin) {
          return 'Error: No main application window found.'
        }

        if (mainWin.isMinimized()) mainWin.restore()
        mainWin.show()
        mainWin.focus()

        // Hide launcher window if visible
        const launcherWin = wins.find((w) => w.webContents.getURL().includes('#launcher'))
        if (launcherWin && launcherWin.isVisible()) {
          launcherWin.hide()
        }

        mainWin.webContents.send('open-main-app-with-instructions', {
          instructions,
          model,
          searchEnabled
        })

        return `Opened main application with instructions.${model ? ` Model set to: ${model}.` : ''}`
      } catch (err) {
        return `Error opening main app: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    case 'search_installed_applications': {
      const files = await searchWorkspaceFiles(args.query || '')
      return files.length > 0
        ? files.map((f) => `${f.name} (${f.relativePath})`).join('\n')
        : 'No matching files found.'
    }

    // Web search
    case 'web_search': {
      const searches = args.searches
      if (Array.isArray(searches) && searches.length > 0) {
        return await webSearchContinuous(searches, { signal })
      }
      return await webSearchSingle(args.query || args.search || '', signal)
    }
    case 'saw_link_from_url':
      return await sawLinkFromUrl(args.url || '', signal)

    // Persistent browser
    case 'open_browser':
      return await openBrowser(args.url, signal)
    case 'browser_navigate':
      return await browserNavigate(args.url || '', signal)
    case 'browser_use_switch_url': {
      if (!persistentPage || persistentPage.isClosed()) {
        return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
      }
      return await browserNavigate(args.url || '', signal)
    }
    case 'browser_snapshot':
      return await browserSnapshot(args.full, signal)
    case 'browser_click':
      return await browserClick(String(args.elementId || ''), signal)
    case 'browser_type':
      return await browserType(String(args.elementId || ''), args.text || '', signal)
    case 'browser_press':
      return await browserPress(args.key || 'Enter', signal)
    case 'browser_scroll':
      return await browserScroll(args.direction || 'down', args.amount, signal)
    case 'browser_back':
      return await browserBack(signal)
    case 'browser_screenshot': {
      const screenshotResult = await browserScreenshot(signal)
      return screenshotResult.result
    }
    case 'browser_close':
      return await closePersistentBrowser()

    // Web scripting & DOM
    case 'web_script':
      return await webScript(args.url || '', args.script || '', signal)
    case 'detailed_dom_page':
      return await detailedDomPage(args.url, signal)

    // Screenshot
    case 'computer_use_see_screen': {
      const screenResult = await captureAppScreenshot(args.appName || 'Entire Screen')
      return screenResult.result
    }

    // Todo system
    case 'create_todo': {
      const tasksInput = args.tasks
      let taskTitles: string[] = []
      if (typeof tasksInput === 'string') {
        try {
          const parsed = JSON.parse(tasksInput)
          if (Array.isArray(parsed)) taskTitles = parsed.map(String)
        } catch {
          taskTitles = [tasksInput]
        }
      } else if (Array.isArray(tasksInput)) {
        taskTitles = tasksInput.map(String)
      }

      if (taskTitles.length < 2) {
        return 'Error: create_todo requires at least 2 tasks. Please define a more detailed plan with at least 2 steps.'
      }
      if (taskTitles.length > 30) {
        taskTitles = taskTitles.slice(0, 30)
      }

      const todoChatId = chatId || _currentSessionIdForTodo
      const todo: TodoState = {
        tasks: taskTitles.map((title, i) => ({
          id: `task-${i}`,
          title,
          status: 'pending' as const
        })),
        createdAt: Date.now(),
        active: true,
        chatId: todoChatId
      }
      sessionTodos.set(todoChatId, todo)

      try {
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) {
          if (!win.webContents.getURL().includes('#launcher') && !win.webContents.getURL().includes('#subagents')) {
            win.webContents.send('chat-todo-update', todo)
          }
        }
      } catch {}

      return `Todo list created with ${taskTitles.length} tasks. ${buildTodoReminder(todoChatId)}`
    }

    case 'edit_todo': {
      const todoChatId = chatId || _currentSessionIdForTodo
      const todo = sessionTodos.get(todoChatId)
      if (!todo || !todo.active) {
        return 'Error: No active todo list. Create one first with create_todo.'
      }

      const taskId = (args.id || '').toString().trim()
      const newStatus = (args.status || '').toString().trim() as 'working' | 'done'

      if (!taskId) return 'Error: Task ID is required (e.g. "task-0", "task-1").'
      if (newStatus !== 'working' && newStatus !== 'done') {
        return 'Error: Status must be "working" or "done".'
      }

      const taskIndex = todo.tasks.findIndex((t) => t.id === taskId)
      if (taskIndex === -1) {
        return `Error: Task "${taskId}" not found. Available tasks: ${todo.tasks.map((t) => `${t.id} (${t.title})`).join(', ')}`
      }

      if (todo.tasks[taskIndex].status === 'done' && newStatus === 'done') {
        return `Task "${taskId}" (${todo.tasks[taskIndex].title}) is already marked as done.`
      }

      todo.tasks[taskIndex] = {
        ...todo.tasks[taskIndex],
        status: newStatus
      }

      const allDone = todo.tasks.every((t) => t.status === 'done')
      if (allDone) {
        todo.active = false
      }

      try {
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) {
          if (!win.webContents.getURL().includes('#launcher') && !win.webContents.getURL().includes('#subagents')) {
            win.webContents.send('chat-todo-update', todo)
          }
        }
        if (allDone) {
          for (const win of wins) {
            if (!win.webContents.getURL().includes('#launcher')) {
              win.webContents.send('chat-todo-complete', { chatId: todoChatId })
            }
          }
        }
      } catch {}

      if (allDone) {
        return `All tasks completed!`
      }

      return `Task "${todo.tasks[taskIndex].title}" updated to "${newStatus}". ${buildTodoReminder(todoChatId)}`
    }

    // Chat history tools
    case 'search_chat_history':
      return await searchChatHistory(args.query || '')
    case 'search_chat_memory':
      return await searchChatMemory(args.query || '')
    case 'render_chat_history': {
      const query = args.query || ''
      const cleanId = query.replace('chat_', '').replace('.json', '').trim()
      const session = loadChatSession(cleanId)
      if (session) {
        return `Successfully rendered chat history item in UI. Title: "${session.title}", Messages: ${session.messages.length}`
      }
      return `Error: Chat history session "${cleanId}" not found.`
    }
    case 'not_found_chat_history':
      return 'Successfully registered that no matching chat history was found.'

    // Configuration
    case 'configure_prism': {
      try {
        // Explicit Security Check: AI cannot edit API keys or provider credentials
        if (
          args.userGeminiKey !== undefined ||
          args.userOpenaiKey !== undefined ||
          args.userNvidiaNimKey !== undefined ||
          args.apiKey !== undefined ||
          args.providers !== undefined
        ) {
          return 'Error: Modifying API keys or provider credentials via AI tools is strictly disabled for security reasons.'
        }

        const config = loadConfig()
        const changed: string[] = []

        if (args.launcherShortcut !== undefined && args.launcherShortcut !== '') {
          config.launcherShortcut = args.launcherShortcut
          changed.push(`launcherShortcut: "${args.launcherShortcut}"`)
        }
        if (args.screenshotShortcut !== undefined && args.screenshotShortcut !== '') {
          config.screenshotShortcut = args.screenshotShortcut
          changed.push(`screenshotShortcut: "${args.screenshotShortcut}"`)
        }
        if (args.modelSelectionShortcut !== undefined && args.modelSelectionShortcut !== '') {
          config.modelSelectionShortcut = args.modelSelectionShortcut
          changed.push(`modelSelectionShortcut: "${args.modelSelectionShortcut}"`)
        }
        if (args.newChatShortcut !== undefined && args.newChatShortcut !== '') {
          config.newChatShortcut = args.newChatShortcut
          changed.push(`newChatShortcut: "${args.newChatShortcut}"`)
        }
        if (args.dictationShortcut !== undefined && args.dictationShortcut !== '') {
          config.dictationShortcut = args.dictationShortcut
          changed.push(`dictationShortcut: "${args.dictationShortcut}"`)
        }
        if (args.webSearchShortcut !== undefined && args.webSearchShortcut !== '') {
          config.webSearchShortcut = args.webSearchShortcut
          changed.push(`webSearchShortcut: "${args.webSearchShortcut}"`)
        }
        if (args.youtubeModeShortcut !== undefined && args.youtubeModeShortcut !== '') {
          config.youtubeModeShortcut = args.youtubeModeShortcut
          changed.push(`youtubeModeShortcut: "${args.youtubeModeShortcut}"`)
        }
        if (args.lastSelectedChatModel !== undefined && args.lastSelectedChatModel !== '') {
          config.lastSelectedChatModel = args.lastSelectedChatModel
          changed.push(`lastSelectedChatModel: "${args.lastSelectedChatModel}"`)
        } else if (args.defaultModel !== undefined && args.defaultModel !== '') {
          config.lastSelectedChatModel = args.defaultModel
          changed.push(`lastSelectedChatModel: "${args.defaultModel}"`)
        }
        if (args.searchModel !== undefined && args.searchModel !== '') {
          config.searchModel = args.searchModel
          changed.push(`searchModel: "${args.searchModel}"`)
        }
        if (args.quickLauncherModel !== undefined && args.quickLauncherModel !== '') {
          config.quickLauncherModel = args.quickLauncherModel
          changed.push(`quickLauncherModel: "${args.quickLauncherModel}"`)
        }
        if (args.sttModel !== undefined && args.sttModel !== '') {
          config.sttModel = args.sttModel
          changed.push(`sttModel: "${args.sttModel}"`)
        }
        if (args.minimizeToTray !== undefined) {
          config.minimizeToTray = args.minimizeToTray === 'true' || args.minimizeToTray === true
          changed.push(`minimizeToTray: ${config.minimizeToTray}`)
        }
        if (args.autoLaunch !== undefined) {
          config.autoLaunch = args.autoLaunch === 'true' || args.autoLaunch === true
          changed.push(`autoLaunch: ${config.autoLaunch}`)
        }
        if (args.quickLauncherMode !== undefined) {
          config.quickLauncherMode = args.quickLauncherMode
          changed.push(`quickLauncherMode: "${args.quickLauncherMode}"`)
        }
        if (args.username !== undefined && args.username !== '') {
          config.username = args.username
          changed.push(`username: "${args.username}"`)
        }
        if (args.ttsVoice !== undefined && args.ttsVoice !== '') {
          config.ttsVoice = args.ttsVoice
          changed.push(`ttsVoice: "${args.ttsVoice}"`)
        }
        if (args.theme !== undefined && args.theme !== '') {
          config.theme = args.theme as any
          changed.push(`theme: "${args.theme}"`)
        }
        if (args.terminalShell !== undefined && args.terminalShell !== '') {
          config.terminalShell = args.terminalShell
          changed.push(`terminalShell: "${args.terminalShell}"`)
        }
        if (args.zoomFactor !== undefined) {
          const zoom = parseFloat(args.zoomFactor)
          if (!isNaN(zoom) && zoom >= 0.5 && zoom <= 3.0) {
            config.zoomFactor = zoom
            changed.push(`zoomFactor: ${zoom}`)
          }
        }

        if (changed.length === 0) {
          return 'No valid settings provided to configure. Please specify at least one setting.'
        }

        const success = saveConfig(config)
        if (success) {
          ipcMain.emit('update-config-from-tools', null, config)
          return `Successfully updated settings:\n${changed.map((c) => `- ${c}`).join('\n')}`
        }
        return 'Error: Failed to save configuration.'
      } catch (err) {
        return `Error configuring Prism: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // Internal docs
    case 'internal_docs_list': {
      try {
        const isDev = !app.isPackaged
        const docsPath = isDev
          ? path.join(__dirname, '../../resources/docs')
          : path.join(process.resourcesPath, 'docs')

        try {
          const files = await fs.readdir(docsPath)
          const mdFiles = files.filter((f) => f.endsWith('.md'))
          if (mdFiles.length === 0) return 'No internal documentation found.'
          return `Available internal documentation files:\n${mdFiles.map((f) => `- ${f}`).join('\n')}`
        } catch (e: any) {
          if (e.code === 'ENOENT') return 'Documentation directory not found.'
          throw e
        }
      } catch (error) {
        return `Error listing docs: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    case 'internal_docs_read': {
      try {
        const isDev = !app.isPackaged
        const docsPath = isDev
          ? path.join(__dirname, '../../resources/docs')
          : path.join(process.resourcesPath, 'docs')

        const filename = args.filename
        if (!filename || !filename.endsWith('.md')) {
          return 'Error: Invalid filename. Must be a .md file from the internal_docs_list.'
        }

        const filePath = path.join(docsPath, path.basename(filename))
        try {
          const content = await fs.readFile(filePath, 'utf-8')
          return content
        } catch (e: any) {
          if (e.code === 'ENOENT') return `Error: Documentation file "${filename}" not found.`
          throw e
        }
      } catch (error) {
        return `Error reading doc: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    // Questionnaire
    case 'to_ask': {
      return new Promise<string>((resolve, reject) => {
        const sessionId =
          args.session_id || `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

        const onAbort = () => {
          activeQuestionnaireResolvers.delete(sessionId)
          reject(new Error('AbortError'))
        }

        if (signal) {
          if (signal.aborted) {
            return reject(new Error('AbortError'))
          }
          signal.addEventListener('abort', onAbort)
        }

        // Send questionnaire to renderer
        try {
          const wins = BrowserWindow.getAllWindows()
          for (const win of wins) {
            if (!win.webContents.getURL().includes('#launcher') && !win.webContents.getURL().includes('#subagents')) {
              win.webContents.send('show-questionnaire', {
                sessionId,
                questions: args.questions || []
              })
            }
          }
        } catch {}

        activeQuestionnaireResolvers.set(sessionId, (result) => {
          if (signal) {
            signal.removeEventListener('abort', onAbort)
          }
          resolve(result)
        })
      })
    }

    // Workflow management
    case 'list_workflows': {
      try {
        const config = loadConfig()
        const workflows = config.workflows || []
        if (workflows.length === 0) {
          return 'No custom workflows configured.'
        }
        return JSON.stringify(workflows, null, 2)
      } catch (err) {
        return `Error listing workflows: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    case 'save_workflow': {
      try {
        const config = loadConfig()
        const wList = config.workflows || []

        const command = (args.command || '').trim()
        const name = (args.name || '').trim()
        const description = (args.description || '').trim()
        const systemInstruction = (args.systemInstruction || '').trim()

        let toolConstraints: string[] = []
        if (args.toolConstraints) {
          if (Array.isArray(args.toolConstraints)) {
            toolConstraints = args.toolConstraints
          } else if (typeof args.toolConstraints === 'string') {
            try {
              const parsed = JSON.parse(args.toolConstraints)
              if (Array.isArray(parsed)) {
                toolConstraints = parsed.map((t: any) => String(t).trim())
              } else {
                toolConstraints = args.toolConstraints.split(',').map((t: string) => t.trim()).filter(Boolean)
              }
            } catch {
              toolConstraints = args.toolConstraints.split(',').map((t: string) => t.trim()).filter(Boolean)
            }
          }
        }

        if (!command.startsWith('/')) {
          return 'Error: Workflow command must start with a slash (/) (e.g., "/coder")'
        }
        if (command.includes(' ')) {
          return 'Error: Workflow command cannot contain spaces'
        }
        if (command.length <= 1) {
          return 'Error: Workflow command is too short'
        }
        if (!name) {
          return 'Error: Workflow name is required'
        }
        if (!systemInstruction) {
          return 'Error: Workflow systemInstruction (System Instruction) is required'
        }

        const targetId = args.id || ''
        let existingIndex = -1
        if (targetId) {
          existingIndex = wList.findIndex((w) => w.id === targetId)
        }
        if (existingIndex === -1) {
          existingIndex = wList.findIndex((w) => w.command.toLowerCase() === command.toLowerCase())
        }

        const isDuplicate = wList.some(
          (w) => w.command.toLowerCase() === command.toLowerCase() && w.id !== targetId
        )
        if (isDuplicate) {
          return `Error: A workflow with command "${command}" already exists.`
        }

        // Validate toolConstraints exist in manifest
        const validToolNames = new Set(toolsManifest.map((t) => t.name))
        for (const tc of toolConstraints) {
          if (!validToolNames.has(tc)) {
            return `Error: Tool constraint "${tc}" is not a valid tool name.`
          }
        }

        const updatedWorkflow: SlashWorkflow = {
          id: targetId || `workflow-${Date.now()}`,
          command,
          name,
          description,
          systemInstruction,
          toolConstraints
        }

        let updatedWorkflows: SlashWorkflow[] = []
        if (existingIndex !== -1) {
          updatedWorkflows = [...wList]
          updatedWorkflows[existingIndex] = updatedWorkflow
        } else {
          updatedWorkflows = [...wList, updatedWorkflow]
        }

        const updatedConfig = { ...config, workflows: updatedWorkflows }
        const success = saveConfig(updatedConfig)
        if (success) {
          ipcMain.emit('update-config-from-tools', null, updatedConfig)
          return `Successfully saved workflow "${name}" (${command}).`
        } else {
          return 'Error: Failed to save the configuration containing the updated workflow.'
        }
      } catch (err) {
        return `Error saving workflow: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    case 'delete_workflow': {
      try {
        const config = loadConfig()
        const wList = config.workflows || []
        const identifier = (args.command || args.id || '').trim().toLowerCase()

        if (!identifier) {
          return 'Error: Please specify "command" or "id" of the workflow to delete.'
        }

        const index = wList.findIndex(
          (w) => w.id.toLowerCase() === identifier || w.command.toLowerCase() === identifier
        )

        if (index === -1) {
          return `Error: No workflow found matching "${identifier}".`
        }

        const removedWorkflow = wList[index]
        const updatedWorkflows = wList.filter((_, i) => i !== index)
        const updatedConfig = { ...config, workflows: updatedWorkflows }

        const success = saveConfig(updatedConfig)
        if (success) {
          ipcMain.emit('update-config-from-tools', null, updatedConfig)
          return `Successfully deleted workflow "${removedWorkflow.name}" (${removedWorkflow.command}).`
        } else {
          return 'Error: Failed to save the configuration after deleting the workflow.'
        }
      } catch (err) {
        return `Error deleting workflow: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // Mini app (handled by renderer, just return success)
    case 'create_mini_app':
      return 'Mini App created successfully.'

    default:
      return `Tool "${toolName}" is registered but not yet wired in the executor. Args received: ${JSON.stringify(args)}`
  }
}

// Questionnaire resolvers (for to_ask tool)
const activeQuestionnaireResolvers = new Map<string, (result: string) => void>()

ipcMain.on(
  'submit-questionnaire',
  (_event, data: { sessionId: string; responses: Record<string, string> }) => {
    const resolver = activeQuestionnaireResolvers.get(data.sessionId)
    if (resolver) {
      resolver(JSON.stringify({ session_id: data.sessionId, responses: data.responses }))
      activeQuestionnaireResolvers.delete(data.sessionId)
    }
  }
)
