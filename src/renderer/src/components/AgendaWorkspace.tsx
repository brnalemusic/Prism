import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  CalendarPlus,
  CaretLeft,
  CaretRight,
  ChatTeardropText,
  Check,
  DotsThree,
  List,
  Plus,
  Sparkle,
  Trash,
  X
} from '@phosphor-icons/react'
import type { AppConfig } from '../../../main/config'
import type {
  AgendaAgent,
  AgendaRunRecord,
  AgendaTask,
  AgendaTaskStatus
} from '../../../shared/agendaTypes'
import type { McpServerConfig } from '../../../shared/mcpTypes'
import { LiquidGlassSurface } from './LiquidGlassSurface'
import { ModelSelector } from './ModelSelector'
import ReactMarkdown from 'react-markdown'

const REMARK_PLUGINS: any[] = []

type ChatMsg = {
  role: 'user' | 'ai' | 'separator'
  content: string
  thoughts?: string
  toolCalls?: any[]
  streamingToolCalls?: any[]
  isStreaming?: boolean
  isThinking?: boolean
  separatorType?: 'error' | 'info'
  workedDuration?: number
}

type AgendaTab = {
  id: string
  agentId: string
  kind: 'creation' | 'schedule'
  scheduleId?: string
  title: string
  isProcessing: boolean
}

const STATUS_META: Record<AgendaTaskStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'text-text-muted' },
  active: { label: 'Active', className: 'text-accent-primary' },
  paused: { label: 'Paused', className: 'text-amber-300' },
  completed: { label: 'Completed', className: 'text-emerald-300' },
  cancelled: { label: 'Cancelled', className: 'text-text-muted' }
}

function isAgendaChatId(chatId: string): boolean {
  return chatId.startsWith('agenda-agent-') || chatId.startsWith('agenda-')
}

function normalizeTaskStatus(status: unknown): AgendaTaskStatus {
  if (status === 'draft' || status === 'active' || status === 'paused' || status === 'completed' || status === 'cancelled') {
    return status
  }
  return 'paused'
}

