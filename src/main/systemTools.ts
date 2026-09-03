import { exec, execFile } from 'child_process'
import {
  shell,
  desktopCapturer,
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type NativeImage
} from 'electron'

import * as fs from 'fs/promises'
import * as fssync from 'fs'
import * as path from 'path'
import * as os from 'os'
import PptxGenJS from 'pptxgenjs'
import {
  toolsManifest,
  getToolDefinition,
  COMPUTER_READ_FILE_DEFAULT_LIMIT,
  COMPUTER_READ_FILE_MAX_CHARACTERS
} from './toolsManifest'
import {
  BrowserAction,
  DownloadProgress,
  SessionMode,
  TodoState,
  ArtifactItem,
  ProviderConfig
} from '../shared/types'

import { loadConfig, saveConfig, SlashWorkflow } from './config'
import { compilePersona } from '../shared/persona'
import { executeMemoryTool, getActiveMemoryService } from './memoryStore'
import { MEMORY_PROFILE_HEADER, buildMemoryContextBlock } from '../shared/memoryCore'
import { searchAndReadWeb, fetchAndSummarizeWeb } from './webSearchService'
import { requestDiscordVoiceLeave } from './discordGateway'
import {
  searchChatHistory,
  searchChatMemory,
  loadChatSession,
  getChatArtifacts,
  saveChatArtifact,
  saveChatTodo
} from './history'
import {
  getSkillsSystemPromptSnippetSync,
  getDisabledSkillsPromptSnippetSync,
  readSkill
} from './skillsManager'
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
import {
  readTerminalOutput,
  sendTerminalInput,
  killTerminalProcess
} from './terminalProcessManager'
import { isExtractableDocument, extractDocumentText } from './documentExtractor'
import { safeSend } from './safeSend'
import { SystemToolOutput, ToolImageAttachment } from './toolAttachments'
import { asImageGenerationArguments, generateImage } from './ai/imageGeneration'

function getDownloadsFolder(): string {
  try {
    return app.getPath('downloads')
  } catch (err) {
    return path.join(os.homedir(), 'Downloads')
  }
}

function getDocsPath(): string {
  const candidatePaths = [
    path.join(process.resourcesPath, 'docs'),
    path.join(process.resourcesPath, 'resources', 'docs'),
    path.join(app.getAppPath(), 'resources', 'docs'),
    path.join(__dirname, '../../resources/docs'),
    path.join(process.cwd(), 'resources', 'docs')
  ]

  for (const candidate of candidatePaths) {
    if (fssync.existsSync(candidate)) {
      return candidate
    }
  }

  return !app.isPackaged
    ? path.join(__dirname, '../../resources/docs')
    : path.join(process.resourcesPath, 'docs')
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

// Max concurrent download-complete listeners to prevent unbounded array growth
const MAX_DOWNLOAD_LISTENERS = 50
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
    safeSend(win, 'download-progress', progress)
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

export function setupSessionDownloadHandler(targetSession: Electron.Session): void {
  targetSession.on('will-download', (_event, item) => {
    const downloadsFolder = getDownloadsFolder()
    const filename = normalizeDownloadFilename(item.getFilename())
    const targetPath = path.join(downloadsFolder, filename)
    const id = resolveDownloadProgressId(
      item.getURL(),
      filename,
      createDownloadId('electron-download')
    )
    const totalBytes = item.getTotalBytes()

    item.setSavePath(targetPath)

    updateTrackedDownload(id, {
      filename,
      url: item.getURL(),
      targetPath,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: totalBytes > 0 ? totalBytes : undefined,
      status: 'downloading'
    })

    item.on('updated', (_event, state) => {
      if (state === 'interrupted') {
        updateTrackedDownload(id, {
          filename,
          url: item.getURL(),
          targetPath,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: totalBytes > 0 ? totalBytes : undefined,
          status: 'failed',
          error: 'Download interrupted'
        })
      } else if (state === 'progressing') {
        updateTrackedDownload(id, {
          filename,
          url: item.getURL(),
          targetPath,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: totalBytes > 0 ? totalBytes : undefined,
          status: 'downloading'
        })
      }
    })

    item.once('done', (_event, state) => {
      if (state === 'completed') {
        updateTrackedDownload(id, {
          filename,
          url: item.getURL(),
          targetPath,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: totalBytes > 0 ? totalBytes : undefined,
          percent: 100,
          status: 'completed'
        })
      } else {
        updateTrackedDownload(id, {
          filename,
          url: item.getURL(),
          targetPath,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: totalBytes > 0 ? totalBytes : undefined,
          status: 'failed',
          error: `Download ${state}`
        })
      }
    })
  })
}

export async function waitForDownloadCompletion(
  timeoutMs = 4000
): Promise<DownloadCompletionResult | null> {
  const existingResult = getCompletedDownload()
  if (existingResult) return existingResult

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      downloadCompleteListeners = downloadCompleteListeners.filter((fn) => fn !== onComplete)
      resolve(getCompletedDownload())
    }, timeoutMs)

    const onComplete = (id: string, result: DownloadCompletionResult): void => {
      // Auto-remove from listeners array to prevent stale closure accumulation
      downloadCompleteListeners = downloadCompleteListeners.filter((fn) => fn !== onComplete)
      clearTimeout(timer)
      consumedDownloadResults.add(id)
      resolve(result)
    }

    // Guard against runaway growth — evict oldest listener if at capacity
    if (downloadCompleteListeners.length >= MAX_DOWNLOAD_LISTENERS) {
      console.warn(
        `[Download] Listener cap (${MAX_DOWNLOAD_LISTENERS}) reached, evicting oldest listener`
      )
      downloadCompleteListeners.shift()
    }
    downloadCompleteListeners.push(onComplete)
  })
}

export async function waitForDownloadOrActionResult(
  actionPromise: Promise<string>,
  maxDownloadTimeoutMs = 120000
): Promise<string> {
  const startTime = Date.now() - 2500
  const actionResult = await actionPromise

  const findActiveDownload = () => {
    for (const progress of trackedDownloads.values()) {
      if (consumedDownloadResults.has(progress.id)) continue
      if (progress.startedAt >= startTime) {
        return progress
      }
    }
    return null
  }

  let activeDownload = findActiveDownload()
  if (!activeDownload) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 250))
      activeDownload = findActiveDownload()
      if (activeDownload) break
    }
  }

  if (!activeDownload) {
    return actionResult
  }

  const downloadResult = await waitForDownloadCompletion(maxDownloadTimeoutMs)
  if (downloadResult) {
    return downloadResult.success
      ? `SUCCESS: Download saved to ${downloadResult.filePath}`
      : `FAILED: Download error - ${downloadResult.error}`
  }

  return actionResult
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

function parseToolBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  if (typeof value === 'boolean') return value
  return typeof value === 'string' && /^(true|1|yes|y|sim)$/i.test(value.trim())
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
  overwrite: boolean | undefined,
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
  overwrite: boolean | undefined,
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
    let content = ''
    let documentHeader = ''

    if (isExtractableDocument(fullPath)) {
      const extracted = await extractDocumentText(fullPath)
      content = extracted.text
      documentHeader = ` [${extracted.type.toUpperCase()} | Total ${extracted.unitLabel}: ${extracted.totalUnits}]`
    } else {
      content = await fs.readFile(fullPath, { encoding: 'utf8', signal })
    }

    const lines = content.split('\n')
    const totalLines = lines.length

    if (startLine > totalLines) {
      return `Error reading file: startLine (${startLine}) exceeds the total number of lines in the file (${totalLines}).`
    }

    const actualLimit = limit !== undefined ? limit : COMPUTER_READ_FILE_DEFAULT_LIMIT
    const startIdx = startLine - 1
    const endIdx = Math.min(startLine + actualLimit - 1, totalLines - 1)

    const sliceOfLines = lines.slice(startIdx, endIdx + 1)
    const selectedContent = sliceOfLines.join('\n')

    if (selectedContent.length > COMPUTER_READ_FILE_MAX_CHARACTERS) {
      return `Content Locked: The requested range contains ${selectedContent.length} characters, which exceeds the limit of ${COMPUTER_READ_FILE_MAX_CHARACTERS.toLocaleString('en-US')} characters. Please request a smaller limit to read less content.`
    }

    const numberedLines = sliceOfLines.map((line, index) => `${startLine + index}: ${line}`)
    const body = numberedLines.join('\n')

    const showingStart = startLine
    const showingEnd = endIdx + 1

    const header = `File: ${fullPath}${documentHeader}\nTotal lines: ${totalLines}\nShowing lines: ${showingStart} to ${showingEnd}\n\n`
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
  startLine: number,
  endLine: number,
  newContent: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertSafeFileMutationPath(fullPath, 'path')

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
async function emitBrowserAction(
  actionData: Omit<BrowserAction, 'timestamp' | 'screenshot'>
): Promise<void> {
  if (!_browserActionEmitter) return
  try {
    let screenshot: string | undefined
    if (persistentPage && !persistentPage.isClosed()) {
      let buf = await persistentPage
        .screenshot({ type: 'jpeg', quality: 70, timeout: 3000 })
        .catch(() => null)
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
      console.log('Browser persistent session idle for 105 minutes, closing automatically...')
      await closePersistentBrowser()
    },
    105 * 60 * 1000
  ) // 105 minutes
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

let browserCommandQueue = Promise.resolve<any>(undefined)

/**
 * Serializes all browser commands through a lightweight Promise chain mutex
 * to guarantee no concurrent command collisions or race conditions.
 */
export async function queueBrowserCommand<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => fn()
  const next = browserCommandQueue.then(run, run)
  browserCommandQueue = next.catch(() => {})
  return next
}

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
      | 'ping'
    url?: string
    elementId?: string
    text?: string
    key?: string
    direction?: 'up' | 'down'
    amount?: number
    script?: string
    full?: boolean
  },
  signal?: AbortSignal
): Promise<any> {
  const wins = BrowserWindow.getAllWindows()
  const targetWin = wins.find((w) => !w.webContents.getURL().includes('#launcher')) || wins[0]
  if (!targetWin) {
    return 'Error: No active Prism window available to execute browser command.'
  }

  const requestId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  return new Promise((resolve, reject) => {
    let retryTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (retryTimer) clearTimeout(retryTimer)
      clearTimeout(timeout)
      if (signal) signal.removeEventListener('abort', onAbort)
      activeBrowserCmdResolvers.delete(requestId)
    }

    const onAbort = () => {
      cleanup()
      reject(new Error('AbortError'))
    }

    if (signal) {
      if (signal.aborted) return reject(new Error('AbortError'))
      signal.addEventListener('abort', onAbort)
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve(`Error: Browser action "${command.type}" timed out.`)
    }, 25000)

    activeBrowserCmdResolvers.set(requestId, (result) => {
      cleanup()
      resolve(result)
    })

    // Single follow-up retry after 1200ms in case webview was still mounting during initial dispatch
    retryTimer = setTimeout(() => {
      if (activeBrowserCmdResolvers.has(requestId)) {
        const currentWins = BrowserWindow.getAllWindows()
        const win =
          currentWins.find((w) => !w.webContents.getURL().includes('#launcher')) || currentWins[0]
        if (win) {
          safeSend(win, 'browser-exec-command', { requestId, command })
        }
      }
    }, 1200)

    safeSend(targetWin, 'browser-exec-command', { requestId, command })
  })
}

/**
 * Actively checks the health and readiness of the browser session.
 * Automatically attaches to an existing browser tab if open, or auto-initializes
 * a fresh session if closed or unmounted.
 */
export async function ensureBrowserSessionActive(
  signal?: AbortSignal,
  preferredUrl?: string
): Promise<void> {
  if (signal?.aborted) throw new Error('AbortError')

  // Check if browser session is already live and responsive in the renderer
  if (isPersistentBrowserActive) {
    try {
      const pingResult = await sendBrowserCommandToRenderer({ type: 'ping' }, signal)
      if (typeof pingResult === 'object' && pingResult?.isReady) {
        return
      }
    } catch {}
  }

  // Session was not active or webview was unmounted - auto-open / auto-attach seamlessly
  isPersistentBrowserActive = true
  emitBrowserAction({ type: 'open', url: preferredUrl }).catch(() => {})
  await sendBrowserCommandToRenderer({ type: 'open', url: preferredUrl }, signal).catch(() => {})
}

export async function openBrowser(url?: string, signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    // Actively probe renderer to see if a session is already alive
    let isAlreadyAlive = false
    try {
      const pingResult = await sendBrowserCommandToRenderer({ type: 'ping' }, signal)
      if (typeof pingResult === 'object' && pingResult?.isReady) {
        isAlreadyAlive = true
      }
    } catch {}

    isPersistentBrowserActive = true

    if (isAlreadyAlive) {
      if (url) {
        emitBrowserAction({ type: 'navigate', url }).catch(() => {})
        await sendBrowserCommandToRenderer({ type: 'navigate', url }, signal)
        return `Browser session attached and active. Navigated to: ${url}. Page is ready for inspection via browser_snapshot.`
      }
      return 'Browser session attached and active. Page is ready for inspection via browser_snapshot.'
    }

    emitBrowserAction({ type: 'open', url }).catch(() => {})
    const result = await sendBrowserCommandToRenderer({ type: 'open', url }, signal)
    return typeof result === 'string'
      ? result
      : 'Browser session opened successfully. Use browser_snapshot to inspect page content.'
  })
}

export async function browserNavigate(url: string, signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal, url)
    emitBrowserAction({ type: 'navigate', url }).catch(() => {})
    return waitForDownloadOrActionResult(
      sendBrowserCommandToRenderer({ type: 'navigate', url }, signal)
    )
  })
}

export async function browserSnapshot(full?: boolean, signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    const result = await sendBrowserCommandToRenderer(
      { type: 'snapshot', full: full === true },
      signal
    )
    return typeof result === 'string' ? result : JSON.stringify(result)
  })
}

export async function browserClick(elementId: string, signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    return waitForDownloadOrActionResult(
      sendBrowserCommandToRenderer({ type: 'click', elementId }, signal)
    )
  })
}

export async function browserType(
  elementId: string,
  text: string,
  signal?: AbortSignal
): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    return waitForDownloadOrActionResult(
      sendBrowserCommandToRenderer({ type: 'type', elementId, text }, signal)
    )
  })
}

export async function browserPress(key: string, signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    const result = await sendBrowserCommandToRenderer({ type: 'press', key }, signal)
    return typeof result === 'string' ? result : `Pressed key "${key}" successfully.`
  })
}

export async function browserScroll(
  direction: 'up' | 'down',
  amount?: number,
  signal?: AbortSignal
): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    const result = await sendBrowserCommandToRenderer({ type: 'scroll', direction, amount }, signal)
    return typeof result === 'string' ? result : `Scrolled page ${direction} successfully.`
  })
}

export async function browserBack(signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    const result = await sendBrowserCommandToRenderer({ type: 'back' }, signal)
    return typeof result === 'string' ? result : 'Navigated back in browser history successfully.'
  })
}

export async function browserScreenshot(
  signal?: AbortSignal
): Promise<{ result: string; attachment?: ToolImageAttachment }> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal)
    const res = await sendBrowserCommandToRenderer({ type: 'screenshot' }, signal)
    if (typeof res === 'object' && typeof res?.base64 === 'string' && res.base64) {
      return {
        result: 'Screenshot captured successfully and attached to context.',
        attachment: {
          kind: 'image',
          mimeType: res.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
          data: res.base64,
          ...(typeof res.width === 'number' && res.width > 0 ? { width: res.width } : {}),
          ...(typeof res.height === 'number' && res.height > 0 ? { height: res.height } : {}),
          ...(typeof res.byteLength === 'number' && res.byteLength > 0
            ? { byteLength: res.byteLength }
            : {})
        }
      }
    }
    return { result: typeof res === 'string' ? res : 'Screenshot captured successfully.' }
  })
}

export async function closePersistentBrowser(): Promise<string> {
  return queueBrowserCommand(async () => {
    isPersistentBrowserActive = false
    await sendBrowserCommandToRenderer({ type: 'close' }).catch(() => {})
    _browserActionEmitter?.({ type: 'close', timestamp: Date.now() })
    return 'Browser session closed successfully.'
  })
}

export async function webScript(
  url: string,
  script: string,
  signal?: AbortSignal
): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal, url)
    return waitForDownloadOrActionResult(
      sendBrowserCommandToRenderer({ type: 'script', url, script }, signal)
    )
  })
}

