import { exec } from 'child_process'
import { shell, BrowserWindow } from 'electron'
import { getInstalledApps } from 'get-installed-apps'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { toolsManifest } from './toolsManifest'
import { ApplicationInfo } from '../shared/types'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Executes a terminal command and returns the output.
 */
export async function runTerminalCommand(command: string, signal?: AbortSignal): Promise<string> {
  const isWindows = process.platform === 'win32'
  const normalizedCommand = isWindows ? `chcp 65001 > nul & ${command}` : command

  return new Promise((resolve, reject) => {
    exec(normalizedCommand, { signal }, (error, stdout, stderr) => {
      if (error) {
        if (error.name === 'AbortError') {
          reject(error)
          return
        }
        resolve(`Error executing command: ${error.message}\n${stderr}`)
        return
      }
      const output = stdout || stderr || 'Command executed successfully (no output).'
      // Truncate output if it exceeds 50,000 characters to prevent renderer crash
      const MAX_OUTPUT = 50000
      if (output.length > MAX_OUTPUT) {
        resolve(output.substring(0, MAX_OUTPUT) + '\n\n... (Output truncated for performance)')
        return
      }
      resolve(output)
    })
  })
}

function resolveRequiredPath(input: string, label: string): string {
  const cleaned = input.trim()
  if (!cleaned) {
    throw new Error(`Missing required ${label}. Provide a complete path.`)
  }

  if (/^(PATH|FILE|DIR|DIRECTORY|SOURCE|DESTINATION|TARGET)([_-]?\w+)?$/i.test(cleaned)) {
    throw new Error(`Invalid ${label}: "${input}". Replace placeholders with a real path.`)
  }

  return path.resolve(cleaned)
}

function assertNotRootPath(fullPath: string, label: string): void {
  const normalized = path.normalize(fullPath)
  const root = path.parse(normalized).root
  if (normalized === root) {
    throw new Error(`Refusing to operate on filesystem root as ${label}: ${fullPath}`)
  }
}

function createAbortError(): Error {
  const error = new Error('AbortError')
  error.name = 'AbortError'
  return error
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
    assertNotRootPath(fullPath, 'path')
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
    assertNotRootPath(fullPath, 'path')
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
    assertNotRootPath(fullPath, 'path')
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
    assertNotRootPath(fullPath, 'path')
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
    assertNotRootPath(fullPath, 'path')
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, { encoding: 'utf8', signal })
    return `File saved successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error saving file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Replace text in a file.
 */
export async function computerReplaceInFile(
  filePath: string,
  oldText: string,
  newText: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    assertNotRootPath(fullPath, 'path')
    if (!oldText) {
      return 'Error replacing text: oldText is required and cannot be empty.'
    }
    const content = await fs.readFile(fullPath, { encoding: 'utf8', signal })
    if (!content.includes(oldText)) {
      return `Error: Text to replace not found in file.`
    }
    const updatedContent = content.replace(new RegExp(escapeRegExp(oldText), 'g'), newText)
    await fs.writeFile(fullPath, updatedContent, { encoding: 'utf8', signal })
    return `Text replaced successfully in: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error replacing text: ${error instanceof Error ? error.message : String(error)}`
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
    assertNotRootPath(fullPath, 'path')
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
    assertNotRootPath(sourceFullPath, 'sourcePath')
    assertNotRootPath(destinationFullPath, 'destinationPath')

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
    assertNotRootPath(sourceFullPath, 'sourcePath')
    assertNotRootPath(destinationFullPath, 'destinationPath')

    throwIfAborted(signal)
    await fs.stat(sourceFullPath)
    await fs.mkdir(path.dirname(destinationFullPath), { recursive: true })

    const shouldOverwrite = parseToolBoolean(overwrite, false)
    try {
      await fs.stat(destinationFullPath)
      if (!shouldOverwrite) {
        return `Error moving file: destination already exists: ${destinationFullPath}`
      }
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

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/**
 * COMPUTER USE: Read file content.
 */
export async function computerReadFile(filePath: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPath = resolveRequiredPath(filePath, 'path')
    const content = await fs.readFile(fullPath, { encoding: 'utf8', signal })
    return content
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error reading file: ${error instanceof Error ? error.message : String(error)}`
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
 * Removes HTML tags, scripts, and styles from a string.
 */
