import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn, exec, execFile, execSync } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { createReadStream, createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { DEPENDENCIES } from './dependenciesManifest'
import type {
  DemoDownloadResult,
  DemoInstallProgress,
  DemoOpenResult,
  DemoProcessResult,
  Dependency,
  DemoDependencyProgress
} from '../shared/demo'
import type { DownloadProgress } from '../shared/types'

const DEMO_DOWNLOAD_ID = 'demo-prism-installer'

function emitDemoProgress(progress: Omit<DemoInstallProgress, 'updatedAt'>): void {
  const payload: DemoInstallProgress = {
    ...progress,
    updatedAt: Date.now()
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('demo-install-progress', payload)
    }
  }
}

function emitDownloadProgress(progress: DownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('download-progress', progress)
    }
  }
}

function runProcess(
  command: string,
  args: string[],
  options: {
    stage: DemoInstallProgress['stage']
    message: string
    cwd?: string
    visibleWindow?: boolean
  }
): Promise<DemoProcessResult> {
  return new Promise((resolve) => {
    let output = ''

    emitDemoProgress({
      stage: options.stage,
      message: options.message
    })

    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: !options.visibleWindow,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
      emitDemoProgress({
        stage: options.stage,
        message: options.message,
        cliOutput: output.slice(-4000)
      })
    })

    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
      emitDemoProgress({
        stage: options.stage,
        message: options.message,
        cliOutput: output.slice(-4000)
      })
    })

    child.on('error', (err) => {
      resolve({
        ok: false,
        output,
        error: err.message
      })
    })

    child.on('close', (exitCode) => {
      resolve({
        ok: exitCode === 0,
        exitCode,
        output
      })
    })
  })
}

async function runInstaller(setupPath: string): Promise<DemoProcessResult> {
  const resolvedPath = path.resolve(setupPath)
  await fs.access(resolvedPath)

  const result = await runProcess(resolvedPath, [], {
    stage: 'installer-running',
    message: 'Prism installer is running...',
    cwd: path.dirname(resolvedPath),
    visibleWindow: true
  })

  if (result.ok) {
    try {
      await fs.rm(resolvedPath, { force: true })
      console.log(`Successfully cleaned up temporary installer at: ${resolvedPath}`)
    } catch (err) {
      console.error(`Failed to clean up temporary installer: ${err}`)
    }

    emitDemoProgress({
      stage: 'installer-finished',
      message: 'Prism installer finished.',
      setupPath: resolvedPath
    })
    return result
  }

  if (/spawn|EACCES|UNKNOWN/i.test(result.error || '')) {
    const openError = await shell.openPath(resolvedPath)
    if (!openError) {
      emitDemoProgress({
        stage: 'installer-finished',
        message: 'Prism installer launched.',
        setupPath: resolvedPath
      })
      return { ok: true, exitCode: null, output: result.output }
    }
    return { ok: false, output: result.output, error: openError }
  }

  return {
    ...result,
    error: result.error || `Installer exited with code ${result.exitCode}`
  }
}

async function installPrismCli(): Promise<DemoProcessResult> {
  const result = await runProcess(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'iwr -useb bit.ly/prismcli | iex'],
    {
      stage: 'cli-running',
      message: 'Installing PrismCLI...',
      visibleWindow: true
    }
  )

  emitDemoProgress({
    stage: result.ok ? 'cli-finished' : 'failed',
    message: result.ok ? 'PrismCLI installation finished.' : 'PrismCLI installation failed.',
    cliOutput: (result.output || '').slice(-4000),
    error: result.ok ? undefined : result.error || `PrismCLI exited with code ${result.exitCode}`
  })

  return result.ok
    ? result
    : {
        ...result,
        error: result.error || `PrismCLI exited with code ${result.exitCode}`
      }
}

async function openInstalledPrism(): Promise<DemoOpenResult> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

  const candidates = [
    path.join(localAppData, 'Programs', 'Prism', 'Prism.exe'),
    path.join(localAppData, 'Prism', 'Prism.exe'),
    path.join(programFiles, 'Prism', 'Prism.exe'),
    path.join(programFilesX86, 'Prism', 'Prism.exe'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Prism.lnk')
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      const error = await shell.openPath(candidate)
      if (error) return { ok: false, path: candidate, error }
      return { ok: true, path: candidate }
    } catch {
      // Try the next known install location.
    }
  }

  return {
    ok: false,
    error: 'Prism was not found in the usual Windows install locations.'
  }
}

