import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow, Notification } from 'electron'
import type {
  AgendaPermissionKind,
  AgendaPermissionMode,
  AgendaPermissionOutcome,
  AgendaPermissionRequest,
  AgendaPermissionResolution
} from '../../shared/agendaTypes'
import { broadcastIpc } from '../safeSend'
import { CONFIG_DIR } from '../config'

/** How long a Safe-mode prompt waits before it is denied automatically. */
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

export interface PermissionRequestInput {
  kind: AgendaPermissionKind
  title: string
  summary: string
  detail?: string
  taskId?: string
  taskTitle?: string
  runId?: string
}

interface PendingPermission {
  request: AgendaPermissionRequest
  settle: (outcome: AgendaPermissionOutcome, origin: string) => void
}

const pending = new Map<string, PendingPermission>()

let modeAccessor: () => AgendaPermissionMode = () => 'safe'
let yoloSwitcher: () => void = () => undefined

/**
 * Wires the broker to the persisted settings. Called once during app startup,
 * before any Agenda action can request permission.
 */
export function configurePermissionBroker(options: {
  getMode: () => AgendaPermissionMode
  switchToYolo: () => void
}): void {
  modeAccessor = options.getMode
  yoloSwitcher = options.switchToYolo
}

export function getPendingPermissionCount(): number {
  return pending.size
}

/** Current permission mode, shared by the broker and Agenda run accounting. */
export function getPermissionMode(): AgendaPermissionMode {
  return modeAccessor()
}

function writeAudit(entry: Record<string, unknown>): void {
  try {
    const dir = path.join(CONFIG_DIR, 'agenda')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'permissions.jsonl'),
      `${JSON.stringify(entry)}\n`,
      'utf8'
    )
  } catch (error) {
    console.warn('[agenda] could not write the permission audit log:', error)
  }
}

function primaryWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  return windows[0] ?? null
}

function focusPrism(): void {
  const win = primaryWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  win.flashFrame(true)
}

function stopFlashing(): void {
  const win = primaryWindow()
  if (win) win.flashFrame(false)
}

function showSystemNotification(request: AgendaPermissionRequest): void {
  if (!Notification.isSupported()) return
  try {
    const notification = new Notification({
      title: `Prism Agenda — ${request.title}`,
      body: request.summary,
      silent: false
    })
    notification.on('click', () => focusPrism())
    notification.show()
  } catch (error) {
    console.warn('[agenda] could not show the permission notification:', error)
  }
}

/**
 * Asks the user for permission to perform a gated Agenda action.
 *
 * In `yolo` the call resolves immediately. In `safe` it blocks until the user
 * chooses Stop / Continue / Switch to YOLO, the signal aborts, or the timeout
 * expires. The timeout always denies.
 */
export function requestPermission(
  input: PermissionRequestInput,
  signal?: AbortSignal
): Promise<AgendaPermissionOutcome> {
  if (modeAccessor() === 'yolo') {
    writeAudit({
      ts: Date.now(),
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      runId: input.runId,
      decision: 'allowed',
      origin: 'yolo'
    })
    return Promise.resolve('allowed')
  }

  const requestId = randomUUID()
  const createdAt = Date.now()
  const request: AgendaPermissionRequest = {
    requestId,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    detail: input.detail,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    runId: input.runId,
    createdAt,
    expiresAt: createdAt + PERMISSION_TIMEOUT_MS
  }

  return new Promise<AgendaPermissionOutcome>((resolve) => {
    let settled = false

    const settle = (outcome: AgendaPermissionOutcome, origin: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      pending.delete(requestId)
      writeAudit({
        ts: Date.now(),
        requestId,
        kind: request.kind,
        summary: request.summary,
        detail: request.detail,
        taskId: request.taskId,
        taskTitle: request.taskTitle,
        runId: request.runId,
        decision: outcome,
        origin
      })
      // Keep flashing while another prompt is still waiting.
      if (pending.size === 0) stopFlashing()
      broadcastIpc('agenda-permission-closed', { requestId })
      resolve(outcome)
    }

    const onAbort = (): void => settle('aborted', 'abort')
    const timer = setTimeout(() => settle('timeout', 'timeout'), PERMISSION_TIMEOUT_MS)

    if (signal?.aborted) {
      settle('aborted', 'abort')
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    pending.set(requestId, { request, settle })
    focusPrism()
    broadcastIpc('agenda-permission-request', request)
    showSystemNotification(request)
  })
}

/** Applies the user's decision. Returns false when the request is no longer pending. */
export function resolvePermission(resolution: AgendaPermissionResolution): boolean {
  const entry = pending.get(resolution.requestId)
  if (!entry) return false

  if (resolution.choice === 'yolo') {
    yoloSwitcher()
    entry.settle('allowed', 'user-yolo')
    return true
  }

  entry.settle(resolution.choice === 'continue' ? 'allowed' : 'denied', 'user')
  return true
}

/** Denies every pending prompt. Used when the app quits or the user disables Agenda. */
export function cancelPendingPermissions(origin = 'shutdown'): void {
  for (const [requestId, entry] of pending) {
    entry.settle('aborted', origin)
    pending.delete(requestId)
  }
}