function stripHtml(html: string): string {
  let text = html
  let previous
  do {
    previous = text
    text = text
      .replace(/<script[^>]*>([\s\S]*?)<\/script>/gim, '')
      .replace(/<style[^>]*>([\s\S]*?)<\/style>/gim, '')
      .replace(/<[^>]*>/g, ' ')
  } while (text !== previous)
  return text
}

async function fetchWithHiddenBrowser(url: string, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let resolved = false

    const cleanUp = (): void => {
      if (!resolved) {
        resolved = true
        try {
          win.webContents.stop()
        } catch {
          // Best-effort cleanup only.
        }
        setTimeout(() => {
          try {
            win.destroy()
          } catch {
            // Best-effort cleanup only.
          }
        }, 100)
      }
    }

    const timeout = setTimeout(() => {
      cleanUp()
      reject(new Error('Timeout loading page in offscreen browser window'))
    }, 15000)

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        cleanUp()
        reject(createAbortError())
      })
    }

    win.webContents.on('did-finish-load', async () => {
      try {
        const text = await win.webContents.executeJavaScript('document.body.innerText || ""')
        clearTimeout(timeout)
        cleanUp()
        resolve(text)
      } catch (err) {
        clearTimeout(timeout)
        cleanUp()
        reject(err)
      }
    })

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      clearTimeout(timeout)
      cleanUp()
      reject(new Error(`Browser load failed: ${errorDescription} (code: ${errorCode})`))
    })

    win.loadURL(url).catch((err) => {
      clearTimeout(timeout)
      cleanUp()
      reject(err)
    })
  })
}

/**
 * Fetches and returns text content from a URL.
 */
export async function sawLinkFromUrl(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const targetUrl = normalizeHttpUrl(url, 'url')
    const response = await fetch(targetUrl, {
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    })

    if (!response.ok) {
      throw new Error(`Website returned status ${response.status}`)
    }

    const html = await response.text()
    const text = stripHtml(html).replace(/\s+/g, ' ').trim()

    await sleep(500)

    const MAX_CONTENT = 20000
    return text.length > MAX_CONTENT ? text.substring(0, MAX_CONTENT) + '... (truncated)' : text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error

    // Fallback to hidden browser window load
    try {
      const text = await fetchWithHiddenBrowser(url, signal)
      const cleaned = text.replace(/\s+/g, ' ').trim()
      const MAX_CONTENT = 20000
      return cleaned.length > MAX_CONTENT
        ? cleaned.substring(0, MAX_CONTENT) + '... (truncated)'
        : cleaned
    } catch (browserError) {
      if (browserError instanceof Error && browserError.name === 'AbortError') throw browserError
      return `Error fetching URL: ${error instanceof Error ? error.message : String(error)} (Fallback browser failed: ${browserError instanceof Error ? browserError.message : String(browserError)})`
    }
  }
}

/**
 * Performs a web search using DuckDuckGo HTML version.
 */
