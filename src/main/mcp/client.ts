import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as os from 'os'
import type { McpToolInfo } from '../../shared/mcpTypes'

const PROTOCOL_VERSION = '2024-11-05'
const INITIALIZE_TIMEOUT_MS = 60_000
const TOOL_TIMEOUT_MS = 5 * 60_000

export interface McpClientLike {
  readonly serverId: string
  start(): Promise<void>
  listTools(): Promise<McpToolInfo[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>
  stop(): void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  cleanup: () => void
}

function normalizeSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { type: 'object', properties: {} }
}

function toolsFromResult(serverId: string, result: unknown): McpToolInfo[] {
  const record = result as { tools?: unknown } | null
  const tools = Array.isArray(record?.tools) ? record.tools : []
  return tools
    .map((tool) => {
      const entry = tool as { name?: unknown; description?: unknown; inputSchema?: unknown }
      if (typeof entry.name !== 'string' || !entry.name) return null
      return {
        serverId,
        name: entry.name,
        description: typeof entry.description === 'string' ? entry.description : '',
        inputSchema: normalizeSchema(entry.inputSchema)
      }
    })
    .filter((tool): tool is McpToolInfo => tool !== null)
}

function textFromCallResult(result: unknown): string {
  const record = result as { content?: unknown; isError?: unknown } | null
  const content = Array.isArray(record?.content) ? record.content : []
  const text = content
    .map((part) => {
      const entry = part as { type?: string; text?: string; resource?: unknown }
      if (entry.type === 'text' && typeof entry.text === 'string') return entry.text
      if (entry.type === 'resource' && entry.resource) return JSON.stringify(entry.resource)
      if (entry.type === 'image') return '[image]'
      return entry.type ? `[${entry.type}]` : ''
    })
    .filter(Boolean)
    .join('\n')
  if (record?.isError) throw new Error(text || 'The MCP tool reported an error.')
  return text || JSON.stringify(result ?? {})
}

/**
 * Quotes one argument for cmd.exe. On Windows the client runs commands through
 * the shell so `npx`/`uvx` shims resolve; every argument is quoted explicitly.
 */
function quoteForCmd(value: string): string {
  if (value === '') return '""'
  if (!/[\s"&|<>^()%!]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export class McpStdioClient implements McpClientLike {
  readonly serverId: string
  private readonly command: string
  private readonly args: string[]
  private readonly env: NodeJS.ProcessEnv
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private buffer = ''
  private stderr = ''
  private readonly pending = new Map<number, PendingRequest>()

  constructor(serverId: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
    this.serverId = serverId
    this.command = command
    this.args = args
    this.env = env
  }

  async start(): Promise<void> {
    if (this.child) return
    const isWindows = process.platform === 'win32'
    const command = isWindows ? quoteForCmd(this.command) : this.command
    const args = isWindows ? this.args.map(quoteForCmd) : this.args

    const child = spawn(command, args, {
      cwd: os.homedir(),
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams

    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000)
    })
    child.on('error', (error) => this.failAll(new Error(`MCP server failed to start: ${error.message}`)))
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      this.failAll(
        new Error(
          `MCP server exited${code === null ? '' : ` with code ${code}`}.${this.stderr ? `\n${this.stderr}` : ''}`
        )
      )
    })

    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Prism', version: '1.0.0' }
      },
      INITIALIZE_TIMEOUT_MS
    )
    this.notify('notifications/initialized', {})
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request('tools/list', {}, INITIALIZE_TIMEOUT_MS)
    return toolsFromResult(this.serverId, result)
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const result = await this.request(
      'tools/call',
      { name, arguments: args },
      TOOL_TIMEOUT_MS,
      signal
    )
    return textFromCallResult(result)
  }

  stop(): void {
    const child = this.child
    if (!child) return
    const pid = child.pid
    this.child = null
    try {
      child.stdin.end()
    } catch {
      /* already closed */
    }
    try {
      child.kill()
    } catch {
      /* already closed */
    }
    if (process.platform === 'win32' && pid) {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
      } catch {
        /* best effort */
      }
    }
    this.failAll(new Error('MCP server stopped.'))
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleMessage(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleMessage(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    const id = typeof message.id === 'number' ? message.id : null
    if (id !== null && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      pending.cleanup()
      if (message.error) {
        const error = message.error as { message?: string }
        pending.reject(new Error(error.message || 'MCP request failed.'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (id !== null && typeof message.method === 'string') {
      const method = message.method
      if (method === 'ping') {
        this.send({ jsonrpc: '2.0', id, result: {} })
      } else if (method === 'roots/list') {
        this.send({ jsonrpc: '2.0', id, result: { roots: [] } })
      } else {
        this.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Prism does not support ${method}.` }
        })
      }
    }
  }

  private send(message: unknown): void {
    if (!this.child) return
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      /* the exit handler will fail the pending requests */
    }
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1

    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('MCP request cancelled.'))
        return
      }

      const onAbort = (): void => {
        this.pending.delete(id)
        cleanup()
        reject(new Error('MCP request cancelled.'))
      }

      const timer = setTimeout(() => {
        this.pending.delete(id)
        cleanup()
        reject(new Error(`MCP request timed out: ${method}`))
      }, timeoutMs)

      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }

      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve, reject, timer, cleanup })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
  }
}

/**
 * Minimal Streamable HTTP transport: JSON-RPC over POST, accepting either a
 * plain JSON body or an SSE stream, with `Mcp-Session-Id` support.
 */
export class McpHttpClient implements McpClientLike {
  readonly serverId: string
  private readonly endpoint: string
  private readonly extraHeaders: Record<string, string>
  private sessionId: string | null = null
  private nextId = 1

  constructor(serverId: string, url: string, headers: Record<string, string> = {}) {
    this.serverId = serverId
    this.endpoint = url
    this.extraHeaders = headers
  }

  async start(): Promise<void> {
    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Prism', version: '1.0.0' }
      },
      INITIALIZE_TIMEOUT_MS
    )
    await this.notify('notifications/initialized', {})
  }

  async listTools(): Promise<McpToolInfo[]> {
    return toolsFromResult(this.serverId, await this.request('tools/list', {}, INITIALIZE_TIMEOUT_MS))
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const result = await this.request(
      'tools/call',
      { name, arguments: args },
      TOOL_TIMEOUT_MS,
      signal
    )
    return textFromCallResult(result)
  }

  stop(): void {
    this.sessionId = null
  }

  private headers(): Record<string, string> {
    return {
      ...this.extraHeaders,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {})
    }
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params })
    })
    this.captureSession(response)
  }

  private captureSession(response: Response): void {
    const session = response.headers.get('mcp-session-id')
    if (session) this.sessionId = session
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = (): void => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal
      })
      this.captureSession(response)
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            'MCP sign-in was rejected. Reconnect this server in Settings → MCP and try again.'
          )
        }
        throw new Error(`MCP server returned HTTP ${response.status}.`)
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream')) {
        const body = await response.text()
        for (const line of body.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          let message: Record<string, unknown>
          try {
            message = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>
          } catch {
            continue
          }
          if (message.id !== id) continue
          if (message.error) {
            const error = message.error as { message?: string }
            throw new Error(error.message || 'MCP request failed.')
          }
          return message.result
        }
        throw new Error('MCP server returned an empty event stream.')
      }

      const message = (await response.json()) as Record<string, unknown>
      if (message.error) {
        const error = message.error as { message?: string }
        throw new Error(error.message || 'MCP request failed.')
      }
      return message.result
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
