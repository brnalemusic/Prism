export interface ToolDefinition {
  name: string
  description: string
  usage: string
  parameters: Record<string, string>
}

export const toolsManifest: ToolDefinition[] = [
  {
    name: 'execute_terminal_command',
    description: 'Executes a command in the terminal (cmd/powershell). Use for system info, running scripts, or complex CLI operations.',
    usage: '<tool_call><name>execute_terminal_command</name><command>YOUR COMMAND</command></tool_call>',
    parameters: {
      command: 'The shell command to execute.'
    }
  },
  {
    name: 'computer_use_create_file',
    description: 'Creates a new file with the specified content. Automatically creates parent directories if they do not exist.',
    usage: '<tool_call><name>computer_use_create_file</name><path>PATH</path><content>CONTENT</content></tool_call>',
    parameters: {
      path: 'The full or relative path to the file.',
      content: 'The text content to write to the file.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Creates a new directory at the specified path.',
    usage: '<tool_call><name>computer_use_create_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'The directory path to create.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Deletes a file from the system.',
    usage: '<tool_call><name>computer_use_remove_file</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'The path of the file to remove.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Recursively deletes a directory and all its contents.',
    usage: '<tool_call><name>computer_use_remove_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'The path of the directory to remove.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Saves content to a file, overwriting it if it already exists.',
    usage: '<tool_call><name>computer_use_save_file</name><path>PATH</path><content>CONTENT</content></tool_call>',
    parameters: {
      path: 'The path to the file.',
      content: 'The new content for the file.'
    }
  },
  {
    name: 'computer_use_replace_in_file',
    description: 'Replaces all occurrences of a specific string with a new string in a file.',
    usage: '<tool_call><name>computer_use_replace_in_file</name><path>PATH</path><oldText>OLD</oldText><newText>NEW</newText></tool_call>',
    parameters: {
      path: 'The path to the file.',
      oldText: 'The exact text to find.',
      newText: 'The text to replace it with.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'Lists all files and subdirectories within a folder.',
    usage: '<tool_call><name>computer_use_list_directory</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'The path of the directory to list.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Reads and returns the full text content of a file.',
    usage: '<tool_call><name>computer_use_read_file</name><path>PATH</path></tool_call>',
    parameters: {
      path: 'The path of the file to read.'
    }
  },
  {
    name: 'list_installed_applications',
    description: 'Retrieves a list of up to 50 installed applications on the system.',
    usage: '<tool_call><name>list_installed_applications</name></tool_call>',
    parameters: {}
  },
  {
    name: 'open_application',
    description: 'Opens an application, file, or folder using the system default handler.',
    usage: '<tool_call><name>open_application</name><appPath>PATH</appPath></tool_call>',
    parameters: {
      appPath: 'The path to the application, file, or folder.'
    }
  },
  {
    name: 'web_search',
    description: 'Performs a web search using DuckDuckGo to find real-time information.',
    usage: '<tool_call><name>web_search</name><query>QUERY</query></tool_call>',
    parameters: {
      query: 'The search term or question.'
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Exploring Page: Fetches and reads the text content of a webpage.',
    usage: '<tool_call><name>saw_link_from_url</name><url>URL</url></tool_call>',
    parameters: {
      url: 'The URL to fetch content from.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Opens a URL directly in the user\'s default system browser. Use this IMMEDIATELY when the user sends a link.',
    usage: '<tool_call><name>open_browser_link</name><url>URL</url></tool_call>',
    parameters: {
      url: 'The full URL to open (e.g., https://google.com).'
    }
  }
]
