# Master Troubleshooting and System Diagnostics Guide

## 1. Introduction: System Reliability in Prism

Prism is a hybrid desktop application coordinating local file workflows, shell terminals, web engines, and cloud-hosted Large Language Model APIs. Because it operates across this multi-layered environment, failures can manifest in different parts of the system. A network latency spike can trigger an API timeout; an operating system password reset can break key storage keys; a complex markdown table can trip a TTS model.

This document serves as the master troubleshooting and diagnostics manual for Prism. It details the exact technical causes, error codes, and step-by-step resolution workflows for the most common errors encountered in:
* API Key Authentication & Quota Limits
* Text-to-Speech (TTS) Stream failures (specifically the HTTP 500 error code)
* Playwright & Browser Automation Launchers
* Sandboxed Terminal Command blocks
* Application Auto-Updates & Config corruption

---

## 2. API Key Authentication and Config Registry Failures

Prism connects directly to Google's official Gemini API endpoints. Authentication issues typically generate HTTP error response codes.

### 2.1. HTTP Error Code Reference

#### `401 Unauthorized (API_KEY_INVALID)`
* **Technical Cause:** The API key passed in the request header is incorrect, expired, or has been deleted from the Google AI Studio console.
* **Diagnostics:** Check if the key contains accidental trailing spaces or missing characters.
* **Resolution:** Open **System Settings**, delete the active key, paste a fresh key generated from Google AI Studio, and click **Save**.

#### `403 Forbidden`
* **Technical Cause:** The API key is structurally valid, but the user is blocked from accessing the model. This occurs when:
  * The user is attempting to access a model that is restricted to specific regions (e.g. accessing a preview model in a country where Google has not enabled it yet).
  * The key has billing restrictions, or the associated Google Cloud project is disabled.
* **Resolution:** Verify region availability for the target model. If region-blocked, consider routing prompts through a VPN or switching to a widely available stable model like `prism-6-fast` (`gemini-3.5-flash`).

#### `429 Rate Limit Exceeded (RESOURCE_EXHAUSTED)`
* **Technical Cause:** The active API key has exceeded Google's service limits. Quota limits are calculated using three distinct metrics:
  * **Requests per Minute (RPM):** Max number of distinct API requests allowed per minute.
  * **Tokens per Minute (TPM):** Max volume of prompt + response tokens processed per minute.
  * **Requests per Day (RPD):** Max daily request limit.
* **Resolution:** Prism includes an automatic cascade fallback engine that switches models during a 429 error. If the error persists, users should:
  * Wait 60 seconds for the RPM counter to reset.
  * Reduce context token size by closing large attached files or clearing chat history (`Ctrl+N`).
  * Request a quota increase inside their Google Cloud Console project.

### 2.2. safeStorage Configuration Corruption
Prism encrypts the API key using Electron's `safeStorage` module, writing the payload to `prismconfigs.cfg` on disk.
* **The Failure:** If the user resets their operating system password, migrates their user profile to a new domain controller, or moves their configuration files to a different computer, the OS cryptography keys change. The main process fails to decrypt `prismconfigs.cfg`, throwing the error:
  `Error: safeStorage decryption failed.`
* **The Symptoms:** The application launches, but settings are not loaded, the API key appears empty, or the AI fails to initialize.
* **Resolution:**
  1. Close Prism.
  2. Navigate to the user application directory:
     `C:\Users\Username\.gemini\antigravity\config` (or the folder where `prismconfigs.cfg` is located).
  3. Delete the `prismconfigs.cfg` file.
  4. Relaunch Prism. The app will generate a clean configuration file.
  5. Re-enter the API key in the System Settings and click Save, forcing the OS to encrypt the credentials with the new security session keys.

---

## 3. Text-to-Speech (TTS) Failures and HTTP 500 Errors

Prism's read-aloud feature uses Google's multimodal audio generation API. In recent releases, users have reported transient **HTTP 500 Internal Server Error** codes during voice playback generation.

