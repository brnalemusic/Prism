import { useState } from 'react'
import { clsx } from 'clsx'
import {
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
  Gear,
  FileCode
} from '@phosphor-icons/react'
import { MiniAppRenderer } from './MiniAppRenderer'
import { PdfArtifactCard } from './PdfArtifactCard'
import { PptxArtifactCard } from './PptxArtifactCard'

// Tool labels mapping for simplified display
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching web',
  saw_link_from_url: 'Reading web page',
  execute_terminal_command: 'Running terminal command',
  run_command: 'Running terminal command',
  create_mini_app: 'Creating mini app',
  write_pdf: 'Creating PDF',
  edit_pdf: 'Updating PDF artifact',
  write_pptx: 'Creating Presentation',
  edit_pptx: 'Updating Presentation',
  computer_use_create_file: 'Creating file',
  computer_use_edit_file: 'Editing file',
  replace_file_content: 'Editing file',
  multi_replace_file_content: 'Editing file',
  write_to_file: 'Writing file',
  computer_use_read_file: 'Reading file',
  search_chat_history: 'Searching history',
  list_installed_applications: 'Searching apps',
  search_installed_applications: 'Searching apps',
  computer_use_see_screen: 'Taking screenshot',
  browser_screenshot: 'Taking screenshot'
}

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || 'Working'
}

interface ToolCallIndicatorProps {
  tools: Array<{ name: string; status: 'writing' | 'running' | 'done' | 'error' | 'cancelled' | 'cooldown' }>
}

export function ToolCallIndicator({ tools }: ToolCallIndicatorProps): React.JSX.Element | null {
  if (!tools || tools.length === 0) return null

  // Show only the LAST tool (even if done/error/etc to keep text visible)
  const lastTool = tools[tools.length - 1]
  const displayText = getToolLabel(lastTool.name)

  return (
    <span className="tool-shimmer-text text-[13px] font-medium leading-normal inline-block pb-[1.5px]">
      {displayText}
    </span>
  )
}

export interface ToolCall {
  id?: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error' | 'cancelled'
  agentUpdates?: Record<
    string | number,
    {
      phase: 'thinking' | 'tool_use' | 'done' | 'error' | 'cancelled'
      command?: string
      output?: string
    }
  >
  searchUpdates?: string[]

  // Consolidated file operation fields
  isConsolidated?: boolean
  consolidatedType?: 'write' | 'edit' | 'read'
  filePath?: string
  fileName?: string
  addedLines?: number
  removedLines?: number
  readLines?: { start: number; end: number }[]
  originalCalls?: ToolCall[]
  terminalOutput?: string
}

