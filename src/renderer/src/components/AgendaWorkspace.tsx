import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowClockwise,
  ArrowRight,
  BookOpen,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  FolderOpen,
  Lightning,
  PaperPlaneTilt,
  Pause,
  Pencil,
  Play,
  Plus,
  Question,
  ShieldCheck,
  Sparkle,
  TerminalWindow,
  Trash,
  Warning,
  X,
  XCircle
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type { AppConfig } from '../../../main/config'
import type {
  AgendaAnchor,
  AgendaRunRecord,
  AgendaRunStatus,
  AgendaSettings,
  AgendaTask
} from '../../../shared/agendaTypes'
import { describeAgendaCadence, describeAgendaAnchor } from '../../../shared/agendaTypes'
import type { McpServerConfig } from '../../../shared/mcpTypes'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function padTime(value: number): string {
  return String(value).padStart(2, '0')
}

const CADENCE_PRESETS: Array<{ label: string; minutes: number | null }> = [
  { label: 'Once', minutes: null },
  { label: 'Every 2 hours', minutes: 120 },
  { label: 'Every 4 hours', minutes: 240 },
  { label: 'Every 8 hours', minutes: 480 },
  { label: 'Every 12 hours', minutes: 720 },
  { label: 'Every day', minutes: 1440 },
  { label: 'Every 3 days', minutes: 4320 },
  { label: 'Every week', minutes: 10080 },
  { label: 'Every 2 weeks', minutes: 20160 },
  { label: 'Every month', minutes: 43200 }
]

const RUN_STATUS_META: Record<AgendaRunStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'text-text-muted' },
  running: { label: 'Running', className: 'text-accent-primary' },
  completed: { label: 'Completed', className: 'text-emerald-300' },
  failed: { label: 'Failed', className: 'text-rose-300' },
  skipped: { label: 'Skipped', className: 'text-amber-300' },
  missed: { label: 'Catch-up', className: 'text-sky-300' },
  interrupted: { label: 'Interrupted', className: 'text-text-muted' },
  stopped: { label: 'Stopped', className: 'text-text-muted' }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatNextRun(timestamp: number | null, status: AgendaTask['status']): string {
  if (status === 'paused') return 'Paused'
  if (timestamp === null) return 'Not scheduled'

  const now = Date.now()
  if (timestamp <= now) return 'Due now'

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = startOfToday.getTime() + 24 * 60 * 60 * 1000
  const startOfDayAfter = startOfTomorrow + 24 * 60 * 60 * 1000

  if (timestamp < startOfTomorrow) return `Today at ${formatTime(timestamp)}`
  if (timestamp < startOfDayAfter) return `Tomorrow at ${formatTime(timestamp)}`
  return formatDateTime(timestamp)
}

