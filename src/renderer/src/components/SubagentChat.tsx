import React, { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { Smartphone, Bot, Send, Minus, X } from 'lucide-react'

interface Message {
  agentIndex: number
  content: string
  status: 'working' | 'done' | 'error'
  timestamp: number
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

export function SubagentChat(): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const removeListener = window.api.onSubagentMessage((data) => {
      setMessages((prev) => [...prev, data])
    })

    // Listen for initial messages when opening historical chat
    const removeInitialListener = (window.electron.ipcRenderer as any).on('subagent-initial-messages', (_ev, initialMessages) => {
      if (initialMessages && Array.isArray(initialMessages)) {
        setMessages(initialMessages)
      }
    })

    return () => {
      removeListener()
      if (removeInitialListener) removeInitialListener()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = () => {
    if (!inputValue.trim()) return

    const messageData = {
      agentIndex: -1, // -1 indicates the user
      content: inputValue.trim(),
      status: 'working' as const,
      timestamp: Date.now()
    }

    window.api.broadcastSubagentMessage(messageData)
    setInputValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0A0F] text-[#F0F0F5] font-sans overflow-hidden">
      {/* Phone Header */}
      <div className="h-14 shrink-0 bg-[#111118] border-b border-white/5 flex items-center justify-between px-4 drag-region">
        <div className="flex items-center gap-3 no-drag-region">
          <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center border border-accent-primary/30">
            <Smartphone size={16} className="text-accent-primary" />
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-wider uppercase leading-tight">Subagent Nexus</h1>
            <p className="text-[9px] text-text-secondary uppercase tracking-widest opacity-60 leading-tight">Group Channel • {messages.length} messages</p>
          </div>
        </div>
        <div className="flex items-center gap-1 no-drag-region">
           <button
             onClick={() => window.api.minimizeSubagentsWindow()}
             className="p-2 hover:bg-white/5 rounded-lg transition-colors text-text-secondary hover:text-text-primary"
           >
             <Minus size={14} />
           </button>
           <button
             onClick={() => window.api.closeSubagentsWindow()}
             className="p-2 hover:bg-status-error/20 rounded-lg transition-colors text-text-secondary hover:text-status-error"
           >
             <X size={14} />
           </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30 gap-3">
             <Bot size={48} strokeWidth={1} />
             <p className="text-[10px] uppercase tracking-[0.2em] font-light">Awaiting Transmissions...</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={clsx(
                "flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300",
                msg.agentIndex === -1 ? "items-end" : (msg.agentIndex % 2 === 0 ? "items-start" : "items-end")
              )}
            >
              <div className={clsx(
                "flex items-end gap-2 max-w-[85%]",
                msg.agentIndex === -1 ? "flex-row-reverse" : (msg.agentIndex % 2 === 0 ? "flex-row" : "flex-row-reverse")
              )}>
                {/* Avatar */}
                <div className={clsx(
                  "w-8 h-8 rounded-xl shrink-0 flex items-center justify-center border border-white/10 shadow-lg mb-1",
                  msg.agentIndex === -1 ? "bg-white/10" : AGENT_COLORS[msg.agentIndex % AGENT_COLORS.length]
                )}>
                  <span className="text-lg">{msg.agentIndex === -1 ? "👤" : "🤖"}</span>
                </div>

                {/* Bubble */}
                <div className="flex flex-col gap-1">
                   <span className={clsx(
                     "text-[9px] font-bold uppercase tracking-widest opacity-50 px-1",
                     msg.agentIndex === -1 ? "text-right" : (msg.agentIndex % 2 === 0 ? "text-left" : "text-right")
                   )}>
                     {msg.agentIndex === -1 ? "You" : `Agent #${msg.agentIndex}`}
                   </span>
                   <div className={clsx(
                     "px-4 py-3 rounded-2xl text-[13px] leading-relaxed break-words shadow-xl border",
                     msg.agentIndex === -1 
                      ? "bg-white/5 border-white/10 rounded-br-none" 
                      : (msg.agentIndex % 2 === 0 
                         ? "bg-[#111118] border-white/5 rounded-bl-none" 
                         : "bg-accent-primary/10 border-accent-primary/20 rounded-br-none text-accent-primary-light")
                   )}>
                     {msg.content}
                   </div>
                </div>
              </div>
              
              <div className={clsx(
                "text-[8px] mt-1 opacity-30 flex items-center gap-1",
                msg.agentIndex === -1 ? "mr-10 flex-row-reverse" : (msg.agentIndex % 2 === 0 ? "ml-10" : "mr-10 flex-row-reverse")
              )}>
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>•</span>
                <span className={clsx(
                   msg.status === 'done' ? "text-status-success" : 
                   msg.status === 'error' ? "text-status-error" : 
                   "text-accent-primary"
                )}>
                  {msg.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field */}
      <div className="p-4 bg-[#111118]/50 border-t border-white/5 flex items-center gap-3">
        <div className="flex-1 h-10 bg-[#0A0A0F] rounded-xl border border-white/5 flex items-center px-4">
           <input 
             type="text"
             value={inputValue}
             onChange={(e) => setInputValue(e.target.value)}
             onKeyDown={handleKeyDown}
             placeholder="TYPE A MESSAGE..."
             className="bg-transparent border-none outline-none w-full text-[11px] uppercase tracking-widest placeholder:text-white/10"
           />
        </div>
        <button 
          onClick={handleSendMessage}
          disabled={!inputValue.trim()}
          className={clsx(
            "w-10 h-10 rounded-xl flex items-center justify-center border transition-all",
            inputValue.trim() 
              ? "bg-accent-primary border-accent-primary/50 text-white shadow-lg shadow-accent-primary/20" 
              : "bg-white/5 border-white/10 text-white/20"
          )}
        >
           <Send size={14} />
        </button>
      </div>

      <style>{`
        .drag-region {
          -webkit-app-region: drag;
        }
        .no-drag-region {
          -webkit-app-region: no-drag;
        }
      `}</style>
    </div>
  )
}
