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
