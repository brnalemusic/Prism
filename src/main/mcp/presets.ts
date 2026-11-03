import * as os from 'os'
import type { McpGalleryPreset, McpInstallPreset } from '../../shared/mcpTypes'

/**
 * Gallery integrations use provider OAuth account sign-in. The server id is the preset id so
 * reconnecting updates the same entry and Agenda tasks keep pointing at it.
 */
const GALLERY_PRESETS: McpGalleryPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Work with repositories, issues, pull requests and code through GitHub’s hosted MCP server.',
    brand: 'github',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://api.githubcopilot.com/mcp/',
    permissions: ['Repositories', 'Issues and pull requests', 'Profile'],
    auth: 'oauth',
    setupHint: 'Requires a GitHub OAuth App client ID and secret registered with the Prism callback URL.'
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Explore projects and manage Supabase resources using your signed-in account.',
    brand: 'supabase',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://mcp.supabase.com/mcp',
    permissions: ['Organizations', 'Projects', 'Database and platform resources'],
    auth: 'oauth',
    setupHint: 'Requires a Supabase OAuth App client ID and secret registered with the Prism callback URL.'
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Search and manage Gmail using Google account consent and official Gmail MCP.',
    brand: 'gmail',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
    permissions: ['Gmail data allowed by the configured OAuth consent screen'],
    auth: 'google-oauth-client',
    setupHint: 'Requires a Google Cloud OAuth client configured for an AI-powered agent.'
  }
]

/** Pre-configured integrations that only need a sign-in. */
export function getMcpGalleryPresets(): McpGalleryPreset[] {
  return GALLERY_PRESETS.map((preset) => ({ ...preset, permissions: [...preset.permissions] }))
}

export function getMcpGalleryPreset(id: string): McpGalleryPreset | null {
  return getMcpGalleryPresets().find((preset) => preset.id === id) ?? null
}

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
