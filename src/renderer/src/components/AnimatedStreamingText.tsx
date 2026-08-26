import React, { useContext, useLayoutEffect, useReducer, useRef, useState } from 'react'
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
  animationClock: StreamingAnimationClock
}

interface CharacterTiming {
  startAt: number
  endAt: number
  duration: number
  units: number
}

interface StreamingAnimationClock {
  renderTime: number
  getTiming: (
    token: string,
    isNew: boolean,
    units?: number,
    duration?: number
  ) => CharacterTiming | undefined
}

interface StreamingTimeline {
  timings: Map<string, CharacterTiming>
  nextStartAt: number
  maxEndAt: number
  cadenceSamples: Array<{ duration: number; characters: number }>
}

const DEFAULT_CHARACTER_CADENCE = 4
const MIN_TIMELINE_INCREMENT = 0.001
const MAX_CHARACTER_CADENCE = 500
const OPACITY_DURATION = 260
const COLOR_DURATION = 390
const CADENCE_SAMPLE_COUNT = 6
const INITIAL_REVEAL_WINDOW = 320
const MIN_PREDICTED_CHUNK_INTERVAL = 40
const MAX_PREDICTED_CHUNK_INTERVAL = 4000
/** Target window used to drain a burst without changing the grapheme order. */
export const STREAMING_BACKLOG_WINDOW_MS = 320

const idleAnimationClock: StreamingAnimationClock = {
  renderTime: 0,
  getTiming: () => undefined
}

// Context to coordinate one monotonic animation timeline across all Markdown parts.
export const StreamContext = React.createContext<StreamContextType>({
  isStreaming: false,
  prevTotalLength: 0,
  charDuration: DEFAULT_CHARACTER_CADENCE,
  animationClock: idleAnimationClock
})

function getCommonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a[index] === b[index]) {
    index++
  }
  return index
}

