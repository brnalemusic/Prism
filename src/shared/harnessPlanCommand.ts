export interface HarnessPlanCommand {
  matched: boolean
  request: string
}

export function parseHarnessPlanCommand(input: string): HarnessPlanCommand {
  const match = input.trim().match(/^\$plan(?:\s+([\s\S]*))?$/i)
  return match
    ? { matched: true, request: match[1]?.trim() || '' }
    : { matched: false, request: '' }
}

export function buildHarnessImplementationHandoff(plan: string, context: string): string {
  return (
    `# Approved Implementation Plan\n\n${plan.trim()}\n\n` +
    `# Implementation Context\n\n${context.trim()}\n\n` +
    'Begin implementing this plan now. Preserve every stated constraint and verify the complete result.'
  )
}

export const HARNESS_PLAN_APPROVED_MARKER = '# Implementation plan approved'

/**
 * Same-chat approval only needs a short confirmation: the approved plan is
 * already in the session history, so resending it would duplicate the model
 * context. The renderer renders this message as the compact
 * "Implementation plan approved" note instead of a full user bubble.
 */
export function buildHarnessPlanApprovalMessage(): string {
  return (
    `${HARNESS_PLAN_APPROVED_MARKER}\n\n` +
    'Continue in Build mode: implement the approved plan from this conversation and report the verification results. ' +
    'For a linked Git recovery, explicitly stage only the resolved conflicts and leave Git continuation to the user through Retry.'
  )
}
