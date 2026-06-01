import { useState } from 'react'
import { clsx } from 'clsx'
import { SubagentMessage } from '../../../shared/types'
import {
  DeviceMobile,
  MagnifyingGlass,
  Terminal,
  ArrowUpRight,
  List,
  HardDrive,
  Brain,
  CheckCircle,
  XCircle,
  CircleNotch,
  CaretDown,
  PlayCircle,
  FileText,
  AppWindow,
  Gear
} from '@phosphor-icons/react'

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
  mode?: 'compact' | 'full'
}

const phaseColorCodes = {
  thinking: {
    color: 'var(--color-accent-primary)',
    fill: 'rgba(143, 180, 255, 0.05)',
    border: 'var(--color-accent-primary)'
  },
  tool_use: {
    color: 'var(--color-status-warning)',
    fill: 'rgba(228, 187, 106, 0.05)',
    border: 'var(--color-status-warning)'
  },
  done: {
    color: 'var(--color-status-success)',
    fill: 'rgba(121, 216, 159, 0.05)',
    border: 'var(--color-status-success)'
  },
  error: {
    color: 'var(--color-status-error)',
    fill: 'rgba(239, 127, 120, 0.05)',
    border: 'var(--color-status-error)'
  },
  cancelled: {
    color: 'var(--color-text-secondary)',
    fill: 'rgba(164, 161, 154, 0.05)',
    border: 'var(--color-text-secondary)'
  },
  idle: {
    color: 'var(--color-text-muted)',
    fill: 'rgba(105, 103, 97, 0.05)',
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

function useToolCallMeta(toolCall: ToolCall): {
  displayTitle: string
  displayDetail: string
  tone: 'default' | 'search' | 'think' | 'success' | 'error' | 'youtube'
  isDone: boolean
  isWriting: boolean
  isRunning: boolean
  statusLabel: string
  renderIcon: (size?: number) => React.JSX.Element
  isYoutube: boolean
} {
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
    displayDetail =
      changedArgs.length > 0
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

  const renderIcon = (size = 16): React.JSX.Element => {
    if (isDone) {
      if (toolCall.status === 'done') return <CheckCircle size={size} weight="fill" />
      return <XCircle size={size} weight="fill" />
    }

    if (isWriting) {
      if (toolCall.name === 'mini-app')
        return <AppWindow size={size} weight="regular" className="animate-pulse" />
      return <Brain size={size} weight="regular" className="animate-pulse" />
    }
    if (toolCall.name === 'web_search' || toolCall.name === 'search_chat_history')
      return <MagnifyingGlass size={size} weight="regular" className="animate-pulse" />
    if (isYoutube) return <PlayCircle size={size} weight="regular" className="animate-pulse" />
    if (toolCall.name === 'execute_terminal_command')
      return <Terminal size={size} weight="regular" />
    if (toolCall.name === 'open_browser_link' || toolCall.name === 'open_application')
      return <ArrowUpRight size={size} weight="regular" />
    if (toolCall.name === 'list_installed_applications')
      return <List size={size} weight="regular" />
    if (toolCall.name.startsWith('computer_use_')) return <HardDrive size={size} weight="regular" />
    if (toolCall.name === 'saw_link_from_url') return <FileText size={size} weight="regular" />
    if (toolCall.name === 'configure_prism')
      return <Gear size={size} weight="regular" className="animate-pulse" />
    return <CircleNotch size={size} weight="bold" className="animate-spin" />
  }

  return {
    displayTitle,
    displayDetail,
    tone,
    isDone,
    isWriting,
    isRunning,
    statusLabel,
    renderIcon,
    isYoutube
  }
}

function CompactActionLoader({ toolCall }: { toolCall: ToolCall }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('master')

  const { displayTitle, tone, isDone, isRunning, statusLabel, renderIcon } =
    useToolCallMeta(toolCall)

  const toneColors = {
    default: {
      border: 'border-white/[0.06]',
      bg: 'bg-white/[0.02]',
      text: 'text-text-secondary',
      icon: 'text-text-secondary'
    },
    search: {
      border: 'border-accent-secondary/20',
      bg: 'bg-accent-secondary/[0.02]',
      text: 'text-accent-secondary',
      icon: 'text-accent-secondary'
    },
    think: {
      border: 'border-status-warning/20',
      bg: 'bg-status-warning/[0.02]',
      text: 'text-status-warning',
      icon: 'text-status-warning'
    },
    success: {
      border: 'border-status-success/20',
      bg: 'bg-status-success/[0.02]',
      text: 'text-status-success',
      icon: 'text-status-success'
    },
    error: {
      border: 'border-status-error/20',
      bg: 'bg-status-error/[0.02]',
      text: 'text-status-error',
      icon: 'text-status-error'
    },
    youtube: {
      border: 'border-accent-primary/20',
      bg: 'bg-accent-primary/[0.02]',
      text: 'text-accent-primary',
      icon: 'text-accent-primary'
    }
  }[tone]

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

  const showSubagentPanel =
    toolCall.name === 'run_subagents' &&
    (toolCall.status === 'running' || toolCall.status === 'done' || toolCall.status === 'cancelled')

  return (
    <div className="my-1 flex flex-col gap-1.5 max-w-[420px]">
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

      {/* ── Flat Box ── */}
      <div
        onClick={() => isDone && setIsExpanded(!isExpanded)}
        className={clsx(
          'inline-flex items-center gap-2 rounded-lg border px-3 py-2',
          'transition-colors duration-200 select-none',
          toneColors.border,
          toneColors.bg,
          isDone ? 'cursor-pointer hover:bg-white/[0.04]' : 'cursor-default'
        )}
      >
        <div className={clsx('flex shrink-0 items-center justify-center', toneColors.icon)}>
          {renderIcon(14)}
        </div>

        <span className="text-[13px] font-medium text-text-primary leading-none">
          {displayTitle}
        </span>
        <span className={clsx('text-[11px] font-medium leading-none opacity-70', toneColors.text)}>
          · {statusLabel}
        </span>

        <div className="ml-auto flex items-center gap-1.5 pl-2">
          {toolCall.name === 'run_subagents' && showSubagentPanel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.api.openSubagentsWindow(toolCall.subagentMessages)
              }}
              className="p-1 rounded cursor-pointer transition-colors text-accent-primary hover:bg-accent-primary/10"
              title="Open Subagent Chat"
            >
              <DeviceMobile size={14} weight="regular" />
            </button>
          )}

          {isRunning && (
            <CircleNotch size={14} weight="bold" className="animate-spin text-text-muted" />
          )}

          {isDone && (
            <CaretDown
              size={14}
              className={clsx(
                'text-text-muted transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] mt-1 tool-pill-result-enter">
          <div className="flex items-center border-b border-white/[0.03] px-3 py-2">
            <span className="text-[11px] font-medium text-text-muted uppercase tracking-widest">
              Output
            </span>
          </div>
          <div className="max-h-[300px] overflow-auto p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
            <pre className="whitespace-pre-wrap break-all">{toolCall.result}</pre>
          </div>
        </div>
      )}

      {/* Subagent logic preserved but styled flatter */}
      {showSubagentPanel && (isExpanded || isRunning) && (
        <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 flex flex-col gap-2 mt-1 tool-pill-result-enter">
          {hasAgentUpdates ? (
            <>
              {/* SVG Swarm Graph */}
              <div className="w-full relative flex justify-center py-2 rounded-lg border border-white/[0.02]">
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
                        className={clsx('transition-all duration-500', isAnimating && 'swarm-dash')}
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
                        <circle
                          cx={masterX}
                          cy={masterY}
                          r={15}
                          fill="var(--color-background-secondary)"
                          stroke={style.border}
                          strokeWidth={isSelected ? 2 : 1.5}
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
                        <circle
                          cx={x}
                          cy={workerY}
                          r={11}
                          fill="var(--color-background-secondary)"
                          stroke={style.border}
                          strokeWidth={isSelected ? 2 : 1.5}
                          className="transition-all duration-300"
                        />
                        <text
                          x={x}
                          y={workerY + 3.5}
                          textAnchor="middle"
                          fontSize="8"
                          fontWeight="bold"
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
                <div className="flex flex-col gap-2 p-3 rounded-lg border border-white/[0.02] transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-text-secondary uppercase tracking-widest flex items-center gap-1.5">
                      {activeKey === 'master'
                        ? '👑 Master Coordinator'
                        : `🤖 Worker Agent #${activeKey}`}
                    </span>
                    <span
                      className={clsx(
                        'text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm tracking-wider',
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
                        'flex items-start gap-2 p-2 rounded-md font-mono text-[10px]',
                        activeAgent.command.includes('POST TO GROUP')
                          ? 'bg-accent-primary/5 text-accent-primary'
                          : activeAgent.command.includes('WAITING')
                            ? 'bg-accent-primary/5 text-accent-primary animate-pulse'
                            : 'bg-white/[0.02] text-text-primary'
                      )}
                    >
                      <span className="opacity-60 font-bold uppercase tracking-wider whitespace-nowrap mt-0.5">
                        {activeAgent.command.includes('POST TO GROUP')
                          ? '➔ RADIO:'
                          : activeAgent.command.includes('WAITING')
                            ? '📡 SCAN:'
                            : 'ACTION:'}
                      </span>
                      <code className="break-all leading-relaxed">{activeAgent.command}</code>
                    </div>
                  )}

                  {activeAgent.output && (
                    <div className="flex flex-col gap-1 p-2 rounded-md bg-white/[0.02] font-mono text-[10px]">
                      <span className="opacity-50 font-bold uppercase tracking-wider">
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
            <div className="flex flex-col items-center justify-center py-4">
              <CircleNotch size={20} weight="bold" className="animate-spin text-text-muted mb-2" />
              <span className="text-[11px] tracking-wider uppercase font-medium text-text-muted">
                Synchronizing Swarm Network...
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FullActionLoader({ toolCall }: { toolCall: ToolCall }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('master')

  const { displayTitle, displayDetail, tone, isDone, isRunning, statusLabel, renderIcon } =
    useToolCallMeta(toolCall)

  const toneClasses = {
    default: 'border-white/[0.04] bg-white/[0.02] text-text-secondary',
    search: 'border-accent-secondary/20 bg-accent-secondary/[0.02] text-accent-secondary',
    think: 'border-status-warning/20 bg-status-warning/[0.02] text-status-warning',
    success: 'border-status-success/20 bg-status-success/[0.02] text-status-success',
    error: 'border-status-error/20 bg-status-error/[0.02] text-status-error',
    youtube: 'border-accent-primary/20 bg-accent-primary/[0.02] text-accent-primary'
  }[tone]

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
          'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors duration-200 select-none',
          toneClasses,
          isDone ? 'cursor-pointer hover:bg-white/[0.03]' : 'cursor-default'
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">{renderIcon(20)}</div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{displayTitle}</span>
            <span className="rounded bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium opacity-80">
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs opacity-70">{displayDetail}</p>
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
                className="p-1.5 rounded cursor-pointer transition-colors text-accent-primary hover:bg-accent-primary/10 animate-pulse"
                title="Open Subagent Chat"
              >
                <DeviceMobile size={16} />
              </button>
            )}

          {isRunning && <CircleNotch size={16} weight="bold" className="animate-spin opacity-50" />}

          {isDone && (
            <CaretDown
              size={16}
              className={clsx(
                'opacity-50 transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          )}
        </div>
      </div>

      {isExpanded && toolCall.result && (
        <div className="w-full overflow-hidden rounded-xl border border-white/[0.04] bg-white/[0.01]">
          <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
            <span className="text-xs font-medium text-text-muted">Tool Output</span>
          </div>
          <div className="max-h-[400px] overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-text-secondary">
            <pre className="whitespace-pre-wrap break-all text-text-primary/90">
              {toolCall.result}
            </pre>
          </div>
        </div>
      )}

      {/* Subagent graph (Full) */}
      {toolCall.name === 'run_subagents' &&
        (toolCall.status === 'running' ||
          toolCall.status === 'done' ||
          toolCall.status === 'cancelled') && (
          <div className="w-full mt-2 flex flex-col gap-3 p-4 rounded-xl border border-white/[0.04] bg-white/[0.01]">
            {hasAgentUpdates ? (
              <>
                <div className="w-full relative flex justify-center py-2 rounded-lg border border-white/[0.02]">
                  <svg viewBox="0 0 400 150" className="w-full select-none">
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

                    {(() => {
                      const phase = toolCall.agentUpdates?.['master']?.phase || 'idle'
                      const style = getPhaseStyle(phase)
                      const isSelected = activeKey === 'master'

                      return (
                        <g
                          className="cursor-pointer group"
                          onClick={() => setSelectedAgentKey('master')}
                        >
                          <circle
                            cx={masterX}
                            cy={masterY}
                            r={15}
                            fill="var(--color-background-secondary)"
                            stroke={style.border}
                            strokeWidth={isSelected ? 2 : 1.5}
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
                          <circle
                            cx={x}
                            cy={workerY}
                            r={11}
                            fill="var(--color-background-secondary)"
                            stroke={style.border}
                            strokeWidth={isSelected ? 2 : 1.5}
                            className="transition-all duration-300"
                          />
                          <text
                            x={x}
                            y={workerY + 3.5}
                            textAnchor="middle"
                            fontSize="8"
                            fontWeight="bold"
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

                {activeAgent && (
                  <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-white/[0.02] transition-all duration-300">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-text-secondary uppercase tracking-widest flex items-center gap-1.5">
                        {activeKey === 'master'
                          ? '👑 Master Coordinator'
                          : `🤖 Worker Agent #${activeKey}`}
                      </span>
                      <span
                        className={clsx(
                          'text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm tracking-wider',
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
                          'flex items-start gap-2 p-2 rounded-md font-mono text-[11px]',
                          activeAgent.command.includes('POST TO GROUP')
                            ? 'bg-accent-primary/5 text-accent-primary'
                            : activeAgent.command.includes('WAITING')
                              ? 'bg-accent-primary/5 text-accent-primary animate-pulse'
                              : 'bg-white/[0.02] text-text-primary'
                        )}
                      >
                        <span className="opacity-60 font-bold uppercase tracking-wider whitespace-nowrap mt-0.5">
                          {activeAgent.command.includes('POST TO GROUP')
                            ? '➔ RADIO:'
                            : activeAgent.command.includes('WAITING')
                              ? '📡 SCAN:'
                              : 'ACTION:'}
                        </span>
                        <code className="break-all leading-relaxed">{activeAgent.command}</code>
                      </div>
                    )}

                    {activeAgent.output && (
                      <div className="flex flex-col gap-1 p-2 rounded-md bg-white/[0.02] font-mono text-[11px]">
                        <span className="opacity-50 font-bold uppercase tracking-wider">
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
                <CircleNotch
                  size={24}
                  weight="bold"
                  className="animate-spin text-text-muted mb-3"
                />
                <span className="text-[11px] tracking-wider uppercase font-medium text-text-muted">
                  Synchronizing Swarm Network...
                </span>
              </div>
            )}
          </div>
        )}
    </div>
  )
}

export function ActionLoader({ toolCall, mode = 'compact' }: ActionLoaderProps): React.JSX.Element {
  if (mode === 'full') {
    return <FullActionLoader toolCall={toolCall} />
  }
  return <CompactActionLoader toolCall={toolCall} />
}
