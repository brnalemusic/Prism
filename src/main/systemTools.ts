import { exec } from 'child_process'
import { shell } from 'electron'
import { getInstalledApps } from 'get-installed-apps'
import * as fs from 'fs/promises'
import * as path from 'path'
import { toolsManifest } from './toolsManifest'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Executes a terminal command and returns the output.
 */
export async function runTerminalCommand(command: string): Promise<string> {
  const isWindows = process.platform === 'win32'
  const normalizedCommand = isWindows ? `chcp 65001 > nul & ${command}` : command

  return new Promise((resolve) => {    exec(normalizedCommand, (error, stdout, stderr) => {
      if (error) {
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
export async function computerCreateFile(filePath: string, content: string): Promise<string> {
  try {
    const fullPath = path.resolve(filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf8')
    return `File created successfully: ${fullPath}`
  } catch (error) {
    return `Error creating file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Create a new directory.
 */
export async function computerCreateDirectory(dirPath: string): Promise<string> {
  try {
    const fullPath = path.resolve(dirPath)
    await fs.mkdir(fullPath, { recursive: true })
    return `Directory created successfully: ${fullPath}`
  } catch (error) {
    return `Error creating directory: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Remove a file.
 */
export async function computerRemoveFile(filePath: string): Promise<string> {
  try {
    const fullPath = path.resolve(filePath)
    await fs.unlink(fullPath)
    return `File removed successfully: ${fullPath}`
  } catch (error) {
    return `Error removing file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Remove a directory.
 */
export async function computerRemoveDirectory(dirPath: string): Promise<string> {
  try {
    const fullPath = path.resolve(dirPath)
    await fs.rm(fullPath, { recursive: true, force: true })
    return `Directory removed successfully: ${fullPath}`
  } catch (error) {
    return `Error removing directory: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Save/Overwrite a file.
 */
export async function computerSaveFile(filePath: string, content: string): Promise<string> {
  try {
    const fullPath = path.resolve(filePath)
    await fs.writeFile(fullPath, content, 'utf8')
    return `File saved successfully: ${fullPath}`
  } catch (error) {
    return `Error saving file: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Replace text in a file.
 */
export async function computerReplaceInFile(
  filePath: string,
  oldText: string,
  newText: string
): Promise<string> {
  try {
    const fullPath = path.resolve(filePath)
    const content = await fs.readFile(fullPath, 'utf8')
    if (!content.includes(oldText)) {
      return `Error: Text to replace not found in file.`
    }
    const updatedContent = content.replace(new RegExp(escapeRegExp(oldText), 'g'), newText)
    await fs.writeFile(fullPath, updatedContent, 'utf8')
    return `Text replaced successfully in: ${fullPath}`
  } catch (error) {
    return `Error replacing text: ${error instanceof Error ? error.message : String(error)}`
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * COMPUTER USE: List directory contents.
 */
export async function computerListDirectory(dirPath: string): Promise<string> {
  try {
    const fullPath = path.resolve(dirPath)
    const files = await fs.readdir(fullPath, { withFileTypes: true })
    const list = files.map((f) => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`)
    return list.join('\n') || 'Directory is empty.'
  } catch (error) {
    return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * COMPUTER USE: Read file content.
 */
export async function computerReadFile(filePath: string): Promise<string> {
  try {
    const fullPath = path.resolve(filePath)
    const content = await fs.readFile(fullPath, 'utf8')
    return content
  } catch (error) {
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
export async function sawLinkFromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
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
    const message = error instanceof Error ? error.message : String(error)
    return `Error fetching URL: ${message}`
  }
}

/**
 * Performs a web search using DuckDuckGo HTML version.
 */
export async function webSearch(query: string): Promise<string> {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
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
    const message = error instanceof Error ? error.message : String(error)
    return `Error performing web search: ${message}`
  }
}

/**
 * Returns the system prompt configured with the correct model identity.
 */
export function getSystemToolsPrompt(modelKey: string): string {
  const name = 'Prism AI'
  let model = 'Prism Compute Execution'
  let technical = 'pce-1-fast'
  let modelName = 'Prism 1 Fast'

  if (modelKey === 'gemma-3-12b-it') {
    technical = 'pce-1.1-fast-mini'
    modelName = 'Prism 1.1 Think Mini'
  } else if (modelKey === 'gemma-3-27b-it') {
    technical = 'pce-1.1-fast'
    modelName = 'Prism 1.1 Fast'
  } else if (modelKey === 'gemini-3.1-flash-lite-preview') {
    technical = 'pce-1.5-fast'
    modelName = 'Prism 1.5 Fast'
  } else if (modelKey === 'gemma-4-26b-a4b-it') {
    technical = 'pce-1.5-think'
    modelName = 'Prism 1.5 Think'
  } else if (modelKey === 'gemma-4-31b-it') {
    model = 'Prism Compute Execution .5'
    technical = 'pce-2-think'
    modelName = 'Prism 2 Think'
  }

  const toolsPrompt = toolsManifest
    .map((tool, index) => {
      const params = Object.entries(tool.parameters)
        .map(([key, desc]) => `     - ${key}: ${desc}`)
        .join('\n')
      return `${index + 1}. ${tool.name}: ${tool.description}\n   Usage:\n   ${tool.usage}\n${params ? `   Parameters:\n${params}` : ''}`
    })
    .join('\n\n')

  return `
  You are ${name}.
  Model: ${model}
  Technical: ${technical}
  Model Name: ${modelName}

  You are an AI with access to the user's computer. If you need to interact with the system (run commands, list/open apps, search the web, manage files), YOU MUST return EXACTLY an XML block with the desired tool and its arguments.

  CRITICAL RULES:
  1. NEVER use triple backticks (\`\`\`) or any code block formatting. Write the <tool_call> tags directly in the plain text.
  2. DO NOT write anything else besides the XML in your response if you choose to use a tool. Extra text or formatting will cause a system error and visual bugs.
  3. If you are responding normally to the user, ignore the tags.
  4. IMPORTANT: The user DOES NOT see the technical result of the tools automatically. After receiving the result from the system, you MUST summarize or list the relevant information for the user in your final response. Respond in the same language used by the user.
  5. If the user message contains "[FORCE_SEARCH]", you MUST use the \`web_search\` tool to find information related to the query BEFORE providing any final answer.

  AVAILABLE TOOLS:
  
${toolsPrompt}

  ACTION-ORIENTED MODE:
  - Be extremely confident and direct.
  - If the user sends a LINK (e.g., "https://...", "www...", or any clear URL), IMMEDIATELY use the \`open_browser_link\` tool. Do not ask "should I search or open?", just OPEN IT.
  - If you perform a \`web_search\` and find a relevant link, IMMEDIATELY use the \`saw_link_from_url\` tool to explore its content before providing a final answer.
  - QUALITY CHECK: After exploring a page with \`saw_link_from_url\`, evaluate the content quality. If the page is a login screen, shows an error, or lacks useful information compared to your goal, do NOT settle for it. Use \`web_search\` again or choose another link from the initial search results to find better information. If you have exhausted relevant options without finding useful information, inform the user that you could not find a suitable source.
  - If the user sends a single word or short phrase that looks like an application name (e.g., "Notepad++", "Chrome", "Calc"), IMMEDIATELY use a tool to try and open it. Do not ask for confirmation.
  - If the query is simple (e.g., "4+4", "What time is it?"), respond with ONLY the answer. No conversational filler or polite phrasing.
  - GREETINGS & CONVERSATION: Normal human greetings (e.g., "Oi", "Hello", "How are you?") and general conversation are valid. Respond naturally and politely to these, but stay ready to switch back to action mode as soon as a task is requested.
  - Simple request = Simple, direct response.
  - Complex request = Detailed response or multi-step execution.
  - NEVER be afraid to take action. If the user's intent is likely a command, treat it as one.

  EFFICIENCY GUIDELINES:
  - You can execute multiple tools in sequence until the user's final goal is reached.
  - If a tool fails or returns an error, RETRY in a different way IMMEDIATELY, without explaining the error to the user or asking for permission, unless it is something you cannot resolve on your own.
  - Do not explain each step or each tool executed between calls. Just execute.
  - Only send a final message to the user when the task is completed or if there is a real impediment.
  - Always match the user's language for the final response.
`
}