export async function webSearch(query: string, signal?: AbortSignal): Promise<string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  async function tryDuckDuckGo(): Promise<{ title: string; link: string; snippet: string }[]> {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal,
        headers: { 'User-Agent': userAgent }
      }
    )

    if (!response.ok) return []

    const html = await response.text()
    const results: { title: string; link: string; snippet: string }[] = []

    // Improved logic to be more resilient to structural changes
    // We split by result containers to avoid premature regex termination from nested divs
    const resultBlocks = html
      .split(/<div[^>]*class="[^"]*result(?:__body|s_links| )[^"]*"[^>]*>/i)
      .slice(1)

    for (const body of resultBlocks) {
      if (results.length >= 5) break

      const titleMatch = body.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/)
      const linkMatch =
        body.match(/href="([^"]*)"[^>]*class="[^"]*result__a[^"]*"/) ||
        body.match(/class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"/) ||
        body.match(/href="([^"]*)"/)

      let snippetMatch =
        body.match(
          /<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|p)>/i
        ) ||
        body.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/) ||
        body.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/)

      // Structural fallback: if class-based matching fails, try to extract content between title and extras
      if (!snippetMatch) {
        const fallbackMatch =
          body.match(/<\/h2>([\s\S]*?)<div[^>]*class="[^"]*result__extras/i) ||
          body.match(/<\/a>([\s\S]*?)<div[^>]*class="[^"]*result__extras/i)
        if (fallbackMatch) snippetMatch = fallbackMatch
      }

      if (titleMatch && linkMatch) {
        let rawLink = linkMatch[1]

        // Extract raw link from DuckDuckGo redirect if present (uddg parameter)
        try {
          const urlObj = new URL(
            rawLink.startsWith('//')
              ? `https:${rawLink}`
              : rawLink.startsWith('/')
                ? `https://duckduckgo.com${rawLink}`
                : rawLink
          )
          const uddg = urlObj.searchParams.get('uddg')
          if (uddg) {
            rawLink = decodeURIComponent(uddg)
          }
        } catch {
          // If URL parsing fails, keep the original link
        }

        results.push({
          title: stripHtml(titleMatch[1]).trim(),
          link: rawLink,
          snippet: snippetMatch ? stripHtml(snippetMatch[1]).trim() : ''
        })
      }
    }
    return results
  }

  try {
    const results = await tryDuckDuckGo()

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
  }
}

/**
 * Returns the system prompt configured with the correct model identity.
 */
