import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismBackground } from './components/PrismBackground'
import { LandingBackgroundEffects } from './components/LandingBackgroundEffects'
import { LoadingScreen } from './components/LoadingScreen'
import { OfflineBanner } from './components/OfflineBanner'
import { Sidebar } from './components/Sidebar'
import { InputBar, InputBarHandle } from './components/InputBar'
import { Spinner } from './components/Spinner'
import { ToolCall, ToolCallIndicator } from './components/ActionLoader'
import { QuestionnaireRenderer } from './components/QuestionnaireRenderer'
import { MalformedToolCallWarning } from './components/MalformedToolCallWarning'
import { ModelSelector, ModelSelectorHandle } from './components/ModelSelector'

import { QuickLauncher } from './components/QuickLauncher'
import { TitleBar } from './components/TitleBar'
import { SettingsView } from './components/SettingsView'
import { ApiKeyModal } from './components/ApiKeyModal'
import { MissingKeyBanner } from './components/MissingKeyBanner'
import { SearchModal } from './components/SearchModal'
import { RenderChatHistory } from './components/RenderChatHistory'
import { MiniAppRenderer } from './components/MiniAppRenderer'
import { TtsButton } from './components/TtsButton'
import { CopyMessageButton } from './components/CopyMessageButton'
import { ErrorPopup } from './components/ErrorPopup'
import { DownloadProgressOverlay } from './components/DownloadProgressOverlay'
import { DemoApp } from './components/demo/DemoApp'
import { UpdaterView } from './components/UpdaterView'
import { isShortcutPressed } from './utils'
import {
  StreamContext,
  StaticMarkdownComponents,
  createStreamingFadeRehypePlugin,
  useStreamStats,
  CodeBlock
} from './components/AnimatedStreamingText'
import clsx from 'clsx'
import { CaretDown, Quotes, Brain, FilePdf, FilePpt, CheckCircle, XCircle } from '@phosphor-icons/react'
import { ScreenshotModal } from './components/ScreenshotModal'
import { YoutubeAppModal } from './components/YoutubeAppModal'
import TodoPanel from './components/TodoPanel'
import { AppConfig, SlashWorkflow } from '../../main/config'
import type { DownloadProgress, SessionMode, TodoState } from '../../shared/types'
import { IS_DEMO } from '../../shared/demo'

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
          const regex = /(\$\$[\s\S]+?\$\$|\$[^\s$][^$]*?[^\s$]\$|\$[^\s$]\$)/g
          const parts = text.split(regex)

          if (parts.length > 1) {
            for (const part of parts) {
              if (!part) continue

              if (part.startsWith('$$') && part.endsWith('$$')) {
                const equation = part.slice(2, -2).trim()
                newChildren.push({
                  type: 'element',
                  tagName: 'div',
                  properties: { className: ['math', 'math-display'] },
                  children: [{ type: 'text', value: equation }]
                })
              } else if (part.startsWith('$') && part.endsWith('$')) {
                const equation = part.slice(1, -1).trim()
                newChildren.push({
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['math', 'math-inline'] },
                  children: [{ type: 'text', value: equation }]
                })
              } else {
                newChildren.push({ type: 'text', value: part })
              }
            }
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

const MarkdownComponents: Components = {
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => {
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
    if (href && imageExtensions.test(href)) {
      return (
        <img
          src={href}
          alt={typeof children === 'string' ? children : 'Image'}
          className="max-w-full h-auto rounded-xl my-4 border border-surface/50 shadow-lg"
        />
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-primary hover:underline"
        {...props}
      >
        {children}
      </a>
    )
  },
  img: ({ src, alt, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
    <img
      src={src}
      alt={alt}
      className="max-w-full h-auto rounded-xl my-4 border border-surface/50 shadow-lg"
      {...props}
    />
  ),
  pre: ({ children }) => <>{children}</>,
  code: (props) => <CodeBlock {...props} />
}

export interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

interface StreamingToolCall {
  index: number
  id?: string
  name: string
  arguments: string
  isComplete: boolean
  thoughtSignature?: string
  thought_signature?: string
}

interface Message {
  role: 'user' | 'ai' | 'separator'
  content: string
  thoughts?: string
  isStreaming?: boolean
  isThinking?: boolean
  isError?: boolean
  toolCalls?: ToolCall[]
  streamingToolCalls?: StreamingToolCall[]
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search' | 'mini-app'
  isConnecting?: boolean
  screenshot?: string
  file?: AttachedFile
  separatorType?: 'error' | 'cancel'
}

function consolidateToolCalls(
  toolCalls?: ToolCall[],
  streamingToolCalls?: StreamingToolCall[]
): ToolCall[] {
  const allCalls: ToolCall[] = []

  // Add completed/running calls from toolCalls
  if (toolCalls) {
    allCalls.push(...toolCalls)
  }

  // Add writing calls from streamingToolCalls if they aren't already represented in toolCalls
  if (streamingToolCalls) {
    for (const stc of streamingToolCalls) {
      const isAlreadyExecuted = toolCalls?.some(
        (tc) => tc.status !== 'writing' && tc.name === stc.name
      )
      if (!isAlreadyExecuted) {
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(stc.arguments)
        } catch {
          try {
            const filePathMatch = stc.arguments.match(/"(?:filePath|path|TargetFile|absolutePath|AbsolutePath|sourcePath)"\s*:\s*"([^"]*)/i)
            const commandMatch = stc.arguments.match(/"(?:command|CommandLine)"\s*:\s*"([^"]*)/i)
            const queryMatch = stc.arguments.match(/"query"\s*:\s*"([^"]*)/i)
            const titleMatch = stc.arguments.match(/"title"\s*:\s*"([^"]*)/i)
            if (filePathMatch) parsedArgs.filePath = filePathMatch[1]
            if (commandMatch) parsedArgs.command = commandMatch[1]
            if (queryMatch) parsedArgs.query = queryMatch[1]
            if (titleMatch) parsedArgs.title = titleMatch[1]
          } catch { /* ignore */ }
        }

        // Count lines from partial JSON arguments in real-time for file operations
        const countStreamingLines = (raw: string): number => {
          if (!raw) return 0
          // Count escaped newlines in the partial JSON string value
          return (raw.match(/\\n/g) || []).length + (raw.match(/\n/g) || []).length
        }

        let streamingAddedLines = 0
        let streamingRemovedLines = 0
        const tcName = stc.name || ''

        const isFileWrite = tcName === 'computer_use_create_file' || tcName === 'computer_use_save_file' || tcName === 'computer_use_append_file' || tcName === 'write_to_file'
        const isFileEdit = tcName === 'computer_use_edit_file' || tcName === 'replace_file_content' || tcName === 'multi_replace_file_content'

        if (isFileWrite || isFileEdit) {
          const raw = stc.arguments
          if (isFileWrite) {
            // Extract content/CodeContent value from partial JSON
            const contentMatch = raw.match(/"(?:content|CodeContent)"\s*:\s*"((?:[^"\\]|\\.)*)"?/s)
            if (contentMatch) {
              streamingAddedLines = countStreamingLines(contentMatch[1])
            }
          } else if (tcName === 'replace_file_content') {
            const targetMatch = raw.match(/"TargetContent"\s*:\s*"((?:[^"\\]|\\.)*)"?/s)
            const replaceMatch = raw.match(/"ReplacementContent"\s*:\s*"((?:[^"\\]|\\.)*)"?/s)
            if (targetMatch) streamingRemovedLines = countStreamingLines(targetMatch[1])
            if (replaceMatch) streamingAddedLines = countStreamingLines(replaceMatch[1])
          } else if (tcName === 'computer_use_edit_file') {
            const newContentMatch = raw.match(/"newContent"\s*:\s*"((?:[^"\\]|\\.)*)"?/s)
            const startMatch = raw.match(/"startLine"\s*:\s*"?(\d+)/)
            const endMatch = raw.match(/"endLine"\s*:\s*"?(\d+)/)
            if (newContentMatch) streamingAddedLines = countStreamingLines(newContentMatch[1])
            if (startMatch && endMatch) {
              const s = parseInt(startMatch[1], 10)
              const e = parseInt(endMatch[1], 10)
              if (!isNaN(s) && !isNaN(e)) streamingRemovedLines = e - s + 1
            }
          } else if (tcName === 'multi_replace_file_content') {
            // Count from all TargetContent/ReplacementContent pairs found so far
            const targetMatches = raw.matchAll(/"TargetContent"\s*:\s*"((?:[^"\\]|\\.)*)"?/gs)
            const replaceMatches = raw.matchAll(/"ReplacementContent"\s*:\s*"((?:[^"\\]|\\.)*)"?/gs)
            for (const m of targetMatches) streamingRemovedLines += countStreamingLines(m[1])
            for (const m of replaceMatches) streamingAddedLines += countStreamingLines(m[1])
          }
        }

        allCalls.push({
          name: stc.name || 'task',
          args: parsedArgs,
          status: 'writing' as const,
          addedLines: streamingAddedLines > 0 ? streamingAddedLines : undefined,
          removedLines: streamingRemovedLines > 0 ? streamingRemovedLines : undefined
        })
      }
    }
  }

  const consolidatedList: ToolCall[] = []
  const fileGroups = new Map<string, ToolCall[]>()
  const groupFirstIndices = new Map<string, number>()

  allCalls.forEach((call) => {
    const name = call.name
    const args = call.args
    const filePath = (args?.filePath || args?.path || args?.TargetFile || args?.absolutePath || args?.AbsolutePath || args?.sourcePath) as string | undefined

    const isWrite = name === 'computer_use_create_file' || name === 'computer_use_save_file' || name === 'write_to_file' || name === 'computer_use_append_file'
    const isEdit = name === 'computer_use_edit_file' || name === 'replace_file_content' || name === 'multi_replace_file_content'
    const isRead = name === 'computer_use_read_file' || name === 'view_file'

    if (filePath && (isWrite || isEdit || isRead)) {
      const normPath = filePath.replace(/\\/g, '/').toLowerCase()
      const opType = isWrite ? 'write' : isEdit ? 'edit' : 'read'
      const key = `${opType}:${normPath}`

      if (!fileGroups.has(key)) {
        fileGroups.set(key, [])
        groupFirstIndices.set(key, consolidatedList.length)
        consolidatedList.push({
          name: name,
          args: args,
          status: 'done',
          isConsolidated: true,
          consolidatedType: opType,
          filePath,
          fileName: filePath.split('/').pop()?.split('\\').pop() || filePath,
          addedLines: 0,
          removedLines: 0,
          readLines: [],
          originalCalls: []
        })
      }

      fileGroups.get(key)!.push(call)
    } else {
      consolidatedList.push(call)
    }
  })

  fileGroups.forEach((groupCalls, key) => {
    const placeholderIdx = groupFirstIndices.get(key)!
    const placeholder = consolidatedList[placeholderIdx]

    placeholder.originalCalls = groupCalls

    if (groupCalls.some((c) => c.status === 'writing')) {
      placeholder.status = 'writing'
    } else if (groupCalls.some((c) => c.status === 'running')) {
      placeholder.status = 'running'
    } else if (groupCalls.some((c) => c.status === 'error')) {
      placeholder.status = 'error'
    } else if (groupCalls.some((c) => c.status === 'cancelled')) {
      placeholder.status = 'cancelled'
    } else if (groupCalls.some((c) => c.status === 'cooldown')) {
      placeholder.status = 'cooldown'
    } else {
      placeholder.status = 'done'
    }

    groupCalls.forEach((call) => {
      const cName = call.name
      const cArgs = call.args

      const countLines = (str: unknown): number => {
        if (typeof str !== 'string') return 0
        if (!str) return 0
        return str.split('\n').length
      }

      if (cName === 'computer_use_create_file' || cName === 'computer_use_save_file') {
        placeholder.addedLines = (placeholder.addedLines || 0) + countLines(cArgs.content)
      } else if (cName === 'write_to_file') {
        placeholder.addedLines = (placeholder.addedLines || 0) + countLines(cArgs.CodeContent)
      } else if (cName === 'computer_use_append_file') {
        placeholder.addedLines = (placeholder.addedLines || 0) + countLines(cArgs.content)
      } else if (cName === 'computer_use_edit_file') {
        const start = parseInt(cArgs.startLine as string, 10)
        const end = parseInt(cArgs.endLine as string, 10)
        if (!isNaN(start) && !isNaN(end)) {
          placeholder.removedLines = (placeholder.removedLines || 0) + (end - start + 1)
        }
        placeholder.addedLines = (placeholder.addedLines || 0) + countLines(cArgs.newContent)
      } else if (cName === 'replace_file_content') {
        placeholder.removedLines = (placeholder.removedLines || 0) + countLines(cArgs.TargetContent)
        placeholder.addedLines = (placeholder.addedLines || 0) + countLines(cArgs.ReplacementContent)
      } else if (cName === 'multi_replace_file_content') {
        let chunks: any[] = []
        if (Array.isArray(cArgs.ReplacementChunks)) {
          chunks = cArgs.ReplacementChunks
        } else if (typeof cArgs.ReplacementChunks === 'string') {
          try {
            chunks = JSON.parse(cArgs.ReplacementChunks)
          } catch { /* ignore */ }
        }
        chunks.forEach((chunk) => {
          placeholder.removedLines = (placeholder.removedLines || 0) + countLines(chunk.TargetContent)
          placeholder.addedLines = (placeholder.addedLines || 0) + countLines(chunk.ReplacementContent)
        })
      } else if (cName === 'computer_use_read_file') {
        const start = parseInt(cArgs.startLine as string, 10) || 1
        const limit = parseInt(cArgs.limit as string, 10)
        if (!isNaN(limit)) {
          placeholder.readLines!.push({ start, end: start + limit - 1 })
        } else {
          placeholder.readLines!.push({ start, end: start })
        }
      } else if (cName === 'view_file') {
        const start = parseInt(cArgs.StartLine as string, 10) || 1
        const end = parseInt(cArgs.EndLine as string, 10)
        if (!isNaN(end)) {
          placeholder.readLines!.push({ start, end })
        } else {
          placeholder.readLines!.push({ start, end: start + 800 })
        }
      }
    })
  })

  return consolidatedList
}

