import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import type { IpcMainEvent } from 'electron'
import * as pty from 'node-pty'
import type { TerminalProcessSnapshot, TerminalProcessStatus } from '../shared/types'
import { broadcastIpc, safeSend } from './safeSend'

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
  process: pty.IPty
  status: TerminalProcessStatus
  outputBuffer: string
  outputTruncated: boolean
  exitCode: number | null
  error?: string
  startedAt: number
  completedAt: number | null
  isBackgrounded: boolean
  awaitingInput: boolean
  detectedPrompt?: string
  lastPromptFingerprint?: string
  promptDetectionTimer?: NodeJS.Timeout
  completionNotificationQueued: boolean
  eventEmitter: EventEmitter
}

export interface TerminalProcessNotification {
  id: string
  kind: 'input_requested' | 'completed'
  runId: string
  command: string
  status: TerminalProcessStatus
  exitCode: number | null
  output: string
  detectedPrompt?: string
}

export interface InitialExecutionResult {
  completed: boolean
  runId: string
  output: string
  exitCode?: number | null
  isError?: boolean
}

const MAX_OUTPUT_BUFFER = 100_000
const PROMPT_DEBOUNCE_MS = 350
const PROMPT_CANDIDATE_LIMIT = 500
const sessions = new Map<string, TerminalProcessSession>()
const processEvents = new EventEmitter()
const pendingNotifications = new Map<string, TerminalProcessNotification[]>()

function stripAnsi(str: string): string {
  return str
    .replace(
      // eslint-disable-next-line no-control-regex
      /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g,
      ''
    )
    .replace(
      // eslint-disable-next-line no-control-regex
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      ''
    )
}

function appendOutput(session: TerminalProcessSession, rawText: string): void {
  const nextOutput = session.outputBuffer + rawText
  if (nextOutput.length <= MAX_OUTPUT_BUFFER) {
    session.outputBuffer = nextOutput
    return
  }

  session.outputTruncated = true
  session.outputBuffer = nextOutput.slice(-MAX_OUTPUT_BUFFER)
}

function getCleanOutput(session: TerminalProcessSession): string {
  const cleanOutput = stripAnsi(session.outputBuffer)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
  if (!session.outputTruncated) return cleanOutput
  return `[Earlier terminal output was truncated after ${MAX_OUTPUT_BUFFER} retained characters.]\n${cleanOutput}`
}

function createSnapshot(session: TerminalProcessSession): TerminalProcessSnapshot {
  return {
    runId: session.runId,
    chatId: session.chatId,
    command: session.command,
    status: session.status,
    exitCode: session.exitCode,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    isBackgrounded: session.isBackgrounded,
    awaitingInput: session.awaitingInput,
    ...(session.detectedPrompt ? { detectedPrompt: session.detectedPrompt } : {}),
    outputTruncated: session.outputTruncated
  }
}

function publishSnapshot(session: TerminalProcessSession): void {
  broadcastIpc('terminal-process-update', createSnapshot(session))
}

function enqueueNotification(chatId: string, notification: TerminalProcessNotification): void {
  const pending = pendingNotifications.get(chatId) || []
  pending.push(notification)
  pendingNotifications.set(chatId, pending)
  processEvents.emit('notification-pending', notification, chatId)
}

const PROMPT_WORD_PATTERN =
  /(?:enter|input|password|passphrase|continue|select|choose|press|confirm|proceed|overwrite|retry|type|digite|informe|senha|continuar|selecione|escolha|pressione|confirme|prosseguir|sobrescrever|tentar|introduzca|ingrese|contrase(?:n|ñ)a|continuar|seleccione|elija|presione|confirme|saisissez|entrez|mot de passe|continuer|selectionnez|sélectionnez|choisissez|appuyez|confirmez|eingeben|passwort|fortfahren|auswahlen|auswählen|drucken|drücken|bestatigen|bestätigen|inserisci|password|continua|seleziona|scegli|premi|conferma)(?:\s+[^\r\n]{0,160})?\s*$/iu
