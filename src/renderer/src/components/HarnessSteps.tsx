import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  CaretDown,
  CircleNotch,
  Code,
  FileCode,
  FolderOpen,
  GlobeSimple,
  MagnifyingGlass,
  ChatTeardropText,
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
  to_ask: 'Asked a question',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) || ''
  } catch {
    return String(value ?? '')
  }
}

function compact(value: string, maxLength = 58): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function stringArg(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function targetPath(args: Record<string, unknown>): string {
  return stringArg(args, ['path', 'filePath', 'file_path', 'directory', 'cwd'])
}

function parseSources(value: unknown): HarnessSource[] {
  if (!Array.isArray(value)) return []
  const sources: HarnessSource[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    let fallbackDomain = ''
    try {
      fallbackDomain = new URL(url).hostname
    } catch {
      // The protocol check above is intentionally followed by URL validation.
    }
    sources.push({
      url,
      title:
        typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : fallbackDomain || url,
      domain:
        typeof candidate.domain === 'string' && candidate.domain.trim()
          ? candidate.domain.trim()
          : fallbackDomain,
      faviconUrl:
        typeof candidate.faviconUrl === 'string' && /^https?:\/\//i.test(candidate.faviconUrl)
          ? candidate.faviconUrl
          : ''
    })
  }
  return sources
}

function patchTargets(patch: string): string[] {
  return Array.from(
    patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm),
    (match) => match[1].trim()
  )
}

function isToolActive(tool: ToolCallItem): boolean {
  return tool.status === 'writing' || tool.status === 'running' || tool.status === 'cooldown'
}

function lineCount(value: string): number {
  return value ? value.split(/\r?\n/).length : 0
}

function changeSummary(tool: ToolCallItem): string {
  if (!['write', 'edit', 'delete_lines', 'apply_patch'].includes(tool.name)) return ''
  const args = asRecord(tool.args)
  const added =
    tool.addedLines ??
    (tool.name === 'write'
      ? lineCount(stringArg(args, ['content']))
      : tool.name === 'edit'
        ? lineCount(stringArg(args, ['newText', 'new_text']))
        : 0)
  const removed =
    tool.removedLines ??
    (tool.name === 'edit' || tool.name === 'delete_lines'
      ? lineCount(stringArg(args, ['oldText', 'old_text']))
      : 0)
  const parts = [added > 0 ? `+${added}` : '', removed > 0 ? `-${removed}` : ''].filter(Boolean)
  return parts.join(' ')
}

function describeTool(tool: ToolCallItem): string {
  const args = asRecord(tool.args)
  const active = isToolActive(tool)
  const path = targetPath(args)
  const command = stringArg(args, ['cmd', 'command'])
  const query = stringArg(args, ['query', 'pattern'])

  switch (tool.name) {
    case 'read':
      return path ? `${active ? 'Reading' : 'Read'} ${compact(path)}` : active ? 'Reading file' : 'Read file'
    case 'list':
      return path
        ? `${active ? 'Listing' : 'Listed'} ${compact(path)}`
        : active
          ? 'Listing project files'
          : 'Listed project files'
    case 'find':
      return query
        ? `${active ? 'Finding' : 'Found'} ${compact(query)}`
        : active
          ? 'Finding files'
          : 'Found files'
    case 'write':
      return path ? `${active ? 'Writing' : 'Wrote'} ${compact(path)}` : active ? 'Writing file' : 'Wrote file'
    case 'edit':
      return path ? `${active ? 'Editing' : 'Edited'} ${compact(path)}` : active ? 'Editing file' : 'Edited file'
    case 'delete_lines':
      return path
        ? `${active ? 'Removing from' : 'Removed from'} ${compact(path)}`
        : active
          ? 'Removing lines'
          : 'Removed lines'
    case 'apply_patch': {
      const targets = patchTargets(stringArg(args, ['patch']))
      if (targets.length === 1) {
        return `${active ? 'Updating' : 'Updated'} ${compact(targets[0])}`
      }
      if (targets.length > 1) {
        return `${active ? 'Updating' : 'Updated'} ${targets.length} files`
      }
      return active ? 'Applying patch' : 'Applied patch'
    }
    case 'exec_command':
      return command ? `${active ? 'Running' : 'Ran'} ${compact(command)}` : active ? 'Running command' : 'Ran command'
    case 'write_stdin':
      return active ? 'Sending terminal input' : 'Sent terminal input'
    case 'read_terminal_output':
      return active ? 'Checking terminal output' : 'Read terminal output'
    case 'web_search':
      return query
        ? `${active ? 'Searching' : 'Searched'} the web for ${compact(query, 52)}`
        : active
          ? 'Searching the web'
          : 'Searched the web'
    case 'to_ask':
      return active ? 'Waiting for your answer' : 'Asked a question'
    default:
      return tool.name.replace(/_/g, ' ')
  }
}

