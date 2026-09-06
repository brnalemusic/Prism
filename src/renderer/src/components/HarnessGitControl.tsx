import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  CloudArrowDown,
  CloudArrowUp,
  File,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Sparkle,
  Trash,
  Warning,
  X
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type { HarnessGitAction, HarnessGitSnapshot, HarnessGitStatusDelta } from '../../../shared/types'

interface HarnessGitControlProps {
  projectPath?: string
  modelKey: string
  onResolveConflict: (snapshot: HarnessGitSnapshot) => void
  onOpenProject: (path: string) => void
}

interface PickerOption {
  value: string
  label: string
  detail?: string
  remote?: boolean
}

interface PickerProps {
  value: string
  placeholder: string
  options: PickerOption[]
  disabled?: boolean
  onSelect: (value: string) => void
}

type DialogKind = 'create' | 'rename' | 'merge' | 'delete' | 'deleteRemote' | 'reset' | 'pr'

interface DialogValues {
  name: string
  branch: string
  confirmation: string
  resetMode: 'soft' | 'hard'
  forceDelete: boolean
  title: string
  body: string
  base: string
}

const BRENO_CO_AUTHOR = {
  name: 'Breno Alexandrē',
  email: 'brenoalexandre.music@gmail.com'
}
const REFRESH_INTERVAL_MS = 2_500
const PANEL_GAP = 8
const PANEL_MARGIN = 12
const PANEL_MAX_WIDTH = 420
const PANEL_MAX_HEIGHT = 660
const PANEL_BOTTOM_OVERHANG = 48
const UNAVAILABLE_SNAPSHOT_THRESHOLD = 3
const PANEL_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const }

function shortName(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function statusLabel(indexStatus: string, workTreeStatus: string): string {
  if (`${indexStatus}${workTreeStatus}` === '??') return 'U'
  return workTreeStatus.trim() || indexStatus.trim() || 'M'
}
function sameHarnessGitFile(left: HarnessGitSnapshot['files'][number], right: HarnessGitSnapshot['files'][number]): boolean {
  return left.path === right.path &&
    left.indexStatus === right.indexStatus &&
    left.workTreeStatus === right.workTreeStatus &&
    left.isUntracked === right.isUntracked &&
    left.isConflicted === right.isConflicted
}

function reconcileHarnessGitFiles(previous: HarnessGitSnapshot['files'], next: HarnessGitStatusDelta['files']): HarnessGitSnapshot['files'] {
  if (previous.length === next.length && previous.every((file, index) => sameHarnessGitFile(file, next[index]))) return previous
  const previousByPath = new Map(previous.map((file) => [file.path, file]))
  return next.map((file) => {
    const previousFile = previousByPath.get(file.path)
    return previousFile && sameHarnessGitFile(previousFile, file) ? previousFile : file
  })
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameHarnessGitOperation(left: HarnessGitSnapshot['operation'], right: HarnessGitStatusDelta['operation']): boolean {
  return left?.kind === right?.kind && left?.target === right?.target
}

function CustomPicker({ value, placeholder, options, disabled, onSelect }: PickerProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? options.filter((option) => `${option.label} ${option.detail || ''}`.toLowerCase().includes(normalized))
      : options
  }, [options, query])

  const updateMenuPosition = useCallback((): void => {
    const picker = pickerRef.current
    if (!picker) return
    const rect = picker.getBoundingClientRect()
    const top = rect.bottom + 6
    setMenuPosition({
      left: Math.min(Math.max(PANEL_MARGIN, rect.left), window.innerWidth - rect.width - PANEL_MARGIN),
      top,
      width: rect.width,
      maxHeight: Math.max(96, Math.min(224, window.innerHeight - top - PANEL_MARGIN))
    })
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    updateMenuPosition()
    const observer = new ResizeObserver(updateMenuPosition)
    if (pickerRef.current) observer.observe(pickerRef.current)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) return
    requestAnimationFrame(() => searchRef.current?.focus())
    const close = (): void => {
      setIsOpen(false)
      setQuery('')
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!pickerRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      close()
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [isOpen])

  const menu = createPortal(
    <AnimatePresence initial={false}>
      {isOpen && menuPosition && (
        <motion.div
          ref={menuRef}
          data-harness-git-layer
          initial={{ opacity: 0, y: -4, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -3, scale: 0.99 }}
          transition={PANEL_TRANSITION}
          style={menuPosition}
          className="fixed z-[150] flex flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[0_14px_38px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.035)]"
        >
          <label className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border-default)] px-2.5 text-text-muted">
            <MagnifyingGlass size={12} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && filtered[0]) {
                  onSelect(filtered[0].value)
                  setIsOpen(false)
                  setQuery('')
                }
              }}
              placeholder="Filter branches"
              className="min-w-0 flex-1 bg-transparent text-[10.5px] text-text-primary outline-none placeholder:text-text-muted/65"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto p-1 custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="px-2 py-4 text-center text-[10px] text-text-muted">No matching branches</div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onSelect(option.value)
                    setIsOpen(false)
                    setQuery('')
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:bg-white/[0.08]',
                    option.value === value
                      ? 'bg-accent-primary/[0.1] text-text-primary'
                      : 'text-text-secondary hover:bg-white/[0.055] hover:text-text-primary'
                  )}
                >
                  {option.remote ? <Globe size={12} className="shrink-0 text-text-muted" /> : <GitBranch size={12} className="shrink-0 text-text-muted" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{option.label}</span>
                  {option.detail && <span className="max-w-28 truncate text-[9px] text-text-muted">{option.detail}</span>}
                  {option.value === value && <Check size={11} weight="bold" className="shrink-0 text-accent-primary" />}
                </button>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setIsOpen((current) => !current)
          if (isOpen) setQuery('')
          else requestAnimationFrame(updateMenuPosition)
        }}
        aria-expanded={isOpen}
        className={clsx(
          'flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 active:scale-[0.99]',
          isOpen
            ? 'border-accent-primary/45 bg-accent-primary/[0.08]'
            : 'border-[var(--border-default)] bg-[var(--surface-lowest)] hover:border-white/[0.16] hover:bg-[var(--surface-raised)]',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <GitBranch size={13} weight="bold" className="shrink-0 text-accent-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-text-primary">
          {selected?.label || placeholder}
        </span>
        {selected?.detail && <span className="max-w-24 truncate text-[9px] text-text-muted">{selected.detail}</span>}
        <CaretDown size={10} weight="bold" className={clsx('shrink-0 text-text-muted transition-transform', isOpen && 'rotate-180')} />
      </button>
      {menu}
    </div>
  )
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="group flex items-center gap-1.5 text-[9.5px] text-text-muted hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70">
      <span className={clsx('flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors', checked ? 'border-accent-primary bg-accent-primary text-black' : 'border-white/[0.18] bg-[var(--surface-lowest)] group-hover:border-white/[0.3]')}>
        {checked && <Check size={9} weight="bold" />}
      </span>
      {label}
    </button>
  )
}