const DIRECT_PROMPT_PATTERN =
  /^(?:please\s+)?(?:enter|input|type|password|passphrase|continue|select|choose|press|confirm|proceed|overwrite|retry|digite|informe|senha|continuar|selecione|escolha|pressione|confirme|prosseguir|sobrescrever|tentar|introduzca|ingrese|contrase(?:n|ñ)a|seleccione|elija|presione|confirme|saisissez|entrez|mot de passe|continuer|selectionnez|sélectionnez|choisissez|appuyez|confirmez|eingeben|passwort|fortfahren|auswahlen|auswählen|drucken|drücken|bestatigen|bestätigen|inserisci|continua|seleziona|scegli|premi|conferma)\b[^\r\n]{0,180}[?:]?\s*$/iu
const MENU_INSTRUCTION_PATTERN =
  /(?:use (?:the )?(?:arrow|up and down) keys|move with (?:the )?arrow keys|navigate with (?:the )?arrow keys|press (?:enter|return) to select|space to select|utilize as setas|use as setas|teclas de seta|flechas para|touches fléchées|pfeiltasten|tasti freccia)/iu
const MENU_CURSOR_PATTERN = /^\s*(?:❯|›|»|●|○|◉|◯|▶|▷|>)\s+\S/u

function detectPromptCandidate(output: string): string | null {
  const cleanOutput = stripAnsi(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const endsWithLineBreak = /\n\s*$/.test(cleanOutput)
  const lines = cleanOutput.split('\n')
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
  const candidate = (nonEmptyLines[nonEmptyLines.length - 1] || '').trim()
  if (!candidate || candidate.length > PROMPT_CANDIDATE_LIMIT) return null

  const recentBlock = nonEmptyLines.slice(-12).join('\n').slice(-PROMPT_CANDIDATE_LIMIT)
  const hasMenuInstruction = MENU_INSTRUCTION_PATTERN.test(recentBlock)
  const hasMenuCursor = nonEmptyLines.slice(-12).some((line) => MENU_CURSOR_PATTERN.test(line))
  const hasMenuQuestion = nonEmptyLines
    .slice(-12)
    .some((line) => /(?:^|\s)\?\s*\S/u.test(line) || PROMPT_WORD_PATTERN.test(line.trim()))
  if (hasMenuInstruction || (hasMenuCursor && hasMenuQuestion)) return recentBlock

  const hasPromptPunctuation = /(?:\?|:|›|»|>)\s*$/u.test(candidate)
  const hasChoiceMarker =
    /(?:\[[^\]\r\n]{1,40}(?:\/|\|)[^\]\r\n]{1,40}\]|\([^()\r\n]{1,40}(?:\/|\|)[^()\r\n]{1,40}\))\s*[?:>]?\s*$/u.test(
      candidate
    )
  const hasPromptWords = PROMPT_WORD_PATTERN.test(candidate)

  if (hasChoiceMarker) return candidate
  if (DIRECT_PROMPT_PATTERN.test(candidate)) return candidate
  if (!endsWithLineBreak && (hasPromptPunctuation || hasPromptWords)) return candidate
  return null
}

function markInputRequested(session: TerminalProcessSession, detectedPrompt: string): void {
  if (session.status !== 'running' || session.awaitingInput) return

  const fingerprint = `${detectedPrompt}\u0000${session.outputBuffer.length}`
  if (session.lastPromptFingerprint === fingerprint) return

  session.lastPromptFingerprint = fingerprint
  session.awaitingInput = true
  session.detectedPrompt = detectedPrompt
  session.isBackgrounded = true

  const notification: TerminalProcessNotification = {
    id: `${session.runId}:input:${Date.now()}`,
    kind: 'input_requested',
    runId: session.runId,
    command: session.command,
    status: session.status,
    exitCode: session.exitCode,
    output: getCleanOutput(session) || '(No output produced yet).',
    detectedPrompt
  }

  enqueueNotification(session.chatId, notification)
  session.eventEmitter.emit('input-requested', notification)
  processEvents.emit('input-requested', session, notification)
  publishSnapshot(session)
}

function scheduleInputDetection(session: TerminalProcessSession): void {
  if (session.status !== 'running' || session.awaitingInput) return
  if (session.promptDetectionTimer) clearTimeout(session.promptDetectionTimer)

  session.promptDetectionTimer = setTimeout(() => {
    session.promptDetectionTimer = undefined
    const candidate = detectPromptCandidate(session.outputBuffer)
    if (candidate) markInputRequested(session, candidate)
  }, PROMPT_DEBOUNCE_MS)
}

function markBackgrounded(session: TerminalProcessSession): void {
  if (session.isBackgrounded) return
  session.isBackgrounded = true
  publishSnapshot(session)
}

