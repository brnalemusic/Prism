import React, { useState, useEffect } from 'react'
import { Robot as Bot, Plus, Trash, X, Play } from '@phosphor-icons/react'
import clsx from 'clsx'
import { MODELS } from '../constants'

interface SubagentDelegationModalProps {
  isOpen: boolean
  onClose: () => void
  onDelegate: (data: { model: string; prompts: string[] }) => void
  defaultSubagentModel: string
}

interface AgentInput {
  id: string
  prompt: string
}

export function SubagentDelegationModal({
  isOpen,
  onClose,
  onDelegate,
  defaultSubagentModel
}: SubagentDelegationModalProps): React.JSX.Element | null {
  const [selectedModel, setSelectedModel] = useState(defaultSubagentModel)
  const [agents, setAgents] = useState<AgentInput[]>([{ id: crypto.randomUUID(), prompt: '' }])
  const [isVisible, setIsVisible] = useState(false)

  // Sync open state animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setSelectedModel(defaultSubagentModel || 'prism-6-dragon')
      setAgents([{ id: crypto.randomUUID(), prompt: '' }])
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isOpen, defaultSubagentModel])

  if (!isOpen && !isVisible) return null

  const handleAddAgent = (): void => {
    setAgents((prev) => [...prev, { id: crypto.randomUUID(), prompt: '' }])
  }

  const handleRemoveAgent = (id: string): void => {
    if (agents.length <= 1) return
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }

  const handlePromptChange = (id: string, value: string): void => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, prompt: value } : a)))
  }

  const handleRun = (): void => {
    const prompts = agents.map((a) => a.prompt.trim()).filter(Boolean)
    if (prompts.length === 0) return

    onDelegate({
      model: selectedModel,
      prompts
    })
    onClose()
  }

  const isValid = agents.some((a) => a.prompt.trim().length > 0)

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300',
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/[0.55] backdrop-blur-xl" onClick={onClose} />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'premium-panel relative w-full max-w-2xl overflow-hidden rounded-[30px] transition-all duration-300 transform bg-background-main border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh]',
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/[0.04] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent-secondary/20 bg-accent-secondary/[0.08] text-accent-secondary">
              <Bot size={18} />
            </div>
            <h2 className="text-base font-semibold text-text-primary">Subagent Swarm Delegation</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary/50 transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-secondary/70">
              Orchestration Intelligence (Subagent Model)
            </label>
            <div className="relative w-full">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full appearance-none rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none cursor-pointer"
              >
                {MODELS.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    className="bg-[#13151a] text-text-primary"
                  >
                    {model.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-text-secondary/70">
                <svg
                  className="fill-current h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="h-px bg-white/[0.04]" />

          {/* Agents Prompts Swarm */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary/70">
                Agent Tasks ({agents.length})
              </label>
              <button
                onClick={handleAddAgent}
                className="flex items-center gap-1 text-[11px] font-bold text-accent-secondary hover:text-accent-secondary/80 transition-colors uppercase tracking-wider focus:outline-none"
              >
                <Plus size={12} weight="bold" />
                Add Agent
              </button>
            </div>

            <div className="space-y-4">
              {agents.map((agent, index) => (
                <div
                  key={agent.id}
                  className="premium-panel-soft rounded-2xl border border-white/[0.05] bg-white/[0.015] p-4 flex flex-col gap-3 relative animate-soft-pop"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-secondary/60">
                      Agent #{index + 1}
                    </span>
                    {agents.length > 1 && (
                      <button
                        onClick={() => handleRemoveAgent(agent.id)}
                        className="text-text-secondary/40 hover:text-status-error transition-colors p-1 rounded-lg hover:bg-white/5 focus:outline-none"
                        title="Remove Agent"
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </div>

                  <textarea
                    value={agent.prompt}
                    onChange={(e) => handlePromptChange(agent.id, e.target.value)}
                    placeholder="Specify what this agent should accomplish..."
                    className="w-full min-h-[80px] max-h-[200px] resize-y bg-white/[0.02] border border-white/[0.08] rounded-xl p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-secondary/40 focus:outline-none transition-all"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-6 border-t border-white/[0.04] flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-2 text-sm font-semibold text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all active:scale-[0.98] focus:outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleRun}
            disabled={!isValid}
            className={clsx(
              'flex items-center gap-2 rounded-2xl px-6 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus:outline-none',
              isValid
                ? 'bg-text-primary text-black hover:bg-white cursor-pointer shadow-md'
                : 'bg-white/[0.055] text-text-muted cursor-not-allowed'
            )}
          >
            <Play size={14} weight="fill" />
            Run
          </button>
        </div>
      </div>
    </div>
  )
}
