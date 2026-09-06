import type { ChatRoundItem, Message, StreamingToolCall, ToolCallItem } from './types/tab'

export function parseStreamingArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {
    /* Read complete characters from an unfinished JSON string. */
  }
  const args: Record<string, unknown> = {}
  for (const key of ['progressTitle', 'completedTitle']) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
    if (!match) continue
    // A trailing escape (including a partial unicode escape) is not display text.
    const value = match[1].replace(/\\(?:u[\da-fA-F]{0,3})?$/, '')
    try {
      args[key] = JSON.parse(`"${value}"`)
    } catch {
      /* Wait for a complete escape. */
    }
  }
  return args
}

export function upsertChatRound(
  rounds: ChatRoundItem[] = [],
  round: number,
  content?: string
): ChatRoundItem[] {
  const existing = rounds.find((item) => item.round === round)
  if (existing)
    return content === undefined
      ? rounds
      : rounds.map((item) => (item === existing ? { ...item, content } : item))
  return [...rounds, { round, content: content ?? '' }].sort((a, b) => a.round - b.round)
}

export function anchorStreamingCalls(
  previous: StreamingToolCall[] = [],
  incoming: StreamingToolCall[],
  round: number,
  content: string
): StreamingToolCall[] {
  return incoming.map((call) => {
    const existing = previous.find((item) => item.round === round && item.index === call.index)
    return {
      ...call,
      round,
      timelineKey: existing?.timelineKey ?? `round-${round}-call-${call.index}`,
      textOffset: existing?.textOffset ?? content.length
    }
  })
}

/** Transfer the reserved position before retiring the streaming representation. */
export function bindChatTool(
  msg: Pick<Message, 'toolCalls' | 'streamingToolCalls' | 'chatRounds'>,
  callId: string,
  name: string,
  round?: number
): void {
  const pending =
    msg.streamingToolCalls?.find((call) => call.id === callId) ??
    msg.streamingToolCalls?.find(
      (call) => !call.id && call.name === name && (round === undefined || call.round === round)
    )
  const existing = msg.toolCalls?.find((call) => call.id === callId)
  const targetRound =
    existing?.round ?? pending?.round ?? round ?? msg.chatRounds?.at(-1)?.round ?? 1
  const content = msg.chatRounds?.find((item) => item.round === targetRound)?.content ?? ''
  msg.toolCalls = msg.toolCalls?.map((call) =>
    call.id === callId
      ? {
          ...call,
          args: { ...parseStreamingArgs(pending?.arguments ?? ''), ...call.args },
          round: targetRound,
          callIndex: call.callIndex ?? pending?.index,
          timelineKey: call.timelineKey ?? pending?.timelineKey ?? `call-${callId}`,
          textOffset: call.textOffset ?? pending?.textOffset ?? content.length
        }
      : call
  )
  msg.chatRounds = upsertChatRound(msg.chatRounds, targetRound)
  msg.streamingToolCalls = msg.streamingToolCalls?.filter((call) => call !== pending)
}

export function chatToolCalls(
  msg: Pick<Message, 'toolCalls' | 'streamingToolCalls'>
): ToolCallItem[] {
  const calls = [...(msg.toolCalls ?? [])]
  for (const pending of msg.streamingToolCalls ?? []) {
    if (
      calls.some((call) =>
        pending.id
          ? call.id === pending.id
          : Boolean(pending.timelineKey && call.timelineKey === pending.timelineKey)
      )
    )
      continue
    calls.push({
      ...pending,
      callIndex: pending.index,
      args: parseStreamingArgs(pending.arguments),
      status: pending.isComplete ? 'cancelled' : 'writing'
    })
  }
  return calls
}

export function finishChatTools(
  msg: Pick<Message, 'toolCalls' | 'streamingToolCalls'>,
  status: 'cancelled' | 'error'
): ToolCallItem[] {
  return chatToolCalls(msg).map((call) =>
    ['writing', 'running', 'cooldown'].includes(call.status) ? { ...call, status } : call
  )
}

export type ChatTimelineEntry =
  | { kind: 'text'; key: string; content: string; textOffset: number }
  | { kind: 'tool'; key: string; tool: ToolCallItem }

