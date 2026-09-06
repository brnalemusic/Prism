import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowClockwise,
  ArrowDown,
  ArrowUp,
  CaretDown,
  Check,
  CircleNotch,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Plus,
  Sparkle,
  Trash,
  Warning,
  X
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type { HarnessGitAction, HarnessGitSnapshot } from '../../../shared/types'

interface HarnessGitControlProps {
  projectPath?: string
  modelKey: string
  onResolveConflict: (snapshot: HarnessGitSnapshot) => void
  onOpenProject: (path: string) => void
}

const PANEL_TRANSITION = { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] as const }

function shortName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

export function HarnessGitControl({
  projectPath,
  modelKey,
  onResolveConflict,
  onOpenProject
}: HarnessGitControlProps): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<HarnessGitSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [includeCoAuthor, setIncludeCoAuthor] = useState(false)
  const [coAuthorName, setCoAuthorName] = useState('brnalemusic')
  const [coAuthorEmail, setCoAuthorEmail] = useState('')
  const [signoff, setSignoff] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [isBranchToolsOpen, setIsBranchToolsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const reduceMotion = useReducedMotion()

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectPath) {
      setSnapshot(null)
      return
    }
    setIsLoading(true)
    try {
      setSnapshot(await window.api.getHarnessGitStatus(projectPath))
    } catch (error) {
      setSnapshot(null)
      setNotice(error instanceof Error ? error.message : 'Could not read Git status.')
    } finally {
      setIsLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (isOpen) void refresh()
  }, [isOpen, refresh])

  useEffect(() => {
    setMessage('')
    setNotice(null)
    setSnapshot(null)
  }, [projectPath])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    const element = messageRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 30), 300)}px`
  }, [message])

  const runAction = useCallback(
    async (action: HarnessGitAction, label: string): Promise<boolean> => {
      if (!projectPath) return false
      setPending(label)
      setNotice(null)
      try {
        const result = await window.api.runHarnessGitAction(projectPath, action)
        setSnapshot(result.snapshot)
        if (!result.ok) {
          setNotice(result.error || 'Git operation failed.')
          return false
        }
        setNotice(result.prUrl ? `Pull request created: ${result.prUrl}` : `${label} completed.`)
        return true
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Git operation failed.')
        return false
      } finally {
        setPending(null)
      }
    },
    [projectPath]
  )

  const commit = useCallback(async (): Promise<void> => {
    if (!projectPath) return
    let nextMessage = message.trim()
    setPending('Commit')
    setNotice(null)
    try {
      if (!nextMessage) {
        nextMessage = await window.api.generateHarnessGitCommitMessage(projectPath, modelKey)
      }
      if (includeCoAuthor && (!coAuthorName.trim() || !coAuthorEmail.trim())) {
        throw new Error('Enter the co-author name and email before committing.')
      }
      const result = await window.api.runHarnessGitAction(projectPath, {
        kind: 'commit',
        options: {
          message: nextMessage,
          sign: snapshot?.signing.enabled,
          signoff,
          coAuthor: includeCoAuthor
            ? { name: coAuthorName.trim(), email: coAuthorEmail.trim() }
            : undefined
        }
      })
      setSnapshot(result.snapshot)
      if (!result.ok) throw new Error(result.error || 'Commit failed.')
      setMessage('')
      setNotice('Commit created.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Commit failed.')
    } finally {
      setPending(null)
    }
  }, [coAuthorEmail, coAuthorName, includeCoAuthor, message, modelKey, projectPath, signoff, snapshot?.signing.enabled])

  const generateMessage = useCallback(async (): Promise<void> => {
    if (!projectPath) return
    setPending('Generate message')
    setNotice(null)
    try {
      setMessage(await window.api.generateHarnessGitCommitMessage(projectPath, modelKey))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not generate a commit message.')
    } finally {
      setPending(null)
    }
  }, [modelKey, projectPath])

  if (!projectPath) return null
  const isBusy = pending !== null
  const hasConflict = Boolean(snapshot?.operation || snapshot?.conflicts.length)
  const branchLabel = snapshot?.branch || (snapshot?.detached ? 'Detached' : 'Git')
  const busyIcon = <CircleNotch size={12} className="animate-spin" />

  return (
    <div ref={rootRef} className="relative ml-1.5">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={clsx(
          'group inline-flex h-7 max-w-[176px] items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
          isOpen
            ? 'border-accent-primary/35 bg-accent-primary/10 text-text-primary'
            : 'border-transparent text-text-secondary/75 hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-text-primary',
          hasConflict && 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        )}
        title="Open Git Control"
      >
        {isLoading ? busyIcon : <GitBranch size={13} weight="bold" className="shrink-0 text-accent-primary" />}
        <span className="max-w-[122px] truncate font-mono text-[10.5px]">{branchLabel}</span>
        {snapshot && (snapshot.files.length > 0 || snapshot.ahead > 0 || snapshot.behind > 0) && (
          <span className="rounded bg-white/[0.08] px-1 font-mono text-[9px] text-text-muted">
            {snapshot.files.length + snapshot.ahead + snapshot.behind}
          </span>
        )}
        <CaretDown size={10} weight="bold" className={clsx('text-text-muted transition-transform', isOpen && 'rotate-180')} />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: -5, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
            transition={PANEL_TRANSITION}
            className="absolute right-0 top-9 z-[70] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/[0.12] bg-[#101218] text-text-primary shadow-[0_22px_56px_rgba(0,0,0,0.64)]"
          >
            <header className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <GitBranch size={13} className="text-accent-primary" />
                  <span className="truncate font-mono">{branchLabel}</span>
                  {snapshot?.upstream && <span className="truncate text-[9.5px] font-normal text-text-muted">→ {snapshot.upstream}</span>}
                </div>
                <p className="mt-0.5 truncate font-mono text-[9px] text-text-muted">{shortName(projectPath)}</p>
              </div>
              <button type="button" onClick={() => void refresh()} className="rounded p-1 text-text-muted hover:bg-white/[0.07] hover:text-text-primary cursor-pointer" title="Refresh Git status">
                <ArrowClockwise size={13} className={clsx(isLoading && 'animate-spin')} />
              </button>
            </header>

            {!snapshot && !isLoading && (
              <div className="px-3 py-5 text-center text-[11px] text-text-muted">Git status is unavailable for this project.</div>
            )}

            {snapshot && !snapshot.isGit && (
              <div className="px-3 py-5 text-center text-[11px] text-text-muted">{snapshot.error || 'This folder is not a Git repository.'}</div>
            )}

            {snapshot?.isGit && (
              <div className="max-h-[min(70vh,620px)] overflow-y-auto p-2.5 custom-scrollbar">
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.07] bg-black/15 p-1">
                  <div className="px-1.5 py-1 text-center"><div className="font-mono text-xs text-text-primary">{snapshot.files.length}</div><div className="text-[8.5px] uppercase tracking-wide text-text-muted">Changes</div></div>
                  <div className="border-x border-white/[0.06] px-1.5 py-1 text-center"><div className="font-mono text-xs text-text-primary">↑{snapshot.ahead} ↓{snapshot.behind}</div><div className="text-[8.5px] uppercase tracking-wide text-text-muted">Remote</div></div>
                  <div className="px-1.5 py-1 text-center"><div className={clsx('font-mono text-xs', hasConflict ? 'text-amber-300' : 'text-text-primary')}>{snapshot.conflicts.length}</div><div className="text-[8.5px] uppercase tracking-wide text-text-muted">Conflicts</div></div>
                </div>

                {hasConflict ? (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-2.5">
                    <div className="flex items-start gap-2"><Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-amber-400" /><div><p className="text-[11px] font-semibold text-amber-200">{snapshot.operation ? `${snapshot.operation.kind} is paused` : 'Conflicts need resolution'}</p><p className="mt-0.5 text-[10px] text-amber-100/70">{snapshot.conflicts.slice(0, 3).join(', ') || 'Git has a pending operation.'}</p></div></div>
                    <div className="mt-2 flex gap-1.5">
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'abortOperation' }, 'Abort')} className="rounded-md border border-amber-400/25 px-2 py-1 text-[10px] font-medium text-amber-100 hover:bg-amber-400/10 disabled:opacity-50 cursor-pointer">Abort</button>
                      <button type="button" onClick={() => onOpenProject(projectPath)} className="rounded-md border border-white/[0.1] px-2 py-1 text-[10px] text-text-secondary hover:bg-white/[0.06] cursor-pointer">Open project</button>
                      <button type="button" onClick={() => onResolveConflict(snapshot)} className="ml-auto rounded-md bg-accent-primary/15 px-2 py-1 text-[10px] font-semibold text-accent-primary hover:bg-accent-primary/25 cursor-pointer">Resolve with AI</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 flex gap-1">
                      <select
                        value={snapshot.branch || ''}
                        onChange={(event) => void runAction({ kind: 'switchBranch', name: event.target.value }, 'Switch branch')}
                        disabled={isBusy || snapshot.detached}
                        className="min-w-0 flex-1 rounded-md border border-white/[0.1] bg-black/20 px-2 py-1.5 font-mono text-[10px] text-text-primary outline-none focus:border-accent-primary/50 disabled:opacity-50"
                        aria-label="Switch branch"
                      >
                        {snapshot.branches.map((branch) => <option key={branch.fullName} value={branch.fullName}>{branch.isRemote ? `Remote · ${branch.fullName}` : branch.name}</option>)}
                      </select>
                      <button type="button" onClick={() => setIsBranchToolsOpen((open) => !open)} className="rounded-md border border-white/[0.1] px-2 text-text-secondary hover:bg-white/[0.06] hover:text-text-primary cursor-pointer" title="Manage branches"><Plus size={13} /></button>
                    </div>

                    <AnimatePresence initial={false}>
                      {isBranchToolsOpen && (
                        <motion.div initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={PANEL_TRANSITION} className="overflow-hidden">
                          <div className="mt-1.5 flex gap-1">
                            <button type="button" onClick={() => { const name = window.prompt('New branch name'); if (name) void runAction({ kind: 'createBranch', name }, 'Create branch') }} className="flex-1 rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-text-secondary hover:bg-white/[0.1] hover:text-text-primary cursor-pointer">New</button>
                            <button type="button" onClick={() => { if (!snapshot.branch) return; const name = window.prompt('New branch name', snapshot.branch); if (name && name !== snapshot.branch) void runAction({ kind: 'renameBranch', from: snapshot.branch, to: name }, 'Rename branch') }} className="flex-1 rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-text-secondary hover:bg-white/[0.1] hover:text-text-primary cursor-pointer">Rename</button>
                            <button type="button" onClick={() => { const branch = window.prompt('Branch to merge into the current branch'); if (branch) void runAction({ kind: 'merge', branch }, 'Merge branch') }} className="flex-1 rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-text-secondary hover:bg-white/[0.1] hover:text-text-primary cursor-pointer">Merge</button>
                            <button type="button" onClick={() => { if (!snapshot.branch) return; const typed = window.prompt(`Type ${snapshot.branch} to delete this branch`); if (typed === snapshot.branch) void runAction({ kind: 'deleteBranch', name: snapshot.branch }, 'Delete branch') }} className="flex-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/20 cursor-pointer">Delete</button>
                            <button type="button" onClick={() => { const remote = window.prompt('Remote name', 'origin'); const branch = window.prompt('Remote branch to delete'); if (remote && branch && window.prompt(`Type ${branch} to delete it from ${remote}`) === branch) void runAction({ kind: 'deleteBranch', name: branch, remote }, 'Delete remote branch') }} className="flex-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/20 cursor-pointer">Remote</button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="mt-2 flex gap-1">
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'sync' }, 'Sync')} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent-primary/15 px-2 py-1.5 text-[10px] font-semibold text-accent-primary hover:bg-accent-primary/25 disabled:opacity-50 cursor-pointer">{pending === 'Sync' ? busyIcon : <ArrowClockwise size={12} />} Sync</button>
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'pull' }, 'Pull')} className="rounded-md border border-white/[0.1] px-2 text-text-secondary hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer" title="Pull with rebase">{pending === 'Pull' ? busyIcon : <ArrowDown size={12} />}</button>
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'push' }, 'Push')} className="rounded-md border border-white/[0.1] px-2 text-text-secondary hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer" title="Push">{pending === 'Push' ? busyIcon : <ArrowUp size={12} />}</button>
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'fetch' }, 'Fetch')} className="rounded-md border border-white/[0.1] px-2 text-text-secondary hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer" title="Fetch">{pending === 'Fetch' ? busyIcon : <ArrowClockwise size={12} />}</button>
                    </div>

                    <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/15 p-2">
                      <div className="flex items-start gap-1">
                        <textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void commit() } }} rows={1} placeholder="Commit message — Enter to commit" className="min-h-[30px] flex-1 resize-none bg-transparent px-1 py-1 text-[11px] leading-4 text-text-primary outline-none placeholder:text-text-muted/65" />
                        <button type="button" disabled={isBusy} onClick={() => void generateMessage()} className="rounded-md p-1.5 text-text-muted hover:bg-white/[0.07] hover:text-accent-primary disabled:opacity-50 cursor-pointer" title="Generate an editable message with the active Harness model">{pending === 'Generate message' ? busyIcon : <Sparkle size={13} />}</button>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-1.5">
                        <label className="flex items-center gap-1 text-[9.5px] text-text-muted cursor-pointer"><input type="checkbox" checked={signoff} onChange={(event) => setSignoff(event.target.checked)} className="accent-[var(--accent-primary)]" /> Sign-off</label>
                        <label className="flex items-center gap-1 text-[9.5px] text-text-muted cursor-pointer"><input type="checkbox" checked={includeCoAuthor} onChange={(event) => setIncludeCoAuthor(event.target.checked)} className="accent-[var(--accent-primary)]" /> Co-author</label>
                        <button type="button" disabled={isBusy || snapshot.files.length === 0} onClick={() => void commit()} className="flex items-center gap-1 rounded-md bg-white/[0.09] px-2 py-1 text-[10px] font-semibold text-text-primary hover:bg-white/[0.14] disabled:opacity-50 cursor-pointer">{pending === 'Commit' ? busyIcon : <GitCommit size={12} />} Commit</button>
                      </div>
                      {includeCoAuthor && <div className="mt-1.5 grid grid-cols-2 gap-1"><input value={coAuthorName} onChange={(event) => setCoAuthorName(event.target.value)} placeholder="Co-author name" className="min-w-0 rounded border border-white/[0.08] bg-black/20 px-1.5 py-1 text-[10px] outline-none focus:border-accent-primary/50" /><input value={coAuthorEmail} onChange={(event) => setCoAuthorEmail(event.target.value)} placeholder="Co-author email" className="min-w-0 rounded border border-white/[0.08] bg-black/20 px-1.5 py-1 text-[10px] outline-none focus:border-accent-primary/50" /></div>}
                    </div>

                    <div className="mt-2 flex gap-1">
                      <button type="button" disabled={isBusy} onClick={() => { if (snapshot.branch === 'main' || snapshot.branch === 'master') { const name = window.prompt('Create a working branch before opening a pull request'); if (name) void runAction({ kind: 'createBranch', name }, 'Create branch'); return } const title = window.prompt('Pull request title'); if (!title) return; const base = window.prompt('Base branch', snapshot.defaultBranch || 'main'); if (!base) return; const body = window.prompt('Pull request description') || ''; void runAction({ kind: 'createPr', title, body, base }, 'Create pull request') }} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-white/[0.1] px-2 py-1.5 text-[10px] text-text-secondary hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer"><GitPullRequest size={12} /> Pull request</button>
                      <button type="button" disabled={isBusy || snapshot.commits.length === 0} onClick={() => { const hash = window.prompt('Commit hash to reset to', snapshot.commits[0]?.shortHash); if (!hash) return; const mode = window.confirm('Use a hard reset? Cancel selects soft reset.'); const label = mode ? 'hard reset' : 'soft reset'; const typed = window.prompt(`Type ${hash} to confirm ${label}`); if (typed === hash) void runAction({ kind: 'reset', hash, mode: mode ? 'hard' : 'soft' }, 'Reset') }} className="flex items-center justify-center rounded-md border border-red-500/20 px-2 text-red-200 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer" title="Reset to a checkpoint"><Trash size={12} /></button>
                    </div>
                  </>
                )}

                {notice && <div className={clsx('mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[10px]', hasConflict || /failed|could not|error|required/i.test(notice) ? 'bg-red-500/10 text-red-200' : 'bg-emerald-500/10 text-emerald-200')}><span className="mt-0.5">{hasConflict ? <Warning size={11} /> : <Check size={11} />}</span><span className="break-words">{notice}</span><button type="button" onClick={() => setNotice(null)} className="ml-auto text-current/70 hover:text-current cursor-pointer"><X size={11} /></button></div>}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
