import React, { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismBackground } from './components/PrismBackground'
import { LoadingScreen } from './components/LoadingScreen'
import { OfflineBanner } from './components/OfflineBanner'
import { Sidebar } from './components/Sidebar'
import { ToolCallIndicator } from './components/ActionLoader'
import { HarnessActivityBoundary, HarnessSteps } from './components/HarnessSteps'
import { HarnessContextInjection } from './components/HarnessContextInjection'
import { HarnessApprovalDialog } from './components/HarnessApprovalDialog'
import { HarnessProjectModal } from './components/HarnessProjectModal'
import { HarnessWorkspace } from './components/HarnessWorkspace'
import { TitleBar } from './components/TitleBar'
import { ApiKeyModal } from './components/ApiKeyModal'
import { ProviderLockScreen } from './components/ProviderLockScreen'
import { SearchModal } from './components/SearchModal'
import { MiniAppRenderer } from './components/MiniAppRenderer'
import { Spinner } from './components/Spinner'
import { ErrorPopup } from './components/ErrorPopup'
import { DownloadProgressOverlay } from './components/DownloadProgressOverlay'
import { QuestionnaireRenderer } from './components/QuestionnaireRenderer'
import { MalformedToolCallWarning } from './components/MalformedToolCallWarning'
import { RenderChatHistory } from './components/RenderChatHistory'
import { PdfArtifactCard } from './components/PdfArtifactCard'
import { PptxArtifactCard } from './components/PptxArtifactCard'
import { GeneratedImageCard } from './components/GeneratedImageCard'
import { TtsButton } from './components/TtsButton'
import { CopyMessageButton } from './components/CopyMessageButton'
import {
  PrismSuggestion,
  stripPrismSuggestionMarkup,
  SuggestionRuntimeContext
} from './components/PrismSuggestion'
import { UpdaterView } from './components/UpdaterView'
import { isShortcutPressed } from './utils'
import { useInactivityLabel } from './hooks/useInactivityLabel'
import { useActiveToolLabel } from './hooks/useActiveToolLabel'
import { TabBar } from './components/TabBar'
import { ChatPane } from './components/ChatPane'
import { EmptyTabState } from './components/EmptyTabState'
import type {
  TabSession,
  Message,
  AttachedFile,
  StreamingToolCall,
  ToolCallItem
} from './types/tab'
import {
  StreamContext,
  StaticMarkdownComponents,
  createStreamingFadeRehypePlugin,
  useStreamStats,
  CodeBlock
} from './components/AnimatedStreamingText'
import clsx from 'clsx'
import {
  Quotes,
  Brain,
  FilePdf,
  FilePpt,
  CheckCircle,
  XCircle,
  GlobeSimple
} from '@phosphor-icons/react'

import { ScreenshotModal } from './components/ScreenshotModal'
import { YoutubeAppModal } from './components/YoutubeAppModal'
import { AuthModal } from './components/AuthModal'
import { UserProfileModal } from './components/UserProfileModal'
import { QuotaExceededModal } from './components/QuotaExceededModal'
import { PrismPlansModal } from './components/PrismPlansModal'
import { OnboardingLicenseModal } from './components/OnboardingLicenseModal'
import { AppConfig, SlashWorkflow } from '../../main/config'
import type {
  DownloadProgress,
  SessionMode,
  TerminalProcessSnapshot,
  TodoState,
  UserProfile,
  HarnessApprovalRequest,
  HarnessProjectConfig,
  HarnessContextSnapshot,
  HarnessPermissionMode,
  WorkspaceKind
} from '../../shared/types'
import { getDefaultThinkingLevelForModel, isPrismCloudGeminiModel } from './constants'
import {
  applyToolCallEnd,
  applyToolCallStart,
  isToolCancelledResult,
  isToolErrorResult
} from './toolCallState'

const DiscordVoiceGlowOverlay = lazy(() =>
  import('./components/DiscordVoiceGlowOverlay').then(({ DiscordVoiceGlowOverlay }) => ({
    default: DiscordVoiceGlowOverlay
  }))
)
const BrowserPane = lazy(() =>
  import('./components/BrowserPane').then(({ BrowserPane }) => ({ default: BrowserPane }))
)
const QuickLauncher = lazy(() =>
  import('./components/QuickLauncher').then(({ QuickLauncher }) => ({ default: QuickLauncher }))
)
const SettingsView = lazy(() =>
  import('./components/SettingsView').then(({ SettingsView }) => ({ default: SettingsView }))
)

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
  a: ({ href, children, className, style, ...props }: React.ComponentPropsWithoutRef<'a'>) => {
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
    const hasCustomBgOrStyle = Boolean(
      style?.backgroundColor ||
      style?.background ||
      style?.padding ||
      style?.display ||
      className?.includes('bg-') ||
      className?.includes('button') ||
      className?.includes('btn')
    )
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={style}
        className={clsx(!hasCustomBgOrStyle && 'text-accent-primary hover:underline', className)}
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

const PrismSuggestionMarkdownComponents = {
  'prism-suggestion': PrismSuggestion
} as unknown as Components

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
      const isAlreadyExecuted = toolCalls?.some((tc) =>
        stc.id ? tc.id === stc.id : tc.status !== 'writing' && tc.name === stc.name
      )
      if (!isAlreadyExecuted) {
        let parsedArgs: Record<string, unknown> = {}
        try {
          const parsed = JSON.parse(stc.arguments) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedArgs = parsed as Record<string, unknown>
          }
        } catch {
          try {
            const filePathMatch = stc.arguments.match(
              /"(?:filePath|path|TargetFile|absolutePath|AbsolutePath|sourcePath)"\s*:\s*"([^"]*)/i
            )
            const commandMatch = stc.arguments.match(
              /"(?:cmd|command|CommandLine)"\s*:\s*"([^"]*)/i
            )
            const queryMatch = stc.arguments.match(/"query"\s*:\s*"([^"]*)/i)
            const titleMatch = stc.arguments.match(/"title"\s*:\s*"([^"]*)/i)
            if (filePathMatch) parsedArgs.filePath = filePathMatch[1]
            if (commandMatch) parsedArgs.command = commandMatch[1]
            if (queryMatch) parsedArgs.query = queryMatch[1]
            if (titleMatch) parsedArgs.title = titleMatch[1]
          } catch {
            /* ignore */
          }
        }

        const countStreamingLines = (raw: string): number => {
          if (!raw) return 0
          return (raw.match(/\\n/g) || []).length + (raw.match(/\n/g) || []).length
        }

        let streamingAddedLines = 0
        let streamingRemovedLines = 0
        const tcName = stc.name || ''

        const isFileWrite =
          tcName === 'computer_use_create_file' ||
          tcName === 'computer_use_save_file' ||
          tcName === 'computer_use_append_file' ||
          tcName === 'write_to_file'
        const isFileEdit =
          tcName === 'computer_use_edit_file' ||
          tcName === 'replace_file_content' ||
          tcName === 'multi_replace_file_content'

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
          id: stc.id,
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

function hasHarnessActivity(message: Message): boolean {
  return Boolean(
    message.toolCalls?.length || message.streamingToolCalls?.length || message.isWritingToolCall
  )
}

function hasHarnessTextOrThinking(message: Message): boolean {
  return Boolean(message.content.trim() || message.thoughts?.trim())
}

function createHarnessActivityMessage(): Message {
  return {
    role: 'ai',
    content: '',
    thoughts: '',
    isStreaming: true,
    isThinking: false,
    isWritingToolCall: true,
    isConnecting: false,
    toolCalls: [],
    workStartTime: Date.now()
  }
}

function createHarnessTextMessage(): Message {
  return {
    role: 'ai',
    content: '',
    thoughts: '',
    isStreaming: true,
    isThinking: false,
    isWritingToolCall: false,
    isConnecting: false,
    workStartTime: Date.now()
  }
}

interface AiMessageProps {
  msg: Message
  currentChatId?: string
  handleLoadChat?: (id: string) => void
  markdownComponents: Components
  onOpenBrowserTab?: () => void
  onSendSuggestion?: (payload: string, suggestionKey: string) => boolean
  suggestionMessageKey: string
  isSuggestionSendDisabled: boolean
  inactivityLabel?: string | null
  activeToolLabel?: string | null
  isHarness?: boolean
}

const BROWSER_TOOL_NAMES = new Set([
  'open_browser',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_back',
  'browser_press',
  'web_script',
  'browser_snapshot',
  'close_browser',
  'browser_close',
  'detailed_dom_page'
])

const PRISM_IMAGE_REFERENCE_PATTERN = /prism-image:\/\/asset\/[a-f0-9-]{36}/gi

function hideInternalImageReferences(content: string): string {
  return content.replace(PRISM_IMAGE_REFERENCE_PATTERN, 'this image')
}

