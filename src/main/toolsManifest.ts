export interface ToolParameterSchema {
  type: string
  description?: string
  items?: any
  properties?: Record<string, any>
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  usage: string
  parameters: Record<string, string | ToolParameterSchema>
  target?: 'main' | 'both' | 'launcher'
}

export const toolsManifest: ToolDefinition[] = [
  {
    name: 'execute_terminal_command',
    description: 'Run shell command in user terminal.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"execute_terminal_command","command":"CMD"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      command: 'Shell command using the configured terminal syntax.'
    }
  },
  {
    name: 'computer_use_create_file',
    description: 'Create file with content.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_create_file","path":"PATH","content":"TXT"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      content: 'Initial text.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Create directory.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_create_directory","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Delete file.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_remove_file","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Delete directory.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_remove_directory","path":"PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Save file content.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_save_file","path":"PATH","content":"TXT"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      content: 'Full file content.'
    }
  },
  {
    name: 'computer_use_append_file',
    description: 'Append text to file.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_append_file","path":"PATH","content":"TXT"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      content: 'Text to append.'
    }
  },
  {
    name: 'computer_use_edit_file',
    description: 'Edit line range in file.',
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
    description: 'Move or rename file/dir.',
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
    description: 'Get file or directory metadata.',
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
      '[PRISM_EXECUTE_TOOL]{"type":"computer_use_read_file","path":"PATH","startLine":130,"limit":50}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      path: 'Absolute file path.',
      startLine: 'Starting line number (1-based index) to read from.',
      limit:
        'Optional: Number of lines to read starting from startLine (defaults to 200, maximum 500).'
    }
  },
  {
    name: 'search_installed_applications',
    description: 'Search installed applications.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"search_installed_applications","query":"fl"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Search term to match app names (e.g. "fl", "steam", "chrome")'
    }
  },
  {
    name: 'open_application',
    description: 'Open application from path.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"open_application","appPath":"EXE_PATH"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      appPath: 'Path to .exe.'
    }
  },
  {
    name: 'web_search',
    description: 'Search Google for live information.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"web_search","searches":[{"title":"Finding common errors with X","query":"X not working windows"},{"title":"Searching on how to update X","query":"how to update X"}]}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      searches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'A concise human-friendly action phrase shown to the user' },
            query: { type: 'string', description: 'The actual keywords sent to Google' }
          },
          required: ['title', 'query']
        },
        description:
          'Array of search objects. Each object must have "title" (a concise human-friendly action phrase shown to the user, e.g. "Finding common errors with...", never raw query syntax) and "query" (the actual keywords sent to Google). Use multiple entries when the task benefits from exploring several angles; one entry is valid for focused lookups.'
      }
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Read text content from URL.',
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
    description: 'Shared live browser session (AI & user). User can interact simultaneously.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"open_browser","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Optional: Initial URL to open.'
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate browser to URL. You will be called back when download is finished.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_navigate","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Target URL to load.'
    }
  },
  {
    name: 'browser_use_switch_url',
    description: 'Switch the active browser session URL to a new target page. Only works if an active browser session exists.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_use_switch_url","url":"URL"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Target URL to switch to.'
    }
  },
  {
    name: 'browser_snapshot',
    description: 'Get semantic DOM snapshot.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_snapshot","full":"false"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      full: 'Optional: "true"|"false" (default "false").'
    }
  },
  {
    name: 'browser_click',
    description: 'Click element on page by ID. You will be called back when download is finished.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_click","elementId":"1"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      elementId: 'The reference ID from the snapshot.'
    }
  },
  {
    name: 'browser_type',
    description: 'Type text into element by ID. You will be called back when download is finished.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_type","elementId":"2","text":"hello"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      elementId: 'The reference ID from the snapshot.',
      text: 'Text to input.'
    }
  },
  {
    name: 'browser_press',
    description: 'Press key on active page.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_press","key":"Enter"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      key: 'The key name to press.'
    }
  },
  {
    name: 'browser_scroll',
    description: 'Scroll active page view.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_scroll","direction":"down","amount":"300"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      direction: '"up"|"down".',
      amount: 'Optional: pixels to scroll.'
    }
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_back"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'browser_screenshot',
    description: 'Take browser screenshot.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"browser_screenshot"}[/PRISM_EXECUTE_TOOL]',
    parameters: {}
  },
  {
    name: 'web_script',
    description: 'Execute JavaScript on page. You will be called back when download is finished.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"web_script","url":"URL","script":"return document.title;"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      url: 'Optional: URL to load.',
      script: 'JavaScript code to execute.'
    }
  },
  {
    name: 'detailed_dom_page',
    description: 'Get detailed HTML DOM tree.',
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
    description: 'Open main application window.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"open_main_app","instructions":"TXT","model":"MODEL_KEY"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      instructions: 'Target instructions.',
      model: 'Model key (super-fast|fast|dragon|dense).',
      searchEnabled: 'Optional: "true"|"false".'
    },
    target: 'launcher'
  },
  {
    name: 'computer_use_see_screen',
    description: 'Take screenshot of screen/app.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"computer_use_see_screen","appName":"Name"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      appName: 'App window name or "Entire Screen".'
    }
  },
  {
    name: 'configure_prism',
    description: 'Change application settings.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"configure_prism","username":"Alice"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      launcherShortcut: 'Optional: Launcher hotkey.',
      modelSelectionShortcut: 'Optional: Model picker hotkey.',
      screenshotShortcut: 'Optional: Screenshot hotkey.',
      newChatShortcut: 'Optional: Start new chat hotkey.',
      dictationShortcut: 'Optional: Voice dictation toggle hotkey.',
      webSearchShortcut: 'Optional: Toggle search mode hotkey.',
      youtubeModeShortcut: 'Optional: Toggle YouTube mode hotkey.',
      lastSelectedChatModel: 'Optional: Main chat model key.',
      defaultModel: 'Optional: Main chat model key (alias for lastSelectedChatModel).',
      searchModel: 'Optional: Web search model key.',
      quickLauncherModel: 'Optional: Quick launcher model key.',
      sttModel: 'Optional: Dictation/STT model key.',
      minimizeToTray: 'Optional: "true"|"false".',
      autoLaunch: 'Optional: "true"|"false".',
      quickLauncherMode: 'Optional: simple|advanced.',
      username: 'Optional: User name.',
      ttsVoice: 'Optional: Aoede|Puck|Charon|Kore|Fenrir.',
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
    description: 'Render UI questionnaire.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"to_ask","session_id":"UUID","questions":[]}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      session_id: 'Unique UUID.',
      questions: {
        type: 'array',
        items: { type: 'object' },
        description: 'JSON array of question objects (id, type, title, prompt).'
      }
    }
  },
  {
    name: 'render_chat_history',
    description: 'Show chat session in UI.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"render_chat_history","query":"chat_ID.json"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Filename or session ID.'
    }
  },
  {
    name: 'search_chat_memory',
    description: 'Search chat memory.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"search_chat_memory","query":"K1"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      query: 'Keywords.'
    }
  },
  {
    name: 'not_found_chat_history',
    description: 'Trigger when chat history not found.',
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
  },
  {
    name: 'create_todo',
    description: 'Create todo list.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"create_todo","tasks":["Research API documentation","Implement GET endpoint","Test the route"]}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Array of strings with 2 to 30 tasks. Each task must be a concise and actionable description of a step.'
      }
    },
    target: 'main'
  },
  {
    name: 'edit_todo',
    description: 'Update task status.',
    usage:
      '[PRISM_EXECUTE_TOOL]{"type":"edit_todo","id":"task-1","status":"working"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      id: 'The ID of the task to be updated (e.g.: "task-0", "task-1").',
      status: 'New status: "working" (started the task) or "done" (completed the task).'
    },
    target: 'main'
  },
  {
    name: 'create_mini_app',
    description: 'Create an interactive, stateful web-based widget/game/application (Mini-App). This tool MUST be called natively when the user asks for a mini-app, interactive widget, dashboard, calculator, game, or custom visual application.',
    usage: '[PRISM_EXECUTE_TOOL]{"type":"create_mini_app","title":"Name","html":"HTML","css":"CSS","js":"JS"}[/PRISM_EXECUTE_TOOL]',
    parameters: {
      title: 'Title of the mini-app.',
      html: 'HTML structure. Clean HTML only (no script/style tags, as they are separate parameters). Use semantic HTML, inputs, buttons, and custom IDs for interactive elements.',
      css: 'CSS styling for the mini-app. Use modern, premium, and beautiful CSS. Avoid basic layouts. Include transitions, responsive structure, and custom variables matching the design.',
      js: 'JavaScript logic for interactivity. Must query DOM elements by their IDs or classes, handle events, and maintain state. No external CDN imports unless required.'
    },
    target: 'main'
  }
]

