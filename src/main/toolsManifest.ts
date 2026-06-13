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
    description: 'Spawn sub-agents for parallel tasks. Ideal for complex multi-step requests.',
    usage: '<tool_call>{"type":"run_subagents","quantity":"X","prompt:1":"P1"}</tool_call>',
    parameters: {
      quantity: 'Number of agents.',
      'prompt:1': 'Prompt for agent 1.',
      'prompt:2': 'Prompt for agent 2 (repeat up to X).'
    },
    target: 'main'
  },
  {
    name: 'send_group_message',
    description: 'Send group chat message. Use with wait_for_updates if awaiting reply.',
    usage:
      '<tool_call>{"type":"send_group_message","content":"TXT","status":"working|done|error"}</tool_call>',
    parameters: {
      content: 'Message text.',
      status: '"working" to stay active (requires wait_for_updates), "done" or "error" to exit.'
    },
    target: 'subagent'
  },
  {
    name: 'read_group_messages',
    description: 'Fetch group chat history.',
    usage:
      '<tool_call>{"type":"read_group_messages","sinceTimestamp":"TS","limit":"N"}</tool_call>',
    parameters: {
      sinceTimestamp: 'Optional: Filter by timestamp.',
      limit: 'Optional: Max messages.'
    },
    target: 'subagent'
  },
  {
    name: 'wait_for_updates',
    description: 'Pause and wait for new group messages.',
    usage: '<tool_call>{"type":"wait_for_updates","timeoutSeconds":"SEC"}</tool_call>',
    parameters: {
      timeoutSeconds: 'Max wait time (max 180s).'
    },
    target: 'subagent'
  },
  {
    name: 'execute_terminal_command',
    description: 'Run a guarded shell command in the user-selected system terminal.',
    usage: '<tool_call>{"type":"execute_terminal_command","command":"CMD"}</tool_call>',
    parameters: {
      command: 'Shell command using the configured terminal syntax.'
    }
  },
  {
    name: 'computer_use_create_file',
    description: 'Create new file with content. Fails if exists.',
    usage:
      '<tool_call>{"type":"computer_use_create_file","path":"PATH","content":"TXT"}</tool_call>',
    parameters: {
      path: 'Absolute file path.',
      content: 'Initial text.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Create directory recursively.',
    usage: '<tool_call>{"type":"computer_use_create_directory","path":"PATH"}</tool_call>',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Delete a file.',
    usage: '<tool_call>{"type":"computer_use_remove_file","path":"PATH"}</tool_call>',
    parameters: {
      path: 'Absolute file path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Delete directory recursively.',
    usage: '<tool_call>{"type":"computer_use_remove_directory","path":"PATH"}</tool_call>',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Overwrite or create file with content.',
    usage: '<tool_call>{"type":"computer_use_save_file","path":"PATH","content":"TXT"}</tool_call>',
    parameters: {
      path: 'Absolute file path.',
      content: 'Full file content.'
    }
  },
  {
    name: 'computer_use_append_file',
    description: 'Append text to a file.',
    usage:
      '<tool_call>{"type":"computer_use_append_file","path":"PATH","content":"TXT"}</tool_call>',
    parameters: {
      path: 'Absolute file path.',
      content: 'Text to append.'
    }
  },
  {
    name: 'computer_use_edit_file',
    description: 'Edit line range in a file.',
    usage:
      '<tool_call>{"type":"computer_use_edit_file","path":"PATH","startLine":1,"endLine":5,"newContent":"TXT"}</tool_call>',
    parameters: {
      path: 'Absolute file path.',
      startLine: 'Start line (1-based).',
      endLine: 'End line (inclusive).',
      newContent: 'New text.'
    }
  },
  {
    name: 'computer_use_copy_file',
    description: 'Copy file or directory.',
    usage:
      '<tool_call>{"type":"computer_use_copy_file","sourcePath":"S","destinationPath":"D","overwrite":"false"}</tool_call>',
    parameters: {
      sourcePath: 'Source path.',
      destinationPath: 'Destination path.',
      overwrite: 'true|false (default false).'
    }
  },
  {
    name: 'computer_use_move_file',
    description: 'Move or rename file/directory.',
    usage:
      '<tool_call>{"type":"computer_use_move_file","sourcePath":"S","destinationPath":"D","overwrite":"false"}</tool_call>',
    parameters: {
      sourcePath: 'Source path.',
      destinationPath: 'Destination path.',
      overwrite: 'true|false (default false).'
    }
  },
  {
    name: 'computer_use_get_file_info',
    description: 'Get file/dir metadata.',
    usage: '<tool_call>{"type":"computer_use_get_file_info","path":"PATH"}</tool_call>',
    parameters: {
      path: 'Absolute path.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'List directory contents.',
    usage: '<tool_call>{"type":"computer_use_list_directory","path":"PATH"}</tool_call>',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Read file content.',
    usage: '<tool_call>{"type":"computer_use_read_file","path":"PATH"}</tool_call>',
    parameters: {
      path: 'Absolute file path.'
    }
  },
  {
    name: 'list_installed_applications',
    description: 'List installed Windows apps and executables. Faster than shell commands.',
    usage: '<tool_call>{"type":"list_installed_applications"}</tool_call>',
    parameters: {}
  },
  {
    name: 'open_application',
    description: 'Open .exe via path. Preferred over shell commands.',
    usage: '<tool_call>{"type":"open_application","appPath":"EXE_PATH"}</tool_call>',
    parameters: {
      appPath: 'Path to .exe.'
    }
  },
  {
    name: 'web_search',
    description: 'Search Google for live information. Returns a list of organic titles, links, and snippets.',
    usage: '<tool_call>{"type":"web_search","query":"QRY"}</tool_call>',
    parameters: {
      query: 'Keywords to search.'
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Read full text content from a URL via a headless browser. It is best practice to always visit the actual page URLs returned by web_search to read full contents (especially for Wikis, documentation, personal/business info) rather than relying only on search snippets, and to read multiple URLs before formulating the final response.',
    usage: '<tool_call>{"type":"saw_link_from_url","url":"URL"}</tool_call>',
    parameters: {
      url: 'Target URL to read.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Open URL in system browser.',
    usage: '<tool_call>{"type":"open_browser_link","url":"URL"}</tool_call>',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'open_browser',
    description: 'Open a persistent browser session for automation tasks. Accepts an optional url to load immediately.',
    usage: '<tool_call>{"type":"open_browser","url":"URL"}</tool_call>',
    parameters: {
      url: 'Optional: Initial URL to open.'
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the persistent browser session to a specified URL.',
    usage: '<tool_call>{"type":"browser_navigate","url":"URL"}</tool_call>',
    parameters: {
      url: 'Target URL to load.'
    }
  },
  {
    name: 'browser_snapshot',
    description: 'Retrieve a structured semantic DOM snapshot of the current page. Interactive elements are tagged with data-prism-id attributes (e.g. data-prism-id="1"). Set full to "true" for all structural containers.',
    usage: '<tool_call>{"type":"browser_snapshot","full":"false"}</tool_call>',
    parameters: {
      full: 'Optional: "true"|"false" (default "false").'
    }
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page using its reference ID (data-prism-id). If the click initiates a file download, it will automatically download and save directly to the user\'s Downloads folder.',
    usage: '<tool_call>{"type":"browser_click","elementId":"1"}</tool_call>',
    parameters: {
      elementId: 'The reference ID from the snapshot.'
    }
  },
  {
    name: 'browser_type',
    description: 'Input text into a form or input element on the page using its reference ID (data-prism-id).',
    usage: '<tool_call>{"type":"browser_type","elementId":"2","text":"hello"}</tool_call>',
    parameters: {
      elementId: 'The reference ID from the snapshot.',
      text: 'Text to input.'
    }
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key (e.g., Enter, Tab, Escape, Backspace) on the active page.',
    usage: '<tool_call>{"type":"browser_press","key":"Enter"}</tool_call>',
    parameters: {
      key: 'The key name to press.'
    }
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the active page view.',
    usage: '<tool_call>{"type":"browser_scroll","direction":"down","amount":"300"}</tool_call>',
    parameters: {
      direction: '"up"|"down".',
      amount: 'Optional: pixels to scroll.'
    }
  },
  {
    name: 'browser_back',
    description: 'Go back one page in history for the persistent browser session.',
    usage: '<tool_call>{"type":"browser_back"}</tool_call>',
    parameters: {}
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the active browser view and attach it to the current message context.',
    usage: '<tool_call>{"type":"browser_screenshot"}</tool_call>',
    parameters: {}
  },
  {
    name: 'browser_close',
    description: 'Close the persistent browser session. Use this once you are done with the browser tasks.',
    usage: '<tool_call>{"type":"browser_close"}</tool_call>',
    parameters: {}
  },
  {
    name: 'web_script',
    description: 'Execute a custom JavaScript script/expression on a web page and return the result. Can optionally load a URL first.',
    usage: '<tool_call>{"type":"web_script","url":"URL","script":"return document.title"}</tool_call>',
    parameters: {
      url: 'Optional: URL to load.',
      script: 'JavaScript code to execute.'
    }
  },
  {
    name: 'detailed_dom_page',
    description: 'Extract a highly detailed HTML DOM layout tree of a web page showing classes, IDs, placeholders, roles, and text. Can optionally load a URL first.',
    usage: '<tool_call>{"type":"detailed_dom_page","url":"URL"}</tool_call>',
    parameters: {
      url: 'Optional: URL to read DOM from.'
    }
  },
  {
    name: 'search_chat_history',
    description: 'Search past conversations by keywords.',
    usage: '<tool_call>{"type":"search_chat_history","query":"K1, K2"}</tool_call>',
    parameters: {
      query: 'Comma-separated keywords.'
    }
  },
  {
    name: 'open_main_app',
    description:
      'Open main window with instructions. Use for complex tasks, subagents, or Rich Markdown.',
    usage:
      '<tool_call>{"type":"open_main_app","instructions":"TXT","model":"prism-6-super-fast"}</tool_call>',
    parameters: {
      instructions: 'Target instructions.',
      model: 'Model key (super-fast|fast|dragon|dense).',
      thinkMode: 'Optional: "true"|"false".',
      searchEnabled: 'Optional: "true"|"false".',
      extendedSearch: 'Optional: "true"|"false".'
    },
    target: 'launcher'
  },
  {
    name: 'computer_use_see_screen',
    description: 'Screenshot specific app or "Entire Screen".',
    usage: '<tool_call>{"type":"computer_use_see_screen","appName":"Name"}</tool_call>',
    parameters: {
      appName: 'App window name or "Entire Screen".'
    }
  },
  {
    name: 'configure_prism',
    description: 'Change app settings (shortcuts, theme, etc).',
    usage: '<tool_call>{"type":"configure_prism","theme":"marine"}</tool_call>',
    parameters: {
      launcherShortcut: 'Optional: Launcher hotkey.',
      modelSelectionShortcut: 'Optional: Model picker hotkey.',
      screenshotShortcut: 'Optional: Screenshot hotkey.',
      defaultModel: 'Optional: Main model key.',
      subagentModel: 'Optional: Subagent model key.',
      minimizeToTray: 'Optional: "true"|"false".',
      autoLaunch: 'Optional: "true"|"false".',
      quickLauncherMode: 'Optional: simple|advanced.',
      userGeminiKey: 'Optional: API key.',
      username: 'Optional: User name.',
      ttsVoice: 'Optional: Aoede|Puck|Charon|Kore|Fenrir.',
      theme: 'Optional: marine|vertez|akoustik|terno|ursula.',
      terminalShell: 'Optional: Shell executable or path (e.g. powershell.exe, cmd.exe, pwsh.exe).',
      zoomFactor:
        'Optional: Interface zoom factor as a number between 0.5 and 3.0 (e.g., 1.0 for 100%, 1.25 for 125%).'
    }
  },
  {
    name: 'unlock_rgb_theme',
    description: 'Activate temporary RGB theme. No args.',
    usage: '<tool_call>{"type":"unlock_rgb_theme"}</tool_call>',
    parameters: {}
  },
  {
    name: 'to_ask',
    description: 'Render UI questionnaire. Blocks reasoning until submitted.',
    usage: '<tool_call>{"type":"to_ask","session_id":"UUID","questions":[]}</tool_call>',
    parameters: {
      session_id: 'Unique UUID.',
      questions: 'JSON array of question objects (id, type, title, prompt).'
    }
  },
  {
    name: 'render_chat_history',
    description: 'Show chat session item in UI.',
    usage: '<tool_call>{"type":"render_chat_history","query":"chat_ID.json"}</tool_call>',
    parameters: {
      query: 'Filename or session ID.'
    }
  },
  {
    name: 'search_chat_memory',
    description: 'Search history. Returns metadata (IDs, snippets).',
    usage: '<tool_call>{"type":"search_chat_memory","query":"K1"}</tool_call>',
    parameters: {
      query: 'Keywords.'
    }
  },
  {
    name: 'not_found_chat_history',
    description: 'Call this when no matching chat histories are found.',
    usage: '<tool_call>{"type":"not_found_chat_history"}</tool_call>',
    parameters: {}
  }
]
