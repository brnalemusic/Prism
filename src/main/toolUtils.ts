/**
 * Shared tool utility functions extracted from gemini.ts.
 * Pure parsing/validation functions with no side effects or closure dependencies.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  isMalformed: boolean
  errorType:
    | 'json_syntax_error'
    | 'missing_type'
    | 'invalid_tool'
    | 'missing_args'
    | 'invalid_args'
    | 'xml_error'
    | 'none'
  errorMessage: string
  name: string | null
  args: Record<string, any>
}

export interface ToolArgs extends Record<string, any> {
  command?: string
  appPath?: string
  url?: string
  query?: string
  path?: string
  content?: string
  oldText?: string
  newText?: string
  sourcePath?: string
  destinationPath?: string
  overwrite?: string
  quantity?: string
  launcherShortcut?: string
  modelSelectionShortcut?: string
  screenshotShortcut?: string
  appName?: string
  defaultModel?: string
  subagentModel?: string
  minimizeToTray?: string
  autoLaunch?: string
  quickLauncherMode?: string
  userGeminiKey?: string
  username?: string
  instructions?: string
  model?: string
  thinkMode?: string
  searchEnabled?: string
  ttsVoice?: string
  terminalShell?: string
  zoomFactor?: string
  searches?: any[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const RAW_TOOL_ARG_TAGS = new Set(['command', 'content', 'oldText', 'newText'])

// Argument keys whose values must be preserved as structured JS objects/arrays
// rather than stringified. Currently used by the continuous web_search tool to
// keep the `searches` array intact through parse/validate.
export const OBJECT_TOOL_ARG_TAGS = new Set(['searches', 'toolConstraints'])

// ─── Helper: strip markdown code blocks ──────────────────────────────────────

export function stripMarkdownCodeBlocks(text: string): string {
  let trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    trimmed = trimmed
      .replace(/^```[a-z]*\n/i, '')
      .replace(/\n```$/i, '')
      .trim()
  }
  return trimmed
}

// ─── Normalize Tool Calls ────────────────────────────────────────────────────

export function normalizeToolCalls(text: string): string {
  if (!text) return ''

  // First, replace any raw <tool_call> / </tool_call> tags with [PRISM_EXECUTE_TOOL] / [/PRISM_EXECUTE_TOOL]
  let normalized = text
    .replace(/<tool_call>/gi, '[PRISM_EXECUTE_TOOL]')
    .replace(/<\/tool_call>/gi, '[/PRISM_EXECUTE_TOOL]')

  // Then, find any complete [PRISM_EXECUTE_TOOL]...[/PRISM_EXECUTE_TOOL] blocks
  normalized = normalized.replace(
    /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/gi,
    (_, inner) => {
      const trimmedInner = inner.trim()

      // If it's already a valid JSON object, keep it
      if (trimmedInner.startsWith('{')) {
        return `[PRISM_EXECUTE_TOOL]${trimmedInner}[/PRISM_EXECUTE_TOOL]`
      }

      // If it contains XML function/parameter structure, convert it to JSON
      const funcMatch = trimmedInner.match(/<function=([^>]+)>/i)
      if (funcMatch) {
        const functionName = funcMatch[1].trim().replace(/['"]/g, '')
        const toolObj: Record<string, any> = { type: functionName }

        const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi
        let paramMatch
        while ((paramMatch = paramRegex.exec(trimmedInner)) !== null) {
          const paramName = paramMatch[1].trim().replace(/['"]/g, '')
          const rawValue = paramMatch[2].trim()

          try {
            toolObj[paramName] = JSON.parse(rawValue)
          } catch {
            toolObj[paramName] = rawValue
          }
        }

        return `[PRISM_EXECUTE_TOOL]${JSON.stringify(toolObj)}[/PRISM_EXECUTE_TOOL]`
      }

      return `[PRISM_EXECUTE_TOOL]${trimmedInner}[/PRISM_EXECUTE_TOOL]`
    }
  )

  return normalized
}

export function completeIncompleteToolCalls(text: string): string {
  if (!text) return ''

  let result = text

  // Strip any partial closing tag at the end of the text
  const partialCloseMatch = result.match(/\[(?:\/PRISM_EXECUTE_TOOL)?$/)
  if (partialCloseMatch) {
    result = result.slice(0, -partialCloseMatch[0].length)
  }

  // Count opens vs closes to detect unclosed tool calls
  const opens = (result.match(/\[PRISM_EXECUTE_TOOL\]/g) || []).length
  const closes = (result.match(/\[\/PRISM_EXECUTE_TOOL\]/g) || []).length

  if (opens <= closes) return result

  // There are unclosed tool calls — try to close the last one properly
  const lastOpenIdx = result.lastIndexOf('[PRISM_EXECUTE_TOOL]')
  const contentStart = lastOpenIdx + '[PRISM_EXECUTE_TOOL]'.length
  let toolContent = result.substring(contentStart)

  // Try to close incomplete JSON: count open braces vs close braces
  const openBraces = (toolContent.match(/\{/g) || []).length
  const closeBraces = (toolContent.match(/\}/g) || []).length

  if (openBraces > closeBraces) {
    // Missing closing braces — close them
    toolContent += '}'.repeat(openBraces - closeBraces)
  }

  // Rebuild: prefix + content + closing tag
  result = result.substring(0, contentStart) + toolContent + '[/PRISM_EXECUTE_TOOL]'

  return result
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

export function parseToolCallsFromText(text: string): any[] {
  const toolCalls: any[] = []
  if (!text) return toolCalls
  const toolCallRegex = /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/gi
  let match
  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (parsed && typeof parsed === 'object') {
        toolCalls.push(parsed)
      }
    } catch {
      // skip unparseable tool calls
    }
  }
  return toolCalls
}

export function parseToolResultsFromText(
  text: string
): { name: string; result: string }[] {
  const results: { name: string; result: string }[] = []
  if (!text) return results
  const resultRegex =
    /\[RESULT FOR ([a-zA-Z0-9_]+)\]:\s*([\s\S]*?)(?=(?:\n*\[RESULT FOR|\n*\[SYSTEM|\n*Proceed|$))/gi
  let match
  while ((match = resultRegex.exec(text)) !== null) {
    results.push({
      name: match[1],
      result: match[2].trim()
    })
  }
  return results
}

// ─── Extract / Remove Tool Calls from text ────────────────────────────────────

function findToolCallEnd(normalizedText: string, searchStart: number): number {
  let searchIndex = searchStart
  while (true) {
    const nextCdata = normalizedText.indexOf('<![CDATA[', searchIndex)
    const nextEnd = normalizedText.indexOf('[/PRISM_EXECUTE_TOOL]', searchIndex)

    if (nextEnd === -1) return -1

    if (nextCdata !== -1 && nextCdata < nextEnd) {
      const cdataEnd = normalizedText.indexOf(']]>', nextCdata + 9)
      searchIndex = cdataEnd !== -1 ? cdataEnd + 3 : nextCdata + 9
    } else {
      return nextEnd
    }
  }
}

export function extractToolCalls(text: string): string[] {
  const normalizedText = normalizeToolCalls(text)
  const toolCalls: string[] = []
  let currentIndex = 0

  while (true) {
    const startIdx = normalizedText.indexOf('[PRISM_EXECUTE_TOOL]', currentIndex)
    if (startIdx === -1) break

    const contentStart = startIdx + 20 // '[PRISM_EXECUTE_TOOL]'.length
    const endIdx = findToolCallEnd(normalizedText, contentStart)

    if (endIdx !== -1) {
      toolCalls.push(normalizedText.substring(contentStart, endIdx))
      currentIndex = endIdx + 21 // '[/PRISM_EXECUTE_TOOL]'.length
    } else {
      currentIndex = startIdx + 20
    }
  }

  return toolCalls
}

export function removeToolCalls(text: string): string {
  let result = normalizeToolCalls(text)
  let currentIndex = 0
  while (true) {
    const startIdx = result.indexOf('[PRISM_EXECUTE_TOOL]', currentIndex)
    if (startIdx === -1) break

    const contentStart = startIdx + 20
    const endIdx = findToolCallEnd(result, contentStart)

    if (endIdx !== -1) {
      result = result.substring(0, startIdx) + result.substring(endIdx + 21)
    } else {
      currentIndex = startIdx + 20
    }
  }
  return result
}

// ─── Tool Call Parsing & Validation ──────────────────────────────────────────

export function parseToolCall(toolContent: string): { name: string | null; args: ToolArgs } {
  let trimmed = stripMarkdownCodeBlocks(toolContent)

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      const name = (obj.type || obj.name || null) as string | null
      const args: ToolArgs = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type') continue
        if (key === 'name' && value === name) continue

        // Preserve structured values (arrays/objects) for tagged keys
        if (OBJECT_TOOL_ARG_TAGS.has(key) && typeof value === 'object' && value !== null) {
          args[key] = value as unknown as string
          continue
        }
        let val = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        if (!RAW_TOOL_ARG_TAGS.has(key)) {
          val = val.trim()
        }
        args[key] = val
      }
      return { name, args }
    } catch {
      // fall through
    }
  }

  return { name: null, args: {} }
}

function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i]
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      )
    }
  }
  return tmp[a.length][b.length]
}

export function findClosestTool(name: string, availableTools: string[]): string {
  if (availableTools.length === 0) return ''
  let closest = ''
  let minDistance = Infinity
  for (const tool of availableTools) {
    const dist = getLevenshteinDistance(name.toLowerCase(), tool.toLowerCase())
    if (dist < minDistance) {
      minDistance = dist
      closest = tool
    }
  }
  return closest
}

/**
 * Validates a tool call's arguments against the manifest schema.
 */
