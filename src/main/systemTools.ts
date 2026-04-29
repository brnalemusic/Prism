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
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
      path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
    ]

    const manualApps: any[] = []
    
    for (const dir of commonPaths) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            manualApps.push({ name: entry.name, path: path.join(dir, entry.name) })
          } else if (entry.name.endsWith('.lnk') || entry.name.endsWith('.exe')) {
            manualApps.push({ name: entry.name.replace(/\.(lnk|exe)$/i, ''), path: path.join(dir, entry.name) })
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

/**
 * Fetches and returns text content from a URL.
 */
export async function sawLinkFromUrl(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
    const resultBlocks = html.split(/<div[^>]*class="[^"]*result(?:__body|s_links| )[^"]*"[^>]*>/i).slice(1)

    for (const body of resultBlocks) {
      if (results.length >= 5) break

      const titleMatch = body.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/)
      let linkMatch = body.match(/href="([^"]*)"[^>]*class="[^"]*result__a[^"]*"/) ||
                        body.match(/class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"/) ||
                        body.match(/href="([^"]*)"/)

      let snippetMatch = body.match(/<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|p)>/i) ||
                           body.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/) ||
                           body.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/)

      // Structural fallback: if class-based matching fails, try to extract content between title and extras
      if (!snippetMatch) {
        const fallbackMatch = body.match(/<\/h2>([\s\S]*?)<div[^>]*class="[^"]*result__extras/i) ||
                              body.match(/<\/a>([\s\S]*?)<div[^>]*class="[^"]*result__extras/i)
        if (fallbackMatch) snippetMatch = fallbackMatch
      }

      if (titleMatch && linkMatch) {
        let rawLink = linkMatch[1]
        
        // Extract raw link from DuckDuckGo redirect if present (uddg parameter)
        try {
          const urlObj = new URL(rawLink.startsWith('//') ? `https:${rawLink}` : rawLink.startsWith('/') ? `https://duckduckgo.com${rawLink}` : rawLink)
          const uddg = urlObj.searchParams.get('uddg')
          if (uddg) {
            rawLink = decodeURIComponent(uddg)
          }
        } catch (e) {
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
export function getSystemToolsPrompt(modelKey: string, target: 'main' | 'subagent' | 'both' = 'main'): string {
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

  const parallelRule = target === 'main'
    ? '- Parallel: <run_subagents> (agents use Group Chat for async sync). Wait for all.'
    : "- Collaboration: Use 'send_group_message' and 'wait_for_updates' for Group Chat sync."

  return `Role: ${name} (${modelName}). Use <tool_call> XML (no md).
Context: ${date} | ${platform} | ${username} | Home: ${homeDir} | CWD: ${cwd}

Rules:
- Summarize tool results in user lang.
- [FORCE_SEARCH] -> web_search first.
- Math: Simple? Result only. Complex? LaTeX steps (no text), \boxed{} final. $$ block, $ inline.
- Nav: URL->open_browser_link | Search->saw_link_from_url | App->open_application | Query->direct.
- Deep Research: For complex topics, ALWAYS use 'saw_link_from_url' on the top 1-2 results from 'web_search' to provide in-depth, accurate answers. Only rely on snippets for extremely simple or factual queries (e.g., "who is X").
- Workflow: No meta-talk. Respond ONLY when done/stuck. Match user lang.
- Apps: If open_application fails, list_installed_applications or scan paths to find the real exe.
- Paths: Use EXACT paths. NO placeholders.
${parallelRule}
- Memory: Use <search_chat_history> for context/preferences. Use CSV keywords (e.g., "IRQL, erro, blue screen"). Search in user lang + English. Mix specific/general terms for best scoring.

Tools:
${toolsPrompt}`
}

/**
 * Returns a specialized system prompt for sub-agents.
 */
export function getSubagentSystemPrompt(modelKey: string, index: number, total: number): string {
  const basePrompt = getSystemToolsPrompt(modelKey, 'subagent')
  const otherAgents = Array.from({ length: total }, (_, i) => i).filter((i) => i !== index)

  return `${basePrompt}

[IDENTITY]: Agent #${index}.
[TEAM]: ${otherAgents.length > 0 ? otherAgents.map((i) => `Agent #${i}`).join(', ') : 'Solo'}.

[GROUP CHAT RULES]:
1. ASYNC COLLABORATION: Use 'send_group_message' to update the team. 
2. STAYING ALIVE: You are ONLY active as long as you use tools. If you send a message and want to wait for a reply, you MUST call 'wait_for_updates' in the same response, otherwise you will terminate immediately.
3. CONTEXT INJECTION: New messages from others appear as [UNREAD MESSAGES]. Read them to stay synced.
4. EFFICIENCY: Use 'wait_for_updates' to pause instead of polling or idle thinking.
5. TERMINATION: ALWAYS send a final message with status="done" or status="error" when your task is complete.
6. NO SUBAGENTS: You cannot spawn more agents. Focus on your assigned task.

[OUTPUT]: Your thoughts are private. Your FINAL RESPONSE should be a concise mission report for the Main Agent.`
}