function decodeToolResult(result?: string): DecodedResult {
  if (!result) return { outputText: '', output: '', sources: [] }
  try {
    const parsedEnvelope = JSON.parse(result) as unknown
    if (!isRecord(parsedEnvelope)) {
      return { outputText: result, output: result, sources: [] }
    }
    const rawOutput = parsedEnvelope.ok === false ? parsedEnvelope.error : parsedEnvelope.output
    if (typeof rawOutput !== 'string') {
      return {
        ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
        outputText: stringify(rawOutput),
        output: rawOutput,
        sources: []
      }
    }
    try {
      const parsedOutput = JSON.parse(rawOutput) as unknown
      if (!isRecord(parsedOutput)) {
        return {
          ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
          outputText: rawOutput,
          output: rawOutput,
          sources: []
        }
      }
      return {
        ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
        outputText: stringify(parsedOutput),
        output: parsedOutput,
        diff: typeof parsedOutput.diff === 'string' ? parsedOutput.diff : undefined,
        sources: parseSources(parsedOutput.sources),
        runId: typeof parsedOutput.runId === 'string' ? parsedOutput.runId : undefined
      }
    } catch {
      return {
        ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
        outputText: rawOutput,
        output: rawOutput,
        sources: []
      }
    }
  } catch {
    return { outputText: result, output: result, sources: [] }
  }
}

function toolIcon(name: string): React.JSX.Element {
  const props = { size: 13, weight: 'regular' as const }
  if (name === 'exec_command' || name === 'write_stdin' || name === 'read_terminal_output') {
    return <TerminalWindow {...props} />
  }
  if (name === 'web_search') return <GlobeSimple {...props} />
  if (name === 'to_ask') return <ChatTeardropText {...props} />
  if (name === 'find') return <MagnifyingGlass {...props} />
  if (name === 'list') return <FolderOpen {...props} />
  if (name === 'apply_patch') return <Code {...props} />
  return <FileCode {...props} />
}

function ActivityState({ tool }: { tool: ToolCallItem }): React.JSX.Element | null {
  if (isToolActive(tool)) {
    return <CircleNotch size={12} className="shrink-0 animate-spin text-text-muted" />
  }
  if (tool.status === 'error' || tool.status === 'cancelled') {
    return <XCircle size={12} weight="fill" className="shrink-0 text-status-error/75" />
  }
  return null
}

