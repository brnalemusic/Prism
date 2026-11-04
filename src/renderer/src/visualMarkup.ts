const VISUAL_TAGS = new Set(['svg', 'table', 'div', 'section', 'article', 'figure', 'style'])

export function getVisualMarkupRange(
  content: string
): { start: number; end: number | null } | null {
  const tags = /<\/?([a-z][\w-]*)\b[^>]*>/gi
  const stack: string[] = []
  let start: number | null = null
  let end: number | null = null
  const fencedCode = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g
  let cursor = 0

  const processSegment = (source: string, offset: number): boolean => {
    tags.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = tags.exec(source))) {
      const tag = match[1].toLowerCase()
      if (!VISUAL_TAGS.has(tag)) continue
      const token = match[0]
      if (token.startsWith('</')) {
        const index = stack.lastIndexOf(tag)
        if (index !== -1) {
          stack.splice(index, 1)
          if (stack.length === 0 && start !== null) {
            end = offset + tags.lastIndex
            return true
          }
        }
      } else if (!token.endsWith('/>')) {
        if (start === null) start = offset + match.index
        stack.push(tag)
      }
    }
    return false
  }

  let fence: RegExpExecArray | null
  while ((fence = fencedCode.exec(content))) {
    if (processSegment(content.slice(cursor, fence.index), cursor)) break
    cursor = fencedCode.lastIndex
  }
  if (start === null || end === null) processSegment(content.slice(cursor), cursor)

  return start === null ? null : { start, end }
}
