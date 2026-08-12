import { useState, useEffect, useRef } from 'react'
import { getToolLabel } from '../components/ActionLoader'

export interface ActiveToolLabelTarget {
  content?: string
  thoughts?: string
  isStreaming?: boolean
  toolCalls?: Array<{ name: string; status: string }>
  streamingToolCalls?: Array<{ name: string; status?: string }>
}

export function useActiveToolLabel(msg: ActiveToolLabelTarget | undefined): {
  activeToolLabel: string | null
  activeToolName: string | null
} {
  const [activeToolInfo, setActiveToolInfo] = useState<{ label: string; name: string } | null>(null)

  const lastToolKeyRef = useRef<string | null>(null)
  const baselineOutputLenRef = useRef<number | null>(null)

  useEffect(() => {
    if (!msg || !msg.isStreaming) {
      setActiveToolInfo(null)
      lastToolKeyRef.current = null
      baselineOutputLenRef.current = null
      return
    }

    // Only track text content length (thoughts are ignored so label stays alive during thinking)
    const currentOutputLen = (msg.content || '').length

    // Find the latest non-internal tool call
    const allTools = [
      ...(msg.toolCalls || []),
      ...(msg.streamingToolCalls || []).map((stc) => ({ name: stc.name, status: 'writing' }))
    ].filter(
      (tc) =>
        tc.name &&
        tc.name !== 'to_ask' &&
        tc.name !== 'render_chat_history' &&
        tc.name !== 'malformed_tool_call'
    )

    if (allTools.length === 0) {
      setActiveToolInfo(null)
      lastToolKeyRef.current = null
      baselineOutputLenRef.current = currentOutputLen
      return
    }

    const latestTool = allTools[allTools.length - 1]
    const toolKey = `${latestTool.name}-${allTools.length}`
    const isToolActive = latestTool.status === 'writing' || latestTool.status === 'running'

    const nextLabel = getToolLabel(latestTool.name)
    const nextName = latestTool.name

    if (isToolActive) {
      // While tool is active, track its key and baseline output length
      lastToolKeyRef.current = toolKey
      baselineOutputLenRef.current = currentOutputLen

      setActiveToolInfo((prev) => {
        if (prev && prev.label === nextLabel && prev.name === nextName) {
          return prev
        }
        return { label: nextLabel, name: nextName }
      })
      return
    }

    // Tool is completed (done, error, cancelled, etc.)
    // Check if new text or thoughts have streamed in since tool completion
    if (baselineOutputLenRef.current !== null && currentOutputLen > baselineOutputLenRef.current) {
      setActiveToolInfo(null)
    } else {
      // Keep tool label alive and shimmering until next AI streaming output or next tool
      setActiveToolInfo((prev) => {
        if (prev && prev.label === nextLabel && prev.name === nextName) {
          return prev
        }
        return { label: nextLabel, name: nextName }
      })
    }
  }, [
    msg?.isStreaming,
    msg?.content,
    msg?.thoughts,
    msg?.toolCalls,
    msg?.streamingToolCalls
  ])

  return {
    activeToolLabel: activeToolInfo?.label || null,
    activeToolName: activeToolInfo?.name || null
  }
}
