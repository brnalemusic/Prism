import { randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { loadChatSession, saveChatSession, updateHarnessSessionPhase } from '../history'
import { openHarnessProject } from '../harnessProject'
import { bindGitPlan } from '../harnessGitRecovery'
import { getTerminalProcessesForChat } from '../terminalProcessManager'
import { broadcastIpc } from '../safeSend'
import {
  activeRuns,
  startBackgroundChatMessage,
  wakeUpChatSession,
  prepareHarnessPlanHandoff
} from './chatHandler'
import { notifyDiscordVoiceSession, isDiscordVoiceChat } from '../discordGateway'
import {
  buildHarnessImplementationHandoff,
  buildHarnessPlanApprovalMessage
} from '../../shared/harnessPlanCommand'
import type { SessionMode, WorkspaceKind, HarnessPhase } from '../../shared/types'
import type { OpenAiMessage } from './types'

export interface InterChatTask {
  id: string
  senderChatId: string
  targetChatId: string
  target: 'chat' | 'harness'
  sessionMode: SessionMode
  disciplinePath?: string
  harnessPhase?: HarnessPhase
  initialMessage: string
  createdAt: number
  completedAt?: number
  status: 'running' | 'completed' | 'error'
  resultSummary?: string
  lastApiError?: string
  notified: boolean
}

export interface InterChatNotification {
  taskId: string
  senderChatId: string
  targetChatId: string
  targetTitle: string
  status: 'completed' | 'error'
  content: string
  timestamp: number
}

class InterChatManager {
  private tasks = new Map<string, InterChatTask>()
  private pendingNotifications = new Map<string, InterChatNotification[]>()
  private lastApiErrors = new Map<string, string>()

  public recordApiError(chatId: string, error: string): void {
    if (!chatId) return
    this.lastApiErrors.set(chatId, error)
    const task = this.tasks.get(chatId)
    if (task) {
      task.lastApiError = error
    }
  }

  public getPendingInterChatNotifications(chatId: string): InterChatNotification[] {
    const list = this.pendingNotifications.get(chatId) || []
    this.pendingNotifications.delete(chatId)
    return list
  }

  public async dispatchInterChatTask(data: {
    senderChatId?: string
    target: 'chat' | 'harness'
    message: string
    path?: string
    harness_mode?: 'plan' | 'build'
    target_chat_id?: string
  }): Promise<{
    ok: boolean
    chatId?: string
    status?: string
    target?: string
    message?: string
    error?: string
  }> {
    const target = data.target
    const message = (data.message || '').trim()
    if (!message) {
      return { ok: false, error: 'The message/task content cannot be empty.' }
    }

    let targetProjectPath = (data.path || '').trim()

    // 1. Validate destination path
    if (target === 'harness') {
      if (!targetProjectPath) {
        return {
          ok: false,
          error:
            'The path parameter is mandatory when target is "harness". You must specify a valid project folder path.'
        }
      }
      try {
        const resolvedPath = path.resolve(targetProjectPath)
        const stats = await fs.stat(resolvedPath).catch(() => null)
        if (!stats || !stats.isDirectory()) {
          return {
            ok: false,
            error: `Target path does not exist or is not a directory: "${targetProjectPath}"`
          }
        }
        await openHarnessProject(resolvedPath)
        targetProjectPath = resolvedPath
      } catch (err) {
        return {
          ok: false,
          error: `Failed to register Harness project at "${targetProjectPath}": ${err instanceof Error ? err.message : String(err)}`
        }
      }
    } else if (targetProjectPath) {
      try {
        const resolvedPath = path.resolve(targetProjectPath)
        const stats = await fs.stat(resolvedPath).catch(() => null)
        if (!stats || !stats.isDirectory()) {
          return {
            ok: false,
            error: `Target path does not exist or is not a directory: "${targetProjectPath}"`
          }
        }
        targetProjectPath = resolvedPath
      } catch (err) {
        return {
          ok: false,
          error: `Invalid path: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    }

    const workspace: WorkspaceKind = target === 'harness' ? 'harness' : 'chat'
    const sessionMode: SessionMode =
      target === 'harness' ? 'harness' : targetProjectPath ? 'discipline' : 'execution'
    const harnessPhase: HarnessPhase = target === 'harness' ? data.harness_mode || 'build' : 'build'

    // 2. Resolve target chatId and title
    let targetChatId = data.target_chat_id?.trim()
    let isNewChat = false
    let targetTitle = ''

    if (targetChatId) {
      const existingSession = loadChatSession(targetChatId, workspace)
      if (!existingSession) {
        return {
          ok: false,
          error: `Target chat with ID "${targetChatId}" was not found.`
        }
      }
      targetTitle = existingSession.title
    } else {
      isNewChat = true
      const idPrefix = target === 'harness' ? 'harness' : 'chat'
      targetChatId = `${idPrefix}-${Date.now()}-${randomUUID().slice(0, 8)}`
      const titleSnippet = message.slice(0, 32).replace(/\s+/g, ' ').trim()
      targetTitle = target === 'harness' ? `Harness: ${titleSnippet}` : titleSnippet || 'New Chat'
    }

    // 3. Resolve sender info
    const senderChatId = data.senderChatId || 'unknown'
    let senderTitle = ''
    if (senderChatId && senderChatId !== 'unknown') {
      const senderSession = loadChatSession(senderChatId)
      senderTitle = senderSession?.title || (isDiscordVoiceChat(senderChatId) ? 'Discord Voice' : '')
    }

    // 4. Save initial message in history
    const userMessage: OpenAiMessage = {
      role: 'user',
      content: message,
      sourceChatId: senderChatId,
      sourceChatTitle: senderTitle || undefined
    }

    const existingSession = loadChatSession(targetChatId, workspace)
    const existingMessages = existingSession?.messages ? [...existingSession.messages] : []
    existingMessages.push(userMessage)

    saveChatSession(
      targetChatId,
      existingMessages,
      existingSession?.title || targetTitle,
      sessionMode,
      targetProjectPath,
      existingSession?.model,
      false,
      workspace === 'harness' ? [] : existingSession?.disabledSkills,
      harnessPhase
    )

    // 5. If new chat, broadcast to open tab in background (unfocused)
    if (isNewChat) {
      broadcastIpc('chat-opened-in-background', {
        chatId: targetChatId,
        title: targetTitle,
        workspace,
        sessionMode,
        disciplinePath: targetProjectPath,
        harnessPhase,
        sourceChatId: senderChatId,
        sourceChatTitle: senderTitle || undefined,
        initialMessage: message
      })
    }

    // 6. Track task
    const taskId = `task-${Date.now()}-${randomUUID().slice(0, 6)}`
    const taskRecord: InterChatTask = {
      id: taskId,
      senderChatId,
      targetChatId,
      target,
      sessionMode,
      disciplinePath: targetProjectPath,
      harnessPhase,
      initialMessage: message,
      createdAt: Date.now(),
      status: 'running',
      notified: false
    }
    this.tasks.set(targetChatId, taskRecord)

    // 7. Launch execution in the background
    void startBackgroundChatMessage(
      {
        message,
        chatId: targetChatId,
        sessionMode,
        disciplinePath: targetProjectPath,
        harnessPhase
      },
      workspace
    ).catch((err) => {
      console.error(`[InterChat] Error running background task in ${targetChatId}:`, err)
      this.recordApiError(targetChatId, err instanceof Error ? err.message : String(err))
      this.checkAndNotifyCompletion(targetChatId)
    })

    return {
      ok: true,
      chatId: targetChatId,
      status: 'running',
      target,
      message: `Task successfully dispatched to ${target} (Chat ID: ${targetChatId}). The receiving agent is executing in a background tab. You are recommended to remain in standby; you will be automatically notified with complete results when finished.`
    }
  }

  public readChatProgress(chatId: string): {
    chatId: string
    status: 'running' | 'completed' | 'error'
    isAiRunning: boolean
    hasRunningTerminalProcesses: boolean
    apiError: string | null
    title: string
    workspace: WorkspaceKind
    sessionMode?: SessionMode
    harnessPhase?: HarnessPhase
    messageCount: number
    lastAssistantMessage: string | null
    historySummary: string[]
  } {
    const cleanId = (chatId || '').trim()
    const isAiRunning = activeRuns.has(cleanId)
    const terminalProcesses = getTerminalProcessesForChat(cleanId)
    const hasRunningTerminalProcesses = terminalProcesses.some(
      (p) => p.status === 'running' || p.awaitingInput
    )
    const apiError = this.lastApiErrors.get(cleanId) || null

    const session = loadChatSession(cleanId)
    const workspace: WorkspaceKind =
      session?.workspace || (session?.sessionMode === 'harness' ? 'harness' : 'chat')
    const messages = session?.messages || []

    let status: 'running' | 'completed' | 'error' = 'completed'
    if (isAiRunning || hasRunningTerminalProcesses) {
      status = 'running'
    } else if (apiError) {
      status = 'error'
    }

    let lastAssistantMessage: string | null = null
    const historySummary: string[] = []

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
        if (!lastAssistantMessage) {
          lastAssistantMessage = m.content.trim()
        }
      }
    }

    // Collect up to last 5 message summaries
    const recent = messages.slice(-5)
    for (const m of recent) {
      if (m.role === 'user' && !m.hidden && typeof m.content === 'string') {
        historySummary.push(`User: ${m.content.slice(0, 100)}`)
      } else if (m.role === 'assistant' && typeof m.content === 'string') {
        historySummary.push(`Assistant: ${m.content.slice(0, 100)}`)
      } else if (m.tool_calls && m.tool_calls.length > 0) {
        historySummary.push(`Tool Call: ${m.tool_calls.map((t) => t.function.name).join(', ')}`)
      }
    }

    return {
      chatId: cleanId,
      status,
      isAiRunning,
      hasRunningTerminalProcesses,
      apiError,
      title: session?.title || 'Unknown Chat',
      workspace,
      sessionMode: session?.sessionMode,
      harnessPhase: session?.harnessPhase,
      messageCount: messages.length,
      lastAssistantMessage,
      historySummary
    }
  }

  public checkAndNotifyCompletion(targetChatId: string): void {
    const task = this.tasks.get(targetChatId)
    if (!task || task.notified) return

    // 1. Is the AI still streaming or running?
    if (activeRuns.has(targetChatId)) {
      return
    }

    // 2. Are terminal background processes still running?
    const terminalProcesses = getTerminalProcessesForChat(targetChatId)
    const hasRunningTerminal = terminalProcesses.some(
      (p) => p.status === 'running' || p.awaitingInput
    )
    if (hasRunningTerminal) {
      return
    }

    // Both AI and terminal processes have finished: the task is TRULY completed!
    task.notified = true
    task.completedAt = Date.now()

    const session = loadChatSession(targetChatId, task.target === 'harness' ? 'harness' : 'chat')
    const messages = session?.messages || []

    let finalOutput = ''
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
        finalOutput = m.content.trim()
        break
      }
    }

    const apiError = this.lastApiErrors.get(targetChatId)
    const isError = Boolean(apiError)
    task.status = isError ? 'error' : 'completed'
    task.resultSummary = finalOutput || (isError ? `Error: ${apiError}` : 'Task completed.')

    let publishedPlan: string | undefined
    if (task.target === 'harness') {
      const publishedPlans = messages.flatMap((m) =>
        (m.tool_calls || [])
          .filter((call) => call.function?.name === 'plan')
          .map((call) => {
            try {
              const parsed = JSON.parse(call.function.arguments) as { markdown?: unknown }
              return typeof parsed.markdown === 'string' ? parsed.markdown.trim() : ''
            } catch {
              return ''
            }
          })
          .filter(Boolean)
      )
      if (publishedPlans.length > 0) {
        publishedPlan = publishedPlans[publishedPlans.length - 1]
      }
    }

    const senderChatId = task.senderChatId
    if (!senderChatId || senderChatId === 'unknown') {
      return
    }

    let notificationBody = ''
    if (isError) {
      notificationBody = `Task in chat "${session?.title || targetChatId}" (${targetChatId}) failed with error:\n${apiError}`
    } else if (task.target === 'harness' && task.harnessPhase === 'plan' && publishedPlan) {
      notificationBody =
        `The Harness agent in chat "${session?.title || targetChatId}" (${targetChatId}) completed its planning turn and published an Implementation Plan.\n\n` +
        `Implementation Plan Markdown:\n${publishedPlan}\n\n` +
        `Final Assistant Notes:\n${finalOutput || '(No additional text)'}\n\n` +
        `Next Step: You can review and approve this implementation plan using the "approve_harness_plan" tool:\n` +
        `- mode="same_chat": Continues execution in the same chat in Build mode.\n` +
        `- mode="new_chat": Generates complementary handoff context and executes the plan in a new chat with clean context.`
    } else {
      notificationBody = `Task in chat "${session?.title || targetChatId}" (${targetChatId}) completed successfully.\n\nFinal Output:\n${finalOutput || '(No text output)'}`
    }

    const notificationMessage = `[INTER-CHAT TASK NOTIFICATION: ${notificationBody}]`

    // Case A: Sender is active Discord Voice Gateway session
    if (isDiscordVoiceChat(senderChatId)) {
      notifyDiscordVoiceSession(senderChatId, notificationBody)
      return
    }

    // Case B: Sender is regular Chat or Harness
    const isSenderRunning = activeRuns.has(senderChatId)
    if (isSenderRunning) {
      // Queue notification to be picked up in next tool round
      const currentList = this.pendingNotifications.get(senderChatId) || []
      currentList.push({
        taskId: task.id,
        senderChatId,
        targetChatId,
        targetTitle: session?.title || targetChatId,
        status: isError ? 'error' : 'completed',
        content: notificationMessage,
        timestamp: Date.now()
      })
      this.pendingNotifications.set(senderChatId, currentList)
    } else {
      // Sender is idle -> inject notification and wake up sender
      const senderSession = loadChatSession(senderChatId)
      if (senderSession) {
        const senderMessages = [...senderSession.messages]
        senderMessages.push({
          role: 'user',
          content: notificationMessage,
          isSystemNotification: true,
          hidden: false
        })
        saveChatSession(
          senderChatId,
          senderMessages,
          senderSession.title,
          senderSession.sessionMode,
          senderSession.disciplinePath,
          senderSession.model,
          senderSession.isDiscord,
          senderSession.disabledSkills,
          senderSession.harnessPhase
        )
        // Wake up sender chat
        void wakeUpChatSession(senderChatId).catch((err) => {
          console.error(`[InterChat] Failed to wake up sender chat ${senderChatId}:`, err)
        })
      }
    }
  }

  public async approveHarnessPlan(data: {
    senderChatId?: string
    chatId: string
    mode: 'same_chat' | 'new_chat'
    plan?: string
    feedback?: string
  }): Promise<{
    ok: boolean
    chatId?: string
    sourceChatId?: string
    mode?: string
    status?: string
    message?: string
    error?: string
  }> {
    const targetChatId = (data.chatId || '').trim()
    if (!targetChatId) {
      return { ok: false, error: 'The chatId parameter is required.' }
    }

    const session = loadChatSession(targetChatId, 'harness')
    if (!session || !session.disciplinePath) {
      return {
        ok: false,
        error: `Harness session "${targetChatId}" could not be loaded or has no project path.`
      }
    }

    if (activeRuns.has(targetChatId)) {
      return {
        ok: false,
        error: `Harness session "${targetChatId}" is currently executing. Wait for it to finish before approving the plan.`
      }
    }

    const existingTask = this.tasks.get(targetChatId)
    if (
      existingTask &&
      data.senderChatId &&
      existingTask.senderChatId &&
      existingTask.senderChatId !== data.senderChatId
    ) {
      return {
        ok: false,
        error: `Permission denied: This Harness session was dispatched by another agent (${existingTask.senderChatId}).`
      }
    }

    const publishedPlans = session.messages.flatMap((m) =>
      (m.tool_calls || [])
        .filter((call) => call.function?.name === 'plan')
        .map((call) => {
          try {
            const parsed = JSON.parse(call.function.arguments) as { markdown?: unknown }
            return typeof parsed.markdown === 'string' ? parsed.markdown.trim() : ''
          } catch {
            return ''
          }
        })
        .filter(Boolean)
    )

    if (publishedPlans.length === 0) {
      return {
        ok: false,
        error: `No implementation plan was published in Harness session "${targetChatId}".`
      }
    }

    let selectedPlan: string
    const inputPlan = data.plan?.trim()
    if (inputPlan) {
      const match = publishedPlans.find(
        (p) => p === inputPlan || p.includes(inputPlan) || inputPlan.includes(p)
      )
      if (match) {
        selectedPlan = match
      } else {
        return {
          ok: false,
          error: 'The provided plan text does not match any published plan in the session.'
        }
      }
    } else {
      selectedPlan = publishedPlans[publishedPlans.length - 1]
    }

    const mode = data.mode === 'new_chat' ? 'new_chat' : 'same_chat'

    if (mode === 'same_chat') {
      try {
        await bindGitPlan({
          projectPath: session.disciplinePath,
          chatId: targetChatId,
          plan: selectedPlan,
          phase: 'build'
        })
      } catch (err) {
        console.warn(`[InterChat] bindGitPlan notice for ${targetChatId}:`, err)
      }

      updateHarnessSessionPhase(targetChatId, 'build')
      broadcastIpc('harness-phase-changed', { chatId: targetChatId, phase: 'build' })

      let approvalMessage = buildHarnessPlanApprovalMessage()
      if (data.feedback?.trim()) {
        approvalMessage += `\n\nAdditional Guidance from Supervising Agent:\n${data.feedback.trim()}`
      }

      const taskId = existingTask
        ? existingTask.id
        : `task-${Date.now()}-${randomUUID().slice(0, 6)}`
      this.tasks.set(targetChatId, {
        id: taskId,
        senderChatId: data.senderChatId || existingTask?.senderChatId || 'unknown',
        targetChatId,
        target: 'harness',
        sessionMode: 'harness',
        disciplinePath: session.disciplinePath,
        harnessPhase: 'build',
        initialMessage: approvalMessage,
        createdAt: Date.now(),
        status: 'running',
        notified: false
      })

      void startBackgroundChatMessage(
        {
          message: approvalMessage,
          chatId: targetChatId,
          sessionMode: 'harness',
          disciplinePath: session.disciplinePath,
          harnessPhase: 'build'
        },
        'harness'
      ).catch((err) => {
        console.error(`[InterChat] Error starting build in ${targetChatId}:`, err)
        this.recordApiError(targetChatId, err instanceof Error ? err.message : String(err))
        this.checkAndNotifyCompletion(targetChatId)
      })

      return {
        ok: true,
        chatId: targetChatId,
        mode: 'same_chat',
        status: 'running',
        message: `Implementation plan approved in the same chat (${targetChatId}). The Harness agent has transitioned to Build mode and is executing the plan in the background. You are recommended to remain in standby; you will be automatically notified upon completion.`
      }
    } else {
      let handoffContext = ''
      try {
        const prep = await prepareHarnessPlanHandoff({
          chatId: targetChatId,
          projectPath: session.disciplinePath,
          modelKey: session.model || '',
          plan: selectedPlan
        })
        handoffContext = prep.context
      } catch (err) {
        return {
          ok: false,
          error: `Failed to prepare handoff context from source session: ${err instanceof Error ? err.message : String(err)}`
        }
      }

      const newChatId = `harness-${Date.now()}-${randomUUID().slice(0, 8)}`

      try {
        await bindGitPlan({
          projectPath: session.disciplinePath,
          chatId: newChatId,
          sourceChatId: targetChatId,
          plan: selectedPlan,
          phase: 'build'
        })
      } catch (err) {
        console.warn(`[InterChat] bindGitPlan notice for ${newChatId}:`, err)
      }

      let handoffMessage = buildHarnessImplementationHandoff(
        selectedPlan,
        handoffContext +
          '\nFor a linked Git recovery, explicitly stage only resolved conflicts, run the approved checks, and leave continuation, commit, push, and abort to Git Control Retry.'
      )
      if (data.feedback?.trim()) {
        handoffMessage += `\n\nAdditional Guidance from Supervising Agent:\n${data.feedback.trim()}`
      }

      const saved = saveChatSession(
        newChatId,
        [],
        'Implementation Handoff',
        'harness',
        session.disciplinePath,
        session.model,
        false,
        [],
        'build'
      )
      if (!saved) {
        return { ok: false, error: 'Failed to create new Harness session for plan handoff.' }
      }

      broadcastIpc('chat-opened-in-background', {
        chatId: newChatId,
        title: 'Implementation Handoff',
        workspace: 'harness',
        sessionMode: 'harness',
        disciplinePath: session.disciplinePath,
        harnessPhase: 'build',
        sourceChatId: data.senderChatId || targetChatId,
        sourceChatTitle: session.title || 'Harness Plan',
        initialMessage: handoffMessage
      })

      const taskId = `task-${Date.now()}-${randomUUID().slice(0, 6)}`
      this.tasks.set(newChatId, {
        id: taskId,
        senderChatId: data.senderChatId || existingTask?.senderChatId || 'unknown',
        targetChatId: newChatId,
        target: 'harness',
        sessionMode: 'harness',
        disciplinePath: session.disciplinePath,
        harnessPhase: 'build',
        initialMessage: handoffMessage,
        createdAt: Date.now(),
        status: 'running',
        notified: false
      })

      void startBackgroundChatMessage(
        {
          message: handoffMessage,
          chatId: newChatId,
          sessionMode: 'harness',
          disciplinePath: session.disciplinePath,
          harnessPhase: 'build'
        },
        'harness'
      ).catch((err) => {
        console.error(`[InterChat] Error starting build in ${newChatId}:`, err)
        this.recordApiError(newChatId, err instanceof Error ? err.message : String(err))
        this.checkAndNotifyCompletion(newChatId)
      })

      return {
        ok: true,
        chatId: newChatId,
        sourceChatId: targetChatId,
        mode: 'new_chat',
        status: 'running',
        message: `Implementation plan approved in a new chat (${newChatId}) with fresh context and complementary handoff notes. The Harness agent is executing in Build mode in a background tab. You are recommended to remain in standby; you will be automatically notified upon completion.`
      }
    }
  }
}

export const interChatManager = new InterChatManager()
