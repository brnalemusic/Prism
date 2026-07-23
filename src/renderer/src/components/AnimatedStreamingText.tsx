import React, { useContext, useLayoutEffect, useRef, useState } from 'react'
import { Components } from 'react-markdown'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-csharp'


export interface StreamContextType {
  isStreaming: boolean
  prevTotalLength: number
  charDuration: number
  globalCharCountRef: React.MutableRefObject<number>
}

// Context to coordinate typewriter animations globally across AST elements
export const StreamContext = React.createContext<StreamContextType>({
  isStreaming: false,
  prevTotalLength: 0,
  charDuration: 20,
  globalCharCountRef: { current: 0 }
})

function getCommonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a[index] === b[index]) {
    index++
  }
  return index
}

// Tracks the last committed stream text so render-time Markdown transforms can
// mark only the newly appended range. This avoids mutating refs during render.
export function useStreamStats(text: string, isStreaming: boolean): StreamContextType {
  const committedTextRef = useRef('')
  const lastTimeRef = useRef(0)
  const charDurationRef = useRef(20)
  const globalCharCountRef = useRef(0)

  const previousCommittedText = committedTextRef.current
  const prevTotalLength =
    isStreaming && text !== previousCommittedText
      ? text.startsWith(previousCommittedText)
        ? previousCommittedText.length
        : getCommonPrefixLength(previousCommittedText, text)
      : text.length

  useLayoutEffect(() => {
    if (!isStreaming) {
      committedTextRef.current = text
      lastTimeRef.current = 0
      charDurationRef.current = 20
      return
    }

    const previousText = committedTextRef.current
    if (text === previousText) return

    const now = performance.now()
    const lastTime = lastTimeRef.current
    const deltaTime = lastTime === 0 ? 100 : now - lastTime
    lastTimeRef.current = now

    const stablePrefixLength = text.startsWith(previousText)
      ? previousText.length
      : getCommonPrefixLength(previousText, text)
    const addedLength = text.length - stablePrefixLength

    if (addedLength > 0) {
      const rawSpeed = deltaTime / addedLength
      charDurationRef.current = Math.max(8, Math.min(45, rawSpeed))
    }

    committedTextRef.current = text
  }, [isStreaming, text])

  return {
    isStreaming,
    prevTotalLength,
    charDuration: charDurationRef.current,
    globalCharCountRef
  }
}

export interface AnimatedStreamingTextProps {
  text: string
  isStreaming?: boolean
  mode?: 'words' | 'chars'
}

export function AnimatedStreamingText({ text }: AnimatedStreamingTextProps): React.JSX.Element {
  return <>{text}</>
}

interface HastPosition {
  start?: {
    offset?: number
  }
  end?: {
    offset?: number
  }
}

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: HastPosition
}

const STREAMING_CHUNK_FADE_CLASS = 'streaming-chunk-fade'

function getOffset(positionPoint: HastPosition['start']): number | undefined {
  return typeof positionPoint?.offset === 'number' ? positionPoint.offset : undefined
}

function getClassList(properties: Record<string, unknown> | undefined): string[] {
  const className = properties?.className
  if (Array.isArray(className)) return className.map(String)
  if (typeof className === 'string') return className.split(/\s+/).filter(Boolean)
  return []
}

function shouldSkipChildren(node: HastNode): boolean {
  if (node.type !== 'element') return false

  const tagName = node.tagName?.toLowerCase()
  if (tagName === 'script' || tagName === 'style' || tagName === 'svg') return true

  const classes = getClassList(node.properties)
  return classes.some(
    (className) =>
      className === 'katex' ||
      className === 'math' ||
      className === 'math-inline' ||
      className === 'math-display'
  )
}

function canFadeSkippedElement(node: HastNode): boolean {
  if (node.type !== 'element') return false

  const tagName = node.tagName?.toLowerCase()
  if (tagName === 'script' || tagName === 'style' || tagName === 'svg') return false

  const classes = getClassList(node.properties)
  return classes.some(
    (className) =>
      className === 'katex' ||
      className === 'math' ||
      className === 'math-inline' ||
      className === 'math-display'
  )
}

