import React, { useEffect, useState } from 'react'
import { Sparkle, Warning, Info, ArrowRight, Download, CheckCircle, WarningOctagon } from '@phosphor-icons/react'
import { AppConfig } from '../../../main/config'

export function UpdaterView(): React.JSX.Element {
  const [state, setState] = useState<{
    status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'
    currentVersion: string
    latestVersion: string
    recommendationLevel: 'patch' | 'minor' | 'major'
    releaseNotes: string
    progress?: {
      percent: number
      speed: number
      transferred: number
      total: number
    }
    error?: string
  }>({
    status: 'checking',
    currentVersion: '',
    latestVersion: '',
    recommendationLevel: 'patch',
    releaseNotes: ''
  })

  useEffect(() => {
    // Load config to apply the selected theme
    const loadConfig = async (): Promise<void> => {
      let c: AppConfig | null = null
      try {
        if (window.api && (window.api as any).getConfig) {
          c = await (window.api as any).getConfig()
        } else {
          c = window.electron.ipcRenderer.sendSync('get-config-sync')
        }
        if (c && c.theme) {
          document.documentElement.setAttribute('data-theme', c.theme)
        }
      } catch (err) {
        console.error('Failed to load config for theme:', err)
      }
    }
    loadConfig()

    // Fetch initial updater state
    window.api.getUpdaterState()
      .then((initialState: any) => {
        if (initialState) setState(initialState)
      })
      .catch(console.error)

    // Register updater state push notifications
    const removeListener = window.api.onUpdaterState((newState: any) => {
      if (newState) setState(newState)
    })

    return () => removeListener()
  }, [])

  const handleDownload = (): void => {
    window.api.downloadUpdate()
  }

  const handleInstall = (): void => {
    window.api.installUpdate()
  }

  const handleClose = (): void => {
    window.electron.ipcRenderer.send('close-updater-window')
  }

  const isDev = !!window.api.devTriggerUpdaterUi

  // Set recommendation level styling parameters
  let recStyle = {
    bg: 'bg-green-500/10 border-green-500/20 text-green-400',
    icon: <Sparkle size={14} className="animate-pulse" />,
    label: 'Recomendação Baixa (Patch)'
  }
  if (state.recommendationLevel === 'major') {
    recStyle = {
      bg: 'bg-red-500/10 border-red-500/20 text-red-400',
      icon: <Warning size={14} className="animate-bounce" />,
      label: 'Recomendação Crítica (Major Update)'
    }
  } else if (state.recommendationLevel === 'minor') {
    recStyle = {
      bg: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
      icon: <Info size={14} />,
      label: 'Recomendação Importante (Minor Update)'
    }
  }

  return (
    <div className="relative flex flex-col h-screen w-screen bg-background-main text-text-primary overflow-hidden font-sans select-none border border-white/[0.06] rounded-xl">
      
      {/* Draggable Title Bar */}
      <div className="flex h-10 w-full items-center justify-between border-b border-white/[0.055] bg-background-secondary/90 px-4 drag-region shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-accent-primary to-accent-secondary text-[10px] font-bold text-background-main select-none">
            P
          </div>
          <span className="text-[12px] font-semibold tracking-wide text-text-secondary">Atualizador Prism</span>
        </div>
        
        {/* Render close button only if status is error or not-available */}
        {(state.status === 'error' || state.status === 'not-available') && (
          <button
            onClick={handleClose}
            className="no-drag-region flex h-6 w-6 items-center justify-center rounded hover:bg-white/[0.08] text-text-muted hover:text-text-primary transition duration-150 text-[18px]"
            title="Fechar"
          >
            &times;
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between p-6 bg-gradient-to-b from-background-secondary/40 to-background-main/80">
        
        {state.status === 'checking' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-accent-primary/20 border-t-accent-primary animate-spin" />
            <div>
              <h2 className="text-[14px] font-medium text-text-primary">Buscando atualizações...</h2>
              <p className="text-[11px] text-text-muted mt-1 max-w-[280px]">Verificando lançamentos no repositório GitHub do Prism.</p>
            </div>
          </div>
        )}

        {state.status === 'not-available' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              <CheckCircle size={24} />
            </div>
            <div>
              <h2 className="text-[14px] font-medium text-text-primary">Você está atualizado!</h2>
              <p className="text-[11px] text-text-muted mt-1">O Prism já está executando a versão mais recente.</p>
            </div>
            <button
              onClick={handleClose}
              className="mt-2 px-5 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-text-primary text-[11px] font-medium rounded-lg transition duration-200 no-drag-region"
            >
              Fechar Janela
            </button>
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-error/10 text-status-error border border-status-error/20">
              <WarningOctagon size={24} />
            </div>
            <div className="max-w-[420px]">
              <h2 className="text-[14px] font-medium text-text-primary">Erro ao verificar atualizações</h2>
              <div className="text-[10px] text-status-error/90 font-mono mt-2 bg-status-error/5 p-2 rounded border border-status-error/15 break-all select-text max-h-[100px] overflow-y-auto scrollbar-thin text-left">
                {state.error || 'Não foi possível baixar os metadados do update.'}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 no-drag-region">
              <button
                onClick={handleDownload}
                className="px-4 py-1.5 bg-accent-primary text-background-main hover:brightness-110 font-bold text-[11px] rounded-lg transition duration-200"
              >
                Tentar Novamente
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-text-primary text-[11px] font-medium rounded-lg transition duration-200"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {(state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded') && (
          <div className="flex-1 flex flex-col justify-between">
            
            {/* Version diff details */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center justify-center gap-4 bg-white/[0.02] border border-white/[0.04] py-2.5 px-6 rounded-xl w-full">
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-text-muted font-medium uppercase tracking-wider">Versão Atual</span>
                  <span className="text-[14px] font-bold text-text-secondary mt-0.5">v{state.currentVersion}</span>
                </div>
                <ArrowRight size={16} className="text-text-muted mt-2" />
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-text-muted font-medium uppercase tracking-wider">Nova Versão</span>
                  <span className="text-[14px] font-bold text-accent-primary mt-0.5">v{state.latestVersion}</span>
                </div>
              </div>

              {/* Recommendation level badge */}
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-medium tracking-wide ${recStyle.bg}`}>
                {recStyle.icon}
                <span>{recStyle.label}</span>
              </div>
            </div>

            {/* Middle state-dependent body */}
            {state.status === 'available' && (
              <div className="flex-1 flex flex-col justify-center items-center py-2">
                <p className="text-[11.5px] text-text-secondary text-center max-w-[340px] leading-relaxed">
                  Uma nova atualização está disponível. O download será feito de forma invisível em segundo plano.
                </p>
                {state.releaseNotes && (
                  <div className="w-full mt-3 p-2 bg-white/[0.015] border border-white/[0.04] rounded-lg max-h-[75px] overflow-y-auto text-[10px] text-text-muted scrollbar-thin select-text text-left">
                    <div className="font-semibold text-text-secondary mb-0.5">Notas da versão:</div>
                    {state.releaseNotes}
                  </div>
                )}
              </div>
            )}

            {state.status === 'downloading' && (
              <div className="flex-1 flex flex-col justify-center gap-3 py-2 w-full px-1">
                <div className="flex justify-between items-center text-[10.5px] text-text-secondary">
                  <span>Baixando arquivos...</span>
                  <span className="font-semibold text-accent-primary">{(state.progress?.percent || 0)}%</span>
                </div>
                
                {/* Horizontal Progress Bar */}
                <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden border border-white/[0.02]">
                  <div 
                    className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary rounded-full transition-all duration-150 ease-out" 
                    style={{ width: `${state.progress?.percent || 0}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[9.5px] text-text-muted">
                  <span>
                    {((state.progress?.transferred || 0) / (1024 * 1024)).toFixed(1)} MB / {((state.progress?.total || 0) / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  <span className="font-mono">
                    {((state.progress?.speed || 0) / (1024 * 1024)).toFixed(1)} MB/s
                  </span>
                </div>
              </div>
            )}

            {state.status === 'downloaded' && (
              <div className="flex-1 flex flex-col justify-center items-center text-center py-2 gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                  <CheckCircle size={20} />
                </div>
                <div>
                  <h3 className="text-[12.5px] font-semibold text-text-primary">Download Concluído</h3>
                  <p className="text-[10.5px] text-text-muted mt-0.5 max-w-[320px]">
                    Prism está pronto para reiniciar e instalar a nova versão silenciosamente.
                  </p>
                </div>
              </div>
            )}

            {/* Bottom action button */}
            <div className="mt-4 no-drag-region">
              {state.status === 'available' && (
                <button
                  onClick={handleDownload}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-accent-primary to-accent-secondary hover:brightness-105 active:scale-[0.99] transition duration-200 text-background-main font-bold text-[12px] rounded-lg shadow-md shadow-accent-primary/5"
                >
                  <Download size={14} weight="bold" />
                  <span>Baixar Update</span>
                </button>
              )}

              {state.status === 'downloading' && (
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-2 py-2 bg-white/[0.03] border border-white/[0.06] text-text-muted text-[12px] font-semibold rounded-lg cursor-not-allowed"
                >
                  <div className="w-3 h-3 border-2 border-text-muted/20 border-t-text-muted animate-spin rounded-full" />
                  <span>Baixando Atualização...</span>
                </button>
              )}

              {state.status === 'downloaded' && (
                <button
                  onClick={handleInstall}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-green-400 to-[#79d89f] hover:brightness-105 active:scale-[0.99] transition duration-200 text-background-main font-bold text-[12px] rounded-lg shadow-md shadow-green-500/10"
                >
                  <CheckCircle size={14} weight="bold" />
                  <span>Instalar Agora</span>
                </button>
              )}
            </div>

          </div>
        )}

      </div>

      {/* Floating Development Sim Toolbar */}
      {isDev && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 bg-black/60 border border-white/[0.08] rounded-full z-50 text-[9px] font-mono no-drag-region shadow-lg">
          <span className="text-text-muted select-none">SIM:</span>
          <button 
            onClick={() => window.api.devTriggerUpdaterUi!('patch')} 
            className="px-1.5 py-0.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded border border-green-500/30"
          >
            Patch
          </button>
          <button 
            onClick={() => window.api.devTriggerUpdaterUi!('minor')} 
            className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded border border-yellow-500/30"
          >
            Minor
          </button>
          <button 
            onClick={() => window.api.devTriggerUpdaterUi!('major')} 
            className="px-1.5 py-0.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded border border-red-500/30"
          >
            Major
          </button>
          <button 
            onClick={() => window.api.devSimulateUpdaterProgress?.()} 
            className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded border border-blue-500/30"
          >
            Progress
          </button>
        </div>
      )}
    </div>
  )
}
