export interface ToolDefinition {
  name: string
  description: string
  usage: string
  parameters: Record<string, string>
}

export const toolsManifest: ToolDefinition[] = [
  {
    name: 'run_subagents',
    description: 'Spawns one or more sub-agents to perform parallel tasks. Waits for ALL sub-agents to finish and returns their detailed outputs.',
    usage: '<tool_call><name>run_subagents</name><quantity>X</quantity><prompt:1>FIRST_PROMPT</prompt:1><prompt:2>SECOND_PROMPT</prompt:2></tool_call>',
    parameters: {
      quantity: 'Number of agents to spawn.',
      'prompt:1': 'Prompt for the first agent.',
      'prompt:2': 'Prompt for the second agent (and so on).'
    }
  },
  {
    name: 'agent_message',
    description: 'Sends a message to a specific sub-agent or all teammates.',
    usage: '<tool_call><name>agent_message</name><recipient>INDEX_OR_ALL</recipient><content>MESSAGE_TEXT</content></tool_call>',
    parameters: {
      recipient: 'Target agent index (0, 1, 2...) or "all".',
      content: 'The message content.'
    }
  },
  {
    name: 'agent_wait',
    description: 'Waits for a message from a specific agent or any teammate with a timeout. Exits early if a message arrives.',
    usage: '<tool_call><name>agent_wait</name><targetAgent>INDEX_OR_ANY</targetAgent><timeoutSeconds>SECONDS</timeoutSeconds></tool_call>',
    parameters: {
      targetAgent: 'Wait for a message from this agent index (0, 1, 2...) or "any".',
      timeoutSeconds: 'Max seconds to wait (default 50, max 50).'
    }
  },
  {
    name: 'execute_terminal_command',
    description: 'Runs shell commands (cmd/ps). Use for sys-info, scripts, or complex CLI.',
    usage: '<tool_call><name>execute_terminal_command</name><command>CMD</command></tool_call>',
    parameters: {
      command: 'The command to execute.'
    }
  },
  {
    name: 'computer_use_create_file',
    description: 'Creates file with content. Auto-creates parent folders.',
    usage: '<tool_call><name>computer_use_create_file</name><path>PATH</path><content>CONTENT</content></tool_call>',
    parameters: {
      path: 'File path.',
      content: 'Text content.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Creates a new directory.',
    usage: '<tool_call><name>computer_use_create_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Folder path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Deletes a file.',
    usage: '<tool_call><name>computer_use_remove_file</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'File path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Recursively deletes a directory.',
    usage: '<tool_call><name>computer_use_remove_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Folder path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Overwrites/Saves content to file.',
    usage: '<tool_call><name>computer_use_save_file</name><path>PATH</path><content>CONTENT</content></tool_call>',
    parameters: {
      path: 'File path.',
      content: 'New content.'
    }
  },
  {
    name: 'computer_use_replace_in_file',
    description: 'Replaces all occurrences of string in file.',
    usage: '<tool_call><name>computer_use_replace_in_file</name><path>PATH</path><oldText>OLD</oldText><newText>NEW</newText></tool_call>',
    parameters: {
      path: 'File path.',
      oldText: 'Text to find.',
      newText: 'Replacement text.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'Lists folder contents.',
    usage: '<tool_call><name>computer_use_list_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Folder path.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Reads full file content.',
    usage: '<tool_call><name>computer_use_read_file</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'File path.'
    }
  },
  {
    name: 'list_installed_applications',
    description: 'Lists up to 50 installed apps.',
    usage: '<tool_call><name>list_installed_applications</name></tool_call>',
    parameters: {}
  },
  {
    name: 'open_application',
    description: 'Opens app/file/folder with system default.',
    usage: '<tool_call><name>open_application</name><appPath>PATH</appPath></tool_call>',
    parameters: {
      appPath: 'Path to target.'
    }
  },
  {
    name: 'web_search',
    description: 'Web search using Mojeek and DuckDuckGo for real-time info.',
    usage: '<tool_call><name>web_search</name><query>QUERY</query></tool_call>',
    parameters: {
      query: 'Search query.'
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Fetches/Reads webpage text content.',
    usage: '<tool_call><name>saw_link_from_url</name><url>URL</url></tool_call>',
    parameters: {
      url: 'Webpage URL.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Opens URL in system browser. Use for user links.',
    usage: '<tool_call><name>open_browser_link</name><url>URL</url></tool_call>',
    parameters: {
      url: 'URL (e.g., https://...).'
    }
  }
]
