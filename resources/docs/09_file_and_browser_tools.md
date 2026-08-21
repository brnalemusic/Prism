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

Prism's AI Browser supports real-time website synthesis and multi-turn interactive navigation via prompts:

- **Protocol Trigger:** Entering any URL prefixed with `generate:` or `gen:` (e.g. `generate:youtube.com`, `generate:SaaS Landing Page with Pricing Matrix`) initiates the Generative Web Engine.
- **Dedicated System Prompt:** The generative model compiles raw HTML5 + CSS in real time using progressive token streaming into a sandboxed live viewport.
- **Interactive Prompt Protocol ("Pulo do Gato"):** The generative engine embeds `data-prompt="..."` attributes in interactive elements (buttons, links, footer terms). Clicking any element triggers contextual subpage synthesis, preserving the design language, color scheme, navbar, and footer from prior turns.
- **Code Inspection & Export:** Users can toggle between **Live Preview** and **View Code** to inspect or copy generated source code, or click the system browser icon to export and open the site in their default browser.

