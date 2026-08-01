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
    usage: '{"command":"CMD"}',
    parameters: {
      command: 'Shell command to execute.'
    }
  },
  {
    name: 'computer_use_create_file',
    description: 'Create file with content.',
    usage: '{"path":"PATH","content":"TXT"}',
    parameters: {
      path: 'Absolute file path.',
      content: 'File content.'
    }
  },
  {
    name: 'computer_use_create_directory',
    description: 'Create directory.',
    usage: '{"path":"PATH"}',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_remove_file',
    description: 'Delete file.',
    usage: '{"path":"PATH"}',
    parameters: {
      path: 'Absolute file path.'
    }
  },
  {
    name: 'computer_use_remove_directory',
    description: 'Delete directory.',
    usage: '{"path":"PATH"}',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_save_file',
    description: 'Save file content.',
    usage: '{"path":"PATH","content":"TXT"}',
    parameters: {
      path: 'Absolute file path.',
      content: 'Full file content.'
    }
  },
  {
    name: 'computer_use_append_file',
    description: 'Append text to file.',
    usage: '{"path":"PATH","content":"TXT"}',
    parameters: {
      path: 'Absolute file path.',
      content: 'Text to append.'
    }
  },
  {
    name: 'computer_use_edit_file',
    description: 'Edit line range in file.',
    usage: '{"path":"PATH","startLine":1,"endLine":5,"newContent":"TXT"}',
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
    usage: '{"sourcePath":"S","destinationPath":"D","overwrite":"false"}',
    parameters: {
      sourcePath: 'Source path.',
      destinationPath: 'Destination path.',
      overwrite: 'true|false'
    }
  },
  {
    name: 'computer_use_move_file',
    description: 'Move or rename file/directory.',
    usage: '{"sourcePath":"S","destinationPath":"D","overwrite":"false"}',
    parameters: {
      sourcePath: 'Source path.',
      destinationPath: 'Destination path.',
      overwrite: 'true|false'
    }
  },
  {
    name: 'computer_use_get_file_info',
    description: 'Get file or directory metadata.',
    usage: '{"path":"PATH"}',
    parameters: {
      path: 'Absolute path.'
    }
  },
  {
    name: 'computer_use_list_directory',
    description: 'List directory contents.',
    usage: '{"path":"PATH"}',
    parameters: {
      path: 'Absolute directory path.'
    }
  },
  {
    name: 'computer_use_read_file',
    description: 'Read file content.',
    usage: '{"path":"PATH","startLine":1,"limit":50}',
    parameters: {
      path: 'Absolute file path.',
      startLine: '1-based start line.',
      limit: 'Line count (default 200, max 500).'
    }
  },
  {
    name: 'search_installed_applications',
    description: 'Search installed applications.',
    usage: '{"query":"app"}',
    parameters: {
      query: 'App search term.'
    }
  },
  {
    name: 'open_application',
    description: 'Open application from path.',
    usage: '{"appPath":"PATH"}',
    parameters: {
      appPath: 'Path to .exe.'
    }
  },
  {
    name: 'web_search',
    description: 'Search Google for live information.',
    usage: '{"searches":[{"title":"Action","query":"keywords"}]}',
    parameters: {
      searches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Concise UI action title.' },
            query: { type: 'string', description: 'Google search keywords.' }
          },
          required: ['title', 'query']
        },
        description: 'Search query objects with title and query.'
      }
    }
  },
  {
    name: 'saw_link_from_url',
    description: 'Read text content from URL.',
    usage: '{"url":"URL"}',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'open_browser_link',
    description: 'Open URL in system browser.',
    usage: '{"url":"URL"}',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'open_browser',
    description: 'Open/attach live browser session. Do not re-open if active; call browser_snapshot.',
    usage: '{"url":"URL"}',
    parameters: {
      url: 'Initial URL.'
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate browser to URL.',
    usage: '{"url":"URL"}',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'browser_snapshot',
    description: 'Get semantic DOM snapshot.',
    usage: '{"full":"false"}',
    parameters: {
      full: '"true"|"false"'
    }
  },
  {
    name: 'browser_click',
    description: 'Click element on page by ID.',
    usage: '{"elementId":"1"}',
    parameters: {
      elementId: 'Element ID from snapshot.'
    }
  },
  {
    name: 'browser_type',
    description: 'Type text into element by ID.',
    usage: '{"elementId":"1","text":"txt"}',
    parameters: {
      elementId: 'Element ID from snapshot.',
      text: 'Text to type.'
    }
  },
  {
    name: 'browser_press',
    description: 'Press key on active page.',
    usage: '{"key":"Enter"}',
    parameters: {
      key: 'Key name.'
    }
  },
  {
    name: 'browser_scroll',
    description: 'Scroll active page view.',
    usage: '{"direction":"down","amount":"300"}',
    parameters: {
      direction: '"up"|"down"',
      amount: 'Pixels to scroll.'
    }
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history.',
    usage: '{}',
    parameters: {}
  },
  {
    name: 'browser_screenshot',
    description: 'Take browser screenshot.',
    usage: '{}',
    parameters: {}
  },
  {
    name: 'web_script',
    description: 'Execute JavaScript on page.',
    usage: '{"script":"code"}',
    parameters: {
      url: 'Target URL.',
      script: 'JavaScript code.'
    }
  },
  {
    name: 'detailed_dom_page',
    description: 'Get detailed HTML DOM tree.',
    usage: '{"url":"URL"}',
    parameters: {
      url: 'Target URL.'
    }
  },
  {
    name: 'search_chat_history',
    description: 'Search past conversations by keywords.',
    usage: '{"query":"keywords"}',
    parameters: {
      query: 'Search keywords.'
    }
  },
  {
    name: 'open_main_app',
    description: 'Open main application window.',
    usage: '{"instructions":"TXT","model":"KEY"}',
    parameters: {
      instructions: 'Target instructions.',
      model: 'Model key.',
      searchEnabled: '"true"|"false"'
    },
    target: 'launcher'
  },
  {
    name: 'computer_use_see_screen',
    description: 'Take screenshot of screen/app.',
    usage: '{"appName":"Name"}',
    parameters: {
      appName: 'Window name or "Entire Screen".'
    }
  },
  {
    name: 'configure_prism',
    description: 'Change application settings.',
    usage: '{"username":"Name"}',
    parameters: {
      launcherShortcut: 'Launcher hotkey.',
      modelSelectionShortcut: 'Model picker hotkey.',
      screenshotShortcut: 'Screenshot hotkey.',
      newChatShortcut: 'Start new chat hotkey.',
      dictationShortcut: 'Voice dictation hotkey.',
      webSearchShortcut: 'Search mode hotkey.',
      youtubeModeShortcut: 'YouTube mode hotkey.',
      lastSelectedChatModel: 'Main chat model key.',
      defaultModel: 'Main chat model key alias.',
      searchModel: 'Web search model key.',
      quickLauncherModel: 'Quick launcher model key.',
      sttModel: 'Dictation model key.',
      minimizeToTray: '"true"|"false"',
      autoLaunch: '"true"|"false"',
      quickLauncherMode: 'simple|advanced',
      username: 'User name.',
      ttsVoice: 'Aoede|Puck|Charon|Kore|Fenrir',
      terminalShell: 'Shell executable or path.',
      zoomFactor: 'Zoom factor (0.5 - 3.0).'
    }
  },
  {
    name: 'internal_docs_list',
    description: 'List Prism internal documentation files.',
    usage: '{}',
    parameters: {}
  },
  {
    name: 'internal_docs_read',
    description: 'Read internal documentation file.',
    usage: '{"filename":"doc.md"}',
    parameters: {
      filename: 'Doc filename.'
    }
  },
  {
    name: 'internal_docs_search',
    description: 'Search across internal documentation.',
    usage: '{"query":"keywords"}',
    parameters: {
      query: 'Search query.'
    }
  },
  {
    name: 'to_ask',
    description: 'Render UI questionnaire.',
    usage: '{"session_id":"UUID","questions":[]}',
    parameters: {
      session_id: 'Unique UUID.',
      questions: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of question objects (id, type, title, prompt).'
      }
    }
  },
  {
    name: 'render_chat_history',
    description: 'Show chat session in UI.',
    usage: '{"query":"ID"}',
    parameters: {
      query: 'Session ID or filename.'
    }
  },
  {
    name: 'search_chat_memory',
    description: 'Search chat memory.',
    usage: '{"query":"keywords"}',
    parameters: {
      query: 'Keywords.'
    }
  },
  {
    name: 'not_found_chat_history',
    description: 'Trigger when chat history not found.',
    usage: '{}',
    parameters: {}
  },
  {
    name: 'list_workflows',
    description: 'Get configured custom workflows.',
    usage: '{}',
    parameters: {},
    target: 'main'
  },
  {
    name: 'save_workflow',
    description: 'Create or update custom workflow.',
    usage: '{"command":"/cmd","name":"Name","systemInstruction":"Prompt"}',
    parameters: {
      command: 'Slash command starting with "/".',
      name: 'Workflow name.',
      systemInstruction: 'System prompt instructions.',
      description: 'Brief description.',
      id: 'Workflow ID.',
      toolConstraints: 'Comma-separated allowed tool names.'
    },
    target: 'main'
  },
  {
    name: 'delete_workflow',
    description: 'Delete custom workflow by command or ID.',
    usage: '{"command":"/cmd"}',
    parameters: {
      command: 'Slash command to delete.',
      id: 'Workflow ID to delete.'
    },
    target: 'main'
  },
  {
    name: 'create_todo',
    description: 'Create todo list.',
    usage: '{"tasks":["Task 1","Task 2"]}',
    parameters: {
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Actionable task strings (2-30).'
      }
    },
    target: 'main'
  },
  {
    name: 'edit_todo',
    description: 'Update task status.',
    usage: '{"id":"task-0","status":"done"}',
    parameters: {
      id: 'Task ID (e.g. task-0).',
      status: '"working"|"done"'
    },
    target: 'main'
  },
  {
    name: 'create_mini_app',
    description: 'Create interactive web widget/game/app (Mini-App).',
    usage: '{"title":"Name","html":"HTML","css":"CSS","js":"JS"}',
    parameters: {
      title: 'Mini-app title.',
      html: 'Clean HTML structure (no script/style tags).',
      css: 'Modern responsive CSS styling.',
      js: 'Interactive JS logic operating on element IDs.'
    },
    target: 'main'
  },
  {
    name: 'write_pdf',
    description: 'Generate PDF artifact from A4 HTML/CSS. PDF rules: @page A4 15mm margins, cover page 297mm + page-break-after, single-page TOC (no item page breaks), break-inside:avoid on cards/tables, curated fonts/colors.',
    usage: '{"filename":"doc.pdf","html":"HTML"}',
    parameters: {
      filename: 'PDF filename.',
      html: 'A4 HTML/CSS with cover, single-page TOC, break-inside:avoid on cards, and clean typography.'
    },
    target: 'main'
  },
  {
    name: 'edit_pdf',
    description: 'Edit existing PDF artifact from updated A4 HTML/CSS (cover 297mm, break-inside:avoid, single-page TOC).',
    usage: '{"id":"123456","html":"HTML"}',
    parameters: {
      id: '6-digit PDF artifact ID.',
      path: 'Full file path to edit.',
      html: 'Updated A4 HTML and CSS content.'
    },
    target: 'main'
  },
  {
    name: 'write_pptx',
    description: 'Generate 16:9 PowerPoint presentation artifact from HTML/CSS. Each slide MUST be <div class="slide"> (1920x1080px, padding 60px 80px, overflow hidden, page-break-after: always). Use grid cards & high visual impact.',
    usage: '{"filename":"pres.pptx","html":"HTML"}',
    parameters: {
      filename: 'PowerPoint filename.',
      html: '16:9 slide HTML and CSS layout content with <div class="slide"> wrappers.'
    },
    target: 'main'
  },
  {
    name: 'edit_pptx',
    description: 'Edit existing PowerPoint artifact from updated 16:9 slide HTML/CSS (<div class="slide"> 1920x1080px wrappers).',
    usage: '{"id":"123456","html":"HTML"}',
    parameters: {
      id: '6-digit PowerPoint artifact ID.',
      path: 'Full file path to edit.',
      html: 'Updated 16:9 slide HTML and CSS content.'
    },
    target: 'main'
  }
]

