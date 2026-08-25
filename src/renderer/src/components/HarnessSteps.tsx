import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  Code,
  FileCode,
  FolderOpen,
  GlobeSimple,
  MagnifyingGlass,
  TerminalWindow,
  XCircle
} from '@phosphor-icons/react'
import type { HarnessSource, HarnessToolName } from '../../../shared/types'
import type { ToolCallItem } from '../types/tab'
import { AnsiRenderer } from './ActionLoader'

const HARNESS_LABELS: Record<HarnessToolName, string> = {
  read: 'Read file',
  list: 'Listed directory',
  find: 'Found files',
  write: 'Wrote file',
  edit: 'Edited file',
  delete_lines: 'Deleted lines',
  apply_patch: 'Applied patch',
  exec_command: 'Ran command',
  write_stdin: 'Sent terminal input',
  read_terminal_output: 'Read terminal output',
  web_search: 'Searched the web'
}

const HARNESS_NAMES = new Set(Object.keys(HARNESS_LABELS))

interface DecodedResult {
  ok?: boolean
  outputText: string
  output: unknown
  diff?: string
  sources: HarnessSource[]
  runId?: string
}

function decodeToolResult(result?: string): DecodedResult {
  if (!result) return { outputText: '', output: '', sources: [] }
  try {
    const envelope = JSON.parse(result) as { ok?: boolean; output?: unknown; error?: unknown }
    const rawOutput = envelope.ok === false ? envelope.error : envelope.output
    if (typeof rawOutput !== 'string') {
      return {
        ok: envelope.ok,
        outputText: JSON.stringify(rawOutput, null, 2),
        output: rawOutput,
        sources: []
      }
    }
    try {
      const parsed = JSON.parse(rawOutput) as {
        diff?: string
        sources?: HarnessSource[]
        runId?: string
        output?: string
      }
      return {
        ok: envelope.ok,
        outputText: JSON.stringify(parsed, null, 2),
        output: parsed,
        diff: typeof parsed.diff === 'string' ? parsed.diff : undefined,
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        runId: typeof parsed.runId === 'string' ? parsed.runId : undefined
      }
    } catch {
      return { ok: envelope.ok, outputText: rawOutput, output: rawOutput, sources: [] }
    }
  } catch {
    return { outputText: result, output: result, sources: [] }
  }
}

function toolIcon(name: string): React.JSX.Element {
  const props = { size: 14, weight: 'regular' as const }
  if (name === 'exec_command' || name === 'write_stdin' || name === 'read_terminal_output') {
    return <TerminalWindow {...props} />
  }
  if (name === 'web_search') return <GlobeSimple {...props} />
  if (name === 'find') return <MagnifyingGlass {...props} />
  if (name === 'list') return <FolderOpen {...props} />
  if (name === 'apply_patch') return <Code {...props} />
  return <FileCode {...props} />
}

function StatusIcon({ status }: { status: ToolCallItem['status'] }): React.JSX.Element {
  if (status === 'done')
    return <CheckCircle size={13} weight="fill" className="text-status-success/80" />
  if (status === 'error' || status === 'cancelled') {
    return <XCircle size={13} weight="fill" className="text-status-error/80" />
  }
  return <CircleNotch size={13} className="animate-spin text-accent-primary" />
}

function DiffView({ value }: { value: string }): React.JSX.Element {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-black/35 py-2 font-mono text-[10.5px] leading-[1.55] custom-scrollbar">
      {value.split('\n').map((line, index) => (
        <span
          key={`${index}-${line}`}
          className={clsx(
            'block whitespace-pre px-3 text-text-secondary',
            line.startsWith('+') &&
              !line.startsWith('+++') &&
              'bg-emerald-400/[0.07] text-emerald-200/80',
            line.startsWith('-') && !line.startsWith('---') && 'bg-red-400/[0.07] text-red-200/75',
            (line.startsWith('@@') || line.startsWith('rename ')) && 'text-accent-primary/75'
          )}
        >
          {line || ' '}
        </span>
      ))}
    </pre>
  )
}

function DetailBlock({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <span className="mb-1.5 block text-[9.5px] font-semibold uppercase tracking-[0.12em] text-text-muted/80">
        {label}
      </span>
      {children}
    </div>
  )
}

