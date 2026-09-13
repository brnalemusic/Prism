import type { HarnessPhase, HarnessToolName } from '../shared/types'

const PLAN_TOOLS = new Set<HarnessToolName>([
  'read',
  'list',
  'find',
  'grep',
  'to_ask',
  'exec_command',
  'read_terminal_output',
  'web_search',
  'read_page',
  'send_message_to_chat',
  'answer_subagent_question',
  'cancel_subagent_task'
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

/** Reject shell evaluation and validate inspection arguments before terminal execution. */
export function isReadOnlyHarnessPlanCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || referencesOutsideProject(trimmed) || /[;&|<>`$%(){}\r\n]/.test(trimmed)) return false
  const tokens = trimmed.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g) || []
  if (tokens.join(' ') !== trimmed.replace(/\s+/g, ' ')) return false
  const args = tokens.map((token) => token.replace(/^(?:"|')|(?:"|')$/g, ''))
  const executable = args.shift()?.toLowerCase()
  if (executable === 'git') {
    const sub = args.shift()
    const flags: Record<string, RegExp> = {
      status: /^(?:--short|--branch|--porcelain(?:=v[12])?|-z|--untracked-files(?:=(?:no|normal|all))?)$/,
      branch: /^(?:--list|-a|-r|-v|-vv|--show-current)$/,
      diff: /^(?:--stat|--name-only|--name-status|--cached|--staged|--check|--quiet|--no-ext-diff|--no-textconv|--binary|--numstat|-z|--)$/,
      log: /^(?:--oneline|--graph|--all|--decorate|--stat|--no-show-signature|--no-ext-diff|--no-textconv|-\d+|--max-count=\d+|--)$/,
      show: /^(?:--stat|--name-only|--no-ext-diff|--no-textconv|--no-show-signature|--)$/,
      'rev-parse': /^(?:--show-toplevel|--git-dir|--git-common-dir|--is-inside-work-tree|--verify|--abbrev-ref)$/,
      'ls-files': /^(?:--stage|--unmerged|--cached|--modified|--deleted|-z|--eol|--others|--exclude-standard|--)$/
    }
    if (!sub || !flags[sub]) return false
    if (sub === 'branch') return args.every((a) => flags.branch.test(a))
    return args.every((a) => a.startsWith('-') ? flags[sub].test(a) : /^[\w./:@{}~^*\[\]-]+$/.test(a))
  }
  if (executable === 'rg') return args.every((a) => !a.startsWith('-') || /^(?:-n|-i|-l|-F|-S|--files|--hidden|--glob|-g|--count|--max-count=\d+|--)$/.test(a))
  if (['pwd', 'get-location'].includes(executable || '')) return args.length === 0
  if (['ls', 'dir', 'get-childitem', 'get-child-item', 'cat', 'type', 'get-content'].includes(executable || '')) {
    return args.every((a) => /^[\w .\/\\*-]+$/.test(a) && (!a.startsWith('-') || /^(?:-la|-l|-a|-Force|-Recurse|-Name|-Raw)$/.test(a)))
  }
  return false
}
