import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismBackground } from './components/PrismBackground'
import { IntroScreen } from './components/IntroScreen'
import { Sidebar } from './components/Sidebar'
import { InputBar, InputBarHandle } from './components/InputBar'
import { ActionLoader, ToolCall } from './components/ActionLoader'
import { ModelSelector } from './components/ModelSelector'
import { Tasks } from './components/Tasks'
import { QuickLauncher } from './components/QuickLauncher'
import { TitleBar } from './components/TitleBar'
import { ErrorMessage } from './components/ErrorMessage'
import { SettingsView } from './components/SettingsView'
import { ApiKeyModal } from './components/ApiKeyModal'
import { MissingKeyBanner } from './components/MissingKeyBanner'
import { SubagentChat } from './components/SubagentChat'
import clsx from 'clsx'

const MarkdownComponents: any = {
  a: ({ href, children, ...props }: any) => {
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i;
    if (href && imageExtensions.test(href)) {
      return (
        <img
          src={href}
          alt={typeof children === 'string' ? children : 'Image'}
          className="max-w-full h-auto rounded-xl my-4 border border-surface/50 shadow-lg"
        />
      );
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
    );
  },
  img: ({ src, alt, ...props }: any) => (
    <img
      src={src}
      alt={alt}
      className="max-w-full h-auto rounded-xl my-4 border border-surface/50 shadow-lg"
      {...props}
    />
  ),
};

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
  toolType?: 'task' | 'search'
}

interface Task extends ToolCall {
  id: string
  timestamp: Date
}