export async function detailedDomPage(url?: string, signal?: AbortSignal): Promise<string> {
  return queueBrowserCommand(async () => {
    await ensureBrowserSessionActive(signal, url)
    const result = await sendBrowserCommandToRenderer({ type: 'snapshot', url, full: true }, signal)
    return typeof result === 'string' ? result : JSON.stringify(result)
  })
}

const ARCADIA_MODEL_NAMES: Record<string, string> = {
  'prism-ai/arcadia-1.0-mini': 'Arcadia-1.0 Mini',
  'prism-ai/arcadia-1.0-flash': 'Arcadia-1.0 Flash',
  'prism-ai/arcadia-1.0-pro': 'Arcadia-1.0 Pro',
  'prism-ai/arcadia-1.1-flash': 'Arcadia-1.1 Flash',
  'arcadia-1.0-mini': 'Arcadia-1.0 Mini',
  'arcadia-1.0-flash': 'Arcadia-1.0 Flash',
  'arcadia-1.0-pro': 'Arcadia-1.0 Pro',
  'arcadia-1.1-flash': 'Arcadia-1.1 Flash'
}

/**
 * Returns the system prompt configured with the correct model identity.
 */
export function isInternalDocDisabled(filename: string, disabledSkills: string[]): boolean {
  const lower = filename.toLowerCase()
  if (
    disabledSkills.includes('pdf') &&
    disabledSkills.includes('pptx') &&
    lower.includes('14_pdf_and_pptx')
  ) {
    return true
  }
  if (
    disabledSkills.includes('browser') &&
    lower.includes('integrated_browser')
  ) {
    return true
  }
  return false
}

export function filterDisabledDocContent(
  filename: string,
  content: string,
  disabledSkills: string[]
): string {
  let filtered = content
  const lower = filename.toLowerCase()
  if (disabledSkills.includes('pdf') && lower.includes('14_pdf_and_pptx')) {
    filtered = filtered.replace(
      /###?\s*3\.1\s*`write_pdf`[\s\S]*?(?=###?\s*3\.3|$)/i,
      '### 3.1 `write_pdf`\n*(PDF skill disabled for this conversation)*\n\n'
    )
    filtered = filtered.replace(
      /###?\s*4\.1\s*Infraestrutura de PDF[\s\S]*?(?=###?\s*4\.2|$)/i,
      '### 4.1 Infraestrutura de PDF\n*(PDF skill disabled for this conversation)*\n\n'
    )
    filtered = filtered.replace(
      /subgraph Geração de PDF[\s\S]*?end/i,
      'subgraph Geração de PDF\n        D1[PDF Skill Desabilitada]\n    end'
    )
  }
  if (disabledSkills.includes('pptx') && lower.includes('14_pdf_and_pptx')) {
    filtered = filtered.replace(
      /###?\s*3\.3\s*`write_pptx`[\s\S]*?(?=##\s*4|$)/i,
      '### 3.3 `write_pptx`\n*(PowerPoint skill disabled for this conversation)*\n\n'
    )
    filtered = filtered.replace(
      /###?\s*4\.2\s*Infraestrutura de PPTX[\s\S]*?(?=##\s*5|$)/i,
      '### 4.2 Infraestrutura de PPTX\n*(PowerPoint skill disabled for this conversation)*\n\n'
    )
    filtered = filtered.replace(
      /subgraph Geração de PPTX[\s\S]*?end/i,
      'subgraph Geração de PPTX\n        E1[PowerPoint Skill Desabilitada]\n    end'
    )
  }
  if (disabledSkills.includes('browser') && lower.includes('09_file_and_browser')) {
    filtered = filtered.replace(
      /##\s*2\.\s*Playwright Web Browser Tools[\s\S]*$/i,
      '## 2. Playwright Web Browser Tools\n*(Browser Use skill disabled for this conversation)*\n'
    )
  }
  return filtered
}

export function getSystemToolsPrompt(
  modelKey: string,
  target: 'main' | 'subagent' | 'both' | 'launcher' = 'main',
  _allowedTools?: string[],
  sessionMode: SessionMode = 'execution',
  disciplinePath?: string,
  modelDisplayName?: string,
  isPrismCloud?: boolean,
  disabledSkills?: string[]
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
  const inlineSuggestionsRule =
    '- Inline suggestions: when useful, use `<prism-suggestion send="full user message">visible optional follow-up</prism-suggestion>`; multiple allowed, never required.'

  const cleanModelId = modelKey
    ? modelKey.startsWith('prism_provider:')
      ? modelKey.replace('prism_provider:', '')
      : modelKey
    : 'unknown'

  const isCloud =
    isPrismCloud ??
    (cleanModelId.startsWith('prism-ai/') ||
      cleanModelId.startsWith('arcadia-') ||
      Boolean(ARCADIA_MODEL_NAMES[cleanModelId]))

  const resolvedArcadiaName =
    modelDisplayName ||
    ARCADIA_MODEL_NAMES[cleanModelId] ||
    (cleanModelId.includes('1.0-mini')
      ? 'Arcadia-1.0 Mini'
      : cleanModelId.includes('1.0-pro')
        ? 'Arcadia-1.0 Pro'
        : cleanModelId.includes('1.1-flash')
          ? 'Arcadia-1.1 Flash'
          : cleanModelId.includes('1.0-flash') || cleanModelId.includes('arcadia')
            ? 'Arcadia-1.0 Flash'
            : '')

  const modelIdentity =
    isCloud && resolvedArcadiaName ? `${cleanModelId} (${resolvedArcadiaName})` : cleanModelId

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

  let effectiveDisabledSkills = disabledSkills
  if (effectiveDisabledSkills === undefined) {
    try {
      const config = loadConfig()
      effectiveDisabledSkills = config.disabledSkills || []
    } catch {
      effectiveDisabledSkills = []
    }
  }

  // Personality profile (M1): chat, launcher and conversation surfaces only.
  // Harness and subagent prompts stay neutral — persona never touches them.
  const personaSection = (() => {
    if (target === 'subagent' || target === 'both' || sessionMode === 'harness') return ''
    try {
      const text = compilePersona(loadConfig().persona)
      return text ? `\n\n${text}` : ''
    } catch (err) {
      console.error('Failed to load persona prompt:', err)
      return ''
    }
  })()

  // Pinned core memories (M2): the always-on profile block (USER.md analog).
  // Same surface guard as persona; skipped when the store is not up yet.
  const coreMemorySection = (() => {
    if (target === 'subagent' || target === 'both' || sessionMode === 'harness') return ''
    try {
      const service = getActiveMemoryService()
      if (!service) return ''
      const block = buildMemoryContextBlock(service.list(), {
        pinnedOnly: true,
        maxChars: 600,
        maxEntries: 8,
        header: MEMORY_PROFILE_HEADER
      })
      return block ? `\n\n${block}` : ''
    } catch (err) {
      console.error('Failed to load pinned memory prompt:', err)
      return ''
    }
  })()

  // AI memory guidance (Hermes-style): the model actively curates long-term
  // memory through the memory tool. Same surface guard as persona; never Harness.
  const memoryGuidanceSection = (() => {
    if (target === 'subagent' || target === 'both' || sessionMode === 'harness') return ''
    return `# Long-Term Memory
You maintain Prism's long-term memory with the memory tool \u2014 proactively, in the same turn, without waiting to be asked.
- Save stable preferences, corrections, and durable facts about the user (name, age, job, location, family, projects, communication style) with target "user".
- Save general notes, conventions and project facts with target "memory".
- Correct stale facts with replace (old_text = short unique substring); remove facts that are no longer true; update instead of duplicating.
- Keep entries compact. Never save secrets, credentials, or guesses as facts. The user's current message always wins over stored memory.`
  })()

  if (target === 'launcher') {
    return `# Identity & Context
Role: Prism AI in Quick Launcher.
Model: ${modelIdentity}
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd} | Terminal: ${terminalSummary}

# Rules
- Use simple Markdown. Absolute paths for file tools; commands run in \`${shellName}\` (${shellSyntax}); shared single browser session.
- **Auto-Open:** App/link/path sent alone → open via open_browser_link or open_application.
- **Transitions:** Complex/long tasks → open_main_app.
- Natively invoke tools in parallel when applicable.${personaSection}${coreMemorySection}${memoryGuidanceSection}`
  }

  if (sessionMode === 'conversation' && target === 'main') {
    return `# Identity & Context
Role: ${name} in Conversation Mode.
Model: ${modelIdentity}
Context: ${date} | ${platform} | Home: ${homeDir} | CWD: ${cwd}

# Rules
- No tool access. Reply with text/Markdown.
- Match user language. Be direct, factual, concise.
${inlineSuggestionsRule}${personaSection}${coreMemorySection}${memoryGuidanceSection}`
  }

  const disciplineRule =
    sessionMode === 'discipline' && disciplinePath
      ? `\n- **Discipline Mode**: Operations/commands run in ${disciplinePath}. Modify relative to this path.`
      : ''

  const skillsSnippet = getSkillsSystemPromptSnippetSync(effectiveDisabledSkills)
  const skillsSection = skillsSnippet ? `\n\n${skillsSnippet}` : ''

  const disabledSkillsSnippet = getDisabledSkillsPromptSnippetSync(effectiveDisabledSkills)
  const disabledSkillsSection = disabledSkillsSnippet ? `\n\n${disabledSkillsSnippet}` : ''

  const isBrowserDisabled = effectiveDisabledSkills.includes('browser')

  const browserRule = isBrowserDisabled
    ? '- **Links:** Open URLs in the OS browser via `open_browser_link` by default.'
    : '- **Links:** Open URLs via `open_browser_link` by default; use integrated AI browser tools only on explicit in-app request (requires `read_skill` with `integrated_browser_skill.md`).'

  return `# Identity & Context
Role: ${name}, Desktop AI Assistant.
Model: ${modelIdentity}
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd} | Terminal: ${terminalSummary}

# Rules & Protocols
- Match user language. Be direct, factual, and concise.${disciplineRule}
${browserRule}
- **Formatting:** Markdown for text/code; inline HTML/CSS (render directly, unwrapped) for rich visual cards/designs; \`create_mini_app\` for interactive widgets/games.
- **Execution:** Absolute paths required for file operations. Commands run in \`${shellName}\` (${shellSyntax}). Parallel native tool calls allowed.
- **Search:** \`web_search\` for standard queries with \`resultCount\` 1–10 (2–4 typical; 5–8 only for specific cases). Use \`web_fetch\` for deep research / deep search / in-depth thorough investigation or any topic requiring exhaustive, comprehensive web investigation across up to 50 source pages synthesized by a dedicated subagent: provide 1) \`title\` — descriptive, formulated strictly in the user's conversational language; 2) \`queries\` — exactly 5 distinct Google-style queries exploring variants of the topic, in whichever language yields the best global results (e.g. English for tech/global topics); each query retrieves 10 pages (5 x 10 = up to 50 total Sources), with up to 15,000 characters per Source sent to the subagent.
- **Prism Docs:** internal_docs_list / internal_docs_read / internal_docs_search for Prism system questions.
- **YouTube Assistant:** For YouTube video searches, search via \`web_search\` with query \`site:youtube.com <SEARCH_QUERY>\`. Enclose the result in a styled HTML card (\`<div style="border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:18px 20px;background:rgba(255,255,255,0.03);margin:12px 0;">\`) containing 🎬 title, customized description, up to 3 clickable HTML <a> buttons (primary bold red #ff0000, alternatives dark charcoal #272727), and the suggestion chip below the card: \`<prism-suggestion send="Open the YouTube video that you've found for me.">Open the video</prism-suggestion>\`.
- **Surveys (to_ask):** Schema: {"session_id":"UUID","questions":[{"id":"q1","type":"multiple-choice|essay","title":"Category","prompt":"Prompt","options":[{"value":"v","label":"L"}]}]}
${inlineSuggestionsRule}${skillsSection}${disabledSkillsSection}${personaSection}${coreMemorySection}${memoryGuidanceSection}`
}