function StepRow({ tool, index }: { tool: ToolCallItem; index: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const decoded = useMemo(() => decodeToolResult(tool.result), [tool.result])
  const isActive =
    tool.status === 'writing' || tool.status === 'running' || tool.status === 'cooldown'
  const command = typeof tool.args.cmd === 'string' ? tool.args.cmd : ''
  const runId =
    tool.runId || decoded.runId || (typeof tool.args.runId === 'string' ? tool.args.runId : '')
  const output =
    decoded.output && typeof decoded.output === 'object' && 'output' in decoded.output
      ? String((decoded.output as { output?: unknown }).output || '')
      : decoded.outputText
  const duration =
    tool.startedAt && tool.finishedAt
      ? `${Math.max(0.1, (tool.finishedAt - tool.startedAt) / 1000).toFixed(1)}s`
      : ''

  return (
    <article className="overflow-hidden rounded-lg transition-colors hover:bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-primary/55"
        aria-expanded={expanded}
      >
        <span className="w-4 shrink-0 font-mono text-[9px] tabular-nums text-text-muted/65">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-text-muted">{toolIcon(tool.name)}</span>
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-[12px] font-medium',
            isActive ? 'tool-shimmer-text' : 'text-text-secondary'
          )}
        >
          {HARNESS_NAMES.has(tool.name)
            ? HARNESS_LABELS[tool.name as HarnessToolName]
            : tool.name.replace(/_/g, ' ')}
        </span>
        {duration && <span className="font-mono text-[9.5px] text-text-muted/65">{duration}</span>}
        <StatusIcon status={tool.status} />
        <CaretDown
          size={11}
          className={clsx(
            'text-text-muted transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-white/[0.045] px-3 pb-3 pt-2.5 animate-fade-in">
          <DetailBlock label="Input">
            {command ? (
              <div className="rounded-lg border border-white/[0.045] bg-black/35 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-text-secondary">
                <span className="mr-2 select-none text-accent-primary/60">$</span>
                {command}
              </div>
            ) : (
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/35 p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary custom-scrollbar">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            )}
          </DetailBlock>

          {decoded.diff ? (
            <DetailBlock label="Diff">
              <DiffView value={decoded.diff} />
            </DetailBlock>
          ) : tool.result || tool.terminalOutput ? (
            <DetailBlock label="Output">
              <div className="overflow-hidden rounded-lg border border-white/[0.045] bg-black/35">
                {runId && (
                  <div className="border-b border-white/[0.045] px-3 py-1.5 font-mono text-[9.5px] text-text-muted">
                    Run ID {runId}
                  </div>
                )}
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary custom-scrollbar">
                  {tool.name === 'exec_command' || tool.name === 'read_terminal_output' ? (
                    <AnsiRenderer text={tool.terminalOutput || output} />
                  ) : (
                    output
                  )}
                </pre>
              </div>
            </DetailBlock>
          ) : null}
        </div>
      )}
    </article>
  )
}

function Sources({ sources }: { sources: HarnessSource[] }): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (sources.length === 0) return null
  return (
    <div className="mt-1 border-t border-white/[0.045] pt-1">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] font-medium text-text-muted transition-colors hover:bg-white/[0.025] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55"
        aria-expanded={expanded}
      >
        <GlobeSimple size={13} />
        <span className="flex-1">Sources · {sources.length}</span>
        <CaretDown size={11} className={clsx('transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="grid gap-1 px-1 pb-2 animate-fade-in">
          {sources.map((source) => (
            <button
              key={source.url}
              type="button"
              onClick={() => void window.api.openExternalUrl(source.url)}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.03]"
            >
              <img src={source.faviconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" />
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-text-secondary">
                {source.title}
              </span>
              <span className="shrink-0 text-[9.5px] text-text-muted">{source.domain}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function HarnessSteps({
  tools,
  thoughts,
  isActive,
  showThinking = true,
  showSteps = true,
  reduceMotion = false
}: {
  tools: ToolCallItem[]
  thoughts?: string
  isActive: boolean
  showThinking?: boolean
  showSteps?: boolean
  reduceMotion?: boolean
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(isActive)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const harnessTools = tools.filter((tool) => HARNESS_NAMES.has(tool.name))
  const sources = useMemo(
    () => harnessTools.flatMap((tool) => decodeToolResult(tool.result).sources),
    [harnessTools]
  )

  if ((!showSteps || harnessTools.length === 0) && (!showThinking || !thoughts?.trim())) return null

  const doneCount = harnessTools.filter((tool) => tool.status === 'done').length
  return (
    <section
      className={clsx(
        'mb-2 w-full max-w-[760px] overflow-hidden rounded-xl border border-white/[0.055] bg-white/[0.018]',
        reduceMotion && '[&_*]:!transition-none [&_.animate-spin]:!animate-none'
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-primary/55"
        aria-expanded={expanded}
      >
        <span
          className={clsx(
            'text-[12px] font-medium',
            isActive ? 'tool-shimmer-text' : 'text-text-secondary'
          )}
        >
          {isActive ? 'Working through steps' : 'Steps'}
        </span>
        <span className="flex-1 text-[9.5px] text-text-muted">
          {harnessTools.length > 0 ? `${doneCount}/${harnessTools.length}` : 'Thinking'}
        </span>
        <CaretDown
          size={12}
          className={clsx(
            'text-text-muted transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-white/[0.045] p-1.5 animate-fade-in">
          {showThinking && thoughts?.trim() && (
            <div className="mb-1 overflow-hidden rounded-lg">
              <button
                type="button"
                onClick={() => setThinkingExpanded((value) => !value)}
                className="flex w-full items-center gap-2.5 px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-primary/55"
                aria-expanded={thinkingExpanded}
              >
                <span className="w-4 font-mono text-[9px] text-text-muted/65">00</span>
                <CircleNotch
                  size={14}
                  className={clsx('text-text-muted', isActive && 'animate-spin')}
                />
                <span
                  className={clsx(
                    'flex-1 text-[12px] font-medium',
                    isActive ? 'thinking-shimmer-text' : 'text-text-secondary'
                  )}
                >
                  Thinking
                </span>
                <CaretDown
                  size={11}
                  className={clsx(
                    'text-text-muted transition-transform',
                    thinkingExpanded && 'rotate-180'
                  )}
                />
              </button>
              {thinkingExpanded && (
                <div className="border-t border-white/[0.045] px-3 py-3 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                  {thoughts.trim()}
                </div>
              )}
            </div>
          )}
          {showSteps &&
            harnessTools.map((tool, index) => (
              <StepRow key={tool.id || `${tool.name}-${index}`} tool={tool} index={index} />
            ))}
        </div>
      )}
      <Sources sources={sources} />
    </section>
  )
}