function getEmbeddedInstallerPath(): string {
  const prodPath = path.join(process.resourcesPath, 'resources', 'prism-setup.exe')
  const devPath = path.join(process.cwd(), 'resources', 'prism-setup.exe')
  return app.isPackaged ? prodPath : devPath
}

async function unpackEmbeddedInstaller(): Promise<DemoDownloadResult> {
  const tempPath = app.getPath('temp')
  const setupPath = path.join(tempPath, 'prism-setup.exe')
  const embeddedPath = getEmbeddedInstallerPath()

  try {
    emitDemoProgress({
      stage: 'unpacking',
      message: 'Preparing installer files...',
      setupPath
    })

    await fs.mkdir(tempPath, { recursive: true })

    if (!app.isPackaged) {
      try {
        await fs.access(embeddedPath)
      } catch {
        console.warn(`[Dev Mode] ${embeddedPath} not found. Creating a mock fallback using a system executable.`)
        const resourcesDir = path.dirname(embeddedPath)
        await fs.mkdir(resourcesDir, { recursive: true })

        const systemExes = [
          'C:\\Windows\\System32\\whoami.exe',
          'C:\\Windows\\System32\\ping.exe',
          'C:\\Windows\\System32\\cmd.exe'
        ]

        let copied = false
        for (const exe of systemExes) {
          try {
            await fs.access(exe)
            await fs.copyFile(exe, embeddedPath)
            copied = true
            console.log(`[Dev Mode] Successfully copied mock installer from ${exe} to ${embeddedPath}`)
            break
          } catch {
            // try next
          }
        }

        if (!copied) {
          await fs.writeFile(embeddedPath, 'DUMMY INSTALLER CONTENT FOR DEV TESTING')
          console.log(`[Dev Mode] Fallback to writing dummy text file at ${embeddedPath}`)
        }
      }
    }

    const stats = await fs.stat(embeddedPath)
    const totalBytes = stats.size
    let copiedBytes = 0
    let lastProgressAt = 0
    const startedAt = Date.now()

    const updateProgress = (receivedBytes: number, percent: number) => {
      emitDownloadProgress({
        id: DEMO_DOWNLOAD_ID,
        filename: 'prism-setup.exe',
        url: 'local-unpack',
        targetPath: setupPath,
        receivedBytes,
        totalBytes,
        percent,
        status: 'downloading',
        startedAt,
        updatedAt: Date.now()
      })
    }

    updateProgress(0, 0)

    const readStream = createReadStream(embeddedPath)
    const writeStream = createWriteStream(setupPath)

    const progressStream = new Transform({
      transform(chunk, _encoding, callback) {
        copiedBytes += chunk.length
        const now = Date.now()
        if (now - lastProgressAt > 150 || copiedBytes === totalBytes) {
          lastProgressAt = now
          const percent = Math.min(100, Math.round((copiedBytes / totalBytes) * 100))
          updateProgress(copiedBytes, percent)
        }
        callback(null, chunk)
      }
    })

    await pipeline(readStream, progressStream, writeStream)

    emitDemoProgress({
      stage: 'unpacked',
      message: 'Prism installer is ready.',
      setupPath
    })

    return {
      ok: true,
      setupPath,
      filename: 'prism-setup.exe',
      version: app.getVersion()
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    emitDemoProgress({
      stage: 'failed',
      message: `Failed to unpack installer: ${error}`,
      error
    })
    return { ok: false, error }
  }
}

async function findInstalledPrismExe(): Promise<string | null> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

  const candidates = [
    path.join(localAppData, 'Programs', 'Prism', 'Prism.exe'),
    path.join(localAppData, 'Prism', 'Prism.exe'),
    path.join(programFiles, 'Prism', 'Prism.exe'),
    path.join(programFilesX86, 'Prism', 'Prism.exe')
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch (err) {
      // Candidate not accessible
    }
  }
  return null
}