/** Text and tools share one sequence, including legacy inline tool markers. */
export function buildChatTimeline(
  msg: Pick<Message, 'content' | 'chatRounds' | 'toolCalls' | 'streamingToolCalls' | 'isStreaming'>
): ChatTimelineEntry[] {
  const calls = chatToolCalls(msg)
  const rounds = msg.chatRounds?.length ? [...msg.chatRounds] : [{ round: 1, content: msg.content }]
  for (const call of calls) {
    if (call.round !== undefined && !rounds.some((item) => item.round === call.round)) {
      rounds.push({ round: call.round, content: '' })
    }
  }
  rounds.sort((a, b) => a.round - b.round)
  const entries: ChatTimelineEntry[] = []
  const assigned = new Set<ToolCallItem>()
  let totalOffset = 0
  for (const round of rounds) {
    const positioned: Array<{ offset: number; end: number; tool: ToolCallItem; key: string }> = []
    const candidates = calls.filter(
      (call) => call.round === round.round || call.round === undefined
    )
    let tagIndex = 0
    for (const match of round.content.matchAll(
      /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)(?:\[\/PRISM_EXECUTE_TOOL\]|$)|<mini_app>([\s\S]*?)(?:<\/mini_app>|$)/gi
    )) {
      const miniApp = match[2] !== undefined
      const args = miniApp
        ? Object.fromEntries(
            ['title', 'html', 'css', 'js', 'progressTitle', 'completedTitle'].map((key) => [
              key,
              match[2].match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`, 'i'))?.[1] ?? ''
            ])
          )
        : parseStreamingArgs(match[1])
      const name = miniApp
        ? 'create_mini_app'
        : String(
            args.type ??
              args.name ??
              match[1].match(/"(?:type|name)"\s*:\s*"([^"]*)/)?.[1] ??
              match[1].match(/<name>([\s\S]*?)(?:<\/name>|$)/i)?.[1]?.trim() ??
              ''
          )
      const id =
        typeof args.callId === 'string'
          ? args.callId
          : typeof args.id === 'string'
            ? args.id
            : undefined
      const call =
        (id ? candidates.find((item) => !assigned.has(item) && item.id === id) : undefined) ??
        candidates.find((item) => !assigned.has(item) && item.name === name)
      const key = call?.timelineKey ?? call?.id ?? `round-${round.round}-inline-${tagIndex++}`
      positioned.push({
        offset: match.index!,
        end: match.index! + match[0].length,
        key,
        tool: call ?? {
          name,
          args,
          status:
            miniApp && match[0].endsWith('</mini_app>')
              ? 'done'
              : msg.isStreaming
                ? 'writing'
                : 'done'
        }
      })
      if (call) assigned.add(call)
    }
    for (const call of candidates) {
      if (assigned.has(call) || (call.round === undefined && rounds.length > 1)) continue
      assigned.add(call)
      const offset = Math.min(call.textOffset ?? round.content.length, round.content.length)
      positioned.push({
        offset,
        end: offset,
        tool: call,
        key: call.timelineKey ?? call.id ?? `round-${round.round}-tool-${calls.indexOf(call)}`
      })
    }
    positioned.sort(
      (a, b) =>
        a.offset - b.offset ||
        (a.tool.callIndex ?? calls.indexOf(a.tool)) - (b.tool.callIndex ?? calls.indexOf(b.tool))
    )
    let cursor = 0
    let textIndex = 0
    const appendText = (end: number): void => {
      if (end <= cursor) return
      const content = round.content.slice(cursor, end)
      if (content.trim())
        entries.push({
          kind: 'text',
          key: `round-${round.round}-text-${textIndex++}`,
          content,
          textOffset: totalOffset + cursor
        })
    }
    for (const item of positioned) {
      appendText(item.offset)
      entries.push({ kind: 'tool', key: item.key, tool: item.tool })
      cursor = Math.max(cursor, item.end, item.offset)
    }
    appendText(round.content.length)
    totalOffset += round.content.length + 2
  }
  // Old histories may lack positions. Keep their actions accessible without assigning a fictitious round.
  for (const call of calls) {
    if (!assigned.has(call))
      entries.push({ kind: 'tool', key: call.id ?? `legacy-${calls.indexOf(call)}`, tool: call })
  }
  return entries
}

export function splitChatTimeline(entries: ChatTimelineEntry[]): {
  history: ChatTimelineEntry[]
  final: ChatTimelineEntry[]
  hasTools: boolean
} {
  const hasTools = entries.some((entry) => entry.kind === 'tool')
  const finalTextIndex = hasTools && entries.at(-1)?.kind === 'text' ? entries.length - 1 : -1
  const remainsVisible = (entry: ChatTimelineEntry, index: number): boolean =>
    !hasTools ||
    (entry.kind === 'tool' && entry.tool.name === 'create_mini_app') ||
    (entry.kind === 'tool' &&
      entry.tool.name === 'generate_image' &&
      entry.tool.status === 'done' &&
      entry.tool.attachments?.some((attachment) => attachment.kind === 'image') === true) ||
    index === finalTextIndex
  return {
    history: entries.filter((entry, index) => !remainsVisible(entry, index)),
    final: entries.filter(remainsVisible),
    hasTools
  }
}