// Tracks arrivals and keeps one animation clock alive across Markdown reparses.
/* eslint-disable react-hooks/refs, react-hooks/purity -- The HAST plugins share a monotonic, imperative animation clock. */
export function useStreamStats(text: string, isStreaming: boolean): StreamContextType {
  const committedTextRef = useRef('')
  const lastTimeRef = useRef(0)
  const charDurationRef = useRef(DEFAULT_CHARACTER_CADENCE)
  const wasStreamingRef = useRef(false)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timelineRef = useRef<StreamingTimeline>({
    timings: new Map(),
    nextStartAt: 0,
    maxEndAt: 0,
    cadenceSamples: []
  })
  const [, forceTimelineCleanup] = useReducer((version: number) => version + 1, 0)

  const previousCommittedText = committedTextRef.current
  const shouldAnimateNewText = isStreaming || wasStreamingRef.current
  const stablePrefixLength = text.startsWith(previousCommittedText)
    ? previousCommittedText.length
    : getCommonPrefixLength(previousCommittedText, text)
  const prevTotalLength =
    shouldAnimateNewText && text !== previousCommittedText ? stablePrefixLength : text.length

  const renderTime = performance.now()
  const timeline = timelineRef.current

  for (const [token, timing] of timeline.timings) {
    if (timing.endAt <= renderTime) timeline.timings.delete(token)
  }
  timeline.maxEndAt = Array.from(timeline.timings.values()).reduce(
    (latestEnd, timing) => Math.max(latestEnd, timing.endAt),
    0
  )

  if (text !== previousCommittedText && stablePrefixLength < previousCommittedText.length) {
    for (const token of timeline.timings.keys()) {
      const tokenStart = Number(token.split(':', 1)[0])
      if (Number.isFinite(tokenStart) && tokenStart >= stablePrefixLength) {
        timeline.timings.delete(token)
      }
    }

    const retainedTimings = Array.from(timeline.timings.values())
    timeline.maxEndAt = retainedTimings.reduce(
      (latestEnd, timing) => Math.max(latestEnd, timing.endAt),
      0
    )
    timeline.nextStartAt = retainedTimings.reduce(
      (latestStart, timing) =>
        Math.max(latestStart, timing.startAt + charDurationRef.current * timing.units),
      renderTime
    )
  }

  const hasRunningAnimations = timeline.maxEndAt > renderTime
  const isVisuallyStreaming = shouldAnimateNewText || hasRunningAnimations

  let renderCadence = charDurationRef.current
  let addedLength = 0
  if (shouldAnimateNewText && text !== previousCommittedText) {
    const addedText = stripNonVisualStreamingParts(text.slice(stablePrefixLength))
    addedLength = countGraphemes(addedText)
    const lastTime = lastTimeRef.current

    if (addedLength > 0 && lastTime > 0) {
      timeline.cadenceSamples.push({
        duration: Math.max(1, Math.min(MAX_PREDICTED_CHUNK_INTERVAL, renderTime - lastTime)),
        characters: addedLength
      })
      if (timeline.cadenceSamples.length > CADENCE_SAMPLE_COUNT) {
        timeline.cadenceSamples.shift()
      }

      renderCadence = getWeightedCharacterCadence(timeline.cadenceSamples)
    } else if (addedLength > 0) {
      renderCadence = Math.min(DEFAULT_CHARACTER_CADENCE, INITIAL_REVEAL_WINDOW / addedLength)
    }

    const pendingUnits = Array.from(timeline.timings.values()).reduce(
      (total, timing) => total + (timing.startAt > renderTime ? timing.units : 0),
      0
    )
    const predictedChunkInterval =
      timeline.cadenceSamples.length > 0
        ? getWeightedChunkInterval(timeline.cadenceSamples)
        : INITIAL_REVEAL_WINDOW
    const queueSafeCadence =
      Math.min(predictedChunkInterval, STREAMING_BACKLOG_WINDOW_MS) /
      Math.max(1, pendingUnits + addedLength)
    renderCadence = Math.max(
      MIN_TIMELINE_INCREMENT,
      Math.min(MAX_CHARACTER_CADENCE, renderCadence, queueSafeCadence)
    )

    reschedulePendingTimings(timeline, renderTime, renderCadence)
  }

  const animationClock: StreamingAnimationClock = {
    renderTime,
    getTiming: (token, isNew, units = 1, duration = COLOR_DURATION) => {
      const existing = timeline.timings.get(token)
      if (existing) return existing.endAt > renderTime ? existing : undefined
      if (!isNew || !isVisuallyStreaming) return undefined

      const startAt = Math.max(renderTime, timeline.nextStartAt)
      const timing = {
        startAt,
        endAt: startAt + duration,
        duration,
        units: Math.max(1, units)
      }
      timeline.timings.set(token, timing)
      timeline.nextStartAt = startAt + renderCadence * timing.units
      timeline.maxEndAt = Math.max(timeline.maxEndAt, timing.endAt)
      return timing
    }
  }

  useLayoutEffect(() => {
    const previousText = committedTextRef.current
    if (text !== previousText) {
      committedTextRef.current = text
      lastTimeRef.current = renderTime
      charDurationRef.current = renderCadence
    }

    wasStreamingRef.current = isStreaming

    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }

    const effectTime = performance.now()
    const nextPendingStart = Array.from(timeline.timings.values()).reduce(
      (earliestStart, timing) =>
        timing.startAt > effectTime ? Math.min(earliestStart, timing.startAt) : earliestStart,
      Number.POSITIVE_INFINITY
    )
    const nextVisualUpdate = Number.isFinite(nextPendingStart)
      ? nextPendingStart
      : !isStreaming
      ? timeline.maxEndAt
      : Number.POSITIVE_INFINITY
    const remainingAnimationTime = nextVisualUpdate - effectTime

    if (Number.isFinite(nextVisualUpdate) && remainingAnimationTime > 0) {
      cleanupTimerRef.current = setTimeout(
        forceTimelineCleanup,
        Math.max(0, Math.ceil(remainingAnimationTime))
      )
    } else if (!isStreaming && timeline.maxEndAt <= effectTime) {
      timeline.timings.clear()
      timeline.nextStartAt = 0
      timeline.maxEndAt = 0
      timeline.cadenceSamples = []
      lastTimeRef.current = 0
      charDurationRef.current = DEFAULT_CHARACTER_CADENCE
    }

    return () => {
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current)
        cleanupTimerRef.current = null
      }
    }
  })

  return {
    isStreaming: isVisuallyStreaming,
    prevTotalLength,
    charDuration: renderCadence,
    animationClock
  }
}
/* eslint-enable react-hooks/refs, react-hooks/purity */

