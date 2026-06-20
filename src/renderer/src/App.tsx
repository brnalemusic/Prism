import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismBackground } from './components/PrismBackground'
import { IntroScreen } from './components/IntroScreen'
import { Sidebar } from './components/Sidebar'
import { InputBar, InputBarHandle } from './components/InputBar'
import { Spinner } from './components/Spinner'
import { ActionLoader, ToolCall } from './components/ActionLoader'
import { QuestionnaireRenderer } from './components/QuestionnaireRenderer'
import { MalformedToolCallWarning } from './components/MalformedToolCallWarning'
import { ModelSelectorHandle } from './components/ModelSelector'
import { Tasks } from './components/Tasks'
import { QuickLauncher } from './components/QuickLauncher'
import { TitleBar } from './components/TitleBar'
import { ErrorMessage } from './components/ErrorMessage'
import { SettingsView } from './components/SettingsView'
import { ApiKeyModal } from './components/ApiKeyModal'
import { MissingKeyBanner } from './components/MissingKeyBanner'
import { SubagentChat } from './components/SubagentChat'
import { SearchModal } from './components/SearchModal'
import { RenderChatHistory } from './components/RenderChatHistory'
import { SubagentModelSettings } from './components/SubagentModelSettings'
import { MiniAppRenderer } from './components/MiniAppRenderer'
import { TtsButton } from './components/TtsButton'
import { CopyMessageButton } from './components/CopyMessageButton'
import { ErrorPopup } from './components/ErrorPopup'
import { DownloadProgressOverlay } from './components/DownloadProgressOverlay'
import { DemoApp } from './components/demo/DemoApp'
import { triggerErrorPopup } from './utils'
import {
  StreamContext,
  StaticMarkdownComponents,
  createStreamingFadeRehypePlugin,
  useStreamStats
} from './components/AnimatedStreamingText'
import clsx from 'clsx'
import { CaretDown, Plus, Quotes, Brain, FilePdf, FilePpt } from '@phosphor-icons/react'
import { ScreenshotModal } from './components/ScreenshotModal'
import { SubagentDelegationModal } from './components/SubagentDelegationModal'
import { YoutubeAppModal } from './components/YoutubeAppModal'
import { AppConfig, SlashWorkflow } from '../../main/config'
import type { DownloadProgress } from '../../shared/types'
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
  )
}

export interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

interface Message {
  role: 'user' | 'ai' | 'separator'
  content: string
  thoughts?: string
  isStreaming?: boolean
  isThinking?: boolean
  isError?: boolean
  usedFallback?: boolean
  toolCalls?: ToolCall[]
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search' | 'mini-app'
  isConnecting?: boolean
  screenshot?: string
  file?: AttachedFile
  separatorType?: 'fallback' | 'error' | 'cancel'
}

interface Task extends ToolCall {
  id: string
  timestamp: Date
}

interface AiMessageProps {
  msg: Message
  currentChatId: string | undefined
  handleLoadChat: (id: string) => void
  markdownComponents: Components
  modelSelectorRef: React.RefObject<any>
  setIsApiKeyModalOpen: (open: boolean) => void
}

