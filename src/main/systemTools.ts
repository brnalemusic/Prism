import { exec, execFile } from 'child_process'
import { shell, desktopCapturer, app, BrowserWindow } from 'electron'
import { getInstalledApps } from 'get-installed-apps'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { toolsManifest } from './toolsManifest'
import { ApplicationInfo, DownloadProgress, SessionMode } from '../shared/types'
import { loadConfig } from './config'
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

async function getCookieHeaderForUrl(url: string): Promise<string | undefined> {
  if (!persistentContext) return undefined

  const cookies = await persistentContext.cookies(url).catch(() => [])
  if (cookies.length === 0) return undefined
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

async function getElementDownloadCandidate(
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

async function downloadUrlToDownloads(
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
  signal?: AbortSignal
): Promise<string> {
  const config = loadConfig()
  const isWindows = process.platform === 'win32'
  const shellToUse = config.terminalShell || (isWindows ? 'powershell.exe' : undefined)
  const fallbackApiKey = config.userGeminiKey || process.env.GEMINI_API_KEY
  const activeApiKey = apiKey || fallbackApiKey

  return runGuardedTerminalCommand(command, {
    shell: shellToUse,
    apiKey: activeApiKey,
    signal,
    cwd: activeCwd
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
  offset?: number,
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

    const actualOffset = offset !== undefined ? offset : 200
    const startIdx = startLine - 1
    const endIdx = Math.min(startLine + actualOffset - 1, totalLines - 1)

    const sliceOfLines = lines.slice(startIdx, endIdx + 1)
    const selectedContent = sliceOfLines.join('\n')

    if (selectedContent.length > 8000) {
      return `Content Locked: The requested range contains ${selectedContent.length} characters, which exceeds the limit of 8,000 characters. Please request a smaller offset to read less content.`
    }

    const numberedLines = sliceOfLines.map((line, index) => `${startLine + index} | ${line}`)
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

interface AppInfo {
  appName?: string
  DisplayName?: string
  appVersion?: string
  DisplayVersion?: string
  InstallLocation?: string
  path?: string
}

/**
 * Helper to recursively search a directory for the main executable (.exe).
 */
async function findMainExecutable(folderPath: string, depth: number = 0): Promise<string | null> {
  if (depth > 4) return null
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    const exeFiles: string[] = []
    const subDirs: string[] = []

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name)
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        const nameLower = entry.name.toLowerCase()
        if (
          !nameLower.includes('unins') &&
          !nameLower.includes('uninstall') &&
          !nameLower.includes('setup') &&
          !nameLower.includes('helper') &&
          !nameLower.includes('crash') &&
          !nameLower.includes('update') &&
          !nameLower.includes('elevate')
        ) {
          exeFiles.push(fullPath)
        }
      } else if (
        entry.isDirectory() &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.')
      ) {
        subDirs.push(fullPath)
      }
    }

    if (exeFiles.length > 0) {
      const folderNameLower = path.basename(folderPath).toLowerCase()
      const bestMatch = exeFiles.find((exe) => {
        const exeNameLower = path.basename(exe).toLowerCase()
        return (
          exeNameLower.includes(folderNameLower) ||
          folderNameLower.includes(exeNameLower.replace('.exe', ''))
        )
      })
      if (bestMatch) return bestMatch
      return exeFiles[0]
    }

    for (const subDir of subDirs) {
      const exe = await findMainExecutable(subDir, depth + 1)
      if (exe) return exe
    }
  } catch {
    // Ignore folder read errors
  }
  return null
}

/**
 * Helper to resolve a path (possibly shortcut or directory) to a literal executable path (.exe).
 */
async function getExecutablePath(appPath: string): Promise<string | null> {
  if (!appPath) return null
  try {
    const stats = await fs.stat(appPath)
    if (stats.isFile()) {
      if (appPath.toLowerCase().endsWith('.lnk')) {
        try {
          const shortcut = shell.readShortcutLink(appPath)
          if (shortcut && shortcut.target) {
            return await getExecutablePath(shortcut.target)
          }
        } catch {
          // ignore or fallback
        }
      }
      if (appPath.toLowerCase().endsWith('.exe')) {
        return appPath
      }
      return null
    } else if (stats.isDirectory()) {
      return await findMainExecutable(appPath)
    }
  } catch {
    if (appPath.toLowerCase().endsWith('.exe')) {
      return appPath
    }
  }
  return null
}

/**
 * Helper to resolve a registry or manual scan app into a valid executable path,
 * checking the display icon, install location, and applying heuristics for uninstallers/icons.
 */
async function resolveAppExecutable(
  displayIcon: string | null,
  installLocation: string | null
): Promise<string | null> {
  const isExe = (p: string): boolean => p.toLowerCase().endsWith('.exe')
  const isLnk = (p: string): boolean => p.toLowerCase().endsWith('.lnk')
  const isUninstaller = (p: string): boolean => {
    const low = p.toLowerCase()
    return low.includes('unins') || low.includes('uninstall') || low.includes('setup')
  }

  // Try 1: DisplayIcon direct resolution if it ends with .exe or .lnk
  if (displayIcon) {
    try {
      const cleanedIcon = cleanDisplayIcon(displayIcon)
      if (cleanedIcon) {
        if (isLnk(cleanedIcon) || isExe(cleanedIcon)) {
          const resolved = await getExecutablePath(cleanedIcon)
          if (resolved) {
            if (!isUninstaller(resolved)) {
              return resolved
            } else {
              // It's an uninstaller (e.g. Steam). Search parent folder for a main executable.
              const parentDir = path.dirname(resolved)
              const mainExe = await findMainExecutable(parentDir)
              if (mainExe) return mainExe
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Try 2: InstallLocation directory lookup
  if (installLocation) {
    try {
      const stats = await fs.stat(installLocation)
      if (stats.isDirectory()) {
        const mainExe = await findMainExecutable(installLocation)
        if (mainExe) return mainExe
      }
    } catch {
      // ignore
    }
  }

  // Try 3: Fallback directory lookup if DisplayIcon is a file but not a .exe (e.g., .ico)
  if (displayIcon) {
    try {
      const cleanedIcon = cleanDisplayIcon(displayIcon)
      if (cleanedIcon) {
        const stats = await fs.stat(cleanedIcon)
        if (stats.isFile()) {
          const parentDir = path.dirname(cleanedIcon)
          const parentLower = parentDir.toLowerCase()
          // Avoid scanning generic Steam games or Riot Games metadata folders
          if (
            !parentLower.includes('steam\\steam\\games') &&
            !parentLower.includes('riot games\\metadata')
          ) {
            const mainExe = await findMainExecutable(parentDir)
            if (mainExe) return mainExe
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null
}

interface RegistryAppInfo {
  DisplayName?: string
  DisplayVersion?: string
  InstallLocation?: string
  DisplayIcon?: string
}

function cleanDisplayIcon(iconPath: string): string | null {
  if (!iconPath) return null
  let cleaned = iconPath.trim()
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1)
  }
  const commaIndex = cleaned.lastIndexOf(',')
  if (commaIndex !== -1) {
    const suffix = cleaned.slice(commaIndex + 1).trim()
    if (/^-?\d+$/.test(suffix)) {
      cleaned = cleaned.slice(0, commaIndex).trim()
    }
  }
  return cleaned
}

async function queryRegistryInstalledApps(): Promise<RegistryAppInfo[]> {
  const isWindows = process.platform === 'win32'
  if (!isWindows) return []

  const command = `powershell -NoProfile -NonInteractive -Command "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion, InstallLocation, DisplayIcon | ConvertTo-Json -Compress"`

  return new Promise((resolve) => {
    // 10MB buffer to prevent overflow
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        console.error('PowerShell registry query error:', error)
        resolve([])
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        resolve(Array.isArray(parsed) ? parsed : [parsed])
      } catch (e) {
        console.error('Failed to parse PowerShell registry JSON:', e)
        resolve([])
      }
    })
  })
}

let cachedAppsList: ApplicationInfo[] | null = null
let lastScanTime = 0
let appsUpdatedCallback: ((apps: ApplicationInfo[]) => void) | null = null

export function registerAppsUpdatedCallback(cb: (apps: ApplicationInfo[]) => void): void {
  appsUpdatedCallback = cb
}

/**
 * Lists installed applications on the system, including manual scans of common Windows paths.
 * Resolves each application to its literal executable path.
 * Returns cached results immediately if available, triggering a background scan if the cache is older than 5 minutes.
 */
export async function listApplications(forceScan = false): Promise<string> {
  if (cachedAppsList && !forceScan) {
    console.log('listApplications: Returning cached list of applications')
    // If it's been more than 5 minutes since the last scan, trigger background refresh
    if (Date.now() - lastScanTime > 5 * 60 * 1000) {
      console.log('listApplications: Cache is older than 5 minutes, triggering background scan')
      setTimeout(() => {
        performScanAndCache().catch((err) =>
          console.error('Background applications scan failed:', err)
        )
      }, 0)
    }
    return JSON.stringify(cachedAppsList, null, 2)
  }
  return await performScanAndCache()
}

/**
 * Performs the actual system scan of applications and updates the cache.
 */
async function performScanAndCache(): Promise<string> {
  console.log('listApplications: Starting scanning and caching...')
  try {
    let rawApps: {
      name: string
      version?: string
      displayIcon: string | null
      installLocation: string | null
    }[] = []

    if (process.platform === 'win32') {
      console.log('listApplications: Platform is win32, querying registry...')
      const apps = await queryRegistryInstalledApps()
      console.log(`listApplications: Query registry returned ${apps.length} apps.`)
      rawApps = apps
        .filter((app) => app.DisplayName)
        .map((app) => ({
          name: app.DisplayName!,
          version: app.DisplayVersion,
          displayIcon: app.DisplayIcon || null,
          installLocation: app.InstallLocation || null
        }))
    } else {
      console.log('listApplications: Platform is non-win32, calling getInstalledApps...')
      const apps = (await getInstalledApps()) as AppInfo[]
      rawApps = apps.map((app) => ({
        name: app.appName || app.DisplayName || '',
        version: app.appVersion || app.DisplayVersion,
        displayIcon: null,
        installLocation: app.InstallLocation || app.path || null
      }))
    }

    console.log(`listApplications: Mapped ${rawApps.length} simplified apps.`)

    // Manual scan of common Windows paths to find apps not in registry
    const commonPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'),
      path.join(os.homedir(), 'AppData\\Local\\Programs'),
      path.join(
        process.env.ProgramData || 'C:\\ProgramData',
        'Microsoft\\Windows\\Start Menu\\Programs'
      ),
      path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
    ]

    const manualApps: typeof rawApps = []

    for (const dir of commonPaths) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            manualApps.push({
              name: entry.name,
              displayIcon: null,
              installLocation: entryPath
            })
          } else if (entry.name.endsWith('.lnk') || entry.name.endsWith('.exe')) {
            manualApps.push({
              name: entry.name.replace(/\.(lnk|exe)$/i, ''),
              displayIcon: entryPath,
              installLocation: null
            })
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    }

    console.log(`listApplications: Manual scan returned ${manualApps.length} apps.`)

    // Merge, resolve actual executable paths, and deduplicate (by name)
    const allApps = [...rawApps, ...manualApps]
    const seenNames = new Set()
    const finalApps: { name: string; version?: string; path: string }[] = []

    console.log(`listApplications: Resolving ${allApps.length} paths to executables...`)

    for (const app of allApps) {
      if (!app.name) continue
      const nameLower = app.name.toLowerCase()
      if (seenNames.has(nameLower)) continue

      const exePath = await resolveAppExecutable(app.displayIcon, app.installLocation)
      if (exePath) {
        seenNames.add(nameLower)
        finalApps.push({
          name: app.name,
          version: app.version,
          path: exePath
        })
      }
    }

    console.log(`listApplications: Successfully resolved ${finalApps.length} executables.`)
    finalApps.forEach((a) => console.log(`  RESOLVED APP: "${a.name}" -> "${a.path}"`))

    cachedAppsList = finalApps
    lastScanTime = Date.now()

    if (appsUpdatedCallback) {
      try {
        appsUpdatedCallback(finalApps)
      } catch (err) {
        console.error('Failed to trigger appsUpdatedCallback:', err)
      }
    }

    return JSON.stringify(finalApps, null, 2)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error listing applications: ${message}`
  }
}

/**
 * Opens an application given its path, resolving shortcuts/directories to their main executable first.
 */
export async function openApplication(appPath: string): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(appPath, 'appPath')
    const resolvedExePath = (await getExecutablePath(fullPath)) || fullPath
    const error = await shell.openPath(resolvedExePath)
    if (error) {
      return `Error opening application: ${error}`
    }
    return `Application opened successfully: ${resolvedExePath}`
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
async function launchBrowser(): Promise<Browser> {
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
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

function resetIdleTimer() {
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

async function getOrCreatePersistentPage(): Promise<Page> {
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

export async function openBrowser(url?: string): Promise<string> {
  try {
    const page = await getOrCreatePersistentPage()
    resetIdleTimer()
    if (url) {
      const targetUrl = normalizeHttpUrl(url, 'url')
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })
      await handleConsentBanners(page)
      return `Browser session opened and navigated to ${targetUrl} successfully. Current page title: "${await page.title()}"`
    }
    return 'Browser session opened successfully and is ready for automation. The browser will automatically close if idle for 5 minutes.'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error opening browser: ${message}`
  }
}

export async function browserNavigate(url: string): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    const targetUrl = normalizeHttpUrl(url, 'url')
    await persistentPage.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    await handleConsentBanners(persistentPage)
    return `Navigated to ${targetUrl} successfully. Current page title: "${await persistentPage.title()}"`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error navigating to ${url}: ${message}`
  }
}

export async function browserSnapshot(full?: string): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    const isFull = full === 'true'

    // Strip target="_blank" before capturing to force all links to open in the current tab
    await persistentPage
      .evaluate(() => {
        document.querySelectorAll('a[target="_blank"]').forEach((a) => a.removeAttribute('target'))
      })
      .catch(() => {})

    const dom = await persistentPage.evaluate((isFull) => {
      // 1. Tag interactive elements
      const interactiveElementsSelector =
        'a, button, input, textarea, select, details, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable="true"]'
      const interactiveEls = Array.from(document.querySelectorAll(interactiveElementsSelector))

      let nextId = 1
      interactiveEls.forEach((el) => {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          el.setAttribute('data-prism-id', String(nextId++))
        }
      })

      // Helper to check if element is visible
      const isVisible = (el: HTMLElement) => {
        if (!el.getBoundingClientRect) return false
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        )
      }

      // Helper to recursively build clean HTML
      const cleanNode = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
          const val = node.nodeValue?.trim()
          return val ? val : ''
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return ''
        }
        const el = node as HTMLElement
        if (!isVisible(el)) return ''

        const tagName = el.tagName.toLowerCase()
        if (
          ['script', 'style', 'iframe', 'noscript', 'svg', 'path', 'link', 'meta', 'head'].includes(
            tagName
          )
        ) {
          return ''
        }

        const prismId = el.getAttribute('data-prism-id')
        const idAttr = prismId ? ` data-prism-id="${prismId}"` : ''

        // Format based on tag
        if (['input', 'textarea', 'select'].includes(tagName)) {
          const idStr = el.id ? ` id="${el.id}"` : ''
          const nameStr = el.getAttribute('name') ? ` name="${el.getAttribute('name')}"` : ''
          const typeStr = el.getAttribute('type') ? ` type="${el.getAttribute('type')}"` : ''
          const placeholderStr = el.getAttribute('placeholder')
            ? ` placeholder="${el.getAttribute('placeholder')}"`
            : ''
          const valStr = (el as any).value ? ` value="${(el as any).value}"` : ''
          return `<${tagName}${idAttr}${idStr}${nameStr}${typeStr}${placeholderStr}${valStr}></${tagName}>\n`
        }

        if (tagName === 'button') {
          const idStr = el.id ? ` id="${el.id}"` : ''
          return `<button${idAttr}${idStr}>${el.innerText?.trim() || ''}</button>\n`
        }

        if (tagName === 'a') {
          const idStr = el.id ? ` id="${el.id}"` : ''
          const href = el.getAttribute('href') || ''
          return `<a${idAttr}${idStr} href="${href}">${el.innerText?.trim() || href}</a>\n`
        }

        if (tagName === 'img') {
          const src = el.getAttribute('src') || ''
          const alt = el.getAttribute('alt') || ''
          return `<img src="${src}" alt="${alt}">\n`
        }

        // If not full mode, we skip structural containers that have no direct text and no interactive children
        if (!isFull) {
          const text = el.innerText?.trim()
          const hasInteractiveChildren = el.querySelector('[data-prism-id]') !== null
          if (!text && !hasInteractiveChildren) {
            return ''
          }
        }

        // Check for headings, paragraphs, list items
        if (
          ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'summary'].includes(tagName)
        ) {
          let childContent = ''
          el.childNodes.forEach((child) => {
            childContent += cleanNode(child)
          })
          childContent = childContent.trim()
          return childContent ? `<${tagName}${idAttr}>${childContent}</${tagName}>\n` : ''
        }

        // Container elements
        let childrenContent = ''
        el.childNodes.forEach((child) => {
          childrenContent += cleanNode(child)
        })
        childrenContent = childrenContent.trim()
        if (childrenContent) {
          if (
            !isFull &&
            !prismId &&
            [
              'div',
              'span',
              'section',
              'article',
              'main',
              'header',
              'footer',
              'aside',
              'nav'
            ].includes(tagName)
          ) {
            return childrenContent + '\n'
          }
          return `<${tagName}${idAttr}>\n${childrenContent}\n</${tagName}>\n`
        }
        return ''
      }

      return cleanNode(document.body)
    }, isFull)

    const MAX_CONTENT = 30000
    const result = dom.replace(/\n\s*\n/g, '\n').trim()
    return result.length > MAX_CONTENT
      ? result.substring(0, MAX_CONTENT) + '\n... (truncated)'
      : result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error capturing page snapshot: ${message}`
  }
}

export async function browserClick(elementId: string): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    const locator = persistentPage.locator(`[data-prism-id="${elementId}"]`).first()
    const count = await locator.count()
    if (count === 0) {
      return `Error: Element with data-prism-id="${elementId}" not found on the page.`
    }

    const directDownloadCandidate = await getElementDownloadCandidate(locator)
    let directDownloadError: string | undefined

    if (directDownloadCandidate) {
      try {
        const targetPath = await downloadUrlToDownloads(directDownloadCandidate.url, {
          filename: directDownloadCandidate.filename,
          referer: persistentPage.url(),
          cookieHeader: await getCookieHeaderForUrl(directDownloadCandidate.url)
        })
        return `Clicked element with data-prism-id="${elementId}" successfully. The element points to a downloadable file and it was automatically saved to your Downloads folder: ${targetPath}`
      } catch (err) {
        directDownloadError = err instanceof Error ? err.message : String(err)
        console.warn(
          `browserClick: Direct download failed for element "${elementId}", falling back to browser click...`,
          err
        )
      }
    }

    // Set up download listener in parallel (5 seconds timeout) on context level to catch all tabs/pages
    const downloadPromise = persistentContext
      ? persistentContext.waitForEvent('download', { timeout: 5000 }).catch(() => null)
      : Promise.resolve(null)

    // Try standard click, then fallback to force click, and finally direct DOM click
    try {
      await locator.click({ timeout: 5000 })
    } catch (clickErr) {
      console.warn(
        `browserClick: Standard click failed for element "${elementId}", trying force click...`,
        clickErr
      )
      try {
        await locator.click({ force: true, timeout: 5000 })
      } catch (forceErr) {
        console.warn(
          `browserClick: Force click failed for element "${elementId}", executing direct DOM click...`,
          forceErr
        )
        await locator.evaluate((el: HTMLElement) => el.click())
      }
    }

    const download = await downloadPromise
    if (download) {
      const targetPath = await savePlaywrightDownload(download)
      return `Clicked element with data-prism-id="${elementId}" successfully. A file download was detected and automatically saved to your Downloads folder: ${targetPath}`
    }

    if (directDownloadError) {
      return `Clicked element with data-prism-id="${elementId}" successfully, but the linked file could not be automatically saved: ${directDownloadError}`
    }

    return `Clicked element with data-prism-id="${elementId}" successfully.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error clicking element "${elementId}": ${message}`
  }
}

export async function browserType(elementId: string, text: string): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    const locator = persistentPage.locator(`[data-prism-id="${elementId}"]`).first()
    const count = await locator.count()
    if (count === 0) {
      return `Error: Element with data-prism-id="${elementId}" not found on the page.`
    }
    await locator.fill(text)
    return `Typed text into element with data-prism-id="${elementId}" successfully.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error typing into element "${elementId}": ${message}`
  }
}

