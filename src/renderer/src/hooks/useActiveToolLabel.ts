import { useState, useEffect, useRef } from 'react'
import { getCustomToolLabel, truncateToWords } from '../components/ActionLoader'

export interface ActiveToolLabelTarget {
  content?: string
  thoughts?: string
  isStreaming?: boolean
  toolCalls?: Array<{
    name: string
    status: string
    progressTitle?: string
    completedTitle?: string
    args?: Record<string, unknown>
  }>
  streamingToolCalls?: Array<{
    name: string
    status?: string
    arguments?: string
  }>
}

function getCleanTextLength(content?: string): number {
  if (!content) return 0
  return content
    .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)/g, '')
    .replace(/<mini_app>[\s\S]*?(?:<\/mini_app>|$)/g, '')
    .trim().length
}

function extractStreamingTitle(raw: string | undefined, key: string): string | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const value = parsed?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  } catch {
    /* partial JSON: fall through to regex */
  }
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 'i'))
  if (match?.[1]) {
    try {
      const unescaped = JSON.parse(`"${match[1]}"`) as unknown
      if (typeof unescaped === 'string' && unescaped.trim()) return unescaped.trim()
    } catch {
      return match[1].trim() || undefined
    }
  }
  return undefined
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

    // Only track real user-visible text content length (ignoring tool tags, mini_app tags, and thinking)
    const currentOutputLen = getCleanTextLength(msg.content)

    // Find the latest non-internal tool call
    const allTools = [
      ...(msg.toolCalls || []),
      ...(msg.streamingToolCalls || []).map((stc) => ({
        name: stc.name,
        status: 'writing',
        progressTitle: extractStreamingTitle(stc.arguments, 'progressTitle'),
        completedTitle: extractStreamingTitle(stc.arguments, 'completedTitle'),
        args: undefined as Record<string, unknown> | undefined
      }))
    ].filter(
      (tc) =>
        tc.name &&
        (tc.name !== 'to_ask' || tc.status === 'writing' || tc.status === 'running') &&
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
    const progressTitle =
      latestTool.progressTitle ??
      (latestTool.args?.progressTitle as string | undefined)
    const completedTitle =
      latestTool.completedTitle ??
      (latestTool.args?.completedTitle as string | undefined)

    // Never flash a generic fallback while the tool is still active: the
    // label appears only after the model generates its progress title.
    if (isToolActive && !(typeof progressTitle === 'string' && progressTitle.trim())) {
      lastToolKeyRef.current = toolKey
      baselineOutputLenRef.current = currentOutputLen
      setActiveToolInfo(null)
      return
    }

    const nextLabel = truncateToWords(
      getCustomToolLabel(latestTool.name, latestTool.status, progressTitle, completedTitle)
    )
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
    // Check if new real text output has streamed in since tool completion
    if (baselineOutputLenRef.current !== null && currentOutputLen > baselineOutputLenRef.current) {
      setActiveToolInfo(null)
    } else {
      // Keep tool label alive and shimmering until next real text streaming output or next tool
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
    msg?.toolCalls,
    msg?.streamingToolCalls
  ])

  return {
    activeToolLabel: activeToolInfo?.label || null,
    activeToolName: activeToolInfo?.name || null
  }
}
