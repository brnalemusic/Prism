import { MessageSquare, Settings, CheckSquare } from 'lucide-react'
import clsx from 'clsx'

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
  runningTasksCount?: number
}

export function Sidebar({
  activeView,
  onViewChange,
  runningTasksCount = 0
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="w-[260px] h-full hidden md:flex flex-col bg-background-secondary/30 backdrop-blur-xl z-20 relative border-r border-surface/20 transition-all duration-300">
      <div className="p-8">
        <h1 className="text-text-primary font-black text-3xl tracking-tighter">
          PRISM
          <span className="block h-1 w-8 bg-accent-primary mt-1 rounded-full shadow-[0_0_10px_rgba(108,99,255,0.5)]"></span>
        </h1>
      </div>

      <nav className="flex-1 px-4 py-2 flex flex-col gap-2">
        <NavItem
          icon={<MessageSquare size={16} />}
          label="Chat"
          active={activeView === 'chat'}
          onClick={(): void => onViewChange('chat')}
        />
        <NavItem
          icon={<CheckSquare size={16} />}
          label="Tasks"
          active={activeView === 'tasks'}
          onClick={(): void => onViewChange('tasks')}
          badge={runningTasksCount > 0 ? runningTasksCount : undefined}
          pulse={runningTasksCount > 0}
        />
      </nav>

      <div className="p-4 mt-auto">
        <NavItem
          icon={<Settings size={16} />}
          label="Settings"
          active={activeView === 'settings'}
          onClick={(): void => onViewChange('settings')}
        />
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  active = false,
  onClick,
  badge,
  pulse = false
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  badge?: number | string
  pulse?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 relative group overflow-hidden',
        active
          ? 'bg-surface/50 text-text-primary shadow-[inset_0_0_20px_rgba(255,255,255,0.02)] border border-surface'
          : 'text-text-secondary hover:bg-surface/30 hover:text-text-primary border border-transparent'
      )}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent-primary rounded-r-full shadow-[0_0_10px_rgba(108,99,255,0.5)]" />
      )}

      <span
        className={clsx(
          'transition-all duration-300',
          active
            ? 'text-accent-primary scale-110'
            : 'opacity-60 group-hover:opacity-100 group-hover:scale-110',
          pulse && 'animate-pulse text-accent-primary'
        )}
      >
        {icon}
      </span>

      <span className="tracking-tight">{label}</span>

      {badge !== undefined && (
        <span className="ml-auto bg-accent-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg min-w-[20px] flex items-center justify-center shadow-[0_0_15px_rgba(108,99,255,0.4)]">
          {badge}
        </span>
      )}
    </button>
  )
}
