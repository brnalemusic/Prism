import {
  ArrowRight,
  DownloadSimple,
  FileCode,
  MagnifyingGlass,
  PlayCircle,
  Sparkle,
  Terminal
} from '@phosphor-icons/react'
import type { DemoScript } from '../../../../shared/demo'
import clsx from 'clsx'

interface DemoHomeProps {
  scripts: DemoScript[]
  onSelectScript: (script: DemoScript) => void
  onDownload: () => void
  username?: string
}

function renderCategoryIcon(category: string): React.JSX.Element {
  if (category === 'Research') return <MagnifyingGlass size={13} />
  if (category === 'Automation') return <Terminal size={13} />
  if (category === 'Coding') return <FileCode size={13} />
  if (category === 'Productivity') return <Sparkle size={13} />
  return <PlayCircle size={13} />
}

export function DemoHome({
  scripts,
  onSelectScript,
  onDownload
}: DemoHomeProps): React.JSX.Element {
  return (
    <main className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      {/* Top Header/Bar for Demo branding and Download CTA */}
      <header className="absolute left-0 right-0 top-12 z-20 flex h-16 items-center justify-between px-6 sm:px-8">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-accent-secondary">
          <Sparkle size={14} weight="fill" />
          Prism Demo
        </div>
        <button
          onClick={onDownload}
          className="flex h-9 items-center gap-2 rounded-lg border border-white bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-neutral-200 active:scale-[0.98] cursor-pointer"
        >
          <DownloadSimple size={15} weight="bold" />
          Download Prism
        </button>
      </header>

      {/* Main Centered Content */}
      <div className="flex-grow flex flex-col items-center justify-center px-4 pb-[6vh] pt-24 relative select-none">
        {/* Home Screen Selection Options */}
        <div className="relative z-10 flex flex-col items-center w-full max-w-[820px] text-center gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full mt-4">
            {scripts.map((script, index) => (
              <button
                key={script.id}
                onClick={() => onSelectScript(script)}
                className={clsx(
                  'group relative flex min-h-[105px] flex-col justify-between rounded-xl border border-[var(--border-default)] bg-[var(--surface)] p-4.5 text-left transition-colors duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] active:scale-[0.98] cursor-pointer',
                  index === 4 && 'sm:col-span-2'
                )}
              >
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.05] bg-white/[0.03] px-2.5 py-0.5 text-[10.5px] font-medium text-text-secondary">
                      {renderCategoryIcon(script.category)}
                      {script.category}
                    </span>
                    <div className="rounded-full bg-white/[0.02] p-1 text-text-muted transition-all duration-300 group-hover:bg-accent-secondary/10 group-hover:text-accent-secondary">
                      <ArrowRight
                        size={14}
                        className="transition-transform duration-300 group-hover:translate-x-0.5"
                      />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[14.5px] font-semibold text-text-primary leading-tight group-hover:text-accent-secondary transition-colors">
                      {script.trigger}
                    </h2>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
                      {script.subtitle}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
