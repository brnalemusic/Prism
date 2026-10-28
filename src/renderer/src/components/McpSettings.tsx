import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowClockwise,
  CheckCircle,
  CaretDown,
  CaretRight,
  CircleNotch,
  Plug,
  Plus,
  Trash,
  Warning,
  X,
  XCircle
} from '@phosphor-icons/react'
import clsx from 'clsx'
import type {
  McpGalleryPreset,
  McpInstallPreset,
  McpServerConfig,
  McpServerDraft,
  McpServerStatus
} from '../../../shared/mcpTypes'
import { McpBrandIcon } from './McpBrandIcon'

function statusLabel(status: McpServerStatus | undefined): {
  label: string
  className: string
} {
  if (!status || status.state === 'stopped') return { label: 'Stopped', className: 'text-text-muted' }
  if (status.state === 'starting') return { label: 'Starting', className: 'text-amber-300' }
  if (status.state === 'ready') return { label: 'Ready', className: 'text-emerald-300' }
  return { label: 'Error', className: 'text-rose-300' }
}

function ServerCard({
  server,
  status,
  onRefresh,
  onToggle,
  onDelete,
  onEdit
}: {
  server: McpServerConfig
  status: McpServerStatus | undefined
  onRefresh: () => Promise<void>
  onToggle: () => Promise<void>
  onDelete: () => Promise<void>
  onEdit: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const meta = statusLabel(status)
  const tools = status?.tools ?? []

  const run = (action: () => Promise<void>): void => {
    if (busy) return
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  return (
    <article className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-accent-primary">
          <Plug size={14} weight="bold" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[12.5px] font-semibold text-text-primary">{server.name}</h3>
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-medium',
                meta.className
              )}
            >
              {status?.state === 'starting' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
              {meta.label}
            </span>
            <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-text-muted">
              {server.transport}
            </span>
            {tools.length > 0 && (
              <span className="text-[10px] text-text-muted">
                {tools.length} tool{tools.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
            {server.transport === 'http'
              ? server.url
              : [server.command, ...server.args].join(' ')}
          </p>
          {status?.error && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-rose-400/10 px-2 py-1 text-[10px] leading-relaxed text-rose-200">
              <XCircle size={11} className="mt-0.5 shrink-0" />
              <span className="break-words">{status.error}</span>
            </p>
          )}
          {tools.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-[10px] text-text-muted transition-colors hover:text-text-secondary"
            >
              {expanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
              {expanded ? 'Hide tools' : 'Show tools'}
            </button>
          )}
          {expanded && (
            <ul className="mt-1.5 space-y-1">
              {tools.map((tool) => (
                <li key={tool.name} className="rounded-md bg-black/25 px-2 py-1">
                  <span className="font-mono text-[10px] text-text-secondary">{tool.name}</span>
                  {tool.description && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-text-muted">
                      {tool.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => run(onToggle)}
            disabled={busy}
            title={server.enabled ? 'Disable server' : 'Enable server'}
            className={clsx(
              'relative h-4 w-7 cursor-pointer rounded-full transition-colors disabled:opacity-40',
              server.enabled ? 'bg-accent-primary/70' : 'bg-white/15'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                server.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => run(onRefresh)}
            disabled={busy}
            title="Restart and list tools"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary disabled:opacity-40"
          >
            <ArrowClockwise size={12} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit server"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.07] hover:text-text-primary"
          >
            <Plug size={12} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete server"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-rose-400/10 hover:text-rose-300"
          >
            <Trash size={12} />
          </button>
        </div>
      </div>
    </article>
  )
}

function ServerDialog({
  initial,
  presets,
  onClose,
  onSaved
}: {
  initial: McpServerConfig | null
  presets: McpInstallPreset[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [transport, setTransport] = useState<'stdio' | 'http'>(initial?.transport ?? 'stdio')
  const [command, setCommand] = useState(initial?.command ?? 'npx')
  const [argsText, setArgsText] = useState((initial?.args ?? []).join('\n'))
  const [url, setUrl] = useState(initial?.url ?? '')
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>(
    (initial?.envKeys ?? []).map((key) => ({ key, value: '' }))
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyPreset = (preset: McpInstallPreset): void => {
    setName(preset.name)
    setTransport(preset.transport)
    setCommand(preset.command)
    setArgsText(preset.args.join('\n'))
    setUrl(preset.url)
    setEnvRows((preset.envHints ?? []).map((hint) => ({ key: hint.key, value: '' })))
  }

  const args = useMemo(
    () =>
      argsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    [argsText]
  )

  const submit = async (): Promise<void> => {
    if (submitting) return
    if (!name.trim()) {
      setError('Give the server a name.')
      return
    }
    if (transport === 'stdio' && !command.trim()) {
      setError('The server needs a command.')
      return
    }
    if (transport === 'http' && !url.trim()) {
      setError('The server needs a URL.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const draft: McpServerDraft = {
        id: initial?.id,
        name: name.trim(),
        transport,
        command: command.trim(),
        args,
        url: url.trim(),
        env: Object.fromEntries(
          envRows
            .filter((row) => row.key.trim() && row.value.trim())
            .map((row) => [row.key.trim(), row.value.trim()])
        ),
        removedEnvKeys: (initial?.envKeys ?? []).filter(
          (key) => !envRows.some((row) => row.key.trim() === key)
        )
      }
      const result = await window.api.saveMcpServer(draft)
      if (!result.ok) {
        setError(result.error || 'Could not save the server.')
        return
      }
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-dialog-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 id="mcp-dialog-title" className="text-sm font-semibold text-text-primary">
              {initial ? 'Edit MCP server' : 'Add MCP server'}
            </h2>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Prism runs stdio servers as child processes and keeps secrets encrypted.
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
          {!initial && presets.length > 0 && (
            <div>
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                Start from a preset
              </span>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    title={preset.description}
                    className="cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Filesystem"
                className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/50"
              />
            </label>
            <div>
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                Transport
              </span>
              <div className="flex rounded-lg border border-white/[0.09] bg-black/25 p-0.5">
                {(['stdio', 'http'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTransport(option)}
                    className={clsx(
                      'cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-wide transition-colors',
                      transport === option
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {transport === 'stdio' ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                  Command
                </span>
                <input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npx"
                  className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 font-mono text-[11.5px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/50"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                  Arguments <span className="text-text-muted">(one per line)</span>
                </span>
                <textarea
                  value={argsText}
                  onChange={(event) => setArgsText(event.target.value)}
                  rows={3}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\Users\\you\\Documents'}
                  className="w-full resize-none rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 font-mono text-[11px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent-primary/50"
                />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-text-secondary">URL</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 font-mono text-[11.5px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/50"
              />
            </label>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-text-secondary">
                Environment secrets
              </span>
              <button
                type="button"
                onClick={() => setEnvRows((rows) => [...rows, { key: '', value: '' }])}
                className="inline-flex cursor-pointer items-center gap-1 text-[10.5px] text-accent-primary hover:underline"
              >
                <Plus size={10} weight="bold" />
                Add variable
              </button>
            </div>
            {envRows.length === 0 ? (
              <p className="text-[10.5px] text-text-muted">
                Stored encrypted with the OS keychain, never in mcp.json.
              </p>
            ) : (
              <div className="space-y-1.5">
                {envRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      value={row.key}
                      onChange={(event) =>
                        setEnvRows((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, key: event.target.value } : entry
                          )
                        )
                      }
                      placeholder="API_KEY"
                      className="w-2/5 rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1.5 font-mono text-[10.5px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent-primary/50"
                    />
                    <input
                      value={row.value}
                      onChange={(event) =>
                        setEnvRows((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, value: event.target.value } : entry
                          )
                        )
                      }
                      placeholder={
                        initial?.envKeys.includes(row.key)
                          ? 'Leave blank to keep the stored value'
                          : 'Value'
                      }
                      type="password"
                      className="min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1.5 font-mono text-[10.5px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEnvRows((rows) => rows.filter((_, entryIndex) => entryIndex !== index))
                      }
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-rose-400/10 hover:text-rose-300"
                      title="Remove variable"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
              <Warning size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {submitting && (
            <p className="text-[10.5px] text-text-muted">
              Waiting for confirmation. In Safe mode Prism asks before installing or changing an MCP
              server.
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
            disabled={submitting}
            className="settings-primary-button cursor-pointer disabled:opacity-45"
          >
            <CheckCircle size={13} weight="bold" />
            {initial ? 'Save server' : 'Install server'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function GalleryCard({
  preset,
  server,
  status,
  connecting,
  onConnect
}: {
  preset: McpGalleryPreset
  server: McpServerConfig | undefined
  status: McpServerStatus | undefined
  connecting: string | null
  onConnect: (presetId: string) => Promise<void>
}): React.JSX.Element {
  const connected = Boolean(server?.enabled)
  const busy = connecting === preset.id
  const tools = status?.tools ?? []

  return (
    <article className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-accent-primary">
          <McpBrandIcon brand={preset.brand} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[12.5px] font-semibold text-text-primary">
              {preset.name}
            </h3>
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-medium',
                connected ? 'text-emerald-300' : 'text-text-muted'
              )}
            >
              {busy ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
              {connected ? 'Conectado' : 'Precisa de login'}
            </span>
            <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-text-muted">
              {preset.transport}
            </span>
            {tools.length > 0 && (
              <span className="text-[10px] text-text-muted">
                {tools.length} tool{tools.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
            {preset.transport === 'http' ? preset.url : [preset.command, ...preset.args].join(' ')}
          </p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-secondary">
            {preset.description}
          </p>
          {status?.error && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-rose-400/10 px-2 py-1 text-[10px] leading-relaxed text-rose-200">
              <XCircle size={11} className="mt-0.5 shrink-0" />
              <span className="break-words">{status.error}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void onConnect(preset.id)}
          disabled={busy || connected}
          className={clsx(
            'shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[11px] transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
            connected || busy
              ? 'border-white/[0.08] bg-white/[0.02] text-text-muted'
              : 'border-accent-primary/45 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25'
          )}
        >
          {busy ? 'Conectando…' : connected ? 'Conectado' : 'Conectar'}
        </button>
      </div>
    </article>
  )
}

export function McpSettings(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [presets, setPresets] = useState<McpInstallPreset[]>([])
  const [galleryPresets, setGalleryPresets] = useState<McpGalleryPreset[]>([])
  const [dialogTarget, setDialogTarget] = useState<McpServerConfig | null | 'new'>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [result, presetList, gallery] = await Promise.all([
        window.api.listMcpServers(),
        window.api.listMcpPresets(),
        window.api.listMcpGalleryPresets()
      ])
      setServers(result.servers)
      setStatuses(result.statuses)
      setPresets(presetList)
      setGalleryPresets(gallery)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.api.onMcpServersChanged(() => {
      void refresh()
    })
  }, [refresh])

  const statusById = useMemo(() => {
    const map = new Map<string, McpServerStatus>()
    for (const status of statuses) map.set(status.id, status)
    return map
  }, [statuses])

  const connectPreset = async (presetId: string): Promise<void> => {
    setConnecting(presetId)
    try {
      const result = await window.api.connectMcpPreset(presetId)
      if (!result.ok) {
        setError(result.error || `Não foi possível conectar ${presetId}.`)
      }
      await refresh()
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError))
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className="settings-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Galeria de integrações</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary/70">
              MCPs pré-configurados que precisam apenas de login. As credenciais ficam criptografadas
              no cofre do sistema; nada é gravado em texto simples.
            </p>
          </div>
        </div>

        {galleryPresets.length === 0 ? (
          <p className="mt-3 text-[11px] text-text-muted">Nenhuma integração disponível.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {galleryPresets.map((preset) => {
              const server = servers.find((s) => s.presetId === preset.id || s.id === preset.id)
              const status = statusById.get(server?.id ?? '')
              return (
                <GalleryCard
                  key={preset.id}
                  preset={preset}
                  server={server}
                  status={status}
                  connecting={connecting}
                  onConnect={connectPreset}
                />
              )
            })}
          </div>
        )}
      </section>

      <section className="settings-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">MCP servers</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary/70">
              Connect Model Context Protocol servers and attach them to Agenda tasks. Secrets are
              encrypted with the OS keychain; the server list stays portable in{' '}
              <span className="font-mono text-[10.5px]">mcp.json</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialogTarget('new')}
            className="settings-primary-button shrink-0 cursor-pointer"
          >
            <Plus size={13} weight="bold" />
            Add server
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
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

        <div className="mt-4 space-y-2">
          {servers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-8 text-center">
              <Plug size={20} className="mx-auto mb-2 text-text-muted" />
              <p className="text-[12px] font-medium text-text-primary">No MCP servers yet</p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-text-muted">
                Add a server once and reuse it across Agenda tasks. In Safe mode every install asks
                for your approval.
              </p>
            </div>
          ) : (
            servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                status={statusById.get(server.id)}
                onRefresh={async () => {
                  const result = await window.api.refreshMcpServer(server.id)
                  if (!result.ok) setError(result.error || 'The server did not start.')
                  await refresh()
                }}
                onToggle={async () => {
                  const result = await window.api.setMcpServerEnabled(server.id, !server.enabled)
                  if (!result.ok) setError(result.error || 'Could not update the server.')
                  await refresh()
                }}
                onDelete={async () => {
                  await window.api.deleteMcpServer(server.id)
                  await refresh()
                }}
                onEdit={() => setDialogTarget(server)}
              />
            ))
          )}
        </div>
      </section>

      <section className="settings-card">
        <h2 className="text-sm font-semibold text-text-primary">How Agenda uses MCP</h2>
        <ul className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-text-secondary">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-primary" />
            Attach servers per task in the Agenda task editor. Each run starts the server and exposes
            its tools to the executor.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-primary" />
            In Safe mode every tool call asks for permission with the exact arguments. YOLO skips the
            prompt but still writes the audit log.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-primary" />
            Servers run as child processes of Prism and are stopped when Prism quits.
          </li>
        </ul>
      </section>

      {dialogTarget !== null && (
        <ServerDialog
          initial={dialogTarget === 'new' ? null : dialogTarget}
          presets={presets}
          onClose={() => setDialogTarget(null)}
          onSaved={() => {
            setDialogTarget(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
