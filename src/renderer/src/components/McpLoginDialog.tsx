import React, { useEffect, useRef, useState } from 'react'
import { CaretRight, Eye, X } from '@phosphor-icons/react'
import type { McpLoginRequest } from '../../../shared/mcpTypes'
import { McpBrandIcon } from './McpBrandIcon'

interface McpLoginDialogProps {
  request: McpLoginRequest | null
  onClose: () => void
  onResolve: (resolution: { cancelled?: boolean; values?: Record<string, string> }) => void
}

export function McpLoginDialog({
  request,
  onClose,
  onResolve
}: McpLoginDialogProps): React.JSX.Element | null {
  if (!request) return null

  const preset = request
  const [values, setValues] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(): void {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const next: Record<string, string> = {}
      for (const field of preset.fields) {
        const value = (values[field.key] ?? '').trim()
        if (!value && field.secret) {
          setError(`${field.label} is required.`)
          setSubmitting(false)
          return
        }
        next[field.key] = value
      }
      onResolve({ values: next })
    } finally {
      setSubmitting(false)
    }
  }

  function handleCancel(): void {
    onResolve({ cancelled: true })
  }

  function toggleSecret(key: string): void {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    void firstInputRef.current?.focus()
  }, [request])

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] shadow-[0_28px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-login-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <McpBrandIcon brand={request.brand} size={20} />
            </div>
            <div>
              <h2 id="mcp-login-title" className="text-sm font-semibold text-text-primary">
                Conectar {request.presetName}
              </h2>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                {request.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.07] hover:text-text-primary"
            title="Cancelar"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 custom-scrollbar">
          <div className="space-y-2.5">
            {request.fields.map((field) => {
              const secret = Boolean(field.secret)
              const shown = showSecrets[field.key] ?? false
              return (
                <div key={field.key} className="space-y-1">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-text-secondary">
                      {field.label}
                    </span>
                    <input
                      ref={
                        field.key === preset.fields[0]?.key
                          ? firstInputRef
                          : undefined
                      }
                      type={secret && !shown ? 'password' : 'text'}
                      autoComplete="off"
                      value={values[field.key] ?? ''}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      placeholder={field.placeholder ?? undefined}
                      className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-primary/50"
                    />
                    {field.hint && (
                      <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">
                        {field.hint}
                      </p>
                    )}
                    {field.helpUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          void window.api.openExternalUrl(field.helpUrl!)
                        }}
                        className="inline-flex cursor-pointer items-center gap-1 text-[10px] text-accent-primary hover:underline"
                      >
                        <CaretRight size={11} />
                        {field.helpLabel || 'Saiba mais'}
                      </button>
                    )}
                  </label>
                  {secret && (
                    <button
                      type="button"
                      onClick={() => toggleSecret(field.key)}
                      className="flex cursor-pointer items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary"
                    >
                      {shown ? <Eye size={12} /> : <Eye size={12} />}
                      {shown ? 'Ocultar' : 'Mostrar'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
              <X size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {submitting && (
            <p className="text-[10.5px] text-text-muted">Conectando… aguarde.</p>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button
            type="button"
            onClick={handleCancel}
            className="settings-secondary-button cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="settings-primary-button cursor-pointer disabled:opacity-45"
          >
            {submitting ? 'Conectando…' : 'Conectar'}
          </button>
        </footer>
      </section>
    </div>
  )
}

McpLoginDialog.displayName = 'McpLoginDialog'
