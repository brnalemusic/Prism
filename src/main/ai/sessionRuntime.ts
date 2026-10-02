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

/** Captures the provider/model pair once so later rounds cannot observe mutable selection state. */
export function createPinnedModelInvoker<TProvider>(provider: TProvider, modelKey: string) {
  const pinnedProvider = provider
  const pinnedModelKey = modelKey
  return function invokePinnedModel<TResult>(
    run: (provider: TProvider, modelKey: string) => TResult
  ): TResult {
    return run(pinnedProvider, pinnedModelKey)
  }
}
