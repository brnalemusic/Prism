import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import { LoadingDots } from './components/LoadingDots'
import { Spinner } from './components/Spinner'
import { ActionLoader, ToolCall } from './components/ActionLoader'
import { ModelSelector, ModelSelectorHandle } from './components/ModelSelector'
import { Tasks } from './components/Tasks'
import { QuickLauncher } from './components/QuickLauncher'
import { TitleBar } from './components/TitleBar'
import { ErrorMessage } from './components/ErrorMessage'
import { SettingsView } from './components/SettingsView'
import { ApiKeyModal } from './components/ApiKeyModal'
import { MissingKeyBanner } from './components/MissingKeyBanner'
import { SubagentChat } from './components/SubagentChat'
import { SubagentModelSettings } from './components/SubagentModelSettings'
import { MiniAppRenderer } from './components/MiniAppRenderer'
import { TtsButton } from './components/TtsButton'
import { CopyMessageButton } from './components/CopyMessageButton'
import { ErrorPopup } from './components/ErrorPopup'
import { triggerErrorPopup } from './utils'
import clsx from 'clsx'
import { ArrowDown, Menu } from 'lucide-react'
import { AppConfig } from '../../main/config'

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

interface Message {
  role: 'user' | 'ai'
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
}

interface Task extends ToolCall {
  id: string
  timestamp: Date
}

