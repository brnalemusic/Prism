import { useState } from 'react'
import { clsx } from 'clsx'
import { Spinner } from './Spinner'
import { SubagentMessage } from '../../../shared/types'
import {
  Smartphone,
  Search,
  Terminal,
  ExternalLink,
  List,
  HardDrive,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  CirclePlay,
  FileText,
  AppWindow,
  Settings
} from 'lucide-react'

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error' | 'cancelled'
  subagentMessages?: SubagentMessage[]
  agentUpdates?: Record<
    string | number,
    {
      phase: 'thinking' | 'tool_use' | 'done' | 'error' | 'cancelled'
      command?: string
      output?: string
    }
  >
}

interface ActionLoaderProps {
  toolCall: ToolCall
}

const phaseColorCodes = {
  thinking: {
    color: 'var(--color-accent-primary)',
    fill: 'rgba(110, 140, 255, 0.05)',
    border: 'var(--color-accent-primary)'
  },
  tool_use: {
    color: 'var(--color-status-warning)',
    fill: 'rgba(251, 191, 36, 0.05)',
    border: 'var(--color-status-warning)'
  },
  done: {
    color: 'var(--color-status-success)',
    fill: 'rgba(74, 222, 128, 0.05)',
    border: 'var(--color-status-success)'
  },
  error: {
    color: 'var(--color-status-error)',
    fill: 'rgba(248, 113, 113, 0.05)',
    border: 'var(--color-status-error)'
  },
  cancelled: {
    color: 'var(--color-text-secondary)',
    fill: 'rgba(142, 142, 150, 0.05)',
    border: 'var(--color-text-secondary)'
  },
  idle: {
    color: 'var(--color-text-muted)',
    fill: 'rgba(85, 85, 94, 0.02)',
    border: 'var(--color-text-muted)'
  }
}

const getPhaseStyle = (phase: string): { color: string; fill: string; border: string } => {
  return phaseColorCodes[phase as keyof typeof phaseColorCodes] || phaseColorCodes.idle
}

function getStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

