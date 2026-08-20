import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import { app } from 'electron'
import { loadConfig } from './config'

export interface SkillInfo {
  filename: string
  title: string
  description: string
  unlockedTools: string[]
}

// Session map: chatId -> Set of unlocked tool names
const unlockedToolsBySession = new Map<string, Set<string>>()

export function isSkillFileDisabled(filename: string, disabledSkills?: string[]): boolean {
  try {
    const disabled = disabledSkills ?? (loadConfig().disabledSkills || [])
    const lower = filename.toLowerCase()
    if (disabled.includes('pptx') && lower.includes('pptx')) return true
    if (disabled.includes('pdf') && lower.includes('pdf')) return true
    if (
      disabled.includes('browser') &&
      (lower.includes('browser') || lower.includes('integrated_browser'))
    )
      return true
  } catch {}
  return false
}

/**
  Resolves the path to the skills directory.
  Works seamlessly in both Dev mode (resources/docs/skills) and Packaged Production mode (process.resourcesPath/docs/skills).
 */
export function getSkillsPath(): string {
  const candidateDocsPaths: string[] = []

  if (process.resourcesPath) {
    candidateDocsPaths.push(
      path.join(process.resourcesPath, 'docs'),
      path.join(process.resourcesPath, 'resources', 'docs')
    )
  }

  try {
    if (app && typeof app.getAppPath === 'function') {
      candidateDocsPaths.push(path.join(app.getAppPath(), 'resources', 'docs'))
    }
  } catch {
    // App not initialized yet in some test contexts
  }

  candidateDocsPaths.push(
    path.join(__dirname, '../../resources/docs'),
    path.join(process.cwd(), 'resources', 'docs')
  )

  for (const candidateDocs of candidateDocsPaths) {
    const candidateSkills = path.join(candidateDocs, 'skills')
    if (fssync.existsSync(candidateSkills)) {
      return candidateSkills
    }
  }

  // Fallback default
  return !app || !app.isPackaged
    ? path.join(__dirname, '../../resources/docs/skills')
    : path.join(process.resourcesPath || process.cwd(), 'docs', 'skills')
}

/**
 * Scans the skills directory dynamically and returns metadata for all available skill files (.md).
 */
export async function listSkills(disabledSkills?: string[]): Promise<SkillInfo[]> {
  const skillsPath = getSkillsPath()
  try {
    const files = await fs.readdir(skillsPath)
    const mdFiles = files
      .filter((f) => f.endsWith('.md') && !isSkillFileDisabled(f, disabledSkills))
      .sort()

    const skills: SkillInfo[] = []
    for (const filename of mdFiles) {
      const filePath = path.join(skillsPath, filename)
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const parsed = parseSkillMetadata(filename, content)
        skills.push(parsed)
      } catch {
        skills.push({
          filename,
          title: filename,
          description: `Skill documentation file: ${filename}`,
          unlockedTools: []
        })
      }
    }
    return skills
  } catch (err) {
    console.error('Failed to scan skills directory:', err)
    return []
  }
}

/**
 * Parses frontmatter or markdown header to extract title, description, and unlocked tools.
 */
function parseSkillMetadata(filename: string, content: string): SkillInfo {
  let title = filename
  let description = `Skill documentation: ${filename}`
  const unlockedTools: string[] = []

  // Check frontmatter
  if (content.startsWith('---')) {
    const endFrontmatter = content.indexOf('---', 3)
    if (endFrontmatter !== -1) {
      const frontmatter = content.slice(3, endFrontmatter)
      const lines = frontmatter.split('\n')
      let inUnlockedTools = false

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('title:')) {
          title = trimmed.replace('title:', '').trim()
        } else if (trimmed.startsWith('description:')) {
          description = trimmed.replace('description:', '').trim()
        } else if (trimmed.startsWith('unlocked_tools:')) {
          inUnlockedTools = true
        } else if (inUnlockedTools && trimmed.startsWith('-')) {
          const tool = trimmed.replace('-', '').trim()
          if (tool) unlockedTools.push(tool)
        } else if (inUnlockedTools && trimmed && !trimmed.startsWith('-')) {
          inUnlockedTools = false
        }
      }
    }
  }

  // Fallback title from # header if title was not in frontmatter
  if (title === filename) {
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) {
      title = h1Match[1].trim()
    }
  }

  // Infer default tools based on filename if omitted in frontmatter
  if (unlockedTools.length === 0) {
    if (filename.includes('pdf')) {
      unlockedTools.push('write_pdf', 'edit_pdf')
    } else if (filename.includes('pptx')) {
      unlockedTools.push('write_pptx', 'edit_pptx')
    }
  }

  return { filename, title, description, unlockedTools }
}

/**
 * Synchronous version of listSkills for synchronous prompt generation.
 */
export function listSkillsSync(disabledSkills?: string[]): SkillInfo[] {
  const skillsPath = getSkillsPath()
  try {
    if (!fssync.existsSync(skillsPath)) return []
    const files = fssync.readdirSync(skillsPath)
    const mdFiles = files
      .filter((f) => f.endsWith('.md') && !isSkillFileDisabled(f, disabledSkills))
      .sort()

    const skills: SkillInfo[] = []
    for (const filename of mdFiles) {
      const filePath = path.join(skillsPath, filename)
      try {
        const content = fssync.readFileSync(filePath, 'utf-8')
        const parsed = parseSkillMetadata(filename, content)
        skills.push(parsed)
      } catch {
        skills.push({
          filename,
          title: filename,
          description: `Skill documentation file: ${filename}`,
          unlockedTools: []
        })
      }
    }
    return skills
  } catch (err) {
    console.error('Failed to scan skills directory (sync):', err)
    return []
  }
}