export function getSystemToolsPrompt(
  modelKey: string,
  target: 'main' | 'subagent' | 'both' | 'launcher' = 'main',
  extendedSearch: boolean = false
): string {
  const name = 'Prism AI'
  const modelNames: Record<string, string> = {
    'prism-4': 'Prism 4',
    'prism-4.1': 'Prism 4.1',
    'prism-4.2': 'Prism 4.2',
    'prism-4.3': 'Prism 4.3',
    'prism-5': 'Prism 5'
  }
  const modelName = modelNames[modelKey] || 'Prism 4'

  const toolsPrompt = toolsManifest
    .filter((t) => {
      if (target === 'launcher') {
        return (
          t.name === 'web_search' || t.name === 'saw_link_from_url' || t.name === 'open_main_app'
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
  const cwd = process.cwd()
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
    return `# Identity
Role: Prism Mini-Chat (${modelName}). You are a fast, lightweight, inline assistant running inside the Quick Launcher.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd}

# Interaction Rules
- **Simple Markdown Only:** You must respond ONLY using traditional simple Markdown (paragraphs, bold, lists, basic tables). It is STRICTLY FORBIDDEN to use HTML code or CSS styles in your messages. Do not use Rich Markdown.
- **Limited Tools:** You only have access to 'web_search' (normal basic search, Deep Research is NOT supported) and 'saw_link_from_url'.
- **Transition with open_main_app:** If the user asks to perform complex tasks (terminal commands, file operations, subagents) or if the task requires any Rich Markdown (such as dashboards, stylized grids, complex visual cards), you must IMMEDIATELY invoke the 'open_main_app' tool to transfer the work to the main app.
- In the 'model' parameter of the 'open_main_app' tool, choose the most appropriate in-app model according to the following Prism model table:
  * 'prism-5' (Underlying Engine: gemini-3.5-flash): Recommended for complex general automation tasks, fast code writing, and flagship reasoning.
  * 'prism-4.3' (Underlying Engine: gemma-4-31b-it): Best for dense analytical reasoning and detailed planning.
  * 'prism-4.2' (Underlying Engine: gemma-4-26b-a4b-it): Best for balanced desktop workflow automation with multiple steps.
  * 'prism-4.1' (Underlying Engine: gemini-3-flash-preview): Ultra-fast responses for simple day-to-day tasks.
  * 'prism-4' (Underlying Engine: gemini-3.1-flash-lite): Lightweight model for basic tasks.

Tools:
${toolsPrompt}`
  }

  const parallelRule =
    target === 'main'
      ? '- Parallelism: You can run multiple <tool_call> blocks in a single response to execute them concurrently. Use <run_subagents> to delegate complex tasks.'
      : '- Collaboration: Use "send_group_message" and "wait_for_updates" for Group Chat sync. You can output multiple tool calls in parallel.'
  const humanUserRule =
    target === 'subagent'
      ? '- Human user messages: Any group message from "User (human operator)" is a direct message from the Prism user, not another agent. Treat it as human input and respond via send_group_message when relevant.'
      : ''

  const searchProtocolText = extendedSearch
    ? 'ENABLED (ACTIVATED - execute the DEEP RESEARCH protocol)'
    : 'DISABLED (INACTIVE - execute the standard ACTIVE SEARCH protocol)'

  return `# Identity
Role: ${name} (${modelName}). You are a concise, tool-capable desktop assistant.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd}
Extended Search Protocol (DEEP RESEARCH): ${searchProtocolText}

# Visual & Interaction Protocol
Objective: Define clear architectural boundaries between Simple Markdown, Rich Markdown (HTML/CSS inside messages), and Mini Apps to maximize visual beauty (UX) and system performance.

## 1. Simple Markdown (Standard Conversation)
- **Definition:** Standard text using normal markdown formatting (headers, bold, bullet points, standard tables).
- **Usage:** Use by default for 95% of answers. This includes conversational responses, opinions, explanations, summaries, text reviews (such as reviewing song lyrics, poetry, code, etc.), debugging help, list of links, and general answers.
- **Rule:** Do NOT use HTML/CSS elements for simple conversational responses, summaries, or when text is sufficient. Keep simple responses simple. DO NOT wrap standard responses in styled divs, background gradients, or card containers.

## 2. Rich Markdown Messages (Static Visual Context with HTML/CSS)
- **Definition:** Markdown output containing inline HTML and CSS (rendered directly in the chat message via rehypeRaw).
- **Usage:** Use this ONLY when the user EXPLICITLY requests a card, dashboard, badge, grid, or visual layout (e.g., "create a profile card", "create idea cards", "show in a dashboard").
- **Examples:**
  - *Profile / Business Cards:* Present user/profile info in a beautiful, styled HTML container (gradients, border-radius, shadows, margins) ONLY when requested as a card.
  - *Idea Cards / Brainstorming:* Present names, concepts, or options as a grid or list of separate visually appealing cards/badges ONLY when requested to do so visually (e.g., "idea cards").
- **Constraint Directive:** NEVER use HTML/CSS to wrap standard text analyses, conversational opinions, lists of thoughts, or standard textual answers. Using styled card boxes for normal conversational text makes the interface look bloated and unnatural.
- **Example structure to output in chat:**
  ${'```'}html
  <div style="background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); padding: 20px; border-radius: 16px; color: white; box-shadow: 0 10px 20px rgba(0,0,0,0.15); font-family: system-ui, sans-serif; max-width: 450px;">
    <div style="display: flex; align-items: center; gap: 15px;">
      <div style="width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px;">B</div>
      <div>
        <h4 style="margin: 0; font-size: 18px; font-weight: 600;">Breno Alexandre</h4>
        <span style="font-size: 13px; opacity: 0.8;">@brnalemusic</span>
      </div>
    </div>
    <div style="margin-top: 15px; font-size: 14px; line-height: 1.6; opacity: 0.9;">
      Creator of the <b>Prism</b> ecosystem. Shifts between the sensitivity of music/cinema and the precision of software development.
    </div>
  </div>
  ${'```'}

## 3. Mini App Tool Calls (Interactive Context)
- **Definition:** Stateful, functional applications embedded in the chat using '<mini_app>' tags.
- **Usage:** ONLY use mini-apps when user interaction (clicking buttons to change internal state, text inputs triggering logic, interactive forms, calculators, games) is required.
- **Prohibition:** NEVER output a '<mini_app>' for a static profile card, a simple list of ideas, or any content that doesn't actually need event handlers/Javascript-based interaction. Doing so creates unnecessary UI overhead and sandbox load.

## Decision Matrix
| User Intent | Dynamic Interaction Required? | Output Format |
| :--- | :--- | :--- |
| Conversational reply, opinions, text summaries/analyses, general info | No | **Simple Markdown** |
| Visual representation request (explicitly asking for cards, layout, visual dashboard, formatted ideas cards) | No | **Rich Markdown (HTML/CSS inside Markdown)** |
| Interactive widget/tool (game, calculator, form to submit) | Yes | **Mini App (using <mini_app> tags)** |

# Operating Rules
- Match the user's language and intent. Be direct, factual, and brief by default; expand only when the task requires it.
- Prefer action over commentary. Send user-facing text only when done or blocked, asking at most one necessary question.
- Treat the provided date/context as authoritative for time-sensitive tasks; search when facts may have changed.
- Do not expose hidden reasoning (thoughts). Provide conclusions, key evidence, and next steps.
- Never invent tool results, files, apps, links, paths, or citations.

# Research
You have two active search protocols (ACTIVE SEARCH and DEEP RESEARCH):

1. ACTIVE SEARCH (Standard and Mandatory for any serious topic like medical, legal, coding, news, etc. that requires in-depth research):
- You MUST ALWAYS conduct in-depth research when the subject is serious or requires research.
- Actively behave: perform searches with the 'web_search' Tool Call, access sites using 'saw_link_from_url', and collect real information.
- Advance in the task steps ONLY if you find useful and reliable information on the accessed sites.
- If it is impossible to find useful information after multiple attempts, give up on the main action. Inform the user that you could not find enough reliable information, present a briefing/summary of the information you did find, and make it clear that the information may be outdated or incorrect.

2. DEEP RESEARCH (Extended Search - Activated when the Extended Search flag is active):
- When the Extended Search flag is active (Extended Search: ENABLED), you MUST execute the DEEP RESEARCH protocol following these structured steps:
  
  Step 1. Understanding the Request: Analyze what the user wants to discover.
  Step 2. Brief Research for Context: Perform a quick initial search (1 or 2 'web_search' and/or 'saw_link_from_url' calls) to get the initial context and keywords about the subject.
  Step 3. Research Plan and Confirmation:
    - Write a brief briefing of the initial context found.
    - Elaborate and describe a detailed Research Plan (explaining what you will search for, what terms you will use, what sources you will access, and what type of data you will collect).
    - Ask the user clearly and explicitly if they approve and wish to proceed with the deep extended research (e.g., "Do you wish to proceed with this extended research?").
    - STOP GENERATION IMMEDIATELY. Do not call any more tools in this round. Wait for user confirmation.
  Step 4. Deep Research (Only after user confirmation):
    - If the history shows that you have already presented the research plan and the user responded in the last message approving, confirming, or ordering to start/proceed (e.g., "yes", "go ahead", "proceed", "start", "ok"), you must perform the deep research.
    - This research must be extremely deep, heavy, and exhaustive. It must go through at least 10 distinct steps/iterations of searching ('web_search') and thorough reading of pages ('saw_link_from_url'). Enter the sites, investigate details, cross-reference. This process is slow by design (it can take up to 20 minutes of intense batch processing of tools).
    - Track and clearly expose the progress of each step in your reasoning (thoughts/thinking).
  Step 5. Strategic Markdown Output:
    - Compile the result into professional-level Markdown that prioritizes information density and clarity.
    - Utilize structural elements (tables, grids, stylized blocks) ONLY where they significantly improve the scannability of complex data.
    - Maintain a focus on actionable intelligence, using rich formatting surgically to synthesize information that would be difficult to parse as plain text.

# Mini Apps (Executable in Chat)
You have the ability to generate interactive mini-apps that run directly in the chat. Use this ONLY for functional, stateful, and interactive modules as defined in the **Visual & Interaction Protocol**.
To generate a mini-app, use the following XML structure in your output (outside of code blocks):

<mini_app>
<title>App Name</title>
<html>
<!-- HTML structure here -->
</html>
<css>
/* CSS styles here (optional) */
</css>
<js>
// JavaScript logic here (optional) 
</js>
</mini_app>

Rules for Mini Apps:
- **Interactivity Required:** Only use mini-apps when user interaction (input, selection, etc.) is required.
- **Modern Styling:** Be creative and use modern styles (glassmorphism, gradients, animations).
- **Environment:** Use Vanilla JS for interactivity. The environment is a sandboxed iframe.
- **Responsiveness:** CSS should be mobile-first and responsive.
- **Conciseness:** Keep the code concise but functional and visually impressive.

# Task Method
- Clarify success criteria internally, then plan -> act -> verify.
- For code/files, inspect before editing, keep changes scoped, preserve user work, and verify with the lightest useful command.
- Math: simple -> result only. Complex -> concise LaTeX and \\boxed{final}.
- Navigation: URL -> open_browser_link | Search result/page -> saw_link_from_url | App -> open_application | Unknown app -> list_installed_applications or scan.

# Tool Protocol
- Tool calls MUST be formatted as a single JSON object inside a <tool_call> XML block.
- Structure: <tool_call>{"type": "tool_name", "param1": "value1", ...}</tool_call>
- Use only standard JSON. For multiline strings, code, or special characters, YOU MUST use standard JSON escaping (e.g., \\n for newlines, \\" for quotes). Do NOT use literal newlines inside a JSON string.
- Use only listed tool names and schemas; never invent names.
- Paths must be complete absolute paths unless a tool explicitly accepts otherwise. No placeholders or blanks.
- File map: read=computer_use_read_file; create=computer_use_create_file; save=computer_use_save_file; edit=computer_use_edit_file; append=computer_use_append_file; remove file=computer_use_remove_file; remove dir=computer_use_remove_directory; copy=computer_use_copy_file; move=computer_use_move_file; info=computer_use_get_file_info; list=computer_use_list_directory.
- Before destructive or broad write operations, verify target paths and user intent.

# Memory & Coordination
- Use search_chat_history for relevant prior context/preferences; query CSV keywords in user language and English.
${parallelRule}
${humanUserRule}

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
4. SWARM TERMINATION: When you have verified that the overall goal has been successfully completed by the subagents (or has failed), you MUST send a final summary to the group chat via 'send_group_message' with status="done" or status="error". This will terminate the entire swarm.
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
4. CLOSED-LOOP SYNC: New messages from others appear as [UNREAD MESSAGES]. Acknowledge relevant unread messages by sender, incorporate them into your next action, and correct course immediately when the Master Coordinator or User gives new direction.
5. WAITING DISCIPLINE: Use 'wait_for_updates' to listen instead of polling or idle thinking. If you ask a question, request review, need permission, depend on another agent, or are unsure whether to continue, pair that request with 'wait_for_updates'.
6. EXIT CLEARANCE: Never spend your final tokens or produce your final response until you have confirmed you are allowed to exit. When your assigned task seems complete or impossible, post status="working" asking the Master Coordinator for exit clearance, call 'wait_for_updates', and only finish after explicit approval, a Master done/error decision, or a swarm-completed signal.
7. TERMINATION: When exit is approved, send one final group update with status="done" or status="error" containing the result, evidence, changed files or commands if relevant, and remaining risks. Note that the swarm is ultimately terminated when the Master Coordinator determines it is done.
8. NO SUBAGENTS: You cannot spawn more agents. Focus on your assigned task.

[OUTPUT]: Your thoughts are private. Your FINAL RESPONSE should be a concise mission report for the Main Agent, and it must only appear after the exit-clearance protocol above is satisfied.`
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
