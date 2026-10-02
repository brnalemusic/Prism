import React, { useCallback, useEffect, useState, useMemo } from 'react'
import {
  ArrowSquareOut,
  Desktop,
  FolderOpen,
  MagnifyingGlass,
  Plus,
  Star,
  Trash,
  Warning,
  X
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type { AppConfig } from '../../../main/config'
import type { HarnessProjectConfig, HarnessSettings } from '../../../shared/types'

export function HarnessProjectModal({
  isOpen,
  onClose,
  onSelected
}: {
  isOpen: boolean
  onClose: () => void
  onSelected: (project: HarnessProjectConfig) => void
}): React.JSX.Element | null {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [mode, setMode] = useState<'existing' | 'simple' | 'advanced'>('existing')
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [healthMap, setHealthMap] = useState<
    Record<string, { exists: boolean; isDirectory: boolean; isGit: boolean }>
  >({})

  const refreshData = useCallback(async (): Promise<void> => {
    try {
      const cfg = await window.api.getConfig()
      setConfig(cfg)
      const health = await window.api.checkAllHarnessProjects()
      setHealthMap(health)

      const projectsCount = Object.keys(cfg?.harness?.projects || {}).length
      if (projectsCount === 0) {
        setMode('simple')
      }
    } catch (cause) {
      console.error('Failed to load projects in modal:', cause)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setName('')
    setSearch('')
    void refreshData()
  }, [isOpen, refreshData])

  const projectsList = useMemo(() => {
    if (!config?.harness?.projects) return []
    const all = Object.entries(config.harness.projects).map(([key, proj]) => ({
      key,
      ...proj
    }))

    return all
      .filter((proj) => {
        if (!search.trim()) return true
        const q = search.toLowerCase()
        return (
          proj.displayName.toLowerCase().includes(q) ||
          proj.rootPath.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const aIsActive = config.harness.lastProjectPath === a.rootPath
        const bIsActive = config.harness.lastProjectPath === b.rootPath
        if (aIsActive && !bIsActive) return -1
        if (!aIsActive && bIsActive) return 1
        return (b.updatedAt || 0) - (a.updatedAt || 0)
      })
  }, [config?.harness?.projects, config?.harness?.lastProjectPath, search])

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

  const handleDelete = async (rootPath: string): Promise<void> => {
    try {
      const updated = await window.api.deleteHarnessProject(rootPath)
      if (config) {
        setConfig({
          ...config,
          harness: updated
        })
      }
      void refreshData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleToggleDefault = async (rootPath: string): Promise<void> => {
    if (!config) return
    const isCurrentDefault = config.harness.defaultProjectPath === rootPath
    const updates: Partial<HarnessSettings> = {
      defaultProjectPath: isCurrentDefault ? undefined : rootPath,
      startupProjectMode: isCurrentDefault ? 'last_opened' : 'default_project'
    }
    await window.api.saveConfig({
      harness: {
        ...config.harness,
        ...updates
      }
    })
    void refreshData()
  }

  const handleRecreate = async (rootPath: string): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api.recreateHarnessProjectFolder(rootPath)
      finish(res.project)
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleOpenExplorer = async (rootPath: string): Promise<void> => {
    try {
      await window.api.openFolderInExplorer(rootPath)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-lg rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.75)] flex flex-col max-h-[85vh]"
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
              Select an existing workspace or initialize a new project directory.
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

        {/* Tab switcher */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-white/[0.035] p-1 shrink-0">
          {(['existing', 'simple', 'advanced'] as const).map((option) => {
            const label =
              option === 'existing'
                ? `Projects (${Object.keys(config?.harness?.projects || {}).length})`
                : option === 'simple'
                  ? 'New project'
                  : 'Open folder'

            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option)
                  setError('')
                }}
                className={clsx(
                  'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors truncate',
                  mode === option
                    ? 'bg-white/[0.08] text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="mt-4 flex-1 overflow-y-auto custom-scrollbar min-h-36">
          {mode === 'existing' && (
            <div className="space-y-3">
              {Object.keys(config?.harness?.projects || {}).length > 4 && (
                <div className="relative">
                  <MagnifyingGlass
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects..."
                    className="settings-text-input w-full pl-8 py-1.5 text-xs"
                  />
                </div>
              )}

              {projectsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted space-y-3">
                  <Desktop size={28} className="opacity-40" />
                  <p className="text-xs">No registered projects found.</p>
                  <button
                    type="button"
                    onClick={() => setMode('simple')}
                    className="settings-secondary-button text-xs"
                  >
                    <Plus size={13} />
                    Create a project
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {projectsList.map((proj) => {
                    const health = healthMap[proj.key]
                    const isMissing = health && (!health.exists || !health.isDirectory)
                    const isDefault = config?.harness?.defaultProjectPath === proj.rootPath
                    const isLastOpened = config?.harness?.lastProjectPath === proj.rootPath

                    return (
                      <div
                        key={proj.key}
                        className={clsx(
                          'group flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-all text-left',
                          isMissing
                            ? 'border-amber-500/25 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.05]'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isMissing) {
                              void handleRecreate(proj.rootPath)
                            } else {
                              finish(proj)
                            }
                          }}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer focus:outline-none"
                        >
                          <div
                            className={clsx(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                              isMissing
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                                : 'bg-white/[0.05] border-white/[0.08] text-text-secondary group-hover:text-accent-primary'
                            )}
                          >
                            {isMissing ? (
                              <Warning size={15} weight="fill" />
                            ) : (
                              <Desktop size={15} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs text-text-primary truncate">
                                {proj.displayName}
                              </span>
                              {isDefault && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-accent-primary/20 px-1 py-0.2 text-[9px] font-semibold text-accent-primary uppercase tracking-wider">
                                  <Star size={9} weight="fill" /> Default
                                </span>
                              )}
                              {isLastOpened && !isDefault && (
                                <span className="rounded bg-white/[0.08] px-1 py-0.2 text-[9px] font-medium text-text-muted">
                                  Last
                                </span>
                              )}
                              {isMissing && (
                                <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-semibold text-amber-300 uppercase">
                                  Folder Missing
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-[10px] text-text-muted truncate mt-0.5">
                              {proj.rootPath}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {isMissing ? (
                            <button
                              type="button"
                              onClick={() => void handleRecreate(proj.rootPath)}
                              className="rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-2 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer"
                              title="Recreate folder and Git repo"
                            >
                              Recreate
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleToggleDefault(proj.rootPath)}
                                className={clsx(
                                  'rounded-lg p-1.5 transition-colors cursor-pointer',
                                  isDefault
                                    ? 'text-accent-primary bg-accent-primary/15'
                                    : 'text-text-muted hover:text-text-primary hover:bg-white/[0.08]'
                                )}
                                title={isDefault ? 'Remove default startup project' : 'Set as default startup project'}
                                aria-label="Toggle default project"
                              >
                                <Star size={13} weight={isDefault ? 'fill' : 'regular'} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleOpenExplorer(proj.rootPath)}
                                className="rounded-lg p-1.5 text-text-muted hover:text-text-primary hover:bg-white/[0.08] transition-colors cursor-pointer"
                                title="Open in File Explorer"
                                aria-label="Open in File Explorer"
                              >
                                <ArrowSquareOut size={13} />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDelete(proj.rootPath)}
                            className="rounded-lg p-1.5 text-text-muted hover:text-status-error hover:bg-white/[0.08] transition-colors cursor-pointer"
                            title="Remove project from Prism"
                            aria-label="Remove project from Prism"
                          >
                            <Trash size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {mode === 'simple' && (
            <div className="space-y-3">
              <label
                htmlFor="harness-project-name"
                className="text-[11px] font-medium text-text-secondary block"
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
              <p className="text-[10.5px] text-text-muted">
                Will be created under <code className="font-mono text-[10px] text-text-secondary">{config?.harness?.projectsRoot || 'Documents/PrismProjects'}</code> with Git initialized.
              </p>
            </div>
          )}

          {mode === 'advanced' && (
            <div className="rounded-xl bg-white/[0.025] px-4 py-4 space-y-2 border border-white/[0.05]">
              <p className="text-[11.5px] leading-relaxed text-text-secondary">
                Select any folder on this computer. Prism will register it and initialize Git if needed.
              </p>
              <p className="text-[10.5px] text-text-muted">
                The selected folder becomes the isolated workspace for this Harness session.
              </p>
            </div>
          )}

          {error && <p className="mt-3 text-[11px] text-status-error">{error}</p>}
        </div>

        {/* Footer actions for simple/advanced modes */}
        {mode !== 'existing' && (
          <div className="mt-5 flex justify-end gap-2 border-t border-white/[0.06] pt-3 shrink-0">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className="settings-secondary-button cursor-pointer"
            >
              Back
            </button>
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
        )}
      </section>
    </div>
  )
}
