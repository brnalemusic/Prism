import { loadConfig } from '../config'
import { resolveExactProviderAndModel, providerHasCompletionCredential } from '../ai/providerManager'
import { isLiveOnlyModel } from '../ai/trustedRegistry'
import { cancelChatMessage, handleChatMessage } from '../ai/chatHandler'
import { getAgent, applyFirstMessageTitle, agentChatId } from './agents'
import { registerAgendaAgentChat, unregisterAgendaAgentChat } from './runContext'
import { broadcastIpc } from '../safeSend'

function resolveModelKey(requested: string | null | undefined): string {
  const config = loadConfig()
  const key = (requested?.trim() || config.agenda.modelKey?.trim() || config.lastSelectedChatModel?.trim() || '').trim()
  if (!key) {
    throw new Error(
      'Choose an Agenda model before starting a conversation. Open the model selector in the Agenda header and pick one.'
    )
  }
  if (isLiveOnlyModel(key)) {
    throw new Error(
      `The model "${key}" only supports real-time voice streaming. Pick a standard text model for Agenda.`
    )
  }
  const { provider, model } = resolveExactProviderAndModel(key)
  if (!provider || !model || !providerHasCompletionCredential(provider)) {
    throw new Error(
      `The model bound to this Agenda conversation (${key}) is unavailable. Choose another model.`
    )
  }
  return key
}

/**
 * Sends one message through a persistent Agenda creation agent. The call blocks
 * until the model finishes; the renderer receives the normal Chat events for
 * the agent's chat id.
 */
export async function sendAgendaAgentMessage(input: {
  agentId: string
  message: string
  modelKey?: string | null
}): Promise<{ ok: boolean; chatId?: string; error?: string }> {
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (!message) return { ok: false, error: 'The message cannot be empty.' }

  const agent = getAgent(input.agentId)
  if (!agent) return { ok: false, error: 'This Agenda agent no longer exists.' }

  const chatId = agentChatId(agent.id)
  let modelKey: string
  try {
    modelKey = resolveModelKey(input.modelKey)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const renamed = applyFirstMessageTitle(agent.id, message)
  if (renamed) broadcastIpc('agenda-agents-changed')

  registerAgendaAgentChat(chatId, agent.id)
  try {
    await handleChatMessage(
      null,
      { message, chatId, sessionMode: 'execution', modelKey },
      'chat'
    )
    return { ok: true, chatId }
  } catch (error) {
    return { ok: false, chatId, error: error instanceof Error ? error.message : String(error) }
  } finally {
    unregisterAgendaAgentChat(chatId)
  }
}

export function cancelAgendaAgentMessage(chatId: string): void {
  cancelChatMessage(chatId)
}

export function getAgendaAgentPromptCount(_chatId: string): number {
  // The context is removed as soon as the run finishes; only useful for tests.
  return 0
}
