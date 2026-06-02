import { clsx } from 'clsx'
import {
  CheckCircle as CheckCircle2,
  CircleNotch as CircleDashed,
  XCircle,
  Terminal,
  ArrowUpRight as ExternalLink,
  List,
  Globe,
  HardDrive,
  Gear as Settings,
  Brain,
  MagnifyingGlass,
  FileText,
  Sparkle,
  AppWindow,
  ClipboardText,
  ChatTeardropText
} from '@phosphor-icons/react'
import { ToolCall } from './ActionLoader'

interface Task extends ToolCall {
  id: string
  timestamp: Date
}

interface TasksProps {
  tasks: Task[]
}

function renderTaskIcon(name: string): React.JSX.Element {
  if (name === 'execute_terminal_command') {
    return <Terminal size={18} />
  }
  if (name === 'open_application' || name === 'open_browser_link') {
    return <ExternalLink size={18} />
  }
  if (name === 'list_installed_applications') {
    return <List size={18} />
  }
  if (name === 'web_search') {
    return <Globe size={18} />
  }
  if (name.startsWith('computer_use_')) {
    return <HardDrive size={18} />
  }
  if (name === 'configure_prism') {
    return <Settings size={18} />
  }
  if (name === 'run_subagents') {
    return <Brain size={18} />
  }
  if (name === 'search_chat_history' || name === 'search_chat_memory') {
    return <MagnifyingGlass size={18} />
  }
  if (name === 'saw_link_from_url') {
    return <FileText size={18} />
  }
  if (name === 'unlock_rgb_theme') {
    return <Sparkle size={18} />
  }
  if (name === 'to_ask') {
    return <ClipboardText size={18} />
  }
  if (name === 'render_chat_history') {
    return <ChatTeardropText size={18} />
  }
  if (name === 'open_main_app') {
    return <AppWindow size={18} />
  }
  if (name === 'send_group_message' || name === 'read_group_messages') {
    return <ChatTeardropText size={18} />
  }
  if (name === 'wait_for_updates') {
    return <CircleDashed size={18} className="animate-spin" />
  }
  return <Terminal size={18} />
}

export function Tasks({ tasks }: TasksProps): React.JSX.Element {
  return (
    <div className="flex h-full w-full max-w-4xl flex-col mx-auto px-6 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-text-primary">System Tasks</h2>
        <p className="mt-1 text-sm text-text-secondary/70">
          A history of actions performed by Prism during this session.
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="premium-panel-soft flex flex-1 flex-col items-center justify-center rounded-[30px] opacity-80">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/[0.08] bg-white/[0.035]">
            <CheckCircle2 size={32} className="text-text-secondary" />
          </div>
          <p className="font-medium text-text-secondary">No tasks recorded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tasks
            .slice()
            .reverse()
            .map((task) => (
              <div
                key={task.id}
                className="premium-panel-soft group relative flex flex-col rounded-[24px] p-5 transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={clsx(
                        'flex items-center justify-center rounded-[18px] border p-2.5',
                        task.status === 'running'
                          ? 'border-accent-primary/20 bg-accent-primary/[0.09] text-accent-primary'
                          : task.status === 'done'
                            ? 'border-status-success/20 bg-status-success/[0.09] text-status-success'
                            : 'border-status-error/20 bg-status-error/[0.09] text-status-error'
                      )}
                    >
                      {renderTaskIcon(task.name)}
                    </div>

                    <div>
                      <h3 className="text-[15px] font-semibold text-text-primary leading-tight">
                        {task.name.startsWith('computer_use_')
                          ? 'Computer Use'
                          : task.name.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] font-semibold text-text-secondary/50">
                          {task.timestamp.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                        <span className="text-text-secondary/30">/</span>
                        <span
                          className={clsx(
                            'text-[11px] font-semibold',
                            task.status === 'running'
                              ? 'text-accent-primary animate-pulse'
                              : task.status === 'done'
                                ? 'text-status-success/80'
                                : 'text-status-error/80'
                          )}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {task.status === 'running' && (
                    <CircleDashed size={18} className="text-accent-primary animate-spin" />
                  )}
                  {task.status === 'done' && (
                    <CheckCircle2 size={18} className="text-status-success/60" />
                  )}
                  {task.status === 'error' && (
                    <XCircle size={18} className="text-status-error/60" />
                  )}
                </div>

                <div className="mt-2 flex flex-col gap-2">
                  <div className="rounded-[18px] border border-white/[0.055] bg-black/15 p-3">
                    <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary/50">
                      Parameters
                    </span>
                    <pre className="text-[12px] font-mono text-text-primary/90 whitespace-pre-wrap break-all leading-relaxed">
                      {JSON.stringify(task.args, null, 2)}
                    </pre>
                  </div>

                  {task.result && (
                    <div className="mt-1 rounded-[18px] border border-white/[0.055] bg-black/20 p-3">
                      <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary/50">
                        Output
                      </span>
                      <pre className="max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-accent-secondary/80">
                        {task.name === 'search_chat_memory' &&
                        task.result.trim() === '[RESULTS OMITTED]'
                          ? 'Results omitted to priorize performance'
                          : task.result}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