export async function browserPress(key: string): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    await persistentPage.keyboard.press(key)
    return `Pressed keyboard key "${key}" successfully.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error pressing key "${key}": ${message}`
  }
}

export async function browserScroll(direction: 'up' | 'down', amount?: string): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    await persistentPage.evaluate(
      (args) => {
        const scrollAmount = args.amount ? Number(args.amount) : window.innerHeight * 0.8
        window.scrollBy(0, args.direction === 'down' ? scrollAmount : -scrollAmount)
      },
      { direction, amount }
    )
    return `Scrolled page ${direction} successfully.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error scrolling page: ${message}`
  }
}

export async function browserBack(): Promise<string> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return 'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
    }
    resetIdleTimer()
    await persistentPage.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 })
    return 'Navigated back in browser history successfully.'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error navigating back: ${message}`
  }
}

export async function browserScreenshot(): Promise<{ result: string; base64?: string }> {
  try {
    if (!persistentPage || persistentPage.isClosed()) {
      return {
        result:
          'Error: No active browser session. You must call "open_browser" first to initialize the browser session before using this tool.'
      }
    }
    resetIdleTimer()
    const buffer = await persistentPage.screenshot({ type: 'png' })
    const base64 = buffer.toString('base64')
    return {
      result: 'Screenshot captured successfully and attached to context.',
      base64
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { result: `Error capturing browser screenshot: ${message}` }
  }
}

export async function closePersistentBrowser(): Promise<string> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (persistentBrowser) {
    try {
      await persistentBrowser.close()
    } catch (err) {
      console.warn('Error closing persistent browser:', err)
    } finally {
      persistentBrowser = null
      persistentContext = null
      persistentPage = null
      downloadCdpSession = null
      downloadCdpBrowser = null
    }
    return 'Browser session closed successfully.'
  }
  return 'No active browser session to close.'
}

export async function webScript(url: string, script: string): Promise<string> {
  try {
    const page = await getOrCreatePersistentPage()
    resetIdleTimer()
    if (url) {
      const targetUrl = normalizeHttpUrl(url, 'url')
      if (page.url() !== targetUrl) {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        })
        await handleConsentBanners(page)
      }
    }
    const result = await page.evaluate((code) => {
      try {
        return eval(code)
      } catch (e) {
        const fn = new Function(code)
        return fn()
      }
    }, script)
    return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error executing web script: ${message}`
  }
}

