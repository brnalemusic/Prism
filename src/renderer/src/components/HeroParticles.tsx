// HeroParticles — the Hero theme's signature "9" made of light particles.
//
// This file is React wiring only: mouse tracking, the rAF loop, visibility
// pausing and resize handling. The glyph math lives in hero/glyph.ts, the
// field + physics in hero/simulation.ts, and the GPU/canvas drawing in
// hero/renderer.ts.
//
// Behavior notes:
//  - The simulation is warm-started synchronously before the canvas fades in,
//    so the glyph appears fully formed (no visible "physics loading" phase).
//  - The rAF loop stops when the canvas is hidden, offscreen or the tab is
//    backgrounded (IntersectionObserver + visibilitychange).
//  - Exports HeroAccentDriver (mounted app-wide in App.tsx), which rotates
//    the --hero-accent CSS variables on a throttled interval.

import React, { useEffect, useRef, useState } from 'react'
import { createHeroRenderer, type HeroRenderer } from '../hero/renderer'
import { createSimulation, type Simulation } from '../hero/simulation'

/**
 * Rotates the shared `--hero-accent` CSS variables so every themed surface
 * breathes through the same hue orbit. Mounted app-wide by App.tsx. Uses a
 * throttled interval (no rAF) so it never competes with the render loop.
 */
export function HeroAccentDriver(): React.JSX.Element {
  useEffect(() => {
    const root = document.documentElement
    let elapsed = 0
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      elapsed += dt
      const h1 = (elapsed * 8) % 360
      const h2 = (elapsed * 8 + 140) % 360
      root.style.setProperty('--hero-accent', `hsl(${h1.toFixed(1)} 90% 62%)`)
      root.style.setProperty('--hero-accent-2', `hsl(${h2.toFixed(1)} 85% 66%)`)
    }, 140)
    return () => {
      window.clearInterval(id)
      root.style.removeProperty('--hero-accent')
      root.style.removeProperty('--hero-accent-2')
    }
  }, [])

  return <></>
}

/**
 * The interactive particle "9".
 *
 * @param mode "stage"    — bright centerpiece for the chat landing state.
 *             "backdrop" — dim ambient layer behind an active conversation.
 */
export function HeroParticles({
  mode
}: {
  mode: 'stage' | 'backdrop'
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [fadedIn, setFadedIn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect0 = canvas.getBoundingClientRect()
    if (rect0.width < 4 || rect0.height < 4) return

    const sim: Simulation = createSimulation(mode, rect0.width, rect0.height)

    // ---- Mouse input: window-level (the canvas is pointer-transparent) ----
    const mouse = sim.mouse
    const onMove = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const nextX = e.clientX - rect.left
      const nextY = e.clientY - rect.top
      // Ignore the cursor outside the canvas box: the listener is
      // window-level (the canvas is pointer-transparent), so without this
      // the glyph would react even when the mouse is far away from it.
      if (nextX < 0 || nextY < 0 || nextX > rect.width || nextY > rect.height) {
        mouse.active = false
        return
      }
      if (mouse.active) {
        // Smoothed cursor velocity for the fluid drag term.
        mouse.svx = mouse.svx * 0.7 + (nextX - mouse.x) * 0.3
        mouse.svy = mouse.svy * 0.7 + (nextY - mouse.y) * 0.3
      }
      // First move after (re)activation: reset the origin instead of diffing
      // against the offscreen sentinel (which would blast every particle
      // with a huge synthetic velocity).
      mouse.x = nextX
      mouse.y = nextY
      mouse.active = true
    }
    const onLeave = (): void => {
      mouse.active = false
    }
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)

    // ---- Renderer + clock-safe warm start ----------------------------------
    let renderer: HeroRenderer | null = null
    const buildRenderer = (): void => {
      renderer?.destroy()
      renderer = createHeroRenderer(canvas, sim)
      renderer.syncField()
      sim.warm(90) // 90 steps = 1.5 s of settled physics before first paint
    }
    buildRenderer()

    // ---- Render loop with visibility pausing -------------------------------
    let raf = 0
    let running = false
    let last = performance.now()
    const frame = (now: number): void => {
      sim.advance(Math.min(0.25, Math.max(0, (now - last) / 1000)))
      last = now
      renderer?.frame(now)
      raf = requestAnimationFrame(frame)
    }
    const start = (): void => {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const stop = (): void => {
      if (!running) return
      running = false
      cancelAnimationFrame(raf)
    }

    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) start()
      else stop()
    })
    io.observe(canvas)
    const onVis = (): void => {
      if (document.hidden) stop()
      else start()
    }
    document.addEventListener('visibilitychange', onVis)

    const onLost = (e: Event): void => {
      e.preventDefault()
      stop()
    }
    const onRestored = (): void => {
      buildRenderer()
      start()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    // ---- Rebuild the field when the pane resizes (split-view safe) ---------
    let roPending = false
    const ro = new ResizeObserver(() => {
      if (roPending) return
      roPending = true
      requestAnimationFrame(() => {
        roPending = false
        // Re-read the live size: panes can shrink below the threshold before
        // this frame runs, and the simulation would keep clamping particle
        // coordinates far outside the tiny canvas.
        const rect = canvas.getBoundingClientRect()
        if (rect.width < 4 || rect.height < 4) return
        sim.resize(rect.width, rect.height)
        renderer?.syncField()
      })
    })
    ro.observe(canvas)

    start()
    requestAnimationFrame(() => requestAnimationFrame(() => setFadedIn(true)))

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      renderer?.destroy()
    }
  }, [mode])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full select-none transition-opacity duration-700 ease-out"
      style={{ pointerEvents: 'none', opacity: fadedIn ? 1 : 0 }}
    />
  )
}