export interface InstalledApplicationResult {
  name: string
  path: string
}

export async function searchInstalledApplications(
  query: string
): Promise<InstalledApplicationResult[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const roots: string[] = []
  const extensions = new Set<string>()
  if (process.platform === 'win32') {
    if (process.env.ProgramData) {
      roots.push(
        path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      )
    }
    if (process.env.APPDATA) {
      roots.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    }
    extensions.add('.lnk')
    extensions.add('.exe')
  } else if (process.platform === 'darwin') {
    roots.push('/Applications', path.join(os.homedir(), 'Applications'))
    extensions.add('.app')
  } else {
    roots.push(
      '/usr/share/applications',
      path.join(os.homedir(), '.local', 'share', 'applications')
    )
    extensions.add('.desktop')
  }

  const results: InstalledApplicationResult[] = []
  const seen = new Set<string>()
  let scanned = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8 || results.length >= 30 || scanned >= 10000) return
    let entries: fssync.Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= 30 || scanned >= 10000) return
      const fullPath = path.join(directory, entry.name)
      const extension = path.extname(entry.name).toLowerCase()
      if (entry.isDirectory() && !extensions.has(extension)) {
        await walk(fullPath, depth + 1)
        continue
      }
      scanned++
      if (!extensions.has(extension)) continue
      const displayName = path.basename(entry.name, extension)
      if (!displayName.toLowerCase().includes(normalizedQuery)) continue
      const normalizedPath = path.normalize(fullPath)
      if (seen.has(normalizedPath.toLowerCase())) continue
      seen.add(normalizedPath.toLowerCase())
      results.push({ name: displayName, path: normalizedPath })
    }
  }

  for (const root of roots) await walk(root, 0)
  return results.sort((left, right) => left.name.localeCompare(right.name))
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

const SCREENSHOT_CAPTURE_TIMEOUT_MS = 5_000
const SCREENSHOT_MAX_EDGE = 1_440
const SCREENSHOT_JPEG_QUALITY = 80

export interface ScreenshotCapture {
  result: string
  attachment?: ToolImageAttachment
}

function resizeScreenshotForVision(image: NativeImage): NativeImage {
  const { width, height } = image.getSize()
  if (Math.max(width, height) <= SCREENSHOT_MAX_EDGE) return image

  return width >= height
    ? image.resize({ width: SCREENSHOT_MAX_EDGE, quality: 'best' })
    : image.resize({ height: SCREENSHOT_MAX_EDGE, quality: 'best' })
}

function screenshotCaptureFailure(
  message: string,
  startedAt: number,
  details: Record<string, unknown> = {}
): ScreenshotCapture {
  console.warn('[Screenshot] Capture failed.', {
    message,
    durationMs: Date.now() - startedAt,
    ...details
  })
  return { result: `Error: ${message}` }
}

/**
 * Captures the primary desktop source as a size-bounded JPEG for model vision.
 */
export async function captureAppScreenshot(): Promise<ScreenshotCapture> {
  const startedAt = Date.now()
  try {
    const sourcesPromise = desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: SCREENSHOT_MAX_EDGE, height: SCREENSHOT_MAX_EDGE }
    })
    let timeout: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>(
      (_, reject) =>
        (timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Screenshot capture timed out after ${SCREENSHOT_CAPTURE_TIMEOUT_MS / 1000} seconds`
              )
            ),
          SCREENSHOT_CAPTURE_TIMEOUT_MS
        ))
    )
    const sources = await Promise.race([sourcesPromise, timeoutPromise]).finally(() => {
      if (timeout) clearTimeout(timeout)
    })

    const primaryDisplayId = String(screen.getPrimaryDisplay().id)
    const targetSource =
      sources.find((source) => source.name === 'Entire Screen') ||
      sources.find((source) => source.display_id === primaryDisplayId) ||
      sources.find((source) => source.id.startsWith('screen:')) ||
      sources[0]

    if (!targetSource) {
      return screenshotCaptureFailure('No screens available to capture.', startedAt, {
        sourceCount: sources.length
      })
    }

    if (targetSource.thumbnail.isEmpty()) {
      return screenshotCaptureFailure(
        'The selected screen source returned an empty image.',
        startedAt,
        {
          sourceId: targetSource.id,
          displayId: targetSource.display_id || undefined
        }
      )
    }

    const image = resizeScreenshotForVision(targetSource.thumbnail)
    const { width, height } = image.getSize()
    if (width <= 0 || height <= 0) {
      return screenshotCaptureFailure(
        'The selected screen source has invalid dimensions.',
        startedAt,
        {
          sourceId: targetSource.id,
          width,
          height
        }
      )
    }

    const buffer = image.toJPEG(SCREENSHOT_JPEG_QUALITY)
    if (buffer.length === 0) {
      return screenshotCaptureFailure('Screen image encoding returned no data.', startedAt, {
        sourceId: targetSource.id,
        width,
        height
      })
    }

    const attachment: ToolImageAttachment = {
      kind: 'image',
      mimeType: 'image/jpeg',
      data: buffer.toString('base64'),
      width,
      height,
      byteLength: buffer.length
    }
    console.info('[Screenshot] Capture completed.', {
      sourceId: targetSource.id,
      displayId: targetSource.display_id || undefined,
      sourceCount: sources.length,
      width,
      height,
      byteLength: attachment.byteLength,
      durationMs: Date.now() - startedAt
    })
    return {
      result: 'Screenshot of entire screen captured successfully.',
      attachment
    }
  } catch (error) {
    return screenshotCaptureFailure(
      `Capturing screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
      startedAt
    )
  }
}