interface AiMessageProps {
  msg: Message
  currentChatId: string | undefined
  handleLoadChat: (id: string) => void
  markdownComponents: Components
}

const AiMessage = React.memo(function AiMessage({
  msg,
  currentChatId,
  handleLoadChat,
  markdownComponents
}: AiMessageProps) {
  const streamStats = useStreamStats(msg.content, !!msg.isStreaming)
  const nativeToolCalls = useMemo(() => consolidateToolCalls(msg.toolCalls, msg.streamingToolCalls), [msg.toolCalls, msg.streamingToolCalls])

  const hasThoughtBlock = useMemo(() => {
    const passiveTools = ['computer_use_read_file', 'computer_use_list_installed_applications', 'list_installed_applications', 'search_installed_applications']
    const filteredThoughts = (msg.thoughts || '').replace(
      /\[PRISM_EXECUTE_TOOL\][\s\S]*?\[\/PRISM_EXECUTE_TOOL\]/g,
      (match) => {
        try {
          const json = match.replace('[PRISM_EXECUTE_TOOL]', '').replace('[/PRISM_EXECUTE_TOOL]', '')
          const parsed = JSON.parse(json)
          if (passiveTools.includes(parsed.type)) return ''
        } catch {}
        return match
      }
    ).trim()
    return !!(filteredThoughts || msg.isThinking)
  }, [msg.thoughts, msg.isThinking])

  const shouldHideActiveBelow = hasThoughtBlock && (!msg.content || msg.content.trim() === '')

  const hasTextOutput = useMemo(() => {
    const cleaned = msg.content
      .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)/gi, '')
      .replace(/<mini_app>[\s\S]*?(?:<\/mini_app>|$)/gi, '')
      .trim()
    return cleaned !== ''
  }, [msg.content])

  const shouldHideIndicator = useCallback((status: ToolCall['status']) => {
    const isActive = status === 'writing' || status === 'running'
    if (hasTextOutput) {
      return !isActive
    }
    return hasThoughtBlock
  }, [hasTextOutput, hasThoughtBlock])

  const visibleNativeTools = useMemo(() => {
    const list = nativeToolCalls.filter(
      (tc) =>
        tc.name !== 'to_ask' &&
        tc.name !== 'render_chat_history' &&
        tc.name !== 'malformed_tool_call' &&
        tc.name !== 'create_mini_app'
    )
    return list.filter((tc) => !shouldHideIndicator(tc.status))
  }, [nativeToolCalls, shouldHideIndicator])
  const parts = useMemo(() => {
    return (msg.content || '').split(
      /(\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)|<mini_app>[\s\S]*?(?:<\/mini_app>|$))/gi
    )
  }, [msg.content])

  const shouldShowInlineTool = useCallback((status: ToolCall['status'], partIndex: number) => {
    const isActive = status === 'writing' || status === 'running'
    if (isActive) {
      const hasTextBefore = parts.slice(0, partIndex).some(p => {
        const isTool = p.startsWith('[PRISM_EXECUTE_TOOL]')
        const isMiniApp = p.startsWith('<mini_app>')
        return !isTool && !isMiniApp && p.trim() !== ''
      })
      if (!hasTextBefore && hasThoughtBlock) {
        return false
      }
      return true
    }

    const hasTextAfter = parts.slice(partIndex + 1).some(p => {
      const isTool = p.startsWith('[PRISM_EXECUTE_TOOL]')
      const isMiniApp = p.startsWith('<mini_app>')
      return !isTool && !isMiniApp && p.trim() !== ''
    })
    if (hasTextAfter) {
      return false
    }

    const hasTextBefore = parts.slice(0, partIndex).some(p => {
      const isTool = p.startsWith('[PRISM_EXECUTE_TOOL]')
      const isMiniApp = p.startsWith('<mini_app>')
      return !isTool && !isMiniApp && p.trim() !== ''
    })
    if (!hasTextBefore) {
      return !hasThoughtBlock
    }

    return true
  }, [parts, hasThoughtBlock])

  if (msg.isConnecting) {
    return (
      <div className="flex flex-col gap-2.5 w-full max-w-[320px] py-3 animate-pulse">
        <div className="h-3.5 w-full rounded-full bg-white/[0.08]" />
        <div className="h-3.5 w-5/6 rounded-full bg-white/[0.08]" />
        <div className="h-3.5 w-2/3 rounded-full bg-white/[0.08]" />
      </div>
    )
  }

  if (!msg.content && !msg.toolCalls?.length && !msg.isWritingToolCall) {
    return null
  }

  interface PartItem {
    partIndex: number
    part: string
    type: 'text' | 'mini_app' | 'tool_call'
    isClosed: boolean
    toolCall?: ToolCall
    writingToolName?: string
    writingToolArgs?: Record<string, unknown>
    startOffset: number
  }

  let tempToolCallIndex = 0
  let partStartOffset = 0

  const items: PartItem[] = parts.map((part, index) => {
    const currentPartStartOffset = partStartOffset
    partStartOffset += part.length

    if (part.startsWith('[PRISM_EXECUTE_TOOL]')) {
      if (part.includes('[/PRISM_EXECUTE_TOOL]')) {
        const tc = msg.toolCalls?.[tempToolCallIndex]
        tempToolCallIndex++
        return {
          partIndex: index,
          part,
          type: 'tool_call',
          isClosed: true,
          toolCall: tc,
          startOffset: currentPartStartOffset
        }
      } else {
        const nameMatch = part.match(/<name>([\s\S]*?)(?:<\/name>|$)/i)
        let toolName = nameMatch ? nameMatch[1].trim() : ''
        if (!toolName) {
          const typeMatch = part.match(/"type"\s*:\s*"([^"]*)/i)
          if (typeMatch) {
            toolName = typeMatch[1]
          }
        }
        // Extract partial args from writing tool call
        let writingToolArgs: Record<string, unknown> | undefined
        try {
          const jsonMatch = part.match(/\[PRISM_EXECUTE_TOOL\]([\s\S]*?)$/i)
          if (jsonMatch) {
            const partialJson = jsonMatch[1]
            try {
              const parsed = JSON.parse(partialJson)
              if (parsed && typeof parsed === 'object') {
                writingToolArgs = parsed as Record<string, unknown>
                const pathVal = parsed.filePath || parsed.path || parsed.TargetFile || parsed.absolutePath || parsed.AbsolutePath || parsed.sourcePath
                if (pathVal) writingToolArgs.filePath = pathVal
                const cmdVal = parsed.command || parsed.CommandLine
                if (cmdVal) writingToolArgs.command = cmdVal
                const queryVal = parsed.query
                if (queryVal) writingToolArgs.query = queryVal
              }
            } catch {
              const filePathMatch = partialJson.match(/"(?:filePath|path|TargetFile|absolutePath|AbsolutePath|sourcePath)"\s*:\s*"([^"]*)/i)
              const commandMatch = partialJson.match(/"(?:command|CommandLine)"\s*:\s*"([^"]*)/i)
              const queryMatch = partialJson.match(/"query"\s*:\s*"([^"]*)/i)
              writingToolArgs = {}
              if (filePathMatch) writingToolArgs.filePath = filePathMatch[1]
              if (commandMatch) writingToolArgs.command = commandMatch[1]
              if (queryMatch) writingToolArgs.query = queryMatch[1]
            }
          }
        } catch { /* ignore */ }
        return {
          partIndex: index,
          part,
          type: 'tool_call',
          isClosed: false,
          writingToolName: toolName,
          writingToolArgs,
          startOffset: currentPartStartOffset
        }
      }
    } else if (part.startsWith('<mini_app>')) {
      return {
        partIndex: index,
        part,
        type: 'mini_app',
        isClosed: part.includes('</mini_app>'),
        startOffset: currentPartStartOffset
      }
    } else {
      return {
        partIndex: index,
        part,
        type: 'text',
        isClosed: true,
        startOffset: currentPartStartOffset
      }
    }
  })

  // Group consecutive web_search items
  const groupedItems: Array<PartItem | { type: 'grouped_web_searches'; items: PartItem[] }> = []
  let currentGroup: PartItem[] = []

  const isWebSearch = (item: PartItem): boolean => {
    if (item.type !== 'tool_call') return false
    if (item.isClosed) {
      return item.toolCall?.name === 'web_search'
    } else {
      return item.writingToolName === 'web_search' || item.writingToolName === 'search'
    }
  }

  const isWhitespace = (item: PartItem): boolean => {
    return item.type === 'text' && item.part.trim() === ''
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (isWebSearch(item)) {
      currentGroup.push(item)
    } else if (isWhitespace(item)) {
      if (currentGroup.length > 0) {
        let foundNextWebSearch = false
        for (let j = i + 1; j < items.length; j++) {
          const nextItem = items[j]
          if (isWhitespace(nextItem)) {
            continue
          }
          if (isWebSearch(nextItem)) {
            foundNextWebSearch = true
          }
          break
        }
        if (foundNextWebSearch) {
          currentGroup.push(item)
        } else {
          if (currentGroup.length > 1) {
            groupedItems.push({ type: 'grouped_web_searches', items: currentGroup })
          } else if (currentGroup.length === 1) {
            groupedItems.push(currentGroup[0])
          }
          currentGroup = []
          groupedItems.push(item)
        }
      } else {
        groupedItems.push(item)
      }
    } else {
      if (currentGroup.length > 1) {
        groupedItems.push({ type: 'grouped_web_searches', items: currentGroup })
      } else if (currentGroup.length === 1) {
        groupedItems.push(currentGroup[0])
      }
      currentGroup = []
      groupedItems.push(item)
    }
  }
  if (currentGroup.length > 1) {
    groupedItems.push({ type: 'grouped_web_searches', items: currentGroup })
  } else if (currentGroup.length === 1) {
    groupedItems.push(currentGroup[0])
  }

  return (
    <StreamContext.Provider value={streamStats}>
      <div
        className={clsx(
          'flex flex-col gap-4 w-full max-w-none transition-opacity duration-500',
          msg.isStreaming && 'opacity-90'
        )}
      >
        <div className="flex flex-col gap-2 relative">
          {groupedItems.map((gItem) => {
            if ('items' in gItem) {
              const group = gItem as { type: 'grouped_web_searches'; items: PartItem[] }
              const toolCallItems = group.items.filter((item) => item.type === 'tool_call')

              // 1. Determine merged status
              let mergedStatus: ToolCall['status'] = 'done'
              if (
                toolCallItems.some((item) => !item.isClosed || item.toolCall?.status === 'writing')
              ) {
                mergedStatus = 'writing'
              } else if (toolCallItems.some((item) => item.toolCall?.status === 'running')) {
                mergedStatus = 'running'
              } else if (toolCallItems.some((item) => item.toolCall?.status === 'error')) {
                mergedStatus = 'error'
              } else if (toolCallItems.some((item) => item.toolCall?.status === 'cancelled')) {
                mergedStatus = 'cancelled'
              }

              // 2. Consolidate search updates and detect if it's youtube
              const consolidatedUpdates: string[] = []
              toolCallItems.forEach((tcItem) => {
                const tc = tcItem.toolCall
                if (tc) {

                  if (tc.searchUpdates && tc.searchUpdates.length > 0) {
                    consolidatedUpdates.push(...tc.searchUpdates)
                  } else if (typeof tc.args?.query === 'string' && tc.args.query) {
                    consolidatedUpdates.push(tc.args.query)
                  }
                } else {
                  // Unclosed (writing) tool call
                  const partText = tcItem.part
                  const queryMatch = partText.match(/"query"\s*:\s*"([^"]*)/i)
                  if (queryMatch) {
                    consolidatedUpdates.push(queryMatch[1])
                  } else {
                    consolidatedUpdates.push('Composing search')
                  }
                }
              })

              const firstItem = group.items[0]
              if (!shouldShowInlineTool(mergedStatus, firstItem.partIndex)) {
                return null
              }
              if (shouldHideActiveBelow && (mergedStatus === 'writing' || mergedStatus === 'running')) {
                return null
              }
              return (
                <div key={`tc-group-${firstItem.partIndex}`} className="flex items-center gap-1.5">
                  <ToolCallIndicator
                    tools={[{ name: 'web_search', status: mergedStatus }]}
                  />
                </div>
              )
            }

            const item = gItem as PartItem
            const { part, startOffset } = item

            if (item.type === 'tool_call') {
              if (item.isClosed) {
                const tc = item.toolCall
                if (tc) {
                  if (tc.name === 'to_ask') {
                    return (
                      <QuestionnaireRenderer
                        key={`tc-${item.partIndex}`}
                        toolCall={tc}
                        chatId={currentChatId || ''}
                      />
                    )
                  }
                  if (tc.name === 'render_chat_history') {
                    return (
                      <RenderChatHistory
                        key={`tc-${item.partIndex}`}
                        chatId={String(tc.args.query || '')}
                        onOpenChat={handleLoadChat}
                      />
                    )
                  }
                  if (tc.name === 'malformed_tool_call') {
                    return <MalformedToolCallWarning key={`tc-${item.partIndex}`} toolCall={tc} />
                  }
                  if (!shouldShowInlineTool(tc.status, item.partIndex)) {
                    return null
                  }
                  if (shouldHideActiveBelow && (tc.status === 'writing' || tc.status === 'running')) {
                    return null
                  }
                  return (
                    <div key={`tc-${item.partIndex}`} className="flex items-center gap-1.5">
                      <ToolCallIndicator
                        tools={[{ name: tc.name, status: tc.status }]}
                      />
                    </div>
                  )
                }
              } else {
                if (!shouldShowInlineTool('writing', item.partIndex)) return null
                if (shouldHideActiveBelow) return null
                const isSearch =
                  item.writingToolName === 'web_search' ||
                  item.writingToolName === 'search_chat_history' ||
                  item.writingToolName === 'saw_link_from_url' ||
                  item.writingToolName === 'search'
                const toolType = isSearch ? 'search' : 'task'
                return (
                  <div key={`writing-tc-${item.partIndex}`} className="flex items-center gap-1.5">
                    <ToolCallIndicator
                      tools={[{ name: item.writingToolName || toolType, status: 'writing' }]}
                    />
                  </div>
                )
              }
              return null
            } else if (item.type === 'mini_app') {
              if (item.isClosed) {
                const titleMatch = part.match(/<title>([\s\S]*?)<\/title>/i)
                const htmlMatch = part.match(/<html>([\s\S]*?)<\/html>/i)
                const cssMatch = part.match(/<css>([\s\S]*?)<\/css>/i)
                const jsMatch = part.match(/<js>([\s\S]*?)<\/js>/i)

                const contentHash = part.length.toString(36)
                const miniAppId = `mini-app-${item.partIndex}-${contentHash}`

                return (
                  <div key={miniAppId} className="w-full my-4 px-0">
                    <MiniAppRenderer
                      id={miniAppId}
                      title={titleMatch ? titleMatch[1].trim() : 'Mini App'}
                      html={htmlMatch ? htmlMatch[1].trim() : ''}
                      css={cssMatch ? cssMatch[1].trim() : ''}
                      js={jsMatch ? jsMatch[1].trim() : ''}
                    />
                  </div>
                )
              } else {
                if (!shouldShowInlineTool('writing', item.partIndex)) return null
                if (shouldHideActiveBelow) return null
                return (
                  <div key={`writing-ma-${item.partIndex}`} className="flex items-center gap-1.5">
                    <ToolCallIndicator
                      tools={[{ name: 'mini-app', status: 'writing' }]}
                    />
                  </div>
                )
              }
              return null
            } else if (part.trim() !== '') {
              return (
                <div
                  key={`text-${item.partIndex}`}
                  className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-background-secondary prose-pre:border prose-pre:border-surface/50 prose-code:font-mono prose-code:text-[12px] prose-p:font-light prose-p:text-sm md:prose-p:text-base prose-li:text-sm md:prose-li:text-base"
                >
                  <ReactMarkdown
                    remarkPlugins={[
                      remarkGfm,
                      remarkMath,
                      disableIndentedCode as unknown as import('unified').Pluggable
                    ]}
                    rehypePlugins={[
                      rehypeRaw,
                      rehypeParseMath,
                      rehypeKatex,
                      createStreamingFadeRehypePlugin(streamStats, startOffset)
                    ]}
                    components={markdownComponents}
                  >
                    {part}
                  </ReactMarkdown>
                </div>
              )
            }
            return null
          })}
          {!msg.content.includes('[PRISM_EXECUTE_TOOL]') && nativeToolCalls.length > 0 && (
            <div className="flex flex-col items-start gap-1.5 mt-1 w-full">
              {nativeToolCalls.map((tc, idx) => {
                if (tc.name === 'to_ask') {
                  return (
                    <QuestionnaireRenderer
                      key={`native-tc-${idx}`}
                      toolCall={tc}
                      chatId={currentChatId || ''}
                    />
                  )
                }
                if (tc.name === 'render_chat_history') {
                  return (
                    <RenderChatHistory
                      key={`native-tc-${idx}`}
                      chatId={String(tc.args.query || '')}
                      onOpenChat={handleLoadChat}
                    />
                  )
                }
                if (tc.name === 'malformed_tool_call') {
                  return <MalformedToolCallWarning key={`native-tc-${idx}`} toolCall={tc} />
                }
                if (tc.name === 'create_mini_app') {
                  const title = (tc.args.title || 'Mini App') as string
                  const html = (tc.args.html || '') as string
                  const css = (tc.args.css || '') as string
                  const js = (tc.args.js || '') as string
                  const status = tc.status

                  const miniAppId = `mini-app-native-${idx}-${title.replace(/\s+/g, '-').toLowerCase()}`

                  if (status === 'writing' || status === 'running') {
                    if (shouldHideIndicator(status)) return null
                    if (shouldHideActiveBelow) return null
                    return (
                      <div key={miniAppId} className="flex items-center gap-1.5 mt-1">
                        <ToolCallIndicator tools={[{ name: 'create_mini_app', status }]} />
                      </div>
                    )
                  }

                  return (
                    <div key={miniAppId} className="w-full flex flex-col gap-2 my-2 select-none animate-fade-in">
                      <div className="flex items-center gap-2 text-[13px] text-text-secondary font-medium">
                        {status === 'error' || status === 'cancelled' ? (
                          <>
                            <XCircle size={14} className="text-status-error shrink-0" />
                            <span>Failed to create mini app: <span className="font-semibold text-text-primary">{title}</span></span>
                          </>
                        ) : (
                          <>
                            <CheckCircle size={14} className="text-status-success shrink-0" />
                            <span>Created mini app: <span className="font-semibold text-text-primary">{title}</span></span>
                          </>
                        )}
                      </div>
                      {status === 'done' && (
                        <div className="w-full px-0">
                          <MiniAppRenderer
                            id={miniAppId}
                            title={title}
                            html={html}
                            css={css}
                            js={js}
                          />
                        </div>
                      )}
                    </div>
                  )
                }
                return null
              })}
              {visibleNativeTools.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <ToolCallIndicator
                    tools={visibleNativeTools.map(tc => ({
                      name: tc.name,
                      status: tc.status
                    }))}
                  />
                </div>
              )}
            </div>
          )}

          {!shouldHideIndicator('writing') && !shouldHideActiveBelow && msg.isWritingToolCall &&
            !msg.content.includes('[PRISM_EXECUTE_TOOL]') &&
            !msg.content.includes('<mini_app>') &&
            nativeToolCalls.length === 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <ToolCallIndicator
                  tools={[{ name: msg.toolType || 'task', status: 'writing' }]}
                />
              </div>
            )}

          {!msg.isStreaming && msg.content && parts[parts.length - 1].trim() && (
            <div className="flex justify-start items-center gap-2 mt-2">
              <TtsButton text={parts[parts.length - 1].trim()} />
              <CopyMessageButton text={parts[parts.length - 1].trim()} />
            </div>
          )}
        </div>
      </div>
    </StreamContext.Provider>
  )
})

