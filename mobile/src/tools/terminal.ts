import { NativeModules } from 'react-native'

interface PrismTerminalModule {
  execute(
    command: string,
    timeoutMs: number,
    maxOutputBytes: number
  ): Promise<{ exitCode: number; output: string; timedOut: boolean }>
  cancel(): void
}

const terminal = NativeModules.PrismTerminal as PrismTerminalModule | undefined

export async function executeAndroidCommand(command: string, signal: AbortSignal): Promise<string> {
  if (!terminal) throw new Error('Android terminal support is unavailable in this build.')
  const clean = command.trim()
  if (!clean || clean.length > 2000) throw new Error('Command must contain 1 to 2000 characters.')
  if (signal.aborted) throw new Error('Command cancelled.')
  const onAbort = (): void => terminal.cancel()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await terminal.execute(clean, 10_000, 32_000)
    if (signal.aborted) throw new Error('Command cancelled.')
    return `${result.timedOut ? '[Timed out after 10 seconds]\n' : ''}Exit code: ${result.exitCode}\n${result.output || '(no output)'}`
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