/**
 * Synchronously generates the Markdown snippet to inject dynamically into the System Prompt.
 */
export function getSkillsSystemPromptSnippetSync(disabledSkills?: string[]): string {
  const skills = listSkillsSync(disabledSkills)
  if (skills.length === 0) return ''

  const lines: string[] = [
    '# Available Skills',
    'You have access to specialized skills. When requested to perform tasks covered by an available skill, you MUST first call the `read_skill` tool with the corresponding skill filename to learn the required layout, best practices, and execution details:'
  ]

  for (const s of skills) {
    lines.push(`- \`${s.filename}\`: ${s.title} - ${s.description}`)
  }

  return lines.join('\n')
}

/**
 * Generates the Markdown snippet to inject dynamically into the System Prompt.
 */
export async function getSkillsSystemPromptSnippet(disabledSkills?: string[]): Promise<string> {
  return getSkillsSystemPromptSnippetSync(disabledSkills)
}

/**
 * Generates negative prompt constraints for disabled skills to strictly prevent the AI from generating restricted artifacts or using forbidden skills.
 */
export function getDisabledSkillsPromptSnippetSync(disabledSkills?: string[]): string {
  let effectiveDisabled: string[] = []
  try {
    effectiveDisabled = disabledSkills ?? (loadConfig().disabledSkills || [])
  } catch {
    effectiveDisabled = disabledSkills || []
  }
  if (!effectiveDisabled || effectiveDisabled.length === 0) return ''

  const rules: string[] = []

  if (effectiveDisabled.includes('pdf')) {
    rules.push(
      '- **PDF Generation & Artifacts (DISABLED):** The user has disabled the PDF Document skill for this conversation. You MUST NOT compile, create, edit, or generate PDF files, PDF documents, or PDF artifacts through ANY tool, function, script, terminal command, or file writer (including `write_pdf`, `edit_pdf`, `computer_use_create_file`, `computer_use_save_file`, Python libraries, or CLI tools). If the user requests to generate, create, convert, or export a PDF, you MUST politely refuse and inform them that the PDF Skill is currently disabled in the conversation skills settings.'
    )
  }

  if (effectiveDisabled.includes('pptx')) {
    rules.push(
      '- **PowerPoint (PPTX) Presentations (DISABLED):** The user has disabled the PowerPoint Presentation skill for this conversation. You MUST NOT compile, create, edit, or generate PowerPoint (.pptx/.ppt) presentations, slides, or slide artifacts through ANY tool, function, script, terminal command, or file writer (including `write_pptx`, `edit_pptx`, `computer_use_create_file`, `computer_use_save_file`, or CLI tools). If the user requests slides or a PowerPoint presentation, you MUST politely refuse and inform them that the PowerPoint Skill is currently disabled in the conversation skills settings.'
    )
  }

  if (effectiveDisabled.includes('browser')) {
    rules.push(
      '- **Integrated AI Browser & Web Automation (DISABLED):** The user has disabled the Browser Use skill for this conversation. You MUST NOT use integrated browser automation tools (open_browser, browser_*, web_script, detailed_dom_page). Any URLs or links must only be opened in the OS system browser via `open_browser_link`.'
    )
  }

  if (rules.length === 0) return ''

  return ['# Disabled Skills & Restrictions (STRICT POLICY)', ...rules].join('\n')
}

/**
 * Reads a skill file and unlocks associated tools for the current session/chatId.
 */
export async function readSkill(
  skillName: string,
  chatId?: string,
  disabledSkills?: string[]
): Promise<{ success: boolean; content: string; unlockedTools: string[] }> {
  const skillsPath = getSkillsPath()
  const normalizedFilename = path.basename(skillName)

  if (!normalizedFilename.endsWith('.md')) {
    return {
      success: false,
      content: `Error: Invalid skill filename "${skillName}". Skill files must end with .md.`,
      unlockedTools: []
    }
  }

  if (isSkillFileDisabled(normalizedFilename, disabledSkills)) {
    return {
      success: false,
      content: `Error: The skill "${skillName}" is currently disabled for this conversation.`,
      unlockedTools: []
    }
  }

  const filePath = path.join(skillsPath, normalizedFilename)

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const metadata = parseSkillMetadata(normalizedFilename, content)

    // Unlock tools for session
    const sessionKey = chatId || 'default'
    if (!unlockedToolsBySession.has(sessionKey)) {
      unlockedToolsBySession.set(sessionKey, new Set<string>())
    }
    const sessionSet = unlockedToolsBySession.get(sessionKey)!
    for (const tool of metadata.unlockedTools) {
      sessionSet.add(tool)
    }

    return {
      success: true,
      content,
      unlockedTools: metadata.unlockedTools
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return {
        success: false,
        content: `Error: Skill file "${skillName}" not found in internal skills library.`,
        unlockedTools: []
      }
    }
    return {
      success: false,
      content: `Error reading skill "${skillName}": ${err.message}`,
      unlockedTools: []
    }
  }
}

/**
 * Checks if a specific tool is unlocked for the session.
 */
export function isToolUnlockedForSession(toolName: string, chatId?: string): boolean {
  const sessionKey = chatId || 'default'
  const sessionSet = unlockedToolsBySession.get(sessionKey)
  if (sessionSet && sessionSet.has(toolName)) {
    return true
  }
  return false
}

/**
 * Returns all unlocked tools for a session.
 */
export function getUnlockedToolsForSession(chatId?: string): Set<string> {
  const sessionKey = chatId || 'default'
  return unlockedToolsBySession.get(sessionKey) || new Set<string>()
}
