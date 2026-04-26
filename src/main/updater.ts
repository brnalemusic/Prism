import { dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Desabilita auto-download para que possamos perguntar ao usuário antes
  autoUpdater.autoDownload = false
  
  // No modo de desenvolvimento, geralmente não queremos checar updates
  // a menos que estejamos testando especificamente o updater
  if (is.dev) {
    // Para testar em dev, você pode comentar o return abaixo
    // Mas lembre-se que o electron-updater precisa de um app empacotado para funcionar 100%
    return
  }

  autoUpdater.on('update-available', (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização Disponível',
        message: `Uma nova versão (${info.version}) do Prism está disponível. Deseja baixar agora?`,
        buttons: ['Sim', 'Depois'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
  })

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização Pronta',
        message: `A versão ${info.version} foi baixada e está pronta para ser instalada. Deseja reiniciar e instalar agora?`,
        buttons: ['Reiniciar e Instalar', 'Depois'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('Erro no Auto-Updater:', err)
  })

  // Inicia a checagem
  autoUpdater.checkForUpdatesAndNotify()
}
