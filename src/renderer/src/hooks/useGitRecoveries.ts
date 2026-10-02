import { useEffect, useState } from 'react'
import type { HarnessGitRecovery } from '../../../shared/types'

export function useGitRecoveries(projectPath?: string, chatId?: string): HarnessGitRecovery[] {
  const [records, setRecords] = useState<HarnessGitRecovery[]>([])
  useEffect(() => {
    let disposed = false
    let loading = false
    const merge = (updates: HarnessGitRecovery[]): void => {
      if (disposed) return
      setRecords((previous) => {
        const next = new Map(previous.filter((r) => r.projectPath === projectPath && r.chatIds.includes(chatId || '')).map((r) => [r.id, r]))
        for (const r of updates) if (!next.has(r.id) || next.get(r.id)!.revision < r.revision) next.set(r.id, r)
        return [...next.values()]
      })
    }
    const refresh = async (): Promise<void> => {
      if (!projectPath || !chatId || loading || document.hidden) return
      loading = true
      try { merge(await window.api.getHarnessGitRecoveries(projectPath, chatId)) }
      catch { /* Keep the last record; mutations always revalidate in the main process. */ }
      finally { loading = false }
    }
    const unsubscribe = window.api.onHarnessGitRecoveryChanged((r) => {
      if (r.projectPath === projectPath && r.chatIds.includes(chatId || '')) merge([r])
    })
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; unsubscribe(); clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [projectPath, chatId])
  return records.filter((r) => r.projectPath === projectPath && r.chatIds.includes(chatId || ''))
}