export async function detailedDomPage(url?: string): Promise<string> {
  try {
    const page = await getOrCreatePersistentPage()
    resetIdleTimer()
    if (url) {
      const targetUrl = normalizeHttpUrl(url, 'url')
      if (page.url() !== targetUrl) {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        })
        await handleConsentBanners(page)
      }
    }

    const dom = await page.evaluate(() => {
      // 1. Tag interactive elements
      const interactiveElementsSelector =
        'a, button, input, textarea, select, details, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable="true"]'
      const interactiveEls = Array.from(document.querySelectorAll(interactiveElementsSelector))

      let nextId = 1
      interactiveEls.forEach((el) => {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          el.setAttribute('data-prism-id', String(nextId++))
        }
      })

      const isVisible = (el: HTMLElement) => {
        if (!el.getBoundingClientRect) return false
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        )
      }

      // Detailed serialization
      const serializeNode = (node: Node, depth: number = 0): string => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue?.trim()
          return text ? `${'  '.repeat(depth)}[TEXT] ${text}\n` : ''
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return ''
        }
        const el = node as HTMLElement
        if (!isVisible(el)) return ''

        const tagName = el.tagName.toLowerCase()
        if (
          ['script', 'style', 'iframe', 'noscript', 'svg', 'path', 'link', 'meta', 'head'].includes(
            tagName
          )
        ) {
          return ''
        }

        // Collect attributes
        const attrs: string[] = []
        if (el.id) attrs.push(`id="${el.id}"`)
        if (el.className) attrs.push(`class="${el.className}"`)
        const prismId = el.getAttribute('data-prism-id')
        if (prismId) attrs.push(`data-prism-id="${prismId}"`)

        // Add specific attributes
        const attributesToCollect = [
          'href',
          'src',
          'alt',
          'placeholder',
          'type',
          'name',
          'value',
          'title',
          'role'
        ]
        for (const attr of attributesToCollect) {
          const val = el.getAttribute(attr)
          if (val) attrs.push(`${attr}="${val}"`)
        }

        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
        const indent = '  '.repeat(depth)

        // Leaf interactive elements
        if (['input', 'img'].includes(tagName)) {
          return `${indent}<${tagName}${attrStr} />\n`
        }

        let childContent = ''
        el.childNodes.forEach((child) => {
          childContent += serializeNode(child, depth + 1)
        })

        if (childContent) {
          return `${indent}<${tagName}${attrStr}>\n${childContent}${indent}</${tagName}>\n`
        } else {
          return `${indent}<${tagName}${attrStr}>${el.innerText?.trim() || ''}</${tagName}>\n`
        }
      }

      return serializeNode(document.body)
    })

    const MAX_CONTENT = 40000
    const result = dom.replace(/\n\s*\n/g, '\n').trim()
    return result.length > MAX_CONTENT
      ? result.substring(0, MAX_CONTENT) + '\n... (truncated)'
      : result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error getting detailed DOM: ${message}`
  }
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
  const modelNames: Record<string, string> = {
    'prism-4': 'Prism 4',
    'prism-4.1': 'Prism 4.1',
    'prism-4.2': 'Prism 4.2',
    'prism-4.3': 'Prism 4.3',
    'prism-5': 'Prism 5',
    'prism-6-super-fast': 'Prism 6 Super-Fast',
    'prism-6-fast-old': 'Prism 6 Fast-Old',
    'prism-6-fast': 'Prism 6 Fast',
    'prism-6-dragon': 'Prism 6 Dragon',
    'prism-6-dense': 'Prism 6 Dense'
  }
  const modelName = modelNames[modelKey] || 'Prism 6 Super-Fast'

  const toolsPrompt = toolsManifest
    .filter((t) => {
      if (allowedTools && allowedTools.length > 0) {
        if (!allowedTools.includes(t.name)) {
          return false
        }
      }
      if (target === 'launcher') {
        return (
          t.name === 'web_search' ||
          t.name === 'saw_link_from_url' ||
          t.name === 'open_main_app' ||
          t.name === 'open_browser_link' ||
          t.name === 'open_application'
        )
      }
      return !t.target || t.target === 'both' || t.target === target
    })
    .map((t) => {
      const p = Object.entries(t.parameters)
        .map(([k, d]) => `${k}:${d}`)
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
Role: Prism Mini-Chat (${modelName}), running in the Quick Launcher.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd} | Terminal: ${terminalSummary}

# Rules
- **Simple Markdown Only:** Respond ONLY using traditional simple Markdown (no HTML/CSS, no Rich Markdown).
- **Auto-Open:** If an app, link, or file path is sent in isolation, IMMEDIATELY open it via open_browser_link or open_application.
- **Transitions:** For complex tasks (terminal/files/subagents/Rich Markdown), immediately call open_main_app with instructions.
- Models: prism-6-super-fast (default/latency), prism-6-fast-old (simple automation), prism-6-fast (code/swarm), prism-6-dragon (research), prism-6-dense (math/debugging).

Tools:
${toolsPrompt}`
  }

  if (sessionMode === 'conversation' && target === 'main') {
    return `# Identity & Context
Role: ${name} (${modelName}), running in Conversation Mode.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd}

# Rules
- **Conversation Mode**: You are running in Conversation Mode. You do NOT have access to any tools (like files, terminal, or browser). You must NOT attempt to output any <tool_call> tags. Simply reply to the user using text/Markdown.
- Match user's language. Be direct, factual, and concise.
- Simple Markdown: Use standard Markdown for all replies.`
  }

  const parallelRule =
    target === 'main'
      ? '- Parallelism: Run multiple <tool_call> blocks concurrently to speed up tasks. Use <run_subagents> for complex tasks.'
      : '- Collaboration: Use send_group_message and wait_for_updates for Group Chat sync. You can output multiple tool calls in parallel.'
  const humanUserRule =
    target === 'subagent'
      ? '- Human user messages: Any group message from Master Coordinator is from the Prism user. Respond via send_group_message.'
      : ''

  const disciplineRule = sessionMode === 'discipline' && disciplinePath
    ? `\n- **Discipline Mode**: You are operating in Discipline Mode. All operations and commands run directly in: ${disciplinePath}. Perform modifications relative to this path.`
    : ''

  return `# Identity & Context
Role: ${name} (${modelName}), a concise, tool-capable desktop assistant.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd} | Terminal: ${terminalSummary}

# Visual & Interaction Protocol
Define clear boundaries to maximize UX and performance:
1. **Simple Markdown (95% of replies):** Use for conversational answers, summaries, code, and explanations. NEVER wrap standard text in HTML/CSS cards/containers.
2. **Rich Markdown (HTML/CSS):** Use ONLY when user explicitly requests cards, dashboards, grids, or visual layouts (e.g. "create a profile card"). Use modern styling (gradients, shadow, blur). Example:
   \`\`\`html
   <div style="background: linear-gradient(135deg, #1e3c72, #2a5298); padding: 15px; border-radius: 12px; color: white; font-family: system-ui, sans-serif;">
     <h4>Breno Alexandre</h4>
     <p>Creator of the Prism ecosystem.</p>
   </div>
   \`\`\`
3. **Mini Apps:** Use <mini_app> tags ONLY for stateful, interactive widgets (e.g. calculators, forms, games). Do not use for static content.
   Structure: <mini_app><title>Name</title><html>...</html><css>...</css><js>...</js></mini_app>

**Decision Matrix:**
- Conversational reply/analysis/info -> **Simple Markdown**
- Card/visual dashboard/formatted layout request -> **Rich Markdown (HTML/CSS)**
- Interactive widget/form/game -> **Mini App (<mini_app>)**

# Operating Rules
- Match user's language. Be direct, factual, and concise; prefer action over commentary.${disciplineRule}
- **Auto-Open:** If an app, link, or file path is sent in isolation, IMMEDIATELY open it via open_browser_link, open_application, or relevant tool.
- Preserve file indentation (spaces/tabs) exactly when editing.
- Do not expose thoughts/reasoning; provide conclusions and evidence.
- Never invent tool results, paths, or citations.

# Themes (via configure_prism)
- marine (default blue/slate), vertez (orange-red/charcoal), akoustik (purple/violet), terno (monochrome black/white), ursula (green/reading-focused).

# Search Protocols
1. **Active Search (Standard):** For serious topics, search using web_search and read page contents using saw_link_from_url. Do not rely solely on snippets.
2. **Deep Research (When enabled):**
   - Step 1: Search initially for context.
   - Step 2: Present a Research Plan and explicitly ask user if they approve. Stop generation immediately.
   - Step 3 (Only after approval): Run at least 10 search/read iterations.
   - Step 4: Output a dense, structured Markdown report.
3. **Continuous Web Search (web_search shape):** When a question benefits from exploring more than one angle (errors, updates, compatibility, alternatives, etc.), batch them into a SINGLE web_search call using the "searches" array:
   <tool_call>{"type":"web_search","searches":[{"title":"Finding common errors with X","query":"X not working windows"},{"title":"Searching on how to update X","query":"how to update X"}]}</tool_call>
   - Each entry has a "title" (human-friendly label, shown verbatim to the user) and a "query" (the raw keywords actually sent to Google).
   - The "title" is what the user sees. Write it as a concise action phrase ('Finding...', 'Searching...', 'Looking for...', 'Checking...'). NEVER expose raw boolean/quoted query syntax (OR, quotes, site:) in the title.
   - Use 1 entry for focused lookups, multiple entries for multi-angle research. One entry is perfectly valid when that is all that is needed.

# Tool Protocol & Execution
- **Format:** Tool calls must be valid JSON in a <tool_call> XML block: <tool_call>{"type": "tool_name", "param": "val"}</tool_call>.
- **Requirements:** JSON must contain "type". Escape newlines (\\n) and quotes in JSON. Absolute paths are required.
- **Terminal CLI:** Commands run in the user's selected host terminal \`${shellName}\`; use ${shellSyntax} syntax. Prism blocks dangerous system commands before execution.
- **Filesystem Safety:** \`computer_use_*\` file tools modify real files only at explicit paths and refuse filesystem roots or protected system paths.
- **Persistent Browser:** For browser_* actions (except browser_close) and web_script, call open_browser first and browser_close when done. web_search, saw_link_from_url, and open_browser_link need no persistent session.
${parallelRule}
${humanUserRule}

# Prism Internal Knowledge
For ANY questions or queries about the Prism application itself (including its features, themes, keyboard shortcuts, internal architecture, creator info, or troubleshooting), you MUST use the \`internal_docs_list\` and \`internal_docs_read\` tools to fetch the relevant documentation. DO NOT hallucinate facts about Prism. Use the docs.

# Dynamic Surveys (to_ask)
Use to_ask for structured user preferences/feedback. Blocks execution until submitted.
Schema:
{
  "session_id": "UUID",
  "questions": [
    {
      "id": "q1",
      "type": "multiple-choice | essay",
      "title": "Category",
      "prompt": "Question text",
      "options": [{"value": "val", "label": "Label", "allow_custom_input": false}],
      "placeholder": "Text"
    }
  ]
}

Tools:
${toolsPrompt}`
}

