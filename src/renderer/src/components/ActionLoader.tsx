import React, { useState } from 'react'
import { clsx } from 'clsx'

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error'
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
  }

  const isDone = toolCall.status === 'done' || toolCall.status === 'error'
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
                toolCall.status === 'done' ? 'bg-[#4ADE80]' : 'bg-[#F87171]'
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
        </span>

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
              'ml-auto text-[#8888A0]/40 transition-transform duration-300',
              isExpanded && 'rotate-180'
            )}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
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
    </div>
  )
}
