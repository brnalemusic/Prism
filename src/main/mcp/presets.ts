import * as os from 'os'
import type { McpGalleryPreset, McpInstallPreset } from '../../shared/mcpTypes'

/**
 * Gallery integrations ship pre-configured: the user only supplies credentials
 * through Prism's native sign-in dialog. The server id is the preset id so
 * reconnecting updates the same entry and Agenda tasks keep pointing at it.
 */
const GALLERY_PRESETS: McpGalleryPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests, repositories and code search through the official GitHub MCP server.',
    brand: 'github',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://api.githubcopilot.com/mcp/',
    authEnvKey: 'GITHUB_TOKEN',
    fields: [
      {
        key: 'GITHUB_TOKEN',
        label: 'Personal access token',
        placeholder: 'github_pat_...',
        hint: 'Use a fine-grained token with access to the repositories this integration should reach.',
        secret: true,
        helpUrl: 'https://github.com/settings/tokens?type=beta',
        helpLabel: 'Create a GitHub token'
      }
    ]
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Query projects, tables and SQL through the official hosted Supabase MCP server.',
    brand: 'supabase',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://mcp.supabase.com/mcp',
    authEnvKey: 'SUPABASE_ACCESS_TOKEN',
    fields: [
      {
        key: 'SUPABASE_ACCESS_TOKEN',
        label: 'Personal access token',
        placeholder: 'sbp_...',
        hint: 'Create a token under Account → Access tokens in the Supabase dashboard.',
        secret: true,
        helpUrl: 'https://supabase.com/dashboard/account/tokens',
        helpLabel: 'Open Supabase tokens'
      }
    ]
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, search, label and delete email over Gmail IMAP with an app password.',
    brand: 'gmail',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@web4w3/gmail-mcp-server'],
    url: '',
    fields: [
      {
        key: 'GMAIL_USER',
        label: 'Gmail address',
        placeholder: 'you@gmail.com',
        hint: 'The account the agent should read.',
        helpUrl: 'https://myaccount.google.com/apppasswords',
        helpLabel: 'Create an app password'
      },
      {
        key: 'GMAIL_APP_PASSWORD',
        label: 'App password',
        placeholder: '16-character app password',
        hint: 'Requires 2-Step Verification. Use an app password, never your Google password.',
        secret: true,
        helpUrl: 'https://myaccount.google.com/apppasswords',
        helpLabel: 'Open Google app passwords'
      }
    ]
  }
]

/** Pre-configured integrations that only need a sign-in. */
export function getMcpGalleryPresets(): McpGalleryPreset[] {
  return GALLERY_PRESETS.map((preset) => ({ ...preset, fields: preset.fields.map((field) => ({ ...field })) }))
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
