import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { EventEmitter } from 'events'

export interface KeyModifierOptions {
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export interface SendInputOptions {
  input?: string
  keys?: string[]
  pressEnter?: boolean
}

export interface TerminalProcessSession {
  runId: string
  chatId: string
  command: string
  child: ChildProcess
  status: 'running' | 'completed' | 'failed' | 'killed'
  outputBuffer: string
  exitCode: number | null
  error?: string
  startedAt: number
  completedAt: number | null
  isBackgrounded: boolean
  notified: boolean
  eventEmitter: EventEmitter
}

export interface InitialExecutionResult {
  completed: boolean
  runId: string
  output: string
  exitCode?: number | null
  isError?: boolean
}

const MAX_OUTPUT_BUFFER = 100_000
const sessions = new Map<string, TerminalProcessSession>()
const processEvents = new EventEmitter()

function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  )
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_BUFFER) return output
  return output.substring(0, MAX_OUTPUT_BUFFER) + '\n\n... (Output truncated for performance)'
}

/**
 * Generates a 6-digit random Run ID unique to the specified chat session.
 */
function generateRunId(chatId: string): string {
  let attempts = 0
  while (attempts < 100) {
    const runId = Math.floor(100000 + Math.random() * 900000).toString()
    const sessionKey = `${chatId}::${runId}`
    if (!sessions.has(sessionKey)) {
      return runId
    }
    attempts++
  }
  return `${Math.floor(100000 + Math.random() * 900000)}`
}

function getSessionKey(chatId: string, runId: string): string {
  return `${chatId}::${runId}`
}

/**
 * Universal ANSI / xterm Key Sequence Parser supporting Ctrl, Alt, Shift and combinations.
 */