/**
 * Returns a specialized system prompt for the Master Coordinator Agent.
 */
export function getMasterAgentSystemPrompt(modelKey: string, totalSubagents: number): string {
  const basePrompt = getSystemToolsPrompt(modelKey, 'subagent')
  return `${basePrompt}

[IDENTITY]: Master Coordinator.
[ROLE]: You are the supreme coordinator of the bot swarm. Your role is NOT to execute files or terminal tasks directly, but to direct, analyze, and synthesize the work of the ${totalSubagents} worker subagents.

[MANDATORY SWARM PROTOCOL]:
1. REAL-TIME ASSESSMENT: Read group chat messages to track worker progress.
2. COLLABORATION & INSTRUCTIONS: Direct workers by broadcasting goals and asking for specific outputs. You MUST use 'send_group_message' with status="working" to post updates, instructions, and feedback.
3. ASYNC SLEEP: If you are waiting for subagents to complete or respond, you MUST call 'wait_for_updates' in the same response to sleep and let workers run. Do not poll.
4. SWARM TERMINATION: You DO NOT terminate the swarm or grant exit clearance. The worker subagents manage their own exits individually by asking and granting permission among themselves (peer exit permission). You only assist in coordinating, guiding, and summarizing. The swarm will terminate automatically once all worker subagents have exited.
5. MANDATORY COMMUNICATION: At EVERY iteration, you must communicate. Do not perform private work without updating the team.
`
}

