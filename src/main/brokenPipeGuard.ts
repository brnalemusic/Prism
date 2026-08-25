interface ErrorEmitter {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
}

const guardedStreams = new WeakSet<object>()

/** Prevents an orphaned Electron process from crashing when its parent log pipe closes. */
export function installBrokenPipeGuard(stream?: ErrorEmitter | null): void {
  if (!stream || guardedStreams.has(stream as object)) return
  guardedStreams.add(stream as object)
  stream.on('error', (error) => {
    if (error.code === 'EPIPE') return
    throw error
  })
}

export function installProcessOutputGuards(): void {
  installBrokenPipeGuard(process.stdout)
  installBrokenPipeGuard(process.stderr)
}
