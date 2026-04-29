import React, { useState } from 'react'
import { clsx } from 'clsx'
import { Smartphone } from 'lucide-react'

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error' | 'cancelled'
  subagentMessages?: any[]
  agentUpdates?: Record<number, {
    phase: 'thinking' | 'tool_use' | 'done' | 'error' | 'cancelled'
    command?: string
    output?: string
  }>
}

interface ActionLoaderProps {
  toolCall: ToolCall
}

export function ActionLoader({ toolCall }: ActionLoaderProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)

  let displayTitle = 'Processing...'
  if (toolCall.status === 'writing') {
    displayTitle = toolCall.name === 'search' ? 'WRITING THE SEARCH' : 'WRITING TASK'
  } else if (toolCall.name === 'saw_link_from_url') {
    displayTitle = toolCall.status === 'cooldown' ? 'COOLING DOWN...' : 'EXPLORING PAGE'
  } else if (toolCall.name.startsWith('computer_use_')) {
    displayTitle = 'COMPUTER USE'
  } else if (toolCall.name === 'execute_terminal_command') {
    displayTitle = 'Terminal'
  } else if (toolCall.name === 'open_application') {
    displayTitle = 'Open App'
  } else if (toolCall.name === 'open_browser_link') {
    displayTitle = 'Open Link'
  } else if (toolCall.name === 'list_installed_applications') {
    displayTitle = 'List Apps'
  } else if (toolCall.name === 'web_search') {
    displayTitle = 'Web Search'
  } else if (toolCall.name === 'search_chat_history') {
    displayTitle = 'Memory Search'
  } else if (toolCall.name === 'run_subagents') {
    displayTitle = 'ORCHESTRATING AGENTS'
  }

  const isDone = toolCall.status === 'done' || toolCall.status === 'error' || toolCall.status === 'cancelled'
  const isWriting = toolCall.status === 'writing'
  const isCooldown = toolCall.status === 'cooldown'

  return (
    <div className="flex flex-col gap-2 my-2 w-full max-w-2xl">
      <div
        onClick={() => isDone && setIsExpanded(!isExpanded)}
        className={clsx(
          'flex items-center gap-3 px-4 py-2 rounded-xl border transition-all duration-300',
          isDone
            ? 'bg-[#111118]/60 border-[#1E1E2E] cursor-pointer hover:bg-[#111118]'
            : isWriting
              ? 'bg-[#111118]/80 border-[#FACC15]/30 animate-pulse'
              : isCooldown
                ? 'bg-[#111118]/80 border-[#6C63FF]/30'
                : 'bg-[#111118]/80 border-[#6C63FF]/20 animate-in fade-in slide-in-from-bottom-1'
        )}
      >
        <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
          {isDone ? (
            <div
              className={clsx(
                'w-2 h-2 rounded-full',
                toolCall.status === 'done' ? 'bg-[#4ADE80]' : 
                toolCall.status === 'cancelled' ? 'bg-[#94A3B8]' : 'bg-[#F87171]'
              )}
            />
          ) : isWriting || isCooldown ? (
            <div className={clsx(
              "w-2 h-2 rounded-full",
              isCooldown ? "bg-[#6C63FF] animate-pulse" : "bg-[#FACC15] animate-ping"
            )} />
          ) : (
            <>
              <div className="absolute inset-0 rounded-full border border-[#6C63FF]/10"></div>
              <div className="absolute inset-0 rounded-full border border-[#6C63FF] border-t-transparent animate-spin"></div>
            </>
          )}
        </div>

        <span
          className={clsx(
            'text-[11px] font-bold tracking-wider uppercase',
            isDone ? 'text-[#8888A0]' : isWriting ? 'text-[#FACC15]' : isCooldown ? 'text-[#C084FC]' : 'text-[#F0F0F5]'
          )}
        >
          {displayTitle} {isDone && toolCall.status === 'done' && '• Completed'}
          {isDone && toolCall.status === 'error' && '• Error'}
          {isDone && toolCall.status === 'cancelled' && '• Cancelled'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {toolCall.name === 'run_subagents' && (toolCall.status === 'running' || toolCall.status === 'done' || toolCall.status === 'cancelled') && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.api.openSubagentsWindow(toolCall.subagentMessages)
              }}
              className="p-1.5 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/20 transition-all hover:scale-105 active:scale-95 group/phone cursor-pointer"
              title="Open Subagent Chat"
            >
              <Smartphone size={14} />
            </button>
          )}

          {!isDone && (
            <div className="flex gap-0.5">
              <span
                className={clsx(
                  'w-0.5 h-0.5 rounded-full animate-bounce [animation-delay:-0.3s]',
                  isWriting ? 'bg-[#FACC15]/60' : isCooldown ? 'bg-[#C084FC]/60' : 'bg-[#6C63FF]/60'
                )}
              ></span>
              <span
                className={clsx(
                  'w-0.5 h-0.5 rounded-full animate-bounce [animation-delay:-0.15s]',
                  isWriting ? 'bg-[#FACC15]/60' : isCooldown ? 'bg-[#C084FC]/60' : 'bg-[#6C63FF]/60'
                )}
              ></span>
              <span
                className={clsx(
                  'w-0.5 h-0.5 rounded-full animate-bounce',
                  isWriting ? 'bg-[#FACC15]/60' : isCooldown ? 'bg-[#C084FC]/60' : 'bg-[#6C63FF]/60'
                )}
              ></span>
            </div>
          )}

          {isDone && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={clsx(
                'text-[#8888A0]/40 transition-transform duration-300',
                isExpanded && 'rotate-180'
              )}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="w-full overflow-hidden rounded-xl border border-[#1E1E2E] bg-[#0A0A0F]/80 backdrop-blur-md duration-200">
          <div className="px-4 py-2 border-b border-[#1E1E2E] flex items-center justify-between bg-[#111118]">
            <span className="text-[9px] uppercase tracking-widest font-bold text-[#8888A0]">
              Tool Output
            </span>
          </div>
          <div className="p-4 font-mono text-[11px] leading-relaxed text-[#8888A0] overflow-x-auto max-h-[400px]">
            <pre className="whitespace-pre-wrap break-all text-[#F0F0F5]/90">
              {toolCall.result}
            </pre>
          </div>
        </div>
      )}

      {toolCall.name === 'run_subagents' && (toolCall.status === 'running' || toolCall.status === 'done' || toolCall.status === 'cancelled') && (
        <div className="w-full mt-2 grid grid-cols-1 gap-2 animate-in fade-in slide-in-from-top-2 duration-500">
          {Object.entries(toolCall.agentUpdates || {}).map(([index, update]) => (
            <div 
              key={index} 
              className="bg-[#0A0A0F]/60 border border-[#1E1E2E] rounded-lg p-3 flex flex-col gap-2 transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#6C63FF] uppercase tracking-widest">
                  Agent #{index}
                </span>
                <div className="flex items-center gap-2">
                   <span className={clsx(
                    "text-[9px] font-black uppercase px-2 py-0.5 rounded",
                    update.phase === 'thinking' ? "bg-accent-primary/10 text-accent-primary" :
                    update.phase === 'tool_use' ? "bg-[#FACC15]/10 text-[#FACC15]" :
                    update.phase === 'done' ? "bg-[#4ADE80]/10 text-[#4ADE80]" :
                    "bg-[#F87171]/10 text-[#F87171]"
                  )}>
                    {update.command?.includes('WAITING') ? 'LISTENING' : 
                     update.command?.includes('MESSAGE TO') ? 'SENDING' : 
                     update.phase.replace('_', ' ')}
                  </span>
                </div>
              </div>
              
              {update.command && (
                <div className={clsx(
                  "flex items-start gap-2 p-2 rounded border",
                  update.command.includes('MESSAGE TO') ? "bg-accent-primary/5 border-accent-primary/20" :
                  update.command.includes('RECEIVED FROM') ? "bg-status-success/5 border-status-success/20" :
                  update.command.includes('WAITING') ? "bg-blue-500/5 border-blue-500/20 animate-pulse" :
                  "bg-black/40 border-white/5"
                )}>
                  <span className="text-[9px] text-[#8888A0] font-mono mt-0.5 whitespace-nowrap">
                    {update.command.includes('MESSAGE TO') ? '➔ RADIO:' : 
                     update.command.includes('RECEIVED FROM') ? '⇠ RADIO:' : 
                     update.command.includes('WAITING') ? '📡 SCAN:' : 'ACTION:'}
                  </span>
                  <code className={clsx(
                    "text-[10px] font-mono break-all leading-tight",
                    update.command.includes('MESSAGE TO') ? "text-accent-primary" :
                    update.command.includes('RECEIVED FROM') ? "text-status-success" :
                    "text-[#F0F0F5]/80"
                  )}>
                    {update.command}
                  </code>
                </div>
              )}
              
              {update.output && (
                <div className="text-[10px] text-[#8888A0] font-mono italic truncate opacity-60 px-1">
                  {update.output}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
