import React, { useState } from 'react'
import { FolderOpen, Plus, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { HarnessProjectConfig } from '../../../shared/types'

export function HarnessProjectModal({
  isOpen,
  onClose,
  onSelected
}: {
  isOpen: boolean
  onClose: () => void
  onSelected: (project: HarnessProjectConfig) => void
}): React.JSX.Element | null {
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!isOpen) return null

  const finish = (project: HarnessProjectConfig): void => {
    setBusy(false)
    setError('')
    setName('')
    onSelected(project)
  }

  const createProject = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.createHarnessProject(name)
      finish(result.project)
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const openProject = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.openHarnessProject()
      if (result) finish(result.project)
      else setBusy(false)
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="harness-project-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="harness-project-title" className="text-sm font-semibold text-text-primary">
              Choose a Harness project
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              This folder becomes the agent&apos;s complete workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-primary"
            aria-label="Close project picker"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.035] p-1">
          {(['simple', 'advanced'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={clsx(
                'rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors',
                mode === option
                  ? 'bg-white/[0.08] text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {option === 'simple' ? 'New project' : 'Advanced folder'}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-28">
          {mode === 'simple' ? (
            <div className="space-y-2">
              <label
                htmlFor="harness-project-name"
                className="text-[11px] font-medium text-text-secondary"
              >
                Project name
              </label>
              <input
                id="harness-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim() && !busy) void createProject()
                }}
                maxLength={80}
                autoFocus
                placeholder="My project"
                className="settings-text-input w-full"
              />
              <p className="text-[10px] text-text-muted">
                Created inside Documents/PrismProjects with Git initialized.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-white/[0.025] px-4 py-3">
              <p className="text-[11px] leading-relaxed text-text-secondary">
                Select any folder on this computer. Prism will initialize Git if needed and use it
                as the isolated project root.
              </p>
            </div>
          )}
          {error && <p className="mt-3 text-[11px] text-status-error">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end">
          {mode === 'simple' ? (
            <button
              type="button"
              disabled={!name.trim() || busy}
              onClick={() => void createProject()}
              className="settings-primary-button cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus size={13} />
              {busy ? 'Creating...' : 'Create project'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void openProject()}
              className="settings-primary-button cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FolderOpen size={13} />
              {busy ? 'Opening...' : 'Choose folder'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
