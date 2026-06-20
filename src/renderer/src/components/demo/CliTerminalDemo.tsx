import { useEffect, useMemo, useState } from 'react'

interface TerminalExample {
  command: string
  response: string
}

const EXAMPLES: TerminalExample[] = [
  {
    command: 'prism "What games have I installed on this machine?"',
    response:
      'Found Steam, osu!, Valorant, Minecraft, and Hollow Knight. Pattern: rhythm games plus competitive shooters. Want a launcher shortcut?'
  },
  {
    command: 'prism "Open FL Studio"',
    response: 'Opening FL Studio 2025. I also found your last project in Documents\\Music\\Sessions.'
  },
  {
    command: 'prism "Gimme the Git status of this folder"',
    response:
      'You have 8 modified files and 6 new demo files. Nothing staged yet. I can prepare a clean commit when tests pass.'
  },
  {
    command: 'prism "Find the biggest files in Downloads"',
    response:
      'Top files: sample-pack.zip (3.1 GB), livestream.mov (2.4 GB), installer-old.exe (840 MB). No deletion without confirmation.'
  },
  {
    command: 'prism "Research compact audio interfaces under 200 dollars"',
    response:
      'Shortlist ready: Focusrite Scarlett Solo, Audient iD4, MOTU M2. MOTU wins on metering and loopback.'
  },
  {
    command: 'prism "Summarize this folder"',
    response:
      'This looks like an Electron + React app with local tools, chat history, launcher windows, and a demo build variant in progress.'
  },
  {
    command: 'prism "Set up my coding workspace"',
    response:
      'Opening editor, terminal, docs, and the current repo. I will keep music apps minimized for the focus block.'
  },
  {
    command: 'prism "Check if Node and Git are ready"',
    response: 'Node 22 and Git are available. npm dependencies are installed. This repo is ready for typecheck.'
  }
]

function useTerminalText(examples: TerminalExample[]): {
  command: string
  response: string
  activeIndex: number
} {
  const [activeIndex, setActiveIndex] = useState(0)
  const [command, setCommand] = useState('')
  const [response, setResponse] = useState('')

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const example = examples[activeIndex]

    const typeText = (
      text: string,
      setter: (value: string) => void,
      speed: number,
      done: () => void
    ): void => {
      let cursor = 0
      const tick = (): void => {
        if (cancelled) return
        cursor += 1
        setter(text.slice(0, cursor))
        if (cursor < text.length) {
          timers.push(window.setTimeout(tick, speed))
        } else {
          done()
        }
      }
      timers.push(window.setTimeout(tick, speed))
    }

    const startTimer = window.setTimeout(() => {
      if (cancelled) return
      setCommand('')
      setResponse('')
      typeText(example.command, setCommand, 24, () => {
        timers.push(
          window.setTimeout(() => {
            typeText(example.response, setResponse, 14, () => {
              timers.push(
                window.setTimeout(() => {
                  if (!cancelled) setActiveIndex((index) => (index + 1) % examples.length)
                }, 2200)
              )
            })
          }, 450)
        )
      })
    }, 0)
    timers.push(startTimer)

    return () => {
      cancelled = true
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [activeIndex, examples])

  return { command, response, activeIndex }
}

export function CliTerminalDemo(): React.JSX.Element {
  const examples = useMemo(() => EXAMPLES, [])
  const { command, response, activeIndex } = useTerminalText(examples)

  return (
    <div className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#08090d] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
      <div className="flex h-9 items-center justify-between border-b border-white/[0.07] px-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-status-error/75" />
          <span className="h-2.5 w-2.5 rounded-full bg-status-warning/75" />
          <span className="h-2.5 w-2.5 rounded-full bg-status-success/75" />
        </div>
        <span className="font-mono text-[10px] uppercase text-text-muted">
          PrismCLI {activeIndex + 1}/{examples.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4 font-mono text-[12px] leading-relaxed">
        <div className="text-text-secondary/75">PS C:\Users\You&gt;</div>
        <div className="min-h-[44px] break-words text-text-primary">
          {command}
          <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse bg-accent-secondary" />
        </div>
        <div className="h-px bg-white/[0.06]" />
        <div className="whitespace-pre-wrap break-words text-accent-secondary/95">
          {response || ' '}
        </div>
      </div>
    </div>
  )
}
