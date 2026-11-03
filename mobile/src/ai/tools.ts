import { fetchPage, searchWeb } from '../tools/web'
import { listFiles, readFile, writeFile } from '../tools/files'
import { executeAndroidCommand } from '../tools/terminal'
import { parseToolArguments } from './toolCatalog'
import type { ToolCall, ToolResult } from './toolCatalog'

export async function executeMobileTool(
  call: ToolCall,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<ToolResult> {
  try {
    let output: string
    switch (call.name) {
      case 'web_search':
        output = await searchWeb(String(args.query), Number(args.resultCount ?? 3), signal)
        break
      case 'read_page':
        output = await fetchPage(String(args.url), Number(args.maxCharacters ?? 8000), signal)
        break
      case 'list_files':
        output = await listFiles(String(args.directory))
        break
      case 'read_file':
        output = await readFile(String(args.path), Number(args.maxCharacters ?? 12000))
        break
      case 'write_file':
        output = await writeFile(String(args.path), String(args.content))
        break
      case 'execute_terminal_command':
        output = await executeAndroidCommand(String(args.command), signal)
        break
      default:
        throw new Error(`Tool ${call.name} is not available on Prism Mobile.`)
    }
    return { ok: true, output, retryable: true }
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
      retryable: false
    }
  }
}