function queueCompletionNotification(session: TerminalProcessSession): void {
  if (!session.isBackgrounded || session.completionNotificationQueued) return
  session.completionNotificationQueued = true
  enqueueNotification(session.chatId, {
    id: `${session.runId}:completed:${Date.now()}`,
    kind: 'completed',
    runId: session.runId,
    command: session.command,
    status: session.status,
    exitCode: session.exitCode,
    output:
      getCleanOutput(session) ||
      (session.status === 'completed'
        ? 'Executed successfully (no output).'
        : `Failed with exit code ${session.exitCode}.`)
  })
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
  const parts = trimmed
    .split(/[-+]/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''

  let ctrl = false
  let alt = false
  let shift = false
  let baseKey = ''

  for (let i = 0; i < parts.length; i++) {
    const partLower = parts[i].toLowerCase()
    if (partLower === 'ctrl' || partLower === 'control') {
      ctrl = true
    } else if (
      partLower === 'alt' ||
      partLower === 'meta' ||
      partLower === 'opt' ||
      partLower === 'option'
    ) {
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
    return alt ? '\x1b\r' : '\r'
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
      1: 'P',
      2: 'Q',
      3: 'R',
      4: 'S',
      5: '15~',
      6: '17~',
      7: '18~',
      8: '19~',
      9: '20~',
      10: '21~',
      11: '23~',
      12: '24~'
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
  event?: IpcMainEvent
}

/**
 * Spawns a shell process inside a pseudoterminal with bidirectional lifecycle tracking.
 */
export function spawnGuardedTerminalProcess(
  command: string,
  options: SpawnTerminalOptions
): TerminalProcessSession {
  const isWindows = process.platform === 'win32'
  const shellToUse = options.shell || (isWindows ? 'powershell.exe' : '/bin/sh')
  const runId = generateRunId(options.chatId)
  const sessionKey = getSessionKey(options.chatId, runId)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONLEGACYWINDOWSSTDIO: '0',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8'
  }
  if (options.apiKey) {
    env.GEMINI_API_KEY = options.apiKey
  }

  let spawnArgs: string[] = []
  const spawnFile = shellToUse

  const lowerShell = shellToUse.toLowerCase()
  if (isWindows) {
    if (lowerShell.includes('powershell') || lowerShell.includes('pwsh')) {
      const utf8Prefix = `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; `
      spawnArgs = ['-NoLogo', '-NoProfile', '-Command', `${utf8Prefix}${command}`]
    } else if (lowerShell.includes('cmd')) {
      spawnArgs = ['/d', '/s', '/c', `chcp 65001 > nul & ${command}`]
    } else if (lowerShell.includes('bash')) {
      spawnArgs = ['-c', command]
    } else {
      spawnArgs = ['-c', command]
    }
  } else {
    spawnArgs = ['-c', command]
  }

  const terminalProcess = pty.spawn(spawnFile, spawnArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: options.cwd,
    env,
    ...(isWindows ? { useConpty: true } : {})
  })
  const eventEmitter = new EventEmitter()

  const session: TerminalProcessSession = {
    runId,
    chatId: options.chatId,
    command,
    process: terminalProcess,
    status: 'running',
    outputBuffer: '',
    outputTruncated: false,
    exitCode: null,
    startedAt: Date.now(),
    completedAt: null,
    isBackgrounded: false,
    awaitingInput: false,
    completionNotificationQueued: false,
    eventEmitter
  }

  sessions.set(sessionKey, session)

  const appendChunk = (rawText: string): void => {
    appendOutput(session, rawText)

    if (options.event && options.chatId) {
      safeSend(options.event.sender, 'chat-tool-update', {
        toolCallName: 'execute_terminal_command',
        update: { outputChunk: rawText, runId: session.runId },
        chatId: options.chatId
      })
    }

    eventEmitter.emit('data', rawText)
    scheduleInputDetection(session)
  }

  terminalProcess.onData(appendChunk)
  terminalProcess.onExit(({ exitCode }) => {
    if (session.promptDetectionTimer) {
      clearTimeout(session.promptDetectionTimer)
      session.promptDetectionTimer = undefined
    }
    if (session.status !== 'killed') {
      session.status = exitCode === 0 ? 'completed' : 'failed'
    }
    session.exitCode = exitCode
    session.awaitingInput = false
    session.detectedPrompt = undefined
    session.completedAt = Date.now()
    eventEmitter.emit('close', exitCode)
    queueCompletionNotification(session)
    publishSnapshot(session)
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
      markBackgrounded(session)

      const cleanOutput = getCleanOutput(session)
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

    session.eventEmitter.once('input-requested', (notification: TerminalProcessNotification) => {
      if (resolved) return
      clearTimeout(timeoutTimer)
      resolved = true

      resolve({
        completed: false,
        runId: session.runId,
        output:
          `Terminal input is required. The command is still running in the background with Run ID: ${session.runId}.\n\n` +
          `Detected prompt: ${notification.detectedPrompt || '(Prompt text unavailable).'}\n\n` +
          `The complete output-so-far snapshot has been queued as a system notification. Use send_terminal_input to answer without asking the user unless their decision is genuinely required.`
      })
    })

    session.eventEmitter.once('close', (code) => {
      if (resolved) return
      clearTimeout(timeoutTimer)
      resolved = true

      const cleanOutput = getCleanOutput(session)
      const finalOutput =
        cleanOutput ||
        (code === 0
          ? 'Command executed successfully (no output).'
          : `Command failed with exit code ${code}.`)

      resolve({
        completed: true,
        runId: session.runId,
        output: finalOutput,
        exitCode: code,
        isError: code !== 0
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

  const cleanOutput = getCleanOutput(targetSession)
  const statusStr = targetSession.status.toUpperCase()
  const exitCodeStr =
    targetSession.exitCode !== null ? ` (Exit Code: ${targetSession.exitCode})` : ''

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
      payload += '\r'
    }
  }

  if (!payload) {
    return `Error: No input text or key sequence was specified.`
  }

  const initialBuffer = targetSession.outputBuffer
  targetSession.awaitingInput = false
  targetSession.detectedPrompt = undefined
  publishSnapshot(targetSession)

  try {
    targetSession.process.write(payload)
  } catch (err) {
    return `Error writing to stdin: ${err instanceof Error ? err.message : String(err)}`
  }

  // Wait a short window (1.5s) to capture immediate response from the terminal
  await new Promise((r) => setTimeout(r, 1500))

  const newOutput = targetSession.outputBuffer.startsWith(initialBuffer)
    ? targetSession.outputBuffer.slice(initialBuffer.length)
    : targetSession.outputBuffer
  const cleanNewOutput = stripAnsi(newOutput).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const statusStr = targetSession.status.toUpperCase()

  return (
    `Input sent successfully to Run ID ${targetSession.runId} (Status: ${statusStr}).\n` +
    (cleanNewOutput
      ? `New terminal output:\n${cleanNewOutput}`
      : `(No new output produced after input).`)
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
    targetSession.awaitingInput = false
    targetSession.detectedPrompt = undefined
    publishSnapshot(targetSession)
    if (process.platform === 'win32' && targetSession.process.pid) {
      spawn('taskkill', ['/pid', targetSession.process.pid.toString(), '/T', '/F'], {
        windowsHide: true
      })
    } else {
      targetSession.process.kill()
    }
    return `Successfully terminated terminal process with Run ID "${runId}".`
  } catch (err) {
    return `Error terminating process "${runId}": ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Drains queued terminal input/completion notifications for a chat.
 */
export function getPendingProcessNotifications(chatId: string): TerminalProcessNotification[] {
  const pending = pendingNotifications.get(chatId) || []
  pendingNotifications.delete(chatId)
  return pending
}

export function getTerminalProcessesForChat(chatId: string): TerminalProcessSnapshot[] {
  return Array.from(sessions.values())
    .filter((session) => session.chatId === chatId && session.isBackgrounded)
    .sort((left, right) => left.startedAt - right.startedAt)
    .map(createSnapshot)
}

export function onTerminalNotificationPending(
  callback: (chatId: string, notification: TerminalProcessNotification) => void
): () => void {
  const handler = (notification: TerminalProcessNotification, chatId: string): void => {
    callback(chatId, notification)
  }
  processEvents.on('notification-pending', handler)
  return () => processEvents.off('notification-pending', handler)
}

/**
 * Registers a global listener for when any backgrounded process ends.
 */
export function onBackgroundProcessEnded(
  callback: (session: TerminalProcessSession) => void
): () => void {
  const handler = (session: TerminalProcessSession): void => {
    if (session.isBackgrounded) {
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
