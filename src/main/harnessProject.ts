import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import type {
  EffectiveHarnessSettings,
  HarnessProjectConfig,
  HarnessProjectOverrides,
  HarnessSettings,
  HarnessToolName
} from '../shared/types'
import { DEFAULT_HARNESS_TOOLS, loadConfig, saveConfig } from './config'

const execFileAsync = promisify(execFile)
const PROJECT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export interface HarnessProjectResult {
  project: HarnessProjectConfig
  settings: HarnessSettings
}

function projectKey(rootPath: string): string {
  const normalized = path.resolve(rootPath).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function initializeGit(rootPath: string): Promise<void> {
  try {
    await fs.access(path.join(rootPath, '.git'))
    return
  } catch {
    // The selected project is not a Git repository yet.
  }
  await execFileAsync('git', ['init'], { cwd: rootPath, windowsHide: true })
}

async function registerProject(
  rootPath: string,
  displayName: string
): Promise<HarnessProjectResult> {
  const resolvedRoot = path.resolve(rootPath)
  await fs.mkdir(resolvedRoot, { recursive: true })
  const stats = await fs.stat(resolvedRoot)
  if (!stats.isDirectory()) throw new Error('The selected Harness project is not a directory.')
  await initializeGit(resolvedRoot)

  const config = loadConfig()
  const now = Date.now()
  const key = projectKey(resolvedRoot)
  const previous = config.harness.projects[key]
  const project: HarnessProjectConfig = {
    ...previous,
    rootPath: resolvedRoot,
    displayName: displayName.trim() || path.basename(resolvedRoot),
    createdAt: previous?.createdAt || now,
    updatedAt: now
  }
  const harness: HarnessSettings = {
    ...config.harness,
    lastProjectPath: resolvedRoot,
    projects: { ...config.harness.projects, [key]: project }
  }
  if (!saveConfig({ harness }, config)) throw new Error('Could not save the Harness project.')
  return { project, settings: harness }
}

export async function createHarnessProject(name: string): Promise<HarnessProjectResult> {
  const normalized = name.trim()
  if (!PROJECT_NAME_PATTERN.test(normalized) || WINDOWS_RESERVED_NAMES.test(normalized)) {
    throw new Error(
      'Use a project name with 1-80 letters, numbers, spaces, dots, underscores, or hyphens.'
    )
  }
  const config = loadConfig()
  const projectsRoot = path.resolve(config.harness.projectsRoot)
  await fs.mkdir(projectsRoot, { recursive: true })
  const projectPath = path.resolve(projectsRoot, normalized)
  if (path.dirname(projectPath) !== projectsRoot) throw new Error('Invalid Harness project name.')
  try {
    const entries = await fs.readdir(projectPath)
    if (entries.length > 0) throw new Error('A non-empty project with this name already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return registerProject(projectPath, normalized)
}

export async function openHarnessProject(rootPath: string): Promise<HarnessProjectResult> {
  if (!rootPath.trim()) throw new Error('Choose a project directory.')
  return registerProject(rootPath, path.basename(path.resolve(rootPath)))
}

/**
 * The sole persisted activation path for registered Harness projects.
 * It keeps every renderer surface anchored to the same recent project.
 */
export function activateHarnessProject(rootPath: string): HarnessProjectResult {
  const config = loadConfig()
  const resolvedRoot = path.resolve(rootPath)
  const key = projectKey(resolvedRoot)
  const previous = config.harness.projects[key]
  if (!previous) throw new Error('Harness project is not registered.')

  const project: HarnessProjectConfig = {
    ...previous,
    rootPath: resolvedRoot,
    updatedAt: Date.now()
  }
  const harness: HarnessSettings = {
    ...config.harness,
    lastProjectPath: resolvedRoot,
    projects: { ...config.harness.projects, [key]: project }
  }
  if (!saveConfig({ harness }, config)) throw new Error('Could not activate the Harness project.')
  return { project, settings: harness }
}

export function updateHarnessProject(
  rootPath: string,
  overrides: HarnessProjectOverrides
): HarnessProjectResult {
  const config = loadConfig()
  const resolvedRoot = path.resolve(rootPath)
  const key = projectKey(resolvedRoot)
  const previous = config.harness.projects[key]
  if (!previous) throw new Error('Harness project is not registered.')
  const project: HarnessProjectConfig = {
    ...previous,
    ...overrides,
    rootPath: resolvedRoot,
    displayName:
      overrides.displayName !== undefined && overrides.displayName.trim()
        ? overrides.displayName.trim()
        : previous.displayName,
    userProjectInstructions: overrides.userProjectInstructions?.slice(0, 5000),
    updatedAt: Date.now()
  }
  const harness = {
    ...config.harness,
    projects: { ...config.harness.projects, [key]: project }
  }
  if (!saveConfig({ harness }, config)) throw new Error('Could not save project overrides.')
  return { project, settings: harness }
}

export function deleteHarnessProject(rootPath: string): HarnessSettings {
  const config = loadConfig()
  const resolvedRoot = path.resolve(rootPath)
  const key = projectKey(resolvedRoot)
  const updatedProjects = { ...config.harness.projects }
  delete updatedProjects[key]

  const remainingKeys = Object.keys(updatedProjects)
  let lastProjectPath = config.harness.lastProjectPath
  if (lastProjectPath && projectKey(lastProjectPath) === key) {
    lastProjectPath = remainingKeys.length > 0 ? updatedProjects[remainingKeys[0]].rootPath : undefined
  }

  let defaultProjectPath = config.harness.defaultProjectPath
  if (defaultProjectPath && projectKey(defaultProjectPath) === key) {
    defaultProjectPath = undefined
  }

  const harness: HarnessSettings = {
    ...config.harness,
    lastProjectPath,
    defaultProjectPath,
    projects: updatedProjects
  }
  if (!saveConfig({ harness }, config)) throw new Error('Could not delete Harness project.')
  return harness
}

export async function checkHarnessProjectFolder(
  rootPath: string
): Promise<{ exists: boolean; isDirectory: boolean; isGit: boolean }> {
  try {
    const resolvedRoot = path.resolve(rootPath)
    const stats = await fs.stat(resolvedRoot)
    if (!stats.isDirectory()) {
      return { exists: true, isDirectory: false, isGit: false }
    }
    let isGit = false
    try {
      const gitStats = await fs.stat(path.join(resolvedRoot, '.git'))
      isGit = gitStats.isDirectory() || gitStats.isFile()
    } catch {
      isGit = false
    }
    return { exists: true, isDirectory: true, isGit }
  } catch {
    return { exists: false, isDirectory: false, isGit: false }
  }
}

export async function checkAllHarnessProjects(): Promise<
  Record<string, { exists: boolean; isDirectory: boolean; isGit: boolean }>
> {
  const config = loadConfig()
  const results: Record<string, { exists: boolean; isDirectory: boolean; isGit: boolean }> = {}
  for (const [key, project] of Object.entries(config.harness.projects)) {
    results[key] = await checkHarnessProjectFolder(project.rootPath)
  }
  return results
}

export async function recreateHarnessProjectFolder(rootPath: string): Promise<HarnessProjectResult> {
  const config = loadConfig()
  const resolvedRoot = path.resolve(rootPath)
  const key = projectKey(resolvedRoot)
  const existing = config.harness.projects[key]
  const displayName = existing?.displayName || path.basename(resolvedRoot)
  return registerProject(resolvedRoot, displayName)
}

export function resolveHarnessStartupProject(
  customSettings?: HarnessSettings
): HarnessProjectConfig | null {
  const settings = customSettings || loadConfig().harness
  if (settings.startupProjectMode === 'prompt') {
    return null
  }
  if (settings.startupProjectMode === 'default_project' && settings.defaultProjectPath) {
    const defaultProject = getHarnessProject(settings.defaultProjectPath)
    if (defaultProject) return defaultProject
  }
  if (settings.lastProjectPath) {
    return getHarnessProject(settings.lastProjectPath)
  }
  const remaining = Object.values(settings.projects)
  return remaining.length > 0 ? remaining[0] : null
}

export function getHarnessProject(rootPath?: string): HarnessProjectConfig | null {
  const settings = loadConfig().harness
  const requested = rootPath || settings.lastProjectPath
  if (!requested) return null
  return settings.projects[projectKey(requested)] || null
}

export function getEffectiveHarnessSettings(rootPath?: string): EffectiveHarnessSettings | null {
  const settings = loadConfig().harness
  const project = getHarnessProject(rootPath)
  if (!project) return null
  const enabledTools = (project.enabledTools || settings.enabledTools).filter((tool) =>
    DEFAULT_HARNESS_TOOLS.includes(tool as HarnessToolName)
  )
  return {
    toolManifestVersion: settings.toolManifestVersion,
    projectsRoot: settings.projectsRoot,
    defaultPermissionMode: project.permissionMode || settings.defaultPermissionMode,
    defaultMaxRounds: project.maxRounds || settings.defaultMaxRounds,
    enabledTools,
    maxReadLines: project.maxReadLines || settings.maxReadLines,
    maxReadCharacters: project.maxReadCharacters || settings.maxReadCharacters,
    maxTerminalOutputCharacters:
      project.maxTerminalOutputCharacters || settings.maxTerminalOutputCharacters,
    maxContextCharacters: project.maxContextCharacters || settings.maxContextCharacters,
    webPageCount: project.webPageCount || settings.webPageCount,
    showSteps: project.showSteps ?? settings.showSteps,
    showThinking: project.showThinking ?? settings.showThinking,
    animateActivity: project.animateActivity ?? settings.animateActivity,
    reduceMotion: project.reduceMotion ?? settings.reduceMotion,
    tabProjectMode: settings.tabProjectMode,
    startupProjectMode: settings.startupProjectMode,
    userGlobalInstructions: settings.userGlobalInstructions,
    yoloAcknowledged: settings.yoloAcknowledged,
    project
  }
}

export function getHarnessProjectKey(rootPath: string): string {
  return projectKey(rootPath)
}