export function validateSchemaArgs(
  toolName: string,
  args: ToolArgs,
  manifest: { name: string; parameters: Record<string, string> }[]
): { type: 'missing_args' | 'invalid_args'; message: string } | null {
  const schema = manifest.find((t) => t.name === toolName)
  if (!schema) return null

  const expectedParams = schema.parameters || {}
  const passedParams = Object.keys(args)

  // 1. Check for missing required arguments
  const missingArgs: string[] = []
  for (const [paramName, paramDesc] of Object.entries(expectedParams)) {
    if (paramName.includes(':')) continue

    const isOptional = paramDesc.toLowerCase().includes('optional')
    const isRequired = !isOptional

    if (
      isRequired &&
      (args[paramName] === undefined || args[paramName] === null || args[paramName] === '')
    ) {
      missingArgs.push(paramName)
    }
  }

  // Special validation for run_subagents quantity and prompts
  if (toolName === 'run_subagents') {
    const quantityVal = parseInt(args.quantity || '0', 10)
    if (isNaN(quantityVal) || quantityVal <= 0) {
      return {
        type: 'invalid_args',
        message: `Argument "quantity" for "run_subagents" must be a positive integer. Passed: "${args.quantity}".`
      }
    }
    const missingPrompts: string[] = []
    for (let i = 1; i <= quantityVal; i++) {
      const key = `prompt:${i}`
      if (!args[key] || args[key].trim() === '') {
        missingPrompts.push(key)
      }
    }
    if (missingPrompts.length > 0) {
      return {
        type: 'missing_args',
        message: `Tool "run_subagents" is missing required arguments for quantity=${quantityVal}: ${missingPrompts.join(', ')}.`
      }
    }
  }

  // Special validation for configure_prism: make sure at least one parameter is passed
  if (toolName === 'configure_prism') {
    const hasAtLeastOneArg = passedParams.some(
      (key) => key !== 'rawContent' && key !== 'originalName' && expectedParams[key] !== undefined
    )
    if (!hasAtLeastOneArg) {
      return {
        type: 'missing_args',
        message: `Tool "configure_prism" requires at least one setting to configure. Valid parameters are: ${Object.keys(expectedParams).join(', ')}`
      }
    }
  }

  if (missingArgs.length > 0) {
    return {
      type: 'missing_args',
      message: `Missing required argument(s) for tool "${toolName}": ${missingArgs.map((a) => `"${a}"`).join(', ')}.\nExpected parameters:\n${JSON.stringify(expectedParams, null, 2)}`
    }
  }

  // Custom validation for computer_use_read_file
  if (toolName === 'computer_use_read_file') {
    const startLineNum = Number(args.startLine)
    if (isNaN(startLineNum) || !Number.isInteger(startLineNum) || startLineNum <= 0) {
      return {
        type: 'invalid_args',
        message: `Argument "startLine" for "computer_use_read_file" must be a positive integer. Passed: "${args.startLine}".`
      }
    }
    if (args.limit !== undefined && args.limit !== null && args.limit !== '') {
      const limitNum = Number(args.limit)
      if (isNaN(limitNum) || !Number.isInteger(limitNum) || limitNum <= 0) {
        return {
          type: 'invalid_args',
          message: `Argument "limit" for "computer_use_read_file" must be a positive integer. Passed: "${args.limit}".`
        }
      }
      if (limitNum > 200) {
        return {
          type: 'invalid_args',
          message: `Argument "limit" for "computer_use_read_file" cannot exceed 200. Passed: "${args.limit}".`
        }
      }
    }
  }

  // 2. Check for unknown arguments
  const unknownArgs: string[] = []
  for (const passedKey of passedParams) {
    if (passedKey === 'rawContent' || passedKey === 'originalName') continue

    let isExpected = expectedParams[passedKey] !== undefined

    if (!isExpected && toolName === 'run_subagents' && passedKey.startsWith('prompt:')) {
      const parts = passedKey.split(':')
      const num = parseInt(parts[1], 10)
      if (!isNaN(num) && num > 0) {
        isExpected = true
      }
    }

    if (!isExpected) {
      unknownArgs.push(passedKey)
    }
  }

  if (unknownArgs.length > 0) {
    return {
      type: 'invalid_args',
      message: `Unknown argument(s) passed to tool "${toolName}": ${unknownArgs.map((a) => `"${a}"`).join(', ')}.\nValid parameters are: ${Object.keys(expectedParams).join(', ')}`
    }
  }

  // 3. Type/format validation
  for (const [key, value] of Object.entries(args)) {
    if (key === 'rawContent' || key === 'originalName') continue
    if (OBJECT_TOOL_ARG_TAGS.has(key)) continue
    const desc = expectedParams[key] ? expectedParams[key].toLowerCase() : ''

    // Boolean checks
    const expectsBool =
      desc.includes('true/false') ||
      desc.includes('true|false') ||
      desc.includes('optional true|false')
    if (expectsBool) {
      if (value !== 'true' && value !== 'false') {
        return {
          type: 'invalid_args',
          message: `Argument "${key}" for tool "${toolName}" must be a string value of either "true" or "false". Passed: "${value}".`
        }
      }
    }

    // Number checks
    const expectsNumber =
      desc.includes('number') ||
      desc.includes('integer') ||
      desc.includes('max time') ||
      desc.includes('max messages') ||
      desc.includes('starting line number') ||
      desc.includes('ending line number')
    if (expectsNumber) {
      const num = Number(value)
      if (isNaN(num)) {
        return {
          type: 'invalid_args',
          message: `Argument "${key}" for tool "${toolName}" must be a valid number representation. Passed: "${value}".`
        }
      }
    }
  }

  // 4. Continuous web_search "searches" validation
  if (toolName === 'web_search' && args.searches !== undefined) {
    const raw = args.searches as unknown
    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        type: 'invalid_args',
        message:
          'Argument "searches" for tool "web_search" must be a non-empty array of objects, each with "title" and "query" strings.'
      }
    }
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i] as { title?: unknown; query?: unknown }
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof entry.title !== 'string' ||
        typeof entry.query !== 'string' ||
        entry.query.trim() === ''
      ) {
        return {
          type: 'invalid_args',
          message: `Each item in "searches" (index ${i}) must be an object with non-empty string "title" and "query".`
        }
      }
    }
  }

  return null
}