function App(): React.JSX.Element {
  const [showIntro, setShowIntro] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isFocused, setIsFocused] = useState(true)
  const [selectedModel, setSelectedModel] = useState('prism-3')
  const [activeView, setActiveView] = useState('chat')
  const [currentChatId, setCurrentChatId] = useState<string | undefined>(undefined)
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isYoutubeMode, setIsYoutubeMode] = useState(false)
  const [isThinkMode, setIsThinkMode] = useState(false)
  const [config, setConfig] = useState<any>(null)

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
  const inputBarRef = useRef<InputBarHandle>(null)
  const modelSelectorRef = useRef<any>(null)

  const handleSend = (text: string, thinkMode?: boolean): void => {
    if (isProcessing) return

    setIsProcessing(true)
    setIsYoutubeMode(text.startsWith('/youtube'))
    
    // If thinkMode is provided (e.g. from Launcher), update App state
    if (thinkMode !== undefined) {
      setIsThinkMode(thinkMode)
    }

    // Para a UI, removemos a tag feia se ela existir
    const displayContent = text.replace(/^\[FORCE_SEARCH\]\s*/i, '')
    setMessages((prev) => [...prev, { role: 'user', content: displayContent }])
    
    // Para a API, enviamos o texto original e o thinkMode (seja o atual ou o vindo do launcher)
    window.api.sendChatMessage({ message: text, thinkMode: thinkMode ?? isThinkMode })
  }

  useEffect(() => {
    // Listen for launcher messages
    const removeLauncherListener = window.api.onLauncherMessage((data) => {
      setActiveView('chat')
      // Se a mensagem do launcher vier com a tag, o handleSend cuidará de ocultar na UI
      handleSend(data.message, data.thinkMode)
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

    return () => {
      removeLauncherListener()
      removeModelListener()
      removeConfigListener()
    }
  }, [isProcessing])

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleModelChange = (newModel: string): void => {
    setSelectedModel(newModel)
    window.api.setModel(newModel)
  }

  const handleCancel = (): void => {
    window.api.cancelChat()
  }

  const handleLoadChat = async (id: string): Promise<void> => {
    if (isProcessing) return
    const history = await window.api.loadChat(id)
    if (history) {
      const mappedMessages: Message[] = []

      for (const m of history) {
        const text = m.parts[0].text || ''
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
              const toolCall = lastAiMsg.toolCalls.find((tc) => tc.name === toolName && !tc.result)
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
          // Filter out internal prompt
          if (text.startsWith('Role: Prism AI')) continue

          mappedMessages.push({
            role: 'user',
            content: text,
            isStreaming: false
          })
        } else if (m.role === 'model') {
          // Filter out initial system greeting if it's the very first message
          if (text.includes('automation AI') && mappedMessages.length === 0) continue

          let aiMsg: Message | undefined = mappedMessages[mappedMessages.length - 1]

          if (!aiMsg || aiMsg.role !== 'ai') {
            aiMsg = {
              role: 'ai',
              content: '',
              thoughts: '',
              toolCalls: [],
              isStreaming: false
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
              const args: Record<string, any> = {}
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
    }
  }

  const handleNewChat = (force = false): void => {
    if (isProcessing && !force) return
    if (force) {
      window.api.cancelChat()
    }
    setMessages([])
    setTasks([])
    setCurrentChatId(undefined)
    window.api.clearChat()
  }

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
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    // Set up IPC listeners from our Context Bridge
    const removeChatStartListener = window.api.onChatStart(() => {
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
          toolCalls: []
        }
      ])
    })

    const removeChatChunkListener = window.api.onChatChunk(({ thoughts, finalResponse, usedFallback, isThinking, isWritingToolCall, toolType }) => {
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
        }
        return newMessages
      })
    })

    const removeChatEndListener = window.api.onChatEnd(({ thoughts, finalResponse, usedFallback }) => {
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
        }
        return newMessages
      })
    })

    const removeChatErrorListener = window.api.onChatError((error) => {
      setIsProcessing(false)
      setIsYoutubeMode(false)
      
      if (error === 'API_KEY_MISSING') {
        setIsApiKeyModalOpen(true)
        return
      }

      const isCancel = error.includes('cancelled')

      if (isCancel) {
        setTasks((prev) =>
          prev.map((t) => (t.status === 'running' ? { ...t, status: 'cancelled' as any } : t))
        )
      }

      setMessages((prev) => {
        const newMessages = [...prev]
        const lastMsg = newMessages[newMessages.length - 1]

        // Cleanup running tool calls in last message
        if (isCancel && lastMsg && lastMsg.role === 'ai' && lastMsg.toolCalls) {
          lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
            tc.status === 'running'
              ? { ...tc, status: 'cancelled' as any, result: 'Cancelled by user.' }
              : tc
          )
        }

        // Se a última mensagem já for um erro IGUAL, não duplica
        if (lastMsg && lastMsg.isError && lastMsg.content === error) {
          return prev
        }

        // Se a última mensagem for AI e estava processando, atualiza ela com o erro
        if (lastMsg && lastMsg.role === 'ai' && (lastMsg.isStreaming || lastMsg.isThinking)) {
          lastMsg.content = error
          lastMsg.isStreaming = false
          lastMsg.isThinking = false
          lastMsg.isError = true
        } else {
          // Se não houver uma mensagem de AI ativa, cria uma nova para o erro
          newMessages.push({
            role: 'ai',
            content: error,
            isError: true,
            isStreaming: false,
            isThinking: false,
            toolCalls: []
          })
        }
        return newMessages
      })
    })

    const removeToolStartListener = window.api.onToolStart((data) => {
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
    })

    const removeToolEndListener = window.api.onToolEnd((data) => {
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
    })

    const removeToolUpdateListener = window.api.onToolUpdate((data) => {
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
              (t) => t.name === data.toolCallName && (t.status === 'running' || t.status === 'done')
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
    })

    const removeSubagentMessageListener = window.api.onSubagentMessage((data) => {
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

  const renderAiMessage = (msg: Message): React.JSX.Element | null => {
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

    if (!msg.content && !msg.toolCalls?.length && !msg.isWritingToolCall) {
      if (msg.isStreaming) {
        return (
          <div className="flex flex-col gap-4">
            <div className="flex gap-1.5 py-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-primary/40 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent-primary/40 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent-primary/40 animate-bounce" />
            </div>
          </div>
        )
      }
      return null
    }

    // Split content by tool calls
    const parts = msg.content.split(/(<tool_call>[\s\S]*?(?:<\/tool_call>|$))/gi)
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
              // If it's an open tool call being streamed, we might show the writing indicator here or at the end
              return null
            } else if (part.trim() !== '') {
              return (
                <div
                  key={`text-${index}`}
                  className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-background-secondary prose-pre:border prose-pre:border-surface/50 prose-code:font-mono prose-code:text-[13px] prose-p:font-light prose-p:text-[16px] lg:prose-p:text-[19px] xl:prose-p:text-[20px]"
                >
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkMath]} 
                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                    components={MarkdownComponents}
                  >{part}</ReactMarkdown>
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
        </div>
      </div>
    )
  }

  const isKeyMissing = !config?.userGeminiKey && (config?.envGeminiKey === 'none' || !config?.envGeminiKey)

  if (route === '#launcher') {
    return <QuickLauncher />
  }

  if (route === '#subagents') {
    return <SubagentChat />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-main font-sans selection:bg-accent-primary/30 pt-10">
      {showIntro && <IntroScreen onComplete={() => setShowIntro(false)} />}
      <TitleBar />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
      />
      <PrismBackground
        isFocused={isFocused}
        isProcessing={isProcessing}
        isFinishing={isFinishing}
        isYoutubeMode={isYoutubeMode}
      />

      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onLoadChat={handleLoadChat}
        onNewChat={handleNewChat}
        currentChatId={currentChatId}
        runningTasksCount={tasks.filter((t) => t.status === 'running').length}
      />

      <main className="flex-1 flex flex-col relative z-10 min-w-0 h-full">
        {/* Model Selector Bar */}
        <div className="w-full px-6 py-3 flex justify-between items-center border-b border-surface/10 bg-background-main/50 backdrop-blur-sm sticky top-0 z-30">
          <div className="flex-1">
            {activeView === 'tasks' && (
              <span className="text-[10px] uppercase tracking-widest font-black text-accent-primary ml-2">
                Monitoring System
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <ModelSelector
              ref={modelSelectorRef}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              disabled={isProcessing}
            />
          </div>

          <div className="flex-1 flex justify-end">
            {/* Clear button removed - session management is now in Sidebar */}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col">
          {activeView === 'chat' ? (
            <div className="flex-1 flex flex-col py-8">
              {isKeyMissing && (
                <MissingKeyBanner onAddKey={() => setIsApiKeyModalOpen(true)} />
              )}
              {messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-text-secondary text-sm font-medium tracking-wide">
                    {isKeyMissing ? 'Prism is Awaiting Gemini API Key Configuration.' : 'Prism is ready.'}
                  </p>
                </div>
              ) : (
                <div className="w-full flex flex-col">
                  {messages.map((msg, i) => {
                    return (
                      <div key={i} className="flex flex-col w-full transition-all duration-700">
                        <div
                          className={clsx(
                            'w-full px-6 sm:px-12 py-8 flex flex-col transition-all duration-700 animate-message',
                            msg.role === 'user' ? 'items-end' : 'items-start'
                          )}
                        >
                          {msg.role === 'ai' && msg.thoughts && (
                            <div className="w-full max-w-5xl">
                              <details
                                className={clsx(
                                  'group mb-4 w-full overflow-hidden rounded-xl border transition-all duration-300 bubble-glow',
                                  msg.isThinking
                                    ? 'border-status-success/30 bg-status-success/5 backdrop-blur-md shadow-[0_0_15px_-3px_rgba(34,197,94,0.1)]'
                                    : 'border-surface/40 bg-surface/20 backdrop-blur-sm'
                                )}
                              >
                                <summary
                                  className={clsx(
                                    'flex cursor-pointer list-none items-center px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors',
                                    msg.isThinking
                                      ? 'text-status-success'
                                      : 'text-text-secondary/60 hover:text-text-primary/90'
                                  )}
                                >
                                  <span className="flex items-center gap-2">
                                    <span className="relative flex h-1.5 w-1.5">
                                      <span
                                        className={clsx(
                                          'absolute inline-flex h-full w-full rounded-sm transition-opacity duration-500',
                                          msg.isThinking
                                            ? 'opacity-100 bg-status-success/40 animate-ping'
                                            : 'opacity-0 group-open:opacity-100 bg-accent-primary/40'
                                        )}
                                      ></span>
                                      <span
                                        className={clsx(
                                          'relative inline-flex h-1.5 w-1.5 rounded-sm transition-colors duration-300',
                                          msg.isThinking
                                            ? 'bg-status-success'
                                            : 'bg-text-secondary/40 group-open:bg-accent-primary/60'
                                        )}
                                      ></span>
                                    </span>
                                    Thoughts{' '}
                                    {msg.isThinking && (
                                      <span className="ml-2 animate-pulse">Streaming...</span>
                                    )}
                                  </span>
                                </summary>
                                <div
                                  className={clsx(
                                    'px-4 pb-4 font-mono text-[11.5px] leading-relaxed border-t mt-1 pt-3 opacity-0 group-open:opacity-100 transition-all duration-500',
                                    msg.isThinking
                                      ? 'text-status-success/80 border-status-success/20 bg-status-success/5'
                                      : 'text-text-secondary/70 border-surface/30 bg-black/5'
                                  )}
                                >
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, rehypeKatex]}>{msg.thoughts}</ReactMarkdown>
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
                              <div className="bg-surface/80 backdrop-blur-sm text-text-primary border border-surface/50 rounded-2xl rounded-tr-sm px-6 py-4 shadow-xl max-w-[90%] sm:max-w-[80%] lg:max-w-[70%] whitespace-pre-wrap font-medium text-[15px] sm:text-[16px]">
                                {msg.content}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={messagesEndRef} className="h-4" />
                </div>
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

        {activeView === 'chat' && (
          <div className="pb-6 pt-2 bg-gradient-to-t from-background-main via-background-main to-transparent shrink-0">
            <InputBar 
              ref={inputBarRef} 
              onSend={handleSend} 
              onCancel={handleCancel}
              isProcessing={isProcessing}
              isKeyMissing={isKeyMissing}
              isThinkMode={isThinkMode}
              onThinkModeToggle={setIsThinkMode}
              disabled={isProcessing || isKeyMissing} 
            />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