interface ActionLoaderProps {
  toolCall: ToolCall
  mode?: 'compact' | 'full'
  writingArgs?: Record<string, unknown>
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

function renderToolDetails(toolCall: ToolCall): React.ReactNode {
  const { name, args, result } = toolCall

  if (toolCall.isConsolidated) {
    return (
      <div className="text-text-secondary/60 space-y-0.5 mt-1">
        <div className="flex items-center gap-1.5">
          <FileCode size={12} className="text-accent-primary/70" />
          <span className="truncate max-w-[340px]" title={toolCall.filePath}>{toolCall.filePath}</span>
        </div>
      </div>
    )
  }

  const filePath = (args.filePath || args.path || args.TargetFile || args.absolutePath || args.AbsolutePath || args.sourcePath) as string | undefined
  const command = (args.command || args.CommandLine) as string | undefined

  const isCreate = name === 'computer_use_create_file' || name === 'computer_use_save_file' || name === 'write_to_file'
  const isEdit = name === 'computer_use_edit_file' || name === 'replace_file_content' || name === 'multi_replace_file_content'
  const isRead = name === 'computer_use_read_file'
  const isTerminal = name === 'execute_terminal_command' || name === 'run_command'

  if (isEdit && filePath) {
    const linesChanged = result?.match(/Lines (\d+) to (\d+)/)
    return (
      <div className="text-text-secondary/60 space-y-0.5 mt-1">
        <div className="flex items-center gap-1.5">
          <FileCode size={12} className="text-accent-primary/70" />
          <span className="truncate max-w-[280px]" title={filePath}>{filePath}</span>
        </div>
        {linesChanged && (
          <div className="text-text-muted text-[11px] pl-5">
            Lines {linesChanged[1]}-{linesChanged[2]} modified
          </div>
        )}
      </div>
    )
  }

  if (isCreate && filePath) {
    return (
      <div className="text-text-secondary/60 mt-1">
        <div className="flex items-center gap-1.5">
          <FileCode size={12} className="text-accent-primary/70" />
          <span className="truncate max-w-[280px]" title={filePath}>{filePath}</span>
        </div>
      </div>
    )
  }

  if (isRead && filePath) {
    return (
      <div className="text-text-secondary/60 mt-1">
        <div className="flex items-center gap-1.5">
          <FileCode size={12} className="text-text-secondary/50" />
          <span className="truncate max-w-[280px]" title={filePath}>{filePath}</span>
        </div>
      </div>
    )
  }

  if (isTerminal && command) {
    return (
      <div className="text-text-secondary/60 font-mono text-[11px] bg-white/[0.03] rounded px-2 py-1 mt-1 border border-white/[0.04]">
        {command}
      </div>
    )
  }

  return null
}

function useToolCallMeta(toolCall: ToolCall, writingArgs?: Record<string, unknown>): {
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
  if (toolCall.isConsolidated) {
    const isDone =
      toolCall.status === 'done' || toolCall.status === 'error' || toolCall.status === 'cancelled'
    const isWriting = toolCall.status === 'writing'
    const isRunning = !isDone

    let displayTitle = 'File Action'
    let displayDetail = toolCall.filePath || ''
    let tone: 'default' | 'search' | 'think' | 'success' | 'error' | 'youtube' = 'default'

    const fileName = toolCall.fileName || 'file'

    if (toolCall.consolidatedType === 'edit') {
      const diffLabel = `(+${toolCall.addedLines || 0} -${toolCall.removedLines || 0})`
      if (isWriting || isRunning) {
        displayTitle = `Editing ${fileName}`
      } else {
        displayTitle = `Edited ${fileName}`
      }
      displayDetail = diffLabel
      tone = isWriting ? 'think' : isRunning ? 'think' : 'success'
    } else if (toolCall.consolidatedType === 'write') {
      const diffLabel = `(+${toolCall.addedLines || 0} -0)`
      if (isWriting || isRunning) {
        displayTitle = `Writing ${fileName}`
      } else {
        displayTitle = `Created ${fileName}`
      }
      displayDetail = diffLabel
      tone = isWriting ? 'think' : isRunning ? 'think' : 'success'
    } else if (toolCall.consolidatedType === 'read') {
      if (isWriting || isRunning) {
        displayTitle = `Reading ${fileName}`
      } else {
        displayTitle = `Read ${fileName}`
      }
      
      const lines = toolCall.readLines || []
      if (lines.length > 0) {
        displayDetail = `Lines ` + lines.map(l => `${l.start}-${l.end}`).join(', ')
      } else {
        displayDetail = 'Loading file content.'
      }
      tone = 'search'
    }

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
        return <FileCode size={size} weight="regular" className="animate-pulse" />
      }
      return <FileCode size={size} weight="regular" />
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
      isYoutube: false
    }
  }

  const url = getStringArg(toolCall.args, 'url')
  const query = getStringArg(toolCall.args, 'query')
  const isYoutube = /youtube\.com|youtu\.be|^\/youtube|\byoutube\b/i.test(`${url} ${query}`)

  const isDone =
    toolCall.status === 'done' || toolCall.status === 'error' || toolCall.status === 'cancelled'
  const isWriting = toolCall.status === 'writing'
  const isRunning = !isDone

  let displayTitle = 'Processing'
  let displayDetail = 'Prism is working on the next step.'
  let tone: 'default' | 'search' | 'think' | 'success' | 'error' | 'youtube' = 'default'

  if (toolCall.status === 'writing') {
    const isSearch =
      toolCall.name === 'search' ||
      toolCall.name === 'web_search' ||
      toolCall.name === 'search_chat_history' ||
      toolCall.name === 'saw_link_from_url'
    const isFileWrite =
      toolCall.name === 'computer_use_create_file' ||
      toolCall.name === 'computer_use_save_file' ||
      toolCall.name === 'computer_use_append_file' ||
      toolCall.name === 'write_to_file'
    const isFileEdit =
      toolCall.name === 'computer_use_edit_file' ||
      toolCall.name === 'replace_file_content' ||
      toolCall.name === 'multi_replace_file_content'
    const isTerminal =
      toolCall.name === 'execute_terminal_command' ||
      toolCall.name === 'run_command'

    const isMiniApp = toolCall.name === 'mini-app' || toolCall.name === 'create_mini_app'

    displayTitle = isSearch
      ? 'Preparing Search'
      : isMiniApp
        ? 'Designing Mini App'
        : isFileWrite
          ? 'Creating File'
          : isFileEdit
            ? 'Editing File'
            : isTerminal
              ? 'Preparing Command'
              : 'Preparing Action'

    displayDetail = isSearch
      ? 'Composing a web search.'
      : isMiniApp
        ? 'Building interactive interface.'
        : isFileWrite
          ? 'Writing content to file.'
          : isFileEdit
            ? 'Modifying file content.'
            : isTerminal
              ? 'Composing a terminal command.'
              : 'Composing a tool call.'

    tone = isSearch ? 'search' : 'think'
  } else if (toolCall.name === 'web_search') {
    displayTitle = isYoutube ? 'Searching Video' : 'Searching Web'
    displayDetail =
      toolCall.searchUpdates && toolCall.searchUpdates.length > 0
        ? ''
        : query || 'Collecting web results.'
    tone = isYoutube ? 'youtube' : 'search'
  } else if (toolCall.name === 'search_chat_history') {
    displayTitle = 'Searching Memory'
    displayDetail = query || 'Looking through prior context.'
    tone = 'search'
  } else if (toolCall.name === 'saw_link_from_url') {
    displayTitle = toolCall.status === 'cooldown' ? 'Cooling Down' : 'Reading Page'
    displayDetail = url || 'Inspecting web content.'
    tone = 'search'
  } else if (toolCall.name === 'execute_terminal_command' || toolCall.name === 'run_command') {
    displayTitle = 'Terminal'
    displayDetail = getStringArg(toolCall.args, 'command') || getStringArg(toolCall.args, 'CommandLine') || 'Running command.'
  } else if (toolCall.name === 'computer_use_create_file' || toolCall.name === 'computer_use_save_file' || toolCall.name === 'write_to_file') {
    displayTitle = 'Creating File'
    displayDetail = getStringArg(toolCall.args, 'path') || getStringArg(toolCall.args, 'filePath') || getStringArg(toolCall.args, 'TargetFile') || 'Writing file.'
  } else if (toolCall.name === 'computer_use_edit_file' || toolCall.name === 'replace_file_content' || toolCall.name === 'multi_replace_file_content') {
    displayTitle = 'Editing File'
    displayDetail = getStringArg(toolCall.args, 'path') || getStringArg(toolCall.args, 'filePath') || getStringArg(toolCall.args, 'TargetFile') || 'Modifying file.'
  } else if (toolCall.name === 'computer_use_read_file') {
    displayTitle = 'Reading File'
    displayDetail = getStringArg(toolCall.args, 'path') || getStringArg(toolCall.args, 'filePath') || 'Loading file content.'
  } else if (toolCall.name === 'computer_use_see_screen') {
    displayTitle = 'Screen Capture'
    displayDetail = 'Capturing desktop screen.'
    tone = 'search'
  } else if (toolCall.name.startsWith('computer_use_')) {
    displayTitle = 'Computer Use'
    displayDetail = toolCall.name.replace('computer_use_', '').replace(/_/g, ' ')
  } else if (toolCall.name === 'open_application') {
    displayTitle = 'Opening App'
    displayDetail = getStringArg(toolCall.args, 'appPath') || 'Launching application.'
  } else if (toolCall.name === 'open_browser_link') {
    displayTitle = isYoutube ? 'Opening Video' : 'Opening Link'
    displayDetail = url || 'Opening in browser.'
    tone = isYoutube ? 'youtube' : 'default'
  } else if (toolCall.name === 'search_installed_applications') {
    displayTitle = 'Searching Apps'
    displayDetail = getStringArg(toolCall.args, 'query') ? `Searching for "${getStringArg(toolCall.args, 'query')}"` : 'Searching installed applications.'
  } else if (toolCall.name === 'internal_docs_list') {
    displayTitle = 'Checking Knowledge Base'
    displayDetail = 'Looking up internal documentation.'
    tone = 'search'
  } else if (toolCall.name === 'internal_docs_read') {
    displayTitle = 'Reading Documentation'
    displayDetail = getStringArg(toolCall.args, 'filename') || 'Loading documentation file.'
    tone = 'search'
  } else if (toolCall.name === 'internal_docs_search') {
    displayTitle = 'Searching Knowledge Base'
    displayDetail = getStringArg(toolCall.args, 'query') ? `Searching for "${getStringArg(toolCall.args, 'query')}"` : 'Searching internal documentation.'
    tone = 'search'
  } else if (
    toolCall.name.startsWith('browser_') ||
    toolCall.name === 'open_browser' ||
    toolCall.name === 'web_script' ||
    toolCall.name === 'detailed_dom_page'
  ) {
    displayTitle = 'Browser Use'
    if (toolCall.name === 'open_browser') {
      displayDetail = url ? `Opening browser to ${url}` : 'Opening browser.'
    } else if (toolCall.name === 'browser_navigate') {
      displayDetail = url ? `Navigating to ${url}` : 'Navigating to new page.'
    } else if (toolCall.name === 'browser_snapshot') {
      displayDetail = 'Capturing page snapshot.'
    } else if (toolCall.name === 'browser_click') {
      const elementId = getStringArg(toolCall.args, 'elementId')
      displayDetail = elementId ? `Clicking element "${elementId}"` : 'Clicking element.'
    } else if (toolCall.name === 'browser_type') {
      const elementId = getStringArg(toolCall.args, 'elementId')
      const text = getStringArg(toolCall.args, 'text')
      displayDetail = elementId
        ? `Typing "${text}" into element "${elementId}"`
        : 'Typing into element.'
    } else if (toolCall.name === 'browser_press') {
      const key = getStringArg(toolCall.args, 'key')
      displayDetail = key ? `Pressing key "${key}"` : 'Pressing key.'
    } else if (toolCall.name === 'browser_scroll') {
      const direction = getStringArg(toolCall.args, 'direction')
      displayDetail = direction ? `Scrolling ${direction}` : 'Scrolling page.'
    } else if (toolCall.name === 'browser_back') {
      displayDetail = 'Going back to previous page.'
    } else if (toolCall.name === 'browser_screenshot') {
      displayDetail = 'Taking screenshot.'
    } else if (toolCall.name === 'browser_close') {
      displayDetail = 'Closing browser.'
    } else if (toolCall.name === 'web_script') {
      displayDetail = 'Executing custom script.'
    } else if (toolCall.name === 'detailed_dom_page') {
      displayDetail = 'Retrieving detailed page layout.'
    } else {
      displayDetail = 'Automating browser action.'
    }
    tone = 'search'
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
  } else if (toolCall.name === 'create_mini_app') {
    displayTitle = isDone ? 'Created Mini App' : 'Creating Mini App'
    displayDetail = getStringArg(toolCall.args, 'title') || (writingArgs?.title as string) || 'Mini App'
  }

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
      const isSearch =
        toolCall.name === 'search' ||
        toolCall.name === 'web_search' ||
        toolCall.name === 'search_chat_history' ||
        toolCall.name === 'saw_link_from_url'
      const isFile =
        toolCall.name === 'computer_use_create_file' ||
        toolCall.name === 'computer_use_save_file' ||
        toolCall.name === 'computer_use_append_file' ||
        toolCall.name === 'write_to_file' ||
        toolCall.name === 'computer_use_edit_file' ||
        toolCall.name === 'replace_file_content' ||
        toolCall.name === 'multi_replace_file_content' ||
        toolCall.name === 'computer_use_read_file'
      const isTerminal =
        toolCall.name === 'execute_terminal_command' ||
        toolCall.name === 'run_command'

      if (isSearch)
        return <MagnifyingGlass size={size} weight="regular" className="animate-pulse" />
      if (isFile)
        return <FileCode size={size} weight="regular" className="animate-pulse" />
      if (isTerminal)
        return <Terminal size={size} weight="regular" className="animate-pulse" />
      return <Brain size={size} weight="regular" className="animate-pulse" />
    }
    if (toolCall.name === 'web_search' || toolCall.name === 'search_chat_history')
      return <MagnifyingGlass size={size} weight="regular" className="animate-pulse" />
    if (isYoutube) return <PlayCircle size={size} weight="regular" className="animate-pulse" />
    if (toolCall.name === 'execute_terminal_command' || toolCall.name === 'run_command')
      return <Terminal size={size} weight="regular" />
    if (toolCall.name === 'open_browser_link' || toolCall.name === 'open_application')
      return <ArrowUpRight size={size} weight="regular" />
    if (toolCall.name === 'search_installed_applications')
      return <List size={size} weight="regular" />
    if (
      toolCall.name === 'computer_use_create_file' ||
      toolCall.name === 'computer_use_save_file' ||
      toolCall.name === 'computer_use_append_file' ||
      toolCall.name === 'write_to_file' ||
      toolCall.name === 'computer_use_edit_file' ||
      toolCall.name === 'replace_file_content' ||
      toolCall.name === 'multi_replace_file_content' ||
      toolCall.name === 'computer_use_read_file'
    ) {
      return <FileCode size={size} weight="regular" />
    }
    if (toolCall.name.startsWith('computer_use_')) return <HardDrive size={size} weight="regular" />
    if (toolCall.name === 'saw_link_from_url' || toolCall.name.startsWith('internal_docs_')) return <FileText size={size} weight="regular" />
    if (toolCall.name === 'configure_prism')
      return <Gear size={size} weight="regular" className="animate-pulse" />
    if (
      toolCall.name.startsWith('browser_') ||
      toolCall.name === 'open_browser' ||
      toolCall.name === 'web_script' ||
      toolCall.name === 'detailed_dom_page' ||
      toolCall.name === 'create_mini_app'
    ) {
      return <AppWindow size={size} weight="regular" className="animate-pulse" />
    }
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