export function HarnessGitControl({ projectPath, modelKey, onResolveConflict, onOpenProject }: HarnessGitControlProps): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<HarnessGitSnapshot | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [includeCoAuthor, setIncludeCoAuthor] = useState(true)
  const [signoff, setSignoff] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [dialogValues, setDialogValues] = useState<DialogValues>({ name: '', branch: '', confirmation: '', resetMode: 'soft', forceDelete: false, title: '', body: '', base: '' })
  const [panelPosition, setPanelPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number; side: 'left' | 'right' } | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const refreshInFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const snapshotRef = useRef<HarnessGitSnapshot | null>(null)
  const snapshotSignatureRef = useRef('')
  const unavailableSnapshotCountRef = useRef(0)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    pendingRef.current = pending !== null
  }, [pending])

  const applySnapshot = useCallback((next: HarnessGitSnapshot): void => {
    const previous = snapshotRef.current
    const sameProject = previous?.projectPath.toLowerCase() === next.projectPath.toLowerCase()
    if (sameProject && previous?.isGit && !next.isGit) {
      unavailableSnapshotCountRef.current += 1
      if (unavailableSnapshotCountRef.current < UNAVAILABLE_SNAPSHOT_THRESHOLD) return
    } else {
      unavailableSnapshotCountRef.current = 0
    }
    const signature = JSON.stringify(next)
    if (signature === snapshotSignatureRef.current) return
    snapshotSignatureRef.current = signature
    snapshotRef.current = next
    setSnapshot(next)
  }, [])


  const applyStatusDelta = useCallback((next: HarnessGitStatusDelta): boolean => {
    const previous = snapshotRef.current
    if (!previous || !previous.isGit || !next.isGit) return false
    if (previous.projectPath.toLowerCase() !== next.projectPath.toLowerCase()) return false
    if (previous.repoRoot?.toLowerCase() !== next.repoRoot?.toLowerCase()) return false
    if (previous.metadataFingerprint !== next.metadataFingerprint) return false

    const files = reconcileHarnessGitFiles(previous.files, next.files)
    const conflicts = sameStringArray(previous.conflicts, next.conflicts) ? previous.conflicts : next.conflicts
    const operation = sameHarnessGitOperation(previous.operation, next.operation) ? previous.operation : next.operation
    const changed =
      previous.ok !== next.ok ||
      previous.branch !== next.branch ||
      previous.detached !== next.detached ||
      previous.upstream !== next.upstream ||
      previous.ahead !== next.ahead ||
      previous.behind !== next.behind ||
      files !== previous.files ||
      conflicts !== previous.conflicts ||
      operation !== previous.operation ||
      previous.error !== next.error
    if (!changed) return true

    const merged: HarnessGitSnapshot = {
      ...previous,
      ok: next.ok,
      projectPath: next.projectPath,
      repoRoot: next.repoRoot,
      isGit: next.isGit,
      headHash: next.headHash,
      metadataFingerprint: next.metadataFingerprint,
      branch: next.branch,
      detached: next.detached,
      upstream: next.upstream,
      ahead: next.ahead,
      behind: next.behind,
      files,
      conflicts,
      operation,
      error: next.error
    }
    snapshotRef.current = merged
    snapshotSignatureRef.current = JSON.stringify(merged)
    setSnapshot(merged)
    return true
  }, [])

  const updatePanelPosition = useCallback((): void => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth - PANEL_MARGIN * 2)
    const spaceRight = window.innerWidth - rect.right - PANEL_MARGIN - PANEL_GAP
    const spaceLeft = rect.left - PANEL_MARGIN - PANEL_GAP
    const side = spaceRight >= width || spaceRight >= spaceLeft ? 'right' : 'left'
    const left = side === 'right'
      ? Math.min(rect.right + PANEL_GAP, window.innerWidth - width - PANEL_MARGIN)
      : Math.max(PANEL_MARGIN, rect.left - width - PANEL_GAP)
    const bottom = Math.max(PANEL_MARGIN, window.innerHeight - rect.bottom - PANEL_BOTTOM_OVERHANG)
    const maxHeight = Math.min(
      PANEL_MAX_HEIGHT,
      Math.max(160, window.innerHeight - bottom - PANEL_MARGIN)
    )
    setPanelPosition({
      left,
      bottom,
      width,
      maxHeight,
      side
    })
  }, [])

  const refresh = useCallback(async (showLoading = false): Promise<void> => {
    if (!projectPath || refreshInFlightRef.current || pendingRef.current || document.hidden) return
    refreshInFlightRef.current = true
    if (showLoading && !snapshotRef.current) setIsInitialLoading(true)
    try {
      const previous = snapshotRef.current
      if (showLoading || !previous) {
        applySnapshot(await window.api.getHarnessGitStatus(projectPath))
      } else {
        const delta = await window.api.getHarnessGitStatusDelta(projectPath)
        const metadataChanged =
          !delta.isGit ||
          !previous.isGit ||
          previous.projectPath.toLowerCase() !== delta.projectPath.toLowerCase() ||
          previous.repoRoot?.toLowerCase() !== delta.repoRoot?.toLowerCase() ||
          previous.metadataFingerprint !== delta.metadataFingerprint
        if (metadataChanged) applySnapshot(await window.api.getHarnessGitStatus(projectPath))
        else applyStatusDelta(delta)
      }
    } catch (error) {
      if (showLoading && !snapshotRef.current) {
        setNotice({ tone: 'error', text: errorMessage(error, 'Could not read Git status.') })
      }
    } finally {
      refreshInFlightRef.current = false
      setIsInitialLoading(false)
    }
  }, [applySnapshot, applyStatusDelta, projectPath])

  useEffect(() => {
    snapshotRef.current = null
    snapshotSignatureRef.current = ''
    unavailableSnapshotCountRef.current = 0
    const frame = requestAnimationFrame(() => {
      setMessage('')
      setNotice(null)
      setSnapshot(null)
      setDialog(null)
      void refresh(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [projectPath, refresh])

  useEffect(() => {
    if (!projectPath) return
    const interval = window.setInterval(() => void refresh(false), REFRESH_INTERVAL_MS)
    const onFocus = (): void => void refresh(false)
    const onVisibility = (): void => { if (!document.hidden) void refresh(false) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [projectPath, refresh])

  useLayoutEffect(() => {
    if (!isOpen) return
    updatePanelPosition()
    const observer = new ResizeObserver(updatePanelPosition)
    if (anchorRef.current) observer.observe(anchorRef.current)
    window.addEventListener('resize', updatePanelPosition)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePanelPosition)
    }
  }, [isOpen, updatePanelPosition])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      const element = target instanceof Element ? target : null
      if (!anchorRef.current?.contains(target) && !element?.closest('[data-harness-git-layer]')) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (dialog) setDialog(null)
      else setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dialog, isOpen])

  useLayoutEffect(() => {
    const element = messageRef.current
    if (!element) return
    element.style.height = '0px'
    const contentHeight = Math.max(element.scrollHeight, 34)
    element.style.height = `${Math.min(contentHeight, 300)}px`
    element.style.overflowY = contentHeight > 300 ? 'auto' : 'hidden'
  }, [dialog, isOpen, message])

  const runAction = useCallback(async (action: HarnessGitAction, label: string): Promise<boolean> => {
    if (!projectPath || pendingRef.current) return false
    pendingRef.current = true
    setPending(label)
    setNotice(null)
    try {
      const result = await window.api.runHarnessGitAction(projectPath, action)
      applySnapshot(result.snapshot)
      if (!result.ok) {
        setNotice({ tone: 'error', text: result.error || 'Git operation failed.' })
        return false
      }
      setNotice({ tone: 'success', text: result.prUrl ? `Pull request created: ${result.prUrl}` : `${label} completed.` })
      window.setTimeout(() => void refresh(false), 350)
      return true
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, 'Git operation failed.') })
      return false
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }, [applySnapshot, projectPath, refresh])

  const commit = useCallback(async (): Promise<void> => {
    if (!projectPath || pendingRef.current) return
    pendingRef.current = true
    let nextMessage = message.trim()
    setPending(nextMessage ? 'Commit' : 'Generate message')
    setNotice(null)
    try {
      if (!nextMessage) {
        nextMessage = await window.api.generateHarnessGitCommitMessage(projectPath, modelKey)
        setPending('Commit')
      }
      const result = await window.api.runHarnessGitAction(projectPath, {
        kind: 'commit',
        options: {
          message: nextMessage,
          sign: snapshot?.signing.enabled,
          signoff,
          coAuthor: includeCoAuthor ? BRENO_CO_AUTHOR : undefined
        }
      })
      applySnapshot(result.snapshot)
      if (!result.ok) throw new Error(result.error || 'Commit failed.')
      setMessage('')
      setNotice({ tone: 'success', text: 'Commit created.' })
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, 'Commit failed.') })
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }, [applySnapshot, includeCoAuthor, message, modelKey, projectPath, signoff, snapshot])

  const generateMessage = useCallback(async (): Promise<void> => {
    if (!projectPath || pendingRef.current) return
    pendingRef.current = true
    setPending('Generate message')
    setNotice(null)
    try {
      setMessage(await window.api.generateHarnessGitCommitMessage(projectPath, modelKey))
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, 'Could not generate a commit message.') })
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }, [modelKey, projectPath])

  const localBranches = useMemo(() => snapshot?.branches.filter((branch) => !branch.isRemote) || [], [snapshot?.branches])
  const remoteBranches = useMemo(() => snapshot?.branches.filter((branch) => branch.isRemote) || [], [snapshot?.branches])
  const branchOptions = useMemo<PickerOption[]>(() => snapshot?.branches.map((branch) => ({ value: branch.fullName, label: branch.isRemote ? branch.fullName : branch.name, detail: branch.isCurrent ? 'current' : branch.upstream, remote: branch.isRemote })) || [], [snapshot?.branches])
  const localOptions = useMemo<PickerOption[]>(() => localBranches.map((branch) => ({ value: branch.name, label: branch.name, detail: branch.isCurrent ? 'current' : branch.upstream })), [localBranches])
  const remoteOptions = useMemo<PickerOption[]>(() => remoteBranches.map((branch) => ({ value: branch.fullName, label: branch.fullName, remote: true })), [remoteBranches])
  const commitOptions = useMemo<PickerOption[]>(() => snapshot?.commits.map((commit) => ({ value: commit.hash, label: commit.shortHash, detail: commit.subject })) || [], [snapshot?.commits])

  const openDialog = (kind: DialogKind): void => {
    const firstMerge = localBranches.find((branch) => !branch.isCurrent)?.name || ''
    const firstDelete = localBranches.find((branch) => !branch.isCurrent)?.name || ''
    setDialogValues({
      name: kind === 'rename' ? snapshot?.branch || '' : '',
      branch: kind === 'merge' ? firstMerge : kind === 'delete' ? firstDelete : kind === 'deleteRemote' ? remoteBranches[0]?.fullName || '' : kind === 'reset' ? snapshot?.commits[0]?.hash || '' : '',
      confirmation: '',
      resetMode: 'soft',
      forceDelete: false,
      title: '',
      body: '',
      base: snapshot?.defaultBranch || 'main'
    })
    setDialog(kind)
  }

  const executeDialog = async (): Promise<void> => {
    if (!dialog) return
    let action: HarnessGitAction
    let label: string
    if (dialog === 'create') {
      action = { kind: 'createBranch', name: dialogValues.name }
      label = 'Create branch'
    } else if (dialog === 'rename') {
      action = { kind: 'renameBranch', from: snapshot?.branch || '', to: dialogValues.name }
      label = 'Rename branch'
    } else if (dialog === 'merge') {
      action = { kind: 'merge', branch: dialogValues.branch }
      label = 'Merge branch'
    } else if (dialog === 'delete') {
      action = { kind: 'deleteBranch', name: dialogValues.branch, force: dialogValues.forceDelete }
      label = 'Delete branch'
    } else if (dialog === 'deleteRemote') {
      const [remote, ...branchParts] = dialogValues.branch.split('/')
      action = { kind: 'deleteBranch', remote, name: branchParts.join('/') }
      label = 'Delete remote branch'
    } else if (dialog === 'reset') {
      action = { kind: 'reset', hash: dialogValues.branch, mode: dialogValues.resetMode }
      label = `${dialogValues.resetMode === 'hard' ? 'Hard' : 'Soft'} reset`
    } else {
      action = { kind: 'createPr', title: dialogValues.title, body: dialogValues.body, base: dialogValues.base }
      label = 'Create pull request'
    }
    if (await runAction(action, label)) setDialog(null)
  }

  if (!projectPath) return null
  const isBusy = pending !== null
  const isGeneratingMessage = pending === 'Generate message'
  const hasConflict = Boolean(snapshot?.operation || snapshot?.conflicts.length)
  const branchLabel = snapshot?.branch || (snapshot?.detached ? 'Detached HEAD' : 'Git')
  const expectedConfirmation = dialog === 'merge' || dialog === 'delete' || dialog === 'deleteRemote'
    ? dialogValues.branch
    : dialog === 'reset'
      ? snapshot?.commits.find((commit) => commit.hash === dialogValues.branch)?.shortHash || dialogValues.branch
      : ''
  const requiresConfirmation = dialog === 'merge' || dialog === 'delete' || dialog === 'deleteRemote' || dialog === 'reset'
  const dialogCanSubmit = dialog === 'create' || dialog === 'rename'
    ? Boolean(dialogValues.name.trim())
    : dialog === 'pr'
      ? Boolean(dialogValues.title.trim() && dialogValues.base.trim())
      : Boolean(dialogValues.branch && dialogValues.confirmation === expectedConfirmation)

  const panel = isOpen && panelPosition
    ? createPortal(
        <AnimatePresence initial={false}>
          <motion.section
            ref={panelRef}
            data-harness-git-layer
            initial={reduceMotion ? false : { opacity: 0, x: panelPosition.side === 'right' ? -6 : 6, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: panelPosition.side === 'right' ? -5 : 5, scale: 0.99 }}
            transition={PANEL_TRANSITION}
            style={{ left: panelPosition.left, bottom: panelPosition.bottom, width: panelPosition.width, maxHeight: panelPosition.maxHeight }}
            role="dialog"
            aria-label="Git Control"
            aria-busy={isGeneratingMessage}
            className="fixed z-[130] flex overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-primary shadow-[0_24px_64px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.035)]"
          >
            <div className="flex min-h-0 w-full flex-col">
              <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-default)] px-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-primary/[0.1] text-accent-primary"><GitBranch size={13} weight="bold" /></div>
                <div className="min-w-0 flex-1"><div className="truncate font-mono text-[10.5px] font-semibold">{branchLabel}</div><div className="truncate text-[9px] text-text-muted">{shortName(projectPath)}{snapshot?.upstream ? `  /  ${snapshot.upstream}` : ''}</div></div>
                <button type="button" disabled={isGeneratingMessage} onClick={() => void refresh(false)} className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-35" aria-label="Refresh Git status"><ArrowClockwise size={13} /></button>
                <button type="button" onClick={() => setIsOpen(false)} className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary active:scale-95" aria-label="Close Git Control"><X size={13} /></button>
              </header>

              <AnimatePresence initial={false}>
                {isGeneratingMessage && (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.16 }}
                    role="status"
                    aria-live="polite"
                    className="absolute inset-x-0 top-11 bottom-0 z-30 grid place-items-center bg-[var(--surface-lowest)] px-8"
                  >
                    <div className="w-full max-w-[17rem]">
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-primary/[0.1] text-accent-primary shadow-[inset_0_0_0_1px_rgba(168,85,247,0.18)]">
                          <Sparkle size={14} weight="fill" />
                        </div>
                        <div className="min-w-0 text-left">
                          <p className="text-[11px] font-semibold leading-4 text-text-primary">Generating commit message</p>
                          <p className="mt-0.5 text-[9.5px] leading-4 text-text-muted">Git operations are paused until the draft is ready.</p>
                        </div>
                      </div>
                      <div className="mt-3 h-px overflow-hidden bg-white/[0.065]">
                        <motion.div
                          className="h-full w-1/3 bg-accent-primary"
                          initial={reduceMotion ? { x: '100%' } : { x: '-110%' }}
                          animate={{ x: reduceMotion ? '100%' : '310%' }}
                          transition={reduceMotion ? { duration: 0 } : { duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="min-h-0 flex-1 overflow-y-auto p-2.5 custom-scrollbar">
                {isInitialLoading && !snapshot && <div className="space-y-2 py-1"><div className="h-8 animate-pulse rounded-lg bg-white/[0.05]" /><div className="h-16 animate-pulse rounded-lg bg-white/[0.035]" /><div className="h-28 animate-pulse rounded-lg bg-white/[0.03]" /></div>}
                {!isInitialLoading && !snapshot && <div className="py-10 text-center text-[10.5px] text-text-muted">Git status is unavailable.</div>}
                {snapshot && !snapshot.isGit && <div className="flex flex-col items-center px-4 py-10 text-center"><GitBranch size={22} className="mb-2 text-text-muted" /><p className="text-[11px] font-medium text-text-secondary">No Git repository</p><p className="mt-1 max-w-64 text-[9.5px] leading-relaxed text-text-muted">{snapshot.error}</p></div>}

                {snapshot?.isGit && !dialog && (
                  <>
                    <div className="grid grid-cols-[1fr_auto] gap-1.5">
                      <CustomPicker value={snapshot.branch || ''} placeholder="Choose branch" options={branchOptions} disabled={isBusy || snapshot.detached} onSelect={(branch) => { if (branch !== snapshot.branch) void runAction({ kind: 'switchBranch', name: branch }, 'Switch branch') }} />
                      <button type="button" onClick={() => openDialog('create')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary active:scale-95" title="Create branch"><Plus size={13} /></button>
                    </div>

                    <div className="mt-2 flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-1 py-1">
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'sync' }, 'Sync')} className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent-primary/[0.12] text-[10px] font-semibold text-accent-primary transition-colors hover:bg-accent-primary/[0.19] disabled:opacity-45 active:scale-[0.99]">{pending === 'Sync' ? <CircleNotch size={12} className="animate-spin" /> : <ArrowClockwise size={12} />}Sync</button>
                      <div className="mx-1 h-4 w-px bg-[var(--border-default)]" />
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'pull' }, 'Pull')} className="flex h-7 items-center gap-1 rounded-md px-2 text-[9.5px] text-text-secondary transition-colors hover:bg-white/[0.055] hover:text-text-primary disabled:opacity-45 active:scale-95" title="Pull with rebase"><CloudArrowDown size={12} />Pull</button>
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'push' }, 'Push')} className="flex h-7 items-center gap-1 rounded-md px-2 text-[9.5px] text-text-secondary transition-colors hover:bg-white/[0.055] hover:text-text-primary disabled:opacity-45 active:scale-95" title="Push"><CloudArrowUp size={12} />Push</button>
                      <button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'fetch' }, 'Fetch')} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.055] hover:text-text-primary disabled:opacity-45 active:scale-95" title="Fetch"><ArrowClockwise size={12} /></button>
                    </div>

                    <div className="mt-2 flex h-7 items-center gap-3 border-y border-[var(--border-default)] px-1 font-mono text-[9.5px] text-text-muted">
                      <span><strong className="font-semibold text-text-primary">{snapshot.files.length}</strong> changes</span>
                      <span className="flex items-center gap-0.5"><ArrowUp size={10} />{snapshot.ahead}</span>
                      <span className="flex items-center gap-0.5"><ArrowDown size={10} />{snapshot.behind}</span>
                      {snapshot.conflicts.length > 0 && <span className="ml-auto text-amber-300">{snapshot.conflicts.length} conflicts</span>}
                    </div>

                    {hasConflict ? (
                      <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-2.5">
                        <div className="flex items-start gap-2"><Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-amber-400" /><div><p className="text-[10.5px] font-semibold text-amber-200">{snapshot.operation ? `${snapshot.operation.kind} paused` : 'Conflicts need resolution'}</p><p className="mt-0.5 text-[9.5px] leading-relaxed text-amber-100/65">{snapshot.conflicts.slice(0, 4).join(', ') || 'Git has a pending operation.'}</p></div></div>
                        <div className="mt-2 flex gap-1.5"><button type="button" disabled={isBusy} onClick={() => void runAction({ kind: 'abortOperation' }, 'Abort')} className="rounded-md border border-amber-400/25 px-2 py-1 text-[9.5px] text-amber-100 hover:bg-amber-400/10 disabled:opacity-45">Abort</button><button type="button" onClick={() => onOpenProject(projectPath)} className="rounded-md border border-white/[0.1] px-2 py-1 text-[9.5px] text-text-secondary hover:bg-white/[0.055]">Open project</button><button type="button" onClick={() => onResolveConflict(snapshot)} className="ml-auto rounded-md bg-accent-primary/[0.14] px-2 py-1 text-[9.5px] font-semibold text-accent-primary hover:bg-accent-primary/[0.22]">Resolve with AI</button></div>
                      </div>
                    ) : (
                      <>
                        <section className="mt-2">
                          <div className="mb-1 flex items-center justify-between px-1"><span className="text-[9.5px] font-semibold text-text-secondary">Changes</span><span className="font-mono text-[9px] text-text-muted">{snapshot.files.length}</span></div>
                          {snapshot.files.length === 0 ? <div className="flex h-12 items-center justify-center rounded-lg bg-[var(--surface)] text-[9.5px] text-text-muted"><CheckCircle size={12} className="mr-1.5 text-emerald-400/75" />Working tree clean</div> : <div className="max-h-36 overflow-y-auto rounded-lg bg-[var(--surface)] p-1 custom-scrollbar">{snapshot.files.slice(0, 18).map((file) => <div key={file.path} className="flex h-6 items-center gap-2 rounded px-1.5 text-[9.5px] hover:bg-white/[0.045]"><File size={11} className="shrink-0 text-text-muted" /><span className="min-w-0 flex-1 truncate font-mono text-text-secondary" title={file.path}>{file.path}</span><span className={clsx('w-3 text-center font-mono font-semibold', file.isConflicted ? 'text-amber-300' : 'text-accent-primary')}>{statusLabel(file.indexStatus, file.workTreeStatus)}</span></div>)}</div>}
                        </section>

                        <section className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface)] p-2">
                          <div className="flex items-start gap-1"><textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void commit() } }} rows={1} placeholder="Commit message" aria-label="Commit message" className="min-h-[34px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[10.5px] leading-4 text-text-primary outline-none placeholder:text-text-muted/60" /><button type="button" disabled={isBusy || snapshot.files.length === 0} onClick={() => void generateMessage()} className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-white/[0.055] hover:text-accent-primary disabled:opacity-40 active:scale-95" title="Generate an editable commit message"><Sparkle size={13} /></button></div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border-default)] pt-1.5"><Toggle checked={signoff} label="Sign-off" onChange={setSignoff} /><Toggle checked={includeCoAuthor} label="Breno as co-author" onChange={setIncludeCoAuthor} /><button type="button" disabled={isBusy || snapshot.files.length === 0} onClick={() => void commit()} className="ml-auto flex h-6 items-center gap-1 rounded-md bg-white/[0.085] px-2 text-[9.5px] font-semibold text-text-primary transition-colors hover:bg-white/[0.13] disabled:opacity-40 active:scale-95">{pending === 'Commit' ? <CircleNotch size={11} className="animate-spin" /> : <GitCommit size={11} />}Commit</button></div>
                        </section>

                        <section className="mt-2 grid grid-cols-4 gap-1">
                          <button type="button" onClick={() => openDialog('rename')} disabled={!snapshot.branch || isBusy} className="flex h-8 items-center justify-center gap-1 rounded-md bg-[var(--surface)] text-[9px] text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary disabled:opacity-40"><PencilSimple size={11} />Rename</button>
                          <button type="button" onClick={() => openDialog('merge')} disabled={localBranches.length < 2 || isBusy} className="flex h-8 items-center justify-center gap-1 rounded-md bg-[var(--surface)] text-[9px] text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary disabled:opacity-40"><GitMerge size={11} />Merge</button>
                          <button type="button" onClick={() => openDialog('reset')} disabled={snapshot.commits.length === 0 || isBusy} className="flex h-8 items-center justify-center gap-1 rounded-md bg-[var(--surface)] text-[9px] text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary disabled:opacity-40"><ArrowCounterClockwise size={11} />Reset</button>
                          <button type="button" onClick={() => openDialog(snapshot.branch === 'main' || snapshot.branch === 'master' ? 'create' : 'pr')} disabled={!snapshot.branch || isBusy} className="flex h-8 items-center justify-center gap-1 rounded-md bg-[var(--surface)] text-[9px] text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary disabled:opacity-40"><GitPullRequest size={11} />PR</button>
                        </section>
                        <div className="mt-1 grid grid-cols-2 gap-1"><button type="button" onClick={() => openDialog('delete')} disabled={localBranches.filter((branch) => !branch.isCurrent).length === 0 || isBusy} className="flex h-7 items-center justify-center gap-1 rounded-md text-[9px] text-red-300/75 transition-colors hover:bg-red-500/[0.08] hover:text-red-200 disabled:opacity-35"><Trash size={10} />Delete local branch</button><button type="button" onClick={() => openDialog('deleteRemote')} disabled={remoteBranches.length === 0 || isBusy} className="flex h-7 items-center justify-center gap-1 rounded-md text-[9px] text-red-300/75 transition-colors hover:bg-red-500/[0.08] hover:text-red-200 disabled:opacity-35"><Globe size={10} />Delete remote branch</button></div>
                      </>
                    )}
                  </>
                )}

                {snapshot?.isGit && dialog && (
                  <motion.div key={dialog} initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={PANEL_TRANSITION}>
                    <div className="mb-3 flex items-center gap-2"><button type="button" onClick={() => setDialog(null)} className="rounded-md p-1 text-text-muted hover:bg-white/[0.055] hover:text-text-primary"><ArrowCounterClockwise size={12} /></button><h3 className="text-[11px] font-semibold text-text-primary">{{ create: 'Create branch', rename: 'Rename current branch', merge: 'Merge branch', delete: 'Delete local branch', deleteRemote: 'Delete remote branch', reset: 'Reset to commit', pr: 'Create pull request' }[dialog]}</h3></div>
                    <div className="space-y-2.5">
                      {(dialog === 'create' || dialog === 'rename') && <label className="block"><span className="mb-1 block text-[9.5px] text-text-muted">Branch name</span><input autoFocus value={dialogValues.name} onChange={(event) => setDialogValues((current) => ({ ...current, name: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && dialogCanSubmit) void executeDialog() }} className="h-8 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-2.5 font-mono text-[10.5px] text-text-primary outline-none focus:border-accent-primary/50" /></label>}
                      {dialog === 'merge' && <>
                        <div className="rounded-lg border border-accent-primary/15 bg-accent-primary/[0.05] px-2.5 py-2 text-[9.5px] leading-relaxed">
                          <p className="font-semibold text-text-primary">Merge into the current branch</p>
                          <p className="mt-1 text-text-muted">The selected branch is merged into the branch that is currently checked out. Prism does not switch branches.</p>
                          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 font-mono text-[9px]">
                            <span className="text-text-muted">Destination</span><span className="truncate text-text-secondary">{snapshot.branch || 'Detached HEAD'}</span>
                            <span className="text-text-muted">Source</span><span className="truncate text-text-secondary">{dialogValues.branch || 'Choose a branch below'}</span>
                          </div>
                        </div>
                        <CustomPicker value={dialogValues.branch} placeholder="Branch to merge" options={localOptions.filter((option) => option.value !== snapshot.branch)} onSelect={(branch) => setDialogValues((current) => ({ ...current, branch, confirmation: '' }))} />
                      </>}
                      {dialog === 'delete' && <><CustomPicker value={dialogValues.branch} placeholder="Local branch" options={localOptions.filter((option) => option.value !== snapshot.branch)} onSelect={(branch) => setDialogValues((current) => ({ ...current, branch, confirmation: '' }))} /><Toggle checked={dialogValues.forceDelete} label="Force delete unmerged branch" onChange={(forceDelete) => setDialogValues((current) => ({ ...current, forceDelete }))} /></>}
                      {dialog === 'deleteRemote' && <CustomPicker value={dialogValues.branch} placeholder="Remote branch" options={remoteOptions} onSelect={(branch) => setDialogValues((current) => ({ ...current, branch, confirmation: '' }))} />}
                      {dialog === 'reset' && <><CustomPicker value={dialogValues.branch} placeholder="Commit checkpoint" options={commitOptions} onSelect={(branch) => setDialogValues((current) => ({ ...current, branch, confirmation: '' }))} /><div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface)] p-1"><button type="button" onClick={() => setDialogValues((current) => ({ ...current, resetMode: 'soft' }))} className={clsx('h-7 rounded-md text-[9.5px] transition-colors', dialogValues.resetMode === 'soft' ? 'bg-white/[0.09] text-text-primary' : 'text-text-muted hover:text-text-secondary')}>Soft reset</button><button type="button" onClick={() => setDialogValues((current) => ({ ...current, resetMode: 'hard' }))} className={clsx('h-7 rounded-md text-[9.5px] transition-colors', dialogValues.resetMode === 'hard' ? 'bg-red-500/[0.12] text-red-200' : 'text-text-muted hover:text-text-secondary')}>Hard reset</button></div></>}
                      {dialog === 'pr' && <><label className="block"><span className="mb-1 block text-[9.5px] text-text-muted">Title</span><input autoFocus value={dialogValues.title} onChange={(event) => setDialogValues((current) => ({ ...current, title: event.target.value }))} className="h-8 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-2.5 text-[10.5px] text-text-primary outline-none focus:border-accent-primary/50" /></label><label className="block"><span className="mb-1 block text-[9.5px] text-text-muted">Base branch</span><CustomPicker value={dialogValues.base} placeholder="Base branch" options={localOptions} onSelect={(base) => setDialogValues((current) => ({ ...current, base }))} /></label><label className="block"><span className="mb-1 block text-[9.5px] text-text-muted">Description</span><textarea value={dialogValues.body} onChange={(event) => setDialogValues((current) => ({ ...current, body: event.target.value }))} rows={5} className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-2.5 py-2 text-[10.5px] leading-4 text-text-primary outline-none focus:border-accent-primary/50" /></label>{!snapshot.github.available && <p className="text-[9.5px] text-amber-300">GitHub CLI is not installed.</p>}{snapshot.github.available && !snapshot.github.authenticated && <p className="text-[9.5px] text-amber-300">GitHub CLI is not authenticated.</p>}</>}
                      {requiresConfirmation && <label className="block"><span className="mb-1 block text-[9.5px] text-text-muted">Type <strong className="font-mono text-text-secondary">{expectedConfirmation}</strong> to confirm</span><input value={dialogValues.confirmation} onChange={(event) => setDialogValues((current) => ({ ...current, confirmation: event.target.value }))} className="h-8 w-full rounded-lg border border-red-500/20 bg-red-500/[0.045] px-2.5 font-mono text-[10.5px] text-text-primary outline-none focus:border-red-400/45" /></label>}
                      {dialog === 'pr' && (snapshot.branch === 'main' || snapshot.branch === 'master') && <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-2.5 py-2 text-[9.5px] leading-relaxed text-amber-200">Create and switch to a working branch before opening a pull request.</div>}
                      <div className="flex justify-end gap-1.5 pt-1"><button type="button" onClick={() => setDialog(null)} className="h-7 rounded-md px-2.5 text-[9.5px] text-text-muted hover:bg-white/[0.055] hover:text-text-primary">Cancel</button><button type="button" disabled={!dialogCanSubmit || isBusy || (dialog === 'pr' && (snapshot.branch === 'main' || snapshot.branch === 'master'))} onClick={() => void executeDialog()} className={clsx('h-7 rounded-md px-3 text-[9.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40', dialog === 'delete' || dialog === 'deleteRemote' || (dialog === 'reset' && dialogValues.resetMode === 'hard') ? 'bg-red-500/[0.15] text-red-200 hover:bg-red-500/[0.23]' : 'bg-accent-primary/[0.15] text-accent-primary hover:bg-accent-primary/[0.23]')}>{isBusy ? 'Working...' : 'Confirm'}</button></div>
                    </div>
                  </motion.div>
                )}

                {notice && <div className={clsx('mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[9.5px] leading-relaxed', notice.tone === 'error' ? 'bg-red-500/[0.09] text-red-200' : 'bg-emerald-500/[0.08] text-emerald-200')}><span className="mt-0.5">{notice.tone === 'error' ? <Warning size={11} /> : <CheckCircle size={11} />}</span><span className="min-w-0 flex-1 break-words">{notice.text}</span><button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 text-current/65 hover:text-current"><X size={10} /></button></div>}
              </div>
            </div>
          </motion.section>
        </AnimatePresence>,
        document.body
      )
    : null

  return (
    <div ref={anchorRef} className="relative ml-1.5">
      <button
        type="button"
        onClick={() => {
          setIsOpen((current) => !current)
          setDialog(null)
          requestAnimationFrame(updatePanelPosition)
          void refresh(false)
        }}
        aria-expanded={isOpen}
        className={clsx(
          'group flex h-7 max-w-[300px] items-center gap-1.5 rounded-lg border px-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 active:scale-[0.98]',
          isOpen
            ? 'border-accent-primary/40 bg-accent-primary/[0.1] text-text-primary'
            : 'border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-secondary hover:border-white/[0.16] hover:bg-[var(--surface-raised)] hover:text-text-primary',
          hasConflict && 'border-amber-500/30 bg-amber-500/[0.08] text-amber-200'
        )}
        title={isGeneratingMessage ? 'Generating commit message' : 'Open Git Control'}
      >
        {isGeneratingMessage || (isInitialLoading && !snapshot) ? <CircleNotch size={12} className={clsx('shrink-0 text-accent-primary', !reduceMotion && 'animate-spin')} /> : <GitBranch size={13} weight="bold" className="shrink-0 text-accent-primary" />}
        <span className="min-w-0 max-w-[240px] truncate font-mono text-[10px] font-medium" title={branchLabel}>{branchLabel}</span>
        <CaretRight size={9} weight="bold" className={clsx('ml-auto shrink-0 text-text-muted transition-transform', isOpen && 'rotate-90')} />
      </button>
      {panel}
    </div>
  )
}
