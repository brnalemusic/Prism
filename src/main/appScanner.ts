import { execFile } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { ApplicationInfo } from '../shared/types'

interface CacheDirectory {
  path: string
  mtimeMs: number
  apps: ApplicationInfo[]
}

interface CacheFile {
  version: number
  lastScan: number
  directories: CacheDirectory[]
}

interface RawExeEntry {
  FullName: string
  Length?: number
}

const CACHE_VERSION = 2
const MAX_CONCURRENT_SCANS = 4
const MIN_EXE_SIZE_BYTES = 100 * 1024
const SCAN_TIMEOUT_MS = 60_000

const EXCLUDED_ROOT_DIRS = new Set([
  'windows', 'winxsx', '$recycle.bin', 'programdata', 'recovery',
  '$windows.~bt', '$windows.~ws', 'perflogs'
])

const EXCLUDED_SUBDIRS = new Set([
  'appdata\\local\\packages',
  'appdata\\local\\temp',
  'appdata\\local\\crashdumps',
  'appdata\\local\\d3dscache',
  'appdata\\local\\fontcache',
  'appdata\\local\\comms',
  'appdata\\local\\connecteddevicesplatform',
  'appdata\\roaming\\microsoft\\windows\\recent',
  'appdata\\local\\microsoft',
  'appdata\\roaming\\microsoft'
])

const EXCLUDED_PREFIXES = [
  'unins', 'uninst', 'setup', 'helper', 'crash', 'update', 'elevate',
  'install', 'maint', 'config', 'uninstall', 'downgrad', 'cleanup',
  'isdone', 'unarc', 'inno', 'isunin'
]

function getAppDataPath(): string {
  return path.join(
    process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
    'PrismDesktop'
  )
}

function getCachePath(): string {
  return path.join(getAppDataPath(), 'app-index-cache.json')
}

function isExcludedPath(fullPath: string): boolean {
  const lower = fullPath.toLowerCase()
  const parts = lower.split(/[\\/]/)

  for (const part of parts) {
    if (EXCLUDED_ROOT_DIRS.has(part)) return true
    if (EXCLUDED_SUBDIRS.has(part)) return true
  }

  const baseName = path.basename(lower)
  if (baseName.endsWith('.exe')) {
    const nameNoExt = baseName.slice(0, -4)
    for (const prefix of EXCLUDED_PREFIXES) {
      if (nameNoExt.startsWith(prefix)) return true
    }
  }
  return false
}

function getMainAppName(exePath: string): string {
  const basename = path.basename(exePath, '.exe')
  return basename
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

let allApps: ApplicationInfo[] = []
let scanning = false
let lastScanTime = 0
let appsUpdatedCallback: ((apps: ApplicationInfo[]) => void) | null = null

export function registerAppsUpdatedCallback(cb: (apps: ApplicationInfo[]) => void): void {
  appsUpdatedCallback = cb
}

export function isScanning(): boolean {
  return scanning
}

async function loadCache(): Promise<CacheDirectory[]> {
  try {
    const cachePath = getCachePath()
    const raw = await fs.readFile(cachePath, 'utf-8')
    const parsed = JSON.parse(raw)

    if (parsed.version === 2 && Array.isArray(parsed.directories)) {
      lastScanTime = parsed.lastScan || 0
      return parsed.directories as CacheDirectory[]
    }

    if (parsed.version === 1 && Array.isArray(parsed.apps) && parsed.apps.length > 0) {
      lastScanTime = parsed.lastScan || 0
      console.log('appScanner: Migrating v1 cache to v2 format')
      return []
    }

    return []
  } catch {
    return []
  }
}

async function saveCache(directories: CacheDirectory[]): Promise<void> {
  try {
    const dir = getAppDataPath()
    await fs.mkdir(dir, { recursive: true })
    const cache: CacheFile = {
      version: CACHE_VERSION,
      lastScan: Date.now(),
      directories
    }
    await fs.writeFile(getCachePath(), JSON.stringify(cache), 'utf-8')
  } catch (err) {
    console.error('appScanner: Failed to save cache:', err)
  }
}

async function getDriveRoots(): Promise<string[]> {
  return new Promise((resolve) => {
    const psCommand = 'Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root'
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve(['C:\\'])
        return
      }
      const roots = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^[A-Z]:\\$/i.test(l))
        .map((l) => l.toUpperCase() + '\\')
      resolve(roots.length > 0 ? roots : ['C:\\'])
    })
  })
}