export function AgendaWorkspace({
  config,
  isActive: _isActive
}: {
  config: AppConfig | null
  isActive?: boolean
}): React.JSX.Element {
  const [agents, setAgents] = useState<AgendaAgent[]>([])
  const [tasks, setTasks] = useState<AgendaTask[]>([])
  const [runs, setRuns] = useState<AgendaRunRecord[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [tabs, setTabs] = useState<AgendaTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('agenda-sidebar-open') !== 'false'
    } catch {
      return true
    }
  })
  const [allAgentsView, setAllAgentsView] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('main')
  const [composerText, setComposerText] = useState('')
  const [modelKey, setModelKey] = useState<string | null>(config?.agenda?.modelKey ?? null)
  const [permissionMode, setPermissionMode] = useState<'safe' | 'yolo'>(config?.agenda?.permissionMode ?? 'safe')
  const [manualOpen, setManualOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<AgendaTask | null>(null)
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)
  const [deleteChallenge, setDeleteChallenge] = useState<any>(null)
  const [deleteStepAnswer, setDeleteStepAnswer] = useState('')
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false)
  const [transcripts, setTranscripts] = useState<Record<string, ChatMsg[]>>({})
  const [processing, setProcessing] = useState<Record<string, boolean>>({})
  const [selectedRunByTask, setSelectedRunByTask] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 3200) }

  useEffect(() => {
    try {
      localStorage.setItem('agenda-sidebar-open', String(sidebarOpen))
    } catch {
      /* ignore */
    }
  }, [sidebarOpen])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId

  const loadData = useCallback(async () => {
    try {
      const [agentList, taskList, runList, settings, mcp] = await Promise.all([
        window.api.listAgendaAgents(),
        window.api.listAgendaTasks(),
        window.api.listAgendaRuns(),
        window.api.getAgendaSettings(),
        window.api.listMcpServers()
      ])
      setAgents(agentList)
      setTasks(taskList.map((task) => ({ ...task, status: normalizeTaskStatus(task.status) })))
      setRuns(runList)
      setModelKey(settings.modelKey)
      setPermissionMode(settings.permissionMode)
      setMcpServers(mcp.servers)
    } catch (error) {
      console.error('[Agenda] failed to load data:', error)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Ensure at least one creation tab exists for the main agent.
  useEffect(() => {
    if (tabs.length === 0 && agents.length > 0) {
      const main = agents.find((agent) => agent.isMain) ?? agents[0]
      setTabs([
        {
          id: `creation-${main.id}`,
          agentId: main.id,
          kind: 'creation',
          title: main.title,
          isProcessing: false
        }
      ])
      setActiveTabId(`creation-${main.id}`)
      setSelectedAgentId(main.id)
    }
  }, [agents, tabs.length])

  // Subscriptions
  useEffect(() => {
    const unsubTasks = window.api.onAgendaTasksChanged(() => void loadData())
    const unsubRuns = window.api.onAgendaRunsChanged(() => void loadData())
    const unsubAgents = window.api.onAgendaAgentsChanged(() => void loadData())
    const unsubSettings = window.api.onAgendaSettingsChanged((settings) => {
      setModelKey(settings.modelKey)
      setPermissionMode(settings.permissionMode)
    })
    return () => {
      unsubTasks()
      unsubRuns()
      unsubAgents()
      unsubSettings()
    }
  }, [loadData])

  // Chat event subscriptions for live transcripts.
  useEffect(() => {
    const handleStart = (data: any) => {
      if (!isAgendaChatId(data.chatId)) return
      setTranscripts((prev) => {
        const next = [...(prev[data.chatId] ?? [])]
        next.push({ role: 'user', content: data.userMessage?.content ?? '' })
        next.push({ role: 'ai', content: '', isStreaming: true, toolCalls: [] })
        return { ...prev, [data.chatId]: next }
      })
      setProcessing((prev) => ({ ...prev, [data.chatId]: true }))
      // mark tab processing
      setTabs((prev) =>
        prev.map((tab) => {
          const chatId = tab.kind === 'creation' ? `agenda-agent-${tab.agentId}` : undefined
          return chatId === data.chatId ? { ...tab, isProcessing: true } : tab
        })
      )
    }
    const handleChunk = (data: any) => {
      if (!isAgendaChatId(data.chatId)) return
      setTranscripts((prev) => {
        const list = [...(prev[data.chatId] ?? [])]
        const idx = list.findLastIndex((m) => m.role === 'ai')
        if (idx === -1) return prev
        const msg = { ...list[idx] }
        if (typeof data.finalResponse === 'string') msg.content = data.finalResponse
        if (typeof data.thoughts === 'string') msg.thoughts = data.thoughts
        msg.isStreaming = true
        list[idx] = msg
        return { ...prev, [data.chatId]: list }
      })
    }
    const handleToolStart = (data: any) => {
      if (!isAgendaChatId(data.chatId)) return
      setTranscripts((prev) => {
        const list = [...(prev[data.chatId] ?? [])]
        const idx = list.findLastIndex((m) => m.role === 'ai')
        if (idx === -1) return prev
        const msg = { ...list[idx] }
        const toolCalls = [...(msg.toolCalls ?? [])]
        toolCalls.push({
          id: data.callId,
          name: data.name,
          args: data.args ?? {},
          status: 'running'
        })
        msg.toolCalls = toolCalls
        list[idx] = msg
        return { ...prev, [data.chatId]: list }
      })
    }
    const handleToolEnd = (data: any) => {
      if (!isAgendaChatId(data.chatId)) return
      setTranscripts((prev) => {
        const list = [...(prev[data.chatId] ?? [])]
        const idx = list.findLastIndex((m) => m.role === 'ai')
        if (idx === -1) return prev
        const msg = { ...list[idx] }
        const toolCalls = (msg.toolCalls ?? []).map((tc: any) =>
          tc.id === data.callId
            ? {
                ...tc,
                status: data.result && isToolErrorResult(data.result) ? 'error' : 'done',
                result: data.result
              }
            : tc
        )
        msg.toolCalls = toolCalls
        list[idx] = msg
        return { ...prev, [data.chatId]: list }
      })
    }
    const handleEnd = (data: any) => {
      if (!isAgendaChatId(data.chatId)) return
      setTranscripts((prev) => {
        const list = [...(prev[data.chatId] ?? [])]
        const idx = list.findLastIndex((m) => m.role === 'ai')
        if (idx !== -1) {
          list[idx] = { ...list[idx], isStreaming: false }
        }
        return { ...prev, [data.chatId]: list }
      })
      setProcessing((prev) => ({ ...prev, [data.chatId]: false }))
      setTabs((prev) =>
        prev.map((tab) => {
          const chatId = tab.kind === 'creation' ? `agenda-agent-${tab.agentId}` : undefined
          return chatId === data.chatId ? { ...tab, isProcessing: false } : tab
        })
      )
      void loadData()
    }
    const handleError = (data: any) => {
      if (!isAgendaChatId(data.chatId)) return
      setTranscripts((prev) => {
        const list = [...(prev[data.chatId] ?? [])]
        list.push({ role: 'separator', content: data.error || 'Error', separatorType: 'error' })
        return { ...prev, [data.chatId]: list }
      })
      setProcessing((prev) => ({ ...prev, [data.chatId]: false }))
      setTabs((prev) =>
        prev.map((tab) => {
          const chatId = tab.kind === 'creation' ? `agenda-agent-${tab.agentId}` : undefined
          return chatId === data.chatId ? { ...tab, isProcessing: false } : tab
        })
      )
    }

    const unsubs = [
      window.api.onChatStart(handleStart),
      window.api.onChatChunk(handleChunk),
      window.api.onToolStart(handleToolStart),
      window.api.onToolEnd(handleToolEnd),
      window.api.onChatEnd(handleEnd),
      window.api.onChatError(handleError)
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [loadData])

  function isToolErrorResult(result?: string): boolean {
    if (!result) return false
    try {
      const parsed = JSON.parse(result)
      return parsed?.ok === false
    } catch {
      return false
    }
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    setAllAgentsView(false)
  }, [])

  const handleNewAgent = useCallback(async () => {
    const result = await window.api.createAgendaAgent('New Agenda agent')
    if (result.ok && result.agent) {
      await loadData()
      const tabId = `creation-${result.agent.id}`
      setTabs((prev) => [
        ...prev,
        { id: tabId, agentId: result.agent!.id, kind: 'creation', title: result.agent!.title, isProcessing: false }
      ])
      setActiveTabId(tabId)
      setSelectedAgentId(result.agent.id)
    }
  }, [loadData])

  const handleOpenSchedule = useCallback((task: AgendaTask) => {
    const existing = tabs.find((tab) => tab.kind === 'schedule' && tab.scheduleId === task.id)
    if (existing) {
      setActiveTabId(existing.id)
      return
    }
    if (tabs.length >= 5) {
      showToast('Agenda supports at most 5 open tabs.')
      return
    }
    const tab: AgendaTab = {
      id: `schedule-${task.id}`,
      agentId: task.agentId,
      kind: 'schedule',
      scheduleId: task.id,
      title: task.title,
      isProcessing: false
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setSelectedAgentId(task.agentId)
    // load transcript for latest run
    const taskRuns = runs.filter((run) => run.taskId === task.id).sort((a, b) => b.startedAt - a.startedAt)
    if (taskRuns[0]) {
      setSelectedRunByTask((prev) => ({ ...prev, [task.id]: taskRuns[0].id }))
      const chatId = `agenda-${taskRuns[0].id}`
      if (!transcripts[chatId]) {
        window.api.loadAgendaTranscript(chatId).then((session: any) => {
          if (session?.messages) {
            const msgs: ChatMsg[] = []
            for (const m of session.messages) {
              if (m.role === 'system' || m.role === 'tool') continue
              if (m.role === 'user') {
                msgs.push({ role: 'user', content: extractText(m) })
              } else if (m.role === 'assistant' || m.role === 'model') {
                const toolCalls = (m.tool_calls ?? []).map((tc: any) => {
                  const toolMsg = session.messages.find((x: any) => x.role === 'tool' && x.tool_call_id === tc.id)
                  return {
                    id: tc.id,
                    name: tc.function?.name,
                    args: safeJson(tc.function?.arguments),
                    status: toolMsg ? 'done' : 'done',
                    result: toolMsg?.content
                  }
                })
                msgs.push({
                  role: 'ai',
                  content: extractText(m),
                  thoughts: m.reasoning_content || m.thoughts,
                  toolCalls: toolCalls.length ? toolCalls : undefined
                })
              }
            }
            setTranscripts((prev) => ({ ...prev, [chatId]: msgs }))
          }
        })
      }
    }
  }, [tabs, runs, transcripts])

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== tabId)
      if (activeTabId === tabId && next.length > 0) {
        setActiveTabId(next[next.length - 1].id)
      }
      return next
    })
  }, [activeTabId])

  const handleSend = useCallback(async () => {
    if (!activeTab || activeTab.kind !== 'creation') return
    const text = composerText.trim()
    if (!text) return
    setComposerText('')
    setTabs((prev) => prev.map((tab) => (tab.id === activeTab.id ? { ...tab, isProcessing: true } : tab)))
    await window.api.sendAgendaAgentMessage({ agentId: activeTab.agentId, message: text, modelKey })
  }, [activeTab, composerText, modelKey])

  const handleCancel = useCallback(() => {
    if (!activeTab) return
    if (activeTab.kind === 'creation') {
      window.api.cancelAgendaAgent(`agenda-agent-${activeTab.agentId}`)
    }
  }, [activeTab])

  const handleManualSubmit = useCallback(
    async (input: any) => {
      const result = await window.api.createAgendaTask(input)
      if (result.ok) {
        setManualOpen(false)
        setEditingTask(null)
        void loadData()
      } else {
        showToast(result.error || 'Could not create the schedule.')
      }
    },
    [loadData]
  )

  const startDeleteAgent = useCallback(async (agentId: string) => {
    const challenge = await window.api.startAgendaAgentDeletion(agentId)
    if (challenge.ok) {
      setDeleteAgentId(agentId)
      setDeleteChallenge(challenge.challenge)
      setDeleteStepAnswer('')
      setDeleteAcknowledged(false)
    } else {
      showToast(challenge.error || 'Could not start deletion.')
    }
  }, [])

  const advanceDelete = useCallback(async () => {
    if (!deleteChallenge) return
    const input: any = { challengeId: deleteChallenge.challengeId }
    if (deleteChallenge.step === 1) input.acknowledged = deleteAcknowledged
    else input.answer = deleteStepAnswer
    const result = await window.api.advanceAgendaAgentDeletion(input)
    if (result.ok) {
      if (result.complete) {
        setDeleteChallenge({ ...deleteChallenge, verifiedAt: Date.now() })
      } else if (result.challenge) {
        setDeleteChallenge(result.challenge)
        setDeleteStepAnswer('')
      }
    } else {
      showToast(result.error || 'Verification failed.')
      if (result.challenge) setDeleteChallenge(result.challenge)
    }
  }, [deleteChallenge, deleteAcknowledged, deleteStepAnswer])

  const confirmDeleteAgent = useCallback(async () => {
    if (!deleteAgentId || !deleteChallenge) return
    const result = await window.api.deleteAgendaAgent({ agentId: deleteAgentId, challengeId: deleteChallenge.challengeId })
    if (result.ok) {
      setDeleteAgentId(null)
      setDeleteChallenge(null)
      // close tabs for that agent
      setTabs((prev) => prev.filter((tab) => tab.agentId !== deleteAgentId))
      if (tabsRef.current.every((tab) => tab.agentId === deleteAgentId)) {
        // keep at least main
      }
      void loadData()
    } else {
      showToast(result.error || 'Could not delete the agent.')
    }
  }, [deleteAgentId, deleteChallenge, loadData])

  const cancelDelete = useCallback(() => {
    if (deleteChallenge?.challengeId) window.api.cancelAgendaAgentDeletion(deleteChallenge.challengeId)
    setDeleteAgentId(null)
    setDeleteChallenge(null)
  }, [deleteChallenge])

  const handleTogglePermissionMode = useCallback(async () => {
    const next = permissionMode === 'safe' ? 'yolo' : 'safe'
    if (next === 'yolo') {
      if (!confirm('Switch to YOLO mode? Agenda will run sensitive actions without prompts.')) return
    }
    const result = await window.api.setAgendaPermissionMode(next, next === 'yolo')
    if (result.ok && result.settings) {
      setPermissionMode(result.settings.permissionMode)
    }
  }, [permissionMode])

  const handleModelChange = useCallback(async (key: string) => {
    setModelKey(key)
    await window.api.setAgendaModel(key || null)
  }, [])

  const handleTaskStatus = useCallback(async (id: string, status: AgendaTaskStatus) => {
    await window.api.setAgendaTaskStatus(id, status)
    void loadData()
  }, [loadData])

  const handleRunNow = useCallback(async (id: string) => {
    const result = await window.api.runAgendaTaskNow(id)
    if (!result.ok) showToast(result.error || 'Could not start the run.')
    void loadData()
  }, [loadData])

  const handleDeleteTask = useCallback(async (task: AgendaTask) => {
    if (!confirm(`Delete "${task.title}" and its history?`)) return
    await window.api.deleteAgendaTask(task.id, true)
    void loadData()
  }, [loadData])

  // Sidebar grouping
  const currentAgentTasks = useMemo(() => {
    if (allAgentsView) return tasks
    return tasks.filter((task) => task.agentId === selectedAgentId)
  }, [tasks, allAgentsView, selectedAgentId])

  const groups = useMemo(() => {
    const activeRunsSet = new Set<string>() // task ids with running runs
    for (const run of runs) {
      if (run.status === 'running') activeRunsSet.add(run.taskId)
    }
    const needsAttention: AgendaTask[] = []
    const runningActive: AgendaTask[] = []
    const paused: AgendaTask[] = []
    const completedCancelled: AgendaTask[] = []
    const drafts: AgendaTask[] = []
    for (const task of currentAgentTasks) {
      if (task.lastRunStatus === 'failed' || task.lastRunStatus === 'interrupted') {
        needsAttention.push(task)
        continue
      }
      if (task.status === 'draft') drafts.push(task)
      else if (task.status === 'paused') paused.push(task)
      else if (task.status === 'completed' || task.status === 'cancelled') completedCancelled.push(task)
      else runningActive.push(task)
    }
    return { needsAttention, runningActive, paused, completedCancelled, drafts }
  }, [currentAgentTasks, runs])

  const activeTabChatId = activeTab?.kind === 'creation' ? `agenda-agent-${activeTab.agentId}` : null
  const activeTabTranscript = activeTabChatId ? transcripts[activeTabChatId] ?? [] : []

  const activeScheduleTask = activeTab?.kind === 'schedule'
    ? tasks.find((task) => task.id === activeTab.scheduleId) ?? null
    : null

  const scheduleRuns = activeScheduleTask
    ? runs.filter((run) => run.taskId === activeScheduleTask.id).sort((a, b) => b.startedAt - a.startedAt)
    : []
  const selectedRunId = activeScheduleTask
    ? selectedRunByTask[activeScheduleTask.id] ?? scheduleRuns[0]?.id
    : undefined
  const selectedRun = scheduleRuns.find((run) => run.id === selectedRunId)
  const selectedRunChatId = selectedRun ? `agenda-${selectedRun.id}` : null
  const scheduleTranscript = selectedRunChatId ? transcripts[selectedRunChatId] ?? [] : []

  // Load transcript when selecting a run
  useEffect(() => {
    if (!selectedRunChatId || transcripts[selectedRunChatId]) return
    window.api.loadAgendaTranscript(selectedRunChatId).then((session: any) => {
      if (session?.messages) {
        const msgs: ChatMsg[] = []
        for (const m of session.messages) {
          if (m.role === 'system' || m.role === 'tool') continue
          if (m.role === 'user') msgs.push({ role: 'user', content: extractText(m) })
          else if (m.role === 'assistant' || m.role === 'model') {
            const toolCalls = (m.tool_calls ?? []).map((tc: any) => {
              const toolMsg = session.messages.find((x: any) => x.role === 'tool' && x.tool_call_id === tc.id)
              return {
                id: tc.id,
                name: tc.function?.name,
                args: safeJson(tc.function?.arguments),
                status: toolMsg ? 'done' : 'done',
                result: toolMsg?.content
              }
            })
            msgs.push({
              role: 'ai',
              content: extractText(m),
              thoughts: m.reasoning_content || m.thoughts,
              toolCalls: toolCalls.length ? toolCalls : undefined
            })
          }
        }
        setTranscripts((prev) => ({ ...prev, [selectedRunChatId]: msgs }))
      }
    })
  }, [selectedRunChatId, transcripts])

  const renderTranscript = (msgs: ChatMsg[], processingFlag: boolean) => (
    <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      {msgs.length === 0 && !processingFlag && (
        <div className="text-center text-text-muted text-sm py-10">
          No messages yet.
        </div>
      )}
      {msgs.map((msg, index) => {
        if (msg.role === 'separator') {
          return (
            <div key={index} className="text-xs text-rose-300 bg-rose-300/10 border border-rose-300/20 rounded-lg px-3 py-2">
              {msg.content}
            </div>
          )
        }
        if (msg.role === 'user') {
          return (
            <div key={index} className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl bg-accent-primary/10 border border-accent-primary/20 px-4 py-2.5 text-sm text-text-primary">
                {msg.content}
              </div>
            </div>
          )
        }
        return (
          <div key={index} className="space-y-2">
            {msg.thoughts && (
              <div className="text-xs text-text-muted italic border-l-2 border-white/10 pl-3">
                {msg.thoughts}
              </div>
            )}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="space-y-1">
                {msg.toolCalls.map((tc: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-text-secondary bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5">
                    <span className="font-mono text-accent-primary">{tc.name}</span>
                    <span className="truncate">{JSON.stringify(tc.args ?? {})}</span>
                    {tc.status === 'running' && <span className="ml-auto text-accent-primary animate-pulse">running</span>}
                    {tc.status === 'done' && <Check size={12} className="ml-auto text-emerald-300" />}
                    {tc.status === 'error' && <X size={12} className="ml-auto text-rose-300" />}
                  </div>
                ))}
              </div>
            )}
            {msg.content && (
              <div className="prose prose-invert max-w-none text-sm">
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
            {msg.isStreaming && <div className="text-xs text-text-muted animate-pulse">Thinking…</div>}
          </div>
        )
      })}
    </div>
  )

  // Grouped sidebar render
  const renderSidebarGroups = () => {
    const renderTask = (task: AgendaTask) => (
      <button
        key={task.id}
        type="button"
        onClick={() => handleOpenSchedule(task)}
        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-text-primary truncate">{task.title}</span>
          <span className={clsx('text-[10px]', STATUS_META[task.status].className)}>
            {STATUS_META[task.status].label}
          </span>
        </div>
        <div className="text-[10px] text-text-muted truncate">{task.id}</div>
      </button>
    )
    const section = (title: string, items: AgendaTask[], defaultOpen = false) => {
      if (items.length === 0) return null
      return (
        <details open={defaultOpen} className="group">
          <summary className="cursor-pointer text-[11px] font-semibold text-text-secondary px-2 py-1.5 flex items-center gap-1.5">
            <CaretRight size={10} className="group-open:rotate-90 transition-transform" />
            {title} <span className="text-text-muted">({items.length})</span>
          </summary>
          <div className="pl-1">{items.map(renderTask)}</div>
        </details>
      )
    }
    return (
      <div className="space-y-1">
        {section('Running / Active', groups.runningActive, true)}
        {section('Needs attention', groups.needsAttention, true)}
        {section('Paused', groups.paused)}
        {section('Drafts', groups.drafts)}
        {section('Completed / Cancelled', groups.completedCancelled)}
      </div>
    )
  }

  const renderAllAgentsView = () => (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setAllAgentsView(false)}
        className="text-xs text-accent-primary hover:underline flex items-center gap-1"
      >
        <CaretLeft size={12} /> Back to {agents.find((a) => a.id === selectedAgentId)?.title ?? 'agent'}
      </button>
      {agents.map((agent) => {
        const agentTasks = tasks.filter((task) => task.agentId === agent.id)
        return (
          <div key={agent.id} className="space-y-1">
            <div className="text-xs font-semibold text-text-primary px-2">{agent.title}</div>
            {agentTasks.length === 0 ? (
              <div className="text-[10px] text-text-muted px-3">No schedules.</div>
            ) : (
              agentTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => handleOpenSchedule(task)}
                  className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/[0.05]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-primary truncate">{task.title}</span>
                    <span className={clsx('text-[10px]', STATUS_META[task.status].className)}>
                      {STATUS_META[task.status].label}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        )
      })}
    </div>
  )

  const renderCreationTab = () => {
    const chatId = activeTab ? `agenda-agent-${activeTab.agentId}` : ''
    const agent = agents.find((a) => a.id === activeTab?.agentId)
    const isProcessing = processing[chatId] ?? false
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">{renderTranscript(activeTabTranscript, isProcessing)}</div>
        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.1] text-text-secondary hover:text-text-primary hover:bg-white/[0.1] transition-colors"
              title="Create a schedule manually"
            >
              <CalendarPlus size={16} />
            </button>
            <div className="flex-1 true-glass glass-menu-host input-bar-host relative rounded-[24px] flex flex-col px-4 py-3">
              <LiquidGlassSurface refraction={20} blur={2} opacity={0.5} specular={0.1} distortionRadius={24} />
            <textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={`Message ${agent?.title ?? 'Agenda agent'}…`}
              rows={2}
              className="w-full bg-transparent resize-none outline-none text-sm text-text-primary placeholder:text-text-muted"
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <ModelSelector selectedModel={modelKey ?? ''} onModelChange={handleModelChange} menuPlacement="top" align="left" />
                <button
                  type="button"
                  onClick={handleTogglePermissionMode}
                  className={clsx(
                    'text-[10px] font-semibold px-2 py-1 rounded-full border',
                    permissionMode === 'yolo'
                      ? 'border-amber-300/40 text-amber-300 bg-amber-300/10'
                      : 'border-emerald-300/40 text-emerald-300 bg-emerald-300/10'
                  )}
                >
                  {permissionMode === 'yolo' ? 'YOLO' : 'Safe'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {isProcessing && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-xs text-text-secondary hover:text-text-primary"
                  >
                    Stop
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={isProcessing || !composerText.trim()}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-accent-primary text-black disabled:opacity-40"
                >
                  <Sparkle size={14} weight="fill" />
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderScheduleTab = () => {
    if (!activeScheduleTask) {
      return <div className="flex-1 flex items-center justify-center text-text-muted">Schedule not found.</div>
    }
    const task = activeScheduleTask
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                // return to a creation tab for the owning agent
                const tab = tabs.find((t) => t.kind === 'creation' && t.agentId === task.agentId)
                if (tab) setActiveTabId(tab.id)
              }}
              className="text-accent-primary hover:underline"
            >
              {agents.find((a) => a.id === task.agentId)?.title ?? 'Agenda agent'}
            </button>
            <span className="text-text-muted">›</span>
            <span className="text-text-primary font-medium truncate">{task.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('text-xs font-semibold', STATUS_META[task.status].className)}>
              {STATUS_META[task.status].label}
            </span>
            {scheduleRuns.length > 0 && (
              <select
                value={selectedRunId ?? ''}
                onChange={(e) => setSelectedRunByTask((prev) => ({ ...prev, [task.id]: e.target.value }))}
                className="text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-2 py-1 text-text-primary"
              >
                {scheduleRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {new Date(run.startedAt).toLocaleString()} — {run.status}
                  </option>
                ))}
              </select>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpenFor(menuOpenFor === task.id ? null : task.id)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-text-secondary"
              >
                <DotsThree size={16} />
              </button>
              {menuOpenFor === task.id && (
                <div className="absolute right-0 top-8 z-20 w-44 glass-dropdown-panel p-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpenFor(null)
                      void handleTaskStatus(task.id, task.status === 'paused' ? 'active' : 'paused')
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06]"
                  >
                    {task.status === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpenFor(null)
                      void handleRunNow(task.id)
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06]"
                  >
                    Run now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpenFor(null)
                      setEditingTask(task)
                      setManualOpen(true)
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpenFor(null)
                      void handleTaskStatus(task.id, 'completed')
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06]"
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpenFor(null)
                      void handleTaskStatus(task.id, 'cancelled')
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpenFor(null)
                      void handleDeleteTask(task)
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-rose-300"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Collapsed prompt/instructions cards */}
        <div className="px-4 py-3 space-y-2 border-b border-white/[0.06]">
          <details className="group rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <CaretRight size={10} className="group-open:rotate-90 transition-transform" />
              Run prompt
            </summary>
            <div className="mt-2 text-xs text-text-primary whitespace-pre-wrap">
              {selectedRun?.prompt ?? task.prompt}
            </div>
          </details>
          <details className="group rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <CaretRight size={10} className="group-open:rotate-90 transition-transform" />
              Instructions
            </summary>
            <div className="mt-2 text-xs text-text-primary whitespace-pre-wrap">
              {selectedRun?.instructions ?? task.instructions}
            </div>
          </details>
        </div>
        <div className="flex-1 min-h-0">{renderTranscript(scheduleTranscript, false)}</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Main content */}
      <div className="flex h-full w-full flex-col">
        {/* Tab strip */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06] overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap',
                tab.id === activeTabId
                  ? 'bg-white/[0.08] text-text-primary'
                  : 'text-text-secondary hover:bg-white/[0.04]'
              )}
            >
              {tab.kind === 'creation' ? <ChatTeardropText size={12} /> : <CalendarPlus size={12} />}
              <span className="truncate max-w-[120px]">{tab.title}</span>
              {tab.isProcessing && <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />}
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  handleCloseTab(tab.id)
                }}
                className="ml-1 text-text-muted hover:text-text-primary cursor-pointer"
              >
                <X size={10} />
              </span>
            </button>
          ))}
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="text-xs text-text-muted hover:text-text-primary px-2"
            >
              <List size={14} />
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {activeTab?.kind === 'creation' ? renderCreationTab() : renderScheduleTab()}
        </div>
      </div>

      {/* Floating sidebar */}
      <div
        className={clsx(
          'absolute right-3 top-3 bottom-3 z-20 flex flex-col w-72 rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)] transition-all duration-300',
          sidebarOpen ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+1rem)] opacity-0 pointer-events-none'
        )}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
          <span className="text-xs font-semibold text-text-primary">Agenda</span>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="h-6 w-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-white/[0.06] space-y-2">
          <select
            value={selectedAgentId}
            onChange={(e) => handleSelectAgent(e.target.value)}
            className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-2 py-1.5 text-text-primary"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.title}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewAgent}
              className="flex-1 text-[11px] px-2 py-1.5 rounded-lg bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25"
            >
              <Plus size={12} className="inline mr-1" />
              New agent
            </button>
            {agents.find((a) => a.id === selectedAgentId && !a.isMain) && (
              <button
                type="button"
                onClick={() => startDeleteAgent(selectedAgentId)}
                className="text-[11px] px-2 py-1.5 rounded-lg bg-rose-300/10 text-rose-300 hover:bg-rose-300/20"
                title="Delete agent"
              >
                <Trash size={12} />
              </button>
            )}
          </div>
          {!allAgentsView && (
            <button
              type="button"
              onClick={() => setAllAgentsView(true)}
              className="w-full text-[10px] text-text-muted hover:text-text-primary text-left"
            >
              See other agents' Agendas
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
          {allAgentsView ? renderAllAgentsView() : renderSidebarGroups()}
        </div>
      </div>

      {/* Manual / edit modal */}
      {manualOpen && (
        <ManualScheduleModal
          agents={agents}
          task={editingTask}
          mcpServers={mcpServers}
          defaultAgentId={activeTab?.agentId ?? selectedAgentId}
          onSubmit={handleManualSubmit}
          onClose={() => {
            setManualOpen(false)
            setEditingTask(null)
          }}
        />
      )}

      {/* Delete agent challenge modal */}
      {deleteAgentId && deleteChallenge && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Delete agent and its schedules</h3>
            <p className="text-xs text-text-secondary">
              {deleteChallenge.scheduleCount} schedule(s) will be permanently deleted.
            </p>
            {deleteChallenge.step === 1 && (
              <label className="flex items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={deleteAcknowledged}
                  onChange={(e) => setDeleteAcknowledged(e.target.checked)}
                />
                I understand this cannot be undone.
              </label>
            )}
            {deleteChallenge.step === 2 && (
              <input
                value={deleteStepAnswer}
                onChange={(e) => setDeleteStepAnswer(e.target.value)}
                placeholder={`Type "${deleteChallenge.agentTitle}"`}
                className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary"
              />
            )}
            {deleteChallenge.step === 3 && (
              <div className="space-y-2">
                <div className="text-xs text-text-primary">{deleteChallenge.puzzle?.question}</div>
                <input
                  value={deleteStepAnswer}
                  onChange={(e) => setDeleteStepAnswer(e.target.value)}
                  placeholder="Answer"
                  className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary"
                />
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={cancelDelete} className="text-xs px-3 py-1.5 rounded-lg text-text-secondary hover:bg-white/[0.06]">
                Cancel
              </button>
              {!deleteChallenge.verifiedAt ? (
                <button
                  type="button"
                  onClick={() => void advanceDelete()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-rose-300/20 text-rose-300 hover:bg-rose-300/30"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void confirmDeleteAgent()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-rose-300 text-black hover:bg-rose-400"
                >
                  Delete permanently
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2 rounded-xl bg-black/80 border border-white/[0.12] text-xs text-text-primary shadow-lg animate-soft-pop">
          {toast}
        </div>
      )}
    </div>
  )
}
function extractText(m: any): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .filter(Boolean)
      .join('\n')
  }
  if (Array.isArray(m.parts)) {
    return m.parts
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function safeJson(value: any): any {
  if (typeof value !== 'string') return value ?? {}
  try {
    return JSON.parse(value)
  } catch {
    return { raw: value }
  }
}

function ManualScheduleModal({
  agents,
  task,
  mcpServers,
  defaultAgentId,
  onSubmit,
  onClose
}: {
  agents: AgendaAgent[]
  task: AgendaTask | null
  mcpServers: McpServerConfig[]
  defaultAgentId: string
  onSubmit: (input: any) => void
  onClose: () => void
}): React.JSX.Element {
  const [agentId, setAgentId] = useState(task?.agentId ?? defaultAgentId)
  const [title, setTitle] = useState(task?.title ?? '')
  const [prompt, setPrompt] = useState(task?.prompt ?? '')
  const [instructions, setInstructions] = useState(task?.instructions ?? '')
  const [intervalMinutes, setIntervalMinutes] = useState<number | null>(task?.intervalMinutes ?? 1440)
  const [status, setStatus] = useState<'active' | 'draft'>(task?.status === 'draft' ? 'draft' : 'active')
  const [selectedServers, setSelectedServers] = useState<string[]>(task?.mcpServerIds ?? [])

  const cadencePresets = [
    { label: 'Once', minutes: null },
    { label: 'Every 2 hours', minutes: 120 },
    { label: 'Every day', minutes: 1440 },
    { label: 'Every week', minutes: 10080 },
    { label: 'Every month', minutes: 43200 }
  ]

  const submit = (draft: boolean) => {
    if (!title.trim()) {
      alert('A schedule name is required.')
      return
    }
    if (!instructions.trim()) {
      alert('Execution instructions are required.')
      return
    }
    onSubmit({
      agentId,
      title: title.trim(),
      prompt: prompt.trim() || title.trim(),
      instructions: instructions.trim(),
      intervalMinutes,
      status: draft ? 'draft' : status,
      mcpServerIds: selectedServers,
      origin: 'manual'
    })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/[0.12] bg-[var(--surface-lowest)] p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            {task ? 'Edit schedule' : 'Create schedule manually'}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={14} />
          </button>
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] text-text-secondary">Agent</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] text-text-secondary">Schedule name (required)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] text-text-secondary">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary resize-none"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] text-text-secondary">Execution instructions</label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="block text-[11px] text-text-secondary">Cadence</label>
            <select
              value={intervalMinutes === null ? 'null' : String(intervalMinutes)}
              onChange={(e) => {
                const v = e.target.value
                setIntervalMinutes(v === 'null' ? null : Number(v))
              }}
              className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary"
            >
              {cadencePresets.map((preset) => (
                <option key={preset.label} value={preset.minutes === null ? 'null' : String(preset.minutes)}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] text-text-secondary">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'draft')}
              className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-text-primary"
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        </div>
        {mcpServers.length > 0 && (
          <div className="space-y-2">
            <label className="block text-[11px] text-text-secondary">MCP servers</label>
            <div className="flex flex-wrap gap-2">
              {mcpServers.map((server) => (
                <label key={server.id} className="flex items-center gap-1.5 text-xs text-text-primary">
                  <input
                    type="checkbox"
                    checked={selectedServers.includes(server.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedServers((prev) => [...prev, server.id])
                      else setSelectedServers((prev) => prev.filter((id) => id !== server.id))
                    }}
                  />
                  {server.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg text-text-secondary hover:bg-white/[0.06]">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] text-text-primary hover:bg-white/[0.1]"
          >
            Save as draft
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent-primary text-black hover:bg-accent-primary/90"
          >
            {task ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}