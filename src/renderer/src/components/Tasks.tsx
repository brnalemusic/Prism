import { clsx } from 'clsx'
import {
  CheckCircle2,
  CircleDashed,
  XCircle,
  Terminal,
  ExternalLink,
  List,
  Globe,
  HardDrive
} from 'lucide-react'
import { ToolCall } from './ActionLoader'

interface Task extends ToolCall {
  id: string
  timestamp: Date
}

interface TasksProps {
  tasks: Task[]
}

export function Tasks({ tasks }: TasksProps): React.JSX.Element {
  return (
    <div className="flex flex-col h-full w-full max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">System Tasks</h2>
        <p className="text-text-secondary text-sm mt-1">
          A history of actions performed by Prism during this session.
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center opacity-40 grayscale">
          <div className="w-16 h-16 rounded-full border-2 border-dashed border-text-secondary flex items-center justify-center mb-4">
            <CheckCircle2 size={32} className="text-text-secondary" />
          </div>
          <p className="text-text-secondary font-medium italic">No tasks recorded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tasks
            .slice()
            .reverse()
            .map((task) => (
              <div
                key={task.id}
                className="group relative flex flex-col bg-surface/5 border border-surface/20 rounded-2xl p-5 transition-all hover:bg-surface/10 hover:border-surface/40"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={clsx(
                        'p-2.5 rounded-xl flex items-center justify-center',
                        task.status === 'running'
                          ? 'bg-accent-primary/10 text-accent-primary'
                          : task.status === 'done'
                            ? 'bg-status-success/10 text-status-success'
                            : 'bg-status-error/10 text-status-error'
                      )}
                    >
                      {task.name === 'execute_terminal_command' && <Terminal size={18} />}
                      {task.name === 'open_application' && <ExternalLink size={18} />}
                      {task.name === 'list_installed_applications' && <List size={18} />}
                      {task.name === 'web_search' && <Globe size={18} />}
                      {task.name.startsWith('computer_use_') && <HardDrive size={18} />}
                    </div>

                    <div>
                      <h3 className="text-[15px] font-bold text-text-primary leading-tight">
                        {task.name.startsWith('computer_use_')
                          ? 'Computer Use'
                          : task.name.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-text-secondary/50">
                          {task.timestamp.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                        <span className="text-text-secondary/30">•</span>
                        <span
                          className={clsx(
                            'text-[10px] uppercase tracking-widest font-black',
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
                  <div className="bg-black/20 rounded-lg p-3 border border-surface/10">
                    <span className="text-[9px] uppercase tracking-widest font-bold text-text-secondary/40 block mb-1.5">
                      Parameters
                    </span>
                    <pre className="text-[12px] font-mono text-text-primary/90 whitespace-pre-wrap break-all leading-relaxed">
                      {JSON.stringify(task.args, null, 2)}
                    </pre>
                  </div>

                  {task.result && (
                    <div className="bg-black/40 rounded-lg p-3 border border-surface/10 mt-1">
                      <span className="text-[9px] uppercase tracking-widest font-bold text-text-secondary/40 block mb-1.5">
                        Output
                      </span>
                      <pre className="text-[11px] font-mono text-accent-secondary/80 whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto leading-relaxed custom-scrollbar">
                        {task.result}
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
