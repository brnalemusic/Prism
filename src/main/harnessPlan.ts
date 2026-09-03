import type { HarnessPhase, HarnessToolName } from '../shared/types'

const PLAN_TOOLS = new Set<HarnessToolName>([
  'read',
  'list',
  'find',
  'grep',
  'to_ask',
  'exec_command',
  'read_terminal_output',
  'web_search'
])

export function getHarnessToolNamesForPhase(
  enabledTools: HarnessToolName[],
  phase: HarnessPhase
): HarnessToolName[] {
  if (phase === 'build') return enabledTools.filter((name) => name !== 'plan')
  return [
    ...new Set<HarnessToolName>([
      ...enabledTools.filter((name) => PLAN_TOOLS.has(name)),
      'to_ask',
      'plan'
    ])
  ]
}

function referencesOutsideProject(command: string): boolean {
  const normalized = command.replace(/\\/g, '/')
  return (
    /(?:^|[\s"'=])(\.\.)(?:\/|$|[\s"';|&])/i.test(normalized) ||
    /(?:^|[\s"'=])(?:[a-z]:\/|\/\/(?:[^/]+)\/|\/(?:home|root|etc|usr|var|opt|tmp|users)\/)/i.test(
      normalized
    ) ||
    /(?:\$env:|\$\{env:|%)(?:userprofile|home|appdata|localappdata|temp|tmp|windir|systemroot)/i.test(
      command
    )
  )
}

/** Conservative command gate used while a Harness session is planning. */
export function isReadOnlyHarnessPlanCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || referencesOutsideProject(trimmed)) return false
  if (/(?:^|\s)(?:>|>>|tee|set-content|add-content|out-file)(?:\s|$)/i.test(trimmed)) return false
  if (/[;&|]/.test(trimmed)) return false

  return [
    /^(?:pwd|dir|ls|type|cat|more|where|which|tree)(?:\s|$)/i,
    /^(?:rg|grep|findstr)(?:\s|$)/i,
    /^(?:get-location|get-childitem|get-child-item|get-content|select-string)(?:\s|$)/i,
    /^git\s+(?:status|diff|log|show|branch|rev-parse|ls-files)(?:\s|$)/i
  ].some((pattern) => pattern.test(trimmed))
}
