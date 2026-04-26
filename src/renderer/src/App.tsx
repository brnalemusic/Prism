import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
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
import clsx from 'clsx'

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
  const [selectedModel, setSelectedModel] = useState('gemma-4-26b-a4b-it')
  const [activeView, setActiveView] = useState('chat')
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
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

  const [route, setRoute] = useState(window.location.hash)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputBarRef = useRef<InputBarHandle>(null)

  const handleSend = (text: string): void => {
    // Para a UI, removemos a tag feia se ela existir (caso venha do launcher com tag, ou se o usuário digitou)
    const displayContent = text.replace(/^\[FORCE_SEARCH\]\s*/i, '')
    setMessages((prev) => [...prev, { role: 'user', content: displayContent }])
    
    // Para a API, enviamos o texto original (que pode conter a tag)
    window.api.sendChatMessage(text)
  }

  useEffect(() => {
    const handleHashChange = (): void => setRoute(window.location.hash)
    window.addEventListener('hashchange', handleHashChange)

    // Listen for launcher messages
    window.api.onLauncherMessage((message) => {
      setActiveView('chat')
      // Se a mensagem do launcher vier com a tag, o handleSend cuidará de ocultar na UI
      handleSend(message)
      // Ensure focus after message is sent
      setTimeout(() => {
        inputBarRef.current?.focus()
      }, 100)
    })

    window.api.onModelChanged((modelKey) => {
      setSelectedModel(modelKey)
    })

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleModelChange = (newModel: string): void => {
    setSelectedModel(newModel)
    window.api.setModel(newModel)
  }

  const handleClearChat = (): void => {
    if (isProcessing) return
    setMessages([])
    setTasks([])
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
    window.api.onChatStart(() => {
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

    window.api.onChatChunk(({ thoughts, finalResponse, usedFallback, isThinking, isWritingToolCall, toolType }) => {
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

    window.api.onChatEnd(({ thoughts, finalResponse, usedFallback }) => {
      setIsProcessing(false)
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

    window.api.onChatError((error) => {
      setIsProcessing(false)
      setMessages((prev) => {
        const newMessages = [...prev]
        const lastMsg = newMessages[newMessages.length - 1]

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

    window.api.onToolStart((data) => {
      const taskId = crypto.randomUUID()
      const newTask: Task = {
        ...data,
        id: taskId,
        status: 'running',
        timestamp: new Date()
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

    window.api.onToolEnd((data) => {
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

    return () => {
      window.api.removeAllChatListeners()
    }
  }, [])

  const renderAiMessage = (msg: Message): React.JSX.Element | null => {
    if (msg.isError) {
      return <ErrorMessage error={msg.content} onFixClick={() => setIsApiKeyModalOpen(true)} />
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
                  <ReactMarkdown>{part}</ReactMarkdown>
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

  if (route === '#launcher') {
    return <QuickLauncher />
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
      />

      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
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
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              disabled={isProcessing}
            />
          </div>

          <div className="flex-1 flex justify-end">
            <button
              onClick={handleClearChat}
              disabled={isProcessing || messages.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-text-secondary/60 hover:text-status-error/80 transition-colors disabled:opacity-0 disabled:pointer-events-none"
              title="Clear History"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col">
          {activeView === 'chat' ? (
            <div className="flex-1 flex flex-col py-8">
              {messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-text-secondary text-sm font-medium tracking-wide">
                    Prism is ready.
                  </p>
                </div>
              ) : (
                <div className="w-full flex flex-col">
                  {messages.map((msg, i) => {
                    return (
                      <div key={i} className="flex flex-col w-full transition-all duration-700">
                        <div
                          className={clsx(
                            'w-full px-6 sm:px-12 py-8 flex flex-col transition-transform duration-700',
                            msg.role === 'user' ? 'items-end' : 'items-start'
                          )}
                        >
                          {msg.role === 'ai' && msg.thoughts && (
                            <div className="w-full max-w-5xl">
                              <details
                                className={clsx(
                                  'group mb-4 w-full overflow-hidden rounded-xl border transition-all duration-300',
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
                                  <ReactMarkdown>{msg.thoughts}</ReactMarkdown>
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
            <InputBar ref={inputBarRef} onSend={handleSend} disabled={isProcessing} />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
