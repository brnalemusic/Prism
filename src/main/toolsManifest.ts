export type JsonSchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean'

export interface JsonSchema {
  type: JsonSchemaType
  description?: string
  enum?: Array<string | number | boolean>
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  default?: unknown
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  additionalProperties?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
}

const stringSchema = (
  description: string,
  options: Pick<JsonSchema, 'enum' | 'default'> = {}
): JsonSchema => ({ type: 'string', description, ...options })

const booleanSchema = (description: string, defaultValue?: boolean): JsonSchema => ({
  type: 'boolean',
  description,
  ...(defaultValue === undefined ? {} : { default: defaultValue })
})

const integerSchema = (
  description: string,
  options: Pick<JsonSchema, 'default' | 'minimum' | 'maximum'> = {}
): JsonSchema => ({ type: 'integer', description, ...options })

const objectSchema = (
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

const tool = (
  name: string,
  description: string,
  properties: Record<string, JsonSchema> = {},
  required: string[] = []
): ToolDefinition => ({ name, description, inputSchema: objectSchema(properties, required) })

const pathArg = stringSchema('Absolute filesystem path.')
const contentArg = stringSchema('Complete UTF-8 text content. Preserve whitespace exactly.')

export const toolsManifest: ToolDefinition[] = [
  tool(
    'discord_leave_voice',
    'Leaves the current Discord voice channel. Use this when the user asks you to leave the call, hang up, or when the voice session is over.',
    {},
    []
  ),
  tool(
    'execute_terminal_command',
    'Run one command in the user-configured terminal shell.',
    { command: stringSchema('Exact shell command to execute.') },
    ['command']
  ),
  tool(
    'computer_use_create_file',
    'Create a new file. Fails if the file already exists.',
    { path: pathArg, content: contentArg },
    ['path', 'content']
  ),
  tool('computer_use_create_directory', 'Create a directory recursively.', { path: pathArg }, [
    'path'
  ]),
  tool('computer_use_remove_file', 'Delete one file.', { path: pathArg }, ['path']),
  tool('computer_use_remove_directory', 'Delete one directory recursively.', { path: pathArg }, [
    'path'
  ]),
  tool(
    'computer_use_save_file',
    'Create or overwrite a file with complete content.',
    { path: pathArg, content: contentArg },
    ['path', 'content']
  ),
  tool(
    'computer_use_append_file',
    'Append text to a file.',
    { path: pathArg, content: contentArg },
    ['path', 'content']
  ),
  tool(
    'computer_use_edit_file',
    'Replace an inclusive line range in a text file.',
    {
      path: pathArg,
      startLine: integerSchema('First line to replace, using one-based indexing.', { minimum: 1 }),
      endLine: integerSchema('Last line to replace, inclusive.', { minimum: 1 }),
      newContent: contentArg
    },
    ['path', 'startLine', 'endLine', 'newContent']
  ),
  tool(
    'computer_use_copy_file',
    'Copy a file or directory.',
    {
      sourcePath: stringSchema('Absolute source path.'),
      destinationPath: stringSchema('Absolute destination path.'),
      overwrite: booleanSchema('Whether an existing destination may be overwritten.', false)
    },
    ['sourcePath', 'destinationPath']
  ),
  tool(
    'computer_use_move_file',
    'Move or rename a file or directory.',
    {
      sourcePath: stringSchema('Absolute source path.'),
      destinationPath: stringSchema('Absolute destination path.'),
      overwrite: booleanSchema('Whether an existing destination may be overwritten.', false)
    },
    ['sourcePath', 'destinationPath']
  ),
  tool('computer_use_get_file_info', 'Read file or directory metadata.', { path: pathArg }, [
    'path'
  ]),
  tool(
    'computer_use_list_directory',
    'List the immediate contents of a directory.',
    { path: pathArg },
    ['path']
  ),
  tool(
    'computer_use_read_file',
    'Read a bounded line range from a UTF-8 text file.',
    {
      path: pathArg,
      startLine: integerSchema('First line to read, using one-based indexing.', {
        default: 1,
        minimum: 1
      }),
      limit: integerSchema('Maximum number of lines to return.', {
        default: 200,
        minimum: 1,
        maximum: 500
      })
    },
    ['path']
  ),
  tool(
    'search_installed_applications',
    'Search installed application shortcuts by name.',
    { query: stringSchema('Application search term.') },
    ['query']
  ),
  tool(
    'open_application',
    'Open an application from its executable path.',
    { appPath: stringSchema('Absolute executable path.') },
    ['appPath']
  ),
  tool(
    'web_search',
    'Search the web using one or more titled queries.',
    {
      searches: {
        type: 'array',
        description: 'Search requests to execute in order.',
        minItems: 1,
        maxItems: 10,
        items: objectSchema(
          {
            title: stringSchema('Concise action title shown in the UI.'),
            query: stringSchema('Search-engine query.')
          },
          ['title', 'query']
        )
      }
    },
    ['searches']
  ),
  tool(
    'saw_link_from_url',
    'Read the main text content of a web URL.',
    { url: stringSchema('HTTP or HTTPS URL.') },
    ['url']
  ),
  tool(
    'open_browser_link',
    'Open a URL in the system browser.',
    { url: stringSchema('HTTP or HTTPS URL.') },
    ['url']
  ),
  tool('open_browser', 'Open or attach the persistent Prism browser session.', {
    url: stringSchema('Optional initial HTTP or HTTPS URL.')
  }),
  tool(
    'browser_navigate',
    'Navigate the active Prism browser.',
    { url: stringSchema('HTTP or HTTPS URL.') },
    ['url']
  ),
  tool('browser_snapshot', 'Read a semantic snapshot of the active browser page.', {
    full: booleanSchema('Whether to return the full page snapshot.', false)
  }),
  tool(
    'browser_click',
    'Click an element in the active browser snapshot.',
    { elementId: stringSchema('Element ID from the latest snapshot.') },
    ['elementId']
  ),
  tool(
    'browser_type',
    'Type text into an element in the active browser.',
    {
      elementId: stringSchema('Element ID from the latest snapshot.'),
      text: stringSchema('Text to type.')
    },
    ['elementId', 'text']
  ),
  tool(
    'browser_press',
    'Press a keyboard key in the active browser.',
    { key: stringSchema('Playwright key name, such as Enter or Escape.') },
    ['key']
  ),
  tool(
    'browser_scroll',
    'Scroll the active browser page.',
    {
      direction: stringSchema('Scroll direction.', { enum: ['up', 'down'] }),
      amount: integerSchema('Optional number of pixels to scroll.', { minimum: 1 })
    },
    ['direction']
  ),
  tool('browser_back', 'Navigate back in the active browser history.'),
  tool('browser_screenshot', 'Capture a screenshot of the active browser page.'),
  tool(
    'web_script',
    'Execute JavaScript in the active browser page.',
    {
      script: stringSchema('JavaScript source to execute.'),
      url: stringSchema('Optional expected page URL.')
    },
    ['script']
  ),
  tool('detailed_dom_page', 'Read the detailed DOM of the active browser page.', {
    url: stringSchema('Optional expected page URL.')
  }),
  tool(
    'search_chat_history',
    'Search saved conversations by keywords.',
    { query: stringSchema('Keywords to search.') },
    ['query']
  ),
  tool(
    'open_main_app',
    'Open the main Prism window with instructions from Quick Launcher.',
    {
      instructions: stringSchema('Instructions to send to the main chat.'),
      model: stringSchema('Optional model key.'),
      searchEnabled: booleanSchema('Whether search mode should be enabled.', false)
    },
    ['instructions']
  ),
  tool('computer_use_see_screen', 'Capture a screenshot of a screen or application window.', {
    appName: stringSchema('Window name or "Entire Screen".', { default: 'Entire Screen' })
  }),
  tool('configure_prism', 'Change non-secret Prism settings. At least one property is required.', {
    launcherShortcut: stringSchema('Quick Launcher hotkey.'),
    modelSelectionShortcut: stringSchema('Model picker hotkey.'),
    screenshotShortcut: stringSchema('Screenshot hotkey.'),
    newChatShortcut: stringSchema('New chat hotkey.'),
    dictationShortcut: stringSchema('Voice dictation hotkey.'),
    webSearchShortcut: stringSchema('Search mode hotkey.'),
    youtubeModeShortcut: stringSchema('YouTube mode hotkey.'),
    lastSelectedChatModel: stringSchema('Main chat model key.'),
    defaultModel: stringSchema('Alias for the main chat model key.'),
    searchModel: stringSchema('Search model key.'),
    quickLauncherModel: stringSchema('Quick Launcher model key.'),
    sttModel: stringSchema('Speech-to-text model key.'),
    minimizeToTray: booleanSchema('Whether closing Prism minimizes it to the tray.'),
    autoLaunch: booleanSchema('Whether Prism starts with the operating system.'),
    quickLauncherMode: stringSchema('Quick Launcher mode.', { enum: ['simple', 'advanced'] }),
    theme: stringSchema('Application color theme.', {
      enum: [
        'marine',
        'vertez',
        'akoustik',
        'terno',
        'ursula',
        'rgb',
        'fire',
        'lava',
        'gold',
        'forest',
        'indigo',
        'violet',
        'white'
      ]
    }),
    username: stringSchema('Display name.'),
    ttsVoice: stringSchema('Text-to-speech voice.', {
      enum: ['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir']
    }),
    terminalShell: stringSchema('Shell executable or absolute path.'),
    zoomFactor: {
      type: 'number',
      description: 'Application zoom factor.',
      minimum: 0.5,
      maximum: 3
    }
  }),
  tool('internal_docs_list', 'List Prism internal documentation files.'),
  tool(
    'internal_docs_read',
    'Read one Prism internal documentation file.',
    { filename: stringSchema('Markdown filename returned by internal_docs_list.') },
    ['filename']
  ),
  tool(
    'internal_docs_search',
    'Search Prism internal documentation.',
    { query: stringSchema('Search query.') },
    ['query']
  ),
  tool(
    'to_ask',
    'Show a questionnaire and wait for the user response.',
    {
      session_id: stringSchema('Unique questionnaire session ID.'),
      questions: {
        type: 'array',
        minItems: 1,
        description: 'Question objects rendered by Prism.',
        items: objectSchema(
          {
            id: stringSchema('Unique question ID.'),
            type: stringSchema('Question type.', { enum: ['multiple-choice', 'essay'] }),
            title: stringSchema('Short category title.'),
            prompt: stringSchema('Question shown to the user.'),
            options: {
              type: 'array',
              description: 'Choices for a multiple-choice question.',
              minItems: 2,
              maxItems: 10,
              items: objectSchema(
                {
                  value: stringSchema('Stable choice value.'),
                  label: stringSchema('User-facing choice label.')
                },
                ['value', 'label']
              )
            }
          },
          ['id', 'type', 'title', 'prompt']
        )
      }
    },
    ['session_id', 'questions']
  ),
  tool(
    'render_chat_history',
    'Render a saved chat session in the UI.',
    { query: stringSchema('Chat session ID or filename.') },
    ['query']
  ),
  tool(
    'search_chat_memory',
    'Search conversation memory.',
    { query: stringSchema('Keywords to search.') },
    ['query']
  ),
  tool('not_found_chat_history', 'Tell the UI that no matching chat history was found.'),
  tool('list_workflows', 'List configured slash workflows.'),
  tool(
    'save_workflow',
    'Create or update a slash workflow.',
    {
      command: stringSchema('Slash command beginning with "/".'),
      name: stringSchema('Workflow name.'),
      systemInstruction: stringSchema('Workflow system instruction.'),
      description: stringSchema('Optional workflow description.'),
      id: stringSchema('Existing workflow ID when updating.'),
      toolConstraints: {
        type: 'array',
        description: 'Optional exact tool names allowed by the workflow.',
        items: stringSchema('Registered tool name.')
      }
    },
    ['command', 'name', 'systemInstruction']
  ),
  tool('delete_workflow', 'Delete a slash workflow by command or ID.', {
    command: stringSchema('Slash command to delete.'),
    id: stringSchema('Workflow ID to delete.')
  }),
  tool(
    'create_todo',
    'Create a task list for the current chat.',
    {
      tasks: {
        type: 'array',
        description: 'Actionable task titles.',
        minItems: 1,
        maxItems: 30,
        items: stringSchema('Task title.')
      }
    },
    ['tasks']
  ),
  tool(
    'edit_todo',
    'Update the status of one task.',
    {
      id: stringSchema('Task ID, such as task-0.'),
      status: stringSchema('New task status.', { enum: ['working', 'done'] })
    },
    ['id', 'status']
  ),
  tool(
    'create_mini_app',
    'Create an interactive Mini App.',
    {
      title: stringSchema('Mini App title.'),
      html: stringSchema('HTML structure without script or style tags.'),
      css: stringSchema('Responsive CSS.'),
      js: stringSchema('JavaScript interaction logic.')
    },
    ['title', 'html', 'css', 'js']
  ),
  tool(
    'write_pdf',
    'Generate a PDF artifact from HTML and CSS.',
    { filename: stringSchema('PDF filename.'), html: stringSchema('Complete A4 HTML and CSS.') },
    ['filename', 'html']
  ),
  tool(
    'edit_pdf',
    'Update an existing PDF artifact.',
    {
      id: stringSchema('Existing six-digit artifact ID.'),
      path: stringSchema('Existing PDF path when no artifact ID is available.'),
      html: stringSchema('Updated complete HTML and CSS.')
    },
    ['html']
  ),
  tool(
    'write_pptx',
    'Generate a 16:9 PowerPoint artifact from slide HTML and CSS.',
    {
      filename: stringSchema('PowerPoint filename.'),
      html: stringSchema('Complete 1920x1080 slide HTML and CSS.')
    },
    ['filename', 'html']
  ),
  tool(
    'edit_pptx',
    'Update an existing PowerPoint artifact.',
    {
      id: stringSchema('Existing six-digit artifact ID.'),
      path: stringSchema('Existing PowerPoint path when no artifact ID is available.'),
      html: stringSchema('Updated complete slide HTML and CSS.')
    },
    ['html']
  )
]

export const toolNames = new Set(toolsManifest.map((definition) => definition.name))

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolsManifest.find((definition) => definition.name === name)
}