function DiffView({ value }: { value: string }): React.JSX.Element {
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-black/25 py-1.5 font-mono text-[10.5px] leading-[1.55] custom-scrollbar">
      {value.split('\n').map((line, index) => (
        <span
          key={`${index}-${line}`}
          className={clsx(
            'block whitespace-pre px-2.5 text-text-secondary',
            line.startsWith('+') &&
              !line.startsWith('+++') &&
              'bg-emerald-400/[0.06] text-emerald-200/80',
            line.startsWith('-') && !line.startsWith('---') && 'bg-red-400/[0.06] text-red-200/75',
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
      <span className="mb-1 block text-[10px] font-medium text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolCallItem }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const decoded = useMemo(() => decodeToolResult(tool.result), [tool.result])
  const args = asRecord(tool.args)
  const isActive = isToolActive(tool)
  const command = stringArg(args, ['cmd', 'command'])
  const runId =
    tool.runId || decoded.runId || (typeof args.runId === 'string' ? args.runId : '')
  const outputRecord = asRecord(decoded.output)
  const output =
    typeof outputRecord.output === 'string' ? outputRecord.output : decoded.outputText
  const changes = changeSummary(tool)
  const duration =
    tool.startedAt && tool.finishedAt
      ? `${Math.max(0.1, (tool.finishedAt - tool.startedAt) / 1000).toFixed(1)}s`
      : ''
  const updates = (tool.searchUpdates || []).filter(
    (update): update is string => typeof update === 'string' && Boolean(update.trim())
  )

  return (
    <article className="min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 py-1 text-left outline-none transition-colors hover:text-text-primary focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-accent-primary/55"
        aria-expanded={expanded}
        aria-label={`${describeTool(tool)}. Show tool details.`}
      >
        <span className="shrink-0 text-text-muted/80">{toolIcon(tool.name)}</span>
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-[12px] leading-5',
            isActive ? 'tool-shimmer-text font-medium' : 'text-text-secondary'
          )}
        >
          {describeTool(tool)}
        </span>
        {changes && <span className="shrink-0 font-mono text-[9.5px] text-text-muted/80">{changes}</span>}
        {duration && <span className="shrink-0 font-mono text-[9.5px] text-text-muted/70">{duration}</span>}
        <ActivityState tool={tool} />
        <CaretDown
          size={11}
          className={clsx(
            'shrink-0 text-text-muted/70 transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {updates.length > 0 && (
        <div className="mb-1 ml-[6px] border-l border-white/[0.07] py-0.5 pl-3 text-[11.5px] leading-5 text-text-secondary/85">
          {updates.map((update, index) => (
            <div
              key={`${index}-${update}`}
              className={clsx(index === updates.length - 1 && isActive && 'tool-shimmer-text')}
            >
              {compact(update, 76)}
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mb-2 ml-[6px] mt-1 space-y-2.5 border-l border-white/[0.07] pb-0.5 pl-3.5 pr-1 animate-fade-in">
          <DetailBlock label="Input">
            {command ? (
              <div className="rounded-md bg-black/25 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-text-secondary">
                <span className="mr-1.5 select-none text-accent-primary/60">$</span>
                {command}
              </div>
            ) : (
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-2.5 font-mono text-[10.5px] leading-relaxed text-text-secondary custom-scrollbar">
                {stringify(args)}
              </pre>
            )}
          </DetailBlock>

          {decoded.diff ? (
            <DetailBlock label="Diff">
              <DiffView value={decoded.diff} />
            </DetailBlock>
          ) : tool.result || tool.terminalOutput ? (
            <DetailBlock label="Output">
              <div className="overflow-hidden rounded-md bg-black/25">
                {runId && (
                  <div className="border-b border-white/[0.045] px-2.5 py-1.5 font-mono text-[9.5px] text-text-muted">
                    Run ID {runId}
                  </div>
                )}
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[10.5px] leading-relaxed text-text-secondary custom-scrollbar">
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
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 py-1 text-left text-[11.5px] text-text-muted transition-colors hover:text-text-secondary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55"
        aria-expanded={expanded}
      >
        <GlobeSimple size={13} />
        <span className="flex-1">Sources ({sources.length})</span>
        <CaretDown size={11} className={clsx('transition-transform duration-200', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="ml-[6px] mt-1 grid gap-0.5 border-l border-white/[0.07] pb-0.5 pl-3.5 animate-fade-in">
          {sources.map((source) => (
            <button
              key={source.url}
              type="button"
              onClick={() => void window.api.openExternalUrl(source.url)}
              className="flex min-w-0 items-center gap-2 rounded-sm py-1 text-left transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55"
            >
              {source.faviconUrl ? (
                <img src={source.faviconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" />
              ) : (
                <GlobeSimple size={14} className="shrink-0 text-text-muted" />
              )}
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

export class HarnessActivityBoundary extends React.Component<
  { children: React.ReactNode; fallbackMessage?: string },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error): void {
    console.error('[Harness activity] Failed to render tool activity.', error)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" className="mb-3 flex items-center gap-2 px-1 py-1.5 text-xs text-status-error/85">
          <XCircle size={13} weight="fill" />
          <span>{this.props.fallbackMessage || 'Activity details could not render.'}</span>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
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

  const stepCount = harnessTools.length
  const stepLabel = stepCount === 1 ? 'step' : 'steps'
  const heading = isActive
    ? `Working for ${stepCount} ${stepLabel}`
    : `Worked for ${stepCount} ${stepLabel}`

  return (
    <section
      className={clsx(
        'mb-3 w-full max-w-[680px] select-none',
        reduceMotion && '[&_*]:!transition-none [&_.animate-spin]:!animate-none [&_.tool-shimmer-text]:!animate-none [&_.tool-shimmer-text]:!text-text-secondary [&_.tool-shimmer-text]:!bg-none [&_.tool-shimmer-text]:![-webkit-text-fill-color:currentColor]'
      )}
      aria-label="Harness activity"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-0.5 py-1 text-left outline-none transition-colors hover:text-text-primary focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-accent-primary/55"
        aria-expanded={expanded}
      >
        {isActive ? (
          <CircleNotch size={13} className="shrink-0 animate-spin text-text-muted" />
        ) : (
          <Code size={13} className="shrink-0 text-text-muted" />
        )}
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-[12px] leading-5',
            isActive ? 'tool-shimmer-text font-medium' : 'text-text-secondary'
          )}
        >
          {heading}
        </span>
        <CaretDown
          size={11}
          className={clsx(
            'shrink-0 text-text-muted/70 transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="ml-[6px] mt-1 border-l border-white/[0.08] pb-0.5 pl-3.5 animate-fade-in">
          {showThinking && thoughts?.trim() && (
            <div className="mb-0.5">
              <button
                type="button"
                onClick={() => setThinkingExpanded((value) => !value)}
                className="flex w-full items-center gap-2 py-1 text-left outline-none hover:text-text-primary focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-accent-primary/55"
                aria-expanded={thinkingExpanded}
              >
                <CircleNotch
                  size={13}
                  className={clsx('shrink-0 text-text-muted', isActive && 'animate-spin')}
                />
                <span
                  className={clsx(
                    'flex-1 text-[12px] leading-5',
                    isActive ? 'thinking-shimmer-text font-medium' : 'text-text-secondary'
                  )}
                >
                  {isActive ? 'Planning next step' : 'Thinking'}
                </span>
                <CaretDown
                  size={11}
                  className={clsx(
                    'shrink-0 text-text-muted/70 transition-transform duration-200',
                    thinkingExpanded && 'rotate-180'
                  )}
                />
              </button>
              {thinkingExpanded && (
                <div className="mb-1 ml-[6px] border-l border-white/[0.07] py-1 pl-3.5 pr-1 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap animate-fade-in">
                  {thoughts.trim()}
                </div>
              )}
            </div>
          )}

          {showSteps && harnessTools.map((tool, index) => <ToolRow key={tool.id || `${tool.name}-${index}`} tool={tool} />)}
          <Sources sources={sources} />
        </div>
      )}
    </section>
  )
}