export function parseKeySequence(keyToken: string): string {
  const trimmed = keyToken.trim()
  if (!trimmed) return ''

  // Split by '+' or '-' to extract modifiers and base key
  const parts = trimmed.split(/[-+]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''

  let ctrl = false
  let alt = false
  let shift = false
  let baseKey = ''

  for (let i = 0; i < parts.length; i++) {
    const partLower = parts[i].toLowerCase()
    if (partLower === 'ctrl' || partLower === 'control') {
      ctrl = true
    } else if (partLower === 'alt' || partLower === 'meta' || partLower === 'opt' || partLower === 'option') {
      alt = true
    } else if (partLower === 'shift') {
      shift = true
    } else {
      baseKey = parts[i]
    }
  }

  if (!baseKey) {
    if (ctrl) return '\x03'
    if (alt) return '\x1b'
    return ''
  }

  const baseLower = baseKey.toLowerCase()

  // Calculate xterm modifier parameter:
  // 1 = none, 2 = shift, 3 = alt, 4 = shift+alt, 5 = ctrl, 6 = shift+ctrl, 7 = alt+ctrl, 8 = shift+alt+ctrl
  let modifierParam = 1
  if (shift) modifierParam += 1
  if (alt) modifierParam += 2
  if (ctrl) modifierParam += 4

  // Single characters / Letters
  if (baseKey.length === 1) {
    if (ctrl) {
      const code = baseKey.toUpperCase().charCodeAt(0)
      if (code >= 64 && code <= 95) {
        const ctrlChar = String.fromCharCode(code - 64)
        return alt ? `\x1b${ctrlChar}` : ctrlChar
      }
    }

    let charToSend = baseKey
    if (shift) {
      charToSend = baseKey.toUpperCase()
    }
    return alt ? `\x1b${charToSend}` : charToSend
  }

  // Arrow Keys
  if (baseLower === 'up' || baseLower === 'arrowup') {
    return modifierParam > 1 ? `\x1b[1;${modifierParam}A` : '\x1b[A'
  }
  if (baseLower === 'down' || baseLower === 'arrowdown') {
    return modifierParam > 1 ? `\x1b[1;${modifierParam}B` : '\x1b[B'
  }
  if (baseLower === 'right' || baseLower === 'arrowright') {
    return modifierParam > 1 ? `\x1b[1;${modifierParam}C` : '\x1b[C'
  }
  if (baseLower === 'left' || baseLower === 'arrowleft') {
    return modifierParam > 1 ? `\x1b[1;${modifierParam}D` : '\x1b[D'
  }

  // Control and Navigation Keys
  if (baseLower === 'enter' || baseLower === 'return') {
    return alt ? '\x1b\r\n' : '\r\n'
  }
  if (baseLower === 'tab') {
    if (shift) return '\x1b[Z'
    return alt ? '\x1b\t' : '\t'
  }
  if (baseLower === 'escape' || baseLower === 'esc') {
    return '\x1b'
  }
  if (baseLower === 'backspace' || baseLower === 'delete_backward') {
    return alt ? '\x1b\x7f' : '\x7f'
  }
  if (baseLower === 'space' || baseLower === 'spacebar') {
    return alt ? '\x1b ' : ' '
  }
  if (baseLower === 'home') {
    return modifierParam > 1 ? `\x1b[1;${modifierParam}H` : '\x1b[H'
  }
  if (baseLower === 'end') {
    return modifierParam > 1 ? `\x1b[1;${modifierParam}F` : '\x1b[F'
  }
  if (baseLower === 'pageup' || baseLower === 'prior') {
    return modifierParam > 1 ? `\x1b[5;${modifierParam}~` : '\x1b[5~'
  }
  if (baseLower === 'pagedown' || baseLower === 'next') {
    return modifierParam > 1 ? `\x1b[6;${modifierParam}~` : '\x1b[6~'
  }
  if (baseLower === 'insert') {
    return modifierParam > 1 ? `\x1b[2;${modifierParam}~` : '\x1b[2~'
  }
  if (baseLower === 'delete' || baseLower === 'del') {
    return modifierParam > 1 ? `\x1b[3;${modifierParam}~` : '\x1b[3~'
  }

  // Function Keys F1-F12
  const fMatch = baseLower.match(/^f([1-9]|1[0-2])$/)
  if (fMatch) {
    const fNum = parseInt(fMatch[1], 10)
    const fCodes: Record<number, string> = {
      1: 'P', 2: 'Q', 3: 'R', 4: 'S',
      5: '15~', 6: '17~', 7: '18~', 8: '19~',
      9: '20~', 10: '21~', 11: '23~', 12: '24~'
    }
    const code = fCodes[fNum]
    if (code) {
      if (fNum <= 4) {
        return modifierParam > 1 ? `\x1b[1;${modifierParam}${code}` : `\x1bO${code}`
      }
      const prefix = code.replace('~', '')
      return modifierParam > 1 ? `\x1b[${prefix};${modifierParam}~` : `\x1b[${code}`
    }
  }

  // Fallback: send as literal text with Alt prefix if needed
  return alt ? `\x1b${baseKey}` : baseKey
}

export interface SpawnTerminalOptions {
  chatId: string
  shell?: string
  cwd?: string
  apiKey?: string
  signal?: AbortSignal
  event?: any
}

/**
 * Spawns a shell process with bidirectional standard streams and lifecycle tracking.
 */
export function spawnGuardedTerminalProcess(
  command: string,
  options: SpawnTerminalOptions
): TerminalProcessSession {
  const isWindows = process.platform === 'win32'
  const shellToUse = options.shell || (isWindows ? 'powershell.exe' : '/bin/sh')
  const runId = generateRunId(options.chatId)
  const sessionKey = getSessionKey(options.chatId, runId)

  const env = { ...process.env }
  if (options.apiKey) {
    env.GEMINI_API_KEY = options.apiKey
  }

  let spawnArgs: string[] = []
  let spawnFile = shellToUse

  const lowerShell = shellToUse.toLowerCase()
  if (isWindows) {
    if (lowerShell.includes('powershell') || lowerShell.includes('pwsh')) {
      const utf8Prefix = `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; `
      spawnArgs = ['-NoProfile', '-NonInteractive', '-Command', `${utf8Prefix}${command}`]
    } else if (lowerShell.includes('cmd')) {
      spawnArgs = ['/c', `chcp 65001 > nul & ${command}`]
    } else if (lowerShell.includes('bash')) {
      spawnArgs = ['-c', command]
    } else {
      spawnArgs = ['-c', command]
    }
  } else {
    spawnArgs = ['-c', command]
  }

  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }

  const child = spawn(spawnFile, spawnArgs, spawnOptions)
  const eventEmitter = new EventEmitter()

  const session: TerminalProcessSession = {
    runId,
    chatId: options.chatId,
    command,
    child,
    status: 'running',
    outputBuffer: '',
    exitCode: null,
    startedAt: Date.now(),
    completedAt: null,
    isBackgrounded: false,
    notified: false,
    eventEmitter
  }

  sessions.set(sessionKey, session)

  const appendChunk = (chunk: Buffer | string): void => {
    const rawText = chunk.toString()
    session.outputBuffer = truncateOutput(session.outputBuffer + rawText)

    if (options.event && options.chatId) {
      try {
        options.event.sender.send('chat-tool-update', {
          toolCallName: 'execute_terminal_command',
          update: { outputChunk: rawText, runId: session.runId },
          chatId: options.chatId
        })
      } catch {}
    }

    eventEmitter.emit('data', rawText)
  }

  child.stdout?.on('data', appendChunk)
  child.stderr?.on('data', appendChunk)

  child.on('error', (err) => {
    session.status = 'failed'
    session.error = err.message
    session.completedAt = Date.now()
    eventEmitter.emit('error', err)
    processEvents.emit('process-ended', session)
  })

  child.on('close', (code) => {
    if (session.status !== 'killed') {
      session.status = code === 0 ? 'completed' : 'failed'
      session.exitCode = code
    }
    session.completedAt = Date.now()
    eventEmitter.emit('close', code)
    processEvents.emit('process-ended', session)
  })

  // Handle abort signal if provided
  if (options.signal) {
    if (options.signal.aborted) {
      killTerminalProcess(runId, options.chatId)
    } else {
      options.signal.addEventListener('abort', () => {
        killTerminalProcess(runId, options.chatId)
      })
    }
  }

  return session
}

