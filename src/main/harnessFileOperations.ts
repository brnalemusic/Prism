export interface PreparedFileChange {
  kind: 'add' | 'update' | 'delete' | 'move'
  path: string
  targetPath?: string
  before: string
  after: string
}

export interface HarnessPatchSection {
  kind: 'add' | 'delete' | 'update'
  path: string
  moveTo?: string
  lines: string[]
}

export function occurrenceCount(content: string, snippet: string): number {
  if (!snippet) return 0
  let count = 0
  let offset = 0
  while (true) {
    const index = content.indexOf(snippet, offset)
    if (index === -1) return count
    count += 1
    offset = index + Math.max(1, snippet.length)
  }
}

export function replaceUnique(content: string, oldText: string, newText: string): string {
  const count = occurrenceCount(content, oldText)
  if (count === 0)
    throw new Error('The exact oldText snippet was not found. Read the file and retry.')
  if (count > 1) {
    throw new Error(
      `The oldText snippet matched ${count} locations. Include more surrounding text.`
    )
  }
  return content.replace(oldText, newText)
}

export function replaceUniqueAfter(
  content: string,
  oldText: string,
  newText: string,
  startIndex: number
): { content: string; nextIndex: number } {
  const searchArea = content.slice(startIndex)
  const count = occurrenceCount(searchArea, oldText)
  if (count === 0) throw new Error('Patch context was not found after the selected @@ scope.')
  if (count > 1) {
    throw new Error(
      `Patch context matched ${count} locations after the selected @@ scope. Add more context.`
    )
  }
  const matchIndex = content.indexOf(oldText, startIndex)
  const updated = `${content.slice(0, matchIndex)}${newText}${content.slice(matchIndex + oldText.length)}`
  return { content: updated, nextIndex: matchIndex + newText.length }
}

function lineRange(start: number, count: number): string {
  if (count === 1) return String(start)
  return `${start},${count}`
}

export function unifiedDiff(relativePath: string, before: string, after: string): string {
  const beforeLines = before.replace(/\r\n/g, '\n').split('\n')
  const afterLines = after.replace(/\r\n/g, '\n').split('\n')
  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const contextStart = Math.max(0, prefix - 3)
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + 3)
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + 3)
  const oldChunk = beforeLines.slice(contextStart, beforeEnd)
  const newChunk = afterLines.slice(contextStart, afterEnd)
  const sharedPrefix = Math.max(0, prefix - contextStart)
  const sharedSuffix = Math.min(3, suffix)
  const body: string[] = []
  body.push(...oldChunk.slice(0, sharedPrefix).map((line) => ` ${line}`))
  body.push(
    ...oldChunk.slice(sharedPrefix, oldChunk.length - sharedSuffix).map((line) => `-${line}`)
  )
  body.push(
    ...newChunk.slice(sharedPrefix, newChunk.length - sharedSuffix).map((line) => `+${line}`)
  )
  if (sharedSuffix > 0) body.push(...oldChunk.slice(-sharedSuffix).map((line) => ` ${line}`))
  return [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${lineRange(contextStart + 1, oldChunk.length)} +${lineRange(contextStart + 1, newChunk.length)} @@`,
    ...body
  ].join('\n')
}

export function changesDiff(changes: PreparedFileChange[]): string {
  return changes
    .map((change) => {
      const header =
        change.kind === 'move' && change.targetPath
          ? `rename from ${change.path}\nrename to ${change.targetPath}\n`
          : ''
      return `${header}${unifiedDiff(change.targetPath || change.path, change.before, change.after)}`
    })
    .join('\n\n')
}

export function parsePatchSections(patchText: string): HarnessPatchSection[] {
  const normalized = patchText.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '*** Begin Patch') throw new Error('Patch must start with *** Begin Patch.')
  const endIndex = lines.lastIndexOf('*** End Patch')
  if (endIndex === -1) throw new Error('Patch must end with *** End Patch.')
  if (lines.slice(endIndex + 1).some((line) => line.trim())) {
    throw new Error('Patch must not contain content after *** End Patch.')
  }
  const sections: HarnessPatchSection[] = []
  let index = 1
  while (index < endIndex) {
    if (!lines[index]) {
      index += 1
      continue
    }
    const header = lines[index].match(/^\*\*\* (Add|Delete|Update) File: (.+)$/)
    if (!header) throw new Error(`Invalid patch header: ${lines[index]}`)
    const section: HarnessPatchSection = {
      kind: header[1].toLowerCase() as HarnessPatchSection['kind'],
      path: header[2].trim(),
      lines: []
    }
    index += 1
    if (section.kind === 'update' && lines[index]?.startsWith('*** Move to: ')) {
      section.moveTo = lines[index].slice('*** Move to: '.length).trim()
      index += 1
    }
    while (index < endIndex && !/^\*\*\* (Add|Delete|Update) File: /.test(lines[index])) {
      section.lines.push(lines[index])
      index += 1
    }
    sections.push(section)
  }
  if (sections.length === 0) throw new Error('Patch contains no file operations.')
  return sections
}