async function getDirectoryMtime(dirPath: string): Promise<number> {
  try {
    const stat = await fs.stat(dirPath)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

async function scanDirectory(dirPath: string): Promise<ApplicationInfo[]> {
  const psCommand = `Get-ChildItem -Path '${dirPath}' -Recurse -Filter *.exe -File -ErrorAction SilentlyContinue -Depth 6 | Select-Object FullName, Length | ConvertTo-Json -Compress`

  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], { maxBuffer: 50 * 1024 * 1024, timeout: SCAN_TIMEOUT_MS }, (_err, stdout) => {
      if (!stdout?.trim()) {
        resolve([])
        return
      }
      try {
        let entries: RawExeEntry[]
        const parsed = JSON.parse(stdout.trim())
        entries = Array.isArray(parsed) ? parsed : [parsed]

        const apps: ApplicationInfo[] = []
        for (const entry of entries) {
          if (!entry.FullName) continue
          if (isExcludedPath(entry.FullName)) continue
          if (entry.Length !== undefined && entry.Length < MIN_EXE_SIZE_BYTES) continue

          const name = getMainAppName(entry.FullName)
          apps.push({
            name,
            path: entry.FullName,
            version: '',
          })
        }
        resolve(apps)
      } catch {
        resolve([])
      }
    })
  })
}

function deduplicateApps(apps: ApplicationInfo[]): ApplicationInfo[] {
  const seen = new Map<string, ApplicationInfo>()
  for (const app of apps) {
    const key = app.path.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, app)
    }
  }
  return Array.from(seen.values())
}

async function discoverScanPaths(): Promise<string[]> {
  const roots = await getDriveRoots()
  const scanPaths: string[] = []
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (EXCLUDED_ROOT_DIRS.has(entry.name.toLowerCase())) continue
        scanPaths.push(path.join(root, entry.name))
      }
    } catch {
      // skip unreadable roots
    }
  }
  return scanPaths
}

async function performScan(): Promise<ApplicationInfo[]> {
  const startTime = Date.now()
  scanning = true

  const scanPaths = await discoverScanPaths()

  console.log(`appScanner: Full scan of ${scanPaths.length} directories...`)

  const allRaw: ApplicationInfo[] = []
  const chunks: string[][] = []
  for (let i = 0; i < scanPaths.length; i += MAX_CONCURRENT_SCANS) {
    chunks.push(scanPaths.slice(i, i + MAX_CONCURRENT_SCANS))
  }

  for (const chunk of chunks) {
    const results = await Promise.all(chunk.map((dir) => scanDirectory(dir)))
    for (const apps of results) {
      allRaw.push(...apps)
    }
  }

  const deduped = deduplicateApps(allRaw)

  const duration = Date.now() - startTime
  console.log(`appScanner: Scan complete in ${duration}ms, found ${deduped.length} executables from ${allRaw.length} raw entries`)

  scanning = false
  return deduped
}

