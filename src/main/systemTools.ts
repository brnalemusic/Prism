import { exec } from 'child_process'
import { shell } from 'electron'
import { getInstalledApps } from 'get-installed-apps'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { toolsManifest } from './toolsManifest'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

/**
 * COMPUTER USE: Create a new file with content.
 */
export async function computerCreateFile(
  filePath: string,
  content: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const fullPath = path.resolve(filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, { encoding: 'utf8', signal })
    return `File created successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error creating file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Create a new directory.
 */
export async function computerCreateDirectory(dirPath: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPath = path.resolve(dirPath)
    await (fs.mkdir as any)(fullPath, { recursive: true, signal })
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
    const fullPath = path.resolve(filePath)
    await (fs.unlink as any)(fullPath, { signal })
    return `File removed successfully: ${fullPath}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return `Error removing file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Remove a directory.
 */
export async function computerRemoveDirectory(dirPath: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPath = path.resolve(dirPath)
    await (fs.rm as any)(fullPath, { recursive: true, force: true, signal })
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
    const fullPath = path.resolve(filePath)
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
    const fullPath = path.resolve(filePath)
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

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * COMPUTER USE: List directory contents.
 */
export async function computerListDirectory(dirPath: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPath = path.resolve(dirPath)
    const files = await (fs.readdir as any)(fullPath, { withFileTypes: true, signal })
    const list = files.map((f: any) => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`)
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
    const fullPath = path.resolve(filePath)
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
 * Lists installed applications on the system.
 */
export async function listApplications(): Promise<string> {
  try {
    const apps = (await getInstalledApps()) as AppInfo[]
    // Limits the amount of information to not overflow the AI context
    const simplifiedApps = apps
      .map((app) => ({
        name: app.appName || app.DisplayName,
        version: app.appVersion || app.DisplayVersion,
        path: app.InstallLocation || app.path
      }))
      .slice(0, 50)

    return JSON.stringify(simplifiedApps, null, 2)
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

/**
 * Fetches and returns text content from a URL.
 */
export async function sawLinkFromUrl(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })

    if (!response.ok) {
      return `Error: Website returned status ${response.status}`
    }

    const html = await response.text()
    // Simple cleaning: remove scripts, styles and HTML tags
    const text = stripHtml(html)
      .replace(/\s+/g, ' ')
      .trim()

    await sleep(1000)

    const MAX_CONTENT = 20000
    return text.length > MAX_CONTENT ? text.substring(0, MAX_CONTENT) + '... (truncated)' : text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : String(error)
    return `Error fetching URL: ${message}`
  }
}

/**
 * Performs a web search using DuckDuckGo HTML version.
 */
export async function webSearch(query: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    )

    if (!response.ok) {
      return `Error: DuckDuckGo returned status ${response.status}`
    }

    const html = await response.text()

    // Basic regex to extract results from DuckDuckGo HTML
    // Looking for results in <div class="result__body">...</div>
    const results: { title: string; link: string; snippet: string }[] = []
    const resultRegex = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*clear[^"]*"[^>]*>/g
    let match

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      const body = match[1]

      const titleMatch = body.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/)
      const linkMatch = body.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*result__a[^"]*"/) || 
                        body.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"/)

      const snippetMatch = body.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/)

      if (titleMatch && linkMatch) {
        results.push({
          title: stripHtml(titleMatch[1]).trim(),
          link: linkMatch[1],
          snippet: snippetMatch ? stripHtml(snippetMatch[1]).trim() : ''
        })
      }
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
  }
}

/**
 * Returns the system prompt configured with the correct model identity.
 */
export function getSystemToolsPrompt(modelKey: string): string {
  const name = 'Prism AI'
  let modelName = 'Prism 1 Fast'

  if (modelKey === 'prism-2') {
    modelName = 'Prism 2'
  } else if (modelKey === 'prism-2.5') {
    modelName = 'Prism 2.5'
  } else if (modelKey === 'prism-3') {
    modelName = 'Prism 3'
  } else if (modelKey === 'prism-3.1') {
    modelName = 'Prism 3.1'
  }

  const toolsPrompt = toolsManifest
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
  const date = new Date().toLocaleString()

  return `Role: ${name} (${modelName}). Use <tool_call> XML (no md).
Environment Context:
- Date/Time: ${date}
- Platform: ${platform}
- Current User: ${username}
- Home Directory: ${homeDir}
- Working Directory: ${cwd}

Rules:
- Summarize hidden tool results in user lang.
- [FORCE_SEARCH] -> web_search first.
- Math: Simple? Result only. Complex? LaTeX steps (no text). \boxed{} final. $$ block, $ inline.
- Nav: URL->open_browser_link | Search->saw_link_from_url | App->open_application | Query->direct.
- Workflow: Sequence tools, retry on fail. No meta-talk. Respond ONLY when finished/stuck. Match lang.
- Path Integrity: Use EXACT paths from Environment Context. NEVER use placeholders like 'YourUsername'.
- Parallel: Use <run_subagents>.
  - Sub-agents can't use run_subagents.
  - Radio Bus: agent_message(to, content), agent_wait(target, sec).
  - Wait for ALL to finish.
  - Define team protocol & ask for detailed outputs.

Tools:
${toolsPrompt}`
}