function App(): React.JSX.Element {
  const [showIntro, setShowIntro] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

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
      const removeListener = window.api.onMiniAppData((data) => {
        setMiniAppData(data)
      })
      return () => removeListener()
    }
    return undefined
  }, [])

  const [isProcessing, setIsProcessing] = useState(false)
  const [attachedScreenshot, setAttachedScreenshot] = useState<string | null>(null)
  const attachedScreenshotRef = useRef<string | null>(null)
  useEffect(() => {
    attachedScreenshotRef.current = attachedScreenshot
  }, [attachedScreenshot])
  const [isFinishing, setIsFinishing] = useState(false)
  const [isFocused, setIsFocused] = useState(true)
  const [selectedModel, setSelectedModel] = useState('prism-5')
  const [activeView, setActiveView] = useState('chat')
  const [currentChatId, setCurrentChatId] = useState<string | undefined>(undefined)
  const [runningChats, setRunningChats] = useState<Record<string, boolean>>({})
  const currentChatIdRef = useRef<string | undefined>(undefined)
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isYoutubeMode, setIsYoutubeMode] = useState(false)
  const [isThinkMode, setIsThinkMode] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [inputText, setInputText] = useState('')
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isExtendedSearch, setIsExtendedSearch] = useState(false)
  const [isFullscreenInput, setIsFullscreenInput] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

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

  const isExtendedSearchRef = useRef(isExtendedSearch)
  useEffect(() => {
    isExtendedSearchRef.current = isExtendedSearch
  }, [isExtendedSearch])

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
    const handleFocus = (): void => setIsFocused(true)
    const handleBlur = (): void => setIsFocused(false)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
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

  const route = window.location.hash
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const inputBarRef = useRef<InputBarHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)

  const getGreeting = (): string => {
    const rawName = config?.username || 'user'
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    return `Hello, ${formattedName}. What are we working on?`
  }

  const handleThinkModeToggle = useCallback((val: boolean) => {
    window.api.setThinkMode(val)
  }, [])

  const handleSearchEnabledToggle = useCallback((val: boolean) => {
    window.api.setSearchEnabled(val)
  }, [])

  const handleExtendedSearchToggle = useCallback((val: boolean) => {
    window.api.setExtendedSearch(val)
  }, [])

  const handleSend = useCallback(
    (
      text: string,
      thinkMode?: boolean,
      searchEnabled?: boolean,
      extendedSearch?: boolean,
      screenshot?: string
    ): void => {
      if (isProcessingRef.current) return

      setIsProcessing(true)
      isProcessingRef.current = true
      setIsYoutubeMode(text.startsWith('/youtube'))

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
      if (extendedSearch !== undefined) {
        window.api.setExtendedSearch(extendedSearch)
        setIsExtendedSearch(extendedSearch)
        isExtendedSearchRef.current = extendedSearch
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

      const activeScreenshot = screenshot || attachedScreenshotRef.current

      // Para a UI, removemos a tag feia se ela existir
      const displayContent = text.replace(/^\[FORCE_SEARCH\]\s*/i, '')
      setMessages((prev) => [...prev, { role: 'user', content: displayContent, screenshot: activeScreenshot || undefined }])

      // If search is enabled, ensure [FORCE_SEARCH] is prefixed for API
      let apiMessage = text
      const targetSearchEnabled = searchEnabled ?? isSearchEnabledRef.current
      if (targetSearchEnabled && !apiMessage.startsWith('[FORCE_SEARCH]')) {
        apiMessage = `[FORCE_SEARCH] ${apiMessage}`
      }

      // Para a API, enviamos o texto original, thinkMode e o extendedSearch
      window.api.sendChatMessage({
        message: apiMessage,
        thinkMode: thinkMode ?? isThinkModeRef.current,
        extendedSearch: extendedSearch ?? isExtendedSearchRef.current,
        chatId,
        screenshot: activeScreenshot || undefined
      })

      setAttachedScreenshot(null)
    },
    []
  )

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth'): void => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior
      })
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior })
    }
  }

  const handleScroll = (): void => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const atBottom = scrollHeight - scrollTop - clientHeight < 50
    isAtBottomRef.current = atBottom

    setShowScrollButton(!atBottom && scrollHeight > clientHeight)
  }

  const handleModelChange = useCallback((newModel: string): void => {
    setSelectedModel(newModel)
    window.api.setModel(newModel)
  }, [])

  const handleOpenSubagentSettings = useCallback((): void => {
    window.api.openSubagentSettingsWindow()
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

        for (const m of history) {
          if (m.role === 'system') continue

          let text = ''
          let screenshot: string | undefined = undefined

          if (m.parts) {
            for (const part of m.parts) {
              if (part.text) {
                text += part.text
              } else if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                screenshot = part.inlineData.data
              }
            }
          }

          const isSystemResults = m.role === 'user' && text.startsWith('[SYSTEM: TOOL RESULTS]')

          if (isSystemResults) {
            // Find last AI message to attach results
            const lastAiMsg = [...mappedMessages].reverse().find((m) => m.role === 'ai')
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

          if (m.role === 'user') {
            mappedMessages.push({
              role: 'user',
              content: text,
              screenshot,
              isStreaming: false
            })
          } else if (m.role === 'model') {
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
              const tcContent = toolMatch[1]
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
  }, [])

  useEffect(() => {
    // Listen for launcher messages
    const removeLauncherListener = window.api.onLauncherMessage((data: any) => {
      setActiveView('chat')
      // If launcher message arrives with the tag, handleSend will take care of hiding it in the UI
      handleSend(data.message, data.thinkMode, undefined, undefined, data.screenshot)
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

    const removeExtendedSearchListener = window.api.onExtendedSearchChanged((val) => {
      setIsExtendedSearch(val)
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
      if (data.extendedSearch !== undefined) {
        window.api.setExtendedSearch(data.extendedSearch)
        setIsExtendedSearch(data.extendedSearch)
      }

      setTimeout(() => {
        handleSend(data.instructions, data.thinkMode, data.searchEnabled, data.extendedSearch)
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
      removeExtendedSearchListener()
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

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    const isUserMsg = lastMessage?.role === 'user'
    const isAiStreaming = lastMessage?.role === 'ai' && lastMessage?.isStreaming

    if (isAtBottomRef.current || isUserMsg) {
      scrollToBottom(isAiStreaming ? 'auto' : 'smooth')
      isAtBottomRef.current = true
      setShowScrollButton(false)
    }
  }, [messages])

  useEffect(() => {
    // Set up IPC listeners from our Context Bridge
    const removeChatStartListener = window.api.onChatStart((data) => {
      const { chatId } = data
      setRunningChats((prev) => ({ ...prev, [chatId]: true }))
      if (chatId === currentChatIdRef.current) {
        setIsProcessing(true)
        setIsFinishing(false)
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
      if (chatId === currentChatIdRef.current) {
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg && lastMsg.role === 'ai' && lastMsg.isStreaming) {
            lastMsg.thoughts = thoughts
            lastMsg.content = finalResponse
            lastMsg.usedFallback = usedFallback
            lastMsg.isThinking = isThinking
            lastMsg.isWritingToolCall = isWritingToolCall
            lastMsg.toolType = toolType
            lastMsg.isConnecting = false
          }
          return newMessages
        })
      }
    })

    const removeChatEndListener = window.api.onChatEnd((data) => {
      const { chatId, thoughts, finalResponse, usedFallback } = data
      setRunningChats((prev) => ({ ...prev, [chatId]: false }))
      if (chatId === currentChatIdRef.current) {
        setIsProcessing(false)
        setIsYoutubeMode(false)
        setIsFinishing(true)
        setTimeout(() => setIsFinishing(false), 2000)

        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg && lastMsg.role === 'ai') {
            lastMsg.thoughts = thoughts
            lastMsg.content = finalResponse
            lastMsg.usedFallback = usedFallback
            lastMsg.isStreaming = false
            lastMsg.isThinking = false
            lastMsg.isWritingToolCall = false
            lastMsg.isConnecting = false
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
          return
        }

        const isCancel = error.includes('cancelled')
        if (!isCancel) {
          triggerErrorPopup(error)
        }

        if (isCancel) {
          setTasks((prev) =>
            prev.map((t) => (t.status === 'running' ? { ...t, status: 'cancelled' } : t))
          )
        }

        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]

          // Cleanup running tool calls in last message
          if (isCancel && lastMsg && lastMsg.role === 'ai' && lastMsg.toolCalls) {
            lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
              tc.status === 'running'
                ? { ...tc, status: 'cancelled', result: 'Cancelled by user.' }
                : tc
            )
          }

          // If the last message is already the SAME error, do not duplicate
          if (lastMsg && lastMsg.isError && lastMsg.content === error) {
            return prev
          }

          // If the last message is AI and was processing, update it with the error
          if (lastMsg && lastMsg.role === 'ai' && (lastMsg.isStreaming || lastMsg.isThinking)) {
            lastMsg.content = error
            lastMsg.isStreaming = false
            lastMsg.isThinking = false
            lastMsg.isConnecting = false
            lastMsg.isError = true
          } else {
            // If there is no active AI message, create a new one for the error
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
            (t) => t.name === data.toolCallName && (t.status === 'running' || t.status === 'done')
          )
          if (taskIndex !== -1) {
            const task = { ...newTasks[taskIndex] }
            const prevUpdate = task.agentUpdates?.[data.update.agentIndex]
            task.agentUpdates = {
              ...(task.agentUpdates || {}),
              [data.update.agentIndex]: {
                ...prevUpdate,
                ...data.update
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
                  t.name === data.toolCallName && (t.status === 'running' || t.status === 'done')
              )
              if (toolCallIndex !== -1) {
                const lastMsg = { ...msg }
                const toolCalls = [...(lastMsg.toolCalls || [])]
                const toolCall = { ...toolCalls[toolCallIndex] }
                const prevUpdate = toolCall.agentUpdates?.[data.update.agentIndex]
                toolCall.agentUpdates = {
                  ...(toolCall.agentUpdates || {}),
                  [data.update.agentIndex]: {
                    ...prevUpdate,
                    ...data.update
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

    return () => {
      removeChatStartListener()
      removeChatChunkListener()
      removeChatEndListener()
      removeChatErrorListener()
      removeToolStartListener()
      removeToolEndListener()
      removeToolUpdateListener()
      removeSubagentMessageListener()
    }
  }, [])

  const renderAiMessage = useCallback((msg: Message): React.JSX.Element | null => {
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
        <div className="flex items-center gap-2 text-text-secondary/70 font-mono text-[13px] py-2">
          <Spinner size="sm" />
          <span>Connecting...</span>
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

    return (
      <div
        className={clsx(
          'flex flex-col gap-4 w-full max-w-none transition-opacity duration-500',
          msg.isStreaming && 'opacity-90'
        )}
      >
        <div className="flex flex-col gap-2 relative">
          {parts.map((part, index) => {
            if (part.startsWith('<tool_call>')) {
              if (part.includes('</tool_call>')) {
                const tc = msg.toolCalls?.[toolCallIndex]
                toolCallIndex++
                if (tc) {
                  return <ActionLoader key={`tc-${index}`} toolCall={tc} />
                }
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
                    rehypePlugins={[rehypeRaw, rehypeParseMath, rehypeKatex]}
                    components={MarkdownComponents}
                  >
                    {part}
                  </ReactMarkdown>
                </div>
              )
            }
            return null
          })}

          {msg.isWritingToolCall && (
            <ActionLoader
              key="writing-tc"
              toolCall={{
                name: msg.toolType || 'task',
                status: 'writing',
                args: {}
              }}
            />
          )}

          {msg.isStreaming && !msg.isThinking && !msg.isWritingToolCall && (
            <div className="flex items-center gap-1.5 py-1">
              <span className="text-accent-secondary animate-pulse font-bold text-xl leading-none">
                ▋
              </span>
            </div>
          )}

          {!msg.isStreaming && msg.content && (
            <div className="flex justify-start items-center gap-2 mt-2">
              <TtsButton text={msg.content} />
              <CopyMessageButton text={msg.content} />
            </div>
          )}
        </div>
      </div>
    )
  }, [])

  const renderedMessages = useMemo(() => {
    if (messages.length === 0) return null
    return (
      <div className="w-full flex flex-col max-w-4xl mx-auto">
        {messages.map((msg, i) => {
          return (
            <div key={i} className="flex flex-col w-full transition-all duration-700">
              <div
                className={clsx(
                  'w-full px-6 sm:px-12 py-8 flex flex-col transition-all duration-700 animate-message',
                  msg.role === 'user' ? 'items-end' : 'items-start'
                )}
              >
                {msg.role === 'ai' && (msg.isThinking || msg.thoughts) && (
                  <div className="w-full">
                    <details
                      className={clsx(
                        'group mb-4 w-full overflow-hidden rounded-[22px] border transition-all duration-300 bubble-glow',
                        msg.isThinking
                          ? 'border-accent-secondary/30 bg-accent-secondary/[0.045] backdrop-blur-xl'
                          : 'border-white/[0.08] bg-white/[0.035] backdrop-blur-xl'
                      )}
                    >
                      <summary
                        className={clsx(
                          'flex cursor-pointer list-none items-center px-4 py-3 font-mono text-[11px] font-semibold transition-colors',
                          msg.isThinking
                            ? 'text-accent-secondary'
                            : 'text-text-secondary/75 hover:text-text-primary/90'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          {msg.isThinking && <LoadingDots size="xs" />}
                          {(() => {
                            // Extract bold outlines like "**Initiating Black Hole Analysis**"
                            // We look for all occurrences of **Text** and take the last one or the first one,
                            // depending on what's active. Let's extract all matches.
                            const outlineMatches = Array.from(
                              (msg.thoughts || '').matchAll(/\*\*(.*?)\*\*/g)
                            )
                            if (outlineMatches.length > 0) {
                              // Take the last match to show current thinking step
                              return outlineMatches[outlineMatches.length - 1][1]
                            }
                            return 'Thinking'
                          })()}
                        </span>
                      </summary>
                      <div
                        className={clsx(
                          'mx-3 mb-3 rounded-[16px] border px-4 py-3 font-mono text-[11.5px] leading-relaxed opacity-0 transition-all duration-500 group-open:opacity-100',
                          msg.isThinking
                            ? 'border-accent-secondary/20 bg-accent-secondary/[0.035] text-accent-secondary/80'
                            : 'border-white/[0.055] bg-black/10 text-text-secondary/80'
                        )}
                      >
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
                    renderAiMessage(msg)
                  ) : (
                    <div className="flex flex-col items-end gap-2.5 max-w-[90%] sm:max-w-[80%] lg:max-w-[70%]">
                      {msg.screenshot && (
                        <div className="relative rounded-[20px] overflow-hidden border border-white/10 bg-black/10 shadow-xl max-w-full sm:max-w-[320px] hover:border-white/20 transition-all duration-300">
                          <img
                            src={`data:image/png;base64,${msg.screenshot}`}
                            alt="Screenshot"
                            className="w-full h-auto cursor-zoom-in block"
                            onClick={() => {
                              const newWin = window.open()
                              newWin?.document.write(`
                                <body style="margin: 0; background: #0b0c0f; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
                                  <img src="data:image/png;base64,${msg.screenshot}" style="max-width: 100%; max-height: 100vh; object-fit: contain; box-shadow: 0 20px 50px rgba(0,0,0,0.5);" />
                                </body>
                              `)
                            }}
                          />
                        </div>
                      )}
                      {msg.content && (
                        <div className="premium-panel-soft w-full whitespace-pre-wrap rounded-[24px] rounded-tr-[8px] px-5 py-3.5 text-sm md:text-base font-medium text-text-primary">
                          {msg.content}
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
  }, [messages, renderAiMessage])

  const renderedSidebarDesktop = useMemo(() => {
    return (
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onLoadChat={handleLoadChat}
        onNewChat={handleNewChat}
        currentChatId={currentChatId}
        runningTasksCount={tasks.filter((t) => t.status === 'running').length}
        runningChats={runningChats}
        className="hidden md:flex shrink-0"
      />
    )
  }, [activeView, handleLoadChat, handleNewChat, currentChatId, tasks, runningChats])

  const renderedSidebarMobile = useMemo(() => {
    return (
      <Sidebar
        activeView={activeView}
        onViewChange={(view) => {
          setActiveView(view)
          setIsMobileMenuOpen(false)
        }}
        onLoadChat={(id) => {
          handleLoadChat(id)
          setIsMobileMenuOpen(false)
        }}
        onNewChat={(force) => {
          handleNewChat(force)
          setIsMobileMenuOpen(false)
        }}
        currentChatId={currentChatId}
        runningTasksCount={tasks.filter((t) => t.status === 'running').length}
        runningChats={runningChats}
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex border-r border-white/[0.08] bg-background-main/95 transition-transform duration-300 md:hidden w-[278px]',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      />
    )
  }, [
    activeView,
    isMobileMenuOpen,
    handleLoadChat,
    handleNewChat,
    currentChatId,
    tasks,
    runningChats
  ])

  const renderedModelSelector = useMemo(() => {
    return (
      <ModelSelector
        ref={modelSelectorRef}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        disabled={isProcessing}
      />
    )
  }, [selectedModel, handleModelChange, isProcessing])

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
      {showIntro && <IntroScreen onComplete={() => setShowIntro(false)} />}
      <TitleBar />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
        initialValue={config?.userGeminiKey || ''}
      />
      <PrismBackground
        isFocused={isFocused}
        isProcessing={isProcessing}
        isFinishing={isFinishing}
        isYoutubeMode={isYoutubeMode}
      />

      {renderedSidebarDesktop}

      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer Sidebar */}
      {renderedSidebarMobile}

      <main className="flex-1 flex flex-col relative z-10 min-w-0 h-full">
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
              onOpenSubagentSettings={handleOpenSubagentSettings}
              disabled={isProcessing || isKeyMissing}
              selectedModel={selectedModel}
              text={inputText}
              setText={setInputText}
              isSearchEnabled={isSearchEnabled}
              setIsSearchEnabled={handleSearchEnabledToggle}
              isExtendedSearch={isExtendedSearch}
              setIsExtendedSearch={handleExtendedSearchToggle}
              isFullscreen={true}
              onFullscreenToggle={() => setIsFullscreenInput(false)}
              screenshot={attachedScreenshot}
              onRemoveScreenshot={() => setAttachedScreenshot(null)}
              onAttachScreenshot={(base64) => setAttachedScreenshot(base64)}
            />
          </div>
        ) : (
          <>
            {/* Model Selector Bar */}
            <div className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-white/[0.055] bg-background-main/[0.72] px-6 py-3 backdrop-blur-2xl">
              <div className="flex-1 flex items-center gap-2">
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-all duration-200 md:hidden"
                  title="Menu"
                >
                  <Menu size={16} />
                </button>
                {activeView === 'tasks' && (
                  <span className="ml-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-accent-primary">
                    Monitoring
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">{renderedModelSelector}</div>

              <div className="flex-1 flex justify-end">
                {/* Clear button removed - session management is now in Sidebar */}
              </div>
            </div>

            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto flex flex-col"
            >
              {activeView === 'chat' ? (
                <div className="flex-1 flex flex-col py-8">
                  {isKeyMissing && <MissingKeyBanner onAddKey={() => setIsApiKeyModalOpen(true)} />}
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center px-4 relative select-none">
                      {/* Radial glow similar to the image */}
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="h-[380px] w-[580px] rounded-full bg-[radial-gradient(circle,rgba(30,58,138,0.12)_0%,rgba(49,46,129,0.18)_50%,transparent_100%)] blur-[90px] opacity-80" />
                      </div>

                      <div className="relative z-10 flex flex-col items-center w-full max-w-4xl text-center gap-7">
                        <h1 className="text-[28px] sm:text-[36px] font-light tracking-tight text-white/90 select-none leading-tight">
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
                            onOpenSubagentSettings={handleOpenSubagentSettings}
                            disabled={isProcessing || isKeyMissing}
                            selectedModel={selectedModel}
                            text={inputText}
                            setText={setInputText}
                            isSearchEnabled={isSearchEnabled}
                            setIsSearchEnabled={handleSearchEnabledToggle}
                            isExtendedSearch={isExtendedSearch}
                            setIsExtendedSearch={handleExtendedSearchToggle}
                            isFullscreen={false}
                            onFullscreenToggle={() => setIsFullscreenInput(true)}
                            screenshot={attachedScreenshot}
                            onRemoveScreenshot={() => setAttachedScreenshot(null)}
                            onAttachScreenshot={(base64) => setAttachedScreenshot(base64)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    renderedMessages
                  )}
                </div>
              ) : activeView === 'tasks' ? (
                <Tasks tasks={tasks} />
              ) : activeView === 'settings' ? (
                <SettingsView />
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-secondary">
                  View coming soon...
                </div>
              )}
            </div>

            {activeView === 'chat' && messages.length > 0 && (
              <div className="shrink-0 bg-gradient-to-t from-background-main via-background-main/96 to-transparent pb-6 pt-2 relative">
                {/* Scroll to bottom button */}
                {showScrollButton && (
                  <div className="absolute left-0 right-0 -top-6 flex justify-center pointer-events-none z-20 animate-soft-pop">
                    <button
                      onClick={() => {
                        isAtBottomRef.current = true
                        scrollToBottom('smooth')
                        setShowScrollButton(false)
                      }}
                      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-background-secondary/90 text-text-secondary shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/[0.08] hover:text-text-primary active:scale-95"
                      title="Scroll to bottom"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                )}

                {/* Shadow above input bar */}
                <div
                  className={clsx(
                    'absolute inset-x-0 -top-8 h-8 pointer-events-none bg-gradient-to-t from-black/40 to-transparent transition-opacity duration-300 z-10',
                    showScrollButton ? 'opacity-100' : 'opacity-0'
                  )}
                />

                <InputBar
                  ref={inputBarRef}
                  onSend={handleSend}
                  onCancel={handleCancel}
                  isProcessing={isProcessing}
                  isKeyMissing={isKeyMissing}
                  isThinkMode={isThinkMode}
                  onThinkModeToggle={handleThinkModeToggle}
                  onOpenSubagentSettings={handleOpenSubagentSettings}
                  disabled={isProcessing || isKeyMissing}
                  selectedModel={selectedModel}
                  showModeBadge={false}
                  text={inputText}
                  setText={setInputText}
                  isSearchEnabled={isSearchEnabled}
                  setIsSearchEnabled={handleSearchEnabledToggle}
                  isExtendedSearch={isExtendedSearch}
                  setIsExtendedSearch={handleExtendedSearchToggle}
                  isFullscreen={false}
                  onFullscreenToggle={() => setIsFullscreenInput(true)}
                  screenshot={attachedScreenshot}
                  onRemoveScreenshot={() => setAttachedScreenshot(null)}
                  onAttachScreenshot={(base64) => setAttachedScreenshot(base64)}
                />
              </div>
            )}
          </>
        )}
      </main>
      <ErrorPopup />
    </div>
  )
}

export default App