```
       [TTS Text Input] -> Includes Raw Markdown / LaTeX (e.g. "$E=mc^2$")
                               |
                               v
                     [gemini-2.5-flash-preview-tts]
                               |
                               v
            [API Server-Side Audio Synthesis Engine]
                               |
             (Fails to parse mathematical delimiters)
                               |
                               v
                [HTTP 500 Internal Server Error]
                               |
                               v
                 Prism throws Audio Generation Error
                               |
                  (TTS Audio Playback Fails)
```

### 3.1. Technical Analysis of the TTS Code 500 Error
The TTS system leverages the `gemini-2.5-flash-preview-tts` model with `responseModalities: ['audio']` and prebuilt voice profiles (like `Aoede` or `Fenrir`). Because this is a preview API endpoint, the server-side audio synthesizer is sensitive to formatting:
* **Formatting Delimiter Crash:** The most common trigger for a 500 error is special text characters. If the AI response contains mathematical formulas (LaTeX delimiters like `\(...\)` or `$$...$$`), raw code blocks with backticks, raw HTML tags, or emojis, the server-side text-to-speech engine fails to parse them into spoken phonemes and throws a generic 500 error.
* **Voice Profile Deprecation:** The preview models occasionally update their backend voice tables. If a voice name (e.g. `Aoede`) is deprecated or temporarily deactivated for maintenance, requests referencing it will return a 500 code.
* **Input Token Limits:** The preview audio synthesizer has a maximum input length limit. If the AI attempts to read a long code file or multi-paragraph essay in a single stream segment, the server fails.

### 3.2. Workarounds and Solutions
If you experience a TTS code 500 error, follow these troubleshooting steps:

#### Step 1: Sanitize the Input Text
Ask the AI to generate answers without special characters if you intend to listen to them. For example, append this to your prompt:
`Format your response as simple, plain text without math formulas, markdown codeblocks, or html tags.`

#### Step 2: Switch the Active Voice
If a specific voice profile has been modified on Google's servers:
1. Open **System Settings**.
2. Scroll to the **Text-to-Speech** section.
3. Switch the Voice parameter (e.g., from `Aoede` to `Fenrir` or `Kore`).
4. Click **Save** and retry the voice generation.

#### Step 3: Audio Modality Toggle
If the preview model is experiencing a global server outage:
1. Toggle the voice reader button off in the chat frame, letting Prism render standard text responses.
2. Check Google Cloud status dashboards for Gemini API audio modality performance logs.

### 3.3. HTML5 Audio Playback Issues
Sometimes the API returns a valid base64 WAV stream, but the UI fails to play it aloud.
* **Symptom:** The play button changes state, but there is no sound.
* **Checklist:**
  1. **Volume Bindings:** Check if your system audio output is muted or set to a different default output device.
  2. **Browser Context Policy:** Modern Chromium instances block media from playing automatically without prior user interaction. Ensure you have clicked inside the Prism window at least once during the session to unlock the Web Audio context.
  3. **Codec Support:** Verify that your local operating system has standard PCM/WAV codec support installed.

---

## 4. Playwright and Browser Automation Failures

Prism’s web automation features rely on Playwright to run a background Chromium browser. This layer can fail due to driver installation bugs or resource limits.

### 4.1. Missing Browser Binaries
* **The Error:** Running a browser tool (like `open_browser` or `browser_snapshot`) returns:
  `Error: Chromium revision not found. Run "npx playwright install"`
* **Cause:** The Playwright browser packages were not downloaded during the npm post-install hook, or the binary files were deleted by clean-up software.
* **Resolution:**
  1. Open a system terminal in the project directory.
  2. Execute the install command manually:
     `npx playwright install chromium`
  3. Ensure the browser binary is correctly written to your user AppData directory (e.g. `C:\Users\Username\AppData\Local\ms-playwright`).

