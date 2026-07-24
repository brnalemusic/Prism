export interface Dependency {
  id: string
  name: string
  description: string
  checkCommand: string
  downloadUrl?: string
  downloadFilename?: string
  installCommand: string
}

export const DEPENDENCIES: Dependency[] = [
  {
    id: 'node',
    name: 'Node.js',
    description: 'JavaScript runtime required to run local command tools.',
    checkCommand: 'node -v',
    downloadUrl: 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip',
    downloadFilename: 'node-v20.11.1-win-x64.zip',
    installCommand: 'extract-zip'
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Version control tool required for codebase operations.',
    checkCommand: 'git --version',
    downloadUrl:
      'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe',
    downloadFilename: 'git-setup.exe',
    installCommand:
      '"{filepath}" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS'
  },
  {
    id: 'playwright-chromium',
    name: 'Playwright Chromium',
    description: 'Browser dependency required for web search and page reading.',
    checkCommand:
      "powershell -NoProfile -Command \"if ( (Test-Path 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') -or (Test-Path 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe') -or (Test-Path 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe') -or (Test-Path 'C:\\Program Files\\Mozilla Firefox\\firefox.exe') -or (Test-Path \\\"$env:USERPROFILE\\AppData\\Local\\ms-playwright\\\") ) { exit 0 } else { exit 1 }\"",
    installCommand: 'npx playwright install chromium'
  }
]
