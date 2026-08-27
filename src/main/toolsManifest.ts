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

export const COMPUTER_READ_FILE_DEFAULT_LIMIT = 500
export const COMPUTER_READ_FILE_MAX_LINES = 800
export const COMPUTER_READ_FILE_MAX_CHARACTERS = 80_000

export const toolsManifest: ToolDefinition[] = [
  tool(
    'generate_image',
    'Generate a new image or edit a specific image already available in this conversation. You decide when a visual is appropriate and must supply a complete, polished final prompt. For edits, set operation to "edit" and copy the exact prism-image://asset/<uuid> reference announced with the intended image into source_image_ref. Never invent references or use filesystem paths. Generated outputs become part of this assistant response and receive references that can be edited later.',
    {
      prompt: stringSchema(
        'Complete final prompt to send to the configured image-generation model.'
      ),
      operation: stringSchema(
        'Whether to create a new image or edit an existing chat image asset.',
        {
          enum: ['generate', 'edit'],
          default: 'generate'
        }
      ),
      source_image_ref: stringSchema(
        'Exact Prism image reference to edit, such as prism-image://asset/<uuid>. Required only when operation is edit.'
      ),
      size: stringSchema('Requested output dimensions.', {
        enum: [
          '256x256',
          '512x512',
          '1024x1024',
          '1024x1536',
          '1536x1024',
          '1024x1792',
          '1792x1024'
        ],
        default: '1024x1024'
      }),
      quality: stringSchema('Provider-supported output quality.', {
        enum: ['auto', 'low', 'medium', 'high', 'standard', 'hd']
      }),
      n: integerSchema('Number of images to generate.', { default: 1, minimum: 1, maximum: 4 })
    },
    ['prompt']
  ),
  tool(
    'discord_leave_voice',
    'Requests leaving the current Discord voice channel. Use this when the user asks you to leave, or when the full conversation makes ending the voice session appropriate. After it succeeds, say a brief personalized goodbye and do not call more tools.',
    {},
    []
  ),
  tool(
    'execute_terminal_command',
    'Run one command in the user-configured terminal shell. Short commands return their exit code and output immediately. Long-running processes yield a six-digit Run ID and continue in the background. You do NOT need to poll: Prism will automatically resume/notify you upon completion or when input is needed.',
    { command: stringSchema('Exact shell command to execute.') },
    ['command']
  ),
  tool(
    'read_terminal_output',
    'Read the accumulated terminal output so far for a background or interactive terminal command using its six-digit Run ID. Use ONLY to inspect intermediate output of live persistent services or for targeted debugging. DO NOT poll in a loop to wait for completion.',
    { runId: stringSchema('Six-digit Run ID of the terminal process.') },
    ['runId']
  ),
  tool(
    'send_terminal_input',
    'Send input text and/or simulated keyboard key combinations (such as Arrow keys, Enter, Ctrl+B, Shift+Alt+L, etc.) to the standard input (stdin) of a running terminal command.',
    {
      runId: stringSchema('Six-digit Run ID of the terminal process.'),
      input: stringSchema(
        'Optional text to write to stdin. Confirmed with Enter automatically by default.'
      ),
      keys: {
        type: 'array',
        description:
          'Optional list of key names or modifier combinations to press in order, e.g. ["ArrowUp", "ArrowUp", "Enter"], ["Ctrl+B"], ["Shift+Alt+L"], ["Tab"], ["Escape"], ["Ctrl+C"].',
        items: stringSchema('Key name or combo string.')
      },
      pressEnter: booleanSchema(
        'Whether to automatically confirm input text with Enter/newline. Default is true.',
        true
      )
    },
    ['runId']
  ),
  tool(
    'kill_terminal_process',
    'Terminate/kill a running background terminal command using its six-digit Run ID.',
    { runId: stringSchema('Six-digit Run ID of the terminal process to terminate.') },
    ['runId']
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
    'Read a bounded line range from a text file, or extract and read structured text from PDF (.pdf), PowerPoint (.pptx), and Word (.docx) documents.',
    {
      path: pathArg,
      startLine: integerSchema('First line to read, using one-based indexing.', {
        default: 1,
        minimum: 1
      }),
      limit: integerSchema(
        `Maximum number of lines to return (up to ${COMPUTER_READ_FILE_MAX_LINES}; the selected content is capped at ${COMPUTER_READ_FILE_MAX_CHARACTERS.toLocaleString('en-US')} characters).`,
        {
          default: COMPUTER_READ_FILE_DEFAULT_LIMIT,
          minimum: 1,
          maximum: COMPUTER_READ_FILE_MAX_LINES
        }
      )
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
    'Open an application or file via path in the default system app.',
    { appPath: stringSchema('Absolute file or executable path.') },
    ['appPath']
  ),
  tool(
    'web_search',
    'Search DuckDuckGo and automatically read the top 5 matching source pages. Use for standard quick search queries.',
    { query: stringSchema('Focused web search query.') },
    ['query']
  ),
  tool(
    'web_fetch',
    'Deep web research tool. Automatically executes 4 distinct Google-style search queries (retrieving 5 pages per query, totaling 20 source web pages) on different facets of a topic, and synthesizes the findings via a dedicated subagent into a comprehensive, detailed summary (at least 1000 characters minimum, up to 4000 characters). Always call web_fetch when the user requests a deep search, deep research, comprehensive analysis, or whenever a complex topic demands thorough multi-source investigation.',
    {
      title: stringSchema(
        "Descriptive research title specifying the main extraction topic. MUST be written in the user's conversational language (e.g. 'Dominância das empresas chinesas de IA no mercado de 2026' if talking in Portuguese). This title guides subagent focus and appears in the user interface."
      ),
      queries: {
        type: 'array',
        description:
          "Exactly 4 distinct Google-style web search queries exploring different aspects and variants of the topic. Formulate them as Google search queries in whichever language yields the highest quality global results (e.g. English for global/tech topics, or the user's language for regional topics). Each query retrieves 5 web pages (4 x 5 = 20 total pages).",
        minItems: 4,
        maxItems: 4,
        items: stringSchema('A focused Google-style web search query.')
      }
    },
    ['title', 'queries']
  ),
  tool(
    'open_browser_link',
    'Open a web URL (http/https) in the system browser. Do not use for local file paths.',
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
  tool('computer_use_see_screen', 'Capture a screenshot of the entire screen.', {
    appName: stringSchema(
      'Optional window/app name (ignored, full desktop screen is always captured).',
      { default: 'Entire Screen' }
    )
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
    generativeBrowserModel: stringSchema('Generative AI Browser model key.'),
    imageGenerationModel: stringSchema('Native image-generation model route key.'),
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
    'read_skill',
    'Read a specialized skill file from Prism internal skills library to learn guidelines and unlock execution tools for specific tasks.',
    {
      skill_name: stringSchema(
        'Filename of the skill to read, e.g. "pdf_skill.md" or "pptx_skill.md".'
      )
    },
    ['skill_name']
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
