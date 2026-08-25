import { randomUUID } from 'crypto'
import type { HarnessApprovalItem, HarnessApprovalRequest } from '../shared/types'
import { broadcastIpc } from './safeSend'

interface PendingApproval {
  chatId: string
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

const pendingApprovals = new Map<string, PendingApproval>()

export function requestHarnessApproval(
  chatId: string,
  projectPath: string,
  items: HarnessApprovalItem[],
  signal?: AbortSignal
): Promise<boolean> {
  const requestId = randomUUID()
  const request: HarnessApprovalRequest = { requestId, chatId, projectPath, items }
  return new Promise((resolve) => {
    const finish = (approved: boolean): void => {
      const pending = pendingApprovals.get(requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingApprovals.delete(requestId)
      resolve(approved)
    }
    const timer = setTimeout(() => finish(false), 10 * 60 * 1000)
    pendingApprovals.set(requestId, { chatId, resolve: finish, timer })
    if (signal) {
      signal.addEventListener('abort', () => finish(false), { once: true })
    }
    broadcastIpc('harness-approval-request', request)
  })
}

export function resolveHarnessApproval(requestId: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(requestId)
  if (!pending) return false
  pending.resolve(approved)
  return true
}

export function cancelHarnessApprovalsForChat(chatId: string): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.chatId === chatId) resolveHarnessApproval(requestId, false)
  }
}
