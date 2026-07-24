import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismBackground } from './components/PrismBackground'
import { LoadingScreen } from './components/LoadingScreen'
import { OfflineBanner } from './components/OfflineBanner'
import { Sidebar } from './components/Sidebar'
import { ToolCallIndicator } from './components/ActionLoader'
import { QuickLauncher } from './components/QuickLauncher'
import { TitleBar } from './components/TitleBar'
import { SettingsView } from './components/SettingsView'
import { ApiKeyModal } from './components/ApiKeyModal'
import { SearchModal } from './components/SearchModal'
import { MiniAppRenderer } from './components/MiniAppRenderer'
import { Spinner } from './components/Spinner'
import { ErrorPopup } from './components/ErrorPopup'
import { DownloadProgressOverlay } from './components/DownloadProgressOverlay'
import { QuestionnaireRenderer } from './components/QuestionnaireRenderer'
import { MalformedToolCallWarning } from './components/MalformedToolCallWarning'
import { RenderChatHistory } from './components/RenderChatHistory'
import { TtsButton } from './components/TtsButton'
import { CopyMessageButton } from './components/CopyMessageButton'
import { DemoApp } from './components/demo/DemoApp'
import { UpdaterView } from './components/UpdaterView'
import { isShortcutPressed } from './utils'
import { TabBar } from './components/TabBar'
import { ChatPane } from './components/ChatPane'
import type { TabSession, Message, AttachedFile, StreamingToolCall, ToolCallItem } from './types/tab'
import {
  StreamContext,
  StaticMarkdownComponents,
  createStreamingFadeRehypePlugin,
  useStreamStats,
  CodeBlock
} from './components/AnimatedStreamingText'
import clsx from 'clsx'
import { CaretDown, Quotes, Brain, FilePdf, FilePpt } from '@phosphor-icons/react'
import { ScreenshotModal } from './components/ScreenshotModal'
import { YoutubeAppModal } from './components/YoutubeAppModal'
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

