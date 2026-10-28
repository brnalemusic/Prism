import * as os from 'os'
import type { McpInstallPreset } from '../../shared/mcpTypes'

/**
 * Curated one-click servers. They use the official reference packages through
 * `npx`, so the only prerequisite is Node, which Prism already ships with.
 */
export function getMcpPresets(): McpInstallPreset[] {
  return [
    {
      id: 'filesystem',
      name: 'Filesystem',
      description: 'Read and write files inside a folder you choose.',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()],
      url: ''
    },
    {
      id: 'memory',
      name: 'Memory',
      description: 'A persistent knowledge graph the agent can read and update.',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      url: ''
    },
    {
      id: 'sequential-thinking',
      name: 'Sequential Thinking',
      description: 'Structured step-by-step reasoning for complex tasks.',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      url: ''
    },
    {
      id: 'everything',
      name: 'Everything (test server)',
      description: 'Reference server with sample tools, prompts and resources.',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
      url: ''
    }
  ]
}