function formatDuration(from: number, to: number | null): string {
  if (to === null) return 'in progress'
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Small inline pill used for the Safe / YOLO mode. */
function ModeChip({
  settings,
  onSwitch
}: {
  settings: AgendaSettings
  onSwitch: (mode: 'safe' | 'yolo') => void
}): React.JSX.Element {
  const yolo = settings.permissionMode === 'yolo'
  return (
    <button
      type="button"
      onClick={() => onSwitch(yolo ? 'safe' : 'yolo')}
      title={
        yolo
          ? 'YOLO: Agenda runs without asking. Click to return to Safe.'
          : 'Safe: every sensitive action asks first. Click to switch to YOLO.'
      }
      className={clsx(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors',
        yolo
          ? 'border-amber-300/30 bg-amber-300/10 text-amber-300 hover:bg-amber-300/15'
          : 'border-emerald-300/25 bg-emerald-300/10 text-emerald-300 hover:bg-emerald-300/15'
      )}
    >
      {yolo ? <Lightning size={11} weight="fill" /> : <ShieldCheck size={11} weight="bold" />}
      {yolo ? 'YOLO' : 'Safe'}
    </button>
  )
}

function TaskRow({
  task,
  runs,
  onPause,
  onResume,
  onRunNow,
  onDelete,
  onEdit,
  onOpenFolder
}: {
  task: AgendaTask
  runs: AgendaRunRecord[]
  onPause: () => void
  onResume: () => void
  onRunNow: () => void
  onDelete: () => void
  onEdit: () => void
  onOpenFolder: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const lastRun = runs.find((run) => run.taskId === task.id) ?? null
  const statusMeta = lastRun ? RUN_STATUS_META[lastRun.status] : null
  const paused = task.status === 'paused'

  const wrap = (action: () => Promise<unknown> | void): (() => void) => {
    return () => {
      if (busy) return
      setBusy(true)
      void Promise.resolve(action()).finally(() => setBusy(false))
    }
  }

  return (
    <article
      className={clsx(
        'group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 transition-colors hover:border-white/[0.1] hover:bg-white/[0.035]',
        paused && 'opacity-65'
      )}
    >
      <span
        className={clsx(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          paused ? 'bg-white/25' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-[13px] font-semibold text-text-primary">{task.title}</h3>
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-text-secondary">
            {describeAgendaCadence(task.intervalMinutes)}
            {task.anchor ? ` · ${describeAgendaAnchor(task.anchor)}` : ''}
          </span>
          {task.mcpServerIds.length > 0 && (
            <span
              className="rounded-full border border-accent-primary/25 bg-accent-primary/[0.08] px-2 py-0.5 text-[10px] text-accent-primary"
              title={`${task.mcpServerIds.length} MCP server${task.mcpServerIds.length === 1 ? '' : 's'} attached`}
            >
              {task.mcpServerIds.length} MCP
            </span>
          )}
          {statusMeta && lastRun && (
            <span className={clsx('text-[10px] font-medium', statusMeta.className)}>
              {statusMeta.label}
              {lastRun.catchUp ? ' · catch-up' : ''}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-text-muted">
          {task.instructions || 'No instructions yet.'}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {formatNextRun(task.nextRunAt, task.status)}
          </span>
          {lastRun && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle size={11} />
              Last run {formatDateTime(lastRun.startedAt)} · {formatDuration(lastRun.startedAt, lastRun.finishedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={wrap(paused ? onResume : onPause)}
          disabled={busy}
          title={paused ? 'Resume task' : 'Pause task'}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary disabled:opacity-40"
        >
          {paused ? <Play size={13} weight="fill" /> : <Pause size={13} weight="fill" />}
        </button>
        <button
          type="button"
          onClick={wrap(onRunNow)}
          disabled={busy}
          title={paused ? 'Run now (resumes the task)' : 'Run now'}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary disabled:opacity-40"
        >
          <ArrowClockwise size={13} weight="bold" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          title="Edit task"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={onOpenFolder}
          title="Open task folder"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary"
        >
          <FolderOpen size={13} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete task"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-rose-400/10 hover:text-rose-300"
        >
          <Trash size={13} />
        </button>
      </div>
    </article>
  )
}

function TaskDialog({
  initial,
  servers,
  onClose,
  onSaved
}: {
  initial?: AgendaTask | null
  servers: McpServerConfig[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const editing = Boolean(initial)
  const initialPresetIndex = ((): number => {
    if (!initial) return 5
    if (initial.intervalMinutes === null) return 0
    const exact = CADENCE_PRESETS.findIndex(
      (preset) => preset.minutes === initial.intervalMinutes
    )
    return exact >= 0 ? exact : -1
  })()
  const initialCustom = ((): { value: string; unit: 'hours' | 'days' } => {
    const minutes = initial?.intervalMinutes ?? 1440
    if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: 'days' }
    return { value: String(Math.max(1, Math.round(minutes / 60))), unit: 'hours' }
  })()

  const [title, setTitle] = useState(initial?.title ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [presetIndex, setPresetIndex] = useState(initialPresetIndex)
  const [customValue, setCustomValue] = useState(initialCustom.value)
  const [customUnit, setCustomUnit] = useState<'hours' | 'days'>(initialCustom.unit)
  const [selectedServers, setSelectedServers] = useState<string[]>(
    initial?.mcpServerIds ?? []
  )
  const [anchorEnabled, setAnchorEnabled] = useState(Boolean(initial?.anchor))
  const [anchorHour, setAnchorHour] = useState(initial?.anchor?.hour ?? 9)
  const [anchorMinute, setAnchorMinute] = useState(initial?.anchor?.minute ?? 0)
  const [anchorWeekday, setAnchorWeekday] = useState(initial?.anchor?.weekday ?? 1)
  const [anchorDayOfMonth, setAnchorDayOfMonth] = useState(initial?.anchor?.dayOfMonth ?? 1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cadence = useMemo((): number | null => {
    if (presetIndex >= 0) return CADENCE_PRESETS[presetIndex]?.minutes ?? null
    const value = Number(customValue)
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.round(customUnit === 'hours' ? value * 60 : value * 24 * 60)
  }, [presetIndex, customValue, customUnit])

  // Clock anchors only make sense for cadences of one day or longer.
  const anchorKind = useMemo((): 'none' | 'daily' | 'weekly' | 'monthly' => {
    if (cadence === null || cadence % 1440 !== 0) return 'none'
    if (cadence === 43200) return 'monthly'
    if (cadence % 10080 === 0) return 'weekly'
    return 'daily'
  }, [cadence])

  const anchor = useMemo((): AgendaAnchor | null => {
    if (!anchorEnabled || anchorKind === 'none') return null
    return {
      kind: 'time',
      hour: Math.min(23, Math.max(0, Math.round(anchorHour))),
      minute: Math.min(59, Math.max(0, Math.round(anchorMinute))),
      ...(anchorKind === 'weekly'
        ? { weekday: Math.min(6, Math.max(0, Math.round(anchorWeekday))) }
        : {}),
      ...(anchorKind === 'monthly'
        ? { dayOfMonth: Math.min(31, Math.max(1, Math.round(anchorDayOfMonth))) }
        : {})
    }
  }, [anchorEnabled, anchorKind, anchorHour, anchorMinute, anchorWeekday, anchorDayOfMonth])

  const invalidCadence = presetIndex < 0 && (cadence === null || cadence < 120 || cadence > 44640)
  const canSubmit = title.trim().length > 0 && !invalidCadence && !submitting

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      if (initial) {
        const result = await window.api.updateAgendaTask(initial.id, {
          title: title.trim(),
          instructions: instructions.trim(),
          intervalMinutes: cadence,
          anchor,
          mcpServerIds: selectedServers
        })
        if (!result.ok) {
          setError(result.error || 'Could not save the task.')
          return
        }
      } else {
        const result = await window.api.createAgendaTask({
          title: title.trim(),
          instructions: instructions.trim(),
          intervalMinutes: cadence,
          anchor,
          mcpServerIds: selectedServers
        })
        if (!result.ok) {
          setError(result.error || 'Could not create the task.')
          return
        }
      }
      onSaved()
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-create-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 id="agenda-create-title" className="text-sm font-semibold text-text-primary">
              {editing ? 'Edit Agenda task' : 'New Agenda task'}
            </h2>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Runs while Prism is open, with a fresh context every time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.07] hover:text-text-primary"
            title="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4 custom-scrollbar">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Summarize my inbox"
              className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
              Instructions
            </span>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              placeholder="What should the agent do on every run? Mention which files to update in the task folder."
              className="w-full resize-none rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-[12px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/50"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">Cadence</span>
            <div className="flex flex-wrap gap-1.5">
              {CADENCE_PRESETS.map((preset, index) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setPresetIndex(index)}
                  className={clsx(
                    'cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                    presetIndex === index
                      ? 'border-accent-primary/45 bg-accent-primary/15 text-accent-primary'
                      : 'border-white/[0.08] bg-white/[0.02] text-text-secondary hover:bg-white/[0.05]'
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPresetIndex(-1)}
                className={clsx(
                  'cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                  presetIndex < 0
                    ? 'border-accent-primary/45 bg-accent-primary/15 text-accent-primary'
                    : 'border-white/[0.08] bg-white/[0.02] text-text-secondary hover:bg-white/[0.05]'
                )}
              >
                Custom
              </button>
            </div>

            {presetIndex < 0 && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={customValue}
                  onChange={(event) => setCustomValue(event.target.value)}
                  className="w-24 rounded-lg border border-white/[0.09] bg-black/25 px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/50"
                />
                <select
                  value={customUnit}
                  onChange={(event) => setCustomUnit(event.target.value as 'hours' | 'days')}
                  className="rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/50"
                >
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <span className="text-[10.5px] text-text-muted">between 2 hours and 31 days</span>
              </div>
            )}
            {invalidCadence && (
              <p className="mt-1.5 text-[10.5px] text-rose-300">
                The shortest cadence is 2 hours and the longest is 31 days.
              </p>
            )}
          </div>

          {anchorKind !== 'none' && (
            <div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={anchorEnabled}
                  onChange={(event) => setAnchorEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-primary)]"
                />
                <span className="text-[11px] font-medium text-text-secondary">
                  Run at a specific time
                </span>
              </label>
              {anchorEnabled && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {anchorKind === 'weekly' && (
                    <select
                      value={anchorWeekday}
                      onChange={(event) => setAnchorWeekday(Number(event.target.value))}
                      className="rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/50"
                    >
                      {WEEKDAYS.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  )}
                  {anchorKind === 'monthly' && (
                    <label className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
                      Day
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={anchorDayOfMonth}
                        onChange={(event) => setAnchorDayOfMonth(Number(event.target.value))}
                        className="w-16 rounded-lg border border-white/[0.09] bg-black/25 px-2 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/50"
                      />
                    </label>
                  )}
                  <input
                    type="time"
                    value={`${padTime(anchorHour)}:${padTime(anchorMinute)}`}
                    onChange={(event) => {
                      const [hour, minute] = event.target.value.split(':').map(Number)
                      if (Number.isFinite(hour)) setAnchorHour(hour)
                      if (Number.isFinite(minute)) setAnchorMinute(minute)
                    }}
                    className="rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/50"
                  />
                  <span className="text-[10.5px] text-text-muted">
                    {anchorKind === 'weekly'
                      ? 'local weekday and time'
                      : anchorKind === 'monthly'
                        ? 'local time; short months use the last day'
                        : 'local time of day'}
                  </span>
                </div>
              )}
            </div>
          )}

          <div>
            <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
              MCP servers <span className="text-text-muted">(optional)</span>
            </span>
            {servers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] px-3 py-2 text-[10.5px] leading-relaxed text-text-muted">
                No MCP servers installed. Add one in Settings → MCP Servers and it shows up here.
              </p>
            ) : (
              <div className="space-y-1">
                {servers.map((server) => {
                  const checked = selectedServers.includes(server.id)
                  return (
                    <label
                      key={server.id}
                      className={clsx(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors',
                        checked
                          ? 'border-accent-primary/35 bg-accent-primary/[0.08]'
                          : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]',
                        !server.enabled && 'opacity-55'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!server.enabled}
                        onChange={(event) =>
                          setSelectedServers((current) =>
                            event.target.checked
                              ? [...current, server.id]
                              : current.filter((id) => id !== server.id)
                          )
                        }
                        className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--accent-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-text-primary">
                          {server.name}
                        </span>
                        <span className="block truncate font-mono text-[9.5px] text-text-muted">
                          {server.transport === 'http'
                            ? server.url
                            : [server.command, ...server.args].join(' ')}
                          {!server.enabled ? ' · disabled' : ''}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
              <XCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {submitting && (
            <p className="text-[10.5px] text-text-muted">
              Waiting for confirmation. In Safe mode Prism asks before creating or changing a
              schedule.
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button type="button" onClick={onClose} className="settings-secondary-button cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="settings-primary-button cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
          >
            {editing ? <Check size={13} weight="bold" /> : <Plus size={13} weight="bold" />}
            {editing ? 'Save changes' : 'Create task'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function YoloConfirmDialog({
  onCancel,
  onConfirm
}: {
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-300/25 bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-yolo-title"
      >
        <header className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-300/12 text-amber-300">
            <Warning size={16} weight="fill" />
          </span>
          <div>
            <h2 id="agenda-yolo-title" className="text-sm font-semibold text-text-primary">
              Switch Agenda to YOLO?
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
              Agenda will run commands, call MCP tools, install MCP servers and create schedules
              without asking. It has full access to this computer.
            </p>
          </div>
        </header>
        <div className="px-5 py-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-text-secondary">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-amber-300"
            />
            I understand that unattended runs can change files and run commands without my
            confirmation.
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button type="button" onClick={onCancel} className="settings-secondary-button cursor-pointer">
            Keep Safe
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!acknowledged}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Lightning size={12} weight="fill" />
            Enable YOLO
          </button>
        </footer>
      </section>
    </div>
  )
}

function DeleteTaskDialog({
  task,
  onCancel,
  onConfirm
}: {
  task: AgendaTask
  onCancel: () => void
  onConfirm: (deleteFolder: boolean) => void
}): React.JSX.Element {
  const [deleteFolder, setDeleteFolder] = useState(false)
  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-delete-title"
      >
        <header className="border-b border-white/[0.07] px-5 py-4">
          <h2 id="agenda-delete-title" className="text-sm font-semibold text-text-primary">
            Delete “{task.title}”?
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
            The schedule and its run history are removed. The task folder can be kept.
          </p>
        </header>
        <div className="px-5 py-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-text-secondary">
            <input
              type="checkbox"
              checked={deleteFolder}
              onChange={(event) => setDeleteFolder(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-rose-300"
            />
            Also delete the task folder and everything the agent wrote in it.
          </label>
          <p className="mt-2 break-all rounded-lg bg-black/25 px-2.5 py-1.5 font-mono text-[10px] text-text-muted">
            {task.folder}
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button type="button" onClick={onCancel} className="settings-secondary-button cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteFolder)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-500/90 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-rose-500"
          >
            <Trash size={12} />
            Delete task
          </button>
        </footer>
      </section>
    </div>
  )
}

interface TranscriptMessage {
  role: string
  content?: string | Array<{ text?: string }>
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
  name?: string
}

function messageText(message: TranscriptMessage): string {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.map((part) => part.text || '').join(' ')
  }
  return ''
}

function RunDrawer({
  run,
  task,
  onClose
}: {
  run: AgendaRunRecord
  task: AgendaTask | undefined
  onClose: () => void
}): React.JSX.Element {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loading, setLoading] = useState(true)
  const meta = RUN_STATUS_META[run.status]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.api
      .loadChat(`agenda-${run.id}`)
      .then((loaded) => {
        if (!cancelled) setMessages((loaded as TranscriptMessage[]) || [])
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [run.id])

  return (
    <div className="fixed inset-0 z-[112] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-run-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 id="agenda-run-title" className="truncate text-sm font-semibold text-text-primary">
              {task?.title ?? 'Deleted task'}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-text-muted">
              <span className={clsx('font-semibold', meta.className)}>{meta.label}</span>
              {run.catchUp && <span>catch-up</span>}
              <span>{formatDateTime(run.startedAt)}</span>
              <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
              {run.permissionPrompts > 0 && (
                <span>{run.permissionPrompts} permission prompt{run.permissionPrompts === 1 ? '' : 's'}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.07] hover:text-text-primary"
            title="Close"
          >
            <X size={14} />
          </button>
        </header>

        {run.error && (
          <div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
            <XCircle size={13} className="mt-0.5 shrink-0" />
            <span>{run.error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          {loading ? (
            <p className="text-[11px] text-text-muted">Loading transcript…</p>
          ) : messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[11px] text-text-muted">The transcript is no longer available.</p>
              {run.summary && (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
                  {run.summary}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => {
                const text = messageText(message).trim()
                if (message.role === 'system') return null
                if (message.role === 'tool') {
                  if (!text) return null
                  return (
                    <pre
                      key={index}
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-text-muted custom-scrollbar"
                    >
                      {text.length > 1500 ? `${text.slice(0, 1500)}…` : text}
                    </pre>
                  )
                }
                return (
                  <div key={index} className="space-y-1.5">
                    <span
                      className={clsx(
                        'text-[9.5px] font-semibold uppercase tracking-wider',
                        message.role === 'assistant' ? 'text-accent-primary' : 'text-text-muted'
                      )}
                    >
                      {message.role === 'assistant' ? 'Agent' : 'Prompt'}
                    </span>
                    {text && (
                      <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-text-secondary">
                        {text.length > 6000 ? `${text.slice(0, 6000)}…` : text}
                      </p>
                    )}
                    {message.tool_calls?.map((call, callIndex) => (
                      <div
                        key={callIndex}
                        className="flex items-start gap-1.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 font-mono text-[10px] text-text-muted"
                      >
                        <TerminalWindow size={11} className="mt-0.5 shrink-0" />
                        <span className="break-all">
                          {call.function?.name ?? 'tool'}
                          {call.function?.arguments ? ` ${call.function.arguments.slice(0, 300)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

const TUTORIAL_STEPS = [
  {
    title: 'Agenda runs recurring work for you',
    body: 'Create a task once and Prism runs it on your cadence — checking a repository, summarizing a folder, or calling an MCP server. Each run starts with a fresh context and writes its memory to the task folder.'
  },
  {
    title: 'It only runs while Prism is open',
    body: 'There is no background service. Agenda works with the window open or minimized to the tray. If Prism is closed when a run is due, it catches up once on the next launch — never a burst.'
  },
  {
    title: 'Every task owns a folder',
    body: 'Files live under Documents/Prism/Agenda. The agent reads and writes there, and `.agenda/state.md` is the only memory carried between runs. You can open the folder from the task row at any time.'
  },
  {
    title: 'Safe is the default',
    body: 'In Safe mode, terminal commands, MCP tools, MCP installs and new schedules wait for your approval. A run can install an MCP server for itself, but only after you approve it. YOLO runs without asking and logs every action. You can switch back to Safe at any time.'
  }
]

function TutorialDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const current = TUTORIAL_STEPS[step]
  const last = step === TUTORIAL_STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[114] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-tutorial-title"
      >
        <header className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-primary">
            <BookOpen size={12} weight="bold" />
            Agenda tutorial
          </span>
          <span className="text-[10px] text-text-muted">
            {step + 1} / {TUTORIAL_STEPS.length}
          </span>
        </header>
        <div className="px-5 py-5">
          <h2 id="agenda-tutorial-title" className="text-base font-semibold text-text-primary">
            {current.title}
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">{current.body}</p>
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-[11px] text-text-muted transition-colors hover:text-text-secondary"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={step === 0}
              className="settings-secondary-button cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CaretLeft size={12} />
              Back
            </button>
            <button
              type="button"
              onClick={() => (last ? onClose() : setStep((value) => value + 1))}
              className="settings-primary-button cursor-pointer"
            >
              {last ? 'Got it' : 'Next'}
              {last ? <Check size={13} weight="bold" /> : <CaretRight size={12} />}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function DraftCard({
  draft,
  busy,
  onDiscard,
  onCreate
}: {
  draft: {
    title: string
    instructions: string
    intervalMinutes: number | null
    anchor: AgendaAnchor | null
  }
  busy: boolean
  onDiscard: () => void
  onCreate: () => void
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-accent-primary/25 bg-accent-primary/[0.06] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkle size={13} weight="fill" className="text-accent-primary" />
        <span className="text-[12px] font-semibold text-text-primary">{draft.title}</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-text-secondary">
          {describeAgendaCadence(draft.intervalMinutes)}
          {draft.anchor ? ` · ${describeAgendaAnchor(draft.anchor)}` : ''}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
        {draft.instructions}
      </p>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-secondary"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="settings-primary-button cursor-pointer disabled:opacity-45"
        >
          {busy ? 'Creating…' : 'Create task'}
          <ArrowRight size={12} weight="bold" />
        </button>
      </div>
    </div>
  )
}

export function AgendaWorkspace({ config }: { config: AppConfig | null }): React.JSX.Element {
  const [tasks, setTasks] = useState<AgendaTask[]>([])
  const [runs, setRuns] = useState<AgendaRunRecord[]>([])
  const [settings, setSettings] = useState<AgendaSettings>(
    config?.agenda ?? { permissionMode: 'safe', yoloAcknowledged: false, maxConcurrentRuns: 2 }
  )
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AgendaTask | null>(null)
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [isYoloConfirmOpen, setIsYoloConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AgendaTask | null>(null)
  const [runTarget, setRunTarget] = useState<AgendaRunRecord | null>(null)
  const [isTutorialOpen, setIsTutorialOpen] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [isPlanning, setIsPlanning] = useState(false)
  const [draft, setDraft] = useState<{
    title: string
    instructions: string
    intervalMinutes: number | null
    anchor: AgendaAnchor | null
  } | null>(null)
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (window.localStorage.getItem('prism.agenda.tutorialSeen') !== '1') {
        setIsTutorialOpen(true)
      }
    } catch {
      /* localStorage can be unavailable; the tutorial stays reachable from the header. */
    }
  }, [])

  const closeTutorial = (): void => {
    setIsTutorialOpen(false)
    try {
      window.localStorage.setItem('prism.agenda.tutorialSeen', '1')
    } catch {
      /* ignore */
    }
  }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextTasks, nextRuns, mcp] = await Promise.all([
        window.api.listAgendaTasks(),
        window.api.listAgendaRuns(),
        window.api.listMcpServers()
      ])
      setTasks(nextTasks)
      setRuns(nextRuns)
      setServers(mcp.servers)
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const disposeTasks = window.api.onAgendaTasksChanged(() => {
      void refresh()
    })
    const disposeSettings = window.api.onAgendaSettingsChanged((next) => {
      setSettings(next)
    })
    const disposeMcp = window.api.onMcpServersChanged(() => {
      void refresh()
    })
    const disposeRuns = window.api.onAgendaRunsChanged(() => {
      void refresh()
    })
    return () => {
      disposeTasks()
      disposeSettings()
      disposeMcp()
      disposeRuns()
    }
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    void window.api.getAgendaSettings().then((next) => {
      if (!cancelled) setSettings(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === 'active').length,
    [tasks]
  )
  const recentRuns = useMemo(() => runs.slice(0, 8), [runs])

  const switchMode = async (mode: 'safe' | 'yolo'): Promise<void> => {
    if (mode === 'yolo') {
      setIsYoloConfirmOpen(true)
      return
    }
    const result = await window.api.setAgendaPermissionMode('safe', false)
    if (result.ok && result.settings) setSettings(result.settings)
    else setError(result.error || 'Could not switch the permission mode.')
  }

  const confirmYolo = async (): Promise<void> => {
    const result = await window.api.setAgendaPermissionMode('yolo', true)
    if (result.ok && result.settings) {
      setSettings(result.settings)
      setIsYoloConfirmOpen(false)
    } else {
      setError(result.error || 'Could not switch the permission mode.')
    }
  }

  const deleteTask = async (task: AgendaTask, deleteFolder: boolean): Promise<void> => {
    const result = await window.api.deleteAgendaTask(task.id, deleteFolder)
    if (!result.ok) setError('Could not delete the task.')
    setDeleteTarget(null)
    await refresh()
  }

  const planRequest = async (): Promise<void> => {
    const request = composerText.trim()
    if (!request || isPlanning) return
    setIsPlanning(true)
    setError(null)
    try {
      const result = await window.api.planAgendaTask(request)
      if (!result.ok || !result.draft) {
        setError(result.error || 'Could not plan the task.')
        return
      }
      setDraft({
        title: result.draft.title,
        instructions: result.draft.instructions,
        intervalMinutes: result.draft.intervalMinutes,
        anchor: result.draft.anchor
      })
    } catch (planError) {
      setError(errorMessage(planError))
    } finally {
      setIsPlanning(false)
    }
  }

  const createDraft = async (): Promise<void> => {
    if (!draft || isCreatingDraft) return
    setIsCreatingDraft(true)
    setError(null)
    try {
      const result = await window.api.createAgendaTask({
        title: draft.title,
        instructions: draft.instructions,
        intervalMinutes: draft.intervalMinutes,
        anchor: draft.anchor
      })
      if (!result.ok) {
        setError(result.error || 'Could not create the task.')
        return
      }
      setDraft(null)
      setComposerText('')
      await refresh()
    } catch (createError) {
      setError(errorMessage(createError))
    } finally {
      setIsCreatingDraft(false)
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-transparent">
      <div
        className="pointer-events-none absolute -top-32 left-1/3 h-[360px] w-[360px] rounded-full opacity-[0.13] blur-[100px]"
        style={{ background: 'radial-gradient(circle, var(--accent-primary) 0%, transparent 70%)' }}
      />

      <header className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-white/[0.06] px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-accent-primary">
          <CalendarBlank size={17} weight="bold" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight text-text-primary">Agenda</h1>
            <ModeChip settings={settings} onSwitch={(mode) => void switchMode(mode)} />
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {tasks.length === 0
              ? 'Recurring tasks that run while Prism is open.'
              : `${activeTasks} active of ${tasks.length} task${tasks.length === 1 ? '' : 's'} · runs only while Prism is open`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsTutorialOpen(true)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary"
          title="How Agenda works"
        >
          <Question size={15} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="settings-primary-button cursor-pointer"
        >
          <Plus size={14} weight="bold" />
          New task
        </button>
      </header>

      {error && (
        <div className="relative z-10 mx-6 mt-4 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
          <XCircle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cursor-pointer text-rose-200/70 hover:text-rose-100"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 overflow-hidden px-6 py-4">
        <div className="flex min-h-0 flex-1 flex-col">
          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-10 text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-accent-primary">
                <Sparkle size={20} weight="fill" />
              </span>
              <h2 className="text-base font-semibold text-text-primary">Nothing scheduled yet</h2>
              <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-text-secondary">
                Create a task and Agenda runs it on your cadence — checking a repo, summarizing a
                folder, or calling an MCP server. Each run starts with a fresh context and keeps its
                memory in the task folder.
              </p>
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="settings-primary-button mt-5 cursor-pointer"
              >
                <Plus size={14} weight="bold" />
                Create the first task
              </button>
              <p className="mt-4 text-[10.5px] text-text-muted">
                Agenda never runs while Prism is closed. Missed runs catch up once when you reopen
                the app.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  runs={runs}
                  onPause={() => window.api.setAgendaTaskStatus(task.id, 'paused')}
                  onResume={() => window.api.setAgendaTaskStatus(task.id, 'active')}
                  onRunNow={() => window.api.runAgendaTaskNow(task.id)}
                  onDelete={() => setDeleteTarget(task)}
                  onEdit={() => setEditTarget(task)}
                  onOpenFolder={() => void window.api.openFolderInExplorer(task.folder)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="hidden w-[290px] shrink-0 flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar lg:flex">
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <CaretRight size={11} weight="bold" />
              How it works
            </h2>
            <ul className="space-y-2 text-[11px] leading-relaxed text-text-secondary">
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-primary" />
                Each task owns a folder under Documents/Prism/Agenda.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-primary" />
                Every run starts fresh. <span className="font-mono text-[10px]">.agenda/state.md</span>{' '}
                is the only memory carried over.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-primary" />
                {settings.permissionMode === 'safe'
                  ? 'Safe mode asks before commands, MCP tools and schedules.'
                  : 'YOLO mode runs without asking. Every action is still logged.'}
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <Clock size={11} weight="bold" />
              Recent runs
            </h2>
            {recentRuns.length === 0 ? (
              <p className="text-[11px] text-text-muted">No runs yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recentRuns.map((run) => {
                  const task = tasks.find((candidate) => candidate.id === run.taskId)
                  const meta = RUN_STATUS_META[run.status]
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => setRunTarget(run)}
                        className="flex w-full cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 text-left text-[10.5px] transition-colors hover:bg-white/[0.05]"
                        title="Open the run transcript"
                      >
                        <span className={clsx('mt-0.5 shrink-0 font-medium', meta.className)}>
                          {meta.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text-secondary">
                          {task?.title ?? 'Deleted task'}
                        </span>
                        <span className="shrink-0 text-text-muted">{formatTime(run.startedAt)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <div className="relative z-10 shrink-0 border-t border-white/[0.06] px-6 py-3">
        {draft && (
          <div className="mb-2.5">
            <DraftCard
              draft={draft}
              busy={isCreatingDraft}
              onDiscard={() => setDraft(null)}
              onCreate={() => void createDraft()}
            />
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={composerText}
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void planRequest()
              }
            }}
            rows={1}
            placeholder="Describe a recurring task — “every morning, summarize my downloads folder”"
            className="max-h-28 min-h-[36px] flex-1 resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-[12px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/45"
          />
          <button
            type="button"
            onClick={() => void planRequest()}
            disabled={!composerText.trim() || isPlanning}
            className="settings-primary-button h-9 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
          >
            <PaperPlaneTilt size={13} weight="fill" />
            {isPlanning ? 'Planning…' : 'Plan'}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-text-muted">
          The composer drafts the task. Nothing is scheduled until you confirm.
        </p>
      </div>

      {isCreateOpen && (
        <TaskDialog
          servers={servers}
          onClose={() => setIsCreateOpen(false)}
          onSaved={() => {
            setIsCreateOpen(false)
            void refresh()
          }}
        />
      )}
      {editTarget && (
        <TaskDialog
          initial={editTarget}
          servers={servers}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            void refresh()
          }}
        />
      )}
      {isYoloConfirmOpen && (
        <YoloConfirmDialog
          onCancel={() => setIsYoloConfirmOpen(false)}
          onConfirm={() => void confirmYolo()}
        />
      )}
      {deleteTarget && (
        <DeleteTaskDialog
          task={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={(deleteFolder) => void deleteTask(deleteTarget, deleteFolder)}
        />
      )}
      {runTarget && (
        <RunDrawer
          run={runTarget}
          task={tasks.find((candidate) => candidate.id === runTarget.taskId)}
          onClose={() => setRunTarget(null)}
        />
      )}
      {isTutorialOpen && <TutorialDialog onClose={closeTutorial} />}
    </div>
  )
}
