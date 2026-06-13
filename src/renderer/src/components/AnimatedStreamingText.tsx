import React, { useContext, useLayoutEffect, useRef } from 'react'
import { Components } from 'react-markdown'

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

function createFadeSpan(textNode: HastNode, value: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: [STREAMING_CHUNK_FADE_CLASS]
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

  if (end <= boundary) return [node]
  if (start >= boundary) return [createFadeSpan(node, value)]

  const splitIndex = Math.max(0, Math.min(value.length, boundary - start))
  if (splitIndex <= 0) return [createFadeSpan(node, value)]
  if (splitIndex >= value.length) return [node]

  return [
    {
      ...node,
      value: value.slice(0, splitIndex)
    },
    createFadeSpan(node, value.slice(splitIndex))
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
            if (
              canFadeSkippedElement(child) &&
              shouldFadeNode(child, boundary, fallbackTextOffset)
            ) {
              addClassName(child, STREAMING_CHUNK_FADE_CLASS)
            }
            fallbackTextOffset += getTextLength(child)
            nextChildren.push(child)
            continue
          }

          visit(child)
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
    return <span {...props}>{wrapTextWithAnimation(children, isStreaming)}</span>
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
  }
}