const AiMessage = React.memo(function AiMessage({
  msg,
  currentChatId,
  handleLoadChat,
  markdownComponents,
  onOpenBrowserTab,
  onSendSuggestion,
  suggestionMessageKey,
  isSuggestionSendDisabled,
  inactivityLabel,
  activeToolLabel,
  isHarness = false
}: AiMessageProps) {
  const visibleContent = useMemo(
    () => hideInternalImageReferences(msg.content || ''),
    [msg.content]
  )
  const streamStats = useStreamStats(visibleContent, !!msg.isStreaming)
  const nativeToolCalls = useMemo(
    () => consolidateToolCalls(msg.toolCalls, msg.streamingToolCalls),
    [msg.toolCalls, msg.streamingToolCalls]
  )
  const hasActiveImageGeneration = nativeToolCalls.some(
    (toolCall) =>
      toolCall.name === 'generate_image' &&
      (toolCall.status === 'writing' || toolCall.status === 'running')
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
          const json = match
            .replace('[PRISM_EXECUTE_TOOL]', '')
            .replace('[/PRISM_EXECUTE_TOOL]', '')
          const parsed = JSON.parse(json)
          if (passiveTools.includes(parsed.type)) return ''
        } catch {}
        return match
      })
      .trim()
    return !!(filteredThoughts || msg.isThinking)
  }, [msg.thoughts, msg.isThinking])

  const shouldHideActiveBelow = hasThoughtBlock

  const shouldHideIndicator = useCallback(
    (status: ToolCallItem['status']) => {
      const isActive = status === 'writing' || status === 'running'
      if (hasThoughtBlock) {
        return true
      }
      return !isActive
    },
    [hasThoughtBlock]
  )

  const visibleNativeTools = useMemo(() => {
    if (activeToolLabel) return []
    const list = nativeToolCalls.filter(
      (tc) =>
        tc.name !== 'to_ask' &&
        tc.name !== 'render_chat_history' &&
        tc.name !== 'malformed_tool_call' &&
        tc.name !== 'create_mini_app' &&
        tc.name !== 'generate_image'
    )
    return list.filter((tc) => !shouldHideIndicator(tc.status))
  }, [nativeToolCalls, shouldHideIndicator, activeToolLabel])

  const parts = useMemo(() => {
    return visibleContent.split(
      /(\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)|<mini_app>[\s\S]*?(?:<\/mini_app>|$))/gi
    )
  }, [visibleContent])

  const shouldShowInlineTool = useCallback(
    (status: ToolCallItem['status'], partIndex: number) => {
      const isActive = status === 'writing' || status === 'running'
      if (isActive) {
        return false
      }
      if (msg.isStreaming && activeToolLabel) {
        return false
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
    [parts, hasThoughtBlock, msg.isStreaming, activeToolLabel]
  )

  if (msg.isConnecting) {
    return (
      <div className="flex items-center gap-2 text-[13px] font-medium text-text-secondary py-1 select-none">
        <span className="w-2 h-2 rounded-full bg-accent-primary animate-pulse shrink-0" />
        <span className="tool-shimmer-text">Connecting...</span>
      </div>
    )
  }

  if (!msg.content && !msg.toolCalls?.length && !msg.isWritingToolCall && !msg.isStreaming) {
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
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
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

  const cleanTextForCopy = visibleContent
    .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)/g, '')
    .replace(/<mini_app>[\s\S]*?(?:<\/mini_app>|$)/g, '')
    .trim()
  const cleanTextForCopyWithSuggestions = stripPrismSuggestionMarkup(cleanTextForCopy)

  const suggestionRuntime = useMemo(
    () => ({
      messageKey: suggestionMessageKey,
      isSendDisabled: isSuggestionSendDisabled,
      onSendSuggestion
    }),
    [suggestionMessageKey, isSuggestionSendDisabled, onSendSuggestion]
  )

  return (
    <StreamContext.Provider value={streamStats}>
      <SuggestionRuntimeContext.Provider value={suggestionRuntime}>
        <div className="flex flex-col w-full gap-1.5">
          {groupedItems.map((gItem, gIdx) => {
            if ('items' in gItem) {
              if (isHarness) return null
              const group = gItem as { type: 'grouped_web_searches'; items: PartItem[] }
              const toolCallItems = group.items.filter((item) => item.type === 'tool_call')

              let mergedStatus: ToolCallItem['status'] = 'done'
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

              const firstItem = group.items[0]
              if (!shouldShowInlineTool(mergedStatus, firstItem.partIndex)) {
                return null
              }
              if (
                shouldHideActiveBelow &&
                (mergedStatus === 'writing' || mergedStatus === 'running')
              ) {
                return null
              }
              return (
                <div
                  key={`tc-group-${firstItem.partIndex}-${gIdx}`}
                  className="flex items-center gap-1.5"
                >
                  <ToolCallIndicator tools={[{ name: 'web_search', status: mergedStatus }]} />
                </div>
              )
            }

            const item = gItem as PartItem
            const { part, startOffset } = item

            if (item.type === 'tool_call') {
              if (isHarness) return null
              if (item.isClosed) {
                const tc = item.toolCall
                if (tc) {
                  if (tc.name === 'generate_image') {
                    return (
                      <GeneratedImageCard
                        key={`tc-${item.partIndex}`}
                        toolCall={tc}
                        chatId={currentChatId || ''}
                      />
                    )
                  }
                  if (tc.name === 'to_ask') {
                    // Only render the read-only done-state summary inline in chat;
                    // the active wizard is rendered by ChatPane above the InputBar.
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
                  if (tc.name === 'write_pdf' || tc.name === 'edit_pdf') {
                    const resText = tc.result || ''
                    const idMatch =
                      resText.match(/ID:\s*(#?\d{6})/i) ||
                      (tc.args?.id ? [null, String(tc.args.id)] : null)
                    const artifactId = idMatch ? idMatch[1].replace('#', '') : undefined

                    const pathMatch =
                      resText.match(/(?:Saved at|File path):\s*(.+)/i) ||
                      (tc.args?.path ? [null, String(tc.args.path)] : null)
                    const filePath = pathMatch
                      ? pathMatch[1].trim()
                      : (tc.args?.path as string | undefined)

                    const filename =
                      (tc.args?.filename as string) ||
                      (filePath ? filePath.split(/[\\/]/).pop() : undefined) ||
                      'document.pdf'

                    return (
                      <PdfArtifactCard
                        key={`tc-${item.partIndex}`}
                        id={artifactId}
                        filename={filename}
                        path={filePath}
                        toolName={tc.name}
                      />
                    )
                  }
                  if (tc.name === 'write_pptx' || tc.name === 'edit_pptx') {
                    const resText = tc.result || ''
                    const idMatch =
                      resText.match(/ID:\s*(#?\d{6})/i) ||
                      (tc.args?.id ? [null, String(tc.args.id)] : null)
                    const artifactId = idMatch ? idMatch[1].replace('#', '') : undefined

                    const pathMatch =
                      resText.match(/(?:Saved at|File path):\s*(.+)/i) ||
                      (tc.args?.path ? [null, String(tc.args.path)] : null)
                    const filePath = pathMatch
                      ? pathMatch[1].trim()
                      : (tc.args?.path as string | undefined)

                    const filename =
                      (tc.args?.filename as string) ||
                      (filePath ? filePath.split(/[\\/]/).pop() : undefined) ||
                      'presentation.pptx'

                    return (
                      <PptxArtifactCard
                        key={`tc-${item.partIndex}`}
                        id={artifactId}
                        filename={filename}
                        path={filePath}
                        toolName={tc.name}
                      />
                    )
                  }
                  if (!shouldShowInlineTool(tc.status, item.partIndex)) {
                    return null
                  }
                  if (
                    shouldHideActiveBelow &&
                    (tc.status === 'writing' || tc.status === 'running')
                  ) {
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
                className="prose prose-invert max-w-none prose-p:leading-relaxed prose-p:my-1 prose-p:first:mt-0 prose-p:last:mb-0 prose-pre:bg-background-secondary prose-pre:border prose-pre:border-surface/50 prose-code:font-mono prose-code:text-[12px] prose-p:font-light prose-p:text-sm md:prose-p:text-base prose-li:text-sm md:prose-li:text-base"
              >
                <ReactMarkdown
                  remarkPlugins={[
                    remarkGfm,
                    remarkMath,
                    remarkBreaks,
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

          {!isHarness &&
            nativeToolCalls.map((tc, idx) => {
              if (tc.name === 'generate_image') {
                return (
                  <GeneratedImageCard
                    key={`native-tc-${tc.id || idx}`}
                    toolCall={tc}
                    chatId={currentChatId || ''}
                  />
                )
              }
              if (tc.name === 'to_ask') {
                // Render done-state summary inline; active wizard is handled by ChatPane.
                return (
                  <QuestionnaireRenderer
                    key={`native-tc-${idx}`}
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
                    key={`native-tc-${idx}`}
                    chatId={String(tc.args?.query || '')}
                    onOpenChat={handleLoadChat || (() => {})}
                  />
                )
              }
              if (tc.name === 'malformed_tool_call') {
                return (
                  <MalformedToolCallWarning
                    key={`native-tc-${idx}`}
                    toolCall={{
                      name: tc.name,
                      status: tc.status,
                      args: tc.args || {}
                    }}
                  />
                )
              }
              if (tc.name === 'create_mini_app') {
                const title = (tc.args.title || 'Mini App') as string
                const html = (tc.args.html || tc.args.code || '') as string
                const css = (tc.args.css || '') as string
                const js = (tc.args.js || tc.args.javascript || '') as string
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
                  <div
                    key={miniAppId}
                    className="w-full flex flex-col gap-2 my-2 select-none animate-fade-in"
                  >
                    <div className="flex items-center gap-2 text-[13px] text-text-secondary font-medium">
                      {status === 'error' || status === 'cancelled' ? (
                        <>
                          <XCircle size={14} className="text-status-error shrink-0" />
                          <span>
                            Failed to create mini app:{' '}
                            <span className="font-semibold text-text-primary">{title}</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle size={14} className="text-status-success shrink-0" />
                          <span>
                            Created mini app:{' '}
                            <span className="font-semibold text-text-primary">{title}</span>
                          </span>
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

          {!isHarness && visibleNativeTools.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <ToolCallIndicator
                tools={visibleNativeTools.map((tc) => ({
                  name: tc.name,
                  status: tc.status
                }))}
              />
            </div>
          )}

          {!isHarness && msg.isStreaming && activeToolLabel && !hasActiveImageGeneration && (
            <div className="flex items-center gap-1.5 mt-1 select-none">
              <ToolCallIndicator overrideLabel={activeToolLabel} />
            </div>
          )}

          {!isHarness &&
            msg.isStreaming &&
            !activeToolLabel &&
            inactivityLabel &&
            !hasActiveImageGeneration && (
              <div className="flex items-center gap-1.5 mt-1.5 select-none">
                <ToolCallIndicator overrideLabel={inactivityLabel} isItalic />
              </div>
            )}

          {/* Copy & TTS buttons + browser session button */}
          {!msg.isStreaming && (
            <div className="flex items-center gap-1.5 mt-0.5 select-none opacity-60 hover:opacity-100 transition-opacity">
              {cleanTextForCopyWithSuggestions && (
                <CopyMessageButton text={cleanTextForCopyWithSuggestions} />
              )}
              {cleanTextForCopyWithSuggestions && (
                <TtsButton text={cleanTextForCopyWithSuggestions} />
              )}
              {/* Browser session button — shows when message has browser tool calls */}
              {onOpenBrowserTab &&
                (msg.toolCalls || []).some((tc) => BROWSER_TOOL_NAMES.has(tc.name)) && (
                  <button
                    onClick={onOpenBrowserTab}
                    title="View AI browser session"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all duration-150 cursor-pointer"
                  >
                    <GlobeSimple size={13} />
                    <span>Browser</span>
                  </button>
                )}
            </div>
          )}
        </div>
      </SuggestionRuntimeContext.Provider>
    </StreamContext.Provider>
  )
})

interface AiMessageRowProps {
  msg: Message
  i: number
  currentChatId?: string
  handleLoadChat?: (id: string) => void
  markdownComponents: Components
  onOpenBrowserTab?: () => void
  onSendSuggestion?: (payload: string, suggestionKey: string) => boolean
  suggestionMessageKey: string
  isSuggestionSendDisabled: boolean
  sessionMode: SessionMode
  harnessUi?: {
    showSteps: boolean
    showThinking: boolean
    reduceMotion: boolean
  }
}

const AiMessageRow = React.memo(function AiMessageRow({
  msg,
  i,
  currentChatId,
  handleLoadChat,
  markdownComponents,
  onOpenBrowserTab,
  onSendSuggestion,
  suggestionMessageKey,
  isSuggestionSendDisabled,
  sessionMode,
  harnessUi
}: AiMessageRowProps) {
  const inactivityLabel = useInactivityLabel(msg)
  const { activeToolLabel } = useActiveToolLabel(msg)

  const cleanContentText = hideInternalImageReferences(msg.content || '')
    .replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$)/g, '')
    .replace(/<mini_app>[\s\S]*?(?:<\/mini_app>|$)/g, '')
    .trim()
  const hasContent = stripPrismSuggestionMarkup(cleanContentText) !== ''
  const hasImageGeneration = Boolean(
    msg.toolCalls?.some((toolCall) => toolCall.name === 'generate_image') ||
    msg.streamingToolCalls?.some((toolCall) => toolCall.name === 'generate_image')
  )

  const isRunningTool = !!(
    activeToolLabel ||
    msg.isWritingToolCall ||
    (msg.streamingToolCalls && msg.streamingToolCalls.some((t) => !t.isComplete)) ||
    (msg.toolCalls && msg.toolCalls.some((t) => t.status === 'running' || t.status === 'writing'))
  )

  const isActive = msg.isStreaming || msg.isThinking || isRunningTool || msg.isConnecting
  const harnessToolCalls = useMemo(
    () => consolidateToolCalls(msg.toolCalls, msg.streamingToolCalls),
    [msg.toolCalls, msg.streamingToolCalls]
  )
  const isHarness = sessionMode === 'harness'

  const hasTools = !!(msg.toolCalls && msg.toolCalls.length > 0)
  const thinkingSec =
    msg.thinkingDuration !== undefined
      ? msg.thinkingDuration
      : msg.thoughts && msg.thoughts.trim() !== ''
        ? Math.max(1, Math.round(msg.thoughts.length / 120))
        : 0
  const hasThinking = thinkingSec > 0
  const workedSec = msg.workedDuration !== undefined ? msg.workedDuration : thinkingSec

  const hasThoughtInTurn = !!(
    msg.isThinking ||
    (msg.thoughts && msg.thoughts.trim() !== '') ||
    hasThinking
  )

  return (
    <div
      key={i}
      className="w-full flex flex-col items-start px-4 py-3.5 transition-all duration-700 animate-message"
    >
      {/* 1. Active State Header: "Thinking" shimming remains sticky until turn completes */}
      {!isHarness && isActive && hasThoughtInTurn && (
        <div className="w-full mb-1.5 select-none flex flex-col items-start gap-1">
          <span className="thinking-shimmer-text text-[13px] font-medium leading-normal inline-block pb-[1.5px]">
            Thinking
          </span>
        </div>
      )}

      {/* 2. Finished State Indicator (Static Gray Text) */}
      {!isHarness && !isActive && (
        <>
          {
            hasTools ? (
              <div className="w-full mb-1.5 select-none text-xs text-text-secondary/60 font-medium">
                Worked for {workedSec > 0 ? workedSec : 1} {workedSec === 1 ? 'second' : 'seconds'}
              </div>
            ) : hasThinking ? (
              <div className="w-full mb-1.5 select-none text-xs text-text-secondary/60 font-medium">
                Thought for {thinkingSec} {thinkingSec === 1 ? 'second' : 'seconds'}
              </div>
            ) : null /* Instant message: no header */
          }
        </>
      )}

      {(hasContent || !isHarness) && (
        <div className="w-full text-text-primary" data-prism-ai-message="true">
          {!isHarness && !hasContent && isActive && !hasImageGeneration ? (
            <div className="flex items-center gap-1.5 h-6 select-none">
              {activeToolLabel ? (
                <ToolCallIndicator overrideLabel={activeToolLabel} />
              ) : inactivityLabel ? (
                <ToolCallIndicator overrideLabel={inactivityLabel} isItalic />
              ) : (
                <div className="h-2.5 w-2.5 rounded-full bg-accent-primary animate-breathe shrink-0" />
              )}
            </div>
          ) : (
            <AiMessage
              msg={msg}
              currentChatId={currentChatId}
              handleLoadChat={handleLoadChat}
              markdownComponents={markdownComponents}
              onOpenBrowserTab={onOpenBrowserTab}
              onSendSuggestion={onSendSuggestion}
              suggestionMessageKey={suggestionMessageKey}
              isSuggestionSendDisabled={isSuggestionSendDisabled}
              inactivityLabel={inactivityLabel}
              activeToolLabel={activeToolLabel}
              isHarness={isHarness}
            />
          )}
        </div>
      )}

      {isHarness && (
        <HarnessActivityBoundary key={isActive ? 'harness-activity-active' : 'harness-activity-complete'}>
          <HarnessSteps
            tools={harnessToolCalls}
            thoughts={msg.thoughts}
            isActive={Boolean(isActive)}
            showSteps={harnessUi?.showSteps !== false}
            showThinking={harnessUi?.showThinking !== false}
            reduceMotion={harnessUi?.reduceMotion === true}
          />
        </HarnessActivityBoundary>
      )}
    </div>
  )
})

interface UserMessageRowProps {
  msg: Message
  i: number
  markdownComponents: Components
  onSendSuggestion?: (payload: string, suggestionKey: string) => boolean
  suggestionMessageKey: string
  isSuggestionSendDisabled: boolean
}

const UserMessageRow = React.memo(function UserMessageRow({
  msg,
  i,
  markdownComponents,
  onSendSuggestion,
  suggestionMessageKey,
  isSuggestionSendDisabled
}: UserMessageRowProps) {
  const suggestionRuntime = useMemo(
    () => ({
      messageKey: suggestionMessageKey,
      isSendDisabled: isSuggestionSendDisabled,
      onSendSuggestion
    }),
    [suggestionMessageKey, isSuggestionSendDisabled, onSendSuggestion]
  )

  return (
    <div
      key={i}
      className="w-full flex flex-col items-end px-4 py-2.5 transition-all duration-700 animate-message"
    >
      <div className="rounded-2xl bg-white/[0.05] backdrop-blur-2xl border border-white/[0.12] shadow-[var(--glass-specular-top),0_8px_24px_rgba(0,0,0,0.35)] px-5 py-3.5 text-[14.5px] leading-relaxed text-text-primary max-w-[75%] select-text">
        {msg.quote && (
          <div className="relative mb-2.5 flex flex-col gap-1 rounded-xl bg-white/[0.04] border border-white/[0.08] border-l-[3px] border-l-accent-secondary px-3.5 py-2 select-text">
            <div className="flex items-center gap-1.5 text-accent-secondary text-[11.5px] font-semibold tracking-wide select-none">
              <Quotes size={13} weight="bold" />
              <span>Prism</span>
            </div>
            <div className="text-xs text-text-secondary/85 line-clamp-4 font-normal leading-relaxed break-words whitespace-pre-wrap">
              {msg.quote}
            </div>
          </div>
        )}
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
        {msg.content && (
          <SuggestionRuntimeContext.Provider value={suggestionRuntime}>
            <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-p:my-1 prose-p:first:mt-0 prose-p:last:mb-0 prose-pre:bg-background-secondary prose-pre:border prose-pre:border-surface/50 prose-code:font-mono prose-code:text-[12px] prose-p:font-light prose-p:text-sm md:prose-p:text-base prose-li:text-sm md:prose-li:text-base break-words">
              <ReactMarkdown
                remarkPlugins={[
                  remarkGfm,
                  remarkMath,
                  remarkBreaks,
                  disableIndentedCode as unknown as import('unified').Pluggable
                ]}
                rehypePlugins={[rehypeRaw, rehypeParseMath, rehypeKatex]}
                components={markdownComponents}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          </SuggestionRuntimeContext.Provider>
        )}
      </div>
    </div>
  )
})

const TabMessagesList = React.memo(function TabMessagesList({
  messages,
  tabId,
  currentChatId,
  handleLoadChat,
  onOpenBrowserTab,
  isSuggestionSendDisabled,
  onSendSuggestion,
  sessionMode,
  harnessUi,
  harnessContextSnapshot
}: {
  messages: Message[]
  tabId: string
  currentChatId?: string
  handleLoadChat: (id: string) => void
  onOpenBrowserTab?: (tabId?: string) => void
  isSuggestionSendDisabled: boolean
  onSendSuggestion: (tabId: string, payload: string, suggestionKey: string) => boolean
  sessionMode: SessionMode
  harnessContextSnapshot?: HarnessContextSnapshot
  harnessUi?: {
    showSteps: boolean
    showThinking: boolean
    reduceMotion: boolean
  }
}) {
  const markdownComponents = useMemo(
    () => ({
      ...MarkdownComponents,
      ...StaticMarkdownComponents,
      ...PrismSuggestionMarkdownComponents
    }),
    []
  )

  const handleSendRowSuggestion = useCallback(
    (payload: string, suggestionKey: string) => {
      return onSendSuggestion(tabId, payload, suggestionKey)
    },
    [tabId, onSendSuggestion]
  )

  const handleOpenBrowser = useCallback(() => {
    onOpenBrowserTab?.(tabId)
  }, [onOpenBrowserTab, tabId])

  if (messages.length === 0 && !harnessContextSnapshot) return null

  return (
    <div className="w-full flex flex-col max-w-[800px] mx-auto px-4">
      {sessionMode === 'harness' &&
        harnessContextSnapshot &&
        !messages.some((message) => message.role === 'context') && (
        <HarnessContextInjection
          snapshot={harnessContextSnapshot}
          reduceMotion={harnessUi?.reduceMotion}
        />
      )}
      {messages.map((msg, i) => {
        if (msg.role === 'context' && msg.contextSnapshot) {
          return (
            <HarnessContextInjection
              key={`context-${msg.contextSnapshot.createdAt}-${i}`}
              snapshot={msg.contextSnapshot}
              reduceMotion={harnessUi?.reduceMotion}
            />
          )
        }
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
            <UserMessageRow
              key={i}
              msg={msg}
              i={i}
              markdownComponents={markdownComponents}
              onSendSuggestion={handleSendRowSuggestion}
              suggestionMessageKey={`${currentChatId || tabId}:user:${i}`}
              isSuggestionSendDisabled={isSuggestionSendDisabled}
            />
          )
        }

        return (
          <AiMessageRow
            key={i}
            msg={msg}
            i={i}
            currentChatId={currentChatId}
            handleLoadChat={handleLoadChat}
            markdownComponents={markdownComponents}
            onOpenBrowserTab={handleOpenBrowser}
            onSendSuggestion={handleSendRowSuggestion}
            suggestionMessageKey={`${currentChatId || tabId}:${i}`}
            isSuggestionSendDisabled={isSuggestionSendDisabled}
            sessionMode={sessionMode}
            harnessUi={harnessUi}
          />
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
  const [terminalProcesses, setTerminalProcesses] = useState<
    Record<string, TerminalProcessSnapshot[]>
  >({})
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [harnessApprovalRequest, setHarnessApprovalRequest] =
    useState<HarnessApprovalRequest | null>(null)
  const [harnessPromptWarnings, setHarnessPromptWarnings] = useState<string[]>([])
  const [isHarnessProjectModalOpen, setIsHarnessProjectModalOpen] = useState(false)
  const [harnessProjectTargetTabId, setHarnessProjectTargetTabId] = useState<string | null>(null)
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    | 'shortcuts'
    | 'providers'
    | 'intelligence'
    | 'skills'
    | 'runtime'
    | 'appearance'
    | 'voice'
    | 'workflows'
    | 'system'
    | 'harness'
    | 'discord'
    | 'license'
    | 'about'
  >('shortcuts')

  useEffect(() => {
    return window.api.onHarnessApprovalRequest((request) => {
      setHarnessApprovalRequest(request)
    })
  }, [])

  useEffect(() => {
    return window.api.onHarnessPromptWarning(({ warnings }) => {
      setHarnessPromptWarnings(warnings)
    })
  }, [])

  // Auth State
  const [authUser, setAuthUser] = useState<UserProfile | null>(null)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false)
  const [isPlansModalOpen, setIsPlansModalOpen] = useState(false)
  const [isEnterpriseUser, setIsEnterpriseUser] = useState(false)
  const [isOnboardingLicenseModalOpen, setIsOnboardingLicenseModalOpen] = useState(false)
  const [isProviderLockOpen, setIsProviderLockOpen] = useState(false)

  useEffect(() => {
    const onOpenPlans = (): void => setIsPlansModalOpen(true)
    const onOpenLicense = (): void => {
      setIsPlansModalOpen(false)
      setSettingsInitialSection('license')
      setIsSettingsModalOpen(true)
    }
    window.addEventListener('prism:open-plans', onOpenPlans)
    window.addEventListener('prism:open-license', onOpenLicense)
    return () => {
      window.removeEventListener('prism:open-plans', onOpenPlans)
      window.removeEventListener('prism:open-license', onOpenLicense)
    }
  }, [])

  const checkEnterpriseStatus = useCallback(async () => {
    try {
      const [usage, license, user] = await Promise.all([
        window.api.getUserAiUsage().catch(() => null),
        window.api.getLicenseInfo
          ? window.api.getLicenseInfo().catch(() => null)
          : Promise.resolve(null),
        window.api.getAuthUser ? window.api.getAuthUser().catch(() => null) : Promise.resolve(null)
      ])

      const isUsageEnt =
        usage?.tier?.toLowerCase().startsWith('enterprise') ||
        usage?.tier?.toLowerCase() === 'company' ||
        Boolean(
          usage?.modelList?.some(
            (m) =>
              m.tier?.toLowerCase().startsWith('enterprise') || m.tier?.toLowerCase() === 'company'
          )
        )

      const isLicenseEnt = Boolean(
        license?.isActivated &&
        (license?.type?.toUpperCase() === 'ENTERPRISE' ||
          license?.type?.toUpperCase() === 'COMPANY')
      )

      const isUserEnt =
        user?.accountType?.toLowerCase() === 'enterprise' ||
        user?.accountType?.toLowerCase() === 'company'

      const isEnt = isUsageEnt || isLicenseEnt || isUserEnt
      setIsEnterpriseUser(isEnt)
    } catch {
      setIsEnterpriseUser(false)
    }
  }, [])

  useEffect(() => {
    checkEnterpriseStatus()

    if (window.api?.getAuthUser) {
      window.api
        .getAuthUser()
        .then((user) => {
          if (user) {
            setAuthUser(user)
            checkEnterpriseStatus()
          }
        })
        .catch((err) => console.error('[Auth] Initial getAuthUser failed:', err))
    }

    if (window.api?.onAuthSessionUpdated) {
      const unsub = window.api.onAuthSessionUpdated((user) => {
        setAuthUser(user)
        checkEnterpriseStatus()
        if (user) {
          setTimeout(() => {
            setIsAuthModalOpen(false)
            setIsApiKeyModalOpen(false)
            setIsProviderLockOpen(false)
            isOnboardingRef.current = false
            setIsProfileModalOpen(true)
          }, 600)
        }
      })
      return unsub
    }
    return () => {}
  }, [checkEnterpriseStatus])

  const isKeyMissing = useMemo(() => {
    if (authUser) return false
    if (!config?.providers) return true
    return !config.providers.some(
      (p) =>
        p &&
        p.apiKey &&
        p.apiKey.trim() !== '' &&
        Array.isArray(p.models) &&
        p.models.some((m) => m && m.enabled)
    )
  }, [config, authUser])

  const hasTriggeredOnboardingRef = useRef(false)
  const isOnboardingRef = useRef(false)
  useEffect(() => {
    if (!bootComplete || config === null) return
    if (isKeyMissing) {
      if (!hasTriggeredOnboardingRef.current) {
        hasTriggeredOnboardingRef.current = true
        isOnboardingRef.current = true
        setIsAuthModalOpen(true)
      } else if (!isAuthModalOpen && !isApiKeyModalOpen) {
        setIsProviderLockOpen(true)
      }
    } else {
      setIsProviderLockOpen(false)
    }
  }, [bootComplete, isKeyMissing, config, isAuthModalOpen, isApiKeyModalOpen])

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
  const [harnessTabs, setHarnessTabs] = useState<TabSession[]>([])
  const [activeHarnessTabId, setActiveHarnessTabId] = useState<string>('')

  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const harnessTabsRef = useRef(harnessTabs)
  const harnessChatIdsRef = useRef(new Set<string>())
  useEffect(() => {
    harnessTabsRef.current = harnessTabs
    harnessChatIdsRef.current = new Set(
      harnessTabs.flatMap((tab) => (tab.chatId ? [tab.chatId] : []))
    )
  }, [harnessTabs])

  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const activeHarnessTabIdRef = useRef(activeHarnessTabId)
  useEffect(() => {
    activeHarnessTabIdRef.current = activeHarnessTabId
  }, [activeHarnessTabId])

  useEffect(() => {
    return window.api.onHarnessContextInjection(({ chatId, snapshot }) => {
      setHarnessTabs((previous) => {
        const hasMatchingChat = previous.some((tab) => tab.chatId === chatId)
        return previous.map((tab) => {
          const isTarget = hasMatchingChat
            ? tab.chatId === chatId
            : tab.id === activeHarnessTabIdRef.current && tab.isProcessing
          if (!isTarget) return tab
          const contextMessage: Message = {
            role: 'context',
            content: '',
            contextSnapshot: snapshot
          }
          const alreadyShown = tab.messages.some(
            (message) => message.contextSnapshot?.fingerprint === snapshot.fingerprint
          )
          if (alreadyShown) return { ...tab, chatId, harnessContextSnapshot: snapshot }
          const lastUserIndex = tab.messages.map((message) => message.role).lastIndexOf('user')
          const messages = [...tab.messages]
          messages.splice(lastUserIndex === -1 ? 0 : lastUserIndex, 0, contextMessage)
          return { ...tab, chatId, messages, harnessContextSnapshot: snapshot }
        })
      })
    })
  }, [])

  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0] || initialTab
  }, [tabs, activeTabId])

  const visibleTabs = useMemo(() => {
    const matched = visibleTabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t): t is TabSession => t !== undefined)

    if (matched.length > 0) {
      if (!matched.some((t) => t.id === activeTabId)) {
        const active = tabs.find((t) => t.id === activeTabId)
        if (active) {
          return visibleTabIds.length <= 1 ? [active] : [...matched.slice(0, 3), active]
        }
      }
      return matched
    }

    const fallback = tabs.find((t) => t.id === activeTabId) || tabs[0]
    return fallback ? [fallback] : []
  }, [tabs, visibleTabIds, activeTabId])

  const activeHarnessTab = useMemo(
    () =>
      harnessTabs.find((tab) => tab.id === activeHarnessTabId) || harnessTabs[0] || null,
    [harnessTabs, activeHarnessTabId]
  )

  const selectHarnessProjectForTab = useCallback(
    (tabId: string, project: HarnessProjectConfig): void => {
      const existingTab = harnessTabsRef.current.find((tab) => tab.id === tabId)
      if (
        existingTab?.harnessContextSnapshot &&
        existingTab.harnessContextSnapshot.projectPath.toLowerCase() !==
          project.rootPath.toLowerCase()
      ) {
        setHarnessPromptWarnings([
          'This conversation keeps its original project and context snapshot. Start a new Harness conversation to use the selected project.'
        ])
        setHarnessProjectTargetTabId(null)
        setIsHarnessProjectModalOpen(false)
        return
      }
      setHarnessTabs((previous) =>
        previous.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                workspace: 'harness',
                sessionMode: 'harness',
                disciplinePath: project.rootPath
              }
            : tab
        )
      )
      setHarnessProjectTargetTabId(null)
      setIsHarnessProjectModalOpen(false)
    },
    []
  )

  const ensureHarnessProjectForTab = useCallback(
    async (tabId: string, currentPath?: string): Promise<void> => {
      const candidate = currentPath || config?.harness.lastProjectPath
      const project = await window.api.getHarnessProject(candidate).catch(() => null)
      if (project) {
        selectHarnessProjectForTab(tabId, project)
        return
      }
      setHarnessProjectTargetTabId(tabId)
      setIsHarnessProjectModalOpen(true)
    },
    [config?.harness.lastProjectPath, selectHarnessProjectForTab]
  )

  const [quotedText, setQuotedText] = useState<string | null>(null)
  const quotedTextRef = useRef<string | null>(null)
  useEffect(() => {
    quotedTextRef.current = quotedText
  }, [quotedText])

  const [floatingMenu, setFloatingMenu] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)

  // Text selection listener for Answer Prism (strictly for AI messages)
  useEffect(() => {
    const handleSelectionChange = (): void => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setFloatingMenu(null)
        return
      }

      const text = selection.toString().trim()
      if (text.length === 0) {
        setFloatingMenu(null)
        return
      }

      // Strictly ensure the selected range is entirely within an AI message container
      const anchorNode = selection.anchorNode
      const focusNode = selection.focusNode
      if (!anchorNode || !focusNode) {
        setFloatingMenu(null)
        return
      }

      const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
      const focusEl = focusNode instanceof Element ? focusNode : focusNode.parentElement

      const aiAnchorContainer = anchorEl?.closest('[data-prism-ai-message="true"]')
      const aiFocusContainer = focusEl?.closest('[data-prism-ai-message="true"]')

      if (!aiAnchorContainer || !aiFocusContainer || aiAnchorContainer !== aiFocusContainer) {
        setFloatingMenu(null)
        return
      }

      try {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          setFloatingMenu(null)
          return
        }

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
    if (activeView === 'harness') {
      setHarnessTabs((previous) =>
        previous.map((tab) =>
          tab.id === activeHarnessTabIdRef.current ? { ...tab, quotedText: quoteText } : tab
        )
      )
    } else {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, quotedText: quoteText } : t))
      )
    }
    setQuotedText(quoteText)
    window.getSelection()?.removeAllRanges()
    setFloatingMenu(null)
  }, [activeView])

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
        const configuredChatMode: SessionMode =
          cfg.sessionMode === 'harness' ? 'execution' : cfg.sessionMode
        const configuredPath = configuredChatMode === 'discipline' ? cfg.disciplinePath || '' : ''
        setTabs((previous) =>
          previous.map((tab) =>
            !tab.chatId && tab.messages.length === 0 && tab.tabType !== 'browser'
              ? { ...tab, sessionMode: configuredChatMode, disciplinePath: configuredPath }
              : tab
          )
        )
        if (configuredChatMode) {
          window.api.setSessionMode(
            configuredChatMode,
            configuredChatMode === 'discipline' ? cfg.disciplinePath || '' : ''
          )
        }
      }
      try {
        const licInfo = await window.api.getLicenseInfo()
        if (!licInfo?.isActivated && !cfg?.suppressLicenseModal) {
          setIsOnboardingLicenseModalOpen(true)
        }
      } catch (err) {
        console.error('[LicenseCheck] Failed to check license on startup:', err)
      }
    }
    init()

    const removeConfigListener = window.api.onConfigChanged((cfg) => {
      if (cfg) {
        setConfig(cfg)
      }
    })
    return () => {
      removeConfigListener()
    }
  }, [])

  useEffect(() => {
    if (!config) return
    document.documentElement.setAttribute('data-theme', config.theme || 'marine')
  }, [config])

  const route = window.location.hash

  // Tab operations
  const handleNewChat = useCallback(
    (force?: boolean) => {
      setActiveView('chat')
      const currentTabs = tabsRef.current

      if (currentTabs.length >= 10 && !force) {
        const emptyTab = currentTabs.find((t) => !t.chatId && t.messages.length === 0)
        if (emptyTab) {
          setActiveTabId(emptyTab.id)
          setVisibleTabIds((prevVis) => (prevVis.includes(emptyTab.id) ? prevVis : [emptyTab.id]))
          return
        }
        const lastTab = currentTabs[currentTabs.length - 1]
        if (lastTab) {
          setActiveTabId(lastTab.id)
          setVisibleTabIds((prevVis) => (prevVis.includes(lastTab.id) ? prevVis : [lastTab.id]))
        }
        return
      }

      const newId = `tab-${Date.now()}`
      const defaultMode = config?.sessionMode === 'harness' ? 'execution' : config?.sessionMode || 'execution'
      const defaultPath = defaultMode === 'discipline' ? config?.disciplinePath || '' : ''
      const newTab: TabSession = {
        id: newId,
        chatId: undefined,
        title: 'New Chat',
        messages: [],
        inputText: '',
        attachedFile: null,
        sessionMode: defaultMode,
        disciplinePath: defaultPath,
        isProcessing: false,
        isTodoOpen: false,
        selectedModel: selectedModelRef.current,
        isSearchEnabled: false
      }

      window.api.setSessionMode(defaultMode, defaultPath)
      setTabs((prevTabs) => [...prevTabs, newTab])
      setActiveTabId(newId)
      setVisibleTabIds((prevVis) => {
        if (prevVis.length <= 1) {
          return [newId]
        } else if (prevVis.length < 4) {
          return [...prevVis, newId]
        } else {
          return [...prevVis.slice(0, 3), newId]
        }
      })
    },
    [config]
  )

  const handleNewHarnessTab = useCallback(
    async (forceProjectPicker = false): Promise<void> => {
      setActiveView('harness')
      const newId = `harness-${Date.now()}`
      const project = forceProjectPicker
        ? null
        : await window.api.getHarnessProject(config?.harness.lastProjectPath).catch(() => null)
      const newTab: TabSession = {
        id: newId,
        chatId: undefined,
        title: 'New Harness',
        messages: [],
        inputText: '',
        attachedFile: null,
        workspace: 'harness',
        sessionMode: 'harness',
        disciplinePath: project?.rootPath || '',
        isProcessing: false,
        isTodoOpen: false,
        selectedModel: selectedModelRef.current,
        isSearchEnabled: false,
        disabledSkills: []
      }
      setHarnessTabs((previous) => [...previous, newTab])
      setActiveHarnessTabId(newId)
      if (!project) {
        setHarnessProjectTargetTabId(newId)
        setIsHarnessProjectModalOpen(true)
      }
    },
    [config?.harness.lastProjectPath]
  )

  const handleOpenHarness = useCallback((): void => {
    setActiveView('harness')
    if (harnessTabsRef.current.length === 0) {
      void handleNewHarnessTab()
      return
    }
    if (!activeHarnessTabIdRef.current) {
      setActiveHarnessTabId(harnessTabsRef.current[0].id)
    }
  }, [handleNewHarnessTab])

  const handleSelectHarnessTab = useCallback((tabId: string): void => {
    setActiveView('harness')
    setActiveHarnessTabId(tabId)
  }, [])

  const handleCloseHarnessTab = useCallback((tabId: string): void => {
    setHarnessTabs((previous) => {
      const closing = previous.find((tab) => tab.id === tabId)
      if (closing?.chatId) window.api.cancelChat(closing.chatId)
      const next = previous.filter((tab) => tab.id !== tabId)
      if (activeHarnessTabIdRef.current === tabId) {
        setActiveHarnessTabId(next[Math.max(0, previous.findIndex((tab) => tab.id === tabId) - 1)]?.id || next[0]?.id || '')
      }
      return next
    })
  }, [])

  const handleHarnessSessionDeleted = useCallback((chatId: string): void => {
    setHarnessTabs((previous) => {
      const next = previous.filter((tab) => tab.chatId !== chatId)
      if (!next.some((tab) => tab.id === activeHarnessTabIdRef.current)) {
        setActiveHarnessTabId(next[0]?.id || '')
      }
      return next
    })
  }, [])

  /** Opens (or focuses) a browser session viewer tab linked to the given source chat tab. */
  const handleOpenBrowserTab = useCallback((sourceTabId?: string) => {
    setActiveView('chat')
    window.api.openBrowser().catch(() => {})

    setTabs((prevTabs) => {
      const existing = prevTabs.find((t) => t.tabType === 'browser')
      if (existing) {
        setActiveTabId(existing.id)
        setVisibleTabIds((prevVis) => (prevVis.includes(existing.id) ? prevVis : [existing.id]))
        return prevTabs
      }

      const sourceIndex = sourceTabId ? prevTabs.findIndex((t) => t.id === sourceTabId) : -1
      const newTabId = `browser-tab-${Date.now()}`
      const newTab: TabSession = {
        id: newTabId,
        chatId: undefined,
        title: 'AI Browser',
        messages: [],
        inputText: '',
        attachedFile: null,
        sessionMode: 'execution',
        disciplinePath: '',
        isProcessing: false,
        isTodoOpen: false,
        selectedModel: selectedModelRef.current,
        isSearchEnabled: false,
        tabType: 'browser',
        browserSourceTabId: sourceTabId
      }

      const updated = [...prevTabs]
      if (sourceIndex !== -1) {
        updated.splice(sourceIndex + 1, 0, newTab)
      } else {
        updated.push(newTab)
      }

      setActiveTabId(newTabId)
      setVisibleTabIds((prevVis) => {
        if (prevVis.length <= 1) return [newTabId]
        if (prevVis.length < 4) return [...prevVis, newTabId]
        return prevVis
      })

      return updated
    })
  }, [])

  // Auto-open browser session tab instantly as soon as AI triggers a browser session or command
  useEffect(() => {
    const removeActionListener = window.api.onBrowserAction((action) => {
      if (action.type === 'close') return
      const currentTabs = tabsRef.current
      const processingTab =
        currentTabs.find((t) => t.isProcessing) ||
        currentTabs.find((t) => t.id === activeTabIdRef.current)
      if (processingTab && processingTab.tabType !== 'browser') {
        handleOpenBrowserTab(processingTab.id)
      }
    })

    const removeExecListener = window.api.onBrowserExecCommand(({ command }) => {
      if (command && command.type !== 'close') {
        const hasBrowserTab = tabsRef.current.some((t) => t.tabType === 'browser')
        if (!hasBrowserTab) {
          const activeSourceTab =
            tabsRef.current.find((t) => t.isProcessing) ||
            tabsRef.current.find((t) => t.id === activeTabIdRef.current)
          handleOpenBrowserTab(activeSourceTab?.id)
        }
      }
    })

    return () => {
      removeActionListener()
      removeExecListener()
    }
  }, [handleOpenBrowserTab])

  const pendingBrowserCloseRef = useRef<boolean>(false)

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prevTabs) => {
      const closedTab = prevTabs.find((t) => t.id === tabId)
      if (closedTab?.tabType !== 'browser' && closedTab?.chatId) {
        window.api.cancelChat(closedTab.chatId)
      }
      if (closedTab?.tabType === 'browser') {
        const isAnyProcessing = prevTabs.some((t) => t.isProcessing)
        if (isAnyProcessing) {
          pendingBrowserCloseRef.current = true
        } else {
          window.api.closeBrowser().catch(() => {})
        }
      }

      const nextTabs = prevTabs.filter((t) => t.id !== tabId)

      setActiveTabId((prevActive) => {
        if (prevActive === tabId) {
          const closedIdx = prevTabs.findIndex((t) => t.id === tabId)
          const newActive = nextTabs[Math.max(0, closedIdx - 1)] || nextTabs[0]
          return newActive ? newActive.id : ''
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

  const handleChatDeleted = useCallback((chatId: string) => {
    setTabs((prevTabs) => {
      const deletedTabIds = new Set(
        prevTabs.filter((tab) => tab.chatId === chatId).map((tab) => tab.id)
      )
      if (deletedTabIds.size === 0) return prevTabs

      const nextTabs = prevTabs.filter((tab) => !deletedTabIds.has(tab.id))
      const fallback = nextTabs[0]
      setActiveTabId((activeId) => (deletedTabIds.has(activeId) ? fallback?.id || '' : activeId))
      setVisibleTabIds((visibleIds) => {
        const nextVisibleIds = visibleIds.filter((id) => !deletedTabIds.has(id))
        return nextVisibleIds.length > 0 ? nextVisibleIds : fallback ? [fallback.id] : []
      })
      return nextTabs
    })
    setChatTodos((prev) => {
      if (!(chatId in prev)) return prev
      const next = { ...prev }
      delete next[chatId]
      return next
    })
  }, [])

  const handleCloseOtherTabs = useCallback((keepTabId: string) => {
    setTabs((prevTabs) => {
      const closedTabs = prevTabs.filter((t) => t.id !== keepTabId)
      const hasClosedBrowserTab = closedTabs.some((t) => t.tabType === 'browser')
      if (hasClosedBrowserTab) {
        const isAnyRemainingProcessing = prevTabs
          .filter((t) => t.id === keepTabId)
          .some((t) => t.isProcessing)
        if (isAnyRemainingProcessing) {
          pendingBrowserCloseRef.current = true
        } else {
          window.api.closeBrowser().catch(() => {})
        }
      }
      return prevTabs.filter((t) => t.id === keepTabId)
    })
    setActiveTabId(keepTabId)
    setVisibleTabIds([keepTabId])
  }, [])

  // Close browser session when pending once all AI processing completes
  useEffect(() => {
    const isAnyProcessing = tabs.some((t) => t.isProcessing)
    if (!isAnyProcessing && pendingBrowserCloseRef.current) {
      pendingBrowserCloseRef.current = false
      window.api.closeBrowser().catch(() => {})
    }
  }, [tabs])

  const handleToggleSplitTab = useCallback((tabId: string) => {
    setVisibleTabIds((prevVis) => {
      if (prevVis.includes(tabId)) {
        if (prevVis.length > 1) {
          const nextVis = prevVis.filter((id) => id !== tabId)
          if (activeTabIdRef.current === tabId) {
            const nextActive = nextVis[nextVis.length - 1] || nextVis[0]
            if (nextActive) {
              setActiveTabId(nextActive)
            }
          }
          return nextVis
        }
        return prevVis
      } else {
        if (prevVis.length < 4) {
          const nextVis = [...prevVis, tabId]
          setActiveTabId(tabId)
          return nextVis
        }
        return prevVis
      }
    })
  }, [])

  const handleReorderTabs = useCallback((sourceId: string, targetId: string) => {
    setTabs((prevTabs) => {
      const sourceIdx = prevTabs.findIndex((t) => t.id === sourceId)
      const targetIdx = prevTabs.findIndex((t) => t.id === targetId)
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return prevTabs

      const updated = [...prevTabs]
      const [movedTab] = updated.splice(sourceIdx, 1)
      updated.splice(targetIdx, 0, movedTab)
      return updated
    })
  }, [])

  const handleSwapSplitTabs = useCallback((sourceId: string, targetId: string) => {
    setVisibleTabIds((prevVis) => {
      const sourceIdx = prevVis.indexOf(sourceId)
      const targetIdx = prevVis.indexOf(targetId)
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return prevVis

      const updated = [...prevVis]
      const temp = updated[sourceIdx]
      updated[sourceIdx] = updated[targetIdx]
      updated[targetIdx] = temp
      return updated
    })
  }, [])

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveView('chat')
    setActiveTabId(tabId)
    const targetTab = tabsRef.current.find((t) => t.id === tabId)
    if (targetTab) {
      window.api.setSessionMode(
        targetTab.sessionMode,
        targetTab.sessionMode === 'discipline' || targetTab.sessionMode === 'harness'
          ? targetTab.disciplinePath
          : ''
      )
    }
    setVisibleTabIds((prevVis) => {
      if (!prevVis.includes(tabId)) {
        if (prevVis.length <= 1) {
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
  const handleLoadChat = useCallback(async (chatId: string, workspace: WorkspaceKind = 'chat') => {
    setActiveView(workspace)
    const setWorkspaceTabs = workspace === 'harness' ? setHarnessTabs : setTabs
    const activeWorkspaceTabId =
      workspace === 'harness' ? activeHarnessTabIdRef.current : activeTabIdRef.current
    const setActiveWorkspaceTabId =
      workspace === 'harness' ? setActiveHarnessTabId : setActiveTabId
    try {
      const rawContent =
        workspace === 'harness'
          ? await window.api.loadHarnessSession(chatId)
          : await window.api.loadChat(chatId)
      if (!Array.isArray(rawContent)) return

      const extractMessageText = (c: any): string => {
        if (!c) return ''
        if (typeof c.content === 'string') return c.content
        if (Array.isArray(c.content)) {
          return c.content
            .map((part: any) => {
              if (typeof part === 'string') return part
              if (part && typeof part === 'object') {
                if (part.type === 'text' && typeof part.text === 'string') return part.text
                if (typeof part.text === 'string') return part.text
              }
              return ''
            })
            .filter(Boolean)
            .join('\n')
        }
        if (typeof c.parts === 'string') return c.parts
        if (Array.isArray(c.parts)) {
          return c.parts
            .map((part: any) => {
              if (typeof part === 'string') return part
              if (part && typeof part === 'object' && typeof part.text === 'string')
                return part.text
              return ''
            })
            .filter(Boolean)
            .join('\n')
        }
        return ''
      }

      const extractThoughts = (c: any): string | undefined => {
        if (!c) return undefined
        if (typeof c.thoughts === 'string' && c.thoughts.trim() !== '') return c.thoughts
        if (typeof c.reasoning_content === 'string' && c.reasoning_content.trim() !== '')
          return c.reasoning_content
        if (typeof c.reasoning === 'string' && c.reasoning.trim() !== '') return c.reasoning
        return undefined
      }

      const combineThoughts = (existing?: string, incoming?: string): string | undefined => {
        if (!incoming || incoming.trim() === '') return existing
        if (!existing || existing.trim() === '') return incoming
        const trimmedExisting = existing.trim()
        const trimmedIncoming = incoming.trim()
        if (trimmedIncoming === trimmedExisting) return existing
        if (trimmedIncoming.startsWith(trimmedExisting)) return incoming
        if (trimmedExisting.includes(trimmedIncoming)) return existing
        return `${existing}\n\n${incoming}`
      }

      const combineContent = (existing?: string, incoming?: string): string => {
        if (!incoming || incoming.trim() === '') return existing || ''
        if (!existing || existing.trim() === '') return incoming
        const trimmedExisting = existing.trim()
        const trimmedIncoming = incoming.trim()
        if (trimmedIncoming === trimmedExisting) return existing
        if (trimmedIncoming.startsWith(trimmedExisting)) return incoming
        if (trimmedExisting.includes(trimmedIncoming)) return existing
        return `${existing}\n\n${incoming}`
      }

      const combineThinkingDuration = (
        existing?: number,
        incoming?: number
      ): number | undefined => {
        if (existing === undefined) return incoming
        if (incoming === undefined) return existing
        return existing + incoming
      }

      const combineWorkedDuration = (existing?: number, incoming?: number): number | undefined => {
        if (existing === undefined) return incoming
        if (incoming === undefined) return existing
        return Math.max(existing, incoming)
      }

      const messages: Message[] = []
      const harnessContextMessage = rawContent.find((content: unknown) => {
        if (!content || typeof content !== 'object') return false
        const candidate = content as {
          role?: unknown
          harness_context_snapshot?: { version?: unknown }
        }
        return candidate.role === 'system' && candidate.harness_context_snapshot?.version === 1
      }) as { harness_context_snapshot?: HarnessContextSnapshot } | undefined
      const harnessContextSnapshot = harnessContextMessage?.harness_context_snapshot

      for (let i = 0; i < rawContent.length; i++) {
        const c = rawContent[i]
        if (!c) continue

        const role = c.role

        if (role === 'system' && c.harness_context_snapshot?.version === 1) {
          messages.push({
            role: 'context',
            content: '',
            contextSnapshot: c.harness_context_snapshot as HarnessContextSnapshot
          })
          continue
        }

        // 1. Tool result message (OpenAI format: role === 'tool')
        if (role === 'tool') {
          const toolCallId = c.tool_call_id
          const toolName = c.name
          const toolResult =
            typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '')

          const lastAi = messages
            .slice()
            .reverse()
            .find((m) => m.role === 'ai')
          if (lastAi) {
            if (!lastAi.toolCalls) lastAi.toolCalls = []
            const targetTc = lastAi.toolCalls.find(
              (tc: any) =>
                (toolCallId && tc.id === toolCallId) ||
                (toolName && tc.name === toolName && tc.result === undefined)
            )
            if (targetTc) {
              targetTc.result = toolResult
              targetTc.attachments = Array.isArray(c.tool_attachments)
                ? c.tool_attachments
                : undefined
              targetTc.status = isToolCancelledResult(toolResult)
                ? 'cancelled'
                : isToolErrorResult(toolResult)
                  ? 'error'
                  : 'done'
            } else if (toolName) {
              lastAi.toolCalls.push({
                name: toolName,
                args: {},
                result: toolResult,
                attachments: Array.isArray(c.tool_attachments) ? c.tool_attachments : undefined,
                status: isToolCancelledResult(toolResult)
                  ? 'cancelled'
                  : isToolErrorResult(toolResult)
                    ? 'error'
                    : 'done'
              })
            }
          }
          continue
        }

        const rawText = extractMessageText(c)

        // 2. Tag-based tool execution result (role === 'user' starting with "Tool Execution Result for ")
        if (role === 'user' && rawText.startsWith('Tool Execution Result for ')) {
          const lastAi = messages
            .slice()
            .reverse()
            .find((m) => m.role === 'ai')
          if (lastAi) {
            if (!lastAi.toolCalls) lastAi.toolCalls = []
            const emptyTc = lastAi.toolCalls.find((tc) => tc.result === undefined)
            const toolOutput = rawText.replace(/^Tool Execution Result for [^\n]+:\n?/, '')
            if (emptyTc) {
              emptyTc.result = toolOutput
              emptyTc.status = isToolErrorResult(toolOutput) ? 'error' : 'done'
            }
          }
          continue
        }

        // 3. User Message
        if (role === 'user') {
          if (c.hidden || c.isSystemNotification || rawText.startsWith('[SYSTEM NOTIFICATION:')) {
            continue
          }

          let quote: string | undefined =
            typeof c.quote === 'string' && c.quote.trim() ? c.quote.trim() : undefined
          let displayText = rawText
            .replace(/^\[FORCE_SEARCH\]\s*/i, '')
            .replace(/<attached_file[^>]*\/>/gi, '')
            .trim()

          // Backward compatibility: If no explicit quote property exists, check if text starts with markdown blockquote
          if (!quote && displayText.startsWith('> ')) {
            const quoteMatch = displayText.match(/^> ([\s\S]*?)\n\n([\s\S]*)$/)
            if (quoteMatch) {
              quote = quoteMatch[1].replace(/\n> /g, '\n').trim()
              displayText = quoteMatch[2].trim()
            }
          }

          let screenshot: string | undefined = undefined
          let file: AttachedFile | undefined = undefined

          const persistedImage = Array.isArray(c.image_attachments)
            ? c.image_attachments.find(
                (attachment: {
                  kind?: unknown
                  mimeType?: unknown
                  data?: unknown
                  name?: unknown
                }) =>
                  attachment?.kind === 'image' &&
                  typeof attachment.mimeType === 'string' &&
                  typeof attachment.data === 'string'
              )
            : undefined
          if (persistedImage) {
            screenshot = `data:${persistedImage.mimeType};base64,${persistedImage.data}`
            file = {
              name:
                typeof persistedImage.name === 'string' ? persistedImage.name : 'Attached image',
              mimeType: persistedImage.mimeType,
              data: persistedImage.data
            }
          }

          if (!screenshot && Array.isArray(c.content)) {
            for (const part of c.content) {
              if (part && typeof part === 'object' && part.type === 'image_url') {
                screenshot = part.image_url?.url
              }
            }
          } else if (Array.isArray(c.parts)) {
            for (const part of c.parts) {
              if (part && typeof part === 'object' && part.inlineData) {
                screenshot = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
              }
            }
          }

          messages.push({
            role: 'user',
            content: displayText,
            quote,
            screenshot,
            file
          })
          continue
        }

        // 4. Assistant / AI Message
        if (role === 'assistant' || role === 'model' || role === 'ai') {
          const thoughts = extractThoughts(c)
          const thinkingDuration =
            typeof c.thinking_duration === 'number'
              ? c.thinking_duration
              : typeof c.thinkingDuration === 'number'
                ? c.thinkingDuration
                : undefined

          const workedDuration =
            typeof c.worked_duration === 'number'
              ? c.worked_duration
              : typeof c.workedDuration === 'number'
                ? c.workedDuration
                : undefined

          const rawToolCalls = Array.isArray(c.tool_calls)
            ? c.tool_calls
            : Array.isArray(c.toolCalls)
              ? c.toolCalls
              : []

          const toolCalls: (ToolCallItem & { id?: string })[] = rawToolCalls.map((tc: any) => {
            const name = tc.function?.name || tc.name || ''
            let args: Record<string, unknown> = {}
            if (typeof tc.function?.arguments === 'string') {
              try {
                const parsed = JSON.parse(tc.function.arguments) as unknown
                args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
              } catch {
                args = { raw: tc.function.arguments }
              }
            } else if (typeof tc.args === 'string') {
              try {
                const parsed = JSON.parse(tc.args) as unknown
                args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
              } catch {
                args = { raw: tc.args }
              }
            } else if (tc.args && typeof tc.args === 'object' && !Array.isArray(tc.args)) {
              args = tc.args as Record<string, unknown>
            }

            let result: string | undefined = undefined
            let attachments: ToolCallItem['attachments'] = undefined
            if (tc.id) {
              const toolMsg = rawContent.find(
                (m: any) => m.role === 'tool' && m.tool_call_id === tc.id
              )
              if (toolMsg) {
                result =
                  typeof toolMsg.content === 'string'
                    ? toolMsg.content
                    : JSON.stringify(toolMsg.content || '')
                attachments = Array.isArray(toolMsg.tool_attachments)
                  ? toolMsg.tool_attachments
                  : undefined
              }
            }

            return {
              id: tc.id,
              name,
              args,
              result,
              attachments,
              status: result
                ? isToolCancelledResult(result)
                  ? 'cancelled'
                  : isToolErrorResult(result)
                    ? 'error'
                    : 'done'
                : 'done'
            }
          })

          // Check for tag-based tool calls inside content [PRISM_EXECUTE_TOOL]
          const tagMatches = Array.from(
            rawText.matchAll(/\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/g)
          )
          for (const match of tagMatches) {
            try {
              const toolData = JSON.parse(match[1])
              const toolName = toolData.type || toolData.name || 'tool'
              delete toolData.type
              delete toolData.name

              const alreadyInList = toolCalls.some((tc) => tc.name === toolName)
              if (!alreadyInList) {
                toolCalls.push({
                  name: toolName,
                  args: toolData,
                  status: 'done'
                })
              }
            } catch {
              /* ignore parse errors */
            }
          }

          const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
          const shouldStartHarnessSegment =
            workspace === 'harness' && lastMsg?.role === 'ai' && Boolean(lastMsg.toolCalls?.length)
          if (lastMsg && lastMsg.role === 'ai' && !shouldStartHarnessSegment) {
            // Merge into existing AI message for this prompt turn
            lastMsg.content = combineContent(lastMsg.content, rawText)
            lastMsg.thoughts = combineThoughts(lastMsg.thoughts, thoughts)
            lastMsg.thinkingDuration = combineThinkingDuration(
              lastMsg.thinkingDuration,
              thinkingDuration
            )
            lastMsg.workedDuration = combineWorkedDuration(lastMsg.workedDuration, workedDuration)
            if (toolCalls.length > 0) {
              if (!lastMsg.toolCalls) {
                lastMsg.toolCalls = toolCalls
              } else {
                for (const tc of toolCalls) {
                  const exists = lastMsg.toolCalls.some(
                    (existingTc) =>
                      (tc.id && existingTc.id === tc.id) ||
                      (existingTc.name === tc.name &&
                        JSON.stringify(existingTc.args) === JSON.stringify(tc.args))
                  )
                  if (!exists) {
                    lastMsg.toolCalls.push(tc)
                  }
                }
              }
            }
          } else {
            // Create new AI message for this prompt turn
            messages.push({
              role: 'ai',
              content: rawText,
              thoughts,
              thinkingDuration,
              workedDuration,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              isStreaming: false,
              isThinking: false
            })
          }
        }
      }

      const chats =
        workspace === 'harness'
          ? await window.api.getHarnessSessions()
          : await window.api.getChats()
      const historyItem = chats.find((item) => item.id === chatId)
      const title = historyItem?.title || 'Chat'
      const loadedMode: SessionMode = workspace === 'harness' ? 'harness' : historyItem?.sessionMode || 'execution'
      const loadedDisciplinePath: string =
        loadedMode === 'discipline' || loadedMode === 'harness'
          ? historyItem?.disciplinePath || ''
          : ''
      const loadedDisabledSkills = historyItem?.disabledSkills

      setWorkspaceTabs((prevTabs) => {
        if (prevTabs.length === 0) {
          const newId = `tab-${Date.now()}`
          const newTab: TabSession = {
            id: newId,
            chatId,
            title,
            messages,
            inputText: '',
            attachedFile: null,
            sessionMode: loadedMode,
            disciplinePath: loadedDisciplinePath,
            isProcessing: false,
            isTodoOpen: false,
            selectedModel: selectedModelRef.current,
            isSearchEnabled: false,
            disabledSkills: loadedDisabledSkills,
            harnessContextSnapshot
          }
          setActiveWorkspaceTabId(newId)
          if (workspace === 'chat') setVisibleTabIds([newId])
          return [newTab]
        }
        return prevTabs.map((t) => {
          if (t.id === activeWorkspaceTabId) {
            return {
              ...t,
              chatId,
              title,
              messages,
              sessionMode: loadedMode,
              disciplinePath: loadedDisciplinePath,
              disabledSkills: loadedDisabledSkills,
              harnessContextSnapshot
            }
          }
          return t
        })
      })

      if (workspace === 'chat') window.api.setSessionMode(loadedMode, loadedDisciplinePath)

      const todo = await window.api.getTodoForChat(chatId)
      if (todo) {
        setChatTodos((prev) => ({ ...prev, [chatId]: todo }))
      }

      const processes = await window.api.getTerminalProcessesForChat(chatId)
      setTerminalProcesses((prev) => ({ ...prev, [chatId]: processes }))

      if (window.api?.getArtifactsForChat) {
        const artifacts = await window.api.getArtifactsForChat(chatId)
        if (artifacts && artifacts.length > 0) {
          setWorkspaceTabs((prevTabs) =>
            prevTabs.map((t) => (t.id === activeWorkspaceTabId ? { ...t, artifacts } : t))
          )
        }
      }
    } catch (e) {
      console.error('Failed to load chat:', e)
    }
  }, [])

  const handleLoadHarnessSession = useCallback(
    (chatId: string): void => {
      void handleLoadChat(chatId, 'harness')
    },
    [handleLoadChat]
  )

  useEffect(() => {
    if (!window.api?.onArtifactsUpdate) {
      return
    }
    return window.api.onArtifactsUpdate(({ chatId, artifacts }) => {
      setTabs((prevTabs) => prevTabs.map((t) => (t.chatId === chatId ? { ...t, artifacts } : t)))
      setHarnessTabs((prevTabs) =>
        prevTabs.map((t) => (t.chatId === chatId ? { ...t, artifacts } : t))
      )
    })
  }, [])

  interface SendMessageOptions {
    file?: AttachedFile | null
    overrideModel?: string
    overrideSessionMode?: SessionMode
    forceYoutube?: boolean
    isSuggestion?: boolean
  }

  const sendMessageToTab = useCallback(
    (targetTabId: string, text: string, options: SendMessageOptions = {}): boolean => {
      const currentTab = tabsRef.current.find((tab) => tab.id === targetTabId)
      if (!currentTab || currentTab.isProcessing || !isOnlineRef.current || !text.trim()) {
        return false
      }

      const isSuggestion = options.isSuggestion === true
      const chatId = currentTab.chatId || Date.now().toString()
      const activeFile = isSuggestion ? undefined : options.file || currentTab.attachedFile
      const activeQuote = isSuggestion
        ? undefined
        : currentTab.quotedText || quotedTextRef.current || undefined
      const activeScreenshot = activeFile?.mimeType.startsWith('image/')
        ? activeFile.data.startsWith('data:')
          ? activeFile.data
          : `data:${activeFile.mimeType};base64,${activeFile.data}`
        : undefined
      const displayContent = text
        .replace(/<attached_file[^>]*\/>/gi, '')
        .replace(/^\[FORCE_SEARCH\]\s*/i, '')
        .trim()
      const userMessage: Message = {
        role: 'user',
        content: displayContent,
        quote: activeQuote,
        screenshot: activeScreenshot || undefined,
        file: activeFile || undefined
      }

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== targetTabId) return tab

          const updatedTab = {
            ...tab,
            chatId,
            isProcessing: true,
            messages: [...tab.messages, userMessage]
          }

          return isSuggestion
            ? updatedTab
            : {
                ...updatedTab,
                inputText: '',
                quotedText: null,
                attachedFile: null,
                isSearchEnabled: false
              }
        })
      )
      setRunningChats((prev) => ({ ...prev, [chatId]: true }))

      let apiMessage = text
      if (!isSuggestion && activeFile && !activeFile.mimeType.startsWith('image/')) {
        apiMessage = `<attached_file name="${activeFile.name}" mime="${activeFile.mimeType}" /> ${apiMessage}`
      }
      if (!isSuggestion && currentTab.isSearchEnabled && !apiMessage.startsWith('[FORCE_SEARCH]')) {
        apiMessage = `[FORCE_SEARCH] ${apiMessage}`
      }

      const sessionMode = options.overrideSessionMode || currentTab.sessionMode
      const modelKey = options.overrideModel || currentTab.selectedModel
      window.api.sendChatMessage({
        message: apiMessage,
        chatId,
        attachedFile: activeFile || undefined,
        quote: activeQuote,
        appMode: options.forceYoutube ? 'youtube' : undefined,
        sessionMode,
        disciplinePath:
          sessionMode === 'discipline' || sessionMode === 'harness'
            ? currentTab.disciplinePath
            : '',
        modelKey,
        reasoningLevel: getReasoningLevelForModel(modelKey),
        disabledSkills: currentTab.disabledSkills ?? config?.disabledSkills ?? []
      })

      if (!isSuggestion) {
        setQuotedText(null)
        setActiveWorkflow(null)
      }
      return true
    },
    []
  )

  const sendHarnessMessageToTab = useCallback(
    (
      targetTabId: string,
      text: string,
      options: { file?: AttachedFile | null; isSuggestion?: boolean } = {}
    ): boolean => {
      const currentTab = harnessTabsRef.current.find((tab) => tab.id === targetTabId)
      if (!currentTab || currentTab.isProcessing || !isOnlineRef.current || !text.trim()) {
        return false
      }
      if (!currentTab.disciplinePath) {
        setHarnessProjectTargetTabId(targetTabId)
        setIsHarnessProjectModalOpen(true)
        return false
      }

      const isSuggestion = options.isSuggestion === true
      const chatId = currentTab.chatId || `harness-${Date.now()}`
      const activeFile = isSuggestion ? undefined : options.file || currentTab.attachedFile
      const activeQuote = isSuggestion
        ? undefined
        : currentTab.quotedText || quotedTextRef.current || undefined
      const displayContent = text.replace(/<attached_file[^>]*\/>/gi, '').trim()
      const userMessage: Message = {
        role: 'user',
        content: displayContent,
        quote: activeQuote,
        file: activeFile || undefined,
        screenshot: activeFile?.mimeType.startsWith('image/')
          ? activeFile.data.startsWith('data:')
            ? activeFile.data
            : `data:${activeFile.mimeType};base64,${activeFile.data}`
          : undefined
      }

      setHarnessTabs((previous) =>
        previous.map((tab) => {
          if (tab.id !== targetTabId) return tab
          const updated = {
            ...tab,
            chatId,
            workspace: 'harness' as const,
            sessionMode: 'harness' as const,
            isProcessing: true,
            messages: [...tab.messages, userMessage]
          }
          return isSuggestion
            ? updated
            : { ...updated, inputText: '', quotedText: null, attachedFile: null }
        })
      )
      setRunningChats((previous) => ({ ...previous, [chatId]: true }))
      harnessChatIdsRef.current.add(chatId)
      window.api.sendHarnessMessage({
        message: text,
        chatId,
        projectPath: currentTab.disciplinePath,
        attachedFile: activeFile || undefined,
        quote: activeQuote,
        modelKey: currentTab.selectedModel,
        reasoningLevel: getReasoningLevelForModel(currentTab.selectedModel)
      })
      if (!isSuggestion) {
        setQuotedText(null)
        setActiveWorkflow(null)
      }
      return true
    },
    []
  )

  const handleHarnessSend = useCallback(
    (text: string, file?: AttachedFile | null): void => {
      sendHarnessMessageToTab(activeHarnessTabIdRef.current, text, { file })
    },
    [sendHarnessMessageToTab]
  )

  const handleHarnessSuggestionSend = useCallback(
    (tabId: string, payload: string): boolean =>
      sendHarnessMessageToTab(tabId, payload, { isSuggestion: true }),
    [sendHarnessMessageToTab]
  )

  // Sending message logic for the active tab.
  const handleSend = useCallback(
    (
      text: string,
      file?: AttachedFile | null,
      overrideModel?: string,
      overrideSessionMode?: SessionMode,
      forceYoutube?: boolean
    ): void => {
      sendMessageToTab(activeTabIdRef.current, text, {
        file,
        overrideModel,
        overrideSessionMode,
        forceYoutube
      })
    },
    [sendMessageToTab]
  )

  const handleSuggestionSend = useCallback(
    (tabId: string, payload: string, _suggestionKey: string): boolean =>
      sendMessageToTab(tabId, payload, { isSuggestion: true }),
    [sendMessageToTab]
  )

  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

  const handleModelChange = useCallback(
    (modelKey: string) => {
      const isArcadia11 =
        modelKey === 'prism-ai/arcadia-1.1-flash' ||
        modelKey === 'arcadia-1.1-flash' ||
        modelKey.includes('arcadia-1.1-flash')

      if (isArcadia11 && !isEnterpriseUser) {
        setIsPlansModalOpen(true)
        return
      }

      setSelectedModel(modelKey)
      window.api.setModel(modelKey)
      setTabs((prev) => prev.map((t) => ({ ...t, selectedModel: modelKey })))
      window.api.saveConfig({ lastSelectedChatModel: modelKey })
    },
    [isEnterpriseUser]
  )

  const handleHarnessModelChange = useCallback(
    (tabId: string, modelKey: string): void => {
      const isArcadia11 =
        modelKey === 'prism-ai/arcadia-1.1-flash' ||
        modelKey === 'arcadia-1.1-flash' ||
        modelKey.includes('arcadia-1.1-flash')

      if (isArcadia11 && !isEnterpriseUser) {
        setIsPlansModalOpen(true)
        return
      }

      setHarnessTabs((previous) =>
        previous.map((tab) => (tab.id === tabId ? { ...tab, selectedModel: modelKey } : tab))
      )
    },
    [isEnterpriseUser]
  )

  const handleHarnessPermissionModeChange = useCallback(
    (tabId: string, permissionMode: HarnessPermissionMode): void => {
      const tab = harnessTabsRef.current.find((entry) => entry.id === tabId)
      if (!tab?.disciplinePath) {
        setHarnessProjectTargetTabId(tabId)
        setIsHarnessProjectModalOpen(true)
        return
      }
      if (permissionMode === 'yolo' && !config?.harness.yoloAcknowledged) {
        setHarnessPromptWarnings([
          'Acknowledge the YOLO risk in Settings > Harness before enabling it for this project.'
        ])
        setSettingsInitialSection('harness')
        setIsSettingsModalOpen(true)
        return
      }

      void window.api
        .updateHarnessProject(tab.disciplinePath, { permissionMode })
        .then(() => window.api.getConfig())
        .then((nextConfig) => setConfig(nextConfig))
        .catch((error) => {
          setHarnessPromptWarnings([
            `Could not update the Harness permission profile: ${
              error instanceof Error ? error.message : String(error)
            }`
          ])
        })
    },
    [config?.harness.yoloAcknowledged]
  )

  const handleToggleSearch = useCallback((tabId: string, enabled?: boolean) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, isSearchEnabled: enabled !== undefined ? enabled : !t.isSearchEnabled }
          : t
      )
    )
  }, [])

  const getReasoningLevelForModel = useCallback(
    (modelKey: string) => {
      if (!isPrismCloudGeminiModel(modelKey)) return 'off'
      if (!config?.modelReasoningLevels) return 'minimal'
      const cleanKey = modelKey.replace('prism_provider:', '')
      return (
        config.modelReasoningLevels[modelKey] ||
        config.modelReasoningLevels[cleanKey] ||
        getDefaultThinkingLevelForModel(modelKey)
      )
    },
    [config]
  )

  const handleReasoningLevelChange = useCallback(
    async (modelKey: string, level: string) => {
      if (!isPrismCloudGeminiModel(modelKey)) return
      const updatedLevels = {
        ...(config?.modelReasoningLevels || {}),
        [modelKey]: level
      }
      setConfig((prev) => (prev ? { ...prev, modelReasoningLevels: updatedLevels } : prev))
      await window.api.saveConfig({ modelReasoningLevels: updatedLevels })
    },
    [config]
  )

  // Keyboard shortcut listener for new chat / new tab & close tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return
      const shortcutStr = config?.newChatShortcut || 'CmdOrCtrl+N'
      if (isShortcutPressed(e, shortcutStr)) {
        e.preventDefault()
        if (activeView === 'harness') {
          void handleNewHarnessTab()
        } else {
          handleNewChat()
        }
        return
      }
      if (isShortcutPressed(e, 'CmdOrCtrl+W') || isShortcutPressed(e, 'Ctrl+W')) {
        e.preventDefault()
        if (activeView === 'harness' && activeHarnessTabIdRef.current) {
          handleCloseHarnessTab(activeHarnessTabIdRef.current)
        } else if (activeTabIdRef.current) {
          handleCloseTab(activeTabIdRef.current)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    activeView,
    handleNewChat,
    handleNewHarnessTab,
    handleCloseTab,
    handleCloseHarnessTab,
    config?.newChatShortcut
  ])

  // IPC Event Listener for close tab shortcut (Ctrl+W / Cmd+W from main process)
  useEffect(() => {
    if (!window.api?.onCloseTabShortcut) return
    const removeListener = window.api.onCloseTabShortcut(() => {
      if (activeTabIdRef.current) {
        handleCloseTab(activeTabIdRef.current)
      }
    })
    return () => removeListener()
  }, [handleCloseTab])

  // Refs used to batch rapid onChatChunk events into a single React re-render
  // per animation frame, preventing excessive GC pressure during heavy streaming.
  const pendingChunkRef = useRef<
    Parameters<Parameters<typeof window.api.onChatChunk>[0]>[0] | null
  >(null)
  const rafIdRef = useRef<number | null>(null)

  // IPC Event Listeners for background stream updates
  useEffect(() => {
    const setTabsForChat = (chatId: string) =>
      harnessChatIdsRef.current.has(chatId) ? setHarnessTabs : setTabs

    const removeChatStartListener = window.api.onChatStart((data) => {
      const { chatId } = data
      setRunningChats((prev) => ({ ...prev, [chatId]: true }))
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prev) =>
        prev.map((t) => {
          if (t.chatId === chatId || (t.id === activeTabIdRef.current && !t.chatId)) {
            const msgs = [...t.messages]
            const lastMsg = msgs[msgs.length - 1]
            if (!lastMsg || lastMsg.role !== 'ai' || !lastMsg.isStreaming) {
              msgs.push({
                role: 'ai',
                content: '',
                thoughts: '',
                isStreaming: true,
                isThinking: false,
                thinkingStartTime: undefined,
                workStartTime: Date.now(),
                isConnecting: true,
                toolCalls: []
              })
            }
            return { ...t, chatId, messages: msgs, isProcessing: true }
          }
          return t
        })
      )
    })

    const flushChunk = (
      data: Parameters<Parameters<typeof window.api.onChatChunk>[0]>[0]
    ): void => {
      const harnessChunk = data as typeof data & {
        harnessRound?: number
        harnessRoundContent?: string
        harnessRoundThoughts?: string
      }
      const {
        chatId,
        thoughts,
        finalResponse,
        isThinking,
        isWritingToolCall,
        toolType,
        streamingToolCalls
      } = data
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
            const isHarness = tab.sessionMode === 'harness'
            const displayContent =
              isHarness && harnessChunk.harnessRoundContent !== undefined
                ? harnessChunk.harnessRoundContent
                : finalResponse
            const displayThoughts =
              isHarness && harnessChunk.harnessRoundThoughts !== undefined
                ? harnessChunk.harnessRoundThoughts
                : thoughts
            let lastMsgIndex = newMessages.length - 1
            let lastMsg = newMessages[lastMsgIndex]

            if (
              isHarness &&
              lastMsg?.role === 'ai' &&
              hasHarnessActivity(lastMsg) &&
              Boolean(displayContent.trim() || displayThoughts?.trim())
            ) {
              newMessages[lastMsgIndex] = {
                ...lastMsg,
                isStreaming: false,
                isThinking: false,
                isWritingToolCall: false,
                isConnecting: false
              }
              newMessages.push(createHarnessTextMessage())
              lastMsgIndex = newMessages.length - 1
              lastMsg = newMessages[lastMsgIndex]
            }

            if (lastMsg && lastMsg.role === 'ai') {
              let updatedToolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []

              if (updatedToolCalls.some((t) => t.status === 'running' && t.result !== undefined)) {
                updatedToolCalls = updatedToolCalls.map((tc) => {
                  if (tc.status === 'running' && tc.result !== undefined) {
                    return {
                      ...tc,
                      status: isToolErrorResult(tc.result) ? 'error' : 'done'
                    }
                  }
                  return tc
                })
              }

              const workStartTime = lastMsg.workStartTime || Date.now()
              const currentWorkedDuration = Math.max(
                1,
                Math.round((Date.now() - workStartTime) / 1000)
              )

              let duration = lastMsg.thinkingDuration
              let startTime = lastMsg.thinkingStartTime

              if (isThinking && !startTime) {
                startTime = Date.now()
              } else if (!isThinking && lastMsg.isThinking && startTime) {
                const roundDur = Math.max(1, Math.round((Date.now() - startTime) / 1000))
                duration = (duration || 0) + roundDur
                startTime = undefined
              }

              newMessages[lastMsgIndex] = {
                ...lastMsg,
                thoughts: displayThoughts,
                content: displayContent,
                isThinking,
                thinkingStartTime: startTime,
                thinkingDuration: duration,
                workStartTime,
                workedDuration: currentWorkedDuration,
                isWritingToolCall,
                toolType,
                streamingToolCalls: isHarness ? lastMsg.streamingToolCalls : streamingToolCalls,
                isConnecting: false,
                toolCalls: updatedToolCalls
              }
            }
            return {
              ...tab,
              messages: newMessages,
              isProcessing: true
            }
          }
          return tab
        })
      )
    }

    const flushPendingChunk = (chatId?: string): void => {
      const pendingData = pendingChunkRef.current
      if (!pendingData || (chatId && pendingData.chatId !== chatId)) return
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      pendingChunkRef.current = null
      flushChunk(pendingData)
    }

    // Batch rapid chunk events into a single state update per animation frame.
    // During fast streaming, multiple IPC events fire per frame; batching ensures
    // we only pay the React re-render cost once per frame.
    const removeChatChunkListener = window.api.onChatChunk((data) => {
      // Always keep the latest chunk (most complete state) as pending
      pendingChunkRef.current = data

      // Schedule a flush if one isn't already pending
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          const pendingData = pendingChunkRef.current
          if (pendingData) {
            pendingChunkRef.current = null
            flushChunk(pendingData)
          }
        })
      }
    })

    const removeChatEndListener = window.api.onChatEnd((data) => {
      // Flush any pending chunk before processing end-of-stream,
      // then cancel the RAF so a stale chunk can't overwrite the final state.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      const pendingData = pendingChunkRef.current
      if (pendingData) {
        pendingChunkRef.current = null
        flushChunk(pendingData)
      }

      const harnessEnd = data as typeof data & {
        harnessRoundContent?: string
        harnessRoundThoughts?: string
      }
      const {
        chatId,
        thoughts,
        finalResponse,
        thinkingDuration: eventDuration,
        workedDuration: eventWorkedDuration
      } = data as typeof data & { workedDuration?: number }
      setRunningChats((prev) => {
        const next = { ...prev }
        delete next[chatId]
        return next
      })
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
            const isHarness = tab.sessionMode === 'harness'
            const finalContent =
              isHarness && harnessEnd.harnessRoundContent !== undefined
                ? harnessEnd.harnessRoundContent
                : finalResponse
            const finalThoughts =
              isHarness && harnessEnd.harnessRoundThoughts !== undefined
                ? harnessEnd.harnessRoundThoughts
                : thoughts
            let lastMsgIndex = newMessages.length - 1
            let lastMsg = newMessages[lastMsgIndex]

            if (
              isHarness &&
              lastMsg?.role === 'ai' &&
              hasHarnessActivity(lastMsg) &&
              Boolean(finalContent.trim() || finalThoughts?.trim())
            ) {
              newMessages[lastMsgIndex] = {
                ...lastMsg,
                isStreaming: false,
                isThinking: false,
                isWritingToolCall: false,
                isConnecting: false
              }
              newMessages.push(createHarnessTextMessage())
              lastMsgIndex = newMessages.length - 1
              lastMsg = newMessages[lastMsgIndex]
            }

            if (lastMsg && lastMsg.role === 'ai') {
              let promotedToolCalls = lastMsg.toolCalls || []
              if (lastMsg.streamingToolCalls && lastMsg.streamingToolCalls.length > 0) {
                const completedStreaming = lastMsg.streamingToolCalls.filter(
                  (stc) => stc.isComplete && stc.name
                )
                for (const stc of completedStreaming) {
                  const alreadyExists = promotedToolCalls.some(
                    (tc) =>
                      tc.name === stc.name && (tc.status === 'running' || tc.status === 'done')
                  )
                  if (!alreadyExists) {
                    let parsedArgs: Record<string, unknown> = {}
                    try {
                      const parsed = JSON.parse(stc.arguments) as unknown
                      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        parsedArgs = parsed as Record<string, unknown>
                      }
                    } catch {
                      /* ignore */
                    }
                    promotedToolCalls = [
                      ...promotedToolCalls,
                      {
                        name: stc.name,
                        args: parsedArgs,
                        status: 'running' as const
                      }
                    ]
                  }
                }
              }

              promotedToolCalls = promotedToolCalls.map((tc) => {
                if (tc.status === 'running') {
                  return {
                    ...tc,
                    status: isToolErrorResult(tc.result) ? 'error' : 'done'
                  }
                }
                return tc
              })

              let duration = eventDuration !== undefined ? eventDuration : lastMsg.thinkingDuration
              if (duration === undefined && lastMsg.thinkingStartTime) {
                const roundDur = Math.max(
                  1,
                  Math.round((Date.now() - lastMsg.thinkingStartTime) / 1000)
                )
                duration = (lastMsg.thinkingDuration || 0) + roundDur
              }

              const workStartTime = lastMsg.workStartTime || Date.now()
              let finalWorkedDuration =
                eventWorkedDuration !== undefined
                  ? eventWorkedDuration
                  : lastMsg.workedDuration !== undefined
                    ? lastMsg.workedDuration
                    : Math.max(1, Math.round((Date.now() - workStartTime) / 1000))

              newMessages[lastMsgIndex] = {
                ...lastMsg,
                thoughts: finalThoughts,
                content: finalContent,
                isStreaming: false,
                isThinking: false,
                thinkingDuration: duration,
                workedDuration: finalWorkedDuration,
                isWritingToolCall: false,
                isConnecting: false,
                toolCalls: promotedToolCalls,
                streamingToolCalls: undefined
              }
            }
            return {
              ...tab,
              messages: newMessages,
              isProcessing: false
            }
          }
          return tab
        })
      )
    })

    const removeChatErrorListener = window.api.onChatError((data) => {
      const { error, chatId } = data
      setRunningChats((prev) => {
        const next = { ...prev }
        delete next[chatId]
        return next
      })
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prevTabs) =>
        prevTabs.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
            const lastMsgIndex = newMessages.length - 1
            const lastMsg = newMessages[lastMsgIndex]
            const isCancel = error.includes('cancelled')

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
              const lowerErr = error.toLowerCase()
              const isPrismCloudError =
                lowerErr.includes('prism cloud') ||
                lowerErr.includes('prism provider') ||
                lowerErr.includes('prism_provider')

              const isAccountInactive =
                lowerErr.includes('account_inactive') ||
                lowerErr.includes('require an active account') ||
                lowerErr.includes('activate your account')

              const isQuotaExceeded =
                !isAccountInactive &&
                isPrismCloudError &&
                (lowerErr.includes('quota') ||
                  lowerErr.includes('limit reached') ||
                  lowerErr.includes('429') ||
                  lowerErr.includes('rate limit'))

              let separatorContent: string
              if (isAccountInactive) {
                setIsProfileModalOpen(true)
                separatorContent =
                  'Account Activation Required: Prism Cloud models require an active account. Please activate your account in Profile Settings.'
              } else if (isQuotaExceeded) {
                setIsQuotaModalOpen(true)
                separatorContent =
                  'Prism Cloud Quota Exceeded: Your Prism Cloud request limit has been reached. Please wait for the reset window or switch to a custom API key in Settings.'
              } else if (
                error.startsWith('API Error') ||
                error.startsWith('Provider API Error') ||
                isPrismCloudError
              ) {
                separatorContent = error
              } else {
                const apiErrorMatch = error.match(/^API_KEY_ERROR:(\d{3}):(.+)$/)
                if (apiErrorMatch) {
                  separatorContent = `API key error: ${apiErrorMatch[1]} ${apiErrorMatch[2]}`
                } else {
                  const httpMatch = error.match(/(\d{3})\s+(.*)/)
                  if (httpMatch) {
                    separatorContent = `API Error: ${httpMatch[1]} ${httpMatch[2].trim()}`
                  } else {
                    separatorContent = error || 'Error communicating with AI provider.'
                  }
                }
              }
              newMessages.push({
                role: 'separator',
                separatorType: 'error',
                content: separatorContent
              })
            }

            return { ...tab, messages: newMessages, isProcessing: false }
          }
          return tab
        })
      )
    })

    const removeToolCallDeltaListener = window.api.onToolCallDelta((data) => {
      const { chatId, index, id, name, argsDelta } = data
      // Preserve a provider's textual preface when text and tool deltas arrive
      // in the same animation frame. This keeps the Harness chronology textual.
      flushPendingChunk(chatId)
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prev) =>
        prev.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
            let lastMsgIndex = newMessages.findLastIndex((msg) => msg.role === 'ai')
            let lastMsg = lastMsgIndex !== -1 ? newMessages[lastMsgIndex] : undefined
            if (
              tab.sessionMode === 'harness' &&
              lastMsg?.role === 'ai' &&
              !hasHarnessActivity(lastMsg) &&
              hasHarnessTextOrThinking(lastMsg)
            ) {
              newMessages[lastMsgIndex] = {
                ...lastMsg,
                isStreaming: false,
                isThinking: false,
                isWritingToolCall: false,
                isConnecting: false
              }
              newMessages.push(createHarnessActivityMessage())
              lastMsgIndex = newMessages.length - 1
              lastMsg = newMessages[lastMsgIndex]
            }
            if (lastMsgIndex !== -1) {
              const lastMsg = { ...newMessages[lastMsgIndex] }
              const streamingToolCalls = lastMsg.streamingToolCalls
                ? [...lastMsg.streamingToolCalls]
                : []
              const existingIdx = streamingToolCalls.findIndex((stc) => stc.index === index)
              if (existingIdx !== -1) {
                streamingToolCalls[existingIdx] = {
                  ...streamingToolCalls[existingIdx],
                  id: id || streamingToolCalls[existingIdx].id,
                  name: name || streamingToolCalls[existingIdx].name,
                  arguments: streamingToolCalls[existingIdx].arguments + (argsDelta || '')
                }
              } else {
                streamingToolCalls.push({
                  index,
                  id,
                  name: name || 'task',
                  arguments: argsDelta || '',
                  isComplete: false
                })
              }

              let toolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []
              if (toolCalls.some((t) => t.status === 'running' && t.result !== undefined)) {
                toolCalls = toolCalls.map((tc) => {
                  if (tc.status === 'running' && tc.result !== undefined) {
                    return {
                      ...tc,
                      status: isToolErrorResult(tc.result) ? 'error' : 'done'
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
            }
            return { ...tab, messages: newMessages }
          }
          return tab
        })
      )
    })

    const removeToolStartListener = window.api.onToolStart((data) => {
      const { chatId } = data
      flushPendingChunk(chatId)
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prev) => {
        let newTabs = prev.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
            const existingMsgIndex = newMessages.findLastIndex(
              (msg) =>
                msg.role === 'ai' && msg.toolCalls?.some((toolCall) => toolCall.id === data.callId)
            )
            let targetMsgIndex =
              existingMsgIndex !== -1
                ? existingMsgIndex
                : newMessages.findLastIndex((msg) => msg.role === 'ai')
            const targetMessage =
              targetMsgIndex !== -1 ? newMessages[targetMsgIndex] : undefined
            if (
              tab.sessionMode === 'harness' &&
              existingMsgIndex === -1 &&
              targetMessage?.role === 'ai' &&
              !hasHarnessActivity(targetMessage) &&
              hasHarnessTextOrThinking(targetMessage)
            ) {
              newMessages[targetMsgIndex] = {
                ...targetMessage,
                isStreaming: false,
                isThinking: false,
                isWritingToolCall: false,
                isConnecting: false
              }
              newMessages.push(createHarnessActivityMessage())
              targetMsgIndex = newMessages.length - 1
            }
            if (targetMsgIndex !== -1) {
              const lastMsg = { ...newMessages[targetMsgIndex] }
              lastMsg.toolCalls = applyToolCallStart(lastMsg.toolCalls || [], data)
              if (lastMsg.streamingToolCalls?.length) {
                const remainingStreamingCalls = lastMsg.streamingToolCalls.filter((call) =>
                  call.id ? call.id !== data.callId : call.name !== data.name
                )
                lastMsg.streamingToolCalls =
                  remainingStreamingCalls.length > 0 ? remainingStreamingCalls : undefined
              }
              newMessages[targetMsgIndex] = lastMsg
            }
            return { ...tab, messages: newMessages }
          }
          return tab
        })

        // Auto-create non-splitted background AI Browser tab if browser tool starts and no browser tab exists yet
        if (BROWSER_TOOL_NAMES.has(data.name)) {
          const sourceTab = newTabs.find((t) => t.chatId === chatId)
          if (sourceTab) {
            const existingBrowserTab = newTabs.find((t) => t.tabType === 'browser')
            if (existingBrowserTab) {
              if (existingBrowserTab.browserSourceTabId !== sourceTab.id) {
                existingBrowserTab.browserSourceTabId = sourceTab.id
              }
            } else {
              const newBrowserTab: TabSession = {
                id: `browser-${sourceTab.id}`,
                title: 'AI Browser',
                tabType: 'browser',
                browserSourceTabId: sourceTab.id,
                messages: [],
                inputText: '',
                attachedFile: null,
                sessionMode: 'execution',
                disciplinePath: '',
                isProcessing: false,
                isTodoOpen: false,
                selectedModel: sourceTab.selectedModel,
                isSearchEnabled: false
              }
              const sourceIndex = newTabs.findIndex((t) => t.id === sourceTab.id)
              newTabs = [...newTabs]
              newTabs.splice(sourceIndex + 1, 0, newBrowserTab)
            }
          }
        }

        return newTabs
      })
    })

    const removeToolEndListener = window.api.onToolEnd((data) => {
      const { chatId } = data
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prev) =>
        prev.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
            const lastMsgIndex = newMessages.findLastIndex(
              (msg) =>
                msg.role === 'ai' && msg.toolCalls?.some((toolCall) => toolCall.id === data.callId)
            )

            if (lastMsgIndex !== -1 && newMessages[lastMsgIndex].toolCalls) {
              const lastMsg = { ...newMessages[lastMsgIndex] }
              lastMsg.toolCalls = applyToolCallEnd(lastMsg.toolCalls || [], data)
              newMessages[lastMsgIndex] = lastMsg
            }
            return { ...tab, messages: newMessages }
          }
          return tab
        })
      )
    })

    const removeToolUpdateListener = window.api.onToolUpdate((data) => {
      const { chatId } = data
      const setTargetTabs = setTabsForChat(chatId)
      setTargetTabs((prev) =>
        prev.map((tab) => {
          if (tab.chatId === chatId) {
            const newMessages = [...tab.messages]
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
                  if (typeof data.update.outputChunk === 'string') {
                    toolCall.terminalOutput =
                      `${toolCall.terminalOutput || ''}${data.update.outputChunk}`.slice(-100_000)
                  }
                  if (typeof data.update.runId === 'string') {
                    toolCall.runId = data.update.runId
                  }
                  toolCalls[toolCallIndex] = toolCall
                  lastMsg.toolCalls = toolCalls
                  newMessages[i] = lastMsg
                  return { ...tab, messages: newMessages }
                }
              }
            }
          }
          return tab
        })
      )
    })

    const removeTitleReceivedListener = window.api.onChatTitleReceived(({ id, title }) => {
      const setTargetTabs = setTabsForChat(id)
      setTargetTabs((prevTabs) =>
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

    const removeTerminalProcessListener = window.api.onTerminalProcessUpdate((snapshot) => {
      if (!snapshot.isBackgrounded) return
      setTerminalProcesses((prev) => {
        const current = prev[snapshot.chatId] || []
        const existingIndex = current.findIndex((process) => process.runId === snapshot.runId)
        const next = [...current]
        if (existingIndex === -1) {
          next.push(snapshot)
        } else {
          next[existingIndex] = snapshot
        }
        next.sort((left, right) => left.startedAt - right.startedAt)
        return { ...prev, [snapshot.chatId]: next }
      })
    })

    const removeOpenMainAppListener = window.api.onOpenMainAppWithInstructions((data) => {
      const { instructions, model } = data

      if (model) {
        handleModelChange(model)
      }

      const targetTabId = activeTabIdRef.current
      const currentTab = tabsRef.current.find((t) => t.id === targetTabId)
      if (!currentTab) return

      let chatId = currentTab.chatId
      if (!chatId) {
        chatId = Date.now().toString()
      }

      setTabs((prev) =>
        prev.map((t) => (t.id === targetTabId ? { ...t, chatId, isProcessing: true } : t))
      )

      setRunningChats((prev) => ({ ...prev, [chatId!]: true }))

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === targetTabId) {
            return {
              ...t,
              messages: [...t.messages, { role: 'user' as const, content: instructions }],
              inputText: ''
            }
          }
          return t
        })
      )

      window.api.sendChatMessage({
        message: instructions,
        chatId,
        modelKey: model || currentTab.selectedModel,
        reasoningLevel: getReasoningLevelForModel(model || currentTab.selectedModel)
      })
    })

    const removeSearchEnabledListener = window.api.onSearchEnabledChanged?.((val) => {
      const activeId = activeTabIdRef.current
      if (activeId) {
        handleToggleSearch(activeId, val)
      }
    })

    return () => {
      removeSearchEnabledListener?.()
      // Cancel any pending RAF to avoid stale state updates after cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      pendingChunkRef.current = null
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
      removeTerminalProcessListener()
      removeOpenMainAppListener()
    }
  }, [])

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
          if (view === 'harness') {
            handleOpenHarness()
          } else {
            setActiveView(view)
          }
        }}
        onLoadChat={(id) => {
          handleLoadChat(id)
        }}
        onNewChat={() => {
          handleNewChat()
        }}
        onStartHarness={handleOpenHarness}
        onChatDeleted={handleChatDeleted}
        currentChatId={activeView === 'harness' ? activeHarnessTab?.chatId : activeTab.chatId}
        runningChats={runningChats}
        config={config}
        onOpenSearch={() => {
          setIsSearchModalOpen(true)
        }}
        authUser={authUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
      />
    )
  }, [
    activeView,
    isSidebarOpen,
    handleLoadChat,
    handleNewChat,
    handleOpenHarness,
    handleChatDeleted,
    activeTab.chatId,
    activeHarnessTab?.chatId,
    runningChats,
    config,
    authUser
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

  if (route === '#voice-overlay') {
    return (
      <Suspense fallback={null}>
        <DiscordVoiceGlowOverlay />
      </Suspense>
    )
  }

  if (route === '#launcher') {
    return <QuickLauncher />
  }

  if (route === '#updater') {
    return <UpdaterView />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent font-sans selection:bg-accent-primary/30 pt-10 relative">
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
      <TitleBar
        title={
          activeView === 'harness'
            ? activeHarnessTab?.title || 'Harness'
            : tabs.length > 0
              ? activeTab.title || undefined
              : undefined
        }
        isStreaming={
          activeView === 'harness'
            ? Boolean(activeHarnessTab?.isProcessing)
            : tabs.length > 0
              ? activeTab.isTitleStreaming
              : false
        }
      />
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onOpenChat={handleLoadChat}
      />
      {harnessPromptWarnings.length > 0 && (
        <div className="fixed right-5 top-16 z-[125] w-[min(420px,calc(100vw-2.5rem))] rounded-xl border border-status-warning/25 bg-black/85 p-3.5 shadow-2xl backdrop-blur-xl animate-soft-pop">
          <div className="flex items-start gap-2.5">
            <XCircle size={15} className="mt-0.5 shrink-0 text-status-warning" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-text-primary">Harness notice</span>
              {harnessPromptWarnings.map((warning) => (
                <p key={warning} className="mt-1 text-[10.5px] leading-relaxed text-text-secondary">
                  {warning}
                </p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setHarnessPromptWarnings([])}
              className="rounded p-1 text-text-muted hover:bg-white/[0.06] hover:text-text-primary"
              aria-label="Dismiss Harness instruction warning"
            >
              <XCircle size={13} />
            </button>
          </div>
        </div>
      )}
      {harnessApprovalRequest && (
        <HarnessApprovalDialog
          request={harnessApprovalRequest}
          onResolve={(approved) => {
            window.api.resolveHarnessApproval(harnessApprovalRequest.requestId, approved)
            setHarnessApprovalRequest(null)
          }}
        />
      )}
      <HarnessProjectModal
        isOpen={isHarnessProjectModalOpen}
        onClose={() => {
          setIsHarnessProjectModalOpen(false)
          setHarnessProjectTargetTabId(null)
        }}
        onSelected={(project) => {
          const targetTabId = harnessProjectTargetTabId || activeHarnessTabIdRef.current
          if (targetTabId) selectHarnessProjectForTab(targetTabId, project)
        }}
      />
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto p-3 sm:p-5 md:p-6 flex flex-col animate-soft-pop">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-[12px]"
            onClick={() => setIsSettingsModalOpen(false)}
          />
          <div className="m-auto relative w-full max-w-[1120px] h-[calc(100vh-24px)] sm:h-[min(88vh,860px)] overflow-hidden rounded-2xl border border-white/[0.14] bg-black/85 backdrop-blur-2xl shadow-[0_28px_80px_rgba(0,0,0,0.75),var(--glass-specular-top)] flex flex-col z-10">
            <SettingsView
              initialSection={settingsInitialSection}
              onClose={() => setIsSettingsModalOpen(false)}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          </div>
        </div>
      )}
      <PrismBackground />

      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-20 flex h-16 w-6 items-center justify-center rounded-r-xl border border-l-0 border-white/[0.08] bg-white/[0.04] text-text-secondary shadow-lg backdrop-blur-xl transition-all duration-300 hover:w-8 hover:bg-white/[0.08] hover:text-text-primary cursor-pointer active:scale-95"
          title="Open Sidebar"
        >
          <div className="h-8 w-1 rounded-full bg-white/[0.2]" />
        </button>
      )}

      {renderedSidebar}

      <main className="flex-1 flex flex-col relative z-10 min-w-0 h-full transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden">
        {!isOnline && <OfflineBanner />}

        {/* Chat retains its own conventional tab surface. */}
        {activeView === 'chat' && <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          visibleTabIds={visibleTabIds}
          selectedModel={selectedModel || activeTab.selectedModel}
          onModelChange={handleModelChange}
          onOpenUpgradePlans={() => setIsPlansModalOpen(true)}
          isEnterprise={isEnterpriseUser}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onCloseOtherTabs={handleCloseOtherTabs}
          onNewTab={handleNewChat}
          onOpenBrowserTab={() => handleOpenBrowserTab(activeTabId)}
          onToggleSplitTab={handleToggleSplitTab}
          onStopAgent={(tabId) => {
            const targetTab = tabs.find((t) => t.id === tabId)
            if (targetTab?.chatId) {
              window.api.cancelChat(targetTab.chatId)
            }
          }}
          onReorderTabs={handleReorderTabs}
        />}

        {/* Main Grid View for Tab Panes */}
        {activeView === 'chat' ? (
          tabs.length === 0 ? (
            <EmptyTabState onNewTab={handleNewChat} />
          ) : (
            <div
              className={clsx(
                'grid flex-1 w-full h-full overflow-hidden',
                visibleTabs.length > 1 ? 'p-2.5 gap-2.5' : 'p-0 gap-0',
                gridLayoutClass
              )}
            >
              {tabs.map((tab) => {
                const visibleIndex = visibleTabs.findIndex((vt) => vt.id === tab.id)
                const isVisible = visibleIndex !== -1
                const harnessProject = Object.values(config?.harness.projects || {}).find(
                  (project) => project.rootPath.toLowerCase() === tab.disciplinePath.toLowerCase()
                )
                const harnessUi = config
                  ? {
                      showSteps: harnessProject?.showSteps ?? config.harness.showSteps,
                      showThinking: harnessProject?.showThinking ?? config.harness.showThinking,
                      reduceMotion:
                        (harnessProject?.reduceMotion ?? config.harness.reduceMotion) ||
                        !(harnessProject?.animateActivity ?? config.harness.animateActivity)
                    }
                  : undefined

                if (!isVisible && tab.tabType !== 'browser') {
                  return null
                }

                return (
                  <div
                    key={tab.id}
                    className={clsx(
                      'h-full w-full overflow-hidden',
                      isVisible ? getPaneSpanClass(visibleIndex, visibleTabs.length) : 'hidden'
                    )}
                    aria-hidden={!isVisible}
                  >
                    {tab.tabType === 'browser' ? (
                      <BrowserPane
                        isAiActive={
                          tab.browserSourceTabId
                            ? !!tabs.find((t) => t.id === tab.browserSourceTabId)?.isProcessing
                            : Object.values(runningChats).some(Boolean)
                        }
                        isSplitView={visibleTabs.length > 1}
                        onCloseSplit={() => handleToggleSplitTab(tab.id)}
                      />
                    ) : (
                      <ChatPane
                        tab={{ ...tab, selectedModel: selectedModel || tab.selectedModel }}
                        isFocused={tab.id === activeTabId}
                        isSplitView={visibleTabs.length > 1}
                        todo={tab.chatId ? chatTodos[tab.chatId] || null : null}
                        terminalProcesses={tab.chatId ? terminalProcesses[tab.chatId] || [] : []}
                        config={config}
                        isKeyMissing={isKeyMissing}
                        isOnline={isOnline}
                        onFocus={handleSelectTab}
                        onCloseTab={handleCloseTab}
                        onToggleSplitTab={handleToggleSplitTab}
                        onSwapSplitTabs={handleSwapSplitTabs}
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
                          const newDisciplinePath = mode === 'discipline' ? tab.disciplinePath : ''
                          setTabs((prev) =>
                            prev.map((t) =>
                              t.id === tab.id
                                ? { ...t, sessionMode: mode, disciplinePath: newDisciplinePath }
                                : t
                            )
                          )
                          window.api.setSessionMode(mode, newDisciplinePath)
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
                        onUpdateTabQuote={(id, quote) => {
                          setTabs((prev) =>
                            prev.map((t) => (t.id === id ? { ...t, quotedText: quote } : t))
                          )
                        }}
                        onUpdateTabDisabledSkills={(id, disabledSkills) => {
                          setTabs((prev) =>
                            prev.map((t) => (t.id === id ? { ...t, disabledSkills } : t))
                          )
                        }}
                        onToggleSearch={(enabled) => handleToggleSearch(tab.id, enabled)}
                        onOpenScreenshotModal={() => setIsScreenshotModalOpen(true)}
                        onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
                        activeWorkflow={activeWorkflow}
                        setActiveWorkflow={setActiveWorkflow}
                        renderedMessages={
                          <TabMessagesList
                            messages={tab.messages}
                            tabId={tab.id}
                            currentChatId={tab.chatId}
                            handleLoadChat={handleLoadChat}
                            onOpenBrowserTab={handleOpenBrowserTab}
                            isSuggestionSendDisabled={tab.isProcessing || !isOnline}
                            onSendSuggestion={handleSuggestionSend}
                            sessionMode={tab.sessionMode}
                            harnessUi={harnessUi}
                            harnessContextSnapshot={tab.harnessContextSnapshot}
                          />
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <HarnessWorkspace
            tabs={harnessTabs}
            activeTabId={activeHarnessTabId}
            tabProjectMode={config?.harness.tabProjectMode || 'fixed'}
            reduceMotion={
              config?.harness.reduceMotion || config?.harness.animateActivity === false
            }
            onSelectTab={handleSelectHarnessTab}
            onCloseTab={handleCloseHarnessTab}
            onNewTab={() => void handleNewHarnessTab()}
            onStopTab={(tab) => {
              if (tab.chatId) window.api.cancelChat(tab.chatId)
            }}
            onLoadSession={handleLoadHarnessSession}
            onDeleteSession={(chatId) => {
              void window.api.deleteHarnessSession(chatId).then((deleted) => {
                if (deleted) handleHarnessSessionDeleted(chatId)
              })
            }}
            onOpenSettings={() => {
              setSettingsInitialSection('harness')
              setIsSettingsModalOpen(true)
            }}
            onOpenProjectPicker={() => {
              if (activeHarnessTabIdRef.current) {
                setHarnessProjectTargetTabId(activeHarnessTabIdRef.current)
                setIsHarnessProjectModalOpen(true)
              } else {
                void handleNewHarnessTab(true)
              }
            }}
            renderActiveTab={(tab) => {
              const harnessProject = Object.values(config?.harness.projects || {}).find(
                (project) => project.rootPath.toLowerCase() === tab.disciplinePath.toLowerCase()
              )
              const harnessUi = config
                ? {
                    showSteps: harnessProject?.showSteps ?? config.harness.showSteps,
                    showThinking: harnessProject?.showThinking ?? config.harness.showThinking,
                    reduceMotion:
                      (harnessProject?.reduceMotion ?? config.harness.reduceMotion) ||
                      !(harnessProject?.animateActivity ?? config.harness.animateActivity)
                  }
                : undefined
              return (
                <ChatPane
                  tab={tab}
                  isFocused
                  isSplitView={false}
                  todo={tab.chatId ? chatTodos[tab.chatId] || null : null}
                  terminalProcesses={tab.chatId ? terminalProcesses[tab.chatId] || [] : []}
                  config={config}
                  isKeyMissing={isKeyMissing}
                  isOnline={isOnline}
                  onFocus={handleSelectHarnessTab}
                  onCloseTab={handleCloseHarnessTab}
                  onToggleSplitTab={() => {}}
                  onSwapSplitTabs={() => {}}
                  onSend={(text, file) => handleHarnessSend(text, file)}
                  onCancel={() => {
                    if (tab.chatId) window.api.cancelChat(tab.chatId)
                  }}
                  onModelChange={(model) => handleHarnessModelChange(tab.id, model)}
                  onReasoningLevelChange={(model, level) => {
                    void handleReasoningLevelChange(model, level)
                  }}
                  onModeChange={() => {}}
                  harnessPermissionMode={
                    harnessProject?.permissionMode ?? config?.harness.defaultPermissionMode ?? 'ask'
                  }
                  onHarnessPermissionModeChange={(mode) =>
                    handleHarnessPermissionModeChange(tab.id, mode)
                  }
                  onOpenUpgradePlans={() => setIsPlansModalOpen(true)}
                  isEnterprise={isEnterpriseUser}
                  onSelectFolder={() => {
                    setHarnessProjectTargetTabId(tab.id)
                    setIsHarnessProjectModalOpen(true)
                  }}
                  onUpdateTabInput={(id, text) => {
                    setHarnessTabs((previous) =>
                      previous.map((entry) => (entry.id === id ? { ...entry, inputText: text } : entry))
                    )
                  }}
                  onUpdateTabFile={(id, file) => {
                    setHarnessTabs((previous) =>
                      previous.map((entry) => (entry.id === id ? { ...entry, attachedFile: file } : entry))
                    )
                  }}
                  onUpdateTabQuote={(id, quote) => {
                    setHarnessTabs((previous) =>
                      previous.map((entry) => (entry.id === id ? { ...entry, quotedText: quote } : entry))
                    )
                  }}
                  onUpdateTabDisabledSkills={() => {}}
                  onToggleSearch={() => {}}
                  onOpenScreenshotModal={() => setIsScreenshotModalOpen(true)}
                  onOpenYoutubeModal={() => {}}
                  activeWorkflow={null}
                  setActiveWorkflow={() => {}}
                  renderedMessages={
                    <TabMessagesList
                      messages={tab.messages}
                      tabId={tab.id}
                      currentChatId={tab.chatId}
                      handleLoadChat={handleLoadHarnessSession}
                      isSuggestionSendDisabled={tab.isProcessing || !isOnline}
                      onSendSuggestion={(tabId, payload) =>
                        handleHarnessSuggestionSend(tabId, payload)
                      }
                      sessionMode="harness"
                      harnessUi={harnessUi}
                      harnessContextSnapshot={tab.harnessContextSnapshot}
                    />
                  }
                />
              )
            }}
          />
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
          if (activeView === 'harness') {
            setHarnessTabs((previous) =>
              previous.map((tab) =>
                tab.id === activeHarnessTabIdRef.current ? { ...tab, attachedFile: file } : tab
              )
            )
          } else {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === activeTabIdRef.current ? { ...t, attachedFile: file } : t
              )
            )
          }
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
          className="fixed z-50 flex items-center justify-center bg-background-secondary/95 border border-white/10 hover:border-accent-secondary/40 hover:bg-white/[0.08] px-3.5 py-1.5 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md cursor-pointer select-none pointer-events-auto transition-all duration-150 active:scale-95 group animate-soft-pop"
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
          <Quotes
            size={14}
            weight="bold"
            className="text-accent-secondary mr-1.5 group-hover:scale-110 transition-transform"
          />
          <span className="text-xs font-semibold text-text-primary group-hover:text-accent-secondary transition-colors duration-150">
            Answer Prism
          </span>
        </div>
      )}

      {/* Auth & Profile Modals */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false)
          if (isOnboardingRef.current && isKeyMissing) {
            setIsApiKeyModalOpen(true)
          } else if (isKeyMissing) {
            setIsProviderLockOpen(true)
          }
        }}
        onAuthSuccess={async () => {
          try {
            const verifiedUser = await window.api.getAuthUser()
            if (!verifiedUser) {
              setAuthUser(null)
              return false
            }

            setAuthUser(verifiedUser)
            setIsAuthModalOpen(false)
            setIsApiKeyModalOpen(false)
            setIsProviderLockOpen(false)
            isOnboardingRef.current = false
            return true
          } catch (err) {
            console.error('[Auth] Failed to verify authenticated session:', err)
            setAuthUser(null)
            return false
          }
        }}
      />
      <UserProfileModal
        isOpen={isProfileModalOpen}
        user={authUser}
        onClose={() => setIsProfileModalOpen(false)}
        onLoggedOut={() => setAuthUser(null)}
        onProfileUpdated={(updated) => setAuthUser(updated)}
      />

      <QuotaExceededModal
        isOpen={isQuotaModalOpen}
        onClose={() => setIsQuotaModalOpen(false)}
        onOpenSettings={() => {
          setIsQuotaModalOpen(false)
          setSettingsInitialSection('providers')
          setIsSettingsModalOpen(true)
        }}
        onOpenUpgradePlans={() => {
          setIsQuotaModalOpen(false)
          setIsPlansModalOpen(true)
        }}
      />

      <PrismPlansModal
        isOpen={isPlansModalOpen}
        onClose={() => setIsPlansModalOpen(false)}
        onOpenLicenseSettings={() => {
          setIsPlansModalOpen(false)
          setSettingsInitialSection('license')
          setIsSettingsModalOpen(true)
        }}
        isEnterprise={isEnterpriseUser}
      />

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => {
          setIsApiKeyModalOpen(false)
          isOnboardingRef.current = false
          if (isKeyMissing) {
            setIsProviderLockOpen(true)
          }
        }}
        onSave={async () => {
          setIsApiKeyModalOpen(false)
          setIsProviderLockOpen(false)
          isOnboardingRef.current = false
          try {
            const cfg = await window.api.getConfig()
            if (cfg) {
              setConfig(cfg)
            }
          } catch (e) {
            console.error('Failed to refresh config after saving provider:', e)
          }
        }}
        initialValue={''}
      />

      {/* Mandatory Provider Lock Screen Fallback */}
      {isProviderLockOpen && isKeyMissing && (
        <ProviderLockScreen
          onOpenAuth={() => {
            setIsProviderLockOpen(false)
            setIsAuthModalOpen(true)
          }}
          onOpenWizard={() => {
            setIsProviderLockOpen(false)
            setIsApiKeyModalOpen(true)
          }}
        />
      )}

      {/* Onboarding License Modal (Startup Prompt) */}
      <OnboardingLicenseModal
        isOpen={isOnboardingLicenseModalOpen}
        onClose={() => setIsOnboardingLicenseModalOpen(false)}
        authUser={authUser}
        config={config}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />
    </div>
  )
}

function App(): React.JSX.Element {
  return <RealApp />
}

export default App
