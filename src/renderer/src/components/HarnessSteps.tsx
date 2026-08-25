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
import {
  asHarnessRecord,
  decodeHarnessToolResult,
  stringifyHarnessValue
} from '../harnessToolPresentation'

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

function patchTargets(patch: string): string[] {
  return Array.from(patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm), (match) =>
    match[1].trim()
  )
}

function isToolActive(tool: ToolCallItem): boolean {
  return tool.status === 'writing' || tool.status === 'running' || tool.status === 'cooldown'
}

function lineCount(value: string): number {
  return value ? value.split(/\r?\n/).length : 0
}

interface ChangeStats {
  added: number
  removed: number
}

function getToolChangeStats(tool: ToolCallItem): ChangeStats | null {
  if (!['write', 'edit', 'delete_lines', 'apply_patch'].includes(tool.name)) return null
  const args = asHarnessRecord(tool.args)
  const decoded = decodeHarnessToolResult(tool.result)

  let added = 0
  let removed = 0

  if (tool.name === 'write') {
    added = tool.addedLines ?? lineCount(stringArg(args, ['content', 'CodeContent']))
    removed = tool.removedLines ?? 0
  } else if (tool.name === 'edit') {
    added =
      tool.addedLines ??
      lineCount(stringArg(args, ['newText', 'new_text', 'ReplacementContent', 'newContent']))
    removed =
      tool.removedLines ??
      lineCount(stringArg(args, ['oldText', 'old_text', 'TargetContent']))
  } else if (tool.name === 'delete_lines') {
    added = tool.addedLines ?? 0
    removed =
      tool.removedLines ??
      lineCount(stringArg(args, ['oldText', 'old_text', 'TargetContent']))
  } else if (tool.name === 'apply_patch') {
    const patch = stringArg(args, ['patch']) || (decoded.diff ?? '')
    if (tool.addedLines !== undefined || tool.removedLines !== undefined) {
      added = tool.addedLines ?? 0
      removed = tool.removedLines ?? 0
    } else if (patch) {
      for (const line of patch.split(/\r?\n/)) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++
        if (line.startsWith('-') && !line.startsWith('---')) removed++
      }
    }
  }

  // Fallback to decoded diff if available
  if (decoded.diff && added === 0 && removed === 0) {
    for (const line of decoded.diff.split(/\r?\n/)) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
  }

  if (added === 0 && removed === 0) return null
  return { added, removed }
}

