import { useState, useEffect, useRef } from 'react'

export function getInactivityMessage(seconds: number): string | null {
  if (seconds < 5) return null
  if (seconds < 35) return 'Working...'
  if (seconds < 95) return 'Still working...'
  if (seconds < 275) return 'Hold on, still working...'
  if (seconds < 575) return 'Almost there...'
  if (seconds < 1175) return "Do not give up, I'm still working..."
  return 'Give me more time, this is taking really hard work...'
}

export interface InactivityMessageTarget {
  content?: string
  thoughts?: string
  isStreaming?: boolean
  isWritingToolCall?: boolean
  toolCalls?: Array<{ status: string }>
  streamingToolCalls?: Array<{ name?: string; status?: string }>
}

export function useInactivityLabel(msg: InactivityMessageTarget | undefined): string | null {
  const [inactivityLabel, setInactivityLabel] = useState<string | null>(null)
  const lastOutputTimeRef = useRef<number>(Date.now())
  const lastContentRef = useRef<string | undefined>(msg?.content)
  const lastThoughtsRef = useRef<string | undefined>(msg?.thoughts)
  const isStreamingRef = useRef<boolean>(!!msg?.isStreaming)

  // Track stream status transition and content/thought changes
  useEffect(() => {
    if (!msg || !msg.isStreaming) {
      setInactivityLabel(null)
      isStreamingRef.current = false
      return
    }

    // Reset when stream transitions from false -> true
    if (!isStreamingRef.current) {
      isStreamingRef.current = true
      lastOutputTimeRef.current = Date.now()
      lastContentRef.current = msg.content
      lastThoughtsRef.current = msg.thoughts
      setInactivityLabel(null)
      return
    }

    const contentChanged = msg.content !== lastContentRef.current
    const thoughtsChanged = msg.thoughts !== lastThoughtsRef.current

    if (contentChanged || thoughtsChanged) {
      lastContentRef.current = msg.content
      lastThoughtsRef.current = msg.thoughts
      lastOutputTimeRef.current = Date.now()
      setInactivityLabel(null)
    }
  }, [msg?.content, msg?.thoughts, msg?.isStreaming])

  // Interval timer to update label every second when streaming and no active tool is showing
  useEffect(() => {
    if (!msg || !msg.isStreaming) {
      setInactivityLabel(null)
      return
    }

    const checkLabel = () => {
      // Check if ANY tool label is ALREADY being shown
      const allTools = [
        ...(msg.toolCalls || []),
        ...(msg.streamingToolCalls || []).map((stc) => ({ name: stc.name, status: 'writing' as const }))
      ]
      const hasActiveTool = allTools.some(
        (t) => t.status === 'writing' || t.status === 'running'
      )

      if (hasActiveTool) {
        setInactivityLabel(null)
        return
      }

      const elapsedSec = Math.floor((Date.now() - lastOutputTimeRef.current) / 1000)
      const label = getInactivityMessage(elapsedSec)
      setInactivityLabel(label)
    }

    checkLabel()
    const interval = setInterval(checkLabel, 1000)
    return () => clearInterval(interval)
  }, [msg?.isStreaming, msg?.toolCalls, msg?.streamingToolCalls, msg?.isWritingToolCall])

  return inactivityLabel
}
