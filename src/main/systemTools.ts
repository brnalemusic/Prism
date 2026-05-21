import { exec } from 'child_process'
import { shell, BrowserWindow } from 'electron'
import { getInstalledApps } from 'get-installed-apps'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { toolsManifest } from './toolsManifest'

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

function parseToolBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return /^(true|1|yes|y|sim)$/i.test(value.trim())
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('AbortError')
  error.name = 'AbortError'
  throw error
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
 * Lists installed applications on the system, including manual scans of common Windows paths.
 */
export async function listApplications(): Promise<string> {
  try {
    const apps = (await getInstalledApps()) as AppInfo[]
    const simplifiedApps = apps.map((app) => ({
      name: app.appName || app.DisplayName,
      version: app.appVersion || app.DisplayVersion,
      path: app.InstallLocation || app.path
    }))

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

    const manualApps: { name: string; path: string }[] = []

    for (const dir of commonPaths) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            manualApps.push({ name: entry.name, path: path.join(dir, entry.name) })
          } else if (entry.name.endsWith('.lnk') || entry.name.endsWith('.exe')) {
            manualApps.push({
              name: entry.name.replace(/\.(lnk|exe)$/i, ''),
              path: path.join(dir, entry.name)
            })
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    }

    // Merge and deduplicate (by name)
    const allApps = [...simplifiedApps, ...manualApps]
    const seenNames = new Set()
    const finalApps = allApps
      .filter((app) => {
        if (!app.name || seenNames.has(app.name.toLowerCase())) return false
        seenNames.add(app.name.toLowerCase())
        return true
      })
      .slice(0, 100) // Slightly higher limit than before

    return JSON.stringify(finalApps, null, 2)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error listing applications: ${message}`
  }
}

/**
 * Opens an application given its path.
 */
export async function openApplication(appPath: string): Promise<string> {
  try {
    const error = await shell.openPath(appPath)
    if (error) {
      return `Error opening application: ${error}`
    }
    return `Application opened successfully: ${appPath}`
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
    await shell.openExternal(url)
    return `Link opened successfully in browser: ${url}`
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
        reject(new Error('AbortError'))
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
    const response = await fetch(url, {
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
  target: 'main' | 'subagent' | 'both' = 'main'
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
    .filter((t) => !t.target || t.target === 'both' || t.target === target)
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
  const date = new Date().toLocaleString('pt-BR', {
    timeZoneName: 'short',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const parallelRule =
    target === 'main'
      ? '- Parallel: You can run multiple <tool_call> blocks in a single response to execute them concurrently. Use <run_subagents> to delegate.'
      : "- Collaboration: Use 'send_group_message' and 'wait_for_updates' for Group Chat sync. You can output multiple tool calls in parallel."
  const humanUserRule =
    target === 'subagent'
      ? '- Human user messages: Any group message from "User (human operator)" is a direct message from the Prism user, not another agent. Treat it as human input and respond through send_group_message when relevant.'
      : ''

  return `# Identity
Role: ${name} (${modelName}). You are a concise, tool-capable desktop assistant.
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd}

# Operating Rules
- Match the user's language and intent. Be direct, factual, and brief by default; expand only when the task requires it.
- Prefer action over commentary. Send user-facing text only when done or blocked, asking at most one necessary question.
- Treat the provided date/context as authoritative for time-sensitive tasks; search when facts may have changed.
- Do not expose hidden reasoning. Give conclusions, key evidence, and next steps.
- Never invent tool results, files, apps, links, paths, or citations.

# Research
- [FORCE_SEARCH] means web_search first.
- For research requests, run varied queries, read 3-5 relevant pages with saw_link_from_url, cross-check claims, and state uncertainty or missing evidence.
- Do not answer from snippets alone unless the user only asked for quick search results.

# Task Method
- Clarify success criteria internally, then plan -> act -> verify.
- For code/files, inspect before editing, keep changes scoped, preserve user work, and verify with the lightest useful command.
- Math: simple -> result only. Complex -> concise LaTeX and \\boxed{final}.
- Navigation: URL -> open_browser_link | Search result/page -> saw_link_from_url | App -> open_application | Unknown app -> list_installed_applications or scan.

# Tool Protocol
- Tool calls must be raw <tool_call> XML, one or more per response when useful. Final user text may use Markdown.
- Use only listed tool names and schemas; never invent names.
- Paths must be complete absolute paths unless a tool explicitly accepts otherwise. No placeholders or blanks.
- File map: read=computer_use_read_file; create=computer_use_create_file; save=computer_use_save_file; edit=computer_use_edit_file; append=computer_use_append_file; remove file=computer_use_remove_file; remove dir=computer_use_remove_directory; copy=computer_use_copy_file; move=computer_use_move_file; info=computer_use_get_file_info; list=computer_use_list_directory.
- Wrap multiline, code, or XML-like values in <![CDATA[...]]>.
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
1. ASYNC COLLABORATION: Use 'send_group_message' to update the Master Coordinator and team.
2. STAYING ALIVE: You are ONLY active as long as you use tools. If you want to wait for others or the Master Coordinator, you MUST call 'wait_for_updates' in the same response, otherwise you will terminate immediately.
3. MANDATORY COMMUNICATION: Communication is ABSOLUTELY MANDATORY. You must report your plan to the group chat before running any computer or search tools, and report the summaries of your tool results.
4. CONTEXT INJECTION: New messages from others appear as [UNREAD MESSAGES]. Read them to stay synced.
5. EFFICIENCY: Use 'wait_for_updates' to pause instead of polling or idle thinking.
6. TERMINATION: When your assigned task is complete (or failed), update the group chat. Note that the swarm will be terminated when the Master Coordinator determines it is done.
7. NO SUBAGENTS: You cannot spawn more agents. Focus on your assigned task.

[OUTPUT]: Your thoughts are private. Your FINAL RESPONSE should be a concise mission report for the Main Agent.`
}
