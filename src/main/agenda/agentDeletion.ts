import { deleteChatSession } from '../history'
import { cancelChatMessage } from '../ai/chatHandler'
import { broadcastIpc } from '../safeSend'
import { loadTasks, deleteTask } from './tasks'
import { deleteRunsForTask } from './scheduler'
import { listRuns, runChatId } from './runs'
import { agentChatId, getAgent, removeAgentRecord } from './agents'
import { consumeAgentDeletionChallenge } from './agentChallenge'

export interface DeleteAgentResult {
  ok: boolean
  error?: string
  deletedSchedules?: number
}

/**
 * Deletes an agent together with every schedule, run record and transcript it
 * owns. The caller must have completed the three-step challenge first.
 */
export async function deleteAgentWithData(
  agentId: string,
  challengeId: string
): Promise<DeleteAgentResult> {
  const agent = getAgent(agentId)
  if (!agent) return { ok: false, error: 'Agent not found.' }
  if (agent.isMain) return { ok: false, error: 'The Main Agenda agent cannot be deleted.' }

  const verified = consumeAgentDeletionChallenge(challengeId, agentId)
  if (!verified.ok) return { ok: false, error: verified.error }

  const schedules = loadTasks().filter((task) => task.agentId === agentId)
  for (const task of schedules) {
    const runs = listRuns(task.id)
    await deleteRunsForTask(task.id)
    for (const run of runs) deleteChatSession(runChatId(run.id))
    deleteTask(task.id, true)
  }

  // Stop and remove the agent's own conversation.
  const chatId = agentChatId(agentId)
  cancelChatMessage(chatId)
  deleteChatSession(chatId)
  removeAgentRecord(agentId)

  broadcastIpc('agenda-tasks-changed')
  broadcastIpc('agenda-agents-changed')
  broadcastIpc('agenda-runs-changed')
  return { ok: true, deletedSchedules: schedules.length }
}