/**
 * Validates a complete tool call string and returns the validation result.
 */
export function validateToolCall(
  toolContent: string,
  availableTools: string[],
  manifest: { name: string; parameters: Record<string, string> }[]
): ValidationResult {
  let trimmed = stripMarkdownCodeBlocks(toolContent)

  if (!trimmed.startsWith('{')) {
    let errorMsg =
      'Every tool call MUST be a valid JSON object. XML and other non-JSON formats are not supported. ' +
      'Please rewrite your tool call as a valid JSON object inside the [PRISM_EXECUTE_TOOL]...[/PRISM_EXECUTE_TOOL] tags.'

    if (trimmed.startsWith('<') && (trimmed.includes('</') || trimmed.includes('>'))) {
      errorMsg =
        'XML tool call format is deprecated and not supported. All tool calls MUST strictly be valid JSON objects inside the [PRISM_EXECUTE_TOOL]...[/PRISM_EXECUTE_TOOL] tags (e.g., {"type": "web_search", "query": "..."}). Please rewrite it.'
    }

    return {
      isMalformed: true,
      errorType: 'json_syntax_error',
      errorMessage: errorMsg,
      name: null,
      args: { rawContent: toolContent }
    }
  }

  // Must be JSON
  try {
    const obj = JSON.parse(trimmed)
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return {
        isMalformed: true,
        errorType: 'json_syntax_error',
        errorMessage: 'Every tool call must be a valid JSON object. Parsed JSON was not an object.',
        name: null,
        args: { rawContent: toolContent }
      }
    }

    const name = (obj.type || obj.name || null) as string | null
    if (!name) {
      return {
        isMalformed: true,
        errorType: 'missing_type',
        errorMessage:
          'The tool call is missing the "type" property. Every tool call must start with a "type" property specifying the exact name of the tool (e.g., {"type": "web_search", ...}).',
        name: null,
        args: { rawContent: toolContent }
      }
    }

    if (!availableTools.includes(name)) {
      const suggestion = findClosestTool(name, availableTools)
      return {
        isMalformed: true,
        errorType: 'invalid_tool',
        errorMessage: `The tool name "${name}" is not recognized. Did you mean "${suggestion}"? Available tools are: ${availableTools.join(', ')}.`,
        name: name,
        args: { rawContent: toolContent, originalName: name }
      }
    }

    const args: ToolArgs = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'type') continue
      if (key === 'name' && value === name) continue

      // Preserve structured values (arrays/objects) for tagged keys.
      if (OBJECT_TOOL_ARG_TAGS.has(key) && typeof value === 'object' && value !== null) {
        args[key] = value as unknown as string
        continue
      }
      let val = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      if (!RAW_TOOL_ARG_TAGS.has(key)) {
        val = val.trim()
      }
      args[key] = val
    }

    const schemaError = validateSchemaArgs(name, args, manifest)
    if (schemaError) {
      return {
        isMalformed: true,
        errorType: schemaError.type,
        errorMessage: schemaError.message,
        name: name,
        args: { rawContent: toolContent, originalName: name }
      }
    }

    return {
      isMalformed: false,
      errorType: 'none',
      errorMessage: '',
      name,
      args
    }
  } catch (err: any) {
    const detail = err.message || ''
    let customExplanation = ''

    if (trimmed.includes("'")) {
      customExplanation +=
        ' Note: JSON keys and string values MUST use double quotes ("), not single quotes (\').'
    }
    if (/,\s*([}\]])/.test(trimmed)) {
      customExplanation +=
        ' Note: Trailing commas before a closing brace } or bracket ] are not allowed in JSON.'
    }
    if (trimmed.includes('\u201c') || trimmed.includes('\u201d')) {
      customExplanation +=
        ' Note: Smart/curly quotes (\u201c or \u201d) are invalid. Use standard straight double quotes (").'
    }
    if (trimmed.includes('\n') && !/\\n/.test(trimmed)) {
      customExplanation +=
        ' Note: Raw newlines inside JSON string values are not allowed; use escaped newlines (\\n) instead.'
    }

    const explanation = `JSON Syntax Error: ${detail}.${customExplanation}\nMake sure your tool call is a valid JSON object.`

    return {
      isMalformed: true,
      errorType: 'json_syntax_error',
      errorMessage: explanation,
      name: null,
      args: { rawContent: toolContent }
    }
  }
}