// ── Todo System ──────────────────────────────────────────────────────────────
export const sessionTodos = new Map<string, TodoState>()

export function getTodoForChat(chatId: string): TodoState | null {
  if (sessionTodos.has(chatId)) {
    return sessionTodos.get(chatId) || null
  }
  if (!chatId) return null
  const session = loadChatSession(chatId)
  if (session && session.todo) {
    sessionTodos.set(chatId, session.todo)
    return session.todo
  }
  return null
}

let _currentSessionIdForTodo = ''
export function setCurrentSessionIdForTodo(id: string): void {
  if (id) {
    _currentSessionIdForTodo = id
  }
}

export function buildTodoReminder(chatId?: string): string {
  const targetId = chatId || _currentSessionIdForTodo
  const todo = getTodoForChat(targetId)
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
  chatId?: string,
  disabledSkills?: string[],
  provider?: ProviderConfig,
  modelId?: string
): Promise<SystemToolOutput> {
  if (chatId) {
    _currentSessionIdForTodo = chatId
  }
  let disabled: string[] = []
  try {
    const config = loadConfig()
    disabled = disabledSkills ?? (config.disabledSkills || [])
  } catch {
    disabled = disabledSkills || []
  }
  if (disabled.includes('pptx') && ['write_pptx', 'edit_pptx'].includes(toolName)) {
    return `Error: PowerPoint (PPTX) skill is currently disabled for this conversation.`
  }
  if (disabled.includes('pdf') && ['write_pdf', 'edit_pdf'].includes(toolName)) {
    return `Error: PDF Document skill is currently disabled for this conversation.`
  }
  if (
    disabled.includes('browser') &&
    [
      'open_browser',
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_press',
      'browser_scroll',
      'browser_back',
      'web_script',
      'detailed_dom_page'
    ].includes(toolName)
  ) {
    return `Error: Browser Use skill is currently disabled for this conversation.`
  }
  switch (toolName) {
    case 'generate_image':
      return generateImage(asImageGenerationArguments(args), signal, chatId)

    // Terminal
    case 'execute_terminal_command':
      return await runTerminalCommand(args.command || '', apiKey, signal, event, chatId)
    case 'read_terminal_output':
      return readTerminalOutput(args.runId || '', chatId)
    case 'send_terminal_input':
      return await sendTerminalInput(
        args.runId || '',
        {
          input: args.input,
          keys: Array.isArray(args.keys) ? args.keys : undefined,
          pressEnter: args.pressEnter !== false
        },
        chatId
      )
    case 'kill_terminal_process':
      return killTerminalProcess(args.runId || '', chatId)

    // Discord Tools
    case 'discord_leave_voice':
      if (requestDiscordVoiceLeave()) {
        return 'The request to leave the Discord voice channel was accepted. Remain in the call and say a brief, personalized goodbye based on the conversation. Do not call any more tools.'
      }
      return 'Was not connected to any Discord voice channel.'

    // File operations
    case 'computer_use_create_file': {
      const targetPath = (args.path || '').toString().toLowerCase()
      if (disabled.includes('pdf') && targetPath.endsWith('.pdf')) {
        return 'Error: Creating PDF files is prohibited because the PDF Skill is disabled for this conversation.'
      }
      if (disabled.includes('pptx') && (targetPath.endsWith('.pptx') || targetPath.endsWith('.ppt'))) {
        return 'Error: Creating PowerPoint presentation files is prohibited because the PowerPoint Skill is disabled for this conversation.'
      }
      return await computerCreateFile(args.path, args.content, signal)
    }
    case 'computer_use_create_directory':
      return await computerCreateDirectory(args.path || '', signal)
    case 'computer_use_remove_file':
      return await computerRemoveFile(args.path, signal)
    case 'computer_use_remove_directory':
      return await computerRemoveDirectory(args.path || '', signal)
    case 'computer_use_save_file': {
      const targetPath = (args.path || '').toString().toLowerCase()
      if (disabled.includes('pdf') && targetPath.endsWith('.pdf')) {
        return 'Error: Saving PDF files is prohibited because the PDF Skill is disabled for this conversation.'
      }
      if (disabled.includes('pptx') && (targetPath.endsWith('.pptx') || targetPath.endsWith('.ppt'))) {
        return 'Error: Saving PowerPoint presentation files is prohibited because the PowerPoint Skill is disabled for this conversation.'
      }
      return await computerSaveFile(args.path, args.content, signal)
    }
    case 'computer_use_append_file':
      return await computerAppendToFile(args.path, args.content, signal)
    case 'computer_use_read_file': {
      const startLine = args.startLine !== undefined ? Number(args.startLine) : 1
      const limit = args.limit !== undefined ? Number(args.limit) : COMPUTER_READ_FILE_DEFAULT_LIMIT
      return await computerReadFile(
        args.path,
        isNaN(startLine) ? 1 : startLine,
        isNaN(limit) ? COMPUTER_READ_FILE_DEFAULT_LIMIT : limit,
        signal
      )
    }
    case 'computer_use_edit_file':
      return await computerEditFile(
        args.path,
        args.startLine,
        args.endLine,
        args.newContent,
        signal
      )
    case 'computer_use_copy_file':
      return await computerCopyFile(
        args.sourcePath || '',
        args.destinationPath || '',
        args.overwrite,
        signal
      )
    case 'computer_use_move_file':
      return await computerMoveFile(
        args.sourcePath || '',
        args.destinationPath || '',
        args.overwrite,
        signal
      )
    case 'computer_use_get_file_info':
      return await computerGetFileInfo(args.path, signal)
    case 'computer_use_list_directory':
      return await computerListDirectory(args.path || '.', signal)

    // Applications & links
    case 'open_application':
      return await openApplication(args.appPath)
    case 'open_browser_link':
      return await openBrowserLink(args.url || '')
    case 'open_main_app': {
      try {
        const instructions = args.instructions || ''
        const model = args.model || ''
        const searchEnabled = args.searchEnabled === true

        const wins = BrowserWindow.getAllWindows()
        const mainWin =
          wins.find(
            (w) =>
              !w.webContents.getURL().includes('#launcher') &&
              !w.webContents.getURL().includes('#subagents') &&
              !w.webContents.getURL().includes('#mini-app')
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

        safeSend(mainWin, 'open-main-app-with-instructions', {
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
      const applications = await searchInstalledApplications(args.query)
      return applications.length > 0
        ? applications.map((application) => `${application.name} (${application.path})`).join('\n')
        : 'No matching installed applications found.'
    }

    // Web search & research
    case 'web_search': {
      let query = ''
      if (typeof args.query === 'string') {
        query = args.query.trim()
      } else if (Array.isArray(args.searches) && typeof args.searches[0]?.query === 'string') {
        query = args.searches[0].query.trim()
      }
      if (!query) throw new Error('A search query is required.')
      const resultCount = Number(args.resultCount)
      if (!Number.isInteger(resultCount) || resultCount < 1 || resultCount > 10) {
        throw new Error('resultCount must be an integer between 1 and 10.')
      }
      const result = await searchAndReadWeb(
        query,
        { maxContextCharacters: 15_000 * resultCount, webPageCount: resultCount },
        signal
      )
      return JSON.stringify(result)
    }
    case 'web_fetch': {
      const title =
        typeof args.title === 'string' && args.title.trim()
          ? args.title.trim()
          : typeof args.query === 'string' && args.query.trim()
            ? args.query.trim()
            : 'Deep Research'

      let queries: string[] = []
      if (Array.isArray(args.queries) && args.queries.length > 0) {
        queries = args.queries
          .map((q) => (typeof q === 'string' ? q.trim() : ''))
          .filter(Boolean)
      } else if (typeof args.query === 'string' && args.query.trim()) {
        queries = [args.query.trim()]
      }

      if (queries.length === 0) {
        throw new Error('At least one search query or topic is required for web_fetch.')
      }

      const result = await fetchAndSummarizeWeb(
        { title, queries },
        {
          provider,
          modelId,
          signal
        }
      )
      return JSON.stringify(result)
    }

    // Persistent browser
    case 'open_browser':
      return await openBrowser(args.url, signal)
    case 'browser_navigate':
      return await browserNavigate(args.url || '', signal)

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
      const screenRes = await browserScreenshot(signal)
      if (screenRes.attachment) {
        return {
          output: screenRes.result,
          attachments: [screenRes.attachment]
        }
      }
      return screenRes.result
    }
    // Web scripting & DOM
    case 'web_script':
      return await webScript(args.url || '', args.script || '', signal)
    case 'detailed_dom_page':
      return await detailedDomPage(args.url, signal)

    // Screenshot
    case 'computer_use_see_screen': {
      const screenResult = await captureAppScreenshot()
      if (screenResult.attachment) {
        return {
          output: screenResult.result,
          attachments: [screenResult.attachment]
        }
      }
      return screenResult.result
    }

    // Todo system
    case 'create_todo': {
      let taskTitles: string[] = args.tasks

      if (taskTitles.length < 1) {
        return 'Error: create_todo requires at least 1 task. Please define a list of steps.'
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
      if (todoChatId) {
        saveChatTodo(todoChatId, todo)
      }

      try {
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) {
          if (
            !win.webContents.getURL().includes('#launcher') &&
            !win.webContents.getURL().includes('#subagents')
          ) {
            safeSend(win, 'chat-todo-update', todo)
          }
        }
      } catch {}

      return `Todo list created with ${taskTitles.length} tasks. ${buildTodoReminder(todoChatId)}`
    }

    case 'edit_todo': {
      const todoChatId = chatId || _currentSessionIdForTodo
      let todo = getTodoForChat(todoChatId)
      if (!todo || !todo.active) {
        return 'Error: No active todo list. Create one first with create_todo.'
      }

      const rawId = args.id.toString().trim()
      const rawStatus = args.status.toString().trim().toLowerCase()

      let newStatus: 'working' | 'done' = 'working'
      if (['done', 'completed', 'finished', 'complete'].includes(rawStatus)) {
        newStatus = 'done'
      } else if (['working', 'in_progress', 'in-progress', 'wip', 'active'].includes(rawStatus)) {
        newStatus = 'working'
      } else if (['pending', 'todo', 'reset'].includes(rawStatus)) {
        // Fallback for status
        newStatus = 'working'
      }

      if (!rawId) return 'Error: Task ID or title is required (e.g. "task-0", "task-1").'

      let taskIndex = todo.tasks.findIndex((t) => t.id.toLowerCase() === rawId.toLowerCase())

      if (taskIndex === -1) {
        // Try matching number index, e.g. "0" -> task-0, "1" -> task-0 or task-1
        if (/^\d+$/.test(rawId)) {
          const num = parseInt(rawId, 10)
          if (num >= 0 && num < todo.tasks.length) {
            taskIndex = num
          } else if (num >= 1 && num <= todo.tasks.length) {
            taskIndex = num - 1
          }
        }
      }

      if (taskIndex === -1) {
        // Try matching task-X format if passed like "task 0" or "task_0"
        const taskMatch = rawId.match(/^task[_\s-]?(\d+)$/i)
        if (taskMatch) {
          const num = parseInt(taskMatch[1], 10)
          if (num >= 0 && num < todo.tasks.length) {
            taskIndex = num
          }
        }
      }

      if (taskIndex === -1) {
        // Try matching by title (exact or substring)
        const lowerRaw = rawId.toLowerCase()
        taskIndex = todo.tasks.findIndex(
          (t) =>
            t.title.toLowerCase().includes(lowerRaw) || lowerRaw.includes(t.title.toLowerCase())
        )
      }

      if (taskIndex === -1) {
        return `Error: Task "${rawId}" not found. Available tasks: ${todo.tasks.map((t) => `${t.id} (${t.title})`).join(', ')}`
      }

      if (todo.tasks[taskIndex].status === 'done' && newStatus === 'done') {
        return `Task "${rawId}" (${todo.tasks[taskIndex].title}) is already marked as done.`
      }

      todo.tasks[taskIndex] = {
        ...todo.tasks[taskIndex],
        status: newStatus
      }

      const allDone = todo.tasks.every((t) => t.status === 'done')
      if (allDone) {
        todo.active = false
      }

      sessionTodos.set(todoChatId, todo)
      if (todoChatId) {
        saveChatTodo(todoChatId, todo)
      }

      try {
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) {
          if (
            !win.webContents.getURL().includes('#launcher') &&
            !win.webContents.getURL().includes('#subagents')
          ) {
            safeSend(win, 'chat-todo-update', todo)
          }
        }
        if (allDone) {
          for (const win of wins) {
            if (!win.webContents.getURL().includes('#launcher')) {
              safeSend(win, 'chat-todo-complete', { chatId: todoChatId })
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
    case 'memory':
      return executeMemoryTool(args, chatId)
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
        if (args.generativeBrowserModel !== undefined && args.generativeBrowserModel !== '') {
          config.generativeBrowserModel = args.generativeBrowserModel
          changed.push(`generativeBrowserModel: "${args.generativeBrowserModel}"`)
        }
        if (args.imageGenerationModel !== undefined && args.imageGenerationModel !== '') {
          config.imageGenerationModel = args.imageGenerationModel
          changed.push(`imageGenerationModel: "${args.imageGenerationModel}"`)
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
        const docsPath = getDocsPath()

        try {
          const files = await fs.readdir(docsPath)
          const mdFiles = files
            .filter((f) => f.endsWith('.md'))
            .filter((f) => !isInternalDocDisabled(f, disabled))
            .sort()
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
        const docsPath = getDocsPath()

        const filename = args.filename
        if (!filename || !filename.endsWith('.md')) {
          return 'Error: Invalid filename. Must be a .md file from the internal_docs_list.'
        }

        const baseFilename = path.basename(filename)
        if (isInternalDocDisabled(baseFilename, disabled)) {
          return `Error: Documentation file "${filename}" is unavailable because the corresponding skill is disabled for this conversation.`
        }

        const filePath = path.join(docsPath, baseFilename)
        try {
          let content = await fs.readFile(filePath, 'utf-8')
          content = filterDisabledDocContent(baseFilename, content, disabled)
          return content
        } catch (e: any) {
          if (e.code === 'ENOENT') return `Error: Documentation file "${filename}" not found.`
          throw e
        }
      } catch (error) {
        return `Error reading doc: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    // Skills
    case 'read_skill': {
      try {
        const skillName = (args.skill_name || '').toString().trim()
        if (!skillName) {
          return 'Error: skill_name parameter is required.'
        }
        const result = await readSkill(skillName, chatId, disabled)
        if (!result.success) {
          return result.content
        }

        let unlockedToolsMsg = ''
        if (result.unlockedTools.length > 0) {
          const definitions = result.unlockedTools
            .map((tName) => {
              const def = getToolDefinition(tName)
              if (!def) return null
              return {
                type: 'function',
                function: {
                  name: def.name,
                  description: def.description,
                  parameters: def.inputSchema
                }
              }
            })
            .filter(Boolean)

          unlockedToolsMsg = `\n\n[System Note: The following native execution tool definitions have been UNLOCKED for this conversation:\n\`\`\`json\n${JSON.stringify(definitions, null, 2)}\n\`\`\`\n]`
        }
        return `${result.content}${unlockedToolsMsg}`
      } catch (err) {
        return `Error reading skill: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    case 'internal_docs_search': {
      try {
        const docsPath = getDocsPath()
        const query = (args.query || '').toString().trim()
        if (!query) {
          return 'Error: Search query is required for internal_docs_search.'
        }

        const files = await fs.readdir(docsPath)
        const mdFiles = files
          .filter((f) => f.endsWith('.md'))
          .filter((f) => !isInternalDocDisabled(f, disabled))
          .sort()
        if (mdFiles.length === 0) return 'No internal documentation files found to search.'

        const matches: { filename: string; lineNumber: number; content: string }[] = []
        const queryLower = query.toLowerCase()

        for (const file of mdFiles) {
          const filePath = path.join(docsPath, file)
          try {
            let content = await fs.readFile(filePath, 'utf-8')
            content = filterDisabledDocContent(file, content, disabled)
            const lines = content.split('\n')
            lines.forEach((line, idx) => {
              if (line.toLowerCase().includes(queryLower)) {
                matches.push({
                  filename: file,
                  lineNumber: idx + 1,
                  content: line.trim()
                })
              }
            })
          } catch {
            // ignore unreadable files
          }
        }

        if (matches.length === 0) {
          return `No documentation snippets found matching query "${query}".`
        }

        const formatted = matches
          .slice(0, 30)
          .map((m) => `[${m.filename}:${m.lineNumber}] ${m.content}`)
          .join('\n')

        return `Found ${matches.length} matching documentation snippet(s) for "${query}":\n${formatted}`
      } catch (error) {
        return `Error searching docs: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    // Questionnaire
    case 'to_ask':
      return requestQuestionnaire(args, signal)

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

        const toolConstraints: string[] = args.toolConstraints || []

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

    case 'write_pdf': {
      try {
        const html = (args.html || '').toString().trim()
        if (!html) {
          return 'Error: HTML+CSS content is required to generate a PDF.'
        }
        let filename = (args.filename || 'document.pdf').toString().trim()
        filename = path.basename(filename)
        if (!filename.toLowerCase().endsWith('.pdf')) {
          filename += '.pdf'
        }

        const targetChatId = chatId || _currentSessionIdForTodo || 'default'
        const artifactsBaseDir = path.join(app.getPath('documents'), '.prismartifacts')
        const cleanChatFolder = targetChatId.replace(/[^a-zA-Z0-9-]/g, '') || 'default'
        const chatDir = path.join(artifactsBaseDir, cleanChatFolder)
        await fs.mkdir(chatDir, { recursive: true })

        const id = generateArtifact6DigitId()
        const targetPath = path.join(chatDir, filename)

        await compileHtmlToPdf(html, targetPath)

        const artifact: ArtifactItem = {
          id,
          type: 'pdf',
          filename,
          path: targetPath,
          htmlContent: html,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }

        saveChatArtifact(targetChatId, artifact)
        broadcastArtifactsUpdate(targetChatId)

        return `PDF generated successfully!\nID: ${id}\nFilename: ${filename}\nSaved at: ${targetPath}`
      } catch (err) {
        return `Error generating PDF: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'edit_pdf': {
      try {
        const html = (args.html || '').toString().trim()
        if (!html) {
          return 'Error: HTML+CSS content is required to update a PDF.'
        }

        const targetChatId = chatId || _currentSessionIdForTodo || 'default'
        const existingArtifacts = getChatArtifacts(targetChatId)

        const targetId = (args.id || '').toString().trim()
        const targetPathArg = (args.path || '').toString().trim()

        let targetArtifact = existingArtifacts.find(
          (a) =>
            (targetId && a.id === targetId) ||
            (targetPathArg &&
              path.normalize(a.path).toLowerCase() === path.normalize(targetPathArg).toLowerCase())
        )

        let targetPath = ''
        let artifactId = ''
        let filename = ''

        if (targetArtifact) {
          targetPath = targetArtifact.path
          artifactId = targetArtifact.id
          filename = targetArtifact.filename
        } else if (targetPathArg) {
          targetPath = targetPathArg
          filename = path.basename(targetPath)
          artifactId = generateArtifact6DigitId()
        } else {
          return `Error: Artifact not found with ID "${targetId}". Please specify a valid artifact ID from the conversation or a valid file PATH.`
        }

        await compileHtmlToPdf(html, targetPath)

        const updatedArtifact: ArtifactItem = {
          id: artifactId,
          type: 'pdf',
          filename,
          path: targetPath,
          htmlContent: html,
          createdAt: targetArtifact ? targetArtifact.createdAt : Date.now(),
          updatedAt: Date.now()
        }

        saveChatArtifact(targetChatId, updatedArtifact)
        broadcastArtifactsUpdate(targetChatId)

        return `PDF artifact updated successfully!\nID: ${artifactId}\nFilename: ${filename}\nSaved at: ${targetPath}`
      } catch (err) {
        return `Error updating PDF: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'write_pptx': {
      try {
        const html = (args.html || '').toString().trim()
        if (!html) {
          return 'Error: HTML+CSS content is required to generate a PowerPoint presentation.'
        }
        let filename = (args.filename || 'presentation.pptx').toString().trim()
        filename = path.basename(filename)
        if (!filename.toLowerCase().endsWith('.pptx')) {
          filename += '.pptx'
        }

        const targetChatId = chatId || _currentSessionIdForTodo || 'default'
        const artifactsBaseDir = path.join(app.getPath('documents'), '.prismartifacts')
        const cleanChatFolder = targetChatId.replace(/[^a-zA-Z0-9-]/g, '') || 'default'
        const chatDir = path.join(artifactsBaseDir, cleanChatFolder)
        await fs.mkdir(chatDir, { recursive: true })

        const id = generateArtifact6DigitId()
        const targetPath = path.join(chatDir, filename)

        await compileHtmlToPptx(html, targetPath)

        const artifact: ArtifactItem = {
          id,
          type: 'pptx',
          filename,
          path: targetPath,
          htmlContent: html,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }

        saveChatArtifact(targetChatId, artifact)
        broadcastArtifactsUpdate(targetChatId)

        return `PowerPoint presentation generated successfully!\nID: ${id}\nFilename: ${filename}\nSaved at: ${targetPath}`
      } catch (err) {
        return `Error generating PowerPoint presentation: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'edit_pptx': {
      try {
        const html = (args.html || '').toString().trim()
        if (!html) {
          return 'Error: HTML+CSS content is required to update a PowerPoint presentation.'
        }

        const targetChatId = chatId || _currentSessionIdForTodo || 'default'
        const existingArtifacts = getChatArtifacts(targetChatId)

        const targetId = (args.id || '').toString().trim()
        const targetPathArg = (args.path || '').toString().trim()

        let targetArtifact = existingArtifacts.find(
          (a) =>
            (targetId && a.id === targetId) ||
            (targetPathArg &&
              path.normalize(a.path).toLowerCase() === path.normalize(targetPathArg).toLowerCase())
        )

        let targetPath = ''
        let artifactId = ''
        let filename = ''

        if (targetArtifact) {
          targetPath = targetArtifact.path
          artifactId = targetArtifact.id
          filename = targetArtifact.filename
        } else if (targetPathArg) {
          targetPath = targetPathArg
          filename = path.basename(targetPath)
          artifactId = generateArtifact6DigitId()
        } else {
          return `Error: Artifact not found with ID "${targetId}". Please specify a valid artifact ID from the conversation or a valid file PATH.`
        }

        await compileHtmlToPptx(html, targetPath)

        const updatedArtifact: ArtifactItem = {
          id: artifactId,
          type: 'pptx',
          filename,
          path: targetPath,
          htmlContent: html,
          createdAt: targetArtifact ? targetArtifact.createdAt : Date.now(),
          updatedAt: Date.now()
        }

        saveChatArtifact(targetChatId, updatedArtifact)
        broadcastArtifactsUpdate(targetChatId)

        return `PowerPoint presentation artifact updated successfully!\nID: ${artifactId}\nFilename: ${filename}\nSaved at: ${targetPath}`
      } catch (err) {
        return `Error updating PowerPoint presentation: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    default:
      return `Error: Tool "${toolName}" has no registered executor.`
  }
}

async function compileHtmlToPptx(html: string, outputPath: string): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'

  const dir = path.dirname(outputPath)
  await fs.mkdir(dir, { recursive: true })

  let win: BrowserWindow | null = null

  try {
    win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      frame: false,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    const encodedHtml = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await win.loadURL(encodedHtml)

    // Wait brief moment for layout & styles to compute
    await new Promise((r) => setTimeout(r, 600))

    const slideCount: number = await win.webContents.executeJavaScript(`
      (() => {
        let slides = Array.from(document.querySelectorAll('.slide, section, .page, [data-slide]'));
        if (slides.length === 0) {
          const bodyChildren = Array.from(document.body.children).filter(
            el => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'LINK'
          );
          if (bodyChildren.length > 1 && bodyChildren.every(el => el.getBoundingClientRect().height > 80)) {
            slides = bodyChildren;
          } else {
            slides = [document.body];
          }
        }
        return slides.length;
      })()
    `)

    const totalSlides = Math.max(1, slideCount)

    for (let i = 0; i < totalSlides; i++) {
      const slideInfo = await win.webContents.executeJavaScript(`
        ((slideIndex) => {
          let styleEl = document.getElementById('prism-pptx-export-style');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'prism-pptx-export-style';
            document.head.appendChild(styleEl);
          }
          styleEl.innerHTML = \`
            html, body {
              width: 1920px !important;
              height: 1080px !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }
          \`;

          let slides = Array.from(document.querySelectorAll('.slide, section, .page, [data-slide]'));
          if (slides.length === 0) {
            const bodyChildren = Array.from(document.body.children).filter(
              el => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'LINK'
            );
            if (bodyChildren.length > 1 && bodyChildren.every(el => el.getBoundingClientRect().height > 80)) {
              slides = bodyChildren;
            } else {
              slides = [document.body];
            }
          }

          slides.forEach((s, idx) => {
            if (!s.dataset.origDisplay) {
              s.dataset.origDisplay = window.getComputedStyle(s).display || 'block';
            }
            if (idx === slideIndex) {
              s.style.display = s.dataset.origDisplay === 'none' ? 'block' : s.dataset.origDisplay;
              s.style.visibility = 'visible';
              s.style.width = '100vw';
              s.style.height = '100vh';
              s.style.boxSizing = 'border-box';
              s.style.margin = '0';
            } else {
              s.style.display = 'none';
              s.style.visibility = 'hidden';
            }
          });

          const currentSlide = slides[slideIndex] || document.body;
          const rect = currentSlide.getBoundingClientRect();
          const cs = window.getComputedStyle(currentSlide);
          return {
            x: Math.max(0, Math.floor(rect.left)),
            y: Math.max(0, Math.floor(rect.top)),
            width: Math.min(1920, Math.ceil(rect.width)),
            height: Math.min(1080, Math.ceil(rect.height)),
            bg: cs.backgroundColor || ''
          };
        })(${i})
      `)

      await new Promise((r) => setTimeout(r, 100))

      let image: Electron.NativeImage
      if (slideInfo && slideInfo.width > 200 && slideInfo.height > 200) {
        image = await win.webContents.capturePage({
          x: slideInfo.x,
          y: slideInfo.y,
          width: slideInfo.width,
          height: slideInfo.height
        })
      } else {
        image = await win.webContents.capturePage()
      }

      const pngBuffer = image.toPNG()

      const pptxSlide = pptx.addSlide()

      if (slideInfo && slideInfo.bg) {
        const hexBg = parseCssColorToHex(slideInfo.bg)
        if (hexBg) {
          pptxSlide.background = { color: hexBg }
        }
      }

      const base64Image = `data:image/png;base64,${pngBuffer.toString('base64')}`
      pptxSlide.addImage({
        data: base64Image,
        x: 0,
        y: 0,
        w: 10,
        h: 5.625
      })
    }
  } catch (err) {
    console.error('Error in BrowserWindow PPTX compilation, using fallback:', err)
    await compileHtmlToPptxFallback(html, pptx)
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
  }

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  await fs.writeFile(outputPath, buffer)
}

function removeUnsafeHtmlBlocks(html: string): string {
  const lowerHtml = html.toLowerCase()
  let result = ''
  let cursor = 0

  while (cursor < html.length) {
    const styleStart = lowerHtml.indexOf('<style', cursor)
    const scriptStart = lowerHtml.indexOf('<script', cursor)
    const blockStart =
      styleStart === -1
        ? scriptStart
        : scriptStart === -1
          ? styleStart
          : Math.min(styleStart, scriptStart)

    if (blockStart === -1) {
      result += html.slice(cursor)
      break
    }

    result += html.slice(cursor, blockStart)
    const blockName = styleStart !== -1 && blockStart === styleStart ? 'style' : 'script'
    const blockEnd = lowerHtml.indexOf(`</${blockName}`, blockStart + blockName.length + 1)
    if (blockEnd === -1) break

    const closingTagEnd = html.indexOf('>', blockEnd + blockName.length + 2)
    if (closingTagEnd === -1) break
    cursor = closingTagEnd + 1
  }

  return result
}

async function compileHtmlToPptxFallback(html: string, pptx: PptxGenJS): Promise<void> {
  const cleanHtml = removeUnsafeHtmlBlocks(html)
  let rawSlides: string[] = []

  const slideMatches = cleanHtml.match(/<(div|section)[^>]*>([\s\S]*?)<\/\1>/gi)
  if (slideMatches && slideMatches.length > 0) {
    rawSlides = slideMatches
  } else {
    rawSlides = [cleanHtml]
  }

  for (const slideHtml of rawSlides) {
    const slide = pptx.addSlide()
    const text = cleanHtmlTags(slideHtml)
    if (text) {
      slide.addText(text, {
        x: 0.8,
        y: 1.0,
        w: 8.4,
        h: 4.5,
        fontSize: 18,
        color: '333333',
        fontFace: 'Arial'
      })
    }
  }
}

function cleanHtmlTags(str: string): string {
  let clean = removeUnsafeHtmlBlocks(str)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

  // Remove tag delimiters instead of matching complete tags. This prevents
  // malformed or nested input from reconstructing an HTML element. Angle
  // brackets encoded as entities intentionally remain encoded in the output.
  clean = clean.replace(/[<>]/g, '')
  return clean.trim()
}

function parseCssColorToHex(colorStr: string): string | null {
  const hexMatch = colorStr.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('')
    }
    return hex
  }
  const rgbMatch = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0')
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0')
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0')
    return `${r}${g}${b}`
  }
  return null
}

async function compileHtmlToPdf(html: string, outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath)
  await fs.mkdir(dir, { recursive: true })

  try {
    let win: BrowserWindow | null = new BrowserWindow({
      width: 1200,
      height: 1600,
      show: false,
      frame: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    try {
      const encodedHtml = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      await win.loadURL(encodedHtml)

      // Wait brief moment for layout & styles to compute before printing
      await new Promise((r) => setTimeout(r, 600))

      let pdfBuffer: Buffer
      try {
        pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          preferCSSPageSize: true
        })
      } catch (printErr) {
        console.warn(
          'Electron printToPDF failed on first attempt, retrying after pause...',
          printErr
        )
        await new Promise((r) => setTimeout(r, 400))
        pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          preferCSSPageSize: true
        })
      }

      await fs.writeFile(outputPath, pdfBuffer)
    } finally {
      if (win && !win.isDestroyed()) {
        win.destroy()
        win = null
      }
    }
  } catch (primaryErr) {
    console.error('BrowserWindow PDF compilation failed, invoking Playwright fallback:', primaryErr)
    await compileHtmlToPdfFallback(html, outputPath)
  }
}

async function compileHtmlToPdfFallback(html: string, outputPath: string): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 500))
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    })
  } finally {
    await browser.close()
  }
}

