import { randomInt, randomUUID } from 'crypto'
import type {
  AgendaAgentDeletionChallenge,
  AgendaAgentDeletionStepResult
} from '../../shared/agendaTypes'
import { countTasksForAgent } from './tasks'
import { getAgent } from './agents'

const CHALLENGE_TTL_MS = 10 * 60 * 1000
const VERIFIED_TTL_MS = 2 * 60 * 1000
const MAX_ATTEMPTS = 5

interface Puzzle {
  question: string
  answer: string
}

interface PendingChallenge {
  challengeId: string
  agentId: string
  agentTitle: string
  scheduleCount: number
  step: 1 | 2 | 3
  expiresAt: number
  verifiedAt: number | null
  attempts: number
  puzzle: Puzzle
}

const pending = new Map<string, PendingChallenge>()

function purgeExpired(now = Date.now()): void {
  for (const [id, challenge] of pending) {
    const deadline = challenge.verifiedAt
      ? challenge.verifiedAt + VERIFIED_TTL_MS
      : challenge.expiresAt
    if (deadline <= now) pending.delete(id)
  }
}

/** A generated arithmetic puzzle. Deliberately not unique per deletion. */
function createPuzzle(): Puzzle {
  const a = randomInt(2, 13)
  const b = randomInt(2, 10)
  const c = randomInt(2, 10)
  return {
    question: `${a} + ${b} × ${c}`,
    answer: String(a + b * c)
  }
}

function describe(challenge: PendingChallenge): AgendaAgentDeletionChallenge {
  return {
    challengeId: challenge.challengeId,
    agentId: challenge.agentId,
    agentTitle: challenge.agentTitle,
    scheduleCount: challenge.scheduleCount,
    step: challenge.step,
    expiresAt: challenge.expiresAt,
    ...(challenge.step === 3 ? { puzzle: { question: challenge.puzzle.question } } : {})
  }
}

function fail(challenge: PendingChallenge, error: string): AgendaAgentDeletionStepResult {
  return { ok: false, error, challenge: describe(challenge) }
}

/** Starts the three-step verification for deleting an agent and its schedules. */
export function startAgentDeletionChallenge(
  agentId: string
): AgendaAgentDeletionStepResult {
  purgeExpired()
  const agent = getAgent(agentId)
  if (!agent) return { ok: false, error: 'Agent not found.' }
  if (agent.isMain) {
    return { ok: false, error: 'The Main Agenda agent cannot be deleted.' }
  }

  const challenge: PendingChallenge = {
    challengeId: randomUUID(),
    agentId: agent.id,
    agentTitle: agent.title,
    scheduleCount: countTasksForAgent(agent.id),
    step: 1,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    verifiedAt: null,
    attempts: 0,
    puzzle: createPuzzle()
  }
  pending.set(challenge.challengeId, challenge)
  return { ok: true, challenge: describe(challenge) }
}

/**
 * Advances one step. Step 1 needs an acknowledgement, step 2 needs the exact
 * agent title and step 3 needs the generated puzzle answer.
 */
export function advanceAgentDeletionChallenge(input: {
  challengeId: string
  acknowledged?: boolean
  answer?: string
}): AgendaAgentDeletionStepResult {
  purgeExpired()
  const challenge = pending.get(input.challengeId)
  if (!challenge) {
    return { ok: false, error: 'This verification expired. Start again.' }
  }
  if (challenge.verifiedAt) {
    return { ok: true, challenge: describe(challenge), complete: true }
  }

  if (challenge.step === 1) {
    if (input.acknowledged !== true) {
      return fail(challenge, 'Confirm that you understand the deletion is permanent.')
    }
    challenge.step = 2
    return { ok: true, challenge: describe(challenge) }
  }

  if (challenge.step === 2) {
    const answer = typeof input.answer === 'string' ? input.answer.trim() : ''
    if (!answer) return fail(challenge, `Type the agent name "${challenge.agentTitle}" to continue.`)
    if (answer !== challenge.agentTitle) {
      challenge.attempts += 1
      if (challenge.attempts >= MAX_ATTEMPTS) {
        pending.delete(challenge.challengeId)
        return { ok: false, error: 'Too many attempts. Start the verification again.' }
      }
      return fail(challenge, 'The agent name does not match exactly.')
    }
    challenge.step = 3
    challenge.attempts = 0
    return { ok: true, challenge: describe(challenge) }
  }

  const answer = typeof input.answer === 'string' ? input.answer.trim() : ''
  if (answer !== challenge.puzzle.answer) {
    challenge.attempts += 1
    if (challenge.attempts >= MAX_ATTEMPTS) {
      pending.delete(challenge.challengeId)
      return { ok: false, error: 'Too many attempts. Start the verification again.' }
    }
    return fail(challenge, 'That answer is not correct. Try the puzzle again.')
  }

  challenge.verifiedAt = Date.now()
  return { ok: true, challenge: describe(challenge), complete: true }
}

/**
 * Consumes a verified challenge. Deletion must call this immediately before
 * removing data so a stale challenge can never authorize a second deletion.
 */
export function consumeAgentDeletionChallenge(
  challengeId: string,
  agentId: string
): { ok: boolean; error?: string } {
  purgeExpired()
  const challenge = pending.get(challengeId)
  if (!challenge || challenge.agentId !== agentId) {
    return { ok: false, error: 'The verification is missing or expired.' }
  }
  if (!challenge.verifiedAt) {
    return { ok: false, error: 'The verification is not complete.' }
  }
  pending.delete(challengeId)
  return { ok: true }
}

export function cancelAgentDeletionChallenge(challengeId: string): void {
  pending.delete(challengeId)
}