function reschedulePendingTimings(timeline: StreamingTimeline, now: number, cadence: number): void {
  const pendingTimings = Array.from(timeline.timings.entries())
    .filter(([, timing]) => timing.startAt > now)
    .sort(([leftToken], [rightToken]) => getTokenStart(leftToken) - getTokenStart(rightToken))

  const lastStartedAt = Array.from(timeline.timings.values()).reduce(
    (latestStart, timing) =>
      timing.startAt <= now ? Math.max(latestStart, timing.startAt) : latestStart,
    Number.NEGATIVE_INFINITY
  )
  let nextStartAt = Number.isFinite(lastStartedAt) ? Math.max(now, lastStartedAt + cadence) : now

  for (const [, timing] of pendingTimings) {
    timing.startAt = nextStartAt
    timing.endAt = nextStartAt + timing.duration
    nextStartAt += cadence * timing.units
  }

  timeline.nextStartAt = nextStartAt
  timeline.maxEndAt = Array.from(timeline.timings.values()).reduce(
    (latestEnd, timing) => Math.max(latestEnd, timing.endAt),
    0
  )
}

function getTokenStart(token: string): number {
  const start = Number(token.split(':', 1)[0])
  return Number.isFinite(start) ? start : Number.MAX_SAFE_INTEGER
}

function getWeightedCharacterCadence(samples: StreamingTimeline['cadenceSamples']): number {
  let weightedDuration = 0
  let weightedCharacters = 0

  samples.forEach((sample, index) => {
    const weight = index + 1
    weightedDuration += sample.duration * weight
    weightedCharacters += sample.characters * weight
  })

  return weightedDuration / Math.max(1, weightedCharacters)
}

function getWeightedChunkInterval(samples: StreamingTimeline['cadenceSamples']): number {
  let weightedDuration = 0
  let totalWeight = 0

  samples.forEach((sample, index) => {
    const weight = index + 1
    weightedDuration += sample.duration * weight
    totalWeight += weight
  })

  return Math.max(
    MIN_PREDICTED_CHUNK_INTERVAL,
    Math.min(MAX_PREDICTED_CHUNK_INTERVAL, weightedDuration / Math.max(1, totalWeight))
  )
}

function stripNonVisualStreamingParts(value: string): string {
  return value
    .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)/g, '')
    .replace(/<mini_app>[\s\S]*?(?:<\/mini_app>|$)/g, '')
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

const STREAMING_CHARACTER_FADE_CLASS = 'streaming-character-fade'
const STREAMING_ELEMENT_FADE_CLASS = 'streaming-element-fade'

interface GraphemePart {
  segment: string
  index: number
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function segmentGraphemes(value: string): GraphemePart[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment, index }) => ({ segment, index }))
}

function countGraphemes(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length
}

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
  if (tagName === 'script' || tagName === 'style' || tagName === 'svg' || tagName === 'code') {
    return true
  }

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
  if (tagName === 'code') return true

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

function setStreamTiming(node: HastNode, token: string, delay: number): void {
  setStreamToken(node, token)
  node.properties = {
    ...(node.properties || {}),
    dataStreamDelay: String(delay),
    'data-stream-delay': String(delay)
  }
}

