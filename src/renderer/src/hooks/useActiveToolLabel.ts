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

  const lastToolRef = useRef<string | null>(null)
  const outputLenAtToolRef = useRef<number>(0)

  useEffect(() => {
    if (!msg || !msg.isStreaming) {
      setActiveToolInfo(null)
      lastToolRef.current = null
      outputLenAtToolRef.current = 0
      return
    }

    const currentOutputLen = (msg.content || '').length + (msg.thoughts || '').length

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
      lastToolRef.current = null
      return
    }

    const latestTool = allTools[allTools.length - 1]
    const toolKey = `${latestTool.name}-${allTools.length}`
    const isToolActive = latestTool.status === 'writing' || latestTool.status === 'running'

    if (toolKey !== lastToolRef.current) {
      // New tool call detected
      lastToolRef.current = toolKey
      outputLenAtToolRef.current = currentOutputLen
      setActiveToolInfo({
        label: getToolLabel(latestTool.name),
        name: latestTool.name
      })
      return
    }

    // Tool is currently active
    if (isToolActive) {
      outputLenAtToolRef.current = currentOutputLen
      setActiveToolInfo({
        label: getToolLabel(latestTool.name),
        name: latestTool.name
      })
      return
    }

    // Tool is done. Persist label until new output text/thoughts stream in from AI
    if (currentOutputLen > outputLenAtToolRef.current) {
      setActiveToolInfo(null)
    } else {
      setActiveToolInfo({
        label: getToolLabel(latestTool.name),
        name: latestTool.name
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