const ansiColorMap: Record<string, string> = {
  // foregrounds
  '30': 'ansi-fg-black',
  '31': 'ansi-fg-red',
  '32': 'ansi-fg-green',
  '33': 'ansi-fg-yellow',
  '34': 'ansi-fg-blue',
  '35': 'ansi-fg-magenta',
  '36': 'ansi-fg-cyan',
  '37': 'ansi-fg-white',
  '90': 'ansi-fg-bright-black',
  '91': 'ansi-fg-bright-red',
  '92': 'ansi-fg-bright-green',
  '93': 'ansi-fg-bright-yellow',
  '94': 'ansi-fg-bright-blue',
  '95': 'ansi-fg-bright-magenta',
  '96': 'ansi-fg-bright-cyan',
  '97': 'ansi-fg-bright-white',
  // backgrounds
  '40': 'ansi-bg-black',
  '41': 'ansi-bg-red',
  '42': 'ansi-bg-green',
  '43': 'ansi-bg-yellow',
  '44': 'ansi-bg-blue',
  '45': 'ansi-bg-magenta',
  '46': 'ansi-bg-cyan',
  '47': 'ansi-bg-white',
  '100': 'ansi-bg-bright-black',
  '101': 'ansi-bg-bright-red',
  '102': 'ansi-bg-bright-green',
  '103': 'ansi-bg-bright-yellow',
  '104': 'ansi-bg-bright-blue',
  '105': 'ansi-bg-bright-magenta',
  '106': 'ansi-bg-bright-cyan',
  '107': 'ansi-bg-bright-white'
}

