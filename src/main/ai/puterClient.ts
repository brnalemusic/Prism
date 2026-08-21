import http from 'node:http'
import { shell } from 'electron'
import { ProviderModel } from '../../shared/types'
import { isModelTrusted } from './trustedRegistry'

// @ts-ignore - CommonJS bundle export from @heyputer/puter.js
import { init as initPuterSdk } from '@heyputer/puter.js/src/init.cjs'

export interface PuterUser {
  username?: string
  email?: string
  [key: string]: unknown
}

export interface PuterLoginResult {
  success: boolean
  token?: string
  username?: string
  user?: PuterUser
  error?: string
}

let activeAuthServer: http.Server | null = null
let activeAuthReject: ((reason?: Error) => void) | null = null

/**
 * Initializes a native Puter.js SDK instance with an optional auth token.
 */
export function getNativePuter(authToken?: string) {
  return initPuterSdk(authToken)
}

/**
 * Fetches models natively using Puter.js SDK (puter.ai.listModels()).
 */
export async function fetchPuterModels(authToken?: string): Promise<{
  success: boolean
  models: ProviderModel[]
  error?: string
}> {
  try {
    const puter = getNativePuter(authToken)
    if (!puter || !puter.ai || typeof puter.ai.listModels !== 'function') {
      return {
        success: false,
        models: [],
        error: 'Puter.js AI module is not available'
      }
    }

    const rawModels: Array<Record<string, unknown>> = await puter.ai.listModels()
    if (!Array.isArray(rawModels)) {
      return {
        success: false,
        models: [],
        error: 'Invalid response format from Puter.js'
      }
    }

    const models: ProviderModel[] = []
    for (const item of rawModels) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const id =
        typeof record.id === 'string'
          ? record.id
          : typeof record.puterId === 'string'
            ? record.puterId
            : ''
      if (!id) continue

      const name =
        typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id
      const trusted = isModelTrusted(id)
      models.push({
        id,
        name,
        isTrusted: trusted,
        enabled: trusted
      })
    }

    return {
      success: true,
      models
    }
  } catch (error: unknown) {
    return {
      success: false,
      models: [],
      error: error instanceof Error ? error.message : 'Failed to fetch models from Puter.js'
    }
  }
}

/**
 * Retrieves the authenticated Puter user profile using native Puter.js.
 */
export async function getPuterUser(authToken: string): Promise<PuterUser | null> {
  try {
    const puter = getNativePuter(authToken)
    if (puter && puter.auth && typeof puter.auth.getUser === 'function') {
      const user = await puter.auth.getUser()
      return user || null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Cancels any active browser login flow.
 */
export function cancelPuterLoginFlow(): boolean {
  if (activeAuthServer) {
    try {
      activeAuthServer.close()
    } catch {
      // Ignore close errors
    }
    activeAuthServer = null
  }

  if (activeAuthReject) {
    activeAuthReject(new Error('Login cancelled by user'))
    activeAuthReject = null
  }

  return true
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prism — Puter Connected</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #090a0f;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 40px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(16px);
    }
    .icon-badge {
      width: 68px;
      height: 68px;
      margin: 0 auto 20px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4);
    }
    .icon-badge svg {
      width: 36px;
      height: 36px;
      stroke: #ffffff;
      stroke-width: 3;
      fill: none;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .status-box {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 13px;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>Authentication Successful</h1>
    <p>Your Puter account is now connected to Prism. You can close this tab and return to the application.</p>
    <div class="status-box">
      <span>Connected to Puter.js</span>
    </div>
    <div class="footer">
      Prism — Autonomous AI Development Environment
    </div>
  </div>
</body>
</html>`

/**
 * Starts the browser login flow for Puter.js:
 * 1. Launches a local ephemeral HTTP server on 127.0.0.1.
 * 2. Opens the user's default browser to https://puter.com/?action=authme&redirectURL=...
 * 3. Captures the returned auth token and closes the server.
 * 4. Initializes the native Puter SDK and returns the session.
 */
export function startPuterLoginFlow(guiOrigin: string = 'https://puter.com'): Promise<PuterLoginResult> {
  // Cancel any existing login flow before starting a new one
  cancelPuterLoginFlow()

  return new Promise((resolve) => {
    let timeoutId: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (activeAuthServer) {
        try {
          activeAuthServer.close()
        } catch {
          // ignore
        }
        activeAuthServer = null
      }
      activeAuthReject = null
    }

    activeAuthReject = (err) => {
      cleanup()
      resolve({
        success: false,
        error: err?.message || 'Login was cancelled'
      })
    }

    // Set a 5-minute timeout for the authentication flow
    timeoutId = setTimeout(() => {
      cleanup()
      resolve({
        success: false,
        error: 'Authentication timed out. Please try again.'
      })
    }, 5 * 60 * 1000)

    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1/')
        const token = parsedUrl.searchParams.get('token')

        if (token) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(SUCCESS_HTML)

          cleanup()

          let username: string | undefined
          let userObj: PuterUser | undefined
          try {
            const user = await getPuterUser(token)
            if (user) {
              username = user.username
              userObj = user
            }
          } catch {
            // User info retrieval is optional
          }

          resolve({
            success: true,
            token,
            username,
            user: userObj
          })
          return
        }

        // If no token was provided in the query string
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Missing token in authentication response')
      } catch (err: unknown) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal server error')
        cleanup()
        resolve({
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during authentication'
        })
      }
    })

    activeAuthServer = server

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        cleanup()
        resolve({
          success: false,
          error: 'Failed to bind local authentication listener'
        })
        return
      }

      const port = address.port
      const redirectUrl = `http://127.0.0.1:${port}`
      const authUrl = `${guiOrigin}/?action=authme&redirectURL=${encodeURIComponent(redirectUrl)}`

      // Open user's default browser
      shell.openExternal(authUrl).catch((openErr) => {
        cleanup()
        resolve({
          success: false,
          error: `Could not open default browser: ${openErr instanceof Error ? openErr.message : String(openErr)}`
        })
      })
    })

    server.on('error', (err) => {
      cleanup()
      resolve({
        success: false,
        error: `Authentication server error: ${err.message}`
      })
    })
  })
}
