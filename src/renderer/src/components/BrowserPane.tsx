import React, { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import {
  GlobeSimple,
  Terminal,
  CaretDown,
  ArrowSquareOut,
  ArrowLeft,
  ArrowRight,
  ArrowClockwise,
  X
} from '@phosphor-icons/react'
import type { BrowserAction } from '../../../shared/types'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }
}

interface ScriptEntry {
  script: string
  result?: string
  timestamp: number
}

interface BrowserPaneProps {
  /** Whether the originating chat tab is currently streaming/processing */
  isAiActive: boolean
  /** Whether this pane is displayed in Split View grid layout */
  isSplitView?: boolean
  /** Unsplits this tab pane from Split View without closing the tab */
  onCloseSplit?: () => void
}

export const BrowserPane = React.memo(function BrowserPane({
  isAiActive,
  isSplitView,
  onCloseSplit
}: BrowserPaneProps) {
  const [currentUrl, setCurrentUrl] = useState<string>('https://google.com')
  const [inputUrl, setInputUrl] = useState<string>('https://google.com')
  const initialUrlRef = useRef<string>('https://google.com')
  const [currentTitle, setCurrentTitle] = useState<string>('')
  const [sessionClosed, setSessionClosed] = useState(false)
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [scriptLogs, setScriptLogs] = useState<ScriptEntry[]>([])
  const [clickRipple, setClickRipple] = useState<{
    x: number
    y: number
    key: number
  } | null>(null)
  const rippleKeyRef = useRef<number>(0)

  const webviewRef = useRef<any>(null)
  const terminalBottomRef = useRef<HTMLDivElement>(null)
  const handledRequestIdsRef = useRef<Set<string>>(new Set())

  // Listen for browser actions from main process
  useEffect(() => {
    const removeListener = window.api.onBrowserAction((action: BrowserAction) => {
      if (action.url && action.url !== 'about:blank') {
        setCurrentUrl(action.url)
        setInputUrl(action.url)
      }
      if (action.title) {
        setCurrentTitle(action.title)
      }
      if (action.type === 'close') {
        setSessionClosed(true)
        return
      }
      if (action.type === 'open') {
        setSessionClosed(false)
      }
      if (action.type === 'click' && action.clickX !== undefined && action.clickY !== undefined) {
        rippleKeyRef.current += 1
        setClickRipple({ x: action.clickX, y: action.clickY, key: rippleKeyRef.current })
        setTimeout(() => setClickRipple(null), 1200)
      }
      if (action.type === 'script' && action.script) {
        setScriptLogs((prev) => [
          ...prev.slice(-49),
          {
            script: action.script!,
            result: action.scriptResult,
            timestamp: action.timestamp
          }
        ])
        setIsTerminalOpen(true)
      }
    })
    return () => removeListener()
  }, [])

  const commandQueueRef = useRef<Promise<void>>(Promise.resolve())

  // Helper to wait for webview reference to be mounted and ready
  const getReadyWebview = useCallback(async (timeoutMs = 3500): Promise<any> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (webviewRef.current) {
        return webviewRef.current
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }, [])

  // Helper to wait for in-flight navigation to settle before executing DOM queries
  const waitForDomSettled = useCallback(async (wv: any, maxMs = 2500) => {
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      try {
        if (!wv.isLoading || !wv.isLoading()) break
      } catch {
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }, [])

  // Helper to execute JS on webview with automatic retry for transient navigation context errors
  const safeExecuteJs = useCallback(async (wv: any, code: string, maxRetries = 2): Promise<any> => {
    let lastError: any = null
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await wv.executeJavaScript(code)
      } catch (err: any) {
        lastError = err
        const msg = String(err?.message || err)
        if (
          msg.includes('Execution context was destroyed') ||
          msg.includes('ERR_ABORTED') ||
          msg.includes('Target closed') ||
          msg.includes('Inspected target navigated')
        ) {
          await new Promise((r) => setTimeout(r, 300))
          continue
        }
        throw err
      }
    }
    throw lastError
  }, [])

  // Listen for AI command execution requests directly on this webview instance
  useEffect(() => {
    const removeExecListener = window.api.onBrowserExecCommand(async ({ requestId, command }) => {
      if (handledRequestIdsRef.current.has(requestId)) return
      handledRequestIdsRef.current.add(requestId)
      if (handledRequestIdsRef.current.size > 200) {
        const first = handledRequestIdsRef.current.values().next().value
        if (first) handledRequestIdsRef.current.delete(first)
      }

      // Enqueue command execution to prevent race conditions and concurrent collisions
      commandQueueRef.current = commandQueueRef.current
        .then(async () => {
          // If session was closed, resurrect it immediately for any non-close command
          if (command.type !== 'close') {
            setSessionClosed(false)
          }

          // Handle health-check ping command
          if (command.type === 'ping') {
            const wv = await getReadyWebview(2000)
            const activeUrl = wv?.getURL ? wv.getURL() || currentUrl : currentUrl
            const activeTitle = wv?.getTitle ? wv.getTitle() || currentTitle : currentTitle
            window.api.sendBrowserExecResult(requestId, {
              success: true,
              isReady: !!wv,
              url: activeUrl,
              title: activeTitle
            })
            return
          }

          // Await webview mount readiness with polling
          const webview = await getReadyWebview(4000)
          if (!webview) {
            window.api.sendBrowserExecResult(
              requestId,
              'Error: AI Browser is initializing or webview is not ready yet. Please try again.'
            )
            return
          }

          try {
            switch (command.type) {
              case 'open':
              case 'navigate': {
                if (command.url) {
                  let target = command.url.trim()
                  if (!/^https?:\/\//i.test(target)) target = 'https://' + target
                  setCurrentUrl(target)
                  setInputUrl(target)
                  try {
                    if (webview.getURL && webview.getURL() !== target) {
                      await webview.loadURL(target)
                    }
                  } catch (loadErr: any) {
                    if (
                      loadErr?.code === 'ERR_ABORTED' ||
                      loadErr?.errno === -3 ||
                      String(loadErr).includes('ERR_ABORTED')
                    ) {
                      console.log('webview.loadURL superseded in-flight load (ERR_ABORTED -3)')
                    } else {
                      throw loadErr
                    }
                  }
                  await waitForDomSettled(webview, 1500)
                  const title = webview.getTitle ? webview.getTitle() || '' : ''
                  window.api.sendBrowserExecResult(
                    requestId,
                    `Navigated to ${target} successfully. Page title: "${title}"`
                  )
                } else {
                  window.api.sendBrowserExecResult(
                    requestId,
                    `Browser session active and ready. Current URL: ${currentUrl}`
                  )
                }
                break
              }

              case 'click': {
                await waitForDomSettled(webview, 2000)
                const elementId = JSON.stringify(command.elementId || '')
                const code = `
                  (() => {
                    const rawId = ${elementId};
                    const el = document.querySelector('[data-prism-id="' + rawId + '"]') ||
                               document.getElementById(rawId) ||
                               document.querySelector(rawId);
                    if (!el) {
                      return {
                        success: false,
                        error: 'Element with ID "' + rawId + '" not found. Please take a fresh browser_snapshot to get updated element IDs.'
                      };
                    }
                    
                    try {
                      el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
                    } catch {}
                    try {
                      if (typeof el.focus === 'function') el.focus();
                    } catch {}

                    const rect = el.getBoundingClientRect();
                    const clientX = rect.left + rect.width / 2;
                    const clientY = rect.top + rect.height / 2;

                    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX, clientY, view: window });
                    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY, view: window });
                    const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX, clientY, view: window });
                    const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX, clientY, view: window });
                    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY, view: window });

                    el.dispatchEvent(pointerDown);
                    el.dispatchEvent(mouseDown);
                    el.dispatchEvent(pointerUp);
                    el.dispatchEvent(mouseUp);
                    el.dispatchEvent(clickEvent);

                    if (typeof el.click === 'function') {
                      try { el.click(); } catch {}
                    }

                    return {
                      success: true,
                      url: window.location.href,
                      title: document.title,
                      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
                      vp: { width: window.innerWidth || 1280, height: window.innerHeight || 720 }
                    };
                  })()
                `
                const res = await safeExecuteJs(webview, code)
                if (res?.success) {
                  if (res.box && res.vp && res.vp.width > 0 && res.vp.height > 0) {
                    rippleKeyRef.current += 1
                    setClickRipple({
                      x: Math.max(0, Math.min(1, (res.box.x + res.box.width / 2) / res.vp.width)),
                      y: Math.max(0, Math.min(1, (res.box.y + res.box.height / 2) / res.vp.height)),
                      key: rippleKeyRef.current
                    })
                    setTimeout(() => setClickRipple(null), 1200)
                  }
                  window.api.sendBrowserExecResult(
                    requestId,
                    `Clicked element ${elementId} successfully. Page title: "${res.title || ''}"`
                  )
                } else {
                  window.api.sendBrowserExecResult(
                    requestId,
                    res?.error || `Error clicking element ${elementId}`
                  )
                }
                break
              }

              case 'type': {
                await waitForDomSettled(webview, 2000)
                const elementId = JSON.stringify(command.elementId || '')
                const text = JSON.stringify(command.text || '')
                const code = `
                  (() => {
                    const rawId = ${elementId};
                    const val = ${text};
                    const el = document.querySelector('[data-prism-id="' + rawId + '"]') ||
                               document.getElementById(rawId) ||
                               document.querySelector(rawId);
                    if (!el) {
                      return {
                        success: false,
                        error: 'Element with ID "' + rawId + '" not found. Please take a fresh browser_snapshot to get updated element IDs.'
                      };
                    }

                    try {
                      el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
                    } catch {}
                    try {
                      if (typeof el.focus === 'function') el.focus();
                    } catch {}

                    // Use prototype descriptor setter for full React/Vue/Angular controlled component compatibility
                    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

                    if (el.tagName === 'INPUT' && nativeInputSetter) {
                      nativeInputSetter.call(el, val);
                    } else if (el.tagName === 'TEXTAREA' && nativeTextAreaSetter) {
                      nativeTextAreaSetter.call(el, val);
                    } else {
                      el.value = val;
                      if (el.isContentEditable) {
                        el.innerText = val;
                      }
                    }

                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { success: true };
                  })()
                `
                const res = await safeExecuteJs(webview, code)
                if (res?.success) {
                  window.api.sendBrowserExecResult(
                    requestId,
                    `Typed text into element ${elementId} successfully.`
                  )
                } else {
                  window.api.sendBrowserExecResult(
                    requestId,
                    res?.error || `Error typing into element ${elementId}`
                  )
                }
                break
              }

              case 'press': {
                const key = command.key || 'Enter'
                const keyJson = JSON.stringify(key)

                // Try native webview input event first
                try {
                  if (typeof webview.sendInputEvent === 'function') {
                    webview.sendInputEvent({ type: 'keyDown', keyCode: key })
                    webview.sendInputEvent({ type: 'char', keyCode: key })
                    webview.sendInputEvent({ type: 'keyUp', keyCode: key })
                  }
                } catch {}

                const code = `
                  (() => {
                    const k = ${keyJson};
                    const active = document.activeElement || document.body;
                    active.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
                    active.dispatchEvent(new KeyboardEvent('keypress', { key: k, code: k, bubbles: true, cancelable: true }));
                    active.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k, bubbles: true, cancelable: true }));
                    
                    if (k === 'Enter' && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                      const form = active.closest('form');
                      if (form && typeof form.requestSubmit === 'function') {
                        try { form.requestSubmit(); } catch {}
                      }
                    }
                    return true;
                  })()
                `
                await safeExecuteJs(webview, code).catch(() => {})
                window.api.sendBrowserExecResult(requestId, `Pressed key "${key}" successfully.`)
                break
              }

              case 'scroll': {
                const dir = command.direction === 'down' ? 1 : -1
                const amount = command.amount ? Number(command.amount) : 500
                const code = `window.scrollBy(0, ${dir * amount})`
                await safeExecuteJs(webview, code)
                window.api.sendBrowserExecResult(
                  requestId,
                  `Scrolled page ${command.direction} successfully.`
                )
                break
              }

              case 'back': {
                if (webview.canGoBack && webview.canGoBack()) {
                  webview.goBack()
                  window.api.sendBrowserExecResult(
                    requestId,
                    'Navigated back in browser history successfully.'
                  )
                } else {
                  window.api.sendBrowserExecResult(requestId, 'Cannot navigate back: no history.')
                }
                break
              }

              case 'script': {
                const scriptCode = command.script || ''
                if (command.url) {
                  let target = command.url.trim()
                  if (!/^https?:\/\//i.test(target)) target = 'https://' + target
                  setCurrentUrl(target)
                  setInputUrl(target)
                  await webview.loadURL(target)
                  await waitForDomSettled(webview, 1500)
                }
                const evalCode = `
                  (async () => {
                    try {
                      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                      const fn = new AsyncFunction(${JSON.stringify(scriptCode)});
                      const res = await fn();
                      if (res !== undefined) return res;
                    } catch {}
                    try { return eval(${JSON.stringify(scriptCode)}); } catch (e) { return 'Error: ' + e.message; }
                  })()
                `
                const scriptRes = await safeExecuteJs(webview, evalCode)
                const resultStr =
                  scriptRes === undefined
                    ? 'undefined (executed successfully)'
                    : typeof scriptRes === 'object'
                      ? JSON.stringify(scriptRes, null, 2)
                      : String(scriptRes)

                setScriptLogs((prev) => [
                  ...prev.slice(-49),
                  { script: scriptCode, result: resultStr, timestamp: Date.now() }
                ])
                setIsTerminalOpen(true)
                window.api.sendBrowserExecResult(requestId, resultStr)
                break
              }

              case 'snapshot': {
                await waitForDomSettled(webview, 1500)
                const isFullJson = JSON.stringify(command.full === true)
                const code = `
                  (() => {
                    const isFull = ${isFullJson};
                    const interactiveElementsSelector =
                      'a, button, input, textarea, select, details, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable="true"]';
                    const interactiveEls = Array.from(document.querySelectorAll(interactiveElementsSelector));

                    let nextId = 1;
                    interactiveEls.forEach((el) => {
                      const rect = el.getBoundingClientRect();
                      if (rect.width > 0 && rect.height > 0) {
                        el.setAttribute('data-prism-id', String(nextId++));
                      }
                    });

                    const isVisible = (el) => {
                      if (!el.getBoundingClientRect) return false;
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0'
                      );
                    };

                    const cleanNode = (node) => {
                      if (node.nodeType === Node.TEXT_NODE) {
                        const val = node.nodeValue ? node.nodeValue.trim() : '';
                        return val ? val : '';
                      }
                      if (node.nodeType !== Node.ELEMENT_NODE) return '';
                      const el = node;
                      if (!isVisible(el)) return '';

                      const tagName = el.tagName.toLowerCase();
                      if (['script', 'style', 'iframe', 'noscript', 'svg', 'path', 'link', 'meta', 'head'].includes(tagName)) return '';

                      const prismId = el.getAttribute('data-prism-id');
                      const idAttr = prismId ? ' data-prism-id="' + prismId + '"' : '';

                      if (['input', 'textarea', 'select'].includes(tagName)) {
                        const idStr = el.id ? ' id="' + el.id + '"' : '';
                        const typeStr = el.getAttribute('type') ? ' type="' + el.getAttribute('type') + '"' : '';
                        const placeholderStr = el.getAttribute('placeholder') ? ' placeholder="' + el.getAttribute('placeholder') + '"' : '';
                        const valStr = el.value ? ' value="' + el.value + '"' : '';
                        return '<' + tagName + idAttr + idStr + typeStr + placeholderStr + valStr + '></' + tagName + '>\\n';
                      }

                      if (tagName === 'button') {
                        const idStr = el.id ? ' id="' + el.id + '"' : '';
                        return '<button' + idAttr + idStr + '>' + (el.innerText ? el.innerText.trim() : '') + '</button>\\n';
                      }

                      if (tagName === 'a') {
                        const idStr = el.id ? ' id="' + el.id + '"' : '';
                        const href = el.getAttribute('href') || '';
                        return '<a' + idAttr + idStr + ' href="' + href + '">' + (el.innerText ? el.innerText.trim() : href) + '</a>\\n';
                      }

                      if (isFull && ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th'].includes(tagName)) {
                        const txt = el.innerText ? el.innerText.trim() : '';
                        if (txt && !el.querySelector('a, button, input, textarea, select')) {
                          return '<' + tagName + idAttr + '>' + txt + '</' + tagName + '>\\n';
                        }
                      }

                      let childrenContent = '';
                      el.childNodes.forEach((child) => {
                        childrenContent += cleanNode(child);
                      });
                      childrenContent = childrenContent.trim();
                      if (childrenContent) {
                        return '<' + tagName + idAttr + '>\\n' + childrenContent + '\\n</' + tagName + '>\\n';
                      }
                      return '';
                    };

                    const pageUrl = window.location.href;
                    const pageTitle = document.title;
                    const bodyContent = cleanNode(document.body);
                    return '[Current Page URL: ' + pageUrl + ']\\n[Current Page Title: ' + pageTitle + ']\\n\\n' + bodyContent;
                  })()
                `
                const domText = await safeExecuteJs(webview, code)
                window.api.sendBrowserExecResult(
                  requestId,
                  typeof domText === 'string' ? domText : JSON.stringify(domText)
                )
                break
              }

              case 'screenshot': {
                let base64: string | undefined
                let width: number | undefined
                let height: number | undefined
                let byteLength: number | undefined
                try {
                  if (webview.capturePage) {
                    const image = await webview.capturePage()
                    const { width: sourceWidth, height: sourceHeight } = image.getSize()
                    const visionImage =
                      Math.max(sourceWidth, sourceHeight) > 1440
                        ? sourceWidth >= sourceHeight
                          ? image.resize({ width: 1440, quality: 'best' })
                          : image.resize({ height: 1440, quality: 'best' })
                        : image
                    const size = visionImage.getSize()
                    width = size.width
                    height = size.height
                    const encoded = visionImage.toJPEG(80)
                    byteLength = encoded.length
                    base64 = encoded.toString('base64')
                  }
                } catch {}
                window.api.sendBrowserExecResult(requestId, {
                  result: 'Screenshot captured successfully.',
                  base64,
                  mimeType: 'image/jpeg',
                  width,
                  height,
                  byteLength
                })
                break
              }

              case 'close': {
                setSessionClosed(true)
                window.api.sendBrowserExecResult(requestId, 'Browser session closed.')
                break
              }

              default:
                window.api.sendBrowserExecResult(requestId, `Unknown command: ${command.type}`)
            }
          } catch (err: any) {
            window.api.sendBrowserExecResult(requestId, `Error: ${err?.message || String(err)}`)
          }
        })
        .catch((err) => {
          window.api.sendBrowserExecResult(
            requestId,
            `Error executing command: ${err?.message || String(err)}`
          )
        })
    })

    return () => removeExecListener()
  }, [getReadyWebview, waitForDomSettled, safeExecuteJs, currentUrl, currentTitle])

  // Sync webview navigation events with address bar state
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleNavigate = (e: any) => {
      const url = e.url
      if (url && url !== 'about:blank') {
        setCurrentUrl(url)
        setInputUrl(url)
      }
    }

    const handleTitle = (e: any) => {
      if (e.title) setCurrentTitle(e.title)
    }

    const handleFailLoad = (e: any) => {
      if (e.errorCode === -3 || e.errorDescription === 'ERR_ABORTED') {
        return
      }
      console.warn('Webview load warning:', e.errorCode, e.errorDescription, e.validatedURL)
    }

    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('page-title-updated', handleTitle)
    webview.addEventListener('did-fail-load', handleFailLoad)

    return () => {
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('page-title-updated', handleTitle)
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [])

  useEffect(() => {
    if (isTerminalOpen && terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [scriptLogs, isTerminalOpen])

  const handleNavigateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let target = inputUrl.trim()
    if (!target) return
    if (!/^https?:\/\//i.test(target)) {
      target = 'https://' + target
    }
    setSessionClosed(false)
    setCurrentUrl(target)
    setInputUrl(target)
    setTimeout(() => {
      if (webviewRef.current) {
        webviewRef.current.loadURL(target).catch(() => {})
      }
    }, 50)
  }

  const handleGoBack = () => {
    setSessionClosed(false)
    if (webviewRef.current && webviewRef.current.canGoBack()) {
      webviewRef.current.goBack()
    }
  }

  const handleGoForward = () => {
    setSessionClosed(false)
    if (webviewRef.current && webviewRef.current.canGoForward()) {
      webviewRef.current.goForward()
    }
  }

  const handleReload = () => {
    setSessionClosed(false)
    setTimeout(() => {
      if (webviewRef.current) {
        webviewRef.current.reload()
      }
    }, 50)
  }

  const handleOpenInSystemBrowser = useCallback(() => {
    if (currentUrl) {
      window.open(currentUrl, '_blank')
    }
  }, [currentUrl])

  return (
    <div
      onPointerDown={() => window.api.resetBrowserIdle()}
      onKeyDown={() => window.api.resetBrowserIdle()}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-black select-none"
    >
      {/* Outer Glow Border ring when AI is active (center is 100% masked/transparent) */}
      {isAiActive && (
        <div
          className="absolute inset-0 z-30 rounded-xl p-[2px] pointer-events-none"
          style={{
            background:
              'linear-gradient(var(--prism-angle, 0deg), transparent, var(--accent-primary), transparent)',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'prism-border-spin 2.5s linear infinite'
          }}
        />
      )}

      {/* Browser Controls Header */}
      <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-[var(--border-default)] bg-[var(--surface-lowest)] px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={handleGoBack}
            disabled={isAiActive}
            title="Back"
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <ArrowLeft size={13} />
          </button>
          <button
            onClick={handleGoForward}
            disabled={isAiActive}
            title="Forward"
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <ArrowRight size={13} />
          </button>
          <button
            onClick={handleReload}
            disabled={isAiActive}
            title="Reload"
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <ArrowClockwise size={13} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (isAiActive) return
            handleNavigateSubmit(e)
          }}
          className="flex-1 flex items-center min-w-0"
          title={
            isAiActive
              ? 'Navigation is locked while AI is controlling browser'
              : currentTitle || 'Current Page'
          }
        >
          <div
            className={clsx(
              'flex items-center gap-2 w-full px-2.5 py-1 rounded-lg border transition-colors',
              isAiActive
                ? 'bg-black border-[var(--border-subtle)] opacity-60 cursor-not-allowed'
                : 'bg-black border-[var(--border-default)] focus-within:border-accent-primary/50'
            )}
          >
            <GlobeSimple size={13} className="text-text-secondary shrink-0" />
            <input
              type="text"
              value={inputUrl}
              disabled={isAiActive}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Enter URL..."
              className="w-full bg-transparent text-[12px] text-text-primary placeholder:text-text-secondary/40 font-mono focus:outline-none disabled:cursor-not-allowed"
            />
          </div>
        </form>

        {currentUrl && (
          <button
            onClick={handleOpenInSystemBrowser}
            disabled={isAiActive}
            title="Open in system browser"
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 cursor-pointer"
          >
            <ArrowSquareOut size={13} />
          </button>
        )}

        {scriptLogs.length > 0 && (
          <button
            onClick={() => setIsTerminalOpen((v) => !v)}
            title="Toggle script terminal"
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer',
              isTerminalOpen
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            )}
          >
            <Terminal size={12} />
            <span>{scriptLogs.length}</span>
            <CaretDown
              size={10}
              className={clsx('transition-transform duration-200', isTerminalOpen && 'rotate-180')}
            />
          </button>
        )}

        {/* Unsplit button when in Split View */}
        {isSplitView && onCloseSplit && (
          <button
            onClick={onCloseSplit}
            title="Leave split view (keep tab open)"
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all duration-150 cursor-pointer ml-1"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Floating AI Controlling Badge */}
      {isAiActive && (
        <div className="absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-black px-3 py-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent-primary animate-pulse" />
          <span className="text-[11px] font-medium text-white/80 whitespace-nowrap">
            AI is controlling this browser session
          </span>
        </div>
      )}

      {/* Main Webview Container */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {sessionClosed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-black text-text-secondary">
            <GlobeSimple size={32} className="opacity-30" />
            <span className="text-sm font-medium opacity-50">Browser session closed</span>
            <button
              onClick={() => {
                setSessionClosed(false)
                setTimeout(() => {
                  if (webviewRef.current) {
                    webviewRef.current.loadURL(currentUrl || 'https://google.com').catch(() => {})
                  }
                }, 50)
              }}
              className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-lowest)] hover:bg-white/[0.06] text-xs font-medium text-text-primary transition-colors cursor-pointer"
            >
              <ArrowClockwise size={13} />
              <span>Reopen Browser Session</span>
            </button>
          </div>
        ) : (
          <div className="relative w-full h-full">
            <webview
              ref={webviewRef}
              src={initialUrlRef.current}
              partition="persist:prism-ai-browser"
              className="w-full h-full border-none bg-white"
              allowpopups={true}
            />

            {/* Click Ripple Effect for AI actions */}
            {clickRipple && (
              <div
                key={clickRipple.key}
                className="absolute pointer-events-none z-20"
                style={{
                  left: `${clickRipple.x * 100}%`,
                  top: `${clickRipple.y * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div
                  className="absolute rounded-full bg-accent-primary/90"
                  style={{
                    width: 10,
                    height: 10,
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />
                <div
                  className="absolute rounded-full border-2 border-accent-primary/60"
                  style={{
                    width: 36,
                    height: 36,
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    animation: 'browser-ripple 0.9s ease-out forwards'
                  }}
                />
              </div>
            )}

            {/* Transparent Interaction Lock overlay ONLY when AI is active */}
            {isAiActive && (
              <div className="absolute inset-0 bg-transparent cursor-not-allowed z-20" />
            )}
          </div>
        )}
      </div>

      {/* Script Log Terminal Drawer */}
      {isTerminalOpen && scriptLogs.length > 0 && (
        <div className="z-10 max-h-[200px] shrink-0 overflow-y-auto border-t border-[var(--border-default)] bg-black">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border-subtle)] bg-black px-3 py-2">
            <Terminal size={12} className="text-accent-primary/70" />
            <span className="text-[11px] font-mono font-semibold text-accent-primary/70 uppercase tracking-wider">
              Script Log
            </span>
          </div>
          <div className="p-2 space-y-2">
            {scriptLogs.map((entry, i) => (
              <div
                key={i}
                className="rounded-md bg-white/[0.02] border border-white/[0.04] p-2 space-y-1"
              >
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] font-mono text-accent-secondary/70 shrink-0 mt-0.5 select-none">
                    {'>'}
                  </span>
                  <pre className="text-[10px] font-mono text-text-primary/80 whitespace-pre-wrap break-all leading-relaxed overflow-hidden select-text">
                    {entry.script}
                  </pre>
                </div>
                {entry.result !== undefined && (
                  <div className="flex items-start gap-1.5 pl-3.5">
                    <span className="text-[10px] font-mono text-text-secondary/50 shrink-0 mt-0.5 select-none">
                      {'<'}
                    </span>
                    <pre
                      className={clsx(
                        'text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed overflow-hidden select-text',
                        entry.result?.startsWith('Error') ? 'text-red-400/80' : 'text-green-400/70'
                      )}
                    >
                      {entry.result}
                    </pre>
                  </div>
                )}
              </div>
            ))}
            <div ref={terminalBottomRef} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes prism-border-spin {
          from { --prism-angle: 0deg; }
          to   { --prism-angle: 360deg; }
        }
        @keyframes browser-ripple {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.2); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
        }
      `}</style>
    </div>
  )
})