function consolidateToolCalls(
  toolCalls?: ToolCallItem[],
  streamingToolCalls?: StreamingToolCall[]
): ToolCallItem[] {
  const allCalls: ToolCallItem[] = []

  if (toolCalls) {
    allCalls.push(...toolCalls)
  }

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

        const countStreamingLines = (raw: string): number => {
          if (!raw) return 0
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

  return allCalls
}

interface AiMessageProps {
  msg: Message
  currentChatId?: string
  handleLoadChat?: (id: string) => void
  markdownComponents: Components
}

const AiMessage = React.memo(function AiMessage({
  msg,
  currentChatId,
  handleLoadChat,
  markdownComponents
}: AiMessageProps) {
  const streamStats = useStreamStats(msg.content, !!msg.isStreaming)
  const nativeToolCalls = useMemo(
    () => consolidateToolCalls(msg.toolCalls, msg.streamingToolCalls),
    [msg.toolCalls, msg.streamingToolCalls]
  )

  const hasThoughtBlock = useMemo(() => {
    const passiveTools = [
      'computer_use_read_file',
      'computer_use_list_installed_applications',
      'list_installed_applications',
      'search_installed_applications'
    ]
    const filteredThoughts = (msg.thoughts || '')
      .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?\[\/PRISM_EXECUTE_TOOL\]/g, (match) => {
        try {
          const json = match.replace('[PRISM_EXECUTE_TOOL]', '').replace('[/PRISM_EXECUTE_TOOL]', '')
          const parsed = JSON.parse(json)
          if (passiveTools.includes(parsed.type)) return ''
        } catch {}
        return match
      })
      .trim()
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

  const shouldHideIndicator = useCallback(
    (status: ToolCallItem['status']) => {
      const isActive = status === 'writing' || status === 'running'
      if (hasTextOutput) {
        return !isActive
      }
      return hasThoughtBlock
    },
    [hasTextOutput, hasThoughtBlock]
  )

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

  const shouldShowInlineTool = useCallback(
    (status: ToolCallItem['status'], partIndex: number) => {
      const isActive = status === 'writing' || status === 'running'
      if (isActive) {
        const hasTextBefore = parts.slice(0, partIndex).some((p) => {
          const isTool = p.startsWith('[PRISM_EXECUTE_TOOL]')
          const isMiniApp = p.startsWith('<mini_app>')
          return !isTool && !isMiniApp && p.trim() !== ''
        })
        if (!hasTextBefore && hasThoughtBlock) {
          return false
        }
        return true
      }

      const hasTextAfter = parts.slice(partIndex + 1).some((p) => {
        const isTool = p.startsWith('[PRISM_EXECUTE_TOOL]')
        const isMiniApp = p.startsWith('<mini_app>')
        return !isTool && !isMiniApp && p.trim() !== ''
      })
      if (hasTextAfter) {
        return false
      }

      const hasTextBefore = parts.slice(0, partIndex).some((p) => {
        const isTool = p.startsWith('[PRISM_EXECUTE_TOOL]')
        const isMiniApp = p.startsWith('<mini_app>')
        return !isTool && !isMiniApp && p.trim() !== ''
      })
      if (!hasTextBefore) {
        return !hasThoughtBlock
      }

      return true
    },
    [parts, hasThoughtBlock]
  )

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
    toolCall?: ToolCallItem
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
        let writingToolArgs: Record<string, unknown> | undefined
        try {
          const jsonMatch = part.match(/\[PRISM_EXECUTE_TOOL\]([\s\S]*?)$/i)
          if (jsonMatch) {
            const partialJson = jsonMatch[1]
            try {
              const parsed = JSON.parse(partialJson)
              if (parsed && typeof parsed === 'object') {
                writingToolArgs = parsed as Record<string, unknown>
              }
            } catch { /* ignore */ }
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

  type GroupedItem = PartItem | { type: 'grouped_web_searches'; items: PartItem[] }
  const groupedItems: GroupedItem[] = []
  let currentSearchGroup: PartItem[] = []

  const flushSearchGroup = () => {
    if (currentSearchGroup.length > 0) {
      if (currentSearchGroup.length === 1) {
        groupedItems.push(currentSearchGroup[0])
      } else {
        groupedItems.push({
          type: 'grouped_web_searches',
          items: [...currentSearchGroup]
        })
      }
      currentSearchGroup = []
    }
  }

  items.forEach((item) => {
    const isSearchTool =
      item.type === 'tool_call' &&
      ((item.isClosed && item.toolCall?.name === 'web_search') ||
        (!item.isClosed &&
          (item.writingToolName === 'web_search' ||
            item.writingToolName === 'search_chat_history' ||
            item.writingToolName === 'search')))

    if (isSearchTool) {
      currentSearchGroup.push(item)
    } else {
      flushSearchGroup()
      groupedItems.push(item)
    }
  })
  flushSearchGroup()

  const cleanTextForCopy = (msg.content || '')
    .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)/g, '')
    .replace(/<mini_app>[\s\S]*?(?:<\/mini_app>|$)/g, '')
    .trim()

  return (
    <StreamContext.Provider value={streamStats}>
      <div className="flex flex-col w-full gap-3">
        {groupedItems.map((gItem, gIdx) => {
          if ('items' in gItem) {
            const group = gItem as { type: 'grouped_web_searches'; items: PartItem[] }
            const toolCallItems = group.items.filter((item) => item.type === 'tool_call')

            let mergedStatus: ToolCallItem['status'] = 'done'
            if (toolCallItems.some((item) => !item.isClosed || item.toolCall?.status === 'writing')) {
              mergedStatus = 'writing'
            } else if (toolCallItems.some((item) => item.toolCall?.status === 'running')) {
              mergedStatus = 'running'
            } else if (toolCallItems.some((item) => item.toolCall?.status === 'error')) {
              mergedStatus = 'error'
            } else if (toolCallItems.some((item) => item.toolCall?.status === 'cancelled')) {
              mergedStatus = 'cancelled'
            }

            const firstItem = group.items[0]
            if (!shouldShowInlineTool(mergedStatus, firstItem.partIndex)) {
              return null
            }
            if (shouldHideActiveBelow && (mergedStatus === 'writing' || mergedStatus === 'running')) {
              return null
            }
            return (
              <div key={`tc-group-${firstItem.partIndex}-${gIdx}`} className="flex items-center gap-1.5">
                <ToolCallIndicator tools={[{ name: 'web_search', status: mergedStatus }]} />
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
                      toolCall={{
                        name: tc.name,
                        status: tc.status,
                        args: tc.args || {}
                      }}
                      chatId={currentChatId || ''}
                    />
                  )
                }
                if (tc.name === 'render_chat_history') {
                  return (
                    <RenderChatHistory
                      key={`tc-${item.partIndex}`}
                      chatId={String(tc.args?.query || '')}
                      onOpenChat={handleLoadChat || (() => {})}
                    />
                  )
                }
                if (tc.name === 'malformed_tool_call') {
                  return (
                    <MalformedToolCallWarning
                      key={`tc-${item.partIndex}`}
                      toolCall={{
                        name: tc.name,
                        status: tc.status,
                        args: tc.args || {}
                      }}
                    />
                  )
                }
                if (!shouldShowInlineTool(tc.status, item.partIndex)) {
                  return null
                }
                if (shouldHideActiveBelow && (tc.status === 'writing' || tc.status === 'running')) {
                  return null
                }
                return (
                  <div key={`tc-${item.partIndex}`} className="flex items-center gap-1.5">
                    <ToolCallIndicator tools={[{ name: tc.name, status: tc.status }]} />
                  </div>
                )
              }
            } else {
              if (!shouldShowInlineTool('writing', item.partIndex)) return null
              if (shouldHideActiveBelow) return null
              const isSearch =
                item.writingToolName === 'web_search' ||
                item.writingToolName === 'search_chat_history' ||
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
                  <ToolCallIndicator tools={[{ name: 'mini-app', status: 'writing' }]} />
                </div>
              )
            }
          }

          if (!part || part.trim() === '') return null

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
        })}

        {visibleNativeTools.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <ToolCallIndicator
              tools={visibleNativeTools.map((tc) => ({
                name: tc.name,
                status: tc.status
              }))}
            />
          </div>
        )}

        {/* Copy & TTS buttons */}
        {!msg.isStreaming && cleanTextForCopy && (
          <div className="flex items-center gap-1.5 mt-2 select-none opacity-60 hover:opacity-100 transition-opacity">
            <CopyMessageButton text={cleanTextForCopy} />
            <TtsButton text={cleanTextForCopy} />
          </div>
        )}
      </div>
    </StreamContext.Provider>
  )
})

