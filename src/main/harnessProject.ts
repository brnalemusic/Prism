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
    displayName: previous.displayName,
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
    userGlobalInstructions: settings.userGlobalInstructions,
    yoloAcknowledged: settings.yoloAcknowledged,
    project
  }
}

export function getHarnessProjectKey(rootPath: string): string {
  return projectKey(rootPath)
}