function RealApp(): React.JSX.Element {
  const [bootComplete, setBootComplete] = useState(false)
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine)
  const [messages, setMessages] = useState<Message[]>([])
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({})

  // Dedicated Mini-app Window Logic
  const [miniAppData, setMiniAppData] = useState<{
    id: string
    title: string
    html: string
    css: string
    js: string
  } | null>(null)

  useEffect(() => {
    if (window.location.hash === '#mini-app') {
      const fetchMiniAppData = async (): Promise<void> => {
        try {
          const data = await window.api.getMiniAppData()
          if (data) {
            setMiniAppData(data)
          }
        } catch (err) {
          console.error('Failed to get mini app data:', err)
        }
      }
      fetchMiniAppData()

      const removeListener = window.api.onMiniAppData((data) => {
        setMiniAppData(data)
      })
      return () => removeListener()
    }
    return undefined
  }, [])

  const [isProcessing, setIsProcessing] = useState(false)
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null)
  const attachedFileRef = useRef<AttachedFile | null>(null)
  useEffect(() => {
    attachedFileRef.current = attachedFile
  }, [attachedFile])

  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false)
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState('prism-6-super-fast')
  const [activeView, setActiveView] = useState('chat')
  const [currentChatId, setCurrentChatId] = useState<string | undefined>(undefined)
  const [runningChats, setRunningChats] = useState<Record<string, boolean>>({})
  const currentChatIdRef = useRef<string | undefined>(undefined)
  const [currentChatTitle, setCurrentChatTitle] = useState<string | null>(null)
  const [isTitleStreaming, setIsTitleStreaming] = useState(false)
  const titleIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isYoutubeMode, setIsYoutubeMode] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [inputText, setInputText] = useState('')
  const [activeWorkflow, setActiveWorkflow] = useState<SlashWorkflow | null>(null)
  const [sessionMode, setSessionMode] = useState<SessionMode>('execution')
  const [disciplinePath, setDisciplinePath] = useState('')

  useEffect(() => {
    setActiveWorkflow(null)
  }, [currentChatId])

  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isFullscreenInput, setIsFullscreenInput] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [chatTodos, setChatTodos] = useState<Record<string, TodoState>>({})
  const [isTodoPanelOpen, setIsTodoPanelOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  const [quotedText, setQuotedText] = useState<string | null>(null)
  const markdownComponents = useMemo(
    () => ({
      ...MarkdownComponents,
      ...StaticMarkdownComponents
    }),
    []
  )
  const quotedTextRef = useRef<string | null>(null)
  useEffect(() => {
    quotedTextRef.current = quotedText
  }, [quotedText])

  const sessionModeRef = useRef<SessionMode>('execution')
  useEffect(() => {
    sessionModeRef.current = sessionMode
  }, [sessionMode])

  const disciplinePathRef = useRef('')
  useEffect(() => {
    disciplinePathRef.current = disciplinePath
  }, [disciplinePath])

  const [floatingMenu, setFloatingMenu] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)

  // Text selection listener for Answer Prism
  useEffect(() => {
    const handleSelectionChange = (): void => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setFloatingMenu(null)
        return
      }

      const text = selection.toString().trim()
      if (text.length === 0) {
        setFloatingMenu(null)
        return
      }

      try {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()

        // Position fixed coordinates relative to viewport
        setFloatingMenu({
          x: rect.left + rect.width / 2,
          y: rect.top,
          text
        })
      } catch (e) {
        // ignore range error
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [])

  // Clear quotedText if input area is cleared
  useEffect(() => {
    if (!inputText) {
      setQuotedText(null)
    }
  }, [inputText])

  const handleAnswerPrism = useCallback((quoteText: string): void => {
    const blockquote = `> ${quoteText.replace(/\n/g, '\n> ')}\n\n`
    setInputText((prev) => blockquote + prev)
    setQuotedText(quoteText)
    window.getSelection()?.removeAllRanges()
    setFloatingMenu(null)
    setTimeout(() => {
      inputBarRef.current?.focus()
    }, 50)
  }, [])

  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

  const isProcessingRef = useRef(isProcessing)
  useEffect(() => {
    isProcessingRef.current = isProcessing
  }, [isProcessing])

  // Mirror online status into a ref so handleSend (a useCallback) reads the
  // latest value without stale closures.
  const isOnlineRef = useRef(isOnline)
  useEffect(() => {
    isOnlineRef.current = isOnline
  }, [isOnline])

  // Track connectivity via browser events AND main-process push events.
  // navigator.onLine is unreliable in Electron (it checks if a network
  // interface is up, not actual internet connectivity). The main process
  // monitors real connectivity every 5 s and pushes changes via IPC.
  useEffect(() => {
    const goOnline = (): void => setIsOnline(true)
    const goOffline = (): void => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Main-process connectivity push: instant state changes without polling.
    const removeConnectivityListener = window.api.onConnectivityChanged((online: boolean) => {
      if (online && !isOnlineRef.current) {
        // Connection restored — reset boot to show loading screen and
        // re-run the connection test (equivalent to Ctrl+R, but avoids
        // the main-process crash caused by reloading the renderer).
        setBootComplete(false)
      }
      setIsOnline(online)
    })

    return () => {
      removeConnectivityListener()
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const isSearchEnabledRef = useRef(isSearchEnabled)
  useEffect(() => {
    isSearchEnabledRef.current = isSearchEnabled
  }, [isSearchEnabled])

  const isYoutubeModeRef = useRef(isYoutubeMode)
  useEffect(() => {
    isYoutubeModeRef.current = isYoutubeMode
  }, [isYoutubeMode])

  useEffect(() => {
    async function initRunningChats(): Promise<void> {
      try {
        const running = await window.api.getRunningChats()
        const runningMap: Record<string, boolean> = {}
        running.forEach((id) => {
          runningMap[id] = true
        })
        setRunningChats(runningMap)
      } catch (e) {
        console.error('Failed to get running chats:', e)
      }
    }
    initRunningChats()
  }, [])

  useEffect(() => {
    const removeDownloadProgressListener = window.api.onDownloadProgress((download) => {
      setDownloads((prev) => ({
        ...prev,
        [download.id]: download
      }))

      if (['completed', 'failed', 'cancelled'].includes(download.status)) {
        const delay = download.status === 'completed' ? 4500 : 7000
        window.setTimeout(() => {
          setDownloads((prev) => {
            const current = prev[download.id]
            if (!current || current.updatedAt !== download.updatedAt) return prev

            const next = { ...prev }
            delete next[download.id]
            return next
          })
        }, delay)
      }
    })

    return () => {
      removeDownloadProgressListener()
    }
  }, [])

  useEffect(() => {
    async function init(): Promise<void> {
      const cfg = await window.api.getConfig()
      if (cfg) {
        setConfig(cfg)
        if (cfg.lastSelectedChatModel) {
          setSelectedModel(cfg.lastSelectedChatModel)
          window.api.setModel(cfg.lastSelectedChatModel)
        }
        if (cfg.sessionMode) {
          setSessionMode(cfg.sessionMode)
        }
        if (cfg.disciplinePath) {
          setDisciplinePath(cfg.disciplinePath)
        }
        // Sync to backend in-memory CWD/mode on startup
        window.api.setSessionMode(
          cfg.sessionMode || 'execution',
          (cfg.sessionMode || 'execution') === 'discipline' ? cfg.disciplinePath : ''
        )
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!config) return
    document.documentElement.setAttribute('data-theme', config.theme || 'marine')
  }, [config])

  const route = window.location.hash
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const isProgrammaticScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const isStreamingRef = useRef(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const inputBarRef = useRef<InputBarHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)

  const [greetingIndex, setGreetingIndex] = useState(0)

  useEffect(() => {
    if (messages.length === 0) {
      const randomIndex = Math.floor(Math.random() * 15)
      setGreetingIndex(randomIndex)
    }
  }, [messages.length])

  const getGreeting = (): React.JSX.Element => {
    const rawName = config?.username || 'user'
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    const highlight = (
      <span className="font-medium text-accent-primary rgb-chroma-username">{formattedName}</span>
    )

    const greetings = [
      <>Talk to me, {highlight}.</>,
      <>Hey, {highlight}. Whenever you want.</>,
      <>Hi, {highlight}, can I help you?</>,
      <>What can I do for you today, {highlight}?</>,
      <>Ready when you are, {highlight}.</>,
      <>How's it going, {highlight}? Let's build.</>,
      <>What's on your mind, {highlight}?</>,
      <>Welcome back, {highlight}. What are we creating?</>,
      <>How can I make your day easier, {highlight}?</>,
      <>Tell me what you need, {highlight}.</>,
      <>I'm listening, {highlight}.</>,
      <>Let's get to work, {highlight}.</>,
      <>What's the plan today, {highlight}?</>,
      <>Need a hand with something, {highlight}?</>,
      <>Let's code, {highlight}!</>
    ]

    return greetings[greetingIndex] || greetings[0]
  }

  const handleSearchEnabledToggle = useCallback((val: boolean) => {
    window.api.setSearchEnabled(val)
  }, [])

  const handleModeChangeClick = useCallback(async (newMode: SessionMode) => {
    setSessionMode(newMode)
    let path = disciplinePath
    if (newMode === 'discipline' && !disciplinePath) {
      const selected = await window.api.selectFolder()
      if (selected) {
        setDisciplinePath(selected)
        path = selected
      } else {
        setSessionMode('execution')
        window.api.setSessionMode('execution', '')
        return
      }
    }
    window.api.setSessionMode(newMode, newMode === 'discipline' ? path : '')
  }, [disciplinePath])

  const handleSelectFolderClick = useCallback(async () => {
    const selected = await window.api.selectFolder()
    if (selected) {
      setDisciplinePath(selected)
      window.api.setSessionMode('discipline', selected)
    }
  }, [])

  const handleSend = useCallback(
    (
      text: string,
      searchEnabled?: boolean,
      screenshot?: string,
      file?: AttachedFile,
      youtubeMode?: boolean
    ): void => {
      if (isProcessingRef.current) return
      // Block messaging while offline.
      if (!isOnlineRef.current) return

      setIsProcessing(true)
      isProcessingRef.current = true

      const targetYoutubeMode = youtubeMode ?? isYoutubeModeRef.current
      setIsYoutubeMode(targetYoutubeMode)

      if (searchEnabled !== undefined) {
        window.api.setSearchEnabled(searchEnabled)
        setIsSearchEnabled(searchEnabled)
        isSearchEnabledRef.current = searchEnabled
      }

      // Generate a unique chatId if not set
      let chatId = currentChatIdRef.current
      if (!chatId) {
        chatId = Date.now().toString()
        setCurrentChatId(chatId)
        currentChatIdRef.current = chatId
      }

      // Update running status
      setRunningChats((prev) => ({ ...prev, [chatId!]: true }))

      const activeFile = file || attachedFileRef.current
      const activeScreenshot =
        screenshot || (activeFile?.mimeType.startsWith('image/') ? activeFile.data : undefined)

      // Para a UI, removemos a tag feia se ela existir
      const displayContent = text
        .replace(/<attached_file[^>]*\/>/gi, '')
        .replace(/^\[FORCE_SEARCH\]\s*/i, '')
        .trim()

      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: displayContent,
          screenshot: activeScreenshot || undefined,
          file: activeFile || undefined
        }
      ])

      // If search is enabled, ensure [FORCE_SEARCH] is prefixed for API
      let apiMessage = text
      if (activeFile && !activeFile.mimeType.startsWith('image/')) {
        apiMessage = `<attached_file name="${activeFile.name}" mime="${activeFile.mimeType}" /> ${apiMessage}`
      }

      const targetSearchEnabled = searchEnabled ?? isSearchEnabledRef.current
      if (targetSearchEnabled && !apiMessage.startsWith('[FORCE_SEARCH]')) {
        apiMessage = `[FORCE_SEARCH] ${apiMessage}`
      }

      window.api.sendChatMessage({
        message: apiMessage,
        chatId,
        screenshot: activeScreenshot || undefined,
        attachedFile: activeFile || undefined,
        quote: quotedTextRef.current || undefined,
        appMode: targetYoutubeMode ? 'youtube' : undefined,
        sessionMode: sessionModeRef.current,
        disciplinePath: sessionModeRef.current === 'discipline' ? disciplinePathRef.current : '',
        modelKey: selectedModel
      })

      setAttachedFile(null)
      setQuotedText(null)
      setIsYoutubeMode(false)
      isYoutubeModeRef.current = false
      setActiveWorkflow(null)
    },
    [selectedModel]
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth'): void => {
      if (scrollContainerRef.current && activeView === 'chat') {
        isProgrammaticScrollRef.current = true
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior
        })
        isAtBottomRef.current = true
        setShowScrollButton(false)
      } else if (activeView === 'chat') {
        messagesEndRef.current?.scrollIntoView({ behavior })
      }
    },
    [activeView]
  )

  const handleScroll = (): void => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const threshold = isStreamingRef.current ? 150 : 100

    if (scrollTop !== lastScrollTopRef.current) {
      const atBottom = scrollHeight - scrollTop - clientHeight < threshold

      if (scrollTop < lastScrollTopRef.current) {
        isProgrammaticScrollRef.current = false
        isAtBottomRef.current = false
      } else if (isProgrammaticScrollRef.current) {
        if (atBottom) {
          isProgrammaticScrollRef.current = false
        }
        isAtBottomRef.current = true
      } else {
        isAtBottomRef.current = atBottom
      }

      lastScrollTopRef.current = scrollTop
    }

    const atBottomFinal = scrollHeight - scrollTop - clientHeight < threshold
    setShowScrollButton(!atBottomFinal && scrollHeight > clientHeight)
  }

  const handleModelChange = useCallback((newModel: string): void => {
    setSelectedModel(newModel)
    window.api.setModel(newModel)
    if (config) {
      const updatedConfig = { ...config, lastSelectedChatModel: newModel }
      setConfig(updatedConfig)
      window.api.saveConfig(updatedConfig)
    }
  }, [config])

  const handleReasoningLevelChange = useCallback(async (modelId: string, level: string): Promise<void> => {
    if (!config) return
    const updatedLevels = {
      ...(config.modelReasoningLevels || {}),
      [modelId]: level
    }
    const updatedConfig = {
      ...config,
      modelReasoningLevels: updatedLevels
    }
    setConfig(updatedConfig)
    await window.api.saveConfig(updatedConfig)
  }, [config])

  const handleCancel = useCallback((): void => {
    if (currentChatIdRef.current) {
      window.api.cancelChat(currentChatIdRef.current)
    } else {
      window.api.cancelChat()
    }
  }, [])

  const handleLoadChat = useCallback(
    async (id: string): Promise<void> => {
      if (id === currentChatId) return
      const history = await window.api.loadChat(id)
      if (history) {
        isAtBottomRef.current = true
        setShowScrollButton(false)
        const mappedMessages: Message[] = []

        for (const m of history) {
          let text = ''
          let screenshot: string | undefined = undefined
          let file: AttachedFile | undefined = undefined

          const mAny = m as any
          if (typeof mAny.content === 'string') {
            text = mAny.content
          } else if (Array.isArray(mAny.content)) {
            for (const part of mAny.content) {
              if (typeof part === 'string') {
                text += part
              } else if (part?.text) {
                text += part.text
              }
              if (part?.type === 'image_url' && part.image_url?.url) {
                screenshot = part.image_url.url
              }
            }
          } else if (m.parts) {
            for (const part of m.parts) {
              if (part.text) {
                text += part.text
              }
            }
            for (const part of m.parts) {
              if (part.inlineData) {
                if (part.inlineData.mimeType?.startsWith('image/')) {
                  screenshot = part.inlineData.data
                } else {
                  const fileMatch = text.match(
                    /<attached_file\s+name="([^"]+)"\s+mime="([^"]+)"\s*\/>/i
                  )
                  file = {
                    name: fileMatch ? fileMatch[1] : 'Attached File',
                    mimeType: part.inlineData.mimeType || 'application/octet-stream',
                    data: part.inlineData.data || ''
                  }
                }
              }
            }
          }

          const hasFunctionResponse = m.parts?.some(p => (p as any).functionResponse)
          if (m.role === 'user' && hasFunctionResponse && m.parts) {
            const lastAiMsg = [...mappedMessages].reverse().find((msg) => msg.role === 'ai')
            if (lastAiMsg && lastAiMsg.toolCalls) {
              for (const part of m.parts) {
                const fRes = (part as any).functionResponse
                if (fRes) {
                  const { name, response } = fRes
                  const resultStr = typeof response?.result === 'string' ? response.result : JSON.stringify(response || '')
                  const toolCall = lastAiMsg.toolCalls.find(
                    (tc) => tc.name === name && !tc.result
                  )
                  if (toolCall) {
                    toolCall.result = resultStr
                    toolCall.status = 'done'
                  }
                }
              }
            }
            continue
          }

          const isSystemResults = text.startsWith('[SYSTEM: TOOL RESULTS]')

          if (isSystemResults) {
            // Find last AI message to attach results
            const lastAiMsg = [...mappedMessages].reverse().find((msg) => msg.role === 'ai')
            if (lastAiMsg && lastAiMsg.toolCalls) {
              const resultRegex =
                /\[RESULT FOR ([a-zA-Z0-9_]+)\]:\n([\s\S]*?)(?=\n\[RESULT FOR |\nAnalyze these results|$)/g
              let match
              while ((match = resultRegex.exec(text)) !== null) {
                const toolName = match[1]
                const result = match[2].trim()
                // Find matching tool call that doesn't have a result yet
                const toolCall = lastAiMsg.toolCalls.find(
                  (tc) => tc.name === toolName && !tc.result
                )
                if (toolCall) {
                  toolCall.result = result
                  toolCall.status = 'done'
                }
              }
            }
            continue // Don't add system results to UI as separate bubbles
          }

          if (m.role === 'system') {
            continue
          }

          if (m.role === 'user') {
            const cleanText = text
              .replace(/<quote_context>[\s\S]*?<\/quote_context>/gi, '')
              .replace(/<youtube_app_context>[\s\S]*?<\/youtube_app_context>/gi, '')
              .replace(/<attached_file[^>]*\/>/gi, '')
              .replace(/^\[FORCE_SEARCH\]\s*/i, '')
              .trim()

            mappedMessages.push({
              role: 'user',
              content: cleanText,
              screenshot,
              file,
              isStreaming: false
            })
          } else if (m.role === 'model' || m.role === 'assistant') {
            let aiMsg: Message | undefined = mappedMessages[mappedMessages.length - 1]

            if (!aiMsg || aiMsg.role !== 'ai') {
              aiMsg = {
                role: 'ai',
                content: '',
                thoughts: '',
                toolCalls: [],
                isStreaming: false,
                isThinking: false,
                isConnecting: false
              }
              mappedMessages.push(aiMsg)
            }

            // Extract explicit reasoning/thoughts stored on message object
            const directReasoning = (m as any).reasoning_content || (m as any).reasoning || (m as any).thoughts
            if (directReasoning && typeof directReasoning === 'string') {
              aiMsg.thoughts = (aiMsg.thoughts ? aiMsg.thoughts + '\n\n' : '') + directReasoning.trim()
            }

            // Reconstruct native tool calls from functionCall parts or tool_calls
            if (Array.isArray(mAny.tool_calls)) {
              for (const tc of mAny.tool_calls) {
                if (!aiMsg.toolCalls) aiMsg.toolCalls = []
                let tcArgs: any = {}
                try {
                  tcArgs = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {}
                } catch {
                  tcArgs = { raw: tc.function?.arguments }
                }
                const tcName = tc.function?.name || ''
                const alreadyExists = aiMsg.toolCalls.some(t => t.name === tcName && JSON.stringify(t.args) === JSON.stringify(tcArgs))
                if (tcName && !alreadyExists) {
                  aiMsg.toolCalls.push({
                    name: tcName,
                    args: tcArgs,
                    status: 'done'
                  })
                }
              }
            }

            for (const part of m.parts || []) {
              const fCall = (part as any).functionCall
              if (fCall) {
                const name = fCall.name
                const args = fCall.args || {}
                if (!aiMsg.toolCalls) aiMsg.toolCalls = []
                const alreadyExists = aiMsg.toolCalls.some(tc => tc.name === name && JSON.stringify(tc.args) === JSON.stringify(args))
                if (!alreadyExists) {
                  const newToolCall: ToolCall = {
                    name,
                    args,
                    status: 'done'
                  }
                  if (name === 'web_search' && args.searches && Array.isArray(args.searches)) {
                    newToolCall.searchUpdates = args.searches
                      .map((s: any) => s.title)
                      .filter(Boolean)
                  }
                  aiMsg.toolCalls.push(newToolCall)
                }
              }
            }

            // Parse Thoughts and extract them from content tags (<thought> or <think>)
            const thoughtsRegex = /<(?:thought|think)>([\s\S]*?)<\/(?:thought|think)>/gi
            let thoughtsMatch
            while ((thoughtsMatch = thoughtsRegex.exec(text)) !== null) {
              aiMsg.thoughts = (aiMsg.thoughts ? aiMsg.thoughts + '\n\n' : '') + thoughtsMatch[1].trim()
            }

            // Remove thoughts from the text that will become content
            const textWithoutThoughts = text.replace(/<(?:thought|think)>[\s\S]*?<\/(?:thought|think)>/gi, '').trim()

            // Parse Tool Calls (DO NOT remove from content, as renderAiMessage needs them as markers)
            const toolCallRegex = /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/gi
            let toolMatch
            while ((toolMatch = toolCallRegex.exec(textWithoutThoughts)) !== null) {
              const tcContent = toolMatch[1].trim()

              let parsedJson: any = null
              let isJson = false

              let jsonContent = tcContent
              if (jsonContent.startsWith('```')) {
                jsonContent = jsonContent
                  .replace(/^```[a-z]*\n/i, '')
                  .replace(/\n```$/i, '')
                  .trim()
              }

              if (jsonContent.startsWith('{')) {
                try {
                  parsedJson = JSON.parse(jsonContent)
                  isJson = true
                } catch (e) {
                  console.error('Failed to parse tool call JSON in history', e)
                }
              }

              if (isJson && parsedJson) {
                const name = parsedJson.type || parsedJson.name
                if (name) {
                  const args: Record<string, any> = {}
                  for (const [key, value] of Object.entries(parsedJson)) {
                    if (key === 'type') continue
                    if (key === 'name' && value === name) continue
                    args[key] = value
                  }

                  if (!aiMsg.toolCalls) aiMsg.toolCalls = []
                  const newToolCall: ToolCall = {
                    name,
                    args,
                    status: 'done' // Default to done for history
                  }
                  if (name === 'web_search' && args.searches && Array.isArray(args.searches)) {
                    newToolCall.searchUpdates = args.searches
                      .map((s: any) => s.title)
                      .filter(Boolean)
                  }
                  aiMsg.toolCalls.push(newToolCall)
                }
              } else {
                // Legacy XML parsing fallback
                const nameMatch = tcContent.match(/<name>([\s\S]*?)<\/name>/i)
                if (nameMatch) {
                  const name = nameMatch[1].trim()
                  const args: Record<string, string> = {}
                  const argRegex = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/gi
                  let argMatch
                  while ((argMatch = argRegex.exec(tcContent)) !== null) {
                    const argName = argMatch[1]
                    if (argName !== 'name') {
                      args[argName] = argMatch[2].trim()
                    }
                  }

                  if (!aiMsg.toolCalls) aiMsg.toolCalls = []
                  aiMsg.toolCalls.push({
                    name,
                    args,
                    status: 'done' // Default to done for history
                  })
                }
              }
            }

            if (textWithoutThoughts) {
              aiMsg.content = (aiMsg.content ? aiMsg.content + '\n\n' : '') + textWithoutThoughts
            }
          }
        }

        // If this chat is currently running, we need to mark it as streaming
        const isRunning = !!runningChats[id]
        setIsProcessing(isRunning)

        if (isRunning && mappedMessages.length > 0) {
          const lastMsg = mappedMessages[mappedMessages.length - 1]
          if (lastMsg.role === 'ai') {
            lastMsg.isStreaming = true
            if (lastMsg.toolCalls && lastMsg.toolCalls.length > 0) {
              const lastTool = lastMsg.toolCalls[lastMsg.toolCalls.length - 1]
              if (!lastTool.result) {
                lastTool.status = 'running'
              }
            }
          }
        }

        // Cleanup trailing whitespace in thoughts
        mappedMessages.forEach((m) => {
          if (m.thoughts) m.thoughts = m.thoughts.trim()
        })

        setMessages(mappedMessages)
        setCurrentChatId(id)
        currentChatIdRef.current = id

        const chatModel = await window.api.getChatModel(id)
        if (chatModel) {
          setSelectedModel(chatModel)
          window.api.setModel(chatModel)
        }

        // Retrieve and set the chat title statically
        window.api
          .getChats()
          .then((chatsList) => {
            const foundChat = chatsList.find((c) => c.id === id)
            if (foundChat) {
              if (
                foundChat.title &&
                foundChat.title !== 'New Conversation' &&
                foundChat.title !== 'Nova Conversa'
              ) {
                setCurrentChatTitle(foundChat.title)
              } else {
                setCurrentChatTitle(null)
              }
              if (foundChat.sessionMode) {
                setSessionMode(foundChat.sessionMode)
                window.api.setSessionMode(foundChat.sessionMode, foundChat.disciplinePath)
              }
              if (foundChat.disciplinePath) {
                setDisciplinePath(foundChat.disciplinePath)
              } else {
                setDisciplinePath('')
              }
            } else {
              setCurrentChatTitle(null)
            }
          })
          .catch((err) => {
            console.error('Failed to load title for chat:', id, err)
            setCurrentChatTitle(null)
          })
        setIsTitleStreaming(false)
        if (titleIntervalRef.current) {
          clearInterval(titleIntervalRef.current)
          titleIntervalRef.current = null
        }
        window.api.getTodoForChat(id).then((todo) => {
          if (todo) {
            setChatTodos((prev) => ({
              ...prev,
              [id]: todo
            }))
            setIsTodoPanelOpen(todo.active)
          } else {
            setIsTodoPanelOpen(false)
          }
        }).catch((err) => {
          console.error('Failed to load todo for chat:', id, err)
          setIsTodoPanelOpen(false)
        })
      }
    },
    [currentChatId, runningChats]
  )

  const handleNewChat = useCallback((force = false): void => {
    if (force && currentChatIdRef.current) {
      window.api.cancelChat(currentChatIdRef.current)
    }
    isAtBottomRef.current = true
    setShowScrollButton(false)
    setMessages([])
    setCurrentChatId(undefined)
    currentChatIdRef.current = undefined
    setIsProcessing(false)
    isProcessingRef.current = false
    setIsTodoPanelOpen(false)
    setInputText('')
    setIsFullscreenInput(false)
    window.api.clearChat()
    if (config?.lastSelectedChatModel) {
      setSelectedModel(config.lastSelectedChatModel)
      window.api.setModel(config.lastSelectedChatModel)
    }
    setCurrentChatTitle(null)
    setIsTitleStreaming(false)
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current)
      titleIntervalRef.current = null
    }
  }, [config?.lastSelectedChatModel])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const shortcut = config?.newChatShortcut || 'CommandOrControl+N'
      if (isShortcutPressed(e, shortcut)) {
        e.preventDefault()
        handleNewChat()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleNewChat, config?.newChatShortcut])

  useEffect(() => {
    // Listen for launcher messages
    const removeLauncherListener = window.api.onLauncherMessage((data) => {
      setActiveView('chat')
      // If launcher message arrives with the tag, handleSend will take care of hiding it in the UI
      handleSend(
        data.message,
        undefined,
        data.screenshot,
        undefined,
        data.appMode === 'youtube'
      )
      // Ensure focus after message is sent
      setTimeout(() => {
        inputBarRef.current?.focus()
      }, 100)
    })

    const removeModelListener = window.api.onModelChanged((modelKey) => {
      setSelectedModel(modelKey)
    })

    const removeConfigListener = window.api.onConfigChanged((cfg) => {
      setConfig(cfg)
      if (cfg.sessionMode) {
        setSessionMode(cfg.sessionMode)
      }
      if (cfg.disciplinePath) {
        setDisciplinePath(cfg.disciplinePath)
      }
    })

    const removeSearchEnabledListener = window.api.onSearchEnabledChanged((val) => {
      setIsSearchEnabled(val)
    })

    const removeOpenMainAppListener = window.api.onOpenMainAppWithInstructions((data) => {
      setActiveView('chat')
      handleModelChange(data.model)
      handleNewChat(true)

      if (data.searchEnabled !== undefined) {
        window.api.setSearchEnabled(data.searchEnabled)
        setIsSearchEnabled(data.searchEnabled)
      }

      setTimeout(() => {
        handleSend(data.instructions, data.searchEnabled)
        setTimeout(() => {
          inputBarRef.current?.focus()
        }, 100)
      }, 50)
    })

    return () => {
      removeLauncherListener()
      removeModelListener()
      removeConfigListener()
      removeSearchEnabledListener()
      removeOpenMainAppListener()
    }
  }, [handleSend, handleModelChange, handleNewChat])

  const handleSaveApiKey = async (_key: string): Promise<void> => {
    if (config) {
      const freshConfig = await window.api.getConfig()
      if (freshConfig) {
        setConfig(freshConfig)
      }
    }
  }

  // Track whether AI is actively streaming
  useEffect(() => {
    const lastMsg = messages[messages.length - 1]
    isStreamingRef.current = !!lastMsg?.isStreaming
  }, [messages])

  // Keep scroll at the bottom when content dimensions change (e.g. streaming, loading)
  useEffect(() => {
    const container = scrollContainerRef.current
    const content = contentRef.current
    if (!container || !content) return

    let rafId: number | null = null

    const scrollLoop = (): void => {
      if (!isAtBottomRef.current) {
        rafId = null
        return
      }
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      rafId = requestAnimationFrame(scrollLoop)
    }

    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current && rafId === null) {
        rafId = requestAnimationFrame(scrollLoop)
      }
    })

    observer.observe(content)
    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  // Explicitly scroll to bottom on new user message (smooth)
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    const isUserMsg = lastMessage?.role === 'user'

    if (isUserMsg) {
      isAtBottomRef.current = true
      scrollToBottom('smooth')
    }
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (activeView === 'chat' && isAtBottomRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom('auto')
      })
    }
  }, [activeView, scrollToBottom])

  useEffect(() => {
    // Set up IPC listeners from our Context Bridge
    const removeChatStartListener = window.api.onChatStart((data) => {
      const { chatId } = data
      console.log(
        `[UI Chat] onChatStart: chatId=${chatId}, currentChatId=${currentChatIdRef.current}`
      )
      setRunningChats((prev) => ({ ...prev, [chatId]: true }))
      if (chatId === currentChatIdRef.current) {
        setIsProcessing(true)
        // Add an empty AI message to start streaming into
        setMessages((prev) => [
          ...prev,
          {
            role: 'ai',
            content: '',
            thoughts: '',
            isStreaming: true,
            isThinking: false,
            isConnecting: true,
            toolCalls: []
          }
        ])
      }
    })

    const removeChatChunkListener = window.api.onChatChunk((data) => {
      const {
        chatId,
        thoughts,
        finalResponse,
        isThinking,
        isWritingToolCall,
        toolType,
        streamingToolCalls
      } = data
      console.log(
        `[UI Chat] onChatChunk received: chatId=${chatId}, currentChatId=${currentChatIdRef.current}, responseLength=${finalResponse.length}`
      )
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.length - 1
          const lastMsg = newMessages[lastMsgIndex]
          console.log(
            `[UI Chat] onChatChunk state update: lastMsg index=${lastMsgIndex}, lastMsg role=${lastMsg?.role}, isStreaming=${lastMsg?.isStreaming}`
          )
          if (lastMsg && lastMsg.role === 'ai') {
            let updatedToolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []

            if (updatedToolCalls.some((t) => t.status === 'running' && t.result !== undefined)) {
              updatedToolCalls = updatedToolCalls.map((tc) => {
                if (tc.status === 'running' && tc.result !== undefined) {
                  return {
                    ...tc,
                    status: tc.result.startsWith('Error') ? 'error' : 'done'
                  }
                }
                return tc
              })
            }

            newMessages[lastMsgIndex] = {
              ...lastMsg,
              thoughts,
              content: finalResponse,
              isThinking,
              isWritingToolCall,
              toolType,
              streamingToolCalls,
              isConnecting: false,
              toolCalls: updatedToolCalls
            }
          } else {
            console.warn(
              `[UI Chat] onChatChunk did NOT update message state because: lastMsg=${!!lastMsg}, lastMsg.role=${lastMsg?.role}`
            )
          }
          return newMessages
        })
      }
    })

    const removeChatEndListener = window.api.onChatEnd((data) => {
      const { chatId, thoughts, finalResponse } = data
      console.log(
        `[UI Chat] onChatEnd received: chatId=${chatId}, currentChatId=${currentChatIdRef.current}`
      )
      setRunningChats((prev) => ({ ...prev, [chatId]: false }))
      if (chatId === currentChatIdRef.current) {
        setIsProcessing(false)
        setIsYoutubeMode(false)

        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.length - 1
          const lastMsg = newMessages[lastMsgIndex]
          console.log(
            `[UI Chat] onChatEnd state update: lastMsg index=${lastMsgIndex}, lastMsg role=${lastMsg?.role}`
          )
          if (lastMsg && lastMsg.role === 'ai') {
            // Promote completed streaming tool calls to regular toolCalls with 'running'
            // status to bridge the gap before chat-tool-start arrives
            let promotedToolCalls = lastMsg.toolCalls || []
            if (lastMsg.streamingToolCalls && lastMsg.streamingToolCalls.length > 0) {
              const completedStreaming = lastMsg.streamingToolCalls.filter(stc => stc.isComplete && stc.name)
              for (const stc of completedStreaming) {
                const alreadyExists = promotedToolCalls.some(
                  tc => tc.name === stc.name && (tc.status === 'running' || tc.status === 'done')
                )
                if (!alreadyExists) {
                  let parsedArgs: Record<string, unknown> = {}
                  try { parsedArgs = JSON.parse(stc.arguments) } catch { /* ignore */ }
                  promotedToolCalls = [...promotedToolCalls, {
                    name: stc.name,
                    args: parsedArgs,
                    status: 'running' as const
                  }]
                }
              }
            }

            promotedToolCalls = promotedToolCalls.map((tc) => {
              if (tc.status === 'running') {
                return {
                  ...tc,
                  status: tc.result && tc.result.startsWith('Error') ? 'error' : 'done'
                }
              }
              return tc
            })
            newMessages[lastMsgIndex] = {
              ...lastMsg,
              thoughts,
              content: finalResponse,
              isStreaming: false,
              isThinking: false,
              isWritingToolCall: false,
              isConnecting: false,
              toolCalls: promotedToolCalls,
              streamingToolCalls: undefined
            }
          }
          return newMessages
        })

        // Double-rAF to ensure scroll after React commit
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const container = scrollContainerRef.current
            if (container && isAtBottomRef.current) {
              isProgrammaticScrollRef.current = true
              container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
            }
          })
        })
      }
    })

    const removeChatErrorListener = window.api.onChatError((data) => {
      const { error, chatId } = data
      setRunningChats((prev) => ({ ...prev, [chatId]: false }))
      if (chatId === currentChatIdRef.current) {
        setIsProcessing(false)
        setIsYoutubeMode(false)

        const isCancel = error.includes('cancelled')

        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.length - 1
          const lastMsg = newMessages[lastMsgIndex]

          if (lastMsg && lastMsg.role === 'ai') {
            let updatedToolCalls = lastMsg.toolCalls
            if (isCancel && lastMsg.toolCalls) {
              updatedToolCalls = lastMsg.toolCalls.map((tc) =>
                tc.status === 'running'
                  ? { ...tc, status: 'cancelled', result: 'Cancelled by user.' }
                  : tc
              )
            }
            newMessages[lastMsgIndex] = {
              ...lastMsg,
              isStreaming: false,
              isThinking: false,
              isConnecting: false,
              toolCalls: updatedToolCalls
            }
          }

          if (isCancel) {
            newMessages.push({
              role: 'separator',
              separatorType: 'cancel',
              content: 'Cancelled by user'
            })
          } else if (error === 'TIMEOUT_ERROR_FIRST') {
            newMessages.push({
              role: 'separator',
              separatorType: 'error',
              content: 'Request timed out: No response from the IA within 15 seconds.'
            })
          } else if (error === 'TIMEOUT_ERROR_CHUNK') {
            newMessages.push({
              role: 'separator',
              separatorType: 'error',
              content: 'Request timed out: IA stopped responding for over 30 seconds.'
            })
          } else {
            const apiErrorMatch = error.match(/^API_KEY_ERROR:(\d{3}):(.+)$/)
            let separatorContent: string

            if (apiErrorMatch) {
              separatorContent = `API key error: ${apiErrorMatch[1]} ${apiErrorMatch[2]}`
            } else {
              const httpMatch = error.match(/(\d{3})\s+(.*)/)
              if (httpMatch) {
                separatorContent = `API key error: ${httpMatch[1]} ${httpMatch[2].trim()}`
              } else {
                separatorContent = `API key error: 500 Internal Server Error`
              }
            }

            newMessages.push({
              role: 'separator',
              separatorType: 'error',
              content: separatorContent
            })
          }

          return newMessages
        })
      }
    })

    const removeToolCallDeltaListener = window.api.onToolCallDelta((data) => {
      const { chatId, index, name, argsDelta } = data
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.findLastIndex((msg) => msg.role === 'ai')
          if (lastMsgIndex !== -1) {
            const lastMsg = { ...newMessages[lastMsgIndex] }
            const streamingToolCalls = lastMsg.streamingToolCalls ? [...lastMsg.streamingToolCalls] : []
            const existingIdx = streamingToolCalls.findIndex((stc) => stc.index === index)
            if (existingIdx !== -1) {
              streamingToolCalls[existingIdx] = {
                ...streamingToolCalls[existingIdx],
                name: name || streamingToolCalls[existingIdx].name,
                arguments: streamingToolCalls[existingIdx].arguments + (argsDelta || '')
              }
            } else {
              streamingToolCalls.push({
                index,
                name: name || 'task',
                arguments: argsDelta || '',
                isComplete: false
              })
            }
            // Transition any finished running tool calls to done/error when next tool delta arrives
            let toolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []
            if (toolCalls.some((t) => t.status === 'running' && t.result !== undefined)) {
              toolCalls = toolCalls.map((tc) => {
                if (tc.status === 'running' && tc.result !== undefined) {
                  return {
                    ...tc,
                    status: tc.result.startsWith('Error') ? 'error' : 'done'
                  }
                }
                return tc
              })
            }
            newMessages[lastMsgIndex] = {
              ...lastMsg,
              isConnecting: false,
              isWritingToolCall: true,
              toolCalls,
              streamingToolCalls
            }
            return newMessages
          }
          return prev
        })
      }
    })

    const removeToolStartListener = window.api.onToolStart((data) => {
      const { chatId } = data
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.findLastIndex((msg) => msg.role === 'ai')

          if (lastMsgIndex !== -1) {
            const lastMsg = { ...newMessages[lastMsgIndex] }
            let toolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []

            // Transition any previous running tool calls that finished execution to done/error
            toolCalls = toolCalls.map((t) => {
              if (t.status === 'running' && t.result !== undefined) {
                return {
                  ...t,
                  status: t.result.startsWith('Error') ? 'error' : 'done'
                }
              }
              return t
            })

            const promotedIndex = toolCalls.findLastIndex(
              (t) => t.name === data.name && (t.status === 'running' || t.status === 'done')
            )

            if (promotedIndex !== -1) {
              toolCalls[promotedIndex] = {
                ...toolCalls[promotedIndex],
                args: data.args,
                status: 'running'
              }
              lastMsg.toolCalls = toolCalls
              newMessages[lastMsgIndex] = lastMsg
            } else {
              const isDuplicate = toolCalls.some(
                (t) =>
                  t.name === data.name &&
                  JSON.stringify(t.args) === JSON.stringify(data.args) &&
                  t.status === 'running'
              )

              if (!isDuplicate) {
                lastMsg.toolCalls = [...toolCalls, { ...data, status: 'running' }]
                newMessages[lastMsgIndex] = lastMsg
              }
            }
          }
          return newMessages
        })
      }
    })

    const removeToolEndListener = window.api.onToolEnd((data) => {
      const { chatId } = data
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.findLastIndex((msg) => msg.role === 'ai')

          if (lastMsgIndex !== -1 && newMessages[lastMsgIndex].toolCalls) {
            const lastMsg = { ...newMessages[lastMsgIndex] }
            const toolCalls = [...(lastMsg.toolCalls || [])]
            const lastToolIndex = toolCalls.findLastIndex(
              (t) => t.name === data.name && t.status === 'running'
            )

            if (lastToolIndex !== -1) {
              // Save execution result but keep status: 'running' so shimmer stays active
              // until the next AI streaming chunk or tool call arrives.
              toolCalls[lastToolIndex] = {
                ...toolCalls[lastToolIndex],
                result: data.result
              }
              lastMsg.toolCalls = toolCalls
              newMessages[lastMsgIndex] = lastMsg
            }
          }
          return newMessages
        })
      }
    })

    const removeToolUpdateListener = window.api.onToolUpdate((data) => {
      const { chatId } = data
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          // Search all AI messages since updates might belong to historical tool calls
          for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i]
            if (msg.role === 'ai' && msg.toolCalls) {
              const toolCallIndex = msg.toolCalls.findLastIndex(
                (t) =>
                  t.name === data.toolCallName &&
                  (t.status === 'running' || t.status === 'writing' || t.status === 'done')
              )
              if (toolCallIndex !== -1) {
                const lastMsg = { ...msg }
                const toolCalls = [...(lastMsg.toolCalls || [])]
                const toolCall = { ...toolCalls[toolCallIndex] }
                if (data.toolCallName === 'web_search' && data.update.searchTitle) {
                  toolCall.searchUpdates = [
                    ...(toolCall.searchUpdates || []),
                    data.update.searchTitle
                  ]
                }
                toolCalls[toolCallIndex] = toolCall
                lastMsg.toolCalls = toolCalls
                newMessages[i] = lastMsg
                return newMessages // Found and updated
              }
            }
          }
          return newMessages
        })
      }
    })

    const removeTitleReceivedListener = window.api.onChatTitleReceived(({ id, title }) => {
      if (id === currentChatIdRef.current) {
        if (
          !title ||
          title.trim() === '' ||
          title === 'New Conversation' ||
          title === 'Nova Conversa'
        ) {
          setCurrentChatTitle(null)
          setIsTitleStreaming(false)
          if (titleIntervalRef.current) {
            clearInterval(titleIntervalRef.current)
            titleIntervalRef.current = null
          }
          return
        }

        if (titleIntervalRef.current) {
          clearInterval(titleIntervalRef.current)
        }

        let currentIndex = 0
        const fullTitle = title
        setIsTitleStreaming(true)

        titleIntervalRef.current = setInterval(() => {
          setCurrentChatTitle(fullTitle.substring(0, currentIndex + 1))
          currentIndex++
          if (currentIndex >= fullTitle.length) {
            if (titleIntervalRef.current) {
              clearInterval(titleIntervalRef.current)
              titleIntervalRef.current = null
            }
            setIsTitleStreaming(false)
          }
        }, 50)
      }
    })

    const removeTodoUpdateListener = window.api.onTodoUpdate((data) => {
      if (data.chatId) {
        setChatTodos((prev) => ({
          ...prev,
          [data.chatId!]: data
        }))
      }
      setIsTodoPanelOpen(true)
    })

    const removeTodoCompleteListener = window.api.onTodoComplete(({ chatId }) => {
      if (chatId) {
        setIsTodoPanelOpen(false)
        setTimeout(() => {
          setChatTodos((prev) => {
            const next = { ...prev }
            delete next[chatId]
            return next
          })
        }, 400)
      }
    })

    return () => {
      removeChatStartListener()
      removeChatChunkListener()
      removeChatEndListener()
      removeChatErrorListener()
      removeToolCallDeltaListener()
      removeToolStartListener()
      removeToolEndListener()
      removeToolUpdateListener()
      removeTitleReceivedListener()
      removeTodoUpdateListener()
      removeTodoCompleteListener()
      if (titleIntervalRef.current) {
        clearInterval(titleIntervalRef.current)
        titleIntervalRef.current = null
      }
    }
  }, [])

  const renderedMessages = useMemo(() => {
    if (messages.length === 0) return null
    return (
      <div className="w-full flex flex-col max-w-[800px] mx-auto px-4">
        {messages.map((msg, i) => {
          if (msg.role === 'separator') {
            return (
              <div
                key={i}
                className="w-full flex items-center gap-4 py-3 select-none animate-message"
              >
                <div className="flex-grow border-t border-dashed border-white/[0.08]" />
                <span className="shrink-0 px-4 text-[10px] font-mono tracking-widest text-text-secondary/60 uppercase">
                  {msg.content}
                </span>
                <div className="flex-grow border-t border-dashed border-white/[0.08]" />
              </div>
            )
          }

          if (msg.role === 'user') {
            return (
              <div key={i} className="w-full flex flex-col items-end px-4 py-2.5 transition-all duration-700 animate-message">
                <div className="rounded-[18px] bg-white/[0.026] border border-white/[0.065] px-4.5 py-3 text-[14.5px] leading-relaxed text-text-primary max-w-[75%] shadow-md select-text">
                  {msg.file && !msg.file.mimeType.startsWith('image/') && (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05] mb-2 select-none">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] text-text-secondary">
                        {msg.file.mimeType === 'application/pdf' ? (
                          <FilePdf size={18} className="text-status-error" />
                        ) : (
                          <FilePpt size={18} className="text-accent-primary" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11.5px] font-semibold text-text-primary truncate max-w-[150px]">{msg.file.name}</span>
                      </div>
                    </div>
                  )}
                  {(msg.screenshot || (msg.file && msg.file.mimeType.startsWith('image/'))) && (
                    <div className="relative rounded-xl overflow-hidden border border-white/[0.07] mb-2 max-w-[240px]">
                      <img
                        src={
                          msg.file && msg.file.mimeType.startsWith('image/')
                            ? `data:${msg.file.mimeType};base64,${msg.file.data}`
                            : `data:image/png;base64,${msg.screenshot}`
                        }
                        alt="Upload"
                        className="w-full h-auto cursor-zoom-in block"
                      />
                    </div>
                  )}
                  <div className="whitespace-pre-wrap select-text">{msg.content.trim()}</div>
                </div>
              </div>
            )
          }

          const hasContent = msg.content && msg.content.trim() !== ''

          const passiveTools = ['computer_use_read_file', 'computer_use_list_installed_applications', 'list_installed_applications', 'search_installed_applications']
          const filteredThoughts = (msg.thoughts || '').replace(
            /\[PRISM_EXECUTE_TOOL\][\s\S]*?\[\/PRISM_EXECUTE_TOOL\]/g,
            (match) => {
              try {
                const json = match.replace('[PRISM_EXECUTE_TOOL]', '').replace('[/PRISM_EXECUTE_TOOL]', '')
                const parsed = JSON.parse(json)
                if (passiveTools.includes(parsed.type)) return ''
              } catch {}
              return match
            }
          ).trim()

          const hasThoughtBlock = !!(filteredThoughts || msg.isThinking)

          return (
            <div key={i} className="w-full flex flex-col items-start px-4 py-5 transition-all duration-700 animate-message">
              {/* Thinking / Thoughts if any */}
              {hasThoughtBlock && (
                <div className="w-full mb-3 select-none">
                  <details className="group w-full select-none">
                    <summary className="inline-flex items-center gap-2 text-[12.5px] py-1 select-none transition-all duration-200 cursor-pointer text-text-secondary/60 hover:text-text-secondary/90 list-none [&::-webkit-details-marker]:hidden">
                      <Brain
                        size={13}
                        className={clsx(
                          'text-text-secondary/50 transition-all duration-300',
                          msg.isThinking && 'animate-pulse text-accent-secondary/70'
                        )}
                      />
                      <span className="font-medium leading-normal">
                        {(() => {
                          const toolsList = msg.toolCalls || []
                          const streamingTools = (msg.streamingToolCalls || []).map(stc => ({
                            name: stc.name,
                            status: 'writing' as const
                          }))
                          const allTools = [...toolsList, ...streamingTools] as { name: string; status: 'writing' | 'running' | 'done' | 'error' | 'cancelled' | 'cooldown' }[]
                          const activeTools = allTools.filter(t => t.status !== 'done' && t.status !== 'error' && t.status !== 'cancelled')
                          if (activeTools.length > 0 && !hasContent) {
                            const lastTool = activeTools[activeTools.length - 1]
                            return <ToolCallIndicator tools={[lastTool]} />
                          }
                          const outlineMatches = Array.from(
                            filteredThoughts.matchAll(/\*\*(.*?)\*\*/g)
                          )
                          if (outlineMatches.length > 0) {
                            return outlineMatches[outlineMatches.length - 1][1]
                          }
                          return msg.isThinking ? 'Thinking...' : 'Thinking'
                        })()}
                      </span>
                      <CaretDown
                        size={11}
                        className="text-text-muted/50 transition-transform duration-200 group-open:rotate-180"
                      />
                    </summary>
                    <div className="mt-1.5 border-l border-white/[0.06] ml-1.5 pl-4 py-0.5 font-mono text-[11px] leading-relaxed select-text text-text-secondary/50">
                      <ReactMarkdown
                        remarkPlugins={[
                          remarkGfm,
                          remarkMath,
                          disableIndentedCode as unknown as import('unified').Pluggable
                        ]}
                        rehypePlugins={[rehypeRaw, rehypeParseMath, rehypeKatex]}
                      >
                        {filteredThoughts}
                      </ReactMarkdown>
                    </div>
                  </details>
                </div>
              )}

              {/* IA Response Body */}
              <div className="w-full text-text-primary">
                {!hasContent && (msg.isConnecting || (!hasThoughtBlock && msg.isWritingToolCall)) ? (
                  <div className="flex items-center gap-1.5 h-6 select-none">
                    <div className="h-2.5 w-2.5 rounded-full bg-accent-primary animate-breathe" />
                    {msg.isWritingToolCall && msg.streamingToolCalls && msg.streamingToolCalls.length > 0 && (
                      <ToolCallIndicator
                        tools={msg.streamingToolCalls.map(stc => ({
                          name: stc.name,
                          status: 'writing'
                        }))}
                      />
                    )}
                  </div>
                ) : (
                  <AiMessage
                    msg={msg}
                    currentChatId={currentChatId}
                    handleLoadChat={handleLoadChat}
                    markdownComponents={markdownComponents}
                  />
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} className="h-4" />
      </div>
    )
  }, [
    messages,
    currentChatId,
    handleLoadChat,
    markdownComponents,
    modelSelectorRef,
    setIsApiKeyModalOpen,
    selectedModel
  ])

  const visibleDownloads = useMemo(
    () =>
      Object.values(downloads)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-4),
    [downloads]
  )

  const renderedSidebar = useMemo(() => {
    return (
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        activeView={activeView}
        onViewChange={(view) => {
          setActiveView(view)
        }}
        onLoadChat={(id) => {
          handleLoadChat(id)
        }}
        onNewChat={(force) => {
          handleNewChat(force)
        }}
        currentChatId={currentChatId}
        runningChats={runningChats}
        config={config}
        onOpenSearch={() => {
          setIsSearchModalOpen(true)
        }}
      />
    )
  }, [
    activeView,
    isSidebarOpen,
    handleLoadChat,
    handleNewChat,
    currentChatId,
    runningChats,
    config
  ])

  const [hasActiveProviders, setHasActiveProviders] = useState<boolean>(true)

  useEffect(() => {
    const checkProviders = async () => {
      try {
        const providers = await window.api.getProviders()
        const active = (providers || []).some((p) => p.apiKey && p.models.some((m) => m.enabled))
        setHasActiveProviders(active)
      } catch {
        setHasActiveProviders(false)
      }
    }
    checkProviders()
  }, [config])

  const isKeyMissing = !hasActiveProviders

  if (window.location.hash === '#mini-app') {
    return (
      <div className="h-screen w-screen bg-[#0b0c0f] flex flex-col overflow-hidden">
        <TitleBar
          onClose={() => miniAppData && window.api.closeMiniAppWindow(miniAppData.id)}
          onMinimize={() => miniAppData && window.api.minimizeMiniAppWindow(miniAppData.id)}
        />
        <div className="flex-1 relative">
          {miniAppData ? (
            <div className="h-full w-full p-0">
              <MiniAppRenderer
                id={miniAppData.id}
                title={miniAppData.title}
                html={miniAppData.html}
                css={miniAppData.css}
                js={miniAppData.js}
              />
            </div>
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-4 text-text-secondary font-mono">
              <Spinner size="lg" />
              <span>Loading Mini App...</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (route === '#launcher') {
    return <QuickLauncher />
  }

  if (route === '#updater') {
    return <UpdaterView />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-main font-sans selection:bg-accent-primary/30 pt-10">
      {!bootComplete && (
        <LoadingScreen
          onComplete={(connectionFailed?: boolean) => {
            setBootComplete(true)
            if (connectionFailed) {
              setIsOnline(false)
            }
          }}
          isKeyMissing={isKeyMissing}
          apiKey={''}
          onApiKeySave={handleSaveApiKey}
          configLoaded={config !== null}
        />
      )}
      <TitleBar title={currentChatTitle || undefined} isStreaming={isTitleStreaming} />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
        initialValue={''}
      />
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onOpenChat={handleLoadChat}
      />
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto p-2.5 sm:p-6 md:p-8 flex flex-col animate-soft-pop">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-xl"
            onClick={() => setIsSettingsModalOpen(false)}
          />
          <div className="m-auto relative w-full max-w-5xl h-[92vh] sm:h-[85vh] overflow-hidden rounded-[24px] sm:rounded-[30px] border border-white/[0.12] bg-surface shadow-2xl flex flex-col z-10">
            <SettingsView onClose={() => setIsSettingsModalOpen(false)} />
          </div>
        </div>
      )}
      <PrismBackground />

      {/* Floating Toggle Button */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-20 flex h-16 w-6 items-center justify-center rounded-r-xl border border-l-0 border-white/[0.05] bg-white/[0.02] text-text-secondary shadow-lg backdrop-blur-md transition-all duration-300 hover:w-8 hover:bg-white/[0.05] hover:text-text-primary"
          title="Open Sidebar"
        >
          <div className="h-8 w-1 rounded-full bg-white/[0.1]" />
        </button>
      )}

      {/* Sidebar */}
      {renderedSidebar}

      <main className="flex-1 flex flex-col relative z-10 min-w-0 h-full transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)]">
        {!isOnline && <OfflineBanner />}
        {activeView === 'chat' && !isFullscreenInput && (
          <>
            <div className="absolute left-14 top-4 z-30 animate-fade-in">
              <ModelSelector
                ref={modelSelectorRef}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                disabled={isProcessing}
              />
            </div>
          </>
        )}
        {activeView === 'chat' && isFullscreenInput ? (
          <div className="flex-1 flex flex-col h-full bg-background-main">
            <InputBar
              ref={inputBarRef}
              onSend={handleSend}
              onCancel={handleCancel}
              isProcessing={isProcessing}
              isKeyMissing={isKeyMissing}
              disabled={isProcessing || isKeyMissing || !isOnline}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              reasoningLevel={config?.modelReasoningLevels?.[selectedModel] || 'off'}
              onReasoningLevelChange={(level) => handleReasoningLevelChange(selectedModel, level)}
              text={inputText}
              setText={setInputText}
              isSearchEnabled={isSearchEnabled}
              setIsSearchEnabled={handleSearchEnabledToggle}
              isFullscreen={true}
              onFullscreenToggle={() => setIsFullscreenInput(false)}
              attachedFile={attachedFile}
              onRemoveFile={() => setAttachedFile(null)}
              onAttachFile={(file) => setAttachedFile(file)}
              onOpenScreenshotModal={() => setIsScreenshotModalOpen(true)}
              onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
              activeWorkflow={activeWorkflow}
              setActiveWorkflow={setActiveWorkflow}
              sessionMode={sessionMode}
              disciplinePath={disciplinePath}
            />
          </div>
        ) : (
          <>
            {/* Chat View */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className={clsx(
                'flex-1 overflow-y-auto flex flex-col relative z-10',
                activeView !== 'chat' && 'hidden'
              )}
            >
              <div
                ref={contentRef}
                className={clsx(
                  'flex-grow flex flex-col pt-6',
                  messages.length > 0 ? 'pb-40' : 'pb-0'
                )}
              >
                {isKeyMissing && <MissingKeyBanner onAddKey={() => setIsApiKeyModalOpen(true)} />}
                <div className="flex-1 flex flex-col relative min-h-[450px]">
                  {/* Empty state container (always in DOM, fades out when messages appear) */}
                  <div
                    className={clsx(
                      'absolute inset-0 flex flex-col items-center justify-center px-4 pb-[8vh] select-none transition-all duration-[800ms] ease-[cubic-bezier(0.25,1,0.5,1)] z-10',
                      messages.length === 0
                        ? 'opacity-100 scale-100 pointer-events-auto'
                        : 'opacity-0 scale-[0.97] pointer-events-none blur-[6px]'
                    )}
                  >
                    {/* Background effects matching current theme */}
                    <LandingBackgroundEffects theme={config?.theme || 'marine'} />

                    <div className="relative z-10 flex flex-col items-center w-full max-w-[820px] text-center gap-6">
                      <h1 className="text-[26px] sm:text-[32px] font-light text-text-primary/90 select-none leading-tight">
                        {getGreeting()}
                      </h1>

                      <div className="w-full relative z-20">
                        {/* White glow behind input box for Terno theme */}
                        {(config?.theme || 'marine') === 'terno' && (
                          <div className="absolute inset-0 pointer-events-none flex items-center justify-center -z-10 animate-slow-pulse">
                            <div className="w-[520px] h-[150px] rounded-full bg-white opacity-[0.4] blur-[75px]" />
                          </div>
                        )}
                        {messages.length === 0 && (
                          <InputBar
                            ref={inputBarRef}
                            onSend={handleSend}
                            onCancel={handleCancel}
                            isProcessing={isProcessing}
                            isKeyMissing={isKeyMissing}
                            disabled={isProcessing || isKeyMissing || !isOnline}
                            selectedModel={selectedModel}
                            onModelChange={handleModelChange}
                            reasoningLevel={config?.modelReasoningLevels?.[selectedModel] || 'off'}
                            onReasoningLevelChange={(level) => handleReasoningLevelChange(selectedModel, level)}
                            text={inputText}
                            setText={setInputText}
                            isSearchEnabled={isSearchEnabled}
                            setIsSearchEnabled={handleSearchEnabledToggle}
                            isFullscreen={false}
                            onFullscreenToggle={() => setIsFullscreenInput(true)}
                            attachedFile={attachedFile}
                            onRemoveFile={() => setAttachedFile(null)}
                            onAttachFile={(file) => setAttachedFile(file)}
                            onOpenScreenshotModal={() => setIsScreenshotModalOpen(true)}
                            onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
                            activeWorkflow={activeWorkflow}
                            setActiveWorkflow={setActiveWorkflow}
                            sessionMode={sessionMode}
                            disciplinePath={disciplinePath}
                            onModeChange={handleModeChangeClick}
                            onSelectFolder={handleSelectFolderClick}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Chat messages container (fades in when messages are present) */}
                  <div
                    className={clsx(
                      'flex-grow flex flex-col transition-all duration-500 ease-out',
                      messages.length > 0
                        ? 'opacity-100 pointer-events-auto'
                        : 'opacity-0 pointer-events-none'
                    )}
                  >
                    {messages.length > 0 && renderedMessages}
                  </div>
                </div>
              </div>
            </div>

            {/* View Coming Soon (Fallback) */}
            {activeView !== 'chat' && (
              <div className="flex-1 flex items-center justify-center text-text-secondary">
                View coming soon...
              </div>
            )}

            {activeView === 'chat' && messages.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 pb-6 pt-14 z-20 pointer-events-none bg-gradient-to-t from-background-main via-background-main/95 to-transparent">
                {/* Scroll to bottom button */}
                {showScrollButton && (
                  <div className="absolute left-0 right-0 -top-12 flex justify-center pointer-events-none z-20 animate-soft-pop">
                    <button
                      onClick={() => {
                        isAtBottomRef.current = true
                        scrollToBottom('smooth')
                        setShowScrollButton(false)
                      }}
                      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-background-secondary/90 text-text-secondary shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/[0.08] hover:text-text-primary active:scale-95"
                      title="Scroll to bottom"
                    >
                      <CaretDown size={16} />
                    </button>
                  </div>
                )}

                <InputBar
                  ref={inputBarRef}
                  onSend={handleSend}
                  onCancel={handleCancel}
                  isProcessing={isProcessing}
                  isKeyMissing={isKeyMissing}
                  disabled={isProcessing || isKeyMissing || !isOnline}
                  selectedModel={selectedModel}
                  onModelChange={handleModelChange}
                  reasoningLevel={config?.modelReasoningLevels?.[selectedModel] || 'off'}
                  onReasoningLevelChange={(level) => handleReasoningLevelChange(selectedModel, level)}
                  text={inputText}
                  setText={setInputText}
                  isSearchEnabled={isSearchEnabled}
                  setIsSearchEnabled={handleSearchEnabledToggle}
                  isFullscreen={false}
                  onFullscreenToggle={() => setIsFullscreenInput(true)}
                  attachedFile={attachedFile}
                  onRemoveFile={() => setAttachedFile(null)}
                  onAttachFile={(file) => setAttachedFile(file)}
                  onOpenScreenshotModal={() => setIsScreenshotModalOpen(true)}
                  onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
                  activeWorkflow={activeWorkflow}
                  setActiveWorkflow={setActiveWorkflow}
                  sessionMode={sessionMode}
                  disciplinePath={disciplinePath}
                />
              </div>
            )}
          </>
        )}
        <DownloadProgressOverlay
          downloads={visibleDownloads}
          className="absolute right-5 top-4 z-30 w-[min(360px,calc(100vw-2rem))]"
        />
      </main>
      <ErrorPopup />
      <ScreenshotModal
        isOpen={isScreenshotModalOpen}
        onClose={() => setIsScreenshotModalOpen(false)}
        onCapture={(base64) => {
          setAttachedFile({
            name: `Screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
            mimeType: 'image/png',
            data: base64
          })
        }}
      />
      <YoutubeAppModal
        isOpen={isYoutubeModalOpen}
        onClose={() => setIsYoutubeModalOpen(false)}
        onRun={(data) => {
          let msg = `Search YouTube for: **${data.query}**\n- Type: ${data.type}\n- Sort By: ${data.sortBy}\n- Duration: ${data.duration}`
          if (data.customInstructions) {
            msg += `\n- Instructions: ${data.customInstructions}`
          }
          handleSend(msg, undefined, undefined, undefined, true)
        }}
      />
      {floatingMenu && (
        <div
          className="fixed z-50 flex items-center justify-center bg-background-secondary/95 border border-white/10 px-3 py-1.5 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md cursor-pointer select-none pointer-events-auto"
          style={{
            left: `${floatingMenu.x}px`,
            top: `${floatingMenu.y}px`,
            transform: 'translate(-50%, -100%) translateY(-8px)'
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={() => handleAnswerPrism(floatingMenu.text)}
        >
          <Quotes size={14} className="text-accent-secondary mr-1.5" />
          <span className="text-xs font-semibold text-text-primary hover:text-accent-secondary transition-colors duration-150">
            Answer Prism
          </span>
        </div>
      )}
      <TodoPanel
        todo={currentChatId ? chatTodos[currentChatId] || null : null}
        isOpen={isTodoPanelOpen}
        onToggle={() => setIsTodoPanelOpen((p) => !p)}
        onClose={() => setIsTodoPanelOpen(false)}
      />
    </div>
  )
}

function App(): React.JSX.Element {
  if (IS_DEMO) {
    return <DemoApp />
  }

  return <RealApp />
}

export default App
