import type { SessionMode, WorkspaceKind } from '../../shared/types'

export function resolveRunWorkspace(
  persistedWorkspace?: WorkspaceKind,
  sessionMode?: SessionMode
): WorkspaceKind {
  return persistedWorkspace === 'harness' || sessionMode === 'harness' ? 'harness' : 'chat'
}

/** Harness never falls through to Chat's mutable global model selection. */
export function resolveRequestModelKey(
  workspace: WorkspaceKind,
  payloadModelKey?: string,
  sessionModelKey?: string,
  currentChatModelKey?: string
): string {
  const requested = payloadModelKey?.trim() || ''
  if (requested) return requested
  if (workspace === 'harness') return sessionModelKey?.trim() || ''
  return currentChatModelKey?.trim() || sessionModelKey?.trim() || ''
}

export function withPinnedModel<T>(modelKey: string, run: (modelKey: string) => T): T {
  return run(modelKey)
}
