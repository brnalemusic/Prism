import { executeSystemTool } from './systemTools'
import { getToolDefinition, JsonSchema, ToolDefinition, toolsManifest } from './toolsManifest'
import { SystemToolOutput, ToolAttachment } from './toolAttachments'
import type { ImageGenerationErrorCode } from './ai/imageGenerationCore'
import { imageGenerationToolError } from './ai/imageGeneration'

export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_JSON'
  | 'INVALID_ARGUMENTS'
  | 'REPEATED_CALL'
  | 'EXECUTION_FAILED'
  | 'CANCELLED'
  | ImageGenerationErrorCode

export interface ToolError {
  code: ToolErrorCode
  message: string
  details?: unknown
  retryable: boolean
}

export type ToolResultEnvelope = { ok: true; output: string } | { ok: false; error: ToolError }

export interface ValidatedToolExecution {
  args: Record<string, unknown>
  envelope: ToolResultEnvelope
  modelContent: string
  attachments?: ToolAttachment[]
}

export interface ToolExecutionContext {
  event?: unknown
  apiKey?: string
  signal?: AbortSignal
  chatId?: string
  disabledSkills?: string[]
  onStart?: (args: Record<string, unknown>) => void
}

export interface ValidatedToolArguments {
  ok: true
  args: Record<string, unknown>
}

export interface InvalidToolArguments {
  ok: false
  error: ToolError
}

const schemaKeywordsUnsupportedByGemini = new Set(['additionalProperties', 'default'])
const geminiSchemaTypes: Record<string, string> = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  integer: 'INTEGER',
  number: 'NUMBER',
  boolean: 'BOOLEAN'
}

export function schemaForGemini(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (schemaKeywordsUnsupportedByGemini.has(key)) continue
    if (Array.isArray(value)) {
      result[key] = value.map((entry) =>
        entry && typeof entry === 'object' ? schemaForGemini(entry as JsonSchema) : entry
      )
    } else if (value && typeof value === 'object') {
      if (key === 'properties') {
        result.properties = Object.fromEntries(
          Object.entries(value as Record<string, JsonSchema>).map(([name, child]) => [
            name,
            schemaForGemini(child)
          ])
        )
      } else {
        result[key] = schemaForGemini(value as JsonSchema)
      }
    } else {
      result[key] = key === 'type' && typeof value === 'string' ? geminiSchemaTypes[value] : value
    }
  }
  if (result.type === 'OBJECT' && !result.properties) result.properties = {}
  return result
}

import { isToolUnlockedForSession } from './skillsManager'
import { loadConfig } from './config'

const PPTX_TOOLS = new Set(['write_pptx', 'edit_pptx'])
const PDF_TOOLS = new Set(['write_pdf', 'edit_pdf'])
const BROWSER_TOOLS = new Set([
  'open_browser',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_back',
  'web_script',
  'detailed_dom_page'
])

const SKILL_LOCKED_TOOLS = new Set([
  ...PPTX_TOOLS,
  ...PDF_TOOLS,
  ...BROWSER_TOOLS
])

function isToolAvailableForSession(
  toolName: string,
  chatId?: string,
  disabledSkills?: string[]
): boolean {
  try {
    const disabled = disabledSkills ?? (loadConfig().disabledSkills || [])
    if (disabled.includes('pptx') && PPTX_TOOLS.has(toolName)) return false
    if (disabled.includes('pdf') && PDF_TOOLS.has(toolName)) return false
    if (disabled.includes('browser') && BROWSER_TOOLS.has(toolName)) return false
    if (
      toolName === 'read_skill' &&
      disabled.includes('pptx') &&
      disabled.includes('pdf') &&
      disabled.includes('browser')
    ) {
      return false
    }
  } catch {}

  if (!SKILL_LOCKED_TOOLS.has(toolName)) {
    return true
  }
  return isToolUnlockedForSession(toolName, chatId)
}

export function getOpenAiToolDefinitions(
  chatId?: string,
  disabledSkills?: string[]
): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}> {
  return toolsManifest
    .filter((definition) => isToolAvailableForSession(definition.name, chatId, disabledSkills))
    .map((definition) => ({
      type: 'function',
      function: {
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema as unknown as Record<string, unknown>
      }
    }))
}