function addClassName(node: HastNode, className: string): void {
  const classList = getClassList(node.properties)
  if (classList.includes(className)) return

  node.properties = {
    ...(node.properties || {}),
    className: [...classList, className]
  }
}

function setStreamToken(node: HastNode, token: string): void {
  node.properties = {
    ...(node.properties || {}),
    dataStreamToken: token,
    'data-stream-token': token
  }
}

function getTextLength(node: HastNode): number {
  if (node.type === 'text') return node.value?.length || 0
  return node.children?.reduce((total, child) => total + getTextLength(child), 0) || 0
}

function shouldFadeNode(node: HastNode, boundary: number, fallbackStart: number): boolean {
  const textLength = getTextLength(node)
  if (textLength === 0) return false

  const positionedStart = getOffset(node.position?.start)
  const positionedEnd = getOffset(node.position?.end)
  const start = positionedStart ?? fallbackStart
  const end = positionedEnd ?? start + textLength

  return end > boundary
}

function createFadeSpan(textNode: HastNode, value: string, token: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: [STREAMING_CHUNK_FADE_CLASS],
      dataStreamToken: token,
      'data-stream-token': token
    },
    children: [
      {
        ...textNode,
        value
      }
    ],
    position: textNode.position
  }
}

function splitTextNodeForFade(node: HastNode, boundary: number, fallbackStart: number): HastNode[] {
  const value = node.value || ''
  if (!value) return [node]

  const positionedStart = getOffset(node.position?.start)
  const positionedEnd = getOffset(node.position?.end)
  const start = positionedStart ?? fallbackStart
  const end = positionedEnd ?? start + value.length
  const token = `${boundary}:${start}:${end}`

  if (end <= boundary) return [node]
  if (start >= boundary) return [createFadeSpan(node, value, token)]

  const splitIndex = Math.max(0, Math.min(value.length, boundary - start))
  if (splitIndex <= 0) return [createFadeSpan(node, value, token)]
  if (splitIndex >= value.length) return [node]

  return [
    {
      ...node,
      value: value.slice(0, splitIndex)
    },
    createFadeSpan(node, value.slice(splitIndex), token)
  ]
}

export function createStreamingFadeRehypePlugin(
  streamStats: StreamContextType,
  partStartOffset = 0
): () => (tree: HastNode) => void {
  const localBoundary = streamStats.prevTotalLength - partStartOffset

  return () =>
    (tree: HastNode): void => {
      if (!streamStats.isStreaming || localBoundary >= Number.MAX_SAFE_INTEGER) return

      const boundary = Math.max(0, localBoundary)
      let fallbackTextOffset = 0

      const visit = (node: HastNode): void => {
        if (!node.children || shouldSkipChildren(node)) return

        const nextChildren: HastNode[] = []
        for (const child of node.children) {
          if (child.type === 'text') {
            nextChildren.push(...splitTextNodeForFade(child, boundary, fallbackTextOffset))
            fallbackTextOffset += child.value?.length || 0
            continue
          }

          if (shouldSkipChildren(child)) {
            const childTextLength = getTextLength(child)
            if (
              canFadeSkippedElement(child) &&
              shouldFadeNode(child, boundary, fallbackTextOffset)
            ) {
              addClassName(child, STREAMING_CHUNK_FADE_CLASS)
              setStreamToken(
                child,
                `${boundary}:${fallbackTextOffset}:${fallbackTextOffset + childTextLength}`
              )
            }
            fallbackTextOffset += childTextLength
            nextChildren.push(child)
            continue
          }

          visit(child)
          fallbackTextOffset += getTextLength(child)
          nextChildren.push(child)
        }

        node.children = nextChildren
      }

      visit(tree)
    }
}

const wrapTextWithAnimation = (
  children: React.ReactNode,
  _isStreaming: boolean
): React.ReactNode => {
  return children
}

interface StreamingSpanProps extends React.ComponentPropsWithoutRef<'span'> {
  node?: unknown
  dataStreamToken?: string
  'data-stream-token'?: string
}

