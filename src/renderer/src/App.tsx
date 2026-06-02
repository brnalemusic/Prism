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
import { QuestionnaireRenderer } from './components/QuestionnaireRenderer'
import { ModelSelectorHandle } from './components/ModelSelector'
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
import { CaretDown, Plus, Quotes } from '@phosphor-icons/react'
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
  separatorType?: 'fallback' | 'error' | 'cancel'
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
  const [attachedScreenshot, setAttachedScreenshot] = useState<string | null>(null)
  const attachedScreenshotRef = useRef<string | null>(null)
  useEffect(() => {
    attachedScreenshotRef.current = attachedScreenshot
  }, [attachedScreenshot])
  const [isFinishing, setIsFinishing] = useState(false)
  const [isFocused, setIsFocused] = useState(true)
  const [selectedModel, setSelectedModel] = useState('prism-6-super-fast')
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

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

  useEffect(() => {
    if (!config) return

    const updateTheme = () => {
      const isRgbActive = !!(config.rgbThemeExpiry && Date.now() < config.rgbThemeExpiry)
      const themeToApply = (config.theme === 'rgb' && !isRgbActive) ? 'marine' : (config.theme || 'marine')
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
  const isAtBottomRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const inputBarRef = useRef<InputBarHandle>(null)
  const modelSelectorRef = useRef<ModelSelectorHandle>(null)

  const getGreeting = (): React.JSX.Element => {
    const rawName = config?.username || 'user'
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    return (
      <>
        Hello,{' '}
        <span className="font-medium text-accent-primary rgb-chroma-username">
          {formattedName}
        </span>
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
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: displayContent, screenshot: activeScreenshot || undefined }
      ])

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
        screenshot: activeScreenshot || undefined,
        quote: quotedTextRef.current || undefined
      })

      setAttachedScreenshot(null)
      setQuotedText(null)
    },
    []
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth'): void => {
      if (scrollContainerRef.current && activeView === 'chat') {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior
        })
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
        let lastWasFallbackSystem = false
        let fallbackModelName = ''

        for (const m of history) {
          if (m.role === 'system') {
            let systemText = ''
            if (m.parts) {
              for (const part of m.parts) {
                if (part.text) systemText += part.text
              }
            }
            if (systemText.includes('[SYSTEM: FALLBACK]')) {
              lastWasFallbackSystem = true
              const match = systemText.match(
                /(?:activated as|ativado como) (.*?) (?:to continue|para dar continuidade)/i
              )
              fallbackModelName = match ? match[1] : 'Prism AI'
            }
            continue
          }

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
          const lastMsg = newMessages[newMessages.length - 1]

          // Clean up streaming/connecting/thinking flags on the last message if it's AI
          if (lastMsg && lastMsg.role === 'ai') {
            lastMsg.isStreaming = false
            lastMsg.isThinking = false
            lastMsg.isConnecting = false

            // Cleanup running tool calls in last message
            if (isCancel && lastMsg.toolCalls) {
              lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
                tc.status === 'running'
                  ? { ...tc, status: 'cancelled', result: 'Cancelled by user.' }
                  : tc
              )
            }
          }

          const hasContentOrTools =
            lastMsg && lastMsg.role === 'ai' && (lastMsg.content || lastMsg.toolCalls?.length)

          if (isCancel) {
            // Push cancel separator
            newMessages.push({
              role: 'separator',
              separatorType: 'cancel',
              content: 'Cancelado pelo usuário'
            })
          } else {
            // Push error separator
            newMessages.push({
              role: 'separator',
              separatorType: 'error',
              content: 'Erro na operação'
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
              lastMsg.isError = true
              lastMsg.content = error
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
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg && lastMsg.role === 'ai') {
            lastMsg.isStreaming = false
            lastMsg.isThinking = false
            lastMsg.isConnecting = false
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
      removeFallbackListener()
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
                  if (tc.name === 'to_ask') {
                    return (
                      <QuestionnaireRenderer
                        key={`tc-${index}`}
                        toolCall={tc}
                        chatId={currentChatId || ''}
                      />
                    )
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

          {msg.isStreaming && !msg.isThinking && !msg.isWritingToolCall && (
            <div className="flex items-center gap-1.5 py-1">
              <span className="text-accent-secondary animate-pulse font-bold text-xl leading-none">
                ▋
              </span>
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
    )
  }, [])

  const renderedMessages = useMemo(() => {
    if (messages.length === 0) return null
    return (
      <div className="w-full flex flex-col max-w-4xl mx-auto">
        {messages.map((msg, i) => {
          if (msg.role === 'separator') {
            return (
              <div
                key={i}
                className="w-full flex items-center gap-4 px-6 sm:px-12 py-4 select-none animate-message"
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
                        <div className="premium-panel-soft w-full rounded-[24px] rounded-tr-[8px] px-5 py-3.5 text-sm md:text-base text-text-primary prose prose-invert prose-p:leading-relaxed prose-pre:bg-background-secondary prose-pre:border prose-pre:border-surface/50 prose-code:font-mono prose-code:text-[12px] prose-p:font-light prose-p:text-sm md:prose-p:text-base prose-li:text-sm md:prose-li:text-base max-w-none">
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
  }, [messages, renderAiMessage])

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
        />
      </>
    )
  }, [activeView, isSidebarOpen, handleLoadChat, handleNewChat, currentChatId, tasks, runningChats, config])

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
            className="absolute right-6 top-4 z-30 flex h-9 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 text-xs font-medium text-text-secondary shadow-[0_8px_32px_rgba(0,0,0,0.37)] backdrop-blur-md transition-all duration-300 hover:bg-white/[0.08] hover:text-text-primary hover:border-white/[0.1] active:scale-[0.97] animate-fade-in rgb-new-chat-btn"
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
              onOpenSubagentSettings={handleOpenSubagentSettings}
              disabled={isProcessing || isKeyMissing}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
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
                className={clsx(
                  'flex-1 flex flex-col pt-8',
                  messages.length > 0 ? 'pb-36' : 'pb-8'
                )}
              >
                {isKeyMissing && <MissingKeyBanner onAddKey={() => setIsApiKeyModalOpen(true)} />}
                {messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-4 relative select-none">
                    {/* Radial glow similar to the image */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="relative h-[380px] w-[580px] blur-[90px] opacity-80">
                        {/* Default single glow for non-rgb themes */}
                        <div className="absolute inset-0 rounded-full home-radial-glow rgb-glow-default" />
                        {/* Custom RGB animatable glows with smooth opacity transitions */}
                        <div className="absolute inset-0 rounded-full rgb-glow-red" />
                        <div className="absolute inset-0 rounded-full rgb-glow-green" />
                        <div className="absolute inset-0 rounded-full rgb-glow-blue" />
                      </div>
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
                          onModelChange={handleModelChange}
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
              <div className="absolute bottom-0 left-0 right-0 pb-6 z-20 pointer-events-none">
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
                  onOpenSubagentSettings={handleOpenSubagentSettings}
                  disabled={isProcessing || isKeyMissing}
                  selectedModel={selectedModel}
                  onModelChange={handleModelChange}
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

export default App
