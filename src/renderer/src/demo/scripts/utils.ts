import type { DemoEvent } from '../../../../shared/demo'

export function answerChunks(
  text: string,
  startAt: number,
  interval = 46,
  maxChars = 36
): DemoEvent[] {
  const chunks: DemoEvent[] = []
  let cursor = 0

  const originalChunksCount = Math.ceil(text.length / maxChars)
  const totalTime = originalChunksCount * interval

  const targetInterval = 12
  let subInterval = targetInterval
  let subChunkSize = Math.max(1, Math.round((subInterval / interval) * maxChars))

  if (subChunkSize < 2) {
    subChunkSize = 2
    const totalSubChunks = Math.ceil(text.length / subChunkSize)
    subInterval = totalSubChunks > 0 ? totalTime / totalSubChunks : interval
  } else if (subChunkSize > 8) {
    subChunkSize = 8
    const totalSubChunks = Math.ceil(text.length / subChunkSize)
    subInterval = totalSubChunks > 0 ? totalTime / totalSubChunks : interval
  }

  if (subInterval < 4) {
    subInterval = 4
    const totalSubChunks = Math.ceil(text.length / subChunkSize)
    subChunkSize = totalSubChunks > 0 ? Math.max(1, Math.round(text.length / (totalTime / 4))) : 4
  }

  let timeAccumulator = startAt
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + subChunkSize)
    chunks.push({
      kind: 'answer_chunk',
      text: text.slice(cursor, end),
      at: Math.round(timeAccumulator)
    })
    cursor = end
    timeAccumulator += subInterval
  }

  return chunks
}

export function doneAfter(events: DemoEvent[], offset = 650): DemoEvent {
  const lastAt = events.reduce((max, event) => Math.max(max, event.at), 0)
  return { kind: 'done', at: lastAt + offset }
}
