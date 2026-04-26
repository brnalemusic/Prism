import { useState, useEffect } from 'react'
import { Key, Shield, Info, X } from 'lucide-react'
import clsx from 'clsx'

interface ApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (key: string) => void
}

export function ApiKeyModal({ isOpen, onClose, onSave }: ApiKeyModalProps): React.JSX.Element | null {
  const [apiKey, setApiKey] = useState('')
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isOpen])

  if (!isVisible && !isOpen) return null

  const handleSave = (): void => {
    if (apiKey.trim()) {
      onSave(apiKey.trim())
      onClose()
    }
  }

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300',
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-[#000]/60 backdrop-blur-md" 
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={clsx(
          'relative w-full max-w-md bg-[#0A0A0F] border border-surface/40 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-300 transform',
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
      >
        {/* Glow effect */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-accent-primary/50 to-transparent" />
        
        <div className="p-8 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-primary/10 flex items-center justify-center text-accent-primary border border-accent-primary/20">
                <Key size={20} />
              </div>
              <div className="flex flex-col">
                <h2 className="text-lg font-bold text-text-primary tracking-tight">Gemini API Key</h2>
                <span className="text-[10px] uppercase tracking-widest font-bold text-accent-secondary/60">Configure seu próprio acesso</span>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="text-text-secondary/40 hover:text-text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              Para continuar usando o Prism sem interrupções, você pode configurar sua própria chave de API.
            </p>

            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Insira sua Gemini API Key aqui..."
                className="w-full bg-[#111118] border border-surface/60 rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/30 transition-all"
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 p-4 bg-status-success/5 border border-status-success/10 rounded-xl">
                <Shield size={16} className="text-status-success shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-status-success/90">Segurança Total</span>
                  <p className="text-[11px] text-status-success/70 leading-normal">
                    Sua chave é salva apenas localmente no seu computador e criptografada pelo sistema. O Prism usa sua própria conexão de internet para falar com a API, sem passar por nenhum serviço intermediário ou telemetria.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-accent-primary/5 border border-accent-primary/10 rounded-xl">
                <Info size={16} className="text-accent-secondary shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-accent-secondary/90">Como obter?</span>
                  <p className="text-[11px] text-accent-secondary/70 leading-normal">
                    Você pode criar uma chave gratuita no <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="underline hover:text-accent-secondary transition-colors">Google AI Studio</a>.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl border border-surface/60 text-sm font-bold text-text-secondary hover:bg-surface/10 hover:text-text-primary transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim()}
              className="flex-1 px-4 py-3 rounded-xl bg-accent-primary text-sm font-bold text-[#fff] hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(108,99,255,0.2)]"
            >
              Salvar Chave
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