const TabMessagesList = React.memo(function TabMessagesList({
  messages,
  currentChatId,
  handleLoadChat,
  markdownComponents
}: {
  messages: Message[]
  currentChatId?: string
  handleLoadChat: (id: string) => void
  markdownComponents: Components
}) {
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
            </div>
          )
        }

        if (msg.role === 'user') {
          return (
            <div
              key={i}
              className="w-full flex flex-col items-end px-4 py-2.5 transition-all duration-700 animate-message"
            >
              <div className="rounded-[18px] bg-white/[0.026] border border-white/[0.065] px-4.5 py-3 text-[14.5px] leading-relaxed text-text-primary max-w-[75%] shadow-md select-text">
                {msg.file && !msg.file.mimeType.startsWith('image/') && (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05] mb-2 select-none">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] text-text-secondary">
                      {msg.file.mimeType === 'application/pdf' ? (
                        <FilePdf size={16} />
                      ) : msg.file.mimeType.includes('presentation') ? (
                        <FilePpt size={16} />
                      ) : (
                        <Brain size={16} />
                      )}
                    </div>
                    <span className="text-xs font-medium text-text-primary truncate max-w-[200px]">
                      {msg.file.name}
                    </span>
                  </div>
                )}
                {msg.screenshot && (
                  <img
                    src={msg.screenshot}
                    alt="User Attachment"
                    className="max-w-full h-auto rounded-xl mb-2 border border-white/[0.08]"
                  />
                )}
                <div>{msg.content}</div>
              </div>
            </div>
          )
        }

        const filteredThoughts = (msg.thoughts || '')
          .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?\[\/PRISM_EXECUTE_TOOL\]/g, '')
          .trim()

        const hasThoughtBlock = !!(filteredThoughts || msg.isThinking)
        const hasContent = !!msg.content

        return (
          <div
            key={i}
            className="w-full flex flex-col items-start px-4 py-5 transition-all duration-700 animate-message"
          >
            {hasThoughtBlock && (
              <div className="w-full mb-3 select-none">
                <details className="group w-full select-none">
                  <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-text-muted hover:text-text-secondary transition-colors duration-150 py-1">
                    <Brain size={14} className="text-accent-secondary shrink-0" />
                    <span>
                      {(() => {
                        if (filteredThoughts) {
                          const wordCount = filteredThoughts.split(/\s+/).filter(Boolean).length
                          return `Thought process (${wordCount} words)`
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

            <div className="w-full text-text-primary">
              {!hasContent && (msg.isConnecting || (!hasThoughtBlock && msg.isWritingToolCall)) ? (
                <div className="flex items-center gap-1.5 h-6 select-none">
                  <div className="h-2.5 w-2.5 rounded-full bg-accent-primary animate-breathe" />
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
    </div>
  )
})

function RealApp(): React.JSX.Element {
  const [bootComplete, setBootComplete] = useState(false)
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine)
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

  // Modals & View States
  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false)
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false)
  const [activeView, setActiveView] = useState('chat')
  const [runningChats, setRunningChats] = useState<Record<string, boolean>>({})
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [activeWorkflow, setActiveWorkflow] = useState<SlashWorkflow | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [chatTodos, setChatTodos] = useState<Record<string, TodoState>>({})
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  // Global Selected Model State
  const [selectedModel, setSelectedModel] = useState<string>('')
  const selectedModelRef = useRef(selectedModel)
  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  // Tabs Management State
  const initialTab: TabSession = {
    id: 'tab-1',
    chatId: undefined,
    title: 'New Chat',
    messages: [],
    inputText: '',
    attachedFile: null,
    sessionMode: 'execution',
    disciplinePath: '',
    isProcessing: false,
    isTodoOpen: false,
    selectedModel: selectedModel,
    isSearchEnabled: false
  }

  const [tabs, setTabs] = useState<TabSession[]>([initialTab])
  const [activeTabId, setActiveTabId] = useState<string>('tab-1')
  const [visibleTabIds, setVisibleTabIds] = useState<string[]>(['tab-1'])

  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0]
  }, [tabs, activeTabId])

  const visibleTabs = useMemo(() => {
    return visibleTabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t): t is TabSession => t !== undefined)
  }, [tabs, visibleTabIds])

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

  const handleAnswerPrism = useCallback((quoteText: string): void => {
    const blockquote = `> ${quoteText.replace(/\n/g, '\n> ')}\n\n`
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabIdRef.current ? { ...t, inputText: blockquote + t.inputText } : t
      )
    )
    setQuotedText(quoteText)
    window.getSelection()?.removeAllRanges()
    setFloatingMenu(null)
  }, [])

  const isOnlineRef = useRef(isOnline)
  useEffect(() => {
    isOnlineRef.current = isOnline
  }, [isOnline])

  useEffect(() => {
    const goOnline = (): void => setIsOnline(true)
    const goOffline = (): void => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    const removeConnectivityListener = window.api.onConnectivityChanged((online: boolean) => {
      if (online && !isOnlineRef.current) {
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
      let initialModel = cfg?.lastSelectedChatModel || ''
      if (!initialModel) {
        try {
          const activeModels = await window.api.getActiveModels()
          if (activeModels && activeModels.length > 0) {
            initialModel = activeModels[0].fullKey
          }
        } catch (e) {
          console.error('Failed to fetch active models:', e)
        }
      }
      if (initialModel) {
        setSelectedModel(initialModel)
        window.api.setModel(initialModel)
        setTabs((prev) => prev.map((t) => ({ ...t, selectedModel: initialModel })))
      }
      if (cfg) {
        setConfig(cfg)
        if (cfg.sessionMode) {
          window.api.setSessionMode(
            cfg.sessionMode,
            cfg.sessionMode === 'discipline' ? cfg.disciplinePath || '' : ''
          )
        }
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!config) return
    document.documentElement.setAttribute('data-theme', config.theme || 'marine')
  }, [config])

  const route = window.location.hash

  // Tab operations
  const handleNewChat = useCallback((force?: boolean) => {
    setTabs((prevTabs) => {
      if (prevTabs.length >= 10 && !force) {
        return prevTabs
      }
      const newId = `tab-${Date.now()}`
      const newTab: TabSession = {
        id: newId,
        chatId: undefined,
        title: 'New Chat',
        messages: [],
        inputText: '',
        attachedFile: null,
        sessionMode: 'execution',
        disciplinePath: '',
        isProcessing: false,
        isTodoOpen: false,
        selectedModel: selectedModelRef.current,
        isSearchEnabled: false
      }
      setActiveTabId(newId)
      setVisibleTabIds((prevVis) => {
        if (prevVis.length === 1) {
          return [newId]
        } else if (prevVis.length < 4) {
          return [...prevVis, newId]
        } else {
          return [...prevVis.slice(0, 3), newId]
        }
      })
      return [...prevTabs, newTab]
    })
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prevTabs) => {
      if (prevTabs.length <= 1) {
        return [
          {
            id: prevTabs[0].id,
            chatId: undefined,
            title: 'New Chat',
            messages: [],
            inputText: '',
            attachedFile: null,
            sessionMode: 'execution',
            disciplinePath: '',
            isProcessing: false,
            isTodoOpen: false,
            selectedModel: selectedModelRef.current,
            isSearchEnabled: false
          }
        ]
      }

      const nextTabs = prevTabs.filter((t) => t.id !== tabId)

      setActiveTabId((prevActive) => {
        if (prevActive === tabId) {
          const closedIdx = prevTabs.findIndex((t) => t.id === tabId)
          const newActive = nextTabs[Math.max(0, closedIdx - 1)] || nextTabs[0]
          return newActive.id
        }
        return prevActive
      })

      setVisibleTabIds((prevVis) => {
        const nextVis = prevVis.filter((id) => id !== tabId)
        if (nextVis.length === 0) {
          const fallback = nextTabs[0]?.id
          return fallback ? [fallback] : []
        }
        return nextVis
      })

      return nextTabs
    })
  }, [])

  const handleToggleSplitTab = useCallback((tabId: string) => {
    setVisibleTabIds((prevVis) => {
      if (prevVis.includes(tabId)) {
        if (prevVis.length > 1) {
          return prevVis.filter((id) => id !== tabId)
        }
        return prevVis
      } else {
        if (prevVis.length < 4) {
          return [...prevVis, tabId]
        }
        return prevVis
      }
    })
  }, [])

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    setVisibleTabIds((prevVis) => {
      if (!prevVis.includes(tabId)) {
        if (prevVis.length === 1) {
          return [tabId]
        } else if (prevVis.length < 4) {
          return [...prevVis, tabId]
        } else {
          return [...prevVis.slice(0, 3), tabId]
        }
      }
      return prevVis
    })
  }, [])

  // Load chat into ONLY the focused tab
  const handleLoadChat = useCallback(async (chatId: string) => {
    try {
      const rawContent = await window.api.loadChat(chatId)
      const messages: Message[] = (rawContent || []).map((c: any) => {
        const isUser = c.role === 'user'
        let text = ''
        if (typeof c.parts === 'string') {
          text = c.parts
        } else if (Array.isArray(c.parts)) {
          text = c.parts.map((p: any) => p.text || '').join('')
        }
        return {
          role: isUser ? 'user' : 'ai',
          content: text
        }
      })

      const chats = await window.api.getChats()
      const historyItem = chats.find((item) => item.id === chatId)
      const title = historyItem?.title || 'Chat'

      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          if (t.id === activeTabIdRef.current) {
            return {
              ...t,
              chatId,
              title,
              messages
            }
          }
          return t
        })
      )

      const todo = await window.api.getTodoForChat(chatId)
      if (todo) {
        setChatTodos((prev) => ({ ...prev, [chatId]: todo }))
      }
    } catch (e) {
      console.error('Failed to load chat:', e)
    }
  }, [])

  // Sending message logic for active tab
  const handleSend = useCallback(
    (
      text: string,
      file?: AttachedFile | null,
      overrideModel?: string,
      overrideSessionMode?: SessionMode,
      forceYoutube?: boolean
    ): void => {
      const targetTabId = activeTabIdRef.current
      const currentTab = tabsRef.current.find((t) => t.id === targetTabId)
      if (!currentTab) return
      if (currentTab.isProcessing) return
      if (!isOnlineRef.current) return

      let chatId = currentTab.chatId
      if (!chatId) {
        chatId = Date.now().toString()
      }

      setTabs((prev) =>
        prev.map((t) => (t.id === targetTabId ? { ...t, chatId, isProcessing: true } : t))
      )

      setRunningChats((prev) => ({ ...prev, [chatId!]: true }))

      const activeFile = file || currentTab.attachedFile
      const activeScreenshot = activeFile?.mimeType.startsWith('image/')
        ? activeFile.data
        : undefined

      const displayContent = text
        .replace(/<attached_file[^>]*\/>/gi, '')
        .replace(/^\[FORCE_SEARCH\]\s*/i, '')
        .trim()

      const userMessage: Message = {
        role: 'user',
        content: displayContent,
        screenshot: activeScreenshot || undefined,
        file: activeFile || undefined
      }

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === targetTabId) {
            return {
              ...t,
              messages: [...t.messages, userMessage],
              inputText: '',
              attachedFile: null
            }
          }
          return t
        })
      )

      let apiMessage = text
      if (activeFile && !activeFile.mimeType.startsWith('image/')) {
        apiMessage = `<attached_file name="${activeFile.name}" mime="${activeFile.mimeType}" /> ${apiMessage}`
      }

      if (currentTab.isSearchEnabled && !apiMessage.startsWith('[FORCE_SEARCH]')) {
        apiMessage = `[FORCE_SEARCH] ${apiMessage}`
      }

      window.api.sendChatMessage({
        message: apiMessage,
        chatId,
        screenshot: activeScreenshot || undefined,
        attachedFile: activeFile || undefined,
        quote: quotedTextRef.current || undefined,
        appMode: forceYoutube ? 'youtube' : undefined,
        sessionMode: overrideSessionMode || currentTab.sessionMode,
        disciplinePath:
          (overrideSessionMode || currentTab.sessionMode) === 'discipline'
            ? currentTab.disciplinePath
            : '',
        modelKey: overrideModel || currentTab.selectedModel
      })

      setQuotedText(null)
      setActiveWorkflow(null)
    },
    []
  )

  const handleModelChange = useCallback((modelKey: string) => {
    setSelectedModel(modelKey)
    window.api.setModel(modelKey)
    setTabs((prev) => prev.map((t) => ({ ...t, selectedModel: modelKey })))
    setConfig((prev) => {
      if (!prev) return prev
      const next = { ...prev, lastSelectedChatModel: modelKey }
      window.api.saveConfig(next)
      return next
    })
  }, [])

  const handleReasoningLevelChange = useCallback(async (modelKey: string, level: string) => {
    if (config) {
      const nextConfig = {
        ...config,
        modelReasoningLevels: {
          ...config.modelReasoningLevels,
          [modelKey]: level
        }
      }
      setConfig(nextConfig)
      await window.api.saveConfig(nextConfig)
    }
  }, [config])

  // Keyboard shortcut listener for new chat / new tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return
      const shortcutStr = config?.newChatShortcut || 'CmdOrCtrl+N'
      if (isShortcutPressed(e, shortcutStr)) {
        e.preventDefault()
        handleNewChat()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleNewChat, config?.newChatShortcut])

  // IPC Event Listeners for background stream updates
  useEffect(() => {
    const removeChatStartListener = window.api.onChatStart((data) => {
      const { chatId } = data
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === activeTabIdRef.current || t.chatId === chatId) {
            return { ...t, chatId, isProcessing: true }
          }
          return t
        })
      )
    })

    const removeChatChunkListener = window.api.onChatChunk((data) => {
      const { chatId, text, thinking, isConnecting, toolCall, streamingToolCall } = data
      setTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.chatId === chatId) {
            const msgs = [...tab.messages]
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg && lastMsg.role === 'ai' && lastMsg.isStreaming) {
              const updatedToolCalls = toolCall
                ? [...(lastMsg.toolCalls || []), toolCall]
                : lastMsg.toolCalls
              const updatedStreamingToolCalls = streamingToolCall
                ? [...(lastMsg.streamingToolCalls || []), streamingToolCall]
                : lastMsg.streamingToolCalls

              msgs[msgs.length - 1] = {
                ...lastMsg,
                content: text !== undefined ? text : lastMsg.content,
                thoughts: thinking !== undefined ? thinking : lastMsg.thoughts,
                isConnecting: isConnecting !== undefined ? isConnecting : lastMsg.isConnecting,
                toolCalls: updatedToolCalls,
                streamingToolCalls: updatedStreamingToolCalls
              }
            } else {
              msgs.push({
                role: 'ai',
                content: text || '',
                thoughts: thinking || '',
                isStreaming: true,
                isConnecting: !!isConnecting,
                toolCalls: toolCall ? [toolCall] : [],
                streamingToolCalls: streamingToolCall ? [streamingToolCall] : []
              })
            }
            return {
              ...tab,
              messages: msgs,
              isProcessing: true
            }
          }
          return tab
        })
      )
    })

    const removeChatEndListener = window.api.onChatEnd((data) => {
      const { chatId, thoughts, finalResponse, toolCalls } = data
      setRunningChats((prev) => {
        const next = { ...prev }
        delete next[chatId]
        return next
      })
      setTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.chatId === chatId) {
            const msgs = [...tab.messages]
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg && lastMsg.role === 'ai') {
              msgs[msgs.length - 1] = {
                ...lastMsg,
                content: finalResponse || lastMsg.content,
                thoughts: thoughts || lastMsg.thoughts,
                toolCalls: toolCalls || lastMsg.toolCalls,
                isStreaming: false,
                isThinking: false
              }
            }
            return {
              ...tab,
              messages: msgs,
              isProcessing: false
            }
          }
          return tab
        })
      )
    })

    const removeChatErrorListener = window.api.onChatError((data) => {
      const { chatId } = data
      setRunningChats((prev) => {
        const next = { ...prev }
        delete next[chatId]
        return next
      })
      setTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.chatId === chatId) {
            return { ...tab, isProcessing: false }
          }
          return tab
        })
      )
    })

    const removeTitleReceivedListener = window.api.onChatTitleReceived(({ id, title }) => {
      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          if (t.chatId === id) {
            return { ...t, title }
          }
          return t
        })
      )
    })

    const removeTodoUpdateListener = window.api.onTodoUpdate((data) => {
      if (data.chatId) {
        setChatTodos((prev) => ({
          ...prev,
          [data.chatId!]: data
        }))
      }
    })

    return () => {
      removeChatStartListener()
      removeChatChunkListener()
      removeChatEndListener()
      removeChatErrorListener()
      removeTitleReceivedListener()
      removeTodoUpdateListener()
    }
  }, [])

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
        onNewChat={() => {
          handleNewChat()
        }}
        currentChatId={activeTab.chatId}
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
    activeTab.chatId,
    runningChats,
    config
  ])

  // Grid layout class based on visible tab count (1, 2, 3, 4)
  const gridLayoutClass = useMemo(() => {
    const count = visibleTabs.length
    switch (count) {
      case 1:
        return 'grid-cols-1 grid-rows-1'
      case 2:
        return 'grid-cols-2 grid-rows-1'
      case 3:
        return 'grid-cols-2 grid-rows-2'
      case 4:
        return 'grid-cols-2 grid-rows-2'
      default:
        return 'grid-cols-1 grid-rows-1'
    }
  }, [visibleTabs.length])

  const getPaneSpanClass = (index: number, count: number) => {
    if (count === 3 && index === 2) {
      return 'col-span-2 row-span-1'
    }
    return 'col-span-1 row-span-1'
  }

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
          onApiKeySave={() => setIsApiKeyModalOpen(false)}
          configLoaded={config !== null}
        />
      )}
      <TitleBar title={activeTab.title || undefined} isStreaming={activeTab.isTitleStreaming} />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={() => setIsApiKeyModalOpen(false)}
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

      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-20 flex h-16 w-6 items-center justify-center rounded-r-xl border border-l-0 border-white/[0.05] bg-white/[0.02] text-text-secondary shadow-lg backdrop-blur-md transition-all duration-300 hover:w-8 hover:bg-white/[0.05] hover:text-text-primary cursor-pointer"
          title="Open Sidebar"
        >
          <div className="h-8 w-1 rounded-full bg-white/[0.1]" />
        </button>
      )}

      {renderedSidebar}

      <main className="flex-1 flex flex-col relative z-10 min-w-0 h-full transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden">
        {!isOnline && <OfflineBanner />}

        {/* Tab Bar Header */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          visibleTabIds={visibleTabIds}
          selectedModel={selectedModel || activeTab.selectedModel}
          onModelChange={handleModelChange}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewChat}
          onToggleSplitTab={handleToggleSplitTab}
          onStopAgent={(tabId) => {
            const targetTab = tabs.find((t) => t.id === tabId)
            if (targetTab?.chatId) {
              window.api.cancelChat(targetTab.chatId)
            }
          }}
        />

        {/* Main Grid View for Visible Tab Panes */}
        {activeView === 'chat' ? (
          <div className={clsx('grid flex-1 w-full h-full p-2.5 gap-2.5 overflow-hidden', gridLayoutClass)}>
            {visibleTabs.map((tab, index) => (
              <div
                key={tab.id}
                className={clsx('h-full w-full overflow-hidden', getPaneSpanClass(index, visibleTabs.length))}
              >
                <ChatPane
                  tab={{ ...tab, selectedModel: selectedModel || tab.selectedModel }}
                  isFocused={tab.id === activeTabId}
                  isSplitView={visibleTabs.length > 1}
                  todo={tab.chatId ? chatTodos[tab.chatId] || null : null}
                  config={config}
                  isKeyMissing={isKeyMissing}
                  isOnline={isOnline}
                  onFocus={handleSelectTab}
                  onCloseTab={handleCloseTab}
                  onToggleSplitTab={handleToggleSplitTab}
                  onToggleTodo={(id) => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, isTodoOpen: !t.isTodoOpen } : t))
                    )
                  }}
                  onCloseTodo={(id) => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, isTodoOpen: false } : t))
                    )
                  }}
                  onSend={(text, file, overrideModel, overrideMode, forceYoutube) => {
                    handleSend(text, file, overrideModel, overrideMode, forceYoutube)
                  }}
                  onCancel={() => {
                    if (tab.chatId) {
                      window.api.cancelChat(tab.chatId)
                    }
                  }}
                  onModelChange={handleModelChange}
                  onReasoningLevelChange={(model, level) => {
                    handleReasoningLevelChange(model, level)
                  }}
                  onModeChange={(mode) => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === tab.id ? { ...t, sessionMode: mode } : t))
                    )
                  }}
                  onSelectFolder={async () => {
                    const selected = await window.api.selectFolder()
                    if (selected) {
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.id === tab.id
                            ? { ...t, disciplinePath: selected, sessionMode: 'discipline' }
                            : t
                        )
                      )
                      window.api.setSessionMode('discipline', selected)
                    }
                  }}
                  onUpdateTabInput={(id, text) => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, inputText: text } : t))
                    )
                  }}
                  onUpdateTabFile={(id, file) => {
                    setTabs((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, attachedFile: file } : t))
                    )
                  }}
                  onOpenScreenshotModal={() => setIsScreenshotModalOpen(true)}
                  onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
                  activeWorkflow={activeWorkflow}
                  setActiveWorkflow={setActiveWorkflow}
                  renderedMessages={
                    <TabMessagesList
                      messages={tab.messages}
                      currentChatId={tab.chatId}
                      handleLoadChat={handleLoadChat}
                      markdownComponents={markdownComponents}
                    />
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-secondary">
            View coming soon...
          </div>
        )}

        <DownloadProgressOverlay
          downloads={visibleDownloads}
          className="absolute right-5 top-12 z-30 w-[min(360px,calc(100vw-2rem))]"
        />
      </main>

      <ErrorPopup />
      <ScreenshotModal
        isOpen={isScreenshotModalOpen}
        onClose={() => setIsScreenshotModalOpen(false)}
        onCapture={(base64) => {
          const file: AttachedFile = {
            name: `Screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
            mimeType: 'image/png',
            data: base64
          }
          setTabs((prev) =>
            prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, attachedFile: file } : t))
          )
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