const AiMessage = React.memo(function AiMessage({
  msg,
  currentChatId,
  handleLoadChat,
  markdownComponents,
  modelSelectorRef,
  setIsApiKeyModalOpen
}: AiMessageProps) {
  const streamStats = useStreamStats(msg.content, !!msg.isStreaming)

  if (msg.isError) {
    const isRateLimit = msg.content.includes('429')

    const handleFix = (): void => {
      if (isRateLimit) {
        modelSelectorRef.current?.open()
      } else {
        setIsApiKeyModalOpen(true)
      }
    }

    return <ErrorMessage error={msg.content} onFixClick={handleFix} />
  }

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

  // Split content by tool calls and mini apps
  const parts = msg.content.split(
    /(<tool_call>[\s\S]*?(?:<\/tool_call>|$)|<mini_app>[\s\S]*?(?:<\/mini_app>|$))/gi
  )
  let toolCallIndex = 0
  let partStartOffset = 0

  return (
    <StreamContext.Provider value={streamStats}>
      <div
        className={clsx(
          'flex flex-col gap-4 w-full max-w-none transition-opacity duration-500',
          msg.isStreaming && 'opacity-90'
        )}
      >
        <div className="flex flex-col gap-2 relative">
          {parts.map((part, index) => {
            const currentPartStartOffset = partStartOffset
            partStartOffset += part.length

            if (part.startsWith('<tool_call>')) {
              if (part.includes('</tool_call>')) {
                const tc = msg.toolCalls?.[toolCallIndex]
                toolCallIndex++
                if (tc) {
                  if (tc.name === 'to_ask') {
                    return (
                      <QuestionnaireRenderer
                        key={`tc-${index}`}
                        toolCall={tc}
                        chatId={currentChatId || ''}
                      />
                    )
                  }
                  if (tc.name === 'render_chat_history') {
                    return (
                      <RenderChatHistory
                        key={`tc-${index}`}
                        chatId={String(tc.args.query || '')}
                        onOpenChat={handleLoadChat}
                      />
                    )
                  }
                  if (tc.name === 'malformed_tool_call') {
                    return <MalformedToolCallWarning key={`tc-${index}`} toolCall={tc} />
                  }
                  return <ActionLoader key={`tc-${index}`} toolCall={tc} />
                }
              } else {
                const nameMatch = part.match(/<name>([\s\S]*?)(?:<\/name>|$)/i)
                const toolName = nameMatch ? nameMatch[1].trim() : ''
                const isSearch =
                  toolName === 'web_search' ||
                  toolName === 'search_chat_history' ||
                  toolName === 'saw_link_from_url'
                const toolType = isSearch ? 'search' : 'task'
                return (
                  <ActionLoader
                    key={`writing-tc-${index}`}
                    toolCall={{
                      name: toolType,
                      status: 'writing',
                      args: {}
                    }}
                  />
                )
              }
              return null
            } else if (part.startsWith('<mini_app>')) {
              if (part.includes('</mini_app>')) {
                const titleMatch = part.match(/<title>([\s\S]*?)<\/title>/i)
                const htmlMatch = part.match(/<html>([\s\S]*?)<\/html>/i)
                const cssMatch = part.match(/<css>([\s\S]*?)<\/css>/i)
                const jsMatch = part.match(/<js>([\s\S]*?)<\/js>/i)

                // Use a simple hash of the content as part of the ID to keep it stable
                const contentHash = part.length.toString(36)
                const miniAppId = `mini-app-${index}-${contentHash}`

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
                return (
                  <ActionLoader
                    key={`writing-ma-${index}`}
                    toolCall={{
                      name: 'mini-app',
                      status: 'writing',
                      args: {}
                    }}
                  />
                )
              }
              return null
            } else if (part.trim() !== '') {
              return (
                <div
                  key={`text-${index}`}
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
                      createStreamingFadeRehypePlugin(streamStats, currentPartStartOffset)
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

          {msg.isWritingToolCall &&
            !msg.content.includes('<tool_call>') &&
            !msg.content.includes('<mini_app>') && (
              <ActionLoader
                key="writing-tc"
                toolCall={{
                  name: msg.toolType || 'task',
                  status: 'writing',
                  args: {}
                }}
              />
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
  const [showIntro, setShowIntro] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
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
  const [isSubagentModalOpen, setIsSubagentModalOpen] = useState(false)
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
  const [isThinkMode, setIsThinkMode] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [inputText, setInputText] = useState('')
  const [activeWorkflow, setActiveWorkflow] = useState<SlashWorkflow | null>(null)

  useEffect(() => {
    setActiveWorkflow(null)
  }, [currentChatId])

  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isFullscreenInput, setIsFullscreenInput] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

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

  const isThinkModeRef = useRef(isThinkMode)
  useEffect(() => {
    isThinkModeRef.current = isThinkMode
  }, [isThinkMode])

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
        if (cfg.defaultModel) {
          setSelectedModel(cfg.defaultModel)
        }
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!config) return

    const updateTheme = () => {
      const isRgbActive = !!(config.rgbThemeExpiry && Date.now() < config.rgbThemeExpiry)
      const themeToApply =
        config.theme === 'rgb' && !isRgbActive ? 'marine' : config.theme || 'marine'
      document.documentElement.setAttribute('data-theme', themeToApply)
    }

    updateTheme()

    if (config.rgbThemeExpiry && config.rgbThemeExpiry > Date.now()) {
      const msLeft = config.rgbThemeExpiry - Date.now()
      const timer = setTimeout(() => {
        updateTheme()
        const updatedConfig = {
          ...config,
          theme: config.theme === 'rgb' ? 'marine' : config.theme
        } as AppConfig
        window.api.saveConfig(updatedConfig)
      }, msLeft)
      return () => clearTimeout(timer)
    }

    return undefined
  }, [config])

  const route = window.location.hash
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const isProgrammaticScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const inputBarRef = useRef<InputBarHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)

  const getGreeting = (): React.JSX.Element => {
    const rawName = config?.username || 'user'
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    return (
      <>
        Hello,{' '}
        <span className="font-medium text-accent-primary rgb-chroma-username">{formattedName}</span>
        . What are we working on?
      </>
    )
  }

  const handleThinkModeToggle = useCallback((val: boolean) => {
    window.api.setThinkMode(val)
  }, [])

  const handleSearchEnabledToggle = useCallback((val: boolean) => {
    window.api.setSearchEnabled(val)
  }, [])

  const handleSend = useCallback(
    (
      text: string,
      thinkMode?: boolean,
      searchEnabled?: boolean,
      screenshot?: string,
      file?: AttachedFile,
      youtubeMode?: boolean
    ): void => {
      if (isProcessingRef.current) return

      setIsProcessing(true)
      isProcessingRef.current = true

      const targetYoutubeMode = youtubeMode ?? isYoutubeModeRef.current
      setIsYoutubeMode(targetYoutubeMode)

      // If thinkMode is provided (e.g. from Launcher), update App state
      if (thinkMode !== undefined) {
        window.api.setThinkMode(thinkMode)
        setIsThinkMode(thinkMode)
        isThinkModeRef.current = thinkMode
      }
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

      // Para a API, enviamos o texto original e o thinkMode
      window.api.sendChatMessage({
        message: apiMessage,
        thinkMode: thinkMode ?? isThinkModeRef.current,
        chatId,
        screenshot: activeScreenshot || undefined,
        attachedFile: activeFile || undefined,
        quote: quotedTextRef.current || undefined,
        appMode: targetYoutubeMode ? 'youtube' : undefined
      })

      setAttachedFile(null)
      setQuotedText(null)
      setIsYoutubeMode(false)
      isYoutubeModeRef.current = false
      setActiveWorkflow(null)
    },
    []
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

    if (scrollTop !== lastScrollTopRef.current) {
      const atBottom = scrollHeight - scrollTop - clientHeight < 50

      if (scrollTop < lastScrollTopRef.current) {
        // If scrolling up, unstick immediately
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

    const atBottom = scrollHeight - scrollTop - clientHeight < 50
    setShowScrollButton(!atBottom && scrollHeight > clientHeight)
  }

  const handleModelChange = useCallback((newModel: string): void => {
    setSelectedModel(newModel)
    window.api.setModel(newModel)
  }, [])

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
        let lastWasFallbackSystem = false
        let fallbackModelName = ''

        for (const m of history) {
          let text = ''
          let screenshot: string | undefined = undefined
          let file: AttachedFile | undefined = undefined

          if (m.parts) {
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

                  // Parse subagent messages if present
                  const chatLogRegex = /<subagent_chat>([\s\S]*?)<\/subagent_chat>/gi
                  const chatLogMatch = chatLogRegex.exec(result)
                  if (chatLogMatch) {
                    try {
                      ;(toolCall as ToolCall).subagentMessages = JSON.parse(chatLogMatch[1])
                    } catch (e) {
                      console.error('Failed to parse subagent chat log', e)
                    }
                  }
                }
              }
            }
            continue // Don't add system results to UI as separate bubbles
          }

          if (m.role === 'system') {
            if (text.includes('[SYSTEM: FALLBACK]')) {
              lastWasFallbackSystem = true
              const match = text.match(
                /(?:activated as|ativado como) (.*?) (?:to continue|para dar continuidade)/i
              )
              fallbackModelName = match ? match[1] : 'Prism AI'
            }
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
          } else if (m.role === 'model') {
            if (lastWasFallbackSystem) {
              mappedMessages.push({
                role: 'separator',
                separatorType: 'fallback',
                content: `Fallback to ${fallbackModelName}`
              })
              lastWasFallbackSystem = false
            }

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

            // Parse Thoughts and extract them from content
            const thoughtsRegex = /<thought>([\s\S]*?)<\/thought>/gi
            let thoughtsMatch
            while ((thoughtsMatch = thoughtsRegex.exec(text)) !== null) {
              aiMsg.thoughts = (aiMsg.thoughts || '') + thoughtsMatch[1].trim() + '\n\n'
            }

            // Remove thoughts from the text that will become content
            const textWithoutThoughts = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()

            // Parse Tool Calls (DO NOT remove from content, as renderAiMessage needs them as markers)
            const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
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
                    if (key !== 'type' && key !== 'name') {
                      args[key] = value
                    }
                  }

                  if (!aiMsg.toolCalls) aiMsg.toolCalls = []
                  const newToolCall: ToolCall = {
                    name,
                    args,
                    status: 'done' // Default to done for history
                  }
                  if (name === 'web_search' && args.searches && Array.isArray(args.searches)) {
                    newToolCall.searchUpdates = args.searches.map((s: any) => s.title).filter(Boolean)
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

        // Cleanup trailing whitespace in thoughts and populate tasks
        const allTasks: Task[] = []
        mappedMessages.forEach((m) => {
          if (m.thoughts) m.thoughts = m.thoughts.trim()
          if (m.role === 'ai' && m.toolCalls) {
            m.toolCalls.forEach((tc) => {
              allTasks.push({
                ...tc,
                id: crypto.randomUUID(),
                timestamp: new Date() // Actual history entry timestamp isn't per-tool
              })
            })
          }
        })

        setMessages(mappedMessages)
        setTasks(allTasks)
        setCurrentChatId(id)
        currentChatIdRef.current = id

        // Retrieve and set the chat title statically
        window.api
          .getChats()
          .then((chatsList) => {
            const foundChat = chatsList.find((c) => c.id === id)
            if (
              foundChat &&
              foundChat.title &&
              foundChat.title !== 'New Conversation' &&
              foundChat.title !== 'Nova Conversa'
            ) {
              setCurrentChatTitle(foundChat.title)
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
    setTasks([])
    setCurrentChatId(undefined)
    currentChatIdRef.current = undefined
    setIsProcessing(false)
    isProcessingRef.current = false
    setInputText('')
    setIsFullscreenInput(false)
    window.api.clearChat()
    setCurrentChatTitle(null)
    setIsTitleStreaming(false)
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current)
      titleIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewChat()
        setIsSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleNewChat])

  useEffect(() => {
    // Listen for launcher messages
    const removeLauncherListener = window.api.onLauncherMessage((data) => {
      setActiveView('chat')
      // If launcher message arrives with the tag, handleSend will take care of hiding it in the UI
      handleSend(
        data.message,
        data.thinkMode,
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
      if (cfg.defaultModel) {
        setSelectedModel(cfg.defaultModel)
      }
    })

    const removeThinkModeListener = window.api.onThinkModeChanged((val) => {
      setIsThinkMode(val)
    })

    const removeSearchEnabledListener = window.api.onSearchEnabledChanged((val) => {
      setIsSearchEnabled(val)
    })

    const removeOpenMainAppListener = window.api.onOpenMainAppWithInstructions((data) => {
      setActiveView('chat')
      handleModelChange(data.model)
      handleNewChat(true)

      if (data.thinkMode !== undefined) {
        window.api.setThinkMode(data.thinkMode)
        setIsThinkMode(data.thinkMode)
      }
      if (data.searchEnabled !== undefined) {
        window.api.setSearchEnabled(data.searchEnabled)
        setIsSearchEnabled(data.searchEnabled)
      }

      setTimeout(() => {
        handleSend(data.instructions, data.thinkMode, data.searchEnabled)
        setTimeout(() => {
          inputBarRef.current?.focus()
        }, 100)
      }, 50)
    })

    return () => {
      removeLauncherListener()
      removeModelListener()
      removeConfigListener()
      removeThinkModeListener()
      removeSearchEnabledListener()
      removeOpenMainAppListener()
    }
  }, [handleSend, handleModelChange, handleNewChat])

  const handleSaveApiKey = async (key: string): Promise<void> => {
    if (config) {
      const newConfig = { ...config, userGeminiKey: key }
      const success = await window.api.saveConfig(newConfig)
      if (success) {
        setConfig(newConfig)
      }
    }
  }

  // Keep scroll at the bottom when content dimensions change (e.g. streaming, loading)
  useEffect(() => {
    const container = scrollContainerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        isProgrammaticScrollRef.current = true
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'auto'
        })
      }
    })

    observer.observe(content)
    return () => {
      observer.disconnect()
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
        usedFallback,
        isThinking,
        isWritingToolCall,
        toolType
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
          if (lastMsg && lastMsg.role === 'ai' && lastMsg.isStreaming) {
            newMessages[lastMsgIndex] = {
              ...lastMsg,
              thoughts,
              content: finalResponse,
              usedFallback,
              isThinking,
              isWritingToolCall,
              toolType,
              isConnecting: false
            }
          } else {
            console.warn(
              `[UI Chat] onChatChunk did NOT update message state because: lastMsg=${!!lastMsg}, lastMsg.role=${lastMsg?.role}, isStreaming=${lastMsg?.isStreaming}`
            )
          }
          return newMessages
        })
      }
    })

    const removeChatEndListener = window.api.onChatEnd((data) => {
      const { chatId, thoughts, finalResponse, usedFallback } = data
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
            newMessages[lastMsgIndex] = {
              ...lastMsg,
              thoughts,
              content: finalResponse,
              usedFallback,
              isStreaming: false,
              isThinking: false,
              isWritingToolCall: false,
              isConnecting: false
            }
          }
          return newMessages
        })
      }
    })

    const removeChatErrorListener = window.api.onChatError((data) => {
      const { error, chatId } = data
      setRunningChats((prev) => ({ ...prev, [chatId]: false }))
      if (chatId === currentChatIdRef.current) {
        setIsProcessing(false)
        setIsYoutubeMode(false)

        if (error === 'API_KEY_MISSING') {
          setIsApiKeyModalOpen(true)
          triggerErrorPopup(error)
        }

        const isCancel = error.includes('cancelled')
        if (!isCancel && error !== 'API_KEY_MISSING') {
          triggerErrorPopup(error)
        }

        if (isCancel) {
          setTasks((prev) =>
            prev.map((t) => (t.status === 'running' ? { ...t, status: 'cancelled' } : t))
          )
        }

        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.length - 1
          const lastMsg = newMessages[lastMsgIndex]

          // Clean up streaming/connecting/thinking flags on the last message if it's AI
          if (lastMsg && lastMsg.role === 'ai') {
            let updatedToolCalls = lastMsg.toolCalls
            // Cleanup running tool calls in last message
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

          const hasContentOrTools =
            lastMsg && lastMsg.role === 'ai' && (lastMsg.content || lastMsg.toolCalls?.length)

          if (isCancel) {
            // Push cancel separator
            newMessages.push({
              role: 'separator',
              separatorType: 'cancel',
              content: 'Cancelled by user'
            })
          } else {
            // Push error separator
            newMessages.push({
              role: 'separator',
              separatorType: 'error',
              content: 'Operation error'
            })

            // Push error message box
            if (hasContentOrTools) {
              // If previous message had content, keep it clean and push a new AI message for the error box
              newMessages.push({
                role: 'ai',
                content: error,
                isError: true,
                isStreaming: false,
                isThinking: false,
                isConnecting: false,
                toolCalls: []
              })
            } else if (lastMsg && lastMsg.role === 'ai') {
              // If the connecting message was empty, just convert it to show the error
              newMessages[lastMsgIndex] = {
                ...newMessages[lastMsgIndex],
                isError: true,
                content: error
              }
            } else {
              // Fallback: push a new AI message for the error box
              newMessages.push({
                role: 'ai',
                content: error,
                isError: true,
                isStreaming: false,
                isThinking: false,
                isConnecting: false,
                toolCalls: []
              })
            }
          }

          return newMessages
        })
      }
    })

    const removeFallbackListener = window.api.onChatFallbackActivated((data) => {
      const { chatId, newModel } = data
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.length - 1
          const lastMsg = newMessages[lastMsgIndex]
          if (lastMsg && lastMsg.role === 'ai') {
            newMessages[lastMsgIndex] = {
              ...lastMsg,
              isStreaming: false,
              isThinking: false,
              isConnecting: false
            }
          }
          newMessages.push({
            role: 'separator',
            separatorType: 'fallback',
            content: `Fallback to ${newModel}`
          })
          newMessages.push({
            role: 'ai',
            content: '',
            thoughts: '',
            isStreaming: true,
            isThinking: false,
            isConnecting: true,
            toolCalls: []
          })
          return newMessages
        })
      }
    })

    const removeToolStartListener = window.api.onToolStart((data) => {
      const { chatId } = data
      if (chatId === currentChatIdRef.current) {
        const taskId = crypto.randomUUID()
        const newTask: Task = {
          ...data,
          id: taskId,
          status: 'running',
          timestamp: data.timestamp ? new Date(data.timestamp) : new Date()
        }
        setTasks((prev) => [...prev, newTask])

        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsgIndex = newMessages.findLastIndex((msg) => msg.role === 'ai')

          if (lastMsgIndex !== -1) {
            const lastMsg = { ...newMessages[lastMsgIndex] }
            const toolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []

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
          return newMessages
        })
      }
    })

    const removeToolEndListener = window.api.onToolEnd((data) => {
      const { chatId } = data
      if (chatId === currentChatIdRef.current) {
        setTasks((prev) => {
          const newTasks = [...prev]
          const lastTaskIndex = newTasks.findLastIndex(
            (t) => t.name === data.name && t.status === 'running'
          )
          if (lastTaskIndex !== -1) {
            newTasks[lastTaskIndex] = {
              ...newTasks[lastTaskIndex],
              status: data.result.startsWith('Error') ? 'error' : 'done',
              result: data.result
            }
          }
          return newTasks
        })

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
              toolCalls[lastToolIndex] = {
                ...toolCalls[lastToolIndex],
                status: data.result.startsWith('Error') ? 'error' : 'done',
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
        setTasks((prev) => {
          const newTasks = [...prev]
          const taskIndex = newTasks.findLastIndex(
            (t) =>
              t.name === data.toolCallName &&
              (t.status === 'running' || t.status === 'writing' || t.status === 'done')
          )
          if (taskIndex !== -1) {
            const task = { ...newTasks[taskIndex] }
            if (data.toolCallName === 'web_search' && data.update.searchTitle) {
              task.searchUpdates = [...(task.searchUpdates || []), data.update.searchTitle]
            } else if (data.update.agentIndex !== undefined) {
              const prevUpdate = task.agentUpdates?.[data.update.agentIndex]
              const newPhase = data.update.phase || prevUpdate?.phase || 'thinking'
              task.agentUpdates = {
                ...(task.agentUpdates || {}),
                [data.update.agentIndex]: {
                  phase: newPhase,
                  command: data.update.command ?? prevUpdate?.command,
                  output: data.update.output ?? prevUpdate?.output
                }
              }
            }
            newTasks[taskIndex] = task
          }
          return newTasks
        })

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
                  toolCall.searchUpdates = [...(toolCall.searchUpdates || []), data.update.searchTitle]
                } else if (data.update.agentIndex !== undefined) {
                  const prevUpdate = toolCall.agentUpdates?.[data.update.agentIndex]
                  const newPhase = data.update.phase || prevUpdate?.phase || 'thinking'
                  toolCall.agentUpdates = {
                    ...(toolCall.agentUpdates || {}),
                    [data.update.agentIndex]: {
                      phase: newPhase,
                      command: data.update.command ?? prevUpdate?.command,
                      output: data.update.output ?? prevUpdate?.output
                    }
                  }
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

    const removeSubagentMessageListener = window.api.onSubagentMessage((data) => {
      const { chatId } = data
      if (chatId === currentChatIdRef.current) {
        setTasks((prev) => {
          const newTasks = [...prev]
          const taskIndex = newTasks.findLastIndex(
            (t) => t.name === 'run_subagents' && (t.status === 'running' || t.status === 'done')
          )
          if (taskIndex !== -1) {
            const task = { ...newTasks[taskIndex] }
            task.subagentMessages = [...(task.subagentMessages || []), data]
            newTasks[taskIndex] = task
          }
          return newTasks
        })

        setMessages((prev) => {
          const newMessages = [...prev]
          for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i]
            if (msg.role === 'ai' && msg.toolCalls) {
              const toolCallIndex = msg.toolCalls.findLastIndex(
                (t) => t.name === 'run_subagents' && (t.status === 'running' || t.status === 'done')
              )
              if (toolCallIndex !== -1) {
                const lastMsg = { ...msg }
                const toolCalls = [...(lastMsg.toolCalls || [])]
                const toolCall = { ...toolCalls[toolCallIndex] }
                toolCall.subagentMessages = [...(toolCall.subagentMessages || []), data]
                toolCalls[toolCallIndex] = toolCall
                lastMsg.toolCalls = toolCalls
                newMessages[i] = lastMsg
                return newMessages
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

    return () => {
      removeChatStartListener()
      removeChatChunkListener()
      removeChatEndListener()
      removeChatErrorListener()
      removeToolStartListener()
      removeToolEndListener()
      removeToolUpdateListener()
      removeSubagentMessageListener()
      removeFallbackListener()
      removeTitleReceivedListener()
      if (titleIntervalRef.current) {
        clearInterval(titleIntervalRef.current)
        titleIntervalRef.current = null
      }
    }
  }, [])

  const renderedMessages = useMemo(() => {
    if (messages.length === 0) return null
    return (
      <div className="w-full flex flex-col max-w-[860px] mx-auto">
        {messages.map((msg, i) => {
          if (msg.role === 'separator') {
            return (
              <div
                key={i}
                className="w-full flex items-center gap-4 px-4 sm:px-8 py-3 select-none animate-message"
              >
                <div className="flex-grow border-t border-dashed border-white/[0.08]" />
                <span className="shrink-0 px-4 text-[10px] font-mono tracking-widest text-text-secondary/60 uppercase">
                  {msg.content}
                </span>
                <div className="flex-grow border-t border-dashed border-white/[0.08]" />
              </div>
            )
          }

          return (
            <div key={i} className="flex flex-col w-full transition-all duration-700">
              <div
                className={clsx(
                  'w-full px-4 sm:px-8 py-5 flex flex-col transition-all duration-700 animate-message',
                  msg.role === 'user' ? 'items-end' : 'items-start'
                )}
              >
                {msg.role === 'ai' && (msg.isThinking || msg.thoughts) && (
                  <div className="w-full mb-2">
                    <details className="group w-full select-none">
                      <summary
                        className={clsx(
                          'inline-flex items-center gap-2 text-[12.5px] py-1 select-none transition-all duration-200 cursor-pointer text-text-secondary/60 hover:text-text-secondary/90 list-none [&::-webkit-details-marker]:hidden'
                        )}
                      >
                        <Brain
                          size={13}
                          className={clsx(
                            'text-text-secondary/50 transition-all duration-300',
                            msg.isThinking && 'animate-pulse text-accent-secondary/70'
                          )}
                        />

                        <span className="font-medium leading-none">
                          {(() => {
                            // Extract bold outlines like "**Initiating Black Hole Analysis**"
                            const outlineMatches = Array.from(
                              (msg.thoughts || '').matchAll(/\*\*(.*?)\*\*/g)
                            )
                            if (outlineMatches.length > 0) {
                              // Take the last match to show current thinking step
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
                          {msg.thoughts || ''}
                        </ReactMarkdown>
                      </div>
                    </details>
                  </div>
                )}

                <div
                  className={clsx(
                    'w-full',
                    msg.role === 'user' ? 'flex flex-col items-end' : 'text-text-primary'
                  )}
                >
                  {msg.role === 'ai' ? (
                    <AiMessage
                      msg={msg}
                      currentChatId={currentChatId}
                      handleLoadChat={handleLoadChat}
                      markdownComponents={markdownComponents}
                      modelSelectorRef={modelSelectorRef}
                      setIsApiKeyModalOpen={setIsApiKeyModalOpen}
                    />
                  ) : (
                    <div className="flex flex-col items-end gap-2.5 max-w-[92%] sm:max-w-[78%] lg:max-w-[68%]">
                      {(msg.screenshot || (msg.file && msg.file.mimeType.startsWith('image/'))) && (
                        <div className="relative rounded-[16px] overflow-hidden border border-white/[0.085] bg-black/10 shadow-xl max-w-full sm:max-w-[320px] hover:border-white/[0.16] transition-all duration-300">
                          <img
                            src={
                              msg.file && msg.file.mimeType.startsWith('image/')
                                ? `data:${msg.file.mimeType};base64,${msg.file.data}`
                                : `data:image/png;base64,${msg.screenshot}`
                            }
                            alt={msg.file ? msg.file.name : 'Image'}
                            className="w-full h-auto cursor-zoom-in block"
                            onClick={() => {
                              const imgSrc =
                                msg.file && msg.file.mimeType.startsWith('image/')
                                  ? `data:${msg.file.mimeType};base64,${msg.file.data}`
                                  : `data:image/png;base64,${msg.screenshot}`
                              const newWin = window.open()
                              newWin?.document.write(`
                                <body style="margin: 0; background: #0b0c0f; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
                                  <img src="${imgSrc}" style="max-width: 100%; max-height: 100vh; object-fit: contain; box-shadow: 0 20px 50px rgba(0,0,0,0.5);" />
                                </body>
                              `)
                            }}
                          />
                        </div>
                      )}
                      {msg.file && !msg.file.mimeType.startsWith('image/') && (
                        <div className="premium-panel-soft flex items-center gap-3 px-4 py-2.5 rounded-[16px] border border-white/[0.07] bg-white/[0.02] shadow-md select-none max-w-full sm:max-w-[280px]">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-text-secondary">
                            {msg.file.mimeType === 'application/pdf' ? (
                              <FilePdf size={20} className="text-status-error" />
                            ) : (
                              <FilePpt size={20} className="text-accent-primary" />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span
                              className="text-xs font-semibold text-text-primary truncate max-w-[170px]"
                              title={msg.file.name}
                            >
                              {msg.file.name}
                            </span>
                            <span className="text-[10px] text-text-secondary/60">
                              {msg.file.mimeType === 'application/pdf'
                                ? 'PDF Document'
                                : 'Presentation'}
                            </span>
                          </div>
                        </div>
                      )}
                      {msg.content && (
                        <div className="premium-panel-soft w-full rounded-[18px] rounded-tr-md px-4 py-3 text-sm md:text-base text-text-primary prose prose-invert prose-p:leading-relaxed prose-pre:bg-background-secondary prose-pre:border prose-pre:border-surface/50 prose-code:font-mono prose-code:text-[12px] prose-p:font-light prose-p:text-sm md:prose-p:text-base prose-li:text-sm md:prose-li:text-base max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[
                              remarkGfm,
                              remarkMath,
                              disableIndentedCode as unknown as import('unified').Pluggable
                            ]}
                            rehypePlugins={[rehypeRaw, rehypeParseMath, rehypeKatex]}
                            components={MarkdownComponents}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
    setIsApiKeyModalOpen
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
      <>
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        <Sidebar
          isOpen={isSidebarOpen}
          activeView={activeView}
          onViewChange={(view) => {
            setActiveView(view)
            setIsSidebarOpen(false)
          }}
          onLoadChat={(id) => {
            handleLoadChat(id)
            setIsSidebarOpen(false)
          }}
          onNewChat={(force) => {
            handleNewChat(force)
            setIsSidebarOpen(false)
          }}
          currentChatId={currentChatId}
          runningTasksCount={tasks.filter((t) => t.status === 'running').length}
          runningChats={runningChats}
          config={config}
          onOpenSearch={() => {
            setIsSearchModalOpen(true)
            setIsSidebarOpen(false)
          }}
        />
      </>
    )
  }, [
    activeView,
    isSidebarOpen,
    handleLoadChat,
    handleNewChat,
    currentChatId,
    tasks,
    runningChats,
    config
  ])

  const isKeyMissing =
    !config?.userGeminiKey && (config?.envGeminiKey === 'none' || !config?.envGeminiKey)

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

  if (route === '#subagents') {
    return <SubagentChat />
  }

  if (route === '#subagent-settings') {
    return <SubagentModelSettings />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-main font-sans selection:bg-accent-primary/30 pt-10">
      {showIntro && (
        <IntroScreen onComplete={() => setShowIntro(false)} username={config?.username} />
      )}
      <TitleBar title={currentChatTitle || undefined} isStreaming={isTitleStreaming} />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
        initialValue={config?.userGeminiKey || ''}
      />
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onOpenChat={handleLoadChat}
      />
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

      <main className="flex-1 flex flex-col relative z-10 min-w-0 h-full">
        {activeView === 'chat' && messages.length > 0 && !isFullscreenInput && (
          <button
            onClick={() => {
              handleNewChat()
              setIsSidebarOpen(false)
            }}
            className="absolute right-5 top-4 z-30 flex h-9 items-center gap-2 rounded-xl border border-white/[0.065] bg-white/[0.026] px-3.5 text-xs font-medium text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-md transition-all duration-300 hover:bg-white/[0.065] hover:text-text-primary hover:border-white/[0.1] active:scale-[0.97] animate-fade-in rgb-new-chat-btn"
            title="New Chat (Ctrl+N)"
          >
            <Plus size={14} weight="bold" className="text-accent-primary" />
            <span>New Chat</span>
          </button>
        )}
        {activeView === 'chat' && isFullscreenInput ? (
          <div className="flex-1 flex flex-col h-full bg-background-main">
            <InputBar
              ref={inputBarRef}
              onSend={handleSend}
              onCancel={handleCancel}
              isProcessing={isProcessing}
              isKeyMissing={isKeyMissing}
              isThinkMode={isThinkMode}
              onThinkModeToggle={handleThinkModeToggle}
              disabled={isProcessing || isKeyMissing}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
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
              onOpenSubagentModal={() => setIsSubagentModalOpen(true)}
              onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
              activeWorkflow={activeWorkflow}
              setActiveWorkflow={setActiveWorkflow}
            />
          </div>
        ) : (
          <>
            {/* Chat View */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className={clsx(
                'flex-1 overflow-y-auto flex flex-col',
                activeView !== 'chat' && 'hidden'
              )}
            >
              <div
                ref={contentRef}
                className={clsx(
                  'flex-grow flex flex-col pt-6',
                  messages.length > 0 ? 'pb-40' : 'pb-8'
                )}
              >
                {isKeyMissing && <MissingKeyBanner onAddKey={() => setIsApiKeyModalOpen(true)} />}
                {messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-4 pb-[8vh] relative select-none">
                    {/* Radial glow similar to the image */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="relative h-[320px] w-[560px] max-w-[calc(100vw-48px)] blur-[96px] opacity-[0.55]">
                        {/* Default single glow for non-rgb themes */}
                        <div className="absolute inset-0 rounded-full home-radial-glow rgb-glow-default" />
                        {/* Custom RGB animatable glows with smooth opacity transitions */}
                        <div className="absolute inset-0 rounded-full rgb-glow-red" />
                        <div className="absolute inset-0 rounded-full rgb-glow-green" />
                        <div className="absolute inset-0 rounded-full rgb-glow-blue" />
                      </div>
                    </div>

                    <div className="relative z-10 flex flex-col items-center w-full max-w-[820px] text-center gap-6">
                      <h1 className="text-[26px] sm:text-[32px] font-light text-text-primary/90 select-none leading-tight">
                        {getGreeting()}
                      </h1>

                      <div className="w-full">
                        <InputBar
                          ref={inputBarRef}
                          onSend={handleSend}
                          onCancel={handleCancel}
                          isProcessing={isProcessing}
                          isKeyMissing={isKeyMissing}
                          isThinkMode={isThinkMode}
                          onThinkModeToggle={handleThinkModeToggle}
                          disabled={isProcessing || isKeyMissing}
                          selectedModel={selectedModel}
                          onModelChange={handleModelChange}
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
                          onOpenSubagentModal={() => setIsSubagentModalOpen(true)}
                          onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
                          activeWorkflow={activeWorkflow}
                          setActiveWorkflow={setActiveWorkflow}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  renderedMessages
                )}
              </div>
            </div>

            {/* Monitoring (Tasks) View */}
            <div
              className={clsx(
                'flex-1 overflow-y-auto flex flex-col',
                activeView !== 'tasks' && 'hidden'
              )}
            >
              <Tasks tasks={tasks} />
            </div>

            {/* Settings View */}
            {activeView === 'settings' && <SettingsView />}

            {/* View Coming Soon (Fallback) */}
            {activeView !== 'chat' && activeView !== 'tasks' && activeView !== 'settings' && (
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
                  isThinkMode={isThinkMode}
                  onThinkModeToggle={handleThinkModeToggle}
                  disabled={isProcessing || isKeyMissing}
                  selectedModel={selectedModel}
                  onModelChange={handleModelChange}
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
                  onOpenSubagentModal={() => setIsSubagentModalOpen(true)}
                  onOpenYoutubeModal={() => setIsYoutubeModalOpen(true)}
                  activeWorkflow={activeWorkflow}
                  setActiveWorkflow={setActiveWorkflow}
                />
              </div>
            )}
          </>
        )}
      </main>
      <DownloadProgressOverlay downloads={visibleDownloads} />
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
      <SubagentDelegationModal
        isOpen={isSubagentModalOpen}
        onClose={() => setIsSubagentModalOpen(false)}
        defaultSubagentModel={config?.subagentModel || 'prism-6-dragon'}
        onDelegate={(data) => {
          handleSend(`[MANUAL_SUBAGENTS]${JSON.stringify(data)}`)
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
          handleSend(msg, undefined, undefined, undefined, undefined, true)
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