function refreshEnvPath(): void {
  try {
    let userPath = ''
    try {
      const out = execSync('reg query HKCU\\Environment /v Path', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      })
      const lines = out.split('\r\n')
      const line = lines.find((l) => l.includes('REG_SZ') || l.includes('REG_EXPAND_SZ'))
      if (line) {
        userPath = line.split(/REG_(?:SZ|EXPAND_SZ)\s+/)[1]?.trim() || ''
      }
    } catch (err) {
      // Registry key not found
    }

    let systemPath = ''
    try {
      const out = execSync(
        'reg query "HKLM\\System\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      )
      const lines = out.split('\r\n')
      const line = lines.find((l) => l.includes('REG_SZ') || l.includes('REG_EXPAND_SZ'))
      if (line) {
        systemPath = line.split(/REG_(?:SZ|EXPAND_SZ)\s+/)[1]?.trim() || ''
      }
    } catch (err) {
      // Registry key not found
    }

    if (userPath || systemPath) {
      const expand = (str: string) => {
        return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || `%${key}%`)
      }
      const expandedUser = expand(userPath)
      const expandedSystem = expand(systemPath)

      const merged = [expandedUser, expandedSystem].filter(Boolean).join(';')
      if (merged) {
        process.env.PATH = merged
      }
    }
  } catch (err) {
    console.error('refreshEnvPath error:', err)
  }
}

async function checkDependencyInstalled(dependency: Dependency): Promise<boolean> {
  refreshEnvPath()
  return new Promise((resolve) => {
    exec(dependency.checkCommand, { env: process.env }, (error) => {
      resolve(!error)
    })
  })
}

async function downloadDependencyFile(
  dependency: Dependency,
  emitProgress: (percent: number, message: string) => void
): Promise<string> {
  const tempDir = app.getPath('temp')
  const filename = dependency.downloadFilename || `${dependency.id}-setup.exe`
  const targetPath = path.join(tempDir, filename)

  await fs.unlink(targetPath).catch(() => {})

  emitProgress(0, `Starting download of ${dependency.name}...`)

  const response = await fetch(dependency.downloadUrl!, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Prism-Demo' }
  })

  if (!response.ok) {
    throw new Error(`Failed to download ${dependency.name}: HTTP ${response.status}`)
  }

  const totalHeader = Number(response.headers.get('content-length') || 0)
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined
  const file = await fs.open(targetPath, 'w')
  let receivedBytes = 0
  let lastProgressAt = 0

  const body = response.body
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    await file.write(buffer)
    await file.close()
    emitProgress(100, `Downloaded ${dependency.name}.`)
    return targetPath
  }

  try {
    const reader = body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = Buffer.from(value)
      await file.write(chunk)
      receivedBytes += chunk.length

      const now = Date.now()
      if (now - lastProgressAt > 150) {
        lastProgressAt = now
        const percent = totalBytes
          ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
          : undefined
        emitProgress(percent || 0, `Downloading ${dependency.name}...`)
      }
    }
  } finally {
    await file.close()
  }

  emitProgress(100, `Downloaded ${dependency.name}.`)
  return targetPath
}

async function installDependency(
  dependency: Dependency,
  filePath?: string,
  emitProgress?: (percent: number, message: string, cliOutput?: string) => void
): Promise<DemoProcessResult> {
  const command = dependency.installCommand.replace('{filepath}', filePath || '')

  return new Promise((resolve) => {
    let output = ''

    emitProgress?.(0, `Installing ${dependency.name}...`)

    const child = exec(command, { env: process.env })

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
      emitProgress?.(50, `Installing ${dependency.name}...`, output.slice(-2000))
    })

    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
      emitProgress?.(50, `Installing ${dependency.name}...`, output.slice(-2000))
    })

    child.on('close', async (exitCode) => {
      if (exitCode === 0) {
        refreshEnvPath()
        const verified = await checkDependencyInstalled(dependency)
        if (verified) {
          emitProgress?.(100, `Installed ${dependency.name} successfully.`)
          resolve({ ok: true, exitCode, output })
        } else {
          resolve({
            ok: false,
            exitCode,
            output,
            error: `${dependency.name} verification failed after installation.`
          })
        }
      } else {
        resolve({
          ok: false,
          exitCode,
          output,
          error: `${dependency.name} setup exited with code ${exitCode}`
        })
      }
    })

    child.on('error', (err) => {
      resolve({
        ok: false,
        output,
        error: err.message
      })
    })
  })
}

