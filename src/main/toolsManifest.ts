export interface ToolDefinition {
  name: string
  description: string
  usage: string
  parameters: Record<string, string>
  target?: 'main' | 'subagent' | 'both' | 'launcher'
}

export const toolsManifest: ToolDefinition[] = [
  {
    name: 'run_subagents',
    description: 'Spawns sub-agents to perform parallel tasks. Ideal for complex requests.',
    usage:
      '<tool_call>\n{\n  "type": "run_subagents",\n  "quantity": "X",\n  "prompt:1": "P1"\n}\n</tool_call>',
    parameters: {
      quantity: 'Number of agents to spawn.',
      'prompt:1': 'Detailed prompt for agent 1.',
      'prompt:2': 'Detailed prompt for agent 2 (repeat for X).'
    },
    target: 'main'
  },
  {
    name: 'send_group_message',
    description:
      'Sends a message to the group chat. If you want to wait for a response, you MUST also call wait_for_updates in the same response.',
    usage:
      '<tool_call>\n{\n  "type": "send_group_message",\n  "content": "TEXT",\n  "status": "working|done|error"\n}\n</tool_call>',
    parameters: {
      content: 'The message to broadcast.',
      status:
        'Use "working" to stay active (requires calling wait_for_updates too). Use "done" or "error" to finish and terminate.'
    },
    target: 'subagent'
  },
  {
    name: 'read_group_messages',
    description: 'Fetches past messages from the group chat history.',
    usage:
      '<tool_call>\n{\n  "type": "read_group_messages",\n  "sinceTimestamp": "TS",\n  "limit": "N"\n}\n</tool_call>',
    parameters: {
      sinceTimestamp: 'Optional: Only get messages after this timestamp.',
      limit: 'Optional: Max messages to return.'
    },
    target: 'subagent'
  },
  {
    name: 'wait_for_updates',
    description:
      'Pauses execution until a new message is received. Use this after sending a message to wait for a reply, otherwise you will terminate.',
    usage:
      '<tool_call>\n{\n  "type": "wait_for_updates",\n  "timeoutSeconds": "SEC"\n}\n</tool_call>',
    parameters: {
      timeoutSeconds: 'Max time to wait (max 180s).'
    },
    target: 'subagent'
  },
  {
    name: 'execute_terminal_command',
    description: 'Executes a command in the terminal (cmd/powershell).',
    usage:
      '<tool_call>\n{\n  "type": "execute_terminal_command",\n  "command": "CMD"\n}\n</tool_call>',
    parameters: {
      command: 'The shell command to run.'
    }
  },
  {
    name: 'computer_use_create_file',
    description:
      'Creates a new file with content. Auto-creates parent directories and fails if the file already exists.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_create_file",\n  "path": "PATH",\n  "content": "TXT"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.',
      content: 'Required initial text content.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Creates a new directory recursively.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_create_directory",\n  "path": "PATH"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete directory path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Deletes a file from the system.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_remove_file",\n  "path": "PATH"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Recursively deletes an existing directory and its contents.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_remove_directory",\n  "path": "PATH"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete directory path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Overwrites or saves a file with new content. Auto-creates parent directories.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_save_file",\n  "path": "PATH",\n  "content": "TXT"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.',
      content: 'Required complete file content to save.'
    }
  },
  {
    name: 'computer_use_append_file',
    description: 'Appends text to the end of a file. Auto-creates parent directories and the file.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_append_file",\n  "path": "PATH",\n  "content": "TXT"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.',
      content: 'Required text to append.'
    }
  },
  {
    name: 'computer_use_edit_file',
    description:
      'Edits a file by replacing exact oldText with newText. Use for targeted file changes.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_edit_file",\n  "path": "PATH",\n  "oldText": "OLD",\n  "newText": "NEW"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.',
      oldText: 'Required exact text currently in the file.',
      newText: 'Required replacement text.'
    }
  },
  {
    name: 'computer_use_replace_in_file',
    description: 'Backward-compatible alias for computer_use_edit_file.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_replace_in_file",\n  "path": "PATH",\n  "oldText": "OLD",\n  "newText": "NEW"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.',
      oldText: 'Required exact text currently in the file.',
      newText: 'Required replacement text.'
    }
  },
  {
    name: 'computer_use_copy_file',
    description: 'Copies a file or directory to a destination path.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_copy_file",\n  "sourcePath": "SOURCE",\n  "destinationPath": "DESTINATION",\n  "overwrite": "false"\n}\n</tool_call>',
    parameters: {
      sourcePath: 'Required complete source path.',
      destinationPath: 'Required complete destination path.',
      overwrite: 'Optional true|false. Default false.'
    }
  },
  {
    name: 'computer_use_move_file',
    description: 'Moves or renames a file or directory to a destination path.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_move_file",\n  "sourcePath": "SOURCE",\n  "destinationPath": "DESTINATION",\n  "overwrite": "false"\n}\n</tool_call>',
    parameters: {
      sourcePath: 'Required complete source path.',
      destinationPath: 'Required complete destination path.',
      overwrite: 'Optional true|false. Default false.'
    }
  },
  {
    name: 'computer_use_get_file_info',
    description: 'Returns metadata for a file or directory: type, size, timestamps, permissions.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_get_file_info",\n  "path": "PATH"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file or directory path.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'Lists the contents of a directory.',
    usage:
      '<tool_call>\n{\n  "type": "computer_use_list_directory",\n  "path": "PATH"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete directory path.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Reads the text content of a file.',
    usage: '<tool_call>\n{\n  "type": "computer_use_read_file",\n  "path": "PATH"\n}\n</tool_call>',
    parameters: {
      path: 'Required complete file path.'
    }
  },
  {
    name: 'list_installed_applications',
    description: 'Lists installed Windows applications.',
    usage: '<tool_call>\n{\n  "type": "list_installed_applications"\n}\n</tool_call>',
    parameters: {}
  },
  {
    name: 'open_application',
    description:
      'Opens an application using its literal executable path (must end with .exe). You must ALWAYS use this tool to open applications rather than using terminal/command line tools, unless opening the app via this tool is impossible.',
    usage:
      '<tool_call>\n{\n  "type": "open_application",\n  "appPath": "PATH_TO_EXE"\n}\n</tool_call>',
    parameters: {
      appPath: 'Literal path to the executable file (must end in .exe).'
    }
  },
  {
    name: 'web_search',
    description: 'Performs a web search for real-time information.',
    usage: '<tool_call>\n{\n  "type": "web_search",\n  "query": "QRY"\n}\n</tool_call>',
    parameters: {
      query: 'Search keywords.'
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Fetches and reads text from a specific URL.',
    usage: '<tool_call>\n{\n  "type": "saw_link_from_url",\n  "url": "URL"\n}\n</tool_call>',
    parameters: {
      url: 'Webpage URL.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Opens a URL in the default system browser.',
    usage: '<tool_call>\n{\n  "type": "open_browser_link",\n  "url": "URL"\n}\n</tool_call>',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'search_chat_history',
    description:
      'Searches all past conversations for specific context or preferences. Use comma-separated keywords for better results.',
    usage:
      '<tool_call>\n{\n  "type": "search_chat_history",\n  "query": "KEYWORDS"\n}\n</tool_call>',
    parameters: {
      query: 'Comma-separated keywords to search in history (e.g., "keyword1, keyword2").'
    }
  },
  {
    name: 'open_main_app',
    description: 'Opens the main application window, starts a new clean chat session, and sends instructions to be executed using a specific Prism model. Use this tool if you need terminal execution, filesystem access, subagents, or if you need to generate Rich Markdown dashboards, profile cards, etc.',
    usage: '<tool_call>\n{\n  "type": "open_main_app",\n  "instructions": "Task descriptions",\n  "model": "prism-5|prism-4.3|prism-4.2",\n  "thinkMode": "true|false",\n  "searchEnabled": "true|false",\n  "extendedSearch": "true|false"\n}\n</tool_call>',
    parameters: {
      instructions: 'The target instructions for the main assistant to execute.',
      model: 'The model key to use for the main chat session (e.g. prism-5, prism-4.3, prism-4.2).',
      thinkMode: 'Optional: Set to "true" to enable thinking mode in the main app.',
      searchEnabled: 'Optional: Set to "true" to enable web search in the main app.',
      extendedSearch: 'Optional: Set to "true" to enable deep research / extended web search in the main app.'
    },
    target: 'launcher'
  },
  {
    name: 'configure_prism',
    description: 'Configures the Prism application settings. Any combination of parameters can be specified to customize shortcuts, models, window behaviors, user personal details, and API keys.',
    usage: '<tool_call>\n{\n  "type": "configure_prism",\n  "launcherShortcut": "Shortcut",\n  "modelSelectionShortcut": "Shortcut",\n  "defaultModel": "prism-5|prism-4.3|prism-4.2|prism-4.1|prism-4",\n  "subagentModel": "prism-5|prism-4.3|prism-4.2|prism-4.1|prism-4",\n  "minimizeToTray": "true|false",\n  "autoLaunch": "true|false",\n  "quickLauncherMode": "simple|advanced",\n  "userGeminiKey": "API_KEY",\n  "username": "Name"\n}\n</tool_call>',
    parameters: {
      launcherShortcut: 'Optional: Global shortcut to open/close launcher (e.g., CommandOrControl+Space).',
      modelSelectionShortcut: 'Optional: Global shortcut to open/close model selection dialog.',
      defaultModel: 'Optional: Default main chat model (prism-5, prism-4.3, prism-4.2, prism-4.1, prism-4).',
      subagentModel: 'Optional: Default subagent model (prism-5, prism-4.3, prism-4.2, prism-4.1, prism-4).',
      minimizeToTray: 'Optional: Minimize window to system tray when closed (true/false).',
      autoLaunch: 'Optional: Start application automatically on system login (true/false).',
      quickLauncherMode: 'Optional: Quick launcher screen mode (simple/advanced).',
      userGeminiKey: 'Optional: Custom user Google Gemini API Key.',
      username: 'Optional: Custom username for personalization.'
    }
  }
]