function createFadeSpan(
  textNode: HastNode,
  value: string,
  token: string,
  delay: number
): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: [STREAMING_CHARACTER_FADE_CLASS],
      dataStreamToken: token,
      'data-stream-token': token,
      dataStreamDelay: String(delay),
      'data-stream-delay': String(delay)
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

function splitTextNodeForFade(
  node: HastNode,
  boundary: number,
  fallbackStart: number,
  partStartOffset: number,
  animationClock: StreamingAnimationClock
): HastNode[] {
  const value = node.value || ''
  if (!value) return [node]

  const positionedStart = getOffset(node.position?.start)
  const positionedEnd = getOffset(node.position?.end)
  const start = positionedStart ?? fallbackStart
  const end = positionedEnd ?? start + value.length
  const sourceSpan = Math.max(value.length, end - start)
  const nextNodes: HastNode[] = []
  let plainText = ''

  const flushPlainText = (): void => {
    if (!plainText) return
    nextNodes.push({ ...node, value: plainText })
    plainText = ''
  }

  for (const grapheme of segmentGraphemes(value)) {
    const nextGrapheme = grapheme.index + grapheme.segment.length
    const relativeStart = Math.round((grapheme.index / value.length) * sourceSpan)
    const relativeEnd = Math.max(
      relativeStart + 1,
      Math.round((nextGrapheme / value.length) * sourceSpan)
    )
    const globalStart = partStartOffset + start + relativeStart
    const globalEnd = partStartOffset + start + relativeEnd
    const token = `${globalStart}:${globalEnd}:char`
    const timing = animationClock.getTiming(token, start + relativeEnd > boundary)

    if (!timing || /^\s+$/u.test(grapheme.segment)) {
      plainText += grapheme.segment
      continue
    }

    flushPlainText()
    nextNodes.push(
      createFadeSpan(
        node,
        grapheme.segment,
        token,
        timing.startAt - animationClock.renderTime
      )
    )
  }

  flushPlainText()
  return nextNodes
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
            const childLength = child.value?.length || 0
            const positionedStart = getOffset(child.position?.start)
            nextChildren.push(
              ...splitTextNodeForFade(
                child,
                boundary,
                fallbackTextOffset,
                partStartOffset,
                streamStats.animationClock
              )
            )
            fallbackTextOffset = (positionedStart ?? fallbackTextOffset) + childLength
            continue
          }

          if (shouldSkipChildren(child)) {
            const childTextLength = getTextLength(child)
            if (canFadeSkippedElement(child)) {
              const positionedStart = getOffset(child.position?.start) ?? fallbackTextOffset
              const positionedEnd =
                getOffset(child.position?.end) ?? positionedStart + childTextLength
              const globalStart = partStartOffset + positionedStart
              const globalEnd = partStartOffset + positionedEnd
              const token = `${globalStart}:${globalEnd}:element`
              const units = Math.max(1, countGraphemes(getTextValue(child)))
              const timing = streamStats.animationClock.getTiming(
                token,
                shouldFadeNode(child, boundary, fallbackTextOffset),
                units,
                OPACITY_DURATION
              )

              if (timing) {
                addClassName(child, STREAMING_ELEMENT_FADE_CLASS)
                setStreamTiming(
                  child,
                  token,
                  timing.startAt - streamStats.animationClock.renderTime
                )
              }
            }
            fallbackTextOffset += childTextLength
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

function getTextValue(node: HastNode): string {
  if (node.type === 'text') return node.value || ''
  return node.children?.map(getTextValue).join('') || ''
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
  dataStreamDelay?: string
  'data-stream-delay'?: string
}

function StreamingSpan({
  children,
  className,
  dataStreamToken,
  'data-stream-token': dataStreamTokenAttribute,
  dataStreamDelay,
  'data-stream-delay': dataStreamDelayAttribute,
  node: _node,
  style,
  ...props
}: StreamingSpanProps): React.JSX.Element {
  void _node
  const streamToken = dataStreamTokenAttribute ?? dataStreamToken
  const streamDelay = dataStreamDelayAttribute ?? dataStreamDelay
  const animationStyle = getStreamingAnimationStyle(style, streamDelay)

  return (
    <span className={className} data-stream-token={streamToken} style={animationStyle} {...props}>
      {children}
    </span>
  )
}

interface StreamingDivProps extends React.ComponentPropsWithoutRef<'div'> {
  node?: unknown
  dataStreamToken?: string
  'data-stream-token'?: string
  dataStreamDelay?: string
  'data-stream-delay'?: string
}

function StreamingDiv({
  children,
  dataStreamToken,
  'data-stream-token': dataStreamTokenAttribute,
  dataStreamDelay,
  'data-stream-delay': dataStreamDelayAttribute,
  node: _node,
  style,
  ...props
}: StreamingDivProps): React.JSX.Element {
  void _node
  return (
    <div
      data-stream-token={dataStreamTokenAttribute ?? dataStreamToken}
      style={getStreamingAnimationStyle(style, dataStreamDelayAttribute ?? dataStreamDelay)}
      {...props}
    >
      {children}
    </div>
  )
}

type StreamingStyle = React.CSSProperties & {
  '--streaming-character-delay'?: string
}

function getStreamingAnimationStyle(
  style: React.CSSProperties | undefined,
  delay: string | undefined
): StreamingStyle | undefined {
  if (delay === undefined) return style
  return {
    ...style,
    '--streaming-character-delay': `${Number(delay) || 0}ms`
  }
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

interface StreamingCodeProps extends React.ComponentPropsWithoutRef<'code'> {
  node?: unknown
  dataStreamToken?: string
  'data-stream-token'?: string
  dataStreamDelay?: string
  'data-stream-delay'?: string
}

export const CodeBlock = ({
  className,
  children,
  dataStreamToken,
  'data-stream-token': dataStreamTokenAttribute,
  dataStreamDelay,
  'data-stream-delay': dataStreamDelayAttribute,
  node: _node,
  style,
  ...props
}: StreamingCodeProps) => {
  void _node
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const isInline = !match
  const codeContent = String(children).replace(/\n$/, '')
  const streamToken = dataStreamTokenAttribute ?? dataStreamToken
  const streamDelay = dataStreamDelayAttribute ?? dataStreamDelay
  const streamingElementClass = className
    ?.split(/\s+/)
    .find((name) => name === STREAMING_ELEMENT_FADE_CLASS)
  const animationStyle = getStreamingAnimationStyle(style, streamDelay)
  const codeClassName = className
    ?.split(/\s+/)
    .filter(
      (name) =>
        name &&
        name !== STREAMING_ELEMENT_FADE_CLASS
    )
    .join(' ')

  if (isInline) {
    return (
      <code
        className={`${className || ''} text-accent-secondary font-mono text-[13px] font-medium tracking-tight bg-transparent border-none p-0 mx-0.5 inline select-text`}
        data-stream-token={streamToken}
        style={{
          ...animationStyle,
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
    <div
      className={`not-prose my-4 overflow-hidden rounded-xl border border-white/[0.08] bg-[#07080a] shadow-lg font-mono text-xs w-full text-text-primary ${streamingElementClass || ''}`}
      data-stream-token={streamToken}
      style={animationStyle}
    >
      <div className="flex items-center justify-between bg-white/[0.02] border-b border-white/[0.05] px-4 py-2 select-none">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
          {lang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200 active:scale-95 cursor-pointer min-w-[75px] justify-center"
        >
          <span>{copied ? 'Copied!' : 'Copy Code'}</span>
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <code className={`${codeClassName || ''} block whitespace-pre`} {...props}>
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
  div: ({ children, ...props }) => <StreamingDiv {...props}>{children}</StreamingDiv>,
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