function parseAnsi(text: string): React.ReactNode[] {
  const ansiRegex = /(\u001b\[[0-9;]*m)/g
  const parts = text.split(ansiRegex)
  
  let currentFg = ''
  let currentBg = ''
  let isBold = false
  
  const elements: React.ReactNode[] = []
  
  parts.forEach((part, index) => {
    if (part.startsWith('\u001b[')) {
      const match = part.match(/\u001b\[([0-9;]*)m/)
      if (match) {
        const codes = match[1].split(';')
        codes.forEach(code => {
          if (code === '0' || code === '') {
            currentFg = ''
            currentBg = ''
            isBold = false
          } else if (code === '1') {
            isBold = true
          } else if (code === '22') {
            isBold = false
          } else if (parseInt(code) >= 30 && parseInt(code) <= 37) {
            currentFg = ansiColorMap[code] || ''
          } else if (parseInt(code) >= 90 && parseInt(code) <= 97) {
            currentFg = ansiColorMap[code] || ''
          } else if (parseInt(code) >= 40 && parseInt(code) <= 47) {
            currentBg = ansiColorMap[code] || ''
          } else if (parseInt(code) >= 100 && parseInt(code) <= 107) {
            currentBg = ansiColorMap[code] || ''
          }
        })
      }
    } else {
      if (part) {
        const classNames: string[] = []
        if (currentFg) classNames.push(currentFg)
        if (currentBg) classNames.push(currentBg)
        if (isBold) classNames.push('font-bold')
        
        elements.push(
          <span key={index} className={classNames.join(' ')}>
            {part}
          </span>
        )
      }
    }
  })

  return elements
}

export function AnsiRenderer({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="ansi-renderer-root">
      <style dangerouslySetInnerHTML={{ __html: `
        .ansi-renderer-root {
          white-space: pre-wrap;
          word-break: break-all;
        }
        .ansi-renderer-root .ansi-fg-black { color: #000000; }
        .ansi-renderer-root .ansi-fg-red { color: #ef4444; }
        .ansi-renderer-root .ansi-fg-green { color: #22c55e; }
        .ansi-renderer-root .ansi-fg-yellow { color: #eab308; }
        .ansi-renderer-root .ansi-fg-blue { color: #3b82f6; }
        .ansi-renderer-root .ansi-fg-magenta { color: #d946ef; }
        .ansi-renderer-root .ansi-fg-cyan { color: #06b6d4; }
        .ansi-renderer-root .ansi-fg-white { color: #f3f4f6; }
        .ansi-renderer-root .ansi-fg-bright-black { color: #6b7280; }
        .ansi-renderer-root .ansi-fg-bright-red { color: #fca5a5; }
        .ansi-renderer-root .ansi-fg-bright-green { color: #86efac; }
        .ansi-renderer-root .ansi-fg-bright-yellow { color: #fef08a; }
        .ansi-renderer-root .ansi-fg-bright-blue { color: #93c5fd; }
        .ansi-renderer-root .ansi-fg-bright-magenta { color: #f5d0fe; }
        .ansi-renderer-root .ansi-fg-bright-cyan { color: #67e8f9; }
        .ansi-renderer-root .ansi-fg-bright-white { color: #ffffff; }

        .ansi-renderer-root .ansi-bg-black { background-color: #000000; }
        .ansi-renderer-root .ansi-bg-red { background-color: #991b1b; }
        .ansi-renderer-root .ansi-bg-green { background-color: #166534; }
        .ansi-renderer-root .ansi-bg-yellow { background-color: #854d0e; }
        .ansi-renderer-root .ansi-bg-blue { background-color: #1e3a8a; }
        .ansi-renderer-root .ansi-bg-magenta { background-color: #86198f; }
        .ansi-renderer-root .ansi-bg-cyan { background-color: #155e75; }
        .ansi-renderer-root .ansi-bg-white { background-color: #e5e7eb; }
      `}} />
      {parseAnsi(text)}
    </span>
  )
}

function CompactActionLoader({ toolCall, writingArgs }: { toolCall: ToolCall; writingArgs?: Record<string, unknown> }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)

  const { displayTitle, displayDetail, tone, isDone, isWriting, isRunning, statusLabel, renderIcon } =
    useToolCallMeta(toolCall, writingArgs)

  const isTerminal = toolCall.name === 'execute_terminal_command' || toolCall.name === 'run_command'
  const canExpand = isDone || isTerminal

  const toneColors = {
    default: {
      text: 'text-text-secondary',
      icon: 'text-text-secondary'
    },
    search: {
      text: 'text-accent-secondary',
      icon: 'text-accent-secondary'
    },
    think: {
      text: 'text-status-warning',
      icon: 'text-status-warning'
    },
    success: {
      text: 'text-status-success',
      icon: 'text-status-success'
    },
    error: {
      text: 'text-status-error',
      icon: 'text-status-error'
    },
    youtube: {
      text: 'text-accent-primary',
      icon: 'text-accent-primary'
    }
  }[tone]

  return (
    <div className="my-2 flex flex-col gap-2 max-w-full select-none animate-fade-in">
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

      {/* ── Text-Only Expansible Trigger ── */}
      <div
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        className={clsx(
          'inline-flex items-center gap-2 text-[13px] py-1 select-none transition-all duration-200',
          canExpand ? 'cursor-pointer hover:opacity-80 active:scale-[0.99]' : 'cursor-default'
        )}
      >
        <div className={clsx('flex shrink-0 items-center justify-center', toneColors.icon)}>
          {renderIcon(13)}
        </div>

        {isTerminal ? (
          <>
            <span className="font-semibold text-text-primary leading-none">
              {(toolCall.status === 'running' || toolCall.status === 'writing') ? 'Running' : 'Ran'}{' '}
              <span className="font-mono text-text-secondary">
                {(toolCall.args.command || toolCall.args.CommandLine || writingArgs?.command) as string}
              </span>
            </span>
          </>
        ) : toolCall.isConsolidated && (toolCall.consolidatedType === 'edit' || toolCall.consolidatedType === 'write') ? (
          <>
            <span className="font-semibold text-text-primary leading-none">
              {isWriting
                ? (toolCall.consolidatedType === 'edit' ? 'Editing' : 'Writing')
                : isRunning
                  ? (toolCall.consolidatedType === 'edit' ? 'Editing' : 'Writing')
                  : (toolCall.consolidatedType === 'edit' ? 'Edited' : 'Created')}{' '}
              <span className="text-accent-secondary font-mono">{toolCall.fileName?.split('.').pop()}</span>{' '}
              {toolCall.fileName}
            </span>
            {(toolCall.addedLines || 0) > 0 && (
              <span className="text-xs font-semibold text-status-success ml-1">+{toolCall.addedLines}</span>
            )}
            {(toolCall.removedLines || 0) > 0 && (
              <span className="text-xs font-semibold text-status-error ml-1">-{toolCall.removedLines}</span>
            )}
          </>
        ) : toolCall.isConsolidated ? (
          <>
            <span className="font-semibold text-text-primary leading-none">
              {displayTitle} <span className="font-normal opacity-85">{displayDetail}</span>
            </span>
            <span className={clsx('text-[11px] font-medium leading-none opacity-80', toneColors.text)}>
              ({statusLabel})
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold text-text-primary leading-none">{displayTitle}</span>
            <span className={clsx('text-[11px] font-medium leading-none opacity-80', toneColors.text)}>
              ({statusLabel})
            </span>
            {toolCall.status === 'writing' && (toolCall.addedLines || 0) > 0 && (
              <span className="text-xs font-semibold text-status-success ml-1">+{toolCall.addedLines}</span>
            )}
            {toolCall.status === 'writing' && (toolCall.removedLines || 0) > 0 && (
              <span className="text-xs font-semibold text-status-error ml-1">-{toolCall.removedLines}</span>
            )}
            {toolCall.status === 'writing' && typeof writingArgs?.filePath === 'string' && (
              <span className="text-[11px] text-text-muted/60 truncate max-w-[200px]" title={writingArgs.filePath}>
                · {writingArgs.filePath}
              </span>
            )}
            {toolCall.status === 'writing' && typeof writingArgs?.command === 'string' && typeof writingArgs?.filePath !== 'string' && (
              <span className="text-[11px] text-text-muted/60 font-mono truncate max-w-[200px]" title={writingArgs.command}>
                · {writingArgs.command.substring(0, 40)}{writingArgs.command.length > 40 ? '...' : ''}
              </span>
            )}
            {toolCall.status === 'writing' && typeof writingArgs?.query === 'string' && typeof writingArgs?.filePath !== 'string' && typeof writingArgs?.command !== 'string' && (
              <span className="text-[11px] text-text-muted/60 truncate max-w-[200px]" title={writingArgs.query}>
                · {writingArgs.query}
              </span>
            )}
          </>
        )}

        <div className="flex items-center gap-1.5 ml-1">
          {canExpand && (
            <CaretDown
              size={12}
              className={clsx(
                'text-text-muted transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          )}
        </div>
      </div>

      {/* ── Continuous Web Search List ── */}
      {toolCall.name === 'web_search' &&
        toolCall.searchUpdates &&
        toolCall.searchUpdates.length > 0 && (
          <div className="flex flex-col gap-1.5 border-l border-white/[0.08] ml-[7px] pl-3.5 py-0.5 animate-fade-in">
            {(() => {
              const updates = toolCall.searchUpdates!
              return updates.map((title, idx) => {
                const isLast = idx === updates.length - 1
                const isItemRunning =
                  isLast && (toolCall.status === 'running' || toolCall.status === 'writing')
                return (
                  <div
                    key={idx}
                    className={clsx(
                      'flex items-center gap-2 text-[12px] leading-relaxed transition-colors duration-200',
                      isItemRunning ? 'text-text-secondary font-medium' : 'text-text-secondary/65'
                    )}
                  >
                    {isItemRunning ? (
                      <CircleNotch
                        size={11}
                        className="animate-spin text-accent-secondary shrink-0"
                      />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-text-muted/40 shrink-0 ml-0.5" />
                    )}
                    <span>{title}...</span>
                  </div>
                )
              })
            })()}
          </div>
        )}

      {/* ── Expanded View (Success/Fail Status Only) ── */}
      {isExpanded && (
        <div className="pl-5 text-xs text-text-secondary/80 animate-fade-in py-0.5 select-text">
          {isTerminal ? (
            <div className="flex flex-col max-w-full my-2">
              <div className="font-mono text-[12px] bg-[#012456] text-[#eeedf0] border border-white/10 rounded-xl p-4 flex flex-col gap-1 shadow-inner max-h-[320px] overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
                <div className="text-[#00ffff] font-semibold select-none mb-1">
                  PS C:\\Users\\Breno\\Documents\\Code\\Prism&gt; {(toolCall.args.command || toolCall.args.CommandLine || writingArgs?.command) as string}
                </div>
                {(toolCall.terminalOutput || toolCall.result) ? (
                  <AnsiRenderer text={toolCall.terminalOutput || toolCall.result || ''} />
                ) : (
                  <span className="text-text-muted italic animate-pulse">Running command and waiting for output...</span>
                )}
              </div>
            </div>
          ) : toolCall.status === 'done' ? (
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-status-success font-medium">
                Executed successfully.
              </span>
              {renderToolDetails(toolCall)}
            </div>
          ) : toolCall.status === 'error' ? (
            <span className="flex items-center gap-1.5 text-status-error font-medium">
              Execution failed.
            </span>
          ) : toolCall.status === 'cancelled' ? (
            <span className="flex items-center gap-1.5 text-text-muted font-medium">
              Execution cancelled.
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function FullActionLoader({ toolCall, writingArgs }: { toolCall: ToolCall; writingArgs?: Record<string, unknown> }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('master')

  const { displayTitle, displayDetail, tone, isDone, statusLabel, renderIcon } =
    useToolCallMeta(toolCall, writingArgs)

  const isTerminal = toolCall.name === 'execute_terminal_command' || toolCall.name === 'run_command'
  const canExpand = isDone || isTerminal

  const toneColors = {
    default: {
      text: 'text-text-secondary',
      icon: 'text-text-secondary'
    },
    search: {
      text: 'text-accent-secondary',
      icon: 'text-accent-secondary'
    },
    think: {
      text: 'text-status-warning',
      icon: 'text-status-warning'
    },
    success: {
      text: 'text-status-success',
      icon: 'text-status-success'
    },
    error: {
      text: 'text-status-error',
      icon: 'text-status-error'
    },
    youtube: {
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
  const masterY = 35
  const workerY = 110

  const getWorkerX = (index: number, total: number): number => {
    if (total <= 1) return 200
    return 60 + (index * 280) / (total - 1)
  }

  return (
    <div className="my-2.5 flex w-full flex-col gap-2 select-none animate-fade-in">
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

      {/* ── Text-Only Expansible Trigger ── */}
      <div
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
        className={clsx(
          'inline-flex items-center gap-2 text-[13px] py-1 select-none transition-all duration-200',
          canExpand ? 'cursor-pointer hover:opacity-80 active:scale-[0.99]' : 'cursor-default'
        )}
      >
        <div className={clsx('flex shrink-0 items-center justify-center', toneColors.icon)}>
          {renderIcon(13)}
        </div>

        {isTerminal ? (
          <>
            <span className="font-semibold text-text-primary leading-none">
              {(toolCall.status === 'running' || toolCall.status === 'writing') ? 'Running' : 'Ran'}{' '}
              <span className="font-mono text-text-secondary">
                {(toolCall.args.command || toolCall.args.CommandLine || writingArgs?.command) as string}
              </span>
            </span>
          </>
        ) : toolCall.isConsolidated && (toolCall.consolidatedType === 'edit' || toolCall.consolidatedType === 'write') ? (
          <>
            <span className="font-semibold text-text-primary leading-none">
              {toolCall.consolidatedType === 'edit' ? 'Edited' : 'Created'}{' '}
              <span className="text-accent-secondary font-mono">{toolCall.fileName?.split('.').pop()}</span>{' '}
              {toolCall.fileName}
            </span>
            <span className="text-xs font-semibold text-status-success ml-1">+{toolCall.addedLines || 0}</span>
            {toolCall.removedLines ? (
              <span className="text-xs font-semibold text-status-error ml-1">-{toolCall.removedLines}</span>
            ) : null}
          </>
        ) : toolCall.isConsolidated ? (
          <>
            <span className="font-semibold text-text-primary leading-none">
              {displayTitle} <span className="font-normal opacity-85">{displayDetail}</span>
            </span>
            <span className={clsx('text-[11px] font-medium leading-none opacity-80', toneColors.text)}>
              ({statusLabel})
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold text-text-primary leading-none">{displayTitle}</span>
            {displayDetail && (
              <span className="text-text-muted font-normal text-xs leading-none truncate max-w-[280px]">
                · {displayDetail}
              </span>
            )}
            <span className={clsx('text-[11px] font-medium leading-none opacity-80', toneColors.text)}>
              ({statusLabel})
            </span>
            {toolCall.status === 'writing' && typeof writingArgs?.filePath === 'string' && (
              <span className="text-[11px] text-text-muted/60 truncate max-w-[200px]" title={writingArgs.filePath}>
                · {writingArgs.filePath}
              </span>
            )}
            {toolCall.status === 'writing' && typeof writingArgs?.command === 'string' && typeof writingArgs?.filePath !== 'string' && (
              <span className="text-[11px] text-text-muted/60 font-mono truncate max-w-[200px]" title={writingArgs.command}>
                · {writingArgs.command.substring(0, 40)}{writingArgs.command.length > 40 ? '...' : ''}
              </span>
            )}
            {toolCall.status === 'writing' && typeof writingArgs?.query === 'string' && typeof writingArgs?.filePath !== 'string' && typeof writingArgs?.command !== 'string' && (
              <span className="text-[11px] text-text-muted/60 truncate max-w-[200px]" title={writingArgs.query}>
                · {writingArgs.query}
              </span>
            )}
          </>
        )}

        <div className="flex items-center gap-1.5 ml-1">
          {canExpand && (
            <CaretDown
              size={12}
              className={clsx(
                'text-text-muted transition-transform duration-200',
                isExpanded && 'rotate-180'
              )}
            />
          )}
        </div>
      </div>

      {/* ── Continuous Web Search List ── */}
      {toolCall.name === 'web_search' &&
        toolCall.searchUpdates &&
        toolCall.searchUpdates.length > 0 && (
          <div className="flex flex-col gap-1.5 border-l border-white/[0.08] ml-[7px] pl-3.5 py-0.5 animate-fade-in">
            {(() => {
              const updates = toolCall.searchUpdates!
              return updates.map((title, idx) => {
                const isLast = idx === updates.length - 1
                const isItemRunning =
                  isLast && (toolCall.status === 'running' || toolCall.status === 'writing')
                return (
                  <div
                    key={idx}
                    className={clsx(
                      'flex items-center gap-2 text-[12px] leading-relaxed transition-colors duration-200',
                      isItemRunning ? 'text-text-secondary font-medium' : 'text-text-secondary/65'
                    )}
                  >
                    {isItemRunning ? (
                      <CircleNotch
                        size={11}
                        className="animate-spin text-accent-secondary shrink-0"
                      />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-text-muted/40 shrink-0 ml-0.5" />
                    )}
                    <span>{title}...</span>
                  </div>
                )
              })
            })()}
          </div>
        )}

      {/* ── Expanded View (Success/Fail Status Only) ── */}
      {isExpanded && (
        <div className="pl-5 text-xs text-text-secondary/80 animate-fade-in py-0.5 select-text">
          {isTerminal ? (
            <div className="flex flex-col max-w-full my-2">
              <div className="font-mono text-[12px] bg-[#012456] text-[#eeedf0] border border-white/10 rounded-xl p-4 flex flex-col gap-1 shadow-inner max-h-[320px] overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
                <div className="text-[#00ffff] font-semibold select-none mb-1">
                  PS C:\\Users\\Breno\\Documents\\Code\\Prism&gt; {(toolCall.args.command || toolCall.args.CommandLine || writingArgs?.command) as string}
                </div>
                {(toolCall.terminalOutput || toolCall.result) ? (
                  <AnsiRenderer text={toolCall.terminalOutput || toolCall.result || ''} />
                ) : (
                  <span className="text-text-muted italic animate-pulse">Running command and waiting for output...</span>
                )}
              </div>
            </div>
          ) : toolCall.status === 'done' ? (
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-status-success font-medium">
                Executed successfully.
              </span>
              {renderToolDetails(toolCall)}
            </div>
          ) : toolCall.status === 'error' ? (
            <span className="flex items-center gap-1.5 text-status-error font-medium">
              Execution failed.
            </span>
          ) : toolCall.status === 'cancelled' ? (
            <span className="flex items-center gap-1.5 text-text-muted font-medium">
              Execution cancelled.
            </span>
          ) : null}
        </div>
      )}

      {/* Subagent graph (Full) */}
      {toolCall.name === 'run_subagents' &&
        (toolCall.status === 'running' ||
          toolCall.status === 'done' ||
          toolCall.status === 'cancelled') && (
          <div className="w-full mt-2 flex flex-col gap-4 p-4 rounded-xl border border-white/[0.04] bg-white/[0.015] backdrop-blur-md transition-all duration-300">
            {hasAgentUpdates ? (
              <>
                <div className="w-full relative flex justify-center py-2 rounded-lg border border-white/[0.02] bg-black/10">
                  <svg viewBox="0 0 400 160" className="w-full select-none">
                    {/* Glow Filters */}
                    <defs>
                      <linearGradient id="line-grad-full" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop
                          offset="0%"
                          stopColor="var(--color-accent-primary)"
                          stopOpacity="0.8"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--color-accent-secondary)"
                          stopOpacity="0.3"
                        />
                      </linearGradient>
                      <filter id="glow-master-full" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow
                          dx="0"
                          dy="0"
                          stdDeviation="6"
                          floodColor="var(--color-accent-primary)"
                          floodOpacity="0.4"
                        />
                      </filter>
                      <filter
                        id="glow-worker-thinking-full"
                        x="-50%"
                        y="-50%"
                        width="200%"
                        height="200%"
                      >
                        <feDropShadow
                          dx="0"
                          dy="0"
                          stdDeviation="5"
                          floodColor="var(--color-accent-primary)"
                          floodOpacity="0.3"
                        />
                      </filter>
                      <filter
                        id="glow-worker-tool-full"
                        x="-50%"
                        y="-50%"
                        width="200%"
                        height="200%"
                      >
                        <feDropShadow
                          dx="0"
                          dy="0"
                          stdDeviation="5"
                          floodColor="var(--color-status-warning)"
                          floodOpacity="0.3"
                        />
                      </filter>
                    </defs>

                    {/* Connection Lines (Bezier curves with animated signal packets) */}
                    {workerKeys.map((key, idx) => {
                      const phase = toolCall.agentUpdates?.[key]?.phase || 'idle'
                      const style = getPhaseStyle(phase)
                      const x = getWorkerX(idx, workerKeys.length)
                      const isAnimating = phase === 'thinking' || phase === 'tool_use'

                      const dPath = `M ${masterX} ${masterY} C ${masterX} ${(masterY + workerY) / 2}, ${x} ${(masterY + workerY) / 2}, ${x} ${workerY}`

                      return (
                        <g key={`path-group-full-${key}`}>
                          <path
                            id={`path-worker-full-${key}`}
                            d={dPath}
                            fill="none"
                            stroke={
                              phase === 'idle' ? 'var(--color-text-muted)' : 'url(#line-grad-full)'
                            }
                            strokeWidth={1.5}
                            strokeOpacity={phase === 'idle' ? 0.15 : 0.6}
                            strokeDasharray={isAnimating ? '4,4' : 'none'}
                            className={clsx(
                              'transition-all duration-500',
                              isAnimating && 'swarm-dash'
                            )}
                          />
                          {isAnimating && (
                            <circle r="3.5" fill={style.color}>
                              <animateMotion dur="2s" repeatCount="indefinite">
                                <mpath href={`#path-worker-full-${key}`} />
                              </animateMotion>
                            </circle>
                          )}
                        </g>
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
                          {isSelected && (
                            <circle
                              cx={masterX}
                              cy={masterY}
                              r={18}
                              fill="none"
                              stroke={style.border}
                              strokeWidth={1}
                              className="animate-ping opacity-25"
                            />
                          )}
                          <circle
                            cx={masterX}
                            cy={masterY}
                            r={15}
                            fill="var(--color-background-secondary)"
                            stroke={style.border}
                            strokeWidth={isSelected ? 2.5 : 1.5}
                            filter={isSelected ? 'url(#glow-master-full)' : undefined}
                            className="transition-all duration-300 hover:stroke-accent-primary"
                          />
                          <text
                            x={masterX}
                            y={masterY + 4}
                            textAnchor="middle"
                            fontSize="11"
                            className="pointer-events-none select-none"
                          >
                            👑
                          </text>
                          <text
                            x={masterX}
                            y={masterY - 18}
                            textAnchor="middle"
                            fontSize="8"
                            fontWeight="bold"
                            fill="var(--color-text-primary)"
                            className="font-sans tracking-wider opacity-90 pointer-events-none select-none uppercase"
                          >
                            Coordinator
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
                      const isAnimating = phase === 'thinking' || phase === 'tool_use'

                      let filterId: string | undefined = undefined
                      if (isSelected) {
                        filterId =
                          phase === 'tool_use'
                            ? 'url(#glow-worker-tool-full)'
                            : 'url(#glow-worker-thinking-full)'
                      }

                      return (
                        <g
                          key={`node-full-${key}`}
                          className="cursor-pointer group"
                          onClick={() => setSelectedAgentKey(String(key))}
                        >
                          {isAnimating && (
                            <circle
                              cx={x}
                              cy={workerY}
                              r={14}
                              fill="none"
                              stroke={style.border}
                              strokeWidth={1}
                              className="animate-ping opacity-25"
                            />
                          )}
                          <circle
                            cx={x}
                            cy={workerY}
                            r={11}
                            fill="var(--color-background-secondary)"
                            stroke={style.border}
                            strokeWidth={isSelected ? 2.5 : 1.5}
                            filter={filterId}
                            className="transition-all duration-300 hover:stroke-accent-secondary"
                          />
                          <text
                            x={x}
                            y={workerY + 3.5}
                            textAnchor="middle"
                            fontSize="8"
                            fontWeight="bold"
                            fill={style.color}
                            className="pointer-events-none font-mono select-none"
                          >
                            {key}
                          </text>
                          <text
                            x={x}
                            y={workerY + 22}
                            textAnchor="middle"
                            fontSize="8"
                            fill="var(--color-text-secondary)"
                            className="opacity-70 font-sans pointer-events-none select-none"
                          >
                            Agent {key}
                          </text>
                          <text
                            x={x}
                            y={workerY + 32}
                            textAnchor="middle"
                            fontSize="7"
                            fontWeight="semibold"
                            fill={style.color}
                            className="opacity-80 font-sans pointer-events-none select-none uppercase tracking-wider"
                          >
                            {phase === 'tool_use' ? 'tool call' : phase}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>

                {activeAgent && (
                  <div className="flex flex-col gap-3 p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015] backdrop-blur-md transition-all duration-300">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-text-secondary uppercase tracking-widest flex items-center gap-1.5">
                        {activeKey === 'master'
                          ? '👑 Master Coordinator'
                          : `🤖 Worker Agent #${activeKey}`}
                      </span>
                      <span
                        className={clsx(
                          'text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm tracking-wider flex items-center gap-1.5',
                          activeAgent.phase === 'thinking'
                            ? 'bg-accent-primary/10 text-accent-primary'
                            : activeAgent.phase === 'tool_use'
                              ? 'bg-status-warning/10 text-status-warning'
                              : activeAgent.phase === 'done'
                                ? 'bg-status-success/10 text-status-success'
                                : 'bg-status-error/10 text-status-error'
                        )}
                      >
                        <span
                          className={clsx(
                            'w-1.5 h-1.5 rounded-full',
                            activeAgent.phase === 'thinking' && 'bg-accent-primary animate-pulse',
                            activeAgent.phase === 'tool_use' && 'bg-status-warning animate-pulse',
                            activeAgent.phase === 'done' && 'bg-status-success',
                            activeAgent.phase === 'error' && 'bg-status-error',
                            activeAgent.phase === 'cancelled' && 'bg-text-muted'
                          )}
                        />
                        {activeAgent.command?.includes('WAITING')
                          ? 'LISTENING'
                          : activeAgent.command?.includes('MESSAGE TO')
                            ? 'SENDING'
                            : activeAgent.phase.replace('_', ' ')}
                      </span>
                    </div>

                    {activeAgent.command && (
                      <div className="font-mono text-[10.5px] bg-black/35 border border-white/[0.03] rounded-lg p-3 flex flex-col gap-1.5 select-text">
                        <div className="flex items-center gap-1.5 text-accent-secondary/90 font-semibold border-b border-white/[0.04] pb-1.5 mb-0.5">
                          <Terminal size={12} />
                          <span>ACTIVE PROCESS</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-text-muted select-none font-bold">$</span>
                          <code className="text-text-primary break-all leading-relaxed">
                            {activeAgent.command}
                          </code>
                        </div>
                      </div>
                    )}

                    {activeAgent.output && (
                      <div className="font-mono text-[10.5px] bg-black/35 border border-white/[0.03] rounded-lg p-3 flex flex-col gap-1.5 select-text">
                        <div className="flex items-center gap-1.5 text-text-muted opacity-80 font-semibold border-b border-white/[0.04] pb-1.5 mb-0.5">
                          <FileText size={12} />
                          <span>CONSOLE OUTPUT</span>
                        </div>
                        <div className="text-text-secondary/95 break-words leading-relaxed max-h-[140px] overflow-y-auto whitespace-pre-wrap">
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

function BrowserSessionSeparator({
  message,
  isRunning
}: {
  message: string
  isRunning: boolean
}): React.JSX.Element {
  return (
    <div className="w-full flex items-center gap-4 py-4 select-none animate-fade-in">
      <div className="flex-grow border-t border-dashed border-white/[0.08]" />
      <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.04] bg-white/[0.01] shadow-sm">
        <div className="flex gap-1.5 mr-1 select-none">
          <span
            className={clsx(
              'w-1.5 h-1.5 rounded-full bg-status-error/40',
              isRunning && 'animate-pulse'
            )}
          />
          <span
            className={clsx(
              'w-1.5 h-1.5 rounded-full bg-status-warning/40',
              isRunning && 'animate-pulse'
            )}
          />
          <span
            className={clsx(
              'w-1.5 h-1.5 rounded-full bg-status-success/40',
              isRunning && 'animate-pulse'
            )}
          />
        </div>
        <span className="text-[10px] font-mono tracking-widest text-text-secondary/80 uppercase">
          {message}
        </span>
        <span
          className={clsx(
            'text-[10px] opacity-75 font-mono select-none',
            isRunning && 'animate-pulse'
          )}
        >
          🌐
        </span>
      </div>
      <div className="flex-grow border-t border-dashed border-white/[0.08]" />
    </div>
  )
}

export function ActionLoader({ toolCall, mode = 'compact', writingArgs }: ActionLoaderProps): React.JSX.Element {
  const isRunning = toolCall.status === 'running' || toolCall.status === 'writing'

  if (toolCall.name === 'open_browser') {
    return (
      <BrowserSessionSeparator message="AI has started a browser session" isRunning={isRunning} />
    )
  }
  if (toolCall.name === 'browser_close' || toolCall.name === 'close_browser') {
    return (
      <BrowserSessionSeparator message="AI finished the browser session" isRunning={isRunning} />
    )
  }

  if (toolCall.name === 'create_mini_app') {
    const title = (toolCall.args.title || writingArgs?.title || 'Mini App') as string
    const html = (toolCall.args.html || '') as string
    const css = (toolCall.args.css || '') as string
    const js = (toolCall.args.js || '') as string
    const isDone = toolCall.status === 'done'

    const miniAppId = `mini-app-loader-${title.replace(/\s+/g, '-').toLowerCase()}`

    return (
      <div className="w-full flex flex-col gap-2 my-2 select-none">
        {mode === 'full' ? (
          <FullActionLoader toolCall={toolCall} writingArgs={writingArgs} />
        ) : (
          <CompactActionLoader toolCall={toolCall} writingArgs={writingArgs} />
        )}
        {isDone && (
          <div className="w-full px-0">
            <MiniAppRenderer
              id={miniAppId}
              title={title}
              html={html}
              css={css}
              js={js}
            />
          </div>
        )}
      </div>
    )
  }

  if (toolCall.name === 'write_pdf' || toolCall.name === 'edit_pdf') {
    const isDone = toolCall.status === 'done'
    const resText = toolCall.result || ''

    const idMatch = resText.match(/ID:\s*(#?\d{6})/i) || (toolCall.args.id ? [null, String(toolCall.args.id)] : null)
    const artifactId = idMatch ? idMatch[1].replace('#', '') : undefined

    const pathMatch = resText.match(/(?:Saved at|File path):\s*(.+)/i) || (toolCall.args.path ? [null, String(toolCall.args.path)] : null)
    const filePath = pathMatch ? pathMatch[1].trim() : (toolCall.args.path as string | undefined)

    const filename = (toolCall.args.filename as string) || (filePath ? filePath.split(/[\\/]/).pop() : undefined) || 'document.pdf'

    return (
      <div className="w-full flex flex-col gap-2 my-2 select-none">
        {mode === 'full' ? (
          <FullActionLoader toolCall={toolCall} writingArgs={writingArgs} />
        ) : (
          <CompactActionLoader toolCall={toolCall} writingArgs={writingArgs} />
        )}
        {isDone && (
          <PdfArtifactCard
            id={artifactId}
            filename={filename}
            path={filePath}
            toolName={toolCall.name}
          />
        )}
      </div>
    )
  }

  if (toolCall.name === 'write_pptx' || toolCall.name === 'edit_pptx') {
    const isDone = toolCall.status === 'done'
    const resText = toolCall.result || ''

    const idMatch = resText.match(/ID:\s*(#?\d{6})/i) || (toolCall.args.id ? [null, String(toolCall.args.id)] : null)
    const artifactId = idMatch ? idMatch[1].replace('#', '') : undefined

    const pathMatch = resText.match(/(?:Saved at|File path):\s*(.+)/i) || (toolCall.args.path ? [null, String(toolCall.args.path)] : null)
    const filePath = pathMatch ? pathMatch[1].trim() : (toolCall.args.path as string | undefined)

    const filename = (toolCall.args.filename as string) || (filePath ? filePath.split(/[\\/]/).pop() : undefined) || 'presentation.pptx'

    return (
      <div className="w-full flex flex-col gap-2 my-2 select-none">
        {mode === 'full' ? (
          <FullActionLoader toolCall={toolCall} writingArgs={writingArgs} />
        ) : (
          <CompactActionLoader toolCall={toolCall} writingArgs={writingArgs} />
        )}
        {isDone && (
          <PptxArtifactCard
            id={artifactId}
            filename={filename}
            path={filePath}
            toolName={toolCall.name}
          />
        )}
      </div>
    )
  }

  if (mode === 'full') {
    return <FullActionLoader toolCall={toolCall} writingArgs={writingArgs} />
  }
  return <CompactActionLoader toolCall={toolCall} writingArgs={writingArgs} />
}