export function registerDemoDownloadHandlers(): void {
  for (const channel of [
    'demo-download-prism',
    'demo-run-prism-installer',
    'demo-install-deps',
    'demo-install-cli',
    'demo-open-prism',
    'demo-quit-app',
    'demo-get-prism-dependencies',
    'demo-install-dependency'
  ]) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle('demo-download-prism', async (): Promise<DemoDownloadResult> => {
    return await unpackEmbeddedInstaller()
  })

  ipcMain.handle(
    'demo-run-prism-installer',
    async (_event, setupPath: string): Promise<DemoProcessResult> => {
      try {
        emitDemoProgress({
          stage: 'launching-installer',
          message: 'Launching Prism installer...',
          setupPath
        })
        return await runInstaller(setupPath)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        emitDemoProgress({
          stage: 'failed',
          message: error,
          setupPath,
          error
        })
        return { ok: false, error }
      }
    }
  )

  ipcMain.handle('demo-install-cli', async (): Promise<DemoProcessResult> => {
    try {
      return await installPrismCli()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      emitDemoProgress({
        stage: 'failed',
        message: error,
        error
      })
      return { ok: false, error }
    }
  })

  ipcMain.handle('demo-install-deps', async (): Promise<DemoProcessResult> => {
    return { ok: true, output: 'Dependencies managed dynamically.' }
  })

  ipcMain.handle('demo-get-prism-dependencies', async (): Promise<{ ok: boolean; dependencies?: Dependency[]; error?: string }> => {
    try {
      const exePath = await findInstalledPrismExe()
      if (!exePath) {
        console.warn('Prism executable not found. Falling back to default dependency manifest.')
        return { ok: true, dependencies: DEPENDENCIES }
      }

      return new Promise((resolve) => {
        execFile(exePath, ['--get-dependencies'], (error, stdout) => {
          if (error) {
            console.warn(
              'Failed to run Prism --get-dependencies, falling back to local manifest:',
              error
            )
            resolve({ ok: true, dependencies: DEPENDENCIES })
            return
          }

          try {
            const dependencies = JSON.parse(stdout.trim())
            resolve({ ok: true, dependencies })
          } catch (parseErr) {
            console.warn(
              'Failed to parse dependencies stdout, falling back to local manifest:',
              parseErr
            )
            resolve({ ok: true, dependencies: DEPENDENCIES })
          }
        })
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { ok: false, error }
    }
  })

  ipcMain.handle(
    'demo-install-dependency',
    async (event, dependency: Dependency): Promise<DemoProcessResult> => {
      const emitDepProgress = (
        status: DemoDependencyProgress['status'],
        percent: number | undefined,
        msg: string,
        cliOutput?: string
      ): void => {
        event.sender.send('demo-dependency-progress', {
          dependencyId: dependency.id,
          status,
          percent,
          message: msg,
          cliOutput
        })
      }

      try {
        emitDepProgress('checking', undefined, `Checking if ${dependency.name} is installed...`)
        const isInstalled = await checkDependencyInstalled(dependency)
        if (isInstalled) {
          emitDepProgress('completed', 100, `${dependency.name} is already installed.`)
          return { ok: true, output: 'Already installed' }
        }

        let filePath: string | undefined
        if (dependency.downloadUrl) {
          emitDepProgress('downloading', 0, `Downloading ${dependency.name}...`)
          filePath = await downloadDependencyFile(dependency, (percent, msg) => {
            emitDepProgress('downloading', percent, msg)
          })
        }

        emitDepProgress('installing', 0, `Installing ${dependency.name}...`)
        const result = await installDependency(dependency, filePath, (percent, msg, cliOutput) => {
          emitDepProgress('installing', percent, msg, cliOutput)
        })

        if (result.ok) {
          emitDepProgress('completed', 100, `Installed ${dependency.name} successfully.`)
        } else {
          emitDepProgress(
            'failed',
            undefined,
            `Failed to install ${dependency.name}: ${result.error}`,
            result.output
          )
        }

        return result
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        emitDepProgress('failed', undefined, `Error: ${error}`)
        return { ok: false, error }
      }
    }
  )

  ipcMain.handle('demo-open-prism', async (): Promise<DemoOpenResult> => {
    return await openInstalledPrism()
  })

  ipcMain.handle('demo-quit-app', async (): Promise<void> => {
    app.quit()
  })
}
