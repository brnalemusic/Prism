# File and Browser Tools Reference

## 1. Computer Use File Tools (`computer_use_*`)

Prism provides an explicit suite of local file manipulation tools defined in `src/main/toolsManifest.ts` and `src/main/systemTools.ts`:

| Tool Name | Parameters | Description |
| --- | --- | --- |
| `computer_use_read_file` | `path`, `startLine`, `limit` | Read file lines with pagination support |
| `computer_use_create_file` | `path`, `content` | Create a new file with initial content |
| `computer_use_save_file` | `path`, `content` | Write or overwrite full file content |
| `computer_use_append_file` | `path`, `content` | Append text content to an existing file |
| `computer_use_edit_file` | `path`, `startLine`, `endLine`, `newContent` | Replace a targeted line range in a file |
| `computer_use_remove_file` | `path` | Delete a single file |
| `computer_use_create_directory` | `path` | Create a directory |
| `computer_use_remove_directory` | `path` | Delete a directory recursively |
| `computer_use_list_directory` | `path` | List files and subdirectories |
| `computer_use_copy_file` | `sourcePath`, `destinationPath`, `overwrite` | Copy file or directory |
| `computer_use_move_file` | `sourcePath`, `destinationPath`, `overwrite` | Move or rename file or directory |
| `computer_use_get_file_info` | `path` | Retrieve file size, creation date, and metadata |

`computer_use_read_file` uses one-based `startLine` indexing. `limit` defaults to 500 lines and accepts at most 800 lines per request. The selected content may contain up to 80,000 characters.

### Harness Project Explorer

The Sidebar becomes a project Explorer while the Harness workspace is active. It lists the active tab's registered project root, loads expanded directories on demand, and provides a manual refresh action. Hidden entries, symbolic links, binary or very large files, source-control metadata, dependency directories, and common build outputs are excluded by default.

Files and directories can be queued for the next Harness message through **Send to agent**. Each Harness tab keeps an independent queue of up to five items. Files may also be dragged from the Explorer onto the Harness InputBar. Explicit chip removal does not require confirmation; selecting an already queued tree item does.

Explorer context is resolved again in the main process when the message is sent. Renderer-provided paths must be project-relative and are validated against the registered project root. Files contribute their relative path, absolute path, and bounded UTF-8 content. Directories contribute both paths and a bounded recursive listing without file bodies. Missing, changed, binary, or truncated items produce explicit warnings in the technical context block. The visible user message remains unchanged, and regular image, PDF, or presentation attachments may be sent with Explorer context.

The context menu supports **Send to agent**, **Open file**, **Copy path**, and **Open in file explorer** where applicable. Opening uses the operating system's default application; revealing uses the operating system file manager.

---

## 2. Playwright Web Browser Tools

Prism embeds a stateful Playwright Chromium browser engine for live web navigation, scraping, and form automation.

| Browser Tool | Parameters | Action |
| --- | --- | --- |
| `open_browser` | `url` | Open persistent browser session |
| `browser_navigate` | `url` | Navigate active browser tab to target URL |
| `browser_snapshot` | `full` | Capture semantic accessibility DOM tree with element IDs |
| `browser_click` | `elementId` | Click DOM element by snapshot reference ID |
| `browser_type` | `elementId`, `text` | Type text into input field by snapshot reference ID |
| `browser_press` | `key` | Press keyboard key (e.g. `Enter`, `Tab`, `Escape`) |
| `browser_scroll` | `direction`, `amount` | Scroll active page up or down |
| `browser_back` | `{}` | Go back in browser navigation history |
| `browser_close` | `{}` | Close browser automation session |
| `web_script` | `url`, `script` | Execute JavaScript snippet inside page DOM |
| `detailed_dom_page` | `url` | Fetch full HTML structure of target URL |

### CDPSession Download Tracking
Browser navigation and clicks intercept file download events via Playwright Chrome DevTools Protocol (`CDPSession`). Live download progress (`download-progress`) is broadcast to the renderer UI showing received bytes, total size, percentage, and completion status.

---

## 3. Generative AI Browser Engine (`generate:`)

Prism's AI Browser supports real-time progressive website synthesis and multi-turn interactive navigation via prompts:

- **Protocol Trigger:** Entering any URL prefixed with `generate:` or `gen:` (e.g. `generate:youtube.com`, `generate:SaaS Landing Page with Pricing Matrix`) initiates the Generative Web Engine.
- **Progressive Real-Time Streaming:** The generative engine emits direct semantic HTML5 + Tailwind CSS + Lucide Icons into the live viewport, rendering layout, cards, navigation, and styling progressively in real time as tokens stream in without blank screens.
- **Multi-Runtime Support:** The live sandbox supports both semantic HTML5 + interactive JavaScript and React 18 + Babel Standalone with an integrated Lucide React proxy for dynamic SVG icons.
- **Interactive Prompt Protocol ("Pulo do Gato"):** The generative engine embeds `data-prompt="..."` attributes in interactive elements (buttons, links, footer terms). Clicking any element triggers contextual subpage synthesis, preserving the design language, color scheme, navbar, and footer from prior turns.
- **Code Inspection & Export:** Users can toggle between **Live Preview** and **View Code** to inspect or copy generated source code, or click the system browser icon to export and open the site in their default browser.
