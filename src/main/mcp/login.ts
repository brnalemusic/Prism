import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import type {
  McpConnectPresetResult,
  McpGalleryPreset,
  McpLoginRequest,
  McpLoginResolution
} from '../../shared/mcpTypes'
import { getMcpGalleryPreset } from './presets'
import { saveServer } from './store'
import { loadServerSecrets, saveServerSecrets } from './secrets'
import { refreshServer } from './manager'
import { broadcastIpc } from '../safeSend'
import { getTask, updateTask } from '../agenda/tasks'

/** How long the native sign-in dialog waits before it is treated as cancelled. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

interface PendingLogin {
  request: McpLoginRequest
  resolve: (values: Record<string, string> | null) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingLogin>()

function focusPrism(): void {
  const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

export function getPendingMcpLoginCount(): number {
  return pending.size
}

/** True when every credential the preset needs is already stored encrypted. */
export function hasPresetCredentials(presetId: string): boolean {
  const preset = getMcpGalleryPreset(presetId)
  if (!preset) return false
  const secrets = loadServerSecrets(preset.id)
  return preset.fields.every((field) => Boolean(secrets[field.key]?.trim()))
}

/**
 * Opens the global Prism sign-in dialog and waits for the user.
 *
 * The caller never sees the credentials in plain text outside this module: the
 * result is merged into encrypted storage by {@link connectMcpPreset}.
 */
export function requestMcpLogin(
  preset: McpGalleryPreset,
  options: { taskId?: string; taskTitle?: string; runId?: string; signal?: AbortSignal } = {}
): Promise<Record<string, string> | null> {
  if (options.signal?.aborted) return Promise.resolve(null)

  const requestId = randomUUID()
  const createdAt = Date.now()
  const existingKeys = Object.keys(loadServerSecrets(preset.id))
  const request: McpLoginRequest = {
    requestId,
    presetId: preset.id,
    presetName: preset.name,
    description: preset.description,
    brand: preset.brand,
    fields: preset.fields,
    existingKeys,
    taskId: options.taskId,
    taskTitle: options.taskTitle,
    runId: options.runId,
    createdAt,
    expiresAt: createdAt + LOGIN_TIMEOUT_MS
  }

  return new Promise<Record<string, string> | null>((resolve) => {
    let settled = false

    const settle = (values: Record<string, string> | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      pending.delete(requestId)
      broadcastIpc('mcp-login-closed', { requestId })
      resolve(values)
    }

    const onAbort = (): void => settle(null)
    const timer = setTimeout(() => settle(null), LOGIN_TIMEOUT_MS)

    options.signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(requestId, { request, resolve: settle, timer })
    focusPrism()
    broadcastIpc('mcp-login-request', request)
  })
}

/** Applies the values typed in the native dialog. */
export function resolveMcpLogin(
  resolution: McpLoginResolution
): { ok: boolean; error?: string } {
  if (!resolution || typeof resolution.requestId !== 'string') {
    return { ok: false, error: 'Malformed sign-in response.' }
  }

  const entry = pending.get(resolution.requestId)
  if (!entry) return { ok: false, error: 'This sign-in request is no longer pending.' }

  if (resolution.cancelled) {
    entry.resolve(null)
    return { ok: true }
  }

  const values: Record<string, string> = {}
  const existing = loadServerSecrets(entry.request.presetId)
  for (const field of entry.request.fields) {
    const typed = typeof resolution.values?.[field.key] === 'string'
      ? resolution.values[field.key].trim()
      : ''
    if (!typed && !existing[field.key]?.trim()) {
      return { ok: false, error: `${field.label} is required.` }
    }
    if (typed) values[field.key] = typed
  }

  entry.resolve(values)
  return { ok: true }
}

export interface ConnectPresetOptions {
  /** Credentials already collected by the caller. Missing fields trigger the dialog. */
  values?: Record<string, string>
  taskId?: string
  taskTitle?: string
  runId?: string
  attachToTask?: boolean
  signal?: AbortSignal
}

/**
 * Installs or refreshes one gallery integration, asking for credentials only
 * when they are missing. Never writes a token to mcp.json or to the URL.
 */
export async function connectMcpPreset(
  presetId: string,
  options: ConnectPresetOptions = {}
): Promise<McpConnectPresetResult> {
  const preset = getMcpGalleryPreset(presetId)
  if (!preset) {
    return { ok: false, error: `Unknown integration "${presetId}".` }
  }

  const existingSecrets = loadServerSecrets(preset.id)
  let values = options.values ?? null
  const needsDialog = preset.fields.some(
    (field) => !values?.[field.key]?.trim() && !existingSecrets[field.key]?.trim()
  )
  if (needsDialog) {
    values = await requestMcpLogin(preset, {
      taskId: options.taskId,
      taskTitle: options.taskTitle,
      runId: options.runId,
      signal: options.signal
    })
    if (!values) {
      return { ok: false, cancelled: true, error: 'The sign-in was cancelled.' }
    }
  }

  const env: Record<string, string> = { ...existingSecrets }
  for (const field of preset.fields) {
    const typed = values?.[field.key]?.trim()
    if (typed) env[field.key] = typed
  }
  for (const field of preset.fields) {
    if (!env[field.key]?.trim()) {
      return { ok: false, error: `${field.label} is required.` }
    }
  }

  try {
    // Secrets land first so the server never starts without its credential.
    saveServerSecrets(preset.id, env)
    const server = saveServer({
      id: preset.id,
      name: preset.name,
      transport: preset.transport,
      command: preset.command,
      args: preset.args,
      env,
      url: preset.url,
      enabled: true,
      presetId: preset.id,
      authEnvKey: preset.authEnvKey
    })

    if (options.attachToTask && options.taskId) {
      const task = getTask(options.taskId)
      if (task && !task.mcpServerIds.includes(server.id)) {
        updateTask(task.id, { mcpServerIds: [...task.mcpServerIds, server.id] })
        broadcastIpc('agenda-tasks-changed')
      }
    }

    broadcastIpc('mcp-servers-changed')
    const status = await refreshServer(server.id)
    return {
      ok: status.state !== 'error',
      server,
      status,
      tools: status.tools.map((tool) => tool.name),
      error: status.error ?? undefined
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