### 4.2. Diagnostic Script
To verify that Playwright is working correctly on your machine, create and run this script `playwright_test.js` in your scratch folder:
```javascript
const { chromium } = require('playwright');
(async () => {
  try {
    console.log('Launching Chromium...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    console.log('Navigating to example.com...');
    await page.goto('https://example.com');
    console.log('Page title:', await page.title());
    await browser.close();
    console.log('Playwright test PASSED successfully!');
  } catch (err) {
    console.error('Playwright test FAILED:', err);
  }
})();
```

### 4.3. Launch Timeout Rejections
* **The Error:** `browser_navigate` or `open_browser` fails with:
  `TimeoutError: page.goto: Navigation timeout of 30000ms exceeded.`
* **Cause:**
  * The target website is down, blocking headless connections, or running heavy scripts.
  * Your network requires proxy setups that have not been configured in the browser launcher.
* **Resolution:**
  * Try opening the link in your system browser using `open_browser_link` to check if the URL is accessible.
  * Check if your local firewall or antivirus is blocking the headless Chromium process (`chrome.exe` under ms-playwright).

---

## 5. Network Proxy Configurations

If you operate inside a corporate network or behind a security proxy, both the Gemini API connection and Playwright sessions must be configured:

### 5.1. Gemini API Proxy
The Gemini API client runs inside Node.js. It respects standard environment proxy variables.
* Open your `.env` file in the root of the project.
* Define your proxy details:
  ```env
  HTTP_PROXY=http://username:password@proxy.example.com:8080
  HTTPS_PROXY=http://username:password@proxy.example.com:8080
  NO_PROXY=localhost,127.0.0.1
  ```
* The underlying API client (`undici`) automatically captures these variables and routes HTTP headers through the proxy tunnel.

### 5.2. Playwright Browser Proxy
If headless Chromium fails to load web pages while your main chat works:
* Playwright must be passed a proxy configuration during launch.
* Open `src/main/systemTools.ts` and ensure that the browser launch arguments check for the presence of the `HTTP_PROXY` environment variable, binding it to the browser config:
  ```typescript
  const launchOptions: any = { headless: false };
  if (process.env.HTTP_PROXY) {
    launchOptions.proxy = { server: process.env.HTTP_PROXY };
  }
  ```

---

## 6. Sandboxed Terminal Command Rejections

When the AI attempts to run local commands, the security engine (`localCommandSandbox.ts`) can block them.

### 6.1. Handling `CommandBlockedError`
* **The Symptoms:** The console displays:
  `Error: CommandBlockedError: [Reason]` (e.g. `system shutdown/restart commands are blocked`).
* **Cause:** The command contains a banned system binary (like `shutdown`, `wsl`, `bcdedit`, `netsh`) or attempts to write files directly to protected folders (`C:\Windows`).
* **Resolving Legitimate Blocks:**
  * If you need to run a blocked command to set up your environment, run the command manually inside your native system terminal (PowerShell, Command Prompt, or terminal emulator).
  * If a directory deletion command was blocked because it targeted a broad root, relocate your folder structure to a safe, deep subproject directory (e.g. `C:\Users\Username\Documents\Workspace`) and retry.

---

## 7. Updater and Connection Failures

Prism includes an automatic update manager (`src/main/updater.ts`) that pulls releases from GitHub.

### 7.1. GitHub API Rate Limits
* **The Error:** The log shows:
  `Failed to check for updates: GitHub API rate limit exceeded.`
* **Cause:** Checking for updates too frequently can exceed the GitHub API rate limit for anonymous connections.
* **Resolution:** The updater is configured to check only on app startup. Avoid restarting the app repeatedly in short periods.

### 7.2. Network Timeouts and Firewall Blocks
* **The Error:** `Error: getaddrinfo ENOTFOUND github.com`
* **Cause:** Prism is blocked from reaching GitHub by local network firewalls or DNS resolution errors.
* **Resolution:** Ensure Prism is whitelisted in your system firewall. If you are behind a corporate proxy, set the `HTTP_PROXY` and `HTTPS_PROXY` environment variables in your `.env` file so the Node process can route its connection requests correctly.
