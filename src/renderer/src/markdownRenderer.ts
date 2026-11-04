import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
}

function disableIndentedCode(this: {
  data: () => { micromarkExtensions?: { disable: { null: string[] } }[] }
}): void {
  const data = this.data()
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = [])
  micromarkExtensions.push({
    disable: {
      null: ['codeIndented']
    }
  })
}

/**
 * Matches LaTeX math expressions while avoiding currency formats (e.g. US$0.10, R$ 10,00, $10 and $20).
 *
 * 1. Display math: $$...$$ or \[...\]
 * 2. Inline math: \(...\)
 * 3. Inline math $...$:
 *    - Opening delimiter: $ NOT preceded by an alphanumeric character, backslash, or dollar sign.
 *    - Formula content: cannot begin or end with a space or newline.
 *    - Closing delimiter: $ NOT followed by digits (e.g. $20), space+digits, or alphanumeric characters.
 */
const MATH_REGEX =
  /(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![A-Za-z0-9\\$])\$([^\s$\n](?:[^$\n]*?[^\s$\\\n])?)\$(?!(?:\s*\d|[A-Za-z0-9])))/g

function rehypeParseMath(): (tree: HastNode) => void {
  return (tree: HastNode) => {
    function transform(node: HastNode): void {
      if (!node.children) return

      const newChildren: HastNode[] = []
      for (const child of node.children) {
        if (child.type === 'element' && (child.tagName === 'pre' || child.tagName === 'code')) {
          transform(child)
          newChildren.push(child)
          continue
        }

        if (child.type === 'text') {
          const text = child.value || ''
          MATH_REGEX.lastIndex = 0
          let lastIndex = 0
          let match: RegExpExecArray | null
          let matchedAny = false
          const localChildren: HastNode[] = []

          while ((match = MATH_REGEX.exec(text)) !== null) {
            matchedAny = true
            const matchStart = match.index
            const matchEnd = MATH_REGEX.lastIndex

            if (matchStart > lastIndex) {
              localChildren.push({
                type: 'text',
                value: text.slice(lastIndex, matchStart)
              })
            }

            const displayMath = match[1] ?? match[2]
            const inlineMath = match[3] ?? match[4]

            if (displayMath !== undefined) {
              localChildren.push({
                type: 'element',
                tagName: 'div',
                properties: { className: ['math', 'math-display'] },
                children: [{ type: 'text', value: displayMath.trim() }]
              })
            } else if (inlineMath !== undefined) {
              localChildren.push({
                type: 'element',
                tagName: 'span',
                properties: { className: ['math', 'math-inline'] },
                children: [{ type: 'text', value: inlineMath.trim() }]
              })
            }

            lastIndex = matchEnd
          }

          if (matchedAny) {
            if (lastIndex < text.length) {
              localChildren.push({
                type: 'text',
                value: text.slice(lastIndex)
              })
            }
            newChildren.push(...localChildren)
          } else {
            newChildren.push(child)
          }
        } else {
          transform(child)
          newChildren.push(child)
        }
      }
      node.children = newChildren
    }

    transform(tree)
  }
}

export const STREAMING_REMARK_PLUGINS = [remarkGfm]

const STREAMED_VISUAL_TAGS = new Set([
  'svg',
  'table',
  'div',
  'section',
  'article',
  'figure',
  'style'
])

export function getVisualMarkupRange(
  content: string
): { start: number; end: number | null } | null {
  const source = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
  const tags = /<\/?([a-z][\w-]*)\b[^>]*>/gi
  const stack: string[] = []
  let start: number | null = null
  let end: number | null = null
  let match: RegExpExecArray | null

  while ((match = tags.exec(source))) {
    const tag = match[1].toLowerCase()
    if (!STREAMED_VISUAL_TAGS.has(tag)) continue
    const token = match[0]
    if (token.startsWith('</')) {
      const index = stack.lastIndexOf(tag)
      if (index !== -1) {
        stack.splice(index, 1)
        if (stack.length === 0 && start !== null) {
          end = tags.lastIndex
          break
        }
      }
    } else if (!token.endsWith('/>')) {
      if (start === null) start = match.index
      stack.push(tag)
    }
  }

  return start === null ? null : { start, end }
}

export const STATIC_REMARK_PLUGINS = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }] as unknown as import('unified').Pluggable,
  remarkBreaks,
  disableIndentedCode as unknown as import('unified').Pluggable
]

export const STATIC_COMPLETED_REHYPE_PLUGINS = [rehypeRaw, rehypeParseMath, rehypeKatex]