/**
 * Executes a command with an initial synchronous wait window of 5 seconds.
 * Returns immediately if completed in <= 5s.
 * Transitions to background and returns Run ID and output so far if > 5s.
 */
export async function executeTerminalWithInitialWait(
  command: string,
  options: SpawnTerminalOptions,
  initialTimeoutMs = 5000
): Promise<InitialExecutionResult> {
  const session = spawnGuardedTerminalProcess(command, options)

  return new Promise((resolve) => {
    let resolved = false

    const timeoutTimer = setTimeout(() => {
      if (resolved) return
      resolved = true
      session.isBackgrounded = true

      const cleanOutput = stripAnsi(session.outputBuffer).trim()
      const outputSnippet = cleanOutput
        ? `\n\nOutput so far:\n${cleanOutput}`
        : '\n\nOutput so far: (No output produced yet).'

      const notice =
        `Command execution exceeded 5 seconds. It is now running in the background with Run ID: ${session.runId}.` +
        `${outputSnippet}\n\n` +
        `You can continue other work, inspect output with read_terminal_output, send keyboard/text input with send_terminal_input, or safely end your turn in Standby. ` +
        `When the command finishes, the system will automatically ping and wake you up with the complete output.`

      resolve({
        completed: false,
        runId: session.runId,
        output: notice
      })
    }, initialTimeoutMs)

    session.eventEmitter.once('close', (code) => {
      if (resolved) return
      clearTimeout(timeoutTimer)
      resolved = true

      const cleanOutput = stripAnsi(session.outputBuffer).trim()
      const finalOutput = cleanOutput || (code === 0 ? 'Command executed successfully (no output).' : `Command failed with exit code ${code}.`)

      resolve({
        completed: true,
        runId: session.runId,
        output: finalOutput,
        exitCode: code,
        isError: code !== 0
      })
    })

    session.eventEmitter.once('error', (err) => {
      if (resolved) return
      clearTimeout(timeoutTimer)
      resolved = true

      resolve({
        completed: true,
        runId: session.runId,
        output: `Error executing command: ${err.message}`,
        isError: true
      })
    })
  })
}

/**
 * Reads the accumulated terminal output so far for a given Run ID.
 */
export function readTerminalOutput(runId: string, chatId?: string): string {
  const targetSession = findSession(runId, chatId)
  if (!targetSession) {
    return `Error: No terminal process found with Run ID "${runId}".`
  }

  const cleanOutput = stripAnsi(targetSession.outputBuffer).trim()
  const statusStr = targetSession.status.toUpperCase()
  const exitCodeStr = targetSession.exitCode !== null ? ` (Exit Code: ${targetSession.exitCode})` : ''

  return (
    `[Terminal Process Run ID: ${targetSession.runId} | Status: ${statusStr}${exitCodeStr}]\n` +
    (cleanOutput || '(No output produced yet).')
  )
}

/**
 * Sends input (text and/or simulated key sequences) to a terminal process stdin.
 */
