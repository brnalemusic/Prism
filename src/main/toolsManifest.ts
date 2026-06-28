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
    usage: '[PRISM_EXECUTE_TOOL]{"type":"run_subagents","quantity":"X","prompt:1":"P1"}[/PRISM_EXECUTE_TOOL]',
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
      '[PRISM_EXECUTE_TOOL]{"type":"send_group_message","content":"TXT","status":"working|done|error"}[/PRISM_EXECUTE_TOOL]',
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
      '[PRISM_EXECUTE_TOOL]{"type":"read_group_messages","sinceTimestamp":"TS","limit":"N"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      sinceTimestamp: 'Optional: Filter by timestamp.',
      limit: 'Optional: Max messages.'
    },
    target: 'subagent'
  },
  {
    name: 'wait_for_updates',
    description: 'Pause and wait for new group messages.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"wait_for_updates","timeoutSeconds":"SEC"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      timeoutSeconds: 'Max wait time (max 180s).'
    },
    target: 'subagent'
  },
  {
    name: 'execute_terminal_command',
    description: 'Run a guarded shell command in the user-selected system terminal.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"execute_terminal_command","command":"CMD"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      command: 'Shell command using the configured terminal syntax.'
    }
  },
  {
    name: 'computer_use_create_file',
    description: 'Create new file with content. Fails if exists.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_create_file","path":"PATH","content":"TXT"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      content: 'Initial text.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Create directory recursively.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_create_directory","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Delete a file.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_remove_file","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Delete directory recursively.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_remove_directory","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Overwrite or create file with content.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_save_file","path":"PATH","content":"TXT"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      content: 'Full file content.'
    }
  },
  {
    name: 'computer_use_append_file',
    description: 'Append text to a file.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_append_file","path":"PATH","content":"TXT"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      content: 'Text to append.'
    }
  },
  {
    name: 'computer_use_edit_file',
    description: 'Edit line range in a file.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_edit_file","path":"PATH","startLine":1,"endLine":5,"newContent":"TXT"}[/PRISM_EXECUTE_TOOL]',
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
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_copy_file","sourcePath":"S","destinationPath":"D","overwrite":"false"}[/PRISM_EXECUTE_TOOL]',
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
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_move_file","sourcePath":"S","destinationPath":"D","overwrite":"false"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      sourcePath: 'Source path.',
      destinationPath: 'Destination path.',
      overwrite: 'true|false (default false).'
    }
  },
  {
    name: 'computer_use_get_file_info',
    description: 'Get file/dir metadata.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_get_file_info","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute path.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'List directory contents.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_list_directory","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Read file content.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_read_file","path":"PATH","startLine":130,"offset":50}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      startLine: 'Starting line number (1-based index) to read from.',
      offset:
        'Optional: Number of lines to read starting from startLine (defaults to 200, maximum 200).'
    }
  },
  {
    name: 'search_installed_applications',
    description: 'Search installed apps by name. Returns matching executables. Use query like "fl", "steam", "chrome", etc.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"search_installed_applications","query":"fl"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Search term to match app names (e.g. "fl", "steam", "chrome")'
    }
  },
  {
    name: 'open_application',
    description: 'Open .exe via path. Preferred over shell commands.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"open_application","appPath":"EXE_PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      appPath: 'Path to .exe.'
    }
  },
  {
    name: 'web_search',
    description:
      'Search Google for live information. Batch multiple distinct angles into one call using the "searches" array. Each entry runs sequentially and the user sees each friendly title appear live in the UI. Returns aggregated organic titles, links, and snippets under per-search headers.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"web_search","searches":[{"title":"Finding common errors with X","query":"X not working windows"},{"title":"Searching on how to update X","query":"how to update X"}]}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      searches:
        'Array of search objects. Each object must have "title" (a concise human-friendly action phrase shown to the user, e.g. "Finding common errors with...", never raw query syntax) and "query" (the actual keywords sent to Google). Use multiple entries when the task benefits from exploring several angles; one entry is valid for focused lookups.'
    }
  },
  {
    name: 'saw_link_from_url',
    description:
      'Read full text content from a URL via a headless browser. It is best practice to always visit the actual page URLs returned by web_search to read full contents (especially for Wikis, documentation, personal/business info) rather than relying only on search snippets, and to read multiple URLs before formulating the final response.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"saw_link_from_url","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Target URL to read.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Open URL in system browser.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"open_browser_link","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'open_browser',
    description:
      'Open a persistent browser session for automation tasks. Accepts an optional url to load immediately.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"open_browser","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Optional: Initial URL to open.'
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the persistent browser session to a specified URL.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_navigate","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Target URL to load.'
    }
  },
  {
    name: 'browser_snapshot',
    description:
      'Retrieve a structured semantic DOM snapshot of the current page. Interactive elements are tagged with data-prism-id attributes (e.g. data-prism-id="1"). Set full to "true" for all structural containers.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_snapshot","full":"false"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      full: 'Optional: "true"|"false" (default "false").'
    }
  },
  {
    name: 'browser_click',
    description:
      "Click an element on the page using its reference ID (data-prism-id). If the click initiates a file download, it will automatically download and save directly to the user's Downloads folder.",
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_click","elementId":"1"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      elementId: 'The reference ID from the snapshot.'
    }
  },
  {
    name: 'browser_type',
    description:
      'Input text into a form or input element on the page using its reference ID (data-prism-id).',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_type","elementId":"2","text":"hello"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      elementId: 'The reference ID from the snapshot.',
      text: 'Text to input.'
    }
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key (e.g., Enter, Tab, Escape, Backspace) on the active page.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_press","key":"Enter"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      key: 'The key name to press.'
    }
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the active page view.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_scroll","direction":"down","amount":"300"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      direction: '"up"|"down".',
      amount: 'Optional: pixels to scroll.'
    }
  },
  {
    name: 'browser_back',
    description: 'Go back one page in history for the persistent browser session.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_back"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the active browser view and attach it to the current message context.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_screenshot"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'browser_close',
    description:
      'Close the persistent browser session. Use this once you are done with the browser tasks.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_close"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'web_script',
    description:
      'Execute a custom JavaScript script/expression on a web page and return the result. Can optionally load a URL first.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"web_script","url":"URL","script":"return document.title"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Optional: URL to load.',
      script: 'JavaScript code to execute.'
    }
  },
  {
    name: 'detailed_dom_page',
    description:
      'Extract a highly detailed HTML DOM layout tree of a web page showing classes, IDs, placeholders, roles, and text. Can optionally load a URL first.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"detailed_dom_page","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Optional: URL to read DOM from.'
    }
  },
  {
    name: 'search_chat_history',
    description: 'Search past conversations by keywords.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"search_chat_history","query":"K1, K2"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Comma-separated keywords.'
    }
  },
  {
    name: 'open_main_app',
    description:
      'Open main window with instructions. Use for complex tasks, subagents, or Rich Markdown.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"open_main_app","instructions":"TXT","model":"prism-6-super-fast"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      instructions: 'Target instructions.',
      model: 'Model key (super-fast|fast|dragon|dense).',
      searchEnabled: 'Optional: "true"|"false".'
    },
    target: 'launcher'
  },
  {
    name: 'computer_use_see_screen',
    description: 'Screenshot specific app or "Entire Screen".',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_see_screen","appName":"Name"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      appName: 'App window name or "Entire Screen".'
    }
  },
  {
    name: 'configure_prism',
    description: 'Change app settings (shortcuts, theme, etc).',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"configure_prism","theme":"marine"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      launcherShortcut: 'Optional: Launcher hotkey.',
      modelSelectionShortcut: 'Optional: Model picker hotkey.',
      screenshotShortcut: 'Optional: Screenshot hotkey.',
      newChatShortcut: 'Optional: Start new chat hotkey.',
      dictationShortcut: 'Optional: Voice dictation toggle hotkey.',
      webSearchShortcut: 'Optional: Toggle search mode hotkey.',
      youtubeModeShortcut: 'Optional: Toggle YouTube mode hotkey.',
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
    name: 'internal_docs_list',
    description: 'List all available internal documentation files about Prism.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"internal_docs_list"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'internal_docs_read',
    description: 'Read the contents of a specific internal documentation file.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"internal_docs_read","filename":"01_prism_creator.md"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      filename: 'The exact filename to read from the docs list.'
    }
  },
  {
    name: 'to_ask',
    description: 'Render UI questionnaire. Blocks reasoning until submitted.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"to_ask","session_id":"UUID","questions":[]}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      session_id: 'Unique UUID.',
      questions: 'JSON array of question objects (id, type, title, prompt).'
    }
  },
  {
    name: 'render_chat_history',
    description: 'Show chat session item in UI.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"render_chat_history","query":"chat_ID.json"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Filename or session ID.'
    }
  },
  {
    name: 'search_chat_memory',
    description: 'Search history. Returns metadata (IDs, snippets).',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"search_chat_memory","query":"K1"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Keywords.'
    }
  },
  {
    name: 'not_found_chat_history',
    description: 'Call this when no matching chat histories are found.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"not_found_chat_history"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'list_workflows',
    description: 'Get all configured custom slash command workflows in Prism.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"list_workflows"}[/PRISM_EXECUTE_TOOL]',
    parameters: {},
    target: 'main'
  },
  {
    name: 'save_workflow',
    description: 'Create a new workflow or update an existing one in Prism.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"save_workflow","command":"/code","name":"Coder","description":"Coding mode","systemInstruction":"Be a code assistant.","toolConstraints":"execute_terminal_command,computer_use_edit_file"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      command: 'Required: Slash command starting with "/" and containing no spaces.',
      name: 'Required: Name of the workflow.',
      systemInstruction: 'Required: Guidelines and instructions for this workflow.',
      description: 'Optional: Brief description.',
      id: 'Optional: Unique ID of workflow to edit. If omitted, will update existing matching command or create new.',
      toolConstraints:
        'Optional: Comma-separated list of allowed tool names, or empty/omitted to allow all tools.'
    },
    target: 'main'
  },
  {
    name: 'delete_workflow',
    description: 'Delete a custom workflow in Prism by command or ID.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"delete_workflow","command":"/code"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      command: 'Optional: The command of the workflow to delete (e.g., "/code"), or its unique ID.',
      id: 'Optional: Alternative to command: the unique ID of the workflow to delete.'
    },
    target: 'main'
  }
]