function generateArtifact6DigitId(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function broadcastArtifactsUpdate(targetChatId: string): void {
  const artifacts = getChatArtifacts(targetChatId)
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (
      !win.webContents.getURL().includes('#launcher') &&
      !win.webContents.getURL().includes('#subagents')
    ) {
      safeSend(win, 'chat-artifacts-update', { chatId: targetChatId, artifacts })
    }
  }
}

// Questionnaire resolvers are shared by Chat and the isolated Harness runtime.
const activeQuestionnaireResolvers = new Map<string, (result: string) => void>()

export function requestQuestionnaire(
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const sessionId =
      typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id
        : `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const questions = Array.isArray(args.questions) ? args.questions : []

    const onAbort = () => {
      activeQuestionnaireResolvers.delete(sessionId)
      reject(new Error('AbortError'))
    }

    if (signal) {
      if (signal.aborted) {
        reject(new Error('AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (
          !win.webContents.getURL().includes('#launcher') &&
          !win.webContents.getURL().includes('#subagents')
        ) {
          safeSend(win, 'show-questionnaire', { sessionId, questions })
        }
      }
    } catch {
      // The streamed tool call remains enough for the active workspace to render the form.
    }

    activeQuestionnaireResolvers.set(sessionId, (result) => {
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    })
  })
}

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

ipcMain.handle('get-chat-artifacts', (_event, chatId: string) => {
  if (!chatId) return []
  return getChatArtifacts(chatId)
})

ipcMain.handle('open-artifact-file', async (_event, filePath: string) => {
  if (!filePath) return
  await shell.openPath(filePath)
})

ipcMain.handle('show-artifact-in-folder', async (_event, filePath: string) => {
  if (!filePath) return
  shell.showItemInFolder(filePath)
})
