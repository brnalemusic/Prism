export interface ToolDefinition {
  name: string
  description: string
  usage: string
  parameters: Record<string, string>
  target?: 'main' | 'subagent' | 'both'
}

export const toolsManifest: ToolDefinition[] = [
  {
    name: 'run_subagents',
    description: 'Spawns sub-agents to perform parallel tasks. Ideal for complex requests.',
    usage:
      '<tool_call><name>run_subagents</name><quantity>X</quantity><prompt:1>P1</prompt:1></tool_call>',
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
      '<tool_call><name>send_group_message</name><content>TEXT</content><status>working|done|error</status></tool_call>',
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
      '<tool_call><name>read_group_messages</name><sinceTimestamp>TS</sinceTimestamp><limit>N</limit></tool_call>',
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
      '<tool_call><name>wait_for_updates</name><timeoutSeconds>SEC</timeoutSeconds></tool_call>',
    parameters: {
      timeoutSeconds: 'Max time to wait (max 180s).'
    },
    target: 'subagent'
  },
  {
    name: 'execute_terminal_command',
    description: 'Executes a command in the terminal (cmd/powershell).',
    usage: '<tool_call><name>execute_terminal_command</name><command>CMD</command></tool_call>',
    parameters: {
      command: 'The shell command to run.'
    }
  },
  {
    name: 'computer_use_create_file',
    description:
      'Creates a new file with content. Auto-creates parent directories and fails if the file already exists.',
    usage:
      '<tool_call><name>computer_use_create_file</name><path>PATH</path><content>TXT</content></tool_call>',
    parameters: {
      path: 'Required complete file path.',
      content: 'Required initial text content.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Creates a new directory recursively.',
    usage: '<tool_call><name>computer_use_create_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Required complete directory path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Deletes a file from the system.',
    usage: '<tool_call><name>computer_use_remove_file</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Required complete file path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Recursively deletes an existing directory and its contents.',
    usage: '<tool_call><name>computer_use_remove_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Required complete directory path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Overwrites or saves a file with new content. Auto-creates parent directories.',
    usage:
      '<tool_call><name>computer_use_save_file</name><path>PATH</path><content>TXT</content></tool_call>',
    parameters: {
      path: 'Required complete file path.',
      content: 'Required complete file content to save.'
    }
  },
  {
    name: 'computer_use_append_file',
    description: 'Appends text to the end of a file. Auto-creates parent directories and the file.',
    usage:
      '<tool_call><name>computer_use_append_file</name><path>PATH</path><content>TXT</content></tool_call>',
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
      '<tool_call><name>computer_use_edit_file</name><path>PATH</path><oldText>OLD</oldText><newText>NEW</newText></tool_call>',
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
      '<tool_call><name>computer_use_replace_in_file</name><path>PATH</path><oldText>OLD</oldText><newText>NEW</newText></tool_call>',
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
      '<tool_call><name>computer_use_copy_file</name><sourcePath>SOURCE</sourcePath><destinationPath>DESTINATION</destinationPath><overwrite>false</overwrite></tool_call>',
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
      '<tool_call><name>computer_use_move_file</name><sourcePath>SOURCE</sourcePath><destinationPath>DESTINATION</destinationPath><overwrite>false</overwrite></tool_call>',
    parameters: {
      sourcePath: 'Required complete source path.',
      destinationPath: 'Required complete destination path.',
      overwrite: 'Optional true|false. Default false.'
    }
  },
  {
    name: 'computer_use_get_file_info',
    description: 'Returns metadata for a file or directory: type, size, timestamps, permissions.',
    usage: '<tool_call><name>computer_use_get_file_info</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Required complete file or directory path.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'Lists the contents of a directory.',
    usage: '<tool_call><name>computer_use_list_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Required complete directory path.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Reads the text content of a file.',
    usage: '<tool_call><name>computer_use_read_file</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'Required complete file path.'
    }
  },
  {
    name: 'list_installed_applications',
    description: 'Lists installed Windows applications.',
    usage: '<tool_call><name>list_installed_applications</name></tool_call>',
    parameters: {}
  },
  {
    name: 'open_application',
    description: 'Opens an application, file, or folder path.',
    usage: '<tool_call><name>open_application</name><appPath>PATH</appPath></tool_call>',
    parameters: {
      appPath: 'Path to target.'
    }
  },
  {
    name: 'web_search',
    description: 'Performs a web search for real-time information.',
    usage: '<tool_call><name>web_search</name><query>QRY</query></tool_call>',
    parameters: {
      query: 'Search keywords.'
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Fetches and reads text from a specific URL.',
    usage: '<tool_call><name>saw_link_from_url</name><url>URL</url></tool_call>',
    parameters: {
      url: 'Webpage URL.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Opens a URL in the default system browser.',
    usage: '<tool_call><name>open_browser_link</name><url>URL</url></tool_call>',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'search_chat_history',
    description:
      'Searches all past conversations for specific context or preferences. Use comma-separated keywords for better results.',
    usage: '<tool_call><name>search_chat_history</name><query>KEYWORDS</query></tool_call>',
    parameters: {
      query: 'Comma-separated keywords to search in history (e.g., "keyword1, keyword2").'
    }
  }
]
