import React, { useRef, useContext } from 'react'
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

// Custom Hook to manage streaming speed and character index tracking synchronously during render passes
export function useStreamStats(text: string, isStreaming: boolean): StreamContextType {
  const prevTextRef = useRef('')
  const prevLengthRef = useRef(0)
  const lastTimeRef = useRef(0)
  const charDurationRef = useRef(20)
  const globalCharCountRef = useRef(0)

  // Reset the global counter ref synchronously on every render pass
  globalCharCountRef.current = 0

  if (!isStreaming) {
    prevTextRef.current = text
    prevLengthRef.current = text.length
    lastTimeRef.current = 0
    return {
      isStreaming: false,
      prevTotalLength: text.length,
      charDuration: 20,
      globalCharCountRef
    }
  }

  // Update indices synchronously during render when streaming prop changes
  if (text !== prevTextRef.current) {
    const now = performance.now()
    const lastTime = lastTimeRef.current
    const deltaTime = lastTime === 0 ? 100 : now - lastTime
    lastTimeRef.current = now

    const addedLength = text.length - prevTextRef.current.length
    if (addedLength > 0) {
      // Retain the length before the append as the stable boundary
      prevLengthRef.current = prevTextRef.current.length
      const rawSpeed = deltaTime / addedLength
      // Clamp character delay between 8ms and 45ms for dynamic typing speed
      charDurationRef.current = Math.max(8, Math.min(45, rawSpeed))
    } else if (text.length < prevTextRef.current.length) {
      prevLengthRef.current = text.length
    }
    prevTextRef.current = text
  }

  return {
    isStreaming: true,
    prevTotalLength: prevLengthRef.current,
    charDuration: charDurationRef.current,
    globalCharCountRef
  }
}

export interface AnimatedStreamingTextProps {
  text: string
  isStreaming?: boolean
  mode?: 'words' | 'chars'
}

export function AnimatedStreamingText({
  text
}: AnimatedStreamingTextProps): React.JSX.Element {
  return <>{text}</>
}

const wrapTextWithAnimation = (children: React.ReactNode, _isStreaming: boolean): React.ReactNode => {
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