async function backgroundSmartScan(): Promise<void> {
  if (scanning) return
  scanning = true
  const startTime = Date.now()

  const cachedDirs = await loadCache()
  const cachedDirMap = new Map<string, CacheDirectory>()
  for (const cd of cachedDirs) {
    cachedDirMap.set(cd.path.toLowerCase(), cd)
  }

  const currentPaths = await discoverScanPaths()
  const currentPathSet = new Set(currentPaths.map((p) => p.toLowerCase()))

  const keptDirs: CacheDirectory[] = []
  const toScan: string[] = []

  for (const cachedDir of cachedDirs) {
    const lower = cachedDir.path.toLowerCase()
    if (!currentPathSet.has(lower)) {
      console.log(`appScanner: Directory removed, skipping: ${cachedDir.path}`)
      continue
    }

    const currentMtime = await getDirectoryMtime(cachedDir.path)
    if (currentMtime === cachedDir.mtimeMs) {
      keptDirs.push(cachedDir)
    } else {
      toScan.push(cachedDir.path)
    }
  }

  for (const currentPath of currentPaths) {
    if (!cachedDirMap.has(currentPath.toLowerCase())) {
      toScan.push(currentPath)
    }
  }

  const changedCount = toScan.length
  const keptCount = keptDirs.length
  console.log(`appScanner: Smart scan — ${keptCount} dirs unchanged, ${changedCount} dirs to scan`)

  if (toScan.length > 0) {
    const chunks: string[][] = []
    for (let i = 0; i < toScan.length; i += MAX_CONCURRENT_SCANS) {
      chunks.push(toScan.slice(i, i + MAX_CONCURRENT_SCANS))
    }

    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map(async (dir) => {
          const apps = await scanDirectory(dir)
          const mtime = await getDirectoryMtime(dir)
          return { path: dir, mtimeMs: mtime, apps }
        })
      )
      keptDirs.push(...results)
    }
  }

  const allRaw: ApplicationInfo[] = []
  for (const cd of keptDirs) {
    allRaw.push(...cd.apps)
  }
  const deduped = deduplicateApps(allRaw)

  allApps = deduped
  lastScanTime = Date.now()
  await saveCache(keptDirs)

  const duration = Date.now() - startTime
  console.log(`appScanner: Smart scan complete in ${duration}ms, ${deduped.length} apps total`)

  scanning = false

  if (appsUpdatedCallback) {
    try { appsUpdatedCallback(allApps) } catch (e) { console.error(e) }
  }
}

export async function initAppScanner(): Promise<void> {
  const cachedDirs = await loadCache()

  if (cachedDirs.length > 0) {
    allApps = deduplicateApps(cachedDirs.flatMap((cd) => cd.apps))
    console.log(`appScanner: Loaded ${allApps.length} apps from cache (age: ${Math.round((Date.now() - lastScanTime) / 60000)}min)`)
  } else {
    console.log('appScanner: No cache found, performing initial scan...')
  }

  if (appsUpdatedCallback) {
    try { appsUpdatedCallback(allApps) } catch (e) { console.error(e) }
  }

  backgroundSmartScan()
}

export async function forceRescan(): Promise<ApplicationInfo[]> {
  if (scanning) return allApps
  const apps = await performScan()
  allApps = apps
  lastScanTime = Date.now()

  const scanPaths = await discoverScanPaths()
  const dirs: CacheDirectory[] = []
  const chunks: string[][] = []
  for (let i = 0; i < scanPaths.length; i += MAX_CONCURRENT_SCANS) {
    chunks.push(scanPaths.slice(i, i + MAX_CONCURRENT_SCANS))
  }
  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (dir) => {
        const dirApps = await scanDirectory(dir)
        const mtime = await getDirectoryMtime(dir)
        return { path: dir, mtimeMs: mtime, apps: dirApps }
      })
    )
    dirs.push(...results)
  }
  await saveCache(dirs)

  if (appsUpdatedCallback) {
    try { appsUpdatedCallback(allApps) } catch (e) { console.error(e) }
  }
  return allApps
}

export function getAppsList(): ApplicationInfo[] {
  return allApps
}

export function searchApps(query: string, limit: number = 20): ApplicationInfo[] {
  if (!query.trim()) return allApps.slice(0, limit)
  const lower = query.toLowerCase()
  return allApps
    .filter((app) => app.name.toLowerCase().includes(lower))
    .slice(0, limit)
}