/**
 * Returns a specialized system prompt for sub-agents.
 */
export function getSubagentSystemPrompt(modelKey: string, index: number, total: number): string {
  const basePrompt = getSystemToolsPrompt(modelKey, 'subagent')
  const otherAgents = Array.from({ length: total }, (_, i) => i).filter((i) => i !== index)

  return `${basePrompt}

[IDENTITY]: Agent #${index}.
[TEAM]: Master Coordinator, ${otherAgents.length > 0 ? otherAgents.map((i) => `Agent #${i}`).join(', ') : 'Solo'}.

[GROUP CHAT RULES]:
1. ASYNC COLLABORATION: Use 'send_group_message' as your shared working memory. Every message must be useful: state what you are doing, what you found, what is blocked, what changed, or what exact decision you need.
2. STAYING ALIVE: You are ONLY active as long as you use tools. If you need to see a reply, a decision, a teammate result, a human message, or any future group-chat update, you MUST send a 'send_group_message' with status="working" and call 'wait_for_updates' in the SAME response. Never end a response while waiting.
3. MANDATORY COMMUNICATION: Communication is ABSOLUTELY MANDATORY. Before running any computer or search tools, report your short plan to the group chat. After each meaningful tool result, report the relevant outcome, evidence, and next step. Do not do silent work.
4. CLOSED-LOOP SYNC: New messages from others appear as [UNREAD MESSAGES]. Acknowledge relevant unread messages by sender, incorporate them into your next action, and correct course immediately when the Master Coordinator gives new direction.
5. WAITING DISCIPLINE: Use 'wait_for_updates' to listen instead of polling or idle thinking. If you ask a question, request review, need permission, depend on another agent, or are unsure whether to continue, pair that request with 'wait_for_updates'.
6. PEER EXIT PERMISSION: You DO NOT need to ask the Master Coordinator for permission to leave. Instead, you must ask the OTHER WORKER SUBAGENTS for permission to exit when you believe your assigned task is complete (e.g. "I have finished my task X, do you need anything else from me or can I exit?"). While waiting for their reply, keep your status as "working" and call wait_for_updates. If other active subagents need your help or ask you to stay, you must remain active. You may only exit if all other active worker subagents give you explicit permission to exit (e.g., "Yes, you can exit").
7. INDIVIDUAL TERMINATION: When permitted by your peers, you can exit individually by sending a final update with status="done" or status="error" containing your final result, evidence, changed files, and remaining risks. Once you exit, you are no longer active, and other remaining agents will continue working (potentially building on your output). The entire swarm completes automatically only when all worker subagents have exited.
8. PEER REVIEW & GRANTED EXIT: You must actively monitor if other agents are asking for permission to exit. Review their progress, decide if you need their help or output, and reply in the group chat either granting permission (e.g. "Yes, you can exit") or asking them to wait/help.
9. NO SUBAGENTS: You cannot spawn more agents. Focus on your assigned task.

[OUTPUT]: Your thoughts are private. Your FINAL RESPONSE should be a concise mission report for the Main Agent, and it must only appear after the peer exit permission protocol above is satisfied.`
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
