import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowClockwise, CheckCircle, CircleNotch, GitMerge, Warning } from '@phosphor-icons/react'
import type { HarnessGitRecovery, HarnessGitSnapshot } from '../../../shared/types'

interface Props {
  recovery: HarnessGitRecovery
  onResolve?: (snapshot: HarnessGitSnapshot) => void
  onUpdated?: (snapshot: HarnessGitSnapshot) => void
  reduceMotion?: boolean
}

export function HarnessGitRecoveryCard({ recovery: r, onResolve, onUpdated, reduceMotion }: Props): React.JSX.Element {
  const systemReduced = useReducedMotion()
  const reduced = reduceMotion || systemReduced
  const surface = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)
  const visible = useRef(true)
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  // The confirmation is keyed by the recovery generation so a new generation
  // resets it during render instead of through a synchronous state effect.
  const [confirmState, setConfirmState] = useState<{ generation: number; value: 'abort' | 'pull' } | null>(null)
  const confirm = confirmState?.generation === r.generation ? confirmState.value : null
  const setConfirm = (value: 'abort' | 'pull' | null): void => setConfirmState(value === null ? null : { generation: r.generation, value })
  const [error, setError] = useState<string>()
  const [resolving, setResolving] = useState(false)
  const ended = r.state === 'completed' || r.state === 'aborted'
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting })
    if (surface.current) observer.observe(surface.current)
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [])

  const perform = async (kind: 'retryOperation' | 'cancelRecovery', integrateRemote = false): Promise<void> => {
    if (working.current) return
    working.current = true; setBusy(true); setError(undefined); setConfirm(null)
    try {
      const result = await window.api.runHarnessGitAction(r.projectPath, {
        kind,
        recovery: { id: r.id, revision: r.revision, requestId: crypto.randomUUID() },
        ...(kind === 'cancelRecovery' ? { confirmation: 'ABORT' } : { integrateRemote })
      })
      onUpdated?.(result.snapshot)
      if (!result.ok) setError(result.error || 'Git needs further resolution.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { working.current = false; setBusy(false) }
  }
  const resolve = (): void => {
    if (resolving || busy) return
    setResolving(true); setError(undefined)
    window.api.getHarnessGitStatus(r.projectPath)
      .then((snapshot) => onResolve?.(snapshot))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setResolving(false))
  }
  const button = 'rounded-xl px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <motion.div ref={surface} layout={!reduced} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="relative isolate my-5 overflow-hidden rounded-2xl bg-[var(--surface)] p-5 text-text-primary"
      onPointerMove={(event) => {
        if (reduced || !visible.current || frame.current !== null) return
        const rect = event.currentTarget.getBoundingClientRect()
        const x = event.clientX - rect.left, y = event.clientY - rect.top
        frame.current = requestAnimationFrame(() => {
          surface.current?.style.setProperty('--git-mouse-x', `${x}px`)
          surface.current?.style.setProperty('--git-mouse-y', `${y}px`)
          frame.current = null
        })
      }}
      onPointerLeave={() => { surface.current?.style.removeProperty('--git-mouse-x'); surface.current?.style.removeProperty('--git-mouse-y') }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(var(--accent-primary) 1px, transparent 1px), linear-gradient(90deg, var(--accent-primary) 1px, transparent 1px)', backgroundSize: '28px 28px', maskImage: 'radial-gradient(ellipse at 80% 20%, black, transparent 75%)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[0.16] blur-2xl" style={{ background: 'radial-gradient(220px circle at var(--git-mouse-x, 85%) var(--git-mouse-y, 10%), var(--accent-primary), transparent)' }} />
      <div className="flex items-start gap-3">
        {ended ? <CheckCircle size={22} className="shrink-0 text-accent-primary" /> : <GitMerge size={22} className="shrink-0 text-accent-primary" />}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Git recovery · {r.action} · {r.branch || 'Detached HEAD'}</p>
          <p className="mt-1 text-sm font-medium">{ended ? (r.state === 'completed' ? 'Operation finished' : 'Operation aborted') : r.canRetry ? 'Ready when you are' : r.state === 'implementing' ? 'Resolving with your approved plan' : 'Your Git operation needs attention'}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary" role="status">{busy ? 'Working on the pending Git operation…' : resolving ? 'Preparing the resolution session…' : r.reason || (r.canRetry ? `Resolution ready. Retry to ${r.step === 'push' ? 'confirm the Push' : 'continue the ' + (r.operation?.kind || r.step)}.` : 'Conflicts resolved. Retry unlocks once the resolution checks pass.')}</p>
        </div>
      </div>
      {resolving && (
        <div className="mt-3 h-px overflow-hidden bg-white/[0.065]" aria-hidden="true">
          <motion.div
            className="h-full w-1/3 bg-accent-primary"
            initial={reduced ? { x: '100%' } : { x: '-110%' }}
            animate={{ x: reduced ? '100%' : '310%' }}
            transition={reduced ? { duration: 0 } : { duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>
      )}
      {error && <p role="alert" className="mt-3 flex gap-2 text-xs text-red-300"><Warning size={14} className="shrink-0" />{error}</p>}
      {!ended && (confirm ? (
        <div className="mt-4" role="alertdialog" aria-label={confirm === 'abort' ? 'Confirm abort' : 'Confirm integration'}>
          <p className="text-xs leading-relaxed text-text-secondary">{confirm === 'abort' ? r.operation ? 'Abort may discard the AI resolution and other changes made during this operation. No backup will be created. Git may be unable to restore earlier uncommitted changes.' : 'End this pending attempt? Your local commits will be preserved.' : 'Pull with rebase from the recorded remote? This reapplies local commits and may require another conflict resolution. Push will still need your confirmation.'}</p>
          <div className="mt-3 flex justify-end gap-2"><button className={button} onClick={() => setConfirm(null)}>Cancel</button><button className={`${button} ${confirm === 'abort' ? 'bg-red-500/15 text-red-300' : 'bg-accent-primary/15 text-accent-primary'}`} disabled={busy} onClick={() => void perform(confirm === 'abort' ? 'cancelRecovery' : 'retryOperation', confirm === 'pull')}>{confirm === 'abort' ? 'Confirm Abort' : 'Pull with rebase'}</button></div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {r.canResolve && onResolve && <button className={`${button} flex items-center gap-2 text-text-secondary`} disabled={busy || resolving} onClick={resolve}><CircleNotch size={14} className={resolving && !reduced ? 'animate-spin' : 'hidden'} />{resolving ? 'Preparing…' : 'Resolve with AI'}</button>}
          {r.needsPull && <button className={`${button} text-accent-primary`} disabled={busy} onClick={() => setConfirm('pull')}>Pull with rebase</button>}
          <button className={`${button} text-text-secondary hover:bg-white/5`} disabled={busy || !r.canAbort} onClick={() => setConfirm('abort')}>Abort</button>
          <button className={`${button} flex items-center gap-2 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25`} title={!r.canRetry ? r.reason : undefined} disabled={busy || !r.canRetry} onClick={() => void perform('retryOperation')}><ArrowClockwise size={14} className={busy && !reduced ? 'animate-spin' : ''} />{busy ? 'Working…' : 'Retry'}</button>
        </div>
      ))}
    </motion.div>
  )
}