export function ActionLoader({ toolCall }: ActionLoaderProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('master')

  const url = getStringArg(toolCall.args, 'url')
  const query = getStringArg(toolCall.args, 'query')
  const isYoutube = /youtube\.com|youtu\.be|^\/youtube|\byoutube\b/i.test(`${url} ${query}`)

  let displayTitle = 'Processing'
  let displayDetail = 'Prism is working on the next step.'
  let tone: 'default' | 'search' | 'think' | 'success' | 'error' | 'youtube' = 'default'

  if (toolCall.status === 'writing') {
    displayTitle =
      toolCall.name === 'search'
        ? 'Preparing Search'
        : toolCall.name === 'mini-app'
          ? 'Designing Mini App'
          : 'Preparing Action'
    displayDetail =
      toolCall.name === 'search'
        ? 'Composing a web search.'
        : toolCall.name === 'mini-app'
          ? 'Building interactive interface.'
          : 'Composing a tool call.'
    tone = toolCall.name === 'search' ? 'search' : 'think'
  } else if (toolCall.name === 'web_search') {
    displayTitle = isYoutube ? 'Searching Video' : 'Searching Web'
    displayDetail = query || 'Collecting web results.'
    tone = isYoutube ? 'youtube' : 'search'
  } else if (toolCall.name === 'search_chat_history') {
    displayTitle = 'Searching Memory'
    displayDetail = query || 'Looking through prior context.'
    tone = 'search'
  } else if (toolCall.name === 'saw_link_from_url') {
    displayTitle = toolCall.status === 'cooldown' ? 'Cooling Down' : 'Reading Page'
    displayDetail = url || 'Inspecting web content.'
    tone = 'search'
  } else if (toolCall.name.startsWith('computer_use_')) {
    displayTitle = 'Computer Use'
    displayDetail = toolCall.name.replace('computer_use_', '').replace(/_/g, ' ')
  } else if (toolCall.name === 'execute_terminal_command') {
    displayTitle = 'Terminal'
    displayDetail = getStringArg(toolCall.args, 'command') || 'Running command.'
  } else if (toolCall.name === 'open_application') {
    displayTitle = 'Opening App'
    displayDetail = getStringArg(toolCall.args, 'appPath') || 'Launching application.'
  } else if (toolCall.name === 'open_browser_link') {
    displayTitle = isYoutube ? 'Opening Video' : 'Opening Link'
    displayDetail = url || 'Opening in browser.'
    tone = isYoutube ? 'youtube' : 'default'
  } else if (toolCall.name === 'list_installed_applications') {
    displayTitle = 'Listing Apps'
    displayDetail = 'Scanning installed applications.'
  } else if (toolCall.name === 'run_subagents') {
    displayTitle = 'Orchestrating Agents'
    displayDetail = 'Coordinating parallel work.'
    tone = 'think'
  } else if (toolCall.name === 'configure_prism') {
    displayTitle = 'Configuring Prism'
    const changedArgs = Object.keys(toolCall.args).filter(
      (key) => toolCall.args[key] !== undefined && toolCall.args[key] !== ''
    )
    displayDetail = changedArgs.length > 0
      ? `Updating: ${changedArgs.join(', ')}`
      : 'Applying application settings.'
    tone = 'think'
  }

  const isDone =
    toolCall.status === 'done' || toolCall.status === 'error' || toolCall.status === 'cancelled'
  const isWriting = toolCall.status === 'writing'
  const isRunning = !isDone

  if (toolCall.status === 'done') tone = 'success'
  if (toolCall.status === 'error' || toolCall.status === 'cancelled') tone = 'error'

  const toneClasses = {
    default: 'border-white/[0.08] bg-white/[0.035] text-text-secondary',
    search: 'border-accent-secondary/25 bg-accent-secondary/[0.05] text-accent-secondary',
    think: 'border-status-warning/25 bg-status-warning/[0.05] text-status-warning',
    success: 'border-status-success/20 bg-status-success/[0.045] text-status-success',
    error: 'border-status-error/25 bg-status-error/[0.05] text-status-error',
    youtube: 'border-accent-primary/25 bg-accent-primary/[0.05] text-accent-primary'
  }[tone]

  const renderIcon = (): React.JSX.Element => {
    if (isDone) {
      if (toolCall.status === 'done') return <CheckCircle2 size={16} />
      return <XCircle size={16} />
    }

    if (isWriting) {
      if (toolCall.name === 'mini-app')
        return <AppWindow size={16} className="animate-slow-pulse" />
      return <Brain size={16} className="animate-slow-pulse" />
    }
    if (toolCall.name === 'web_search' || toolCall.name === 'search_chat_history')
      return <Search size={16} className="animate-slow-pulse" />
    if (isYoutube) return <CirclePlay size={16} className="animate-slow-pulse" />
    if (toolCall.name === 'execute_terminal_command') return <Terminal size={16} />
    if (toolCall.name === 'open_browser_link' || toolCall.name === 'open_application')
      return <ExternalLink size={16} />
    if (toolCall.name === 'list_installed_applications') return <List size={16} />
    if (toolCall.name.startsWith('computer_use_')) return <HardDrive size={16} />
    if (toolCall.name === 'saw_link_from_url') return <FileText size={16} />
    if (toolCall.name === 'configure_prism') return <Settings size={16} className="animate-slow-pulse" />
    return <Loader2 size={16} className="animate-spin" />
  }

  const statusLabel =
    toolCall.status === 'done'
      ? 'Completed'
      : toolCall.status === 'error'
        ? 'Error'
        : toolCall.status === 'cancelled'
          ? 'Cancelled'
          : toolCall.status === 'cooldown'
            ? 'Cooling'
            : toolCall.status === 'writing'
              ? 'Composing'
              : 'Running'

  const hasAgentUpdates = toolCall.agentUpdates && Object.keys(toolCall.agentUpdates).length > 0
  const agentKeys = Object.keys(toolCall.agentUpdates || {})
  const workerKeys = agentKeys
    .filter((k) => k !== 'master')
    .sort((a, b) => parseInt(a) - parseInt(b))

  const activeKey = toolCall.agentUpdates?.[selectedAgentKey]
    ? selectedAgentKey
    : toolCall.agentUpdates?.['master']
      ? 'master'
      : agentKeys[0]
  const activeAgent = toolCall.agentUpdates?.[activeKey]

  const masterX = 200
  const masterY = 30
  const workerY = 110

  const getWorkerX = (index: number, total: number): number => {
    if (total <= 1) return 200
    return 50 + (index * 300) / (total - 1)
  }

  return (
    <div className="my-2 flex w-full flex-col gap-2">
      <style>{`
        @keyframes swarmDash {
          to {
            stroke-dashoffset: -20;
          }
        }
        .swarm-dash {
          animation: swarmDash 1s linear infinite;
        }
      `}</style>
      <div
        onClick={() => isDone && setIsExpanded(!isExpanded)}
        className={clsx(
          'premium-panel-soft flex items-center gap-3 rounded-[20px] border px-4 py-3 transition-all duration-200 select-none',
          toneClasses,
          isDone ? 'cursor-pointer hover:bg-white/[0.055] active:scale-[0.99]' : 'cursor-default'
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-current/20 bg-current/[0.08]">
          {renderIcon()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">{displayTitle}</span>
            <span className="rounded-full border border-current/20 bg-current/[0.06] px-2 py-0.5 text-[11px] font-semibold">
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-text-secondary/70">{displayDetail}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {toolCall.name === 'run_subagents' &&
            (toolCall.status === 'running' ||
              toolCall.status === 'done' ||
              toolCall.status === 'cancelled') && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  window.api.openSubagentsWindow(toolCall.subagentMessages)
                }}
                className="p-1.5 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/20 transition-all hover:scale-105 active:scale-95 group/phone cursor-pointer animate-pulse"
                title="Open Subagent Chat"
              >
                <Smartphone size={14} />
              </button>
            )}

          {isRunning && <Spinner size="xs" />}

          {isDone && (
            <ChevronDown
              size={14}
              className={clsx(
                'text-text-secondary/50 transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="premium-panel-soft w-full overflow-hidden rounded-[20px] border border-white/[0.08] animate-soft-pop">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-xs font-semibold text-text-secondary/70">Tool Output</span>
          </div>
          <div className="max-h-[400px] overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-text-secondary">
            <pre className="whitespace-pre-wrap break-all text-text-primary/90">
              {toolCall.result}
            </pre>
          </div>
        </div>
      )}

      {toolCall.name === 'run_subagents' &&
        (toolCall.status === 'running' ||
          toolCall.status === 'done' ||
          toolCall.status === 'cancelled') && (
          <div className="premium-panel-soft w-full mt-2 flex flex-col gap-3 p-4 rounded-[20px] border">
            {hasAgentUpdates ? (
              <>
                {/* Sleek SVG Swarm Graph */}
                <div className="w-full relative flex justify-center py-2 bg-black/20 rounded-xl border border-white/[0.04]">
                  <svg viewBox="0 0 400 150" className="w-full select-none">
                    {/* Connection Lines */}
                    {workerKeys.map((key, idx) => {
                      const phase = toolCall.agentUpdates?.[key]?.phase || 'idle'
                      const style = getPhaseStyle(phase)
                      const x = getWorkerX(idx, workerKeys.length)
                      const isAnimating = phase === 'thinking' || phase === 'tool_use'

                      return (
                        <line
                          key={`line-${key}`}
                          x1={masterX}
                          y1={masterY}
                          x2={x}
                          y2={workerY}
                          stroke={style.color}
                          strokeWidth={1.5}
                          strokeOpacity={phase === 'idle' ? 0.15 : 0.5}
                          strokeDasharray={isAnimating ? '4,4' : 'none'}
                          className={clsx(
                            'transition-all duration-500',
                            isAnimating && 'swarm-dash'
                          )}
                        />
                      )
                    })}

                    {/* Master Node */}
                    {(() => {
                      const phase = toolCall.agentUpdates?.['master']?.phase || 'idle'
                      const style = getPhaseStyle(phase)
                      const isSelected = activeKey === 'master'

                      return (
                        <g
                          className="cursor-pointer group"
                          onClick={() => setSelectedAgentKey('master')}
                        >
                          {/* Glow */}
                          <circle
                            cx={masterX}
                            cy={masterY}
                            r={22}
                            fill={style.color}
                            className={clsx(
                              'transition-all duration-300',
                              isSelected
                                ? 'opacity-20 animate-pulse'
                                : 'opacity-0 group-hover:opacity-10'
                            )}
                          />
                          {/* Node */}
                          <circle
                            cx={masterX}
                            cy={masterY}
                            r={15}
                            fill="var(--color-background-secondary)"
                            stroke={style.border}
                            strokeWidth={isSelected ? 2.5 : 1.5}
                            className="transition-all duration-300"
                          />
                          <text
                            x={masterX}
                            y={masterY + 4}
                            textAnchor="middle"
                            fontSize="11"
                            className="pointer-events-none"
                          >
                            👑
                          </text>
                        </g>
                      )
                    })()}

                    {/* Worker Nodes */}
                    {workerKeys.map((key, idx) => {
                      const phase = toolCall.agentUpdates?.[key]?.phase || 'idle'
                      const style = getPhaseStyle(phase)
                      const x = getWorkerX(idx, workerKeys.length)
                      const isSelected = activeKey === String(key)

                      return (
                        <g
                          key={`node-${key}`}
                          className="cursor-pointer group"
                          onClick={() => setSelectedAgentKey(String(key))}
                        >
                          {/* Glow */}
                          <circle
                            cx={x}
                            cy={workerY}
                            r={18}
                            fill={style.color}
                            className={clsx(
                              'transition-all duration-300',
                              isSelected
                                ? 'opacity-15 animate-pulse'
                                : 'opacity-0 group-hover:opacity-10'
                            )}
                          />
                          {/* Node */}
                          <circle
                            cx={x}
                            cy={workerY}
                            r={11}
                            fill="var(--color-background-secondary)"
                            stroke={style.border}
                            strokeWidth={isSelected ? 2.5 : 1.5}
                            className="transition-all duration-300"
                          />
                          <text
                            x={x}
                            y={workerY + 3.5}
                            textAnchor="middle"
                            fontSize="8"
                            fontWeight="black"
                            fill={style.color}
                            className="pointer-events-none font-mono"
                          >
                            {key}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>

                {/* Agent Detail Card */}
                {activeAgent && (
                  <div className="flex flex-col gap-2.5 p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] transition-all duration-300 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest flex items-center gap-1.5">
                        {activeKey === 'master'
                          ? '👑 Master Coordinator'
                          : `🤖 Worker Agent #${activeKey}`}
                      </span>
                      <span
                        className={clsx(
                          'text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider',
                          activeAgent.phase === 'thinking'
                            ? 'bg-accent-primary/10 text-accent-primary'
                            : activeAgent.phase === 'tool_use'
                              ? 'bg-status-warning/10 text-status-warning'
                              : activeAgent.phase === 'done'
                                ? 'bg-status-success/10 text-status-success'
                                : 'bg-status-error/10 text-status-error'
                        )}
                      >
                        {activeAgent.command?.includes('WAITING')
                          ? 'LISTENING'
                          : activeAgent.command?.includes('MESSAGE TO')
                            ? 'SENDING'
                            : activeAgent.phase.replace('_', ' ')}
                      </span>
                    </div>

                    {activeAgent.command && (
                      <div
                        className={clsx(
                          'flex items-start gap-2 p-2 rounded border font-mono text-[9.5px]',
                          activeAgent.command.includes('POST TO GROUP')
                            ? 'bg-accent-primary/5 border-accent-primary/15'
                            : activeAgent.command.includes('WAITING')
                              ? 'bg-accent-primary/5 border-accent-primary/15 animate-pulse'
                              : 'bg-black/30 border-white/[0.04]'
                        )}
                      >
                        <span className="text-[#8888A0] font-bold uppercase tracking-wider whitespace-nowrap mt-0.5">
                          {activeAgent.command.includes('POST TO GROUP')
                            ? '➔ RADIO:'
                            : activeAgent.command.includes('WAITING')
                              ? '📡 SCAN:'
                              : 'ACTION:'}
                        </span>
                        <code
                          className={clsx(
                            'break-all leading-relaxed',
                            activeAgent.command.includes('POST TO GROUP')
                              ? 'text-accent-primary'
                              : 'text-text-primary'
                          )}
                        >
                          {activeAgent.command}
                        </code>
                      </div>
                    )}

                    {activeAgent.output && (
                      <div className="flex flex-col gap-1 p-2 rounded border border-white/[0.04] bg-black/15 font-mono text-[9px]">
                        <span className="text-[#8888A0] font-bold uppercase tracking-wider">
                          Output Log
                        </span>
                        <div className="text-text-secondary break-words line-clamp-2 italic">
                          {activeAgent.output}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-6">
                <Spinner size="md" className="mb-3" />
                <span className="text-[10px] tracking-wider uppercase font-bold text-[#8888A0] animate-pulse">
                  Synchronizing Swarm Network...
                </span>
              </div>
            )}
          </div>
        )}
    </div>
  )
}
