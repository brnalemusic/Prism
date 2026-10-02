import { randomUUID } from 'crypto'
import type { HarnessApprovalItem, HarnessApprovalRequest } from '../shared/types'
import { broadcastIpc } from './safeSend'

interface PendingApproval {
  chatId: string
  projectPath: string
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
  expiresAt: number
}

const pendingApprovals = new Map<string, PendingApproval>()

export function requestHarnessApproval(
  chatId: string,
  projectPath: string,
  items: HarnessApprovalItem[],
  signal?: AbortSignal
): Promise<boolean> {
  const requestId = randomUUID()
  const createdAt = Date.now()
  const expiresAt = createdAt + 10 * 60 * 1000
  const request: HarnessApprovalRequest = {
    requestId, chatId, projectPath, items, createdAt, expiresAt, status: 'pending'
  }
  return new Promise((resolve) => {
    const finish = (approved: boolean): void => {
      const pending = pendingApprovals.get(requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingApprovals.delete(requestId)
      resolve(approved)
    }
    const timer = setTimeout(() => finish(false), expiresAt - createdAt)
    pendingApprovals.set(requestId, { chatId, projectPath, resolve: finish, timer, expiresAt })
    if (signal) {
      signal.addEventListener('abort', () => finish(false), { once: true })
    }
    broadcastIpc('harness-approval-request', request)
  })
}

export function resolveHarnessApproval(
  requestId: string,
  approved: boolean,
  context?: { chatId?: string; projectPath?: string }
): boolean {
  const pending = pendingApprovals.get(requestId)
  if (!pending) return false
  if (Date.now() >= pending.expiresAt) {
    pending.resolve(false)
    return false
  }
  if (context?.chatId && context.chatId !== pending.chatId) return false
  if (context?.projectPath && context.projectPath !== pending.projectPath) return false
  pending.resolve(approved)
  return true
}

export function cancelHarnessApprovalsForChat(chatId: string): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.chatId === chatId) resolveHarnessApproval(requestId, false)
  }
}