function StreamingSpan({
  children,
  className,
  dataStreamToken,
  'data-stream-token': dataStreamTokenAttribute,
  node: _node,
  ...props
}: StreamingSpanProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const streamToken = dataStreamTokenAttribute ?? dataStreamToken
  const isStreamingFade =
    typeof className === 'string' && className.split(/\s+/).includes(STREAMING_CHUNK_FADE_CLASS)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !isStreamingFade) return

    element.style.animation = 'none'
    void element.offsetWidth
    element.style.animation = ''
  }, [streamToken, isStreamingFade])

  return (
    <span ref={ref} className={className} data-stream-token={streamToken} {...props}>
      {children}
    </span>
  )
}

function renderToken(token: string | Prism.Token, key: string | number): React.ReactNode {
  if (typeof token === 'string') {
    return token
  }

  const className = `token ${token.type} ${
    Array.isArray(token.alias) ? token.alias.join(' ') : token.alias || ''
  }`

  if (typeof token.content === 'string') {
    return (
      <span key={key} className={className}>
        {token.content}
      </span>
    )
  }

  if (Array.isArray(token.content)) {
    return (
      <span key={key} className={className}>
        {token.content.map((child, i) => renderToken(child, `${key}-${i}`))}
      </span>
    )
  }

  return renderToken(token.content, key)
}

const getGrammar = (lang: string) => {
  const normalized = lang.toLowerCase()
  const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    sh: 'bash',
    shell: 'bash',
    py: 'python',
    rs: 'rust',
    yml: 'yaml',
    md: 'markdown',
    html: 'markup',
    xml: 'markup',
    cs: 'csharp'
  }
  const target = aliases[normalized] || normalized
  return Prism.languages[target]
}

export const CodeBlock = ({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const isInline = !match
  const codeContent = String(children).replace(/\n$/, '')

  if (isInline) {
    return (
      <code
        className="text-accent-secondary font-mono text-[13px] font-medium tracking-tight bg-transparent border-none p-0 mx-0.5 inline select-text"
        style={{
          fontFamily:
            "'Cascadia Code', 'Fira Code', 'Ubuntu Mono', 'JetBrains Mono', 'Liberation Mono', 'DejaVu Sans Mono', 'Consolas', monospace"
        }}
        {...props}
      >
        {children}
      </code>
    )
  }

  const lang = match ? match[1] : 'text'
  const grammar = getGrammar(lang)

  let renderedCode: React.ReactNode
  if (grammar) {
    const tokens = Prism.tokenize(codeContent, grammar)
    renderedCode = tokens.map((token, i) => renderToken(token, i))
  } else {
    renderedCode = codeContent
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl border border-white/[0.08] bg-[#07080a] shadow-lg font-mono text-xs w-full text-text-primary">
      <div className="flex items-center justify-between bg-white/[0.02] border-b border-white/[0.05] px-4 py-2 select-none">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">{lang}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200 active:scale-95 cursor-pointer min-w-[75px] justify-center"
        >
          <span>{copied ? 'Copied!' : 'Copy Code'}</span>
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <code className={`${className || ''} block whitespace-pre`} {...props}>
          {renderedCode}
        </code>
      </div>
    </div>
  )
}

// Static component definitions for ReactMarkdown. Re-rendered elements will reconcile stably.
export const StaticMarkdownComponents: Partial<Components> = {
  p: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <p {...props}>{wrapTextWithAnimation(children, isStreaming)}</p>
  },
  li: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <li {...props}>{wrapTextWithAnimation(children, isStreaming)}</li>
  },
  span: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <StreamingSpan {...props}>{wrapTextWithAnimation(children, isStreaming)}</StreamingSpan>
  },
  strong: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <strong {...props}>{wrapTextWithAnimation(children, isStreaming)}</strong>
  },
  em: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <em {...props}>{wrapTextWithAnimation(children, isStreaming)}</em>
  },
  h1: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <h1 {...props}>{wrapTextWithAnimation(children, isStreaming)}</h1>
  },
  h2: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <h2 {...props}>{wrapTextWithAnimation(children, isStreaming)}</h2>
  },
  h3: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <h3 {...props}>{wrapTextWithAnimation(children, isStreaming)}</h3>
  },
  h4: ({ children, ...props }) => {
    const { isStreaming } = useContext(StreamContext)
    return <h4 {...props}>{wrapTextWithAnimation(children, isStreaming)}</h4>
  },
  pre: ({ children }) => <>{children}</>,
  code: (props) => <CodeBlock {...props} />
}