export function getGeminiFunctionDeclarations(
  chatId?: string,
  disabledSkills?: string[]
): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  return toolsManifest
    .filter((definition) => isToolAvailableForSession(definition.name, chatId, disabledSkills))
    .map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: schemaForGemini(definition.inputSchema)
    }))
}

function typeDescription(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function validateValue(
  schema: JsonSchema,
  value: unknown,
  path: string
): { value?: unknown; errors: string[] } {
  const errors: string[] = []

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { errors: [`${path} must be an object; received ${typeDescription(value)}.`] }
    }
    const source = value as Record<string, unknown>
    const properties = schema.properties || {}
    const output: Record<string, unknown> = {}

    for (const requiredName of schema.required || []) {
      const requiredValue = source[requiredName]
      if (
        requiredValue === undefined ||
        requiredValue === null ||
        (typeof requiredValue === 'string' && requiredValue.trim() === '')
      ) {
        errors.push(`${path}.${requiredName} is required.`)
      }
    }

    for (const key of Object.keys(source)) {
      if (!properties[key]) {
        errors.push(`${path}.${key} is not a supported argument.`)
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      const childValue = source[key]
      if (childValue === undefined) {
        if (childSchema.default !== undefined) output[key] = childSchema.default
        continue
      }
      const child = validateValue(childSchema, childValue, `${path}.${key}`)
      errors.push(...child.errors)
      if (child.errors.length === 0) output[key] = child.value
    }
    return { value: output, errors }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return { errors: [`${path} must be an array; received ${typeDescription(value)}.`] }
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s).`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s).`)
    }
    const output: unknown[] = []
    if (schema.items) {
      value.forEach((entry, index) => {
        const child = validateValue(schema.items!, entry, `${path}[${index}]`)
        errors.push(...child.errors)
        if (child.errors.length === 0) output[index] = child.value
      })
    } else {
      output.push(...value)
    }
    return { value: output, errors }
  }

  const expectedType =
    schema.type === 'integer' || schema.type === 'number' ? 'number' : schema.type
  if (typeof value !== expectedType) {
    return { errors: [`${path} must be ${schema.type}; received ${typeDescription(value)}.`] }
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${path} must be an integer.`)
  }
  if ((schema.type === 'integer' || schema.type === 'number') && typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path} must be a finite number.`)
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}.`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}.`)
    }
  }
  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}.`)
  }
  return { value, errors }
}

function validateCrossFieldRules(
  definition: ToolDefinition,
  args: Record<string, unknown>
): string[] {
  if (definition.name === 'configure_prism' && Object.keys(args).length === 0) {
    return ['arguments must include at least one Prism setting.']
  }
  if (
    (definition.name === 'edit_pdf' || definition.name === 'edit_pptx') &&
    !args.id &&
    !args.path
  ) {
    return ['arguments must include either id or path.']
  }
  if (definition.name === 'delete_workflow' && !args.command && !args.id) {
    return ['arguments must include either command or id.']
  }
  if (
    definition.name === 'computer_use_edit_file' &&
    typeof args.startLine === 'number' &&
    typeof args.endLine === 'number' &&
    args.endLine < args.startLine
  ) {
    return ['arguments.endLine must be greater than or equal to arguments.startLine.']
  }
  return []
}

export function validateToolArguments(
  toolName: string,
  rawArgs: unknown
): ValidatedToolArguments | InvalidToolArguments {
  const definition = getToolDefinition(toolName)
  if (!definition) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_TOOL',
        message: `Tool "${toolName}" is not registered.`,
        details: { availableTools: toolsManifest.map((toolDefinition) => toolDefinition.name) },
        retryable: true
      }
    }
  }

  let args = rawArgs
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'INVALID_JSON',
          message: `Arguments for "${toolName}" are not valid JSON.`,
          details: error instanceof Error ? error.message : String(error),
          retryable: true
        }
      }
    }
  }

  const validation = validateValue(definition.inputSchema, args ?? {}, 'arguments')
  const validatedArgs = (validation.value || {}) as Record<string, unknown>
  const errors = [...validation.errors, ...validateCrossFieldRules(definition, validatedArgs)]
  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: `Arguments for "${toolName}" do not match its contract.`,
        details: errors,
        retryable: true
      }
    }
  }
  return { ok: true, args: validatedArgs }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)])
    )
  }
  return value
}

export class ToolLoopGuard {
  private readonly attempts = new Map<string, number>()

  register(toolName: string, args: unknown): ToolError | null {
    const fingerprintArgs =
      toolName === 'computer_use_see_screen' ? {} : args
    const fingerprint = JSON.stringify([toolName, stableValue(fingerprintArgs)])
    const count = (this.attempts.get(fingerprint) || 0) + 1
    this.attempts.set(fingerprint, count)
    if (count <= 3) return null
    return {
      code: 'REPEATED_CALL',
      message: `Blocked repeated call to "${toolName}" with identical arguments.`,
      details: { identicalAttempts: count, maximumAllowed: 3 },
      retryable: false
    }
  }
}

export async function executeValidatedTool(
  toolName: string,
  rawArgs: unknown,
  context: ToolExecutionContext,
  loopGuard?: ToolLoopGuard
): Promise<ValidatedToolExecution> {
  const validation = validateToolArguments(toolName, rawArgs)
  const repeatedError = loopGuard?.register(toolName, validation.ok ? validation.args : rawArgs)
  if (repeatedError) {
    context.onStart?.(
      validation.ok
        ? validation.args
        : rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {}
    )
    const envelope: ToolResultEnvelope = { ok: false, error: repeatedError }
    return { args: {}, envelope, modelContent: JSON.stringify(envelope) }
  }

  if (!validation.ok) {
    context.onStart?.(
      rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {}
    )
    const envelope: ToolResultEnvelope = { ok: false, error: validation.error }
    return { args: {}, envelope, modelContent: JSON.stringify(envelope) }
  }

  try {
    context.onStart?.(validation.args)
    const rawOutput = await executeSystemTool(
      toolName,
      validation.args,
      context.event,
      context.apiKey,
      context.signal,
      context.chatId,
      context.disabledSkills
    )
    const { output, attachments } = normalizeSystemToolOutput(rawOutput)
    if (attachments.length > 0) {
      console.info('[Tool Runtime] Prepared visual attachment.', {
        toolName,
        attachments: attachments.map((attachment) => ({
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          width: attachment.width,
          height: attachment.height,
          byteLength: attachment.byteLength
        }))
      })
    }
    if (/^Error(?:\s|:)/i.test(output)) {
      const envelope: ToolResultEnvelope = {
        ok: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: output,
          retryable: true
        }
      }
      return { args: validation.args, envelope, modelContent: JSON.stringify(envelope) }
    }
    const envelope: ToolResultEnvelope = { ok: true, output }
    return {
      args: validation.args,
      envelope,
      modelContent: JSON.stringify(envelope),
      ...(attachments.length > 0 ? { attachments } : {})
    }
  } catch (error) {
    const imageError = imageGenerationToolError(error)
    if (imageError) {
      const envelope: ToolResultEnvelope = {
        ok: false,
        error: {
          code: imageError.details.code,
          message: imageError.details.userMessage,
          details: {
            imageGeneration: imageError.details
          },
          retryable: imageError.details.retryable
        }
      }
      return { args: validation.args, envelope, modelContent: JSON.stringify(envelope) }
    }
    const cancelled =
      context.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
    const envelope: ToolResultEnvelope = {
      ok: false,
      error: {
        code: cancelled ? 'CANCELLED' : 'EXECUTION_FAILED',
        message: cancelled
          ? `Tool "${toolName}" was cancelled.`
          : `Tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: !cancelled
      }
    }
    return { args: validation.args, envelope, modelContent: JSON.stringify(envelope) }
  }
}

function normalizeSystemToolOutput(output: SystemToolOutput): {
  output: string
  attachments: ToolAttachment[]
} {
  if (typeof output === 'string') return { output, attachments: [] }
  return {
    output: output.output,
    attachments: Array.isArray(output.attachments) ? output.attachments : []
  }
}
