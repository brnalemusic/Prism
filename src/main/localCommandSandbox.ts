import * as os from 'os'
import * as path from 'path'
import { executeTerminalWithInitialWait } from './terminalProcessManager'

const MAX_COMMAND_LENGTH = 20_000

const COMMAND_SEPARATOR = String.raw`(?:^|[\s;&|{}()\\/]\s*)`
const COMMAND_END = String.raw`(?:\s|$|[;&|])`

interface CommandRule {
  pattern: RegExp
  reason: string
}

class CommandBlockedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'CommandBlockedError'
  }
}

function commandRule(command: string): RegExp {
  return new RegExp(`${COMMAND_SEPARATOR}${command}${COMMAND_END}`, 'i')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function normalizePathForScan(value: string): string {
  return normalizeSeparators(path.resolve(value))
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (!value) continue
    const normalized = normalizePathForScan(value)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

function getSystemProtectedRoots(): string[] {
  if (process.platform !== 'win32') {
    return [
      '/bin',
      '/boot',
      '/dev',
      '/etc',
      '/lib',
      '/lib64',
      '/proc',
      '/root',
      '/sbin',
      '/sys',
      '/usr',
      '/var'
    ]
  }

  const windir = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  return uniqueDefined([
    windir,
    path.join(windir, 'System32'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData || 'C:\\ProgramData',
    'C:\\Boot',
    'C:\\Recovery',
    'C:\\System Volume Information'
  ])
}

function getBroadProtectedRoots(): string[] {
  const home = os.homedir()
  return uniqueDefined([
    home,
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.parse(home).root
  ])
}

function hasCommand(scanText: string, command: string): boolean {
  return commandRule(command).test(scanText)
}

function hasAnyCommand(scanText: string, commands: string[]): boolean {
  return commands.some((command) => hasCommand(scanText, command))
}

function hasDestructiveFileVerb(scanText: string): boolean {
  return [
    String.raw`remove-item`,
    String.raw`rm`,
    String.raw`rmdir`,
    String.raw`rd`,
    String.raw`del`,
    String.raw`erase`,
    String.raw`clear-content`,
    String.raw`set-content`,
    String.raw`out-file`,
    String.raw`move-item`,
    String.raw`mv`,
    String.raw`rename-item`,
    String.raw`ren`,
    String.raw`xcopy`,
    String.raw`robocopy`
  ].some((command) => hasCommand(scanText, command))
}

function includesRootReference(scanText: string, root: string): boolean {
  const escaped = escapeRegex(root.replace(/\/$/, ''))
  const descendant = new RegExp(`(?:^|[\\s"'=])${escaped}(?:/|$|[\\s"';&|])`, 'i')
  return descendant.test(scanText)
}

function includesBroadRootReference(scanText: string, root: string): boolean {
  const cleanRoot = root.replace(/\/$/, '')
  const escaped = escapeRegex(cleanRoot)
  const exactOrWildcard = new RegExp(`(?:^|[\\s"'=])${escaped}(?:/?(?:$|[\\s"';&|])|/[*])`, 'i')
  return exactOrWildcard.test(scanText)
}

function findProtectedPathReason(scanText: string): string | null {
  for (const root of getSystemProtectedRoots()) {
    if (includesRootReference(scanText, root)) return `protected system path: ${root}`
  }

  for (const root of getBroadProtectedRoots()) {
    if (includesBroadRootReference(scanText, root)) return `broad protected path: ${root}`
  }

  return null
}

function referencesBroadDeleteTarget(scanText: string): boolean {
  const recursiveDelete =
    /\b(-r|-rf|-fr|--recursive|\/s)\b/i.test(scanText) &&
    hasAnyCommand(scanText, ['remove-item', 'rm', 'rmdir', 'rd', 'del', 'erase'])

  if (!recursiveDelete) return false

  return /(?:^|[\s"'=])(?:\.|\*|\.\/|\/|[a-z]:\/?)(?:$|[\s"';&|*])/i.test(scanText)
}

const ALWAYS_BLOCKED_RULES: CommandRule[] = [
  {
    pattern: commandRule(String.raw`shutdown(?:\.exe)?`),
    reason: 'system shutdown/restart commands are blocked'
  },
  {
    pattern: /\b(restart-computer|stop-computer)\b/i,
    reason: 'system shutdown/restart commands are blocked'
  },
  {
    pattern: commandRule(String.raw`logoff(?:\.exe)?`),
    reason: 'logoff commands are blocked'
  },
  {
    pattern: commandRule(String.raw`diskpart(?:\.exe)?`),
    reason: 'disk partitioning commands are blocked'
  },
  {
    pattern: commandRule(String.raw`format(?:\.com|\.exe)?`),
    reason: 'disk formatting commands are blocked'
  },
  {
    pattern: commandRule(String.raw`bcdedit(?:\.exe)?`),
    reason: 'boot configuration commands are blocked'
  },
  {
    pattern: commandRule(String.raw`bootrec(?:\.exe)?`),
    reason: 'boot repair commands are blocked'
  },
  {
    pattern: commandRule(String.raw`bootsect(?:\.exe)?`),
    reason: 'boot sector commands are blocked'
  },
  {
    pattern: commandRule(String.raw`mountvol(?:\.exe)?`),
    reason: 'volume mount commands are blocked'
  },
  {
    pattern: commandRule(String.raw`wsl(?:\.exe)?`),
    reason: 'WSL execution is blocked for guarded AI terminal commands'
  },
  {
    pattern: /\b(start-process)\b[\s\S]*\b-verb\s+runas\b/i,
    reason: 'elevation prompts are blocked'
  },
  {
    pattern: commandRule(String.raw`runas(?:\.exe)?`),
    reason: 'elevation prompts are blocked'
  },
  {
    pattern: /\b(set-executionpolicy)\b/i,
    reason: 'PowerShell execution policy changes are blocked'
  },
  {
    pattern: /\b(set-mppreference|add-mppreference|remove-mppreference)\b/i,
    reason: 'Microsoft Defender policy changes are blocked'
  },
  {
    pattern: commandRule(String.raw`schtasks(?:\.exe)?\s+(?:/create|/change|/delete)`),
    reason: 'scheduled task mutation is blocked'
  },
  {
    pattern: commandRule(String.raw`netsh(?:\.exe)?`),
    reason: 'network/firewall configuration commands are blocked'
  },
  {
    pattern: commandRule(String.raw`sc(?:\.exe)?\s+(?:delete|stop|config|create|failure)`),
    reason: 'service mutation commands are blocked'
  },
  {
    pattern: /\b(stop-service|set-service|new-service|remove-service|restart-service)\b/i,
    reason: 'service mutation commands are blocked'
  },
  {
    pattern: commandRule(
      String.raw`reg(?:\.exe)?\s+(?:add|delete|import|restore|save|load|unload)`
    ),
    reason: 'registry mutation commands are blocked'
  },
  {
    pattern: /\b(remove-itemproperty|set-itemproperty|new-itemproperty)\b[\s\S]*\bhklm:/i,
    reason: 'HKLM registry mutation is blocked'
  },
  {
    pattern: commandRule(String.raw`net(?:\.exe)?\s+(?:user|localgroup|accounts|share|stop|start|use)`),
    reason: 'account, share, network, or service control commands are blocked'
  },
  {
    pattern:
      /\b(add-localgroupmember|remove-localgroupmember|new-localuser|remove-localuser|disable-localuser|enable-localuser|set-localuser)\b/i,
    reason: 'local user/group mutation is blocked'
  },
  {
    pattern: commandRule(String.raw`takeown(?:\.exe)?`),
    reason: 'ownership mutation commands are blocked'
  },
  {
    pattern: commandRule(String.raw`icacls(?:\.exe)?`),
    reason: 'ACL mutation commands are blocked'
  },
  {
    pattern: commandRule(String.raw`cipher(?:\.exe)?\s+/w`),
    reason: 'disk wiping commands are blocked'
  },
  {
    pattern: commandRule(String.raw`mkfs(?:\.[a-z0-9]+)?`),
    reason: 'filesystem formatting commands are blocked'
  },
  {
    pattern: new RegExp(`${COMMAND_SEPARATOR}dd${COMMAND_END}[\\s\\S]*\\bof=/dev/`, 'i'),
    reason: 'raw disk write commands are blocked'
  },
  {
    pattern: /:\s*\(\)\s*{\s*:\|:\s*&\s*}\s*;/,
    reason: 'fork bomb pattern is blocked'
  },
  {
    pattern: commandRule(String.raw`winget(?:\.exe)?\s+uninstall`),
    reason: 'system package uninstall commands are blocked'
  },
  {
    pattern: commandRule(String.raw`choco(?:\.exe)?\s+uninstall`),
    reason: 'system package uninstall commands are blocked'
  },
  {
    pattern: commandRule(String.raw`scoop(?:\.cmd|\.ps1|\.exe)?\s+uninstall`),
    reason: 'system package uninstall commands are blocked'
  }
]

function normalizeCommandForScan(command: string): string {
  return normalizeSeparators(command)
    .replace(/\$env:windir|\$\{env:windir\}|%windir%|%systemroot%/gi, 'c:/windows')
    .replace(
      /\$env:userprofile|\$\{env:userprofile\}|%userprofile%/gi,
      normalizePathForScan(os.homedir())
    )
    .replace(/\s+/g, ' ')
}

function assertCommandAllowed(command: string): void {
  const trimmed = command.trim()
  if (!trimmed) throw new CommandBlockedError('empty commands are not allowed')
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    throw new CommandBlockedError(
      `commands longer than ${MAX_COMMAND_LENGTH} characters are blocked`
    )
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) {
    throw new CommandBlockedError('control characters are blocked in terminal commands')
  }

  const scanText = normalizeCommandForScan(trimmed)

  for (const rule of ALWAYS_BLOCKED_RULES) {
    if (rule.pattern.test(scanText)) throw new CommandBlockedError(rule.reason)
  }

  if (referencesBroadDeleteTarget(scanText)) {
    throw new CommandBlockedError('recursive deletion of broad targets is blocked')
  }

  if (hasDestructiveFileVerb(scanText)) {
    const protectedPath = findProtectedPathReason(scanText)
    if (protectedPath) {
      throw new CommandBlockedError(`file mutation against ${protectedPath} is blocked`)
    }
  }
}

export interface RunOptions {
  shell?: string
  apiKey?: string
  signal?: AbortSignal
  cwd?: string
  event?: any
  chatId?: string
}

export function getShellSyntaxSummary(shellName: string): string {
  const lowerShell = shellName.toLowerCase()
  if (lowerShell.includes('pwsh')) return 'PowerShell 7 / pwsh'
  if (lowerShell.includes('powershell')) return 'Windows PowerShell'
  if (lowerShell.includes('cmd')) return 'CMD'
  if (lowerShell.includes('bash') || lowerShell.includes('wsl') || lowerShell.includes('sh')) {
    return 'Bash/POSIX shell'
  }
  return 'selected shell'
}

export function getLocalCommandSandboxSummary(shellName: string): string {
  return `guarded host terminal, selected shell ${shellName}, ${getShellSyntaxSummary(shellName)} syntax`
}

export async function runGuardedTerminalCommand(
  command: string,
  options: RunOptions = {}
): Promise<string> {
  try {
    assertCommandAllowed(command)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `Blocked by Prism local command sandbox: ${reason}.\nThe command was not executed. Use safer, specific file operations or ask the user to run privileged/system changes manually.`
  }

  const isWindows = process.platform === 'win32'
  const shellToUse = options.shell || (isWindows ? 'powershell.exe' : undefined)

  const result = await executeTerminalWithInitialWait(
    command,
    {
      chatId: options.chatId || 'default',
      shell: shellToUse,
      cwd: options.cwd,
      apiKey: options.apiKey,
      signal: options.signal,
      event: options.event
    },
    5000
  )

  return result.output
}

export function assertSafeFileMutationPath(fullPath: string, label: string): void {
  const normalized = path.normalize(fullPath)
  const parsed = path.parse(normalized)

  if (normalized === parsed.root) {
    throw new Error(`Refusing to operate on filesystem root as ${label}: ${fullPath}`)
  }

  const scanPath = normalizePathForScan(normalized)
  for (const root of getSystemProtectedRoots()) {
    const cleanRoot = root.replace(/\/$/, '')
    if (scanPath === cleanRoot || scanPath.startsWith(`${cleanRoot}/`)) {
      throw new Error(`Refusing to modify protected system path as ${label}: ${fullPath}`)
    }
  }
}

export function assertSafeBulkMutationPath(fullPath: string, label: string): void {
  assertSafeFileMutationPath(fullPath, label)

  const scanPath = normalizePathForScan(fullPath)
  for (const root of getBroadProtectedRoots()) {
    const cleanRoot = root.replace(/\/$/, '')
    if (scanPath === cleanRoot) {
      throw new Error(`Refusing to modify broad protected path as ${label}: ${fullPath}`)
    }
  }
}