export async function sendTerminalInput(
  runId: string,
  options: SendInputOptions,
  chatId?: string
): Promise<string> {
  const targetSession = findSession(runId, chatId)
  if (!targetSession) {
    return `Error: No terminal process found with Run ID "${runId}".`
  }

  if (targetSession.status !== 'running') {
    return `Error: Terminal process with Run ID "${runId}" is not running (Current status: ${targetSession.status}).`
  }

  if (!targetSession.child.stdin || targetSession.child.stdin.destroyed) {
    return `Error: Standard input (stdin) for Run ID "${runId}" is not writable.`
  }

  let payload = ''

  // 1. Process simulated key sequence if provided
  if (Array.isArray(options.keys) && options.keys.length > 0) {
    for (const key of options.keys) {
      payload += parseKeySequence(key)
    }
  }

  // 2. Process text input if provided
  if (typeof options.input === 'string' && options.input.length > 0) {
    payload += options.input
    const shouldPressEnter = options.pressEnter !== false
    if (shouldPressEnter && !payload.endsWith('\n') && !payload.endsWith('\r')) {
      payload += '\n'
    }
  }

  if (!payload) {
    return `Error: No input text or key sequence was specified.`
  }

  const initialBufferLength = targetSession.outputBuffer.length

  try {
    targetSession.child.stdin.write(payload)
  } catch (err) {
    return `Error writing to stdin: ${err instanceof Error ? err.message : String(err)}`
  }

  // Wait a short window (1.5s) to capture immediate response from the terminal
  await new Promise((r) => setTimeout(r, 1500))

  const newOutput = targetSession.outputBuffer.substring(initialBufferLength)
  const cleanNewOutput = stripAnsi(newOutput).trim()
  const statusStr = targetSession.status.toUpperCase()

  return (
    `Input sent successfully to Run ID ${targetSession.runId} (Status: ${statusStr}).\n` +
    (cleanNewOutput ? `New terminal output:\n${cleanNewOutput}` : `(No new output produced after input).`)
  )
}

/**
 * Kills a running terminal process.
 */
export function killTerminalProcess(runId: string, chatId?: string): string {
  const targetSession = findSession(runId, chatId)
  if (!targetSession) {
    return `Error: No terminal process found with Run ID "${runId}".`
  }

  if (targetSession.status !== 'running') {
    return `Terminal process with Run ID "${runId}" is already ${targetSession.status}.`
  }

  try {
    targetSession.status = 'killed'
    if (process.platform === 'win32' && targetSession.child.pid) {
      spawn('taskkill', ['/pid', targetSession.child.pid.toString(), '/T', '/F'])
    } else {
      targetSession.child.kill('SIGTERM')
    }
    return `Successfully terminated terminal process with Run ID "${runId}".`
  } catch (err) {
    return `Error terminating process "${runId}": ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Returns pending background process completion notifications for a given chat.
 * Marks them as notified so they are not delivered more than once.
 */
export function getPendingProcessNotifications(chatId: string): Array<{
  runId: string
  command: string
  status: string
  exitCode: number | null
  output: string
}> {
  const results: Array<{
    runId: string
    command: string
    status: string
    exitCode: number | null
    output: string
  }> = []

  for (const session of sessions.values()) {
    if (
      session.chatId === chatId &&
      session.isBackgrounded &&
      !session.notified &&
      (session.status === 'completed' || session.status === 'failed' || session.status === 'killed')
    ) {
      session.notified = true
      const cleanOutput = stripAnsi(session.outputBuffer).trim()
      results.push({
        runId: session.runId,
        command: session.command,
        status: session.status,
        exitCode: session.exitCode,
        output: cleanOutput || (session.status === 'completed' ? 'Executed successfully (no output).' : `Failed with exit code ${session.exitCode}.`)
      })
    }
  }

  return results
}

/**
 * Registers a global listener for when any backgrounded process ends.
 */
export function onBackgroundProcessEnded(
  callback: (session: TerminalProcessSession) => void
): () => void {
  const handler = (session: TerminalProcessSession): void => {
    if (session.isBackgrounded && !session.notified) {
      callback(session)
    }
  }
  processEvents.on('process-ended', handler)
  return () => {
    processEvents.off('process-ended', handler)
  }
}

function findSession(runId: string, chatId?: string): TerminalProcessSession | undefined {
  if (chatId) {
    const directKey = getSessionKey(chatId, runId)
    const direct = sessions.get(directKey)
    if (direct) return direct
  }

  for (const session of sessions.values()) {
    if (session.runId === runId) {
      if (!chatId || session.chatId === chatId) {
        return session
      }
    }
  }
  return undefined
}