function describeTool(tool: ToolCallItem): string {
  const args = asHarnessRecord(tool.args)
  const active = isToolActive(tool)
  const path = targetPath(args)
  const command = stringArg(args, ['cmd', 'command'])
  const query = stringArg(args, ['query', 'pattern'])

  switch (tool.name) {
    case 'read': {
      const rawStart = args.startLine ?? args.start_line
      const rawLimit = args.limit
      const start = typeof rawStart === 'number' ? rawStart : parseInt(String(rawStart || '0'), 10)
      const limit = typeof rawLimit === 'number' ? rawLimit : parseInt(String(rawLimit || '0'), 10)
      let lineRange = ''
      if (start > 0 && limit > 0) {
        lineRange = ` #${start}-${start + limit - 1}`
      } else if (start > 0) {
        lineRange = ` #${start}`
      }
      return path
        ? `${active ? 'Reading' : 'Read'} \`${compact(path)}\`${lineRange}`
        : active
          ? 'Reading file'
          : 'Read file'
    }
    case 'list': {
      const folderPath = path || '.\\'
      return `${active ? 'Listing' : 'Listed'} \`${compact(folderPath)}\``
    }
    case 'find':
      return query
        ? `${active ? 'Searching for' : 'Found'} \`${compact(query)}\``
        : active
          ? 'Searching files'
          : 'Found files'
    case 'write': {
      const mode = stringArg(args, ['mode'])
      const isCreate = mode === 'create'
      const prefix = isCreate
        ? (active ? 'Creating' : 'Created')
        : (active ? 'Overwriting' : 'Overwrote')
      return path
        ? `${prefix} \`${compact(path)}\``
        : active
          ? 'Writing file'
          : 'Wrote file'
    }
    case 'edit':
      return path
        ? `${active ? 'Editing' : 'Edited'} \`${compact(path)}\``
        : active
          ? 'Editing file'
          : 'Edited file'
    case 'delete_lines':
      return path
        ? `${active ? 'Deleting from' : 'Deleted from'} \`${compact(path)}\``
        : active
          ? 'Deleting lines'
          : 'Deleted lines'
    case 'apply_patch': {
      const targets = patchTargets(stringArg(args, ['patch']))
      if (targets.length === 1) {
        return `${active ? 'Patching' : 'Patched'} \`${compact(targets[0])}\``
      }
      if (targets.length > 1) {
        return `${active ? 'Patching' : 'Patched'} ${targets.length} files`
      }
      return active ? 'Applying patch' : 'Applied patch'
    }
    case 'exec_command':
      return command
        ? `${active ? 'Running' : 'Ran'} \`$${compact(command)}\``
        : active
          ? 'Running command'
          : 'Ran command'
    case 'write_stdin':
      return active ? 'Sending terminal input' : 'Sent terminal input'
    case 'read_terminal_output':
      return active ? 'Reading terminal output' : 'Read terminal output'
    case 'web_search':
      return query
        ? `${active ? 'Searching web for' : 'Searched web for'} ${compact(query, 52)}`
        : active
          ? 'Searching the web'
          : 'Searched the web'
    case 'to_ask':
      return active ? 'Waiting for your answer' : 'Asked a question'
    default:
      return tool.name.replace(/_/g, ' ')
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

function FormattedDescription({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              className="mx-0.5 rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-text-primary/90"
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

function ToolRow({ tool }: { tool: ToolCallItem }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const decoded = useMemo(() => decodeHarnessToolResult(tool.result), [tool.result])
  const args = asHarnessRecord(tool.args)
  const isActive = isToolActive(tool)
  const command = stringArg(args, ['cmd', 'command'])
  const runId = tool.runId || decoded.runId || (typeof args.runId === 'string' ? args.runId : '')
  const outputRecord = asHarnessRecord(decoded.output)
  const output = typeof outputRecord.output === 'string' ? outputRecord.output : decoded.outputText
  const changeStats = getToolChangeStats(tool)
  const updates = (tool.searchUpdates || []).filter(
    (update): update is string => typeof update === 'string' && Boolean(update.trim())
  )
  const descriptionText = describeTool(tool)

  return (
    <article className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center gap-2.5 py-0.5 text-left outline-none transition-colors hover:text-text-primary focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-accent-primary/55 group cursor-pointer"
        aria-expanded={expanded}
        aria-label={`${descriptionText}. Show tool details.`}
      >
        <span className="shrink-0 text-text-muted/70 group-hover:text-text-secondary">{toolIcon(tool.name)}</span>
        <span
          className={clsx(
            'truncate text-[11.5px] leading-5',
            isActive ? 'tool-shimmer-text font-medium' : 'text-text-secondary/80 group-hover:text-text-secondary'
          )}
        >
          <FormattedDescription text={descriptionText} />
        </span>
        {changeStats && (
          <span className="shrink-0 font-mono text-[9.5px] ml-2.5 flex items-center gap-1.5 font-medium">
            {changeStats.added > 0 && (
              <span className="text-emerald-400/90">+{changeStats.added}</span>
            )}
            {changeStats.removed > 0 && (
              <span className="text-rose-400/90">-{changeStats.removed}</span>
            )}
          </span>
        )}
        <ActivityState tool={tool} />
        <CaretDown
          size={10}
          className={clsx(
            'shrink-0 text-text-muted/60 transition-transform duration-200 group-hover:text-text-secondary ml-1',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {updates.length > 0 && (
        <div className="mb-1 ml-[5px] border-l border-white/[0.07] py-0.5 pl-2.5 text-[11px] leading-5 text-text-secondary/80">
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
        <div className="mb-1.5 ml-[5px] mt-1 space-y-2 border-l border-white/[0.07] pb-0.5 pl-3 pr-1 animate-fade-in max-w-full">
          <DetailBlock label="Input">
            {command ? (
              <div className="rounded-md bg-black/25 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-text-secondary">
                <span className="mr-1.5 select-none text-accent-primary/60">$</span>
                {command}
              </div>
            ) : (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-2 font-mono text-[10px] leading-relaxed text-text-secondary custom-scrollbar">
                {stringifyHarnessValue(args)}
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
                  <div className="border-b border-white/[0.045] px-2 py-1 font-mono text-[9px] text-text-muted">
                    Run ID {runId}
                  </div>
                )}
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10px] leading-relaxed text-text-secondary custom-scrollbar">
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
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-[11px] text-text-muted transition-colors hover:text-text-secondary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55 group"
        aria-expanded={expanded}
      >
        <GlobeSimple size={12} />
        <span className="flex-1">Sources ({sources.length})</span>
        <CaretDown
          size={10}
          className={clsx('transition-transform duration-200 group-hover:text-text-secondary', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div className="ml-[5px] mt-1 grid gap-0.5 border-l border-white/[0.07] pb-0.5 pl-3 animate-fade-in">
          {sources.map((source) => (
            <button
              key={source.url}
              type="button"
              onClick={() => void window.api.openExternalUrl(source.url)}
              className="flex min-w-0 items-center gap-1.5 rounded-sm py-0.5 text-left transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55"
            >
              {source.faviconUrl ? (
                <img src={source.faviconUrl} alt="" className="h-3 w-3 rounded-sm" />
              ) : (
                <GlobeSimple size={12} className="shrink-0 text-text-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">
                {source.title}
              </span>
              <span className="shrink-0 text-[9px] text-text-muted">{source.domain}</span>
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
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 px-1 py-1 text-xs text-status-error/85"
        >
          <XCircle size={12} weight="fill" />
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
  isActive,
  showSteps = true,
  reduceMotion = false
}: {
  tools: ToolCallItem[]
  isActive: boolean
  showSteps?: boolean
  reduceMotion?: boolean
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(isActive)
  const harnessTools = tools.filter((tool) => HARNESS_NAMES.has(tool.name))
  const sources = useMemo(
    () => harnessTools.flatMap((tool) => decodeHarnessToolResult(tool.result).sources),
    [harnessTools]
  )

  if (!showSteps || harnessTools.length === 0) return null

  const stepCount = harnessTools.length
  const stepLabel = stepCount === 1 ? 'step' : 'steps'
  const heading = isActive
    ? `Working for ${stepCount} ${stepLabel}`
    : `Worked for ${stepCount} ${stepLabel}`

  return (
    <section
      className={clsx(
        'mt-1.5 mb-1 w-fit max-w-full select-none',
        reduceMotion &&
          '[&_*]:!transition-none [&_.animate-spin]:!animate-none [&_.tool-shimmer-text]:!animate-none [&_.tool-shimmer-text]:!text-text-secondary [&_.tool-shimmer-text]:!bg-none [&_.tool-shimmer-text]:![-webkit-text-fill-color:currentColor]'
      )}
      aria-label="Harness activity"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center gap-1.5 py-0.5 text-left outline-none transition-colors hover:text-text-primary focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-accent-primary/55 group"
        aria-expanded={expanded}
      >
        {isActive ? (
          <CircleNotch size={12} className="shrink-0 animate-spin text-text-muted" />
        ) : (
          <Code size={12} className="shrink-0 text-text-muted/70 group-hover:text-text-secondary" />
        )}
        <span
          className={clsx(
            'text-[12px] leading-5',
            isActive ? 'tool-shimmer-text font-medium' : 'text-text-secondary/70 group-hover:text-text-secondary font-medium'
          )}
        >
          {heading}
        </span>
        <CaretDown
          size={10}
          className={clsx(
            'shrink-0 text-text-muted/60 transition-transform duration-200 group-hover:text-text-secondary',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="ml-1.5 mt-0.5 border-l border-white/[0.08] pb-0.5 pl-3 animate-fade-in space-y-0.5">
          {harnessTools.map((tool, index) => (
            <ToolRow key={tool.id || `${tool.name}-${index}`} tool={tool} />
          ))}
          <Sources sources={sources} />
        </div>
      )}
    </section>
  )
}
