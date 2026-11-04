import type { ToolCallRecord } from '../domain/types'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const string = (description: string): Record<string, unknown> => ({ type: 'string', description })
const integer = (
  description: string,
  minimum: number,
  maximum: number
): Record<string, unknown> => ({ type: 'integer', description, minimum, maximum })
const object = (
  properties: Record<string, Record<string, unknown>>,
  required: string[]
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

export const MOBILE_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search DuckDuckGo and return a few relevant public web sources.',
    parameters: object(
      { query: string('Search query.'), resultCount: integer('Number of results.', 1, 5) },
      ['query']
    )
  },
  {
    name: 'read_page',
    description: 'Read and extract text from one public HTTP(S) page.',
    parameters: object(
      {
        url: string('Public HTTP(S) URL.'),
        maxCharacters: integer('Maximum extracted characters.', 1000, 12000)
      },
      ['url']
    )
  },
  {
    name: 'list_files',
    description: 'List files in Prism private storage or a user-granted storage folder.',
    parameters: object(
      { directory: string('A path relative to the Prism storage root or a granted folder.') },
      ['directory']
    )
  },
  {
    name: 'read_file',
    description: 'Read a bounded UTF-8 text file within Prism storage or a granted folder.',
    parameters: object(
      {
        path: string('A path relative to an available storage root.'),
        maxCharacters: integer('Maximum characters.', 1, 20000)
      },
      ['path']
    )
  },
  {
    name: 'write_file',
    description:
      'Create a new UTF-8 text file in Prism storage or a granted folder. Existing files are never overwritten.',
    parameters: object(
      {
        path: string('A path relative to an available storage root.'),
        content: string('Complete UTF-8 text content.')
      },
      ['path', 'content']
    )
  },
  {
    name: 'execute_terminal_command',
    description:
      'Run a bounded command using Android /system/bin/sh inside Prism app sandbox. No root; other apps private data is inaccessible.',
    parameters: object({ command: string('Shell command, maximum 2000 characters.') }, ['command'])
  }
]

export function mobileToolDefinitions(protocol: 'openai' | 'anthropic' | 'gemini'): unknown[] {
  if (protocol === 'gemini')
    return [
      {
        functionDeclarations: MOBILE_TOOLS.map(({ name, description, parameters }) => {
          const { additionalProperties: _unsupported, ...geminiParameters } = parameters
          return { name, description, parameters: geminiParameters }
        })
      }
    ]
  if (protocol === 'anthropic')
    return MOBILE_TOOLS.map(({ name, description, parameters }) => ({
      name,
      description,
      input_schema: parameters
    }))
  return MOBILE_TOOLS.map(({ name, description, parameters }) => ({
    type: 'function',
    function: { name, description, parameters }
  }))
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}
export interface ToolResult {
  ok: boolean
  output: string
  retryable: boolean
}

export function shouldOfferMobileTools(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (/\b(what does|what is|what's|explain|define|o que (e|é)|explique|defina)\b/i.test(text))
    return false
  if (/https?:\/\/\S+/i.test(text)) return true
  return /\b(search|look up|browse|search the web|google|duckduckgo|pesquis[ae]|busc[ae]|procura|na internet|na web|site|link|url|read (this |the )?(page|article|file)|open (this |the )?(page|file)|summari[sz]e (this |the )?(page|article|file)|leia (esta |essa |a )?(p[aá]gina|mat[eé]ria|arquivo)|abra (este |esse |o )?(link|arquivo)|resuma (esta |essa |a )?(p[aá]gina|mat[eé]ria|arquivo)|arquivo|pasta|diret[oó]rio|crie (um |uma )?(arquivo|documento)|salve (em |no |na )?(arquivo|documento)|write (a |the )?(file|document)|create (a |the )?(file|document)|list files|listar arquivos|execute (this |the )?(command|script)|run (this |the )?(command|script|code|test)|terminal|shell command|comando(s)? (no |de )?(terminal|shell)|executar (o |um )?(comando|script|teste)|rodar (o |um )?(comando|script|teste))\b/i.test(
    text
  )
}

export function parseToolArguments(call: ToolCall): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(call.arguments || '{}')
  } catch {
    throw new Error(`Arguments for ${call.name} are not valid JSON.`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Arguments for ${call.name} must be a JSON object.`)
  const definition = MOBILE_TOOLS.find((tool) => tool.name === call.name)
  if (!definition) throw new Error(`Tool ${call.name} is unavailable on Prism Mobile.`)
  const properties = definition.parameters.properties as Record<string, Record<string, unknown>>
  const args = value as Record<string, unknown>
  const required = definition.parameters.required as string[]
  for (const key of Object.keys(args))
    if (!(key in properties)) throw new Error(`Unsupported argument: ${key}.`)
  for (const key of required)
    if (args[key] === undefined || args[key] === null || args[key] === '')
      throw new Error(`Missing required argument: ${key}.`)
  for (const [key, item] of Object.entries(args)) {
    const schema = properties[key]
    if (schema?.type === 'string' && typeof item !== 'string')
      throw new Error(`${key} must be a string.`)
    if (schema?.type === 'integer') {
      if (typeof item !== 'number' || !Number.isInteger(item))
        throw new Error(`${key} must be an integer.`)
      if (item < Number(schema.minimum) || item > Number(schema.maximum))
        throw new Error(`${key} must be between ${schema.minimum} and ${schema.maximum}.`)
    }
  }
  return args
}

export function toolStatus(
  call: ToolCall,
  status: ToolCallRecord['status'],
  result?: string
): ToolCallRecord {
  return { ...call, status, ...(result === undefined ? {} : { result }) }
}
