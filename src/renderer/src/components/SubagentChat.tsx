import React, { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { Smartphone, Bot, Send, Minus, X, UserRound } from 'lucide-react'

interface Message {
  agentIndex: number | string
  content: string
  status: 'working' | 'done' | 'error'
  timestamp: number
  senderRole?: 'user' | 'master' | 'agent'
  senderName?: string
}

const AGENT_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500'
]

type IpcRendererBridge = {
  on: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void
  ) => (() => void) | undefined
}

export function SubagentChat(): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const removeListener = window.api.onSubagentMessage((data) => {
      setMessages((prev) => [...prev, data])
    })

    // Listen for initial messages when opening historical chat
    const ipcRenderer = window.electron.ipcRenderer as unknown as IpcRendererBridge
    const removeInitialListener = ipcRenderer.on(
      'subagent-initial-messages',
      (_ev: unknown, initialMessages: unknown) => {
        if (initialMessages && Array.isArray(initialMessages)) {
          setMessages(initialMessages as Message[])
        }
      }
    )

    return () => {
      removeListener()
      if (removeInitialListener) removeInitialListener()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = (): void => {
    if (!inputValue.trim()) return

    const messageData = {
      agentIndex: -1, // -1 indicates the user
      content: inputValue.trim(),
      status: 'working' as const,
      timestamp: Date.now(),
      senderRole: 'user' as const,
      senderName: 'You'
    }

    window.api.broadcastSubagentMessage(messageData)
    setInputValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background-main text-text-primary font-sans">
      {/* Phone Header */}
      <div className="h-14 shrink-0 border-b border-white/[0.055] bg-background-main/[0.72] flex items-center justify-between px-4 backdrop-blur-2xl drag-region">
        <div className="flex items-center gap-3 no-drag-region">
          <div className="flex h-8 w-8 items-center justify-center rounded-[16px] border border-accent-primary/20 bg-accent-primary/[0.08]">
            <Smartphone size={16} className="text-accent-primary" />
          </div>
          <div>
            <h1 className="text-xs font-semibold leading-tight">Subagent Nexus</h1>
            <p className="text-[11px] text-text-secondary/60 leading-tight">
              Group Channel / {messages.length} messages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 no-drag-region">
          <button
            onClick={() => window.api.minimizeSubagentsWindow()}
            className="rounded-xl p-2 text-text-secondary transition-colors hover:bg-white/[0.055] hover:text-text-primary"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => window.api.closeSubagentsWindow()}
            className="rounded-xl p-2 text-text-secondary transition-colors hover:bg-status-error/[0.12] hover:text-status-error"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30 gap-3">
            <Bot size={48} strokeWidth={1} />
            <p className="text-xs font-medium">Awaiting transmissions...</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isUser = msg.agentIndex === -1 || msg.senderRole === 'user'
            const isMaster = msg.agentIndex === 'master'
            const parsedIndex =
              typeof msg.agentIndex === 'number' ? msg.agentIndex : parseInt(msg.agentIndex)
            const numIndex = Number.isFinite(parsedIndex) ? parsedIndex : 0
            const agentColor = AGENT_COLORS[Math.abs(numIndex) % AGENT_COLORS.length]

            const flexRowClass = isUser ? 'flex-row-reverse' : 'flex-row'
            const alignmentClass = isUser ? 'items-end' : 'items-start'

            return (
              <div
                key={i}
                className={clsx(
                  'flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300',
                  alignmentClass
                )}
              >
                <div className={clsx('flex items-end gap-2 max-w-[85%]', flexRowClass)}>
                  {/* Avatar */}
                  <div
                    className={clsx(
                      'mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[16px] border shadow-lg transition-all',
                      isUser
                        ? 'bg-white/[0.08] border-white/10'
                        : isMaster
                          ? 'bg-purple-500/20 border-purple-500/40 shadow-purple-500/10'
                          : `border-white/10 ${agentColor}`
                    )}
                  >
                    {isUser ? (
                      <UserRound size={15} />
                    ) : isMaster ? (
                      <span className="text-sm">👑</span>
                    ) : (
                      <Bot size={15} />
                    )}
                  </div>

                  {/* Bubble */}
                  <div className="flex flex-col gap-1">
                    <span
                      className={clsx(
                        'px-1 text-[11px] font-semibold opacity-60',
                        isUser ? 'text-right' : isMaster ? 'text-left text-purple-400' : 'text-left'
                      )}
                    >
                      {isUser
                        ? msg.senderName || 'You'
                        : isMaster
                          ? 'Master Coordinator'
                          : `Agent #${msg.agentIndex}`}
                    </span>
                    <div
                      className={clsx(
                        'rounded-[20px] border px-4 py-3 text-[13px] leading-relaxed break-words shadow-xl transition-all',
                        isUser
                          ? 'bg-white/[0.055] border-white/10 rounded-br-[8px]'
                          : isMaster
                            ? 'bg-[#0D0D14] border-purple-500/30 text-purple-200 rounded-[20px] rounded-bl-[8px] shadow-purple-500/5'
                            : 'bg-white/[0.035] border-white/[0.06] rounded-bl-[8px]'
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>

                <div
                  className={clsx(
                    'text-[8px] mt-1 opacity-30 flex items-center gap-1',
                    isUser ? 'mr-10 flex-row-reverse' : 'ml-10'
                  )}
                >
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <span>/</span>
                  <span
                    className={clsx(
                      msg.status === 'done'
                        ? 'text-status-success'
                        : msg.status === 'error'
                          ? 'text-status-error'
                          : 'text-accent-primary'
                    )}
                  >
                    {msg.status.toUpperCase()}
                  </span>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field */}
      <div className="flex items-center gap-3 border-t border-white/[0.055] bg-background-main/[0.72] p-4 backdrop-blur-2xl">
        <div className="flex h-10 flex-1 items-center rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message"
            className="w-full border-none bg-transparent text-sm outline-none placeholder:text-white/20"
          />
        </div>
        <button
          onClick={handleSendMessage}
          disabled={!inputValue.trim()}
          className={clsx(
            'flex h-10 w-10 items-center justify-center rounded-[18px] border transition-all duration-150',
            inputValue.trim()
              ? 'border-text-primary bg-text-primary text-black hover:bg-white active:scale-90'
              : 'border-white/10 bg-white/[0.055] text-white/20'
          )}
        >
          <Send size={14} />
        </button>
      </div>

      {/* drag-region classes moved to main.css */}
    </div>
  )
}
