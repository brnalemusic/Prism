// Simulation for the Hero theme's particle "9".
//
// Single owner of all mutable particle state. Field construction samples the
// glyph SDF (see glyph.ts); physics advances at a fixed 60 Hz step so behavior
// is framerate independent. Presentation modules (renderer.ts) receive the
// Simulation object but never mutate the field.

import { AURA_BAND, HALF_STROKE, sdf9, VISIBLE_W_FACTOR, X_SCALE } from './glyph'

/**
 * Hard GPU buffer capacity (particles). Must exceed the largest field any
 * mode config can generate (STAGE: ~1900 body + aura + sparkles). Fixed
 * capacity means zero reallocation after init — resize rebuilds reuse the
 * same buffers with bufferSubData, so a growing pane can never throw.
 */
export const MAX_PARTICLES = 2600

// Physics (per fixed 60 Hz step — framerate independent).
export const STEP = 1 / 60
export const MAX_STEPS = 3
const RETURN_STIFFNESS = 0.02
const DAMPING = 0.9
/** Per-step amplitude of the idle shimmer (coherent brownian wobble). */
const IDLE_WOBBLE = 0.05

export type HeroMode = 'stage' | 'backdrop'

export interface HeroModeConfig {
  /** Glyph height as a fraction of the canvas height. */
  heightFill: number
  /** Visible glyph width as a fraction of the canvas width. */
  widthCap: number
  gridSteps: number
  /** Target number of body particles (aura/sparkles come on top). */
  particles: number
  auraChance: number
  sparkles: number
  sizeMul: number
  alphaMul: number
  /** Degrees per second of the shared hue cycle. */
  hueSpeed: number
  mouseRadius: number
  mouseForce: number
  mouseDrag: number
  mouseSwirl: number
}

export const MODE_CONFIGS: Record<HeroMode, HeroModeConfig> = {
  stage: {
    heightFill: 0.94,
    widthCap: 0.68,
    gridSteps: 130,
    particles: 1900,
    auraChance: 0.22,
    sparkles: 22,
    sizeMul: 1.2,
    alphaMul: 1,
    hueSpeed: 16,
    mouseRadius: 175,
    mouseForce: 1.4,
    mouseDrag: 0.085,
    mouseSwirl: 0.5
  },
  backdrop: {
    heightFill: 0.8,
    widthCap: 0.55,
    gridSteps: 110,
    particles: 1500,
    auraChance: 0.12,
    sparkles: 10,
    sizeMul: 0.9,
    alphaMul: 0.4,
    hueSpeed: 11,
    mouseRadius: 190,
    mouseForce: 0.62,
    mouseDrag: 0.05,
    mouseSwirl: 0.3
  }
}

export interface HeroParticle {
  hx: number
  hy: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  hue: number
  phase: number
  pulseSpeed: number
  /** 0..1 — brighter/larger on the stroke centerline. */
  depth: number
  sparkle: boolean
}

export type MouseState = {
  x: number
  y: number
  svx: number
  svy: number
  active: boolean
}

export function createMouseState(): MouseState {
  return { x: -9999, y: -9999, svx: 0, svy: 0, active: false }
}

/**
 * Sample the glyph SDF and turn it into a particle field for a canvas box of
 * the given CSS pixel size.
 */
function buildParticles(w: number, h: number, cfg: HeroModeConfig): HeroParticle[] {
  const glyphH = Math.min(h * cfg.heightFill, (cfg.widthCap / VISIBLE_W_FACTOR) * w)
  const glyphW = glyphH * X_SCALE
  const originX = w / 2 - glyphW / 2
  const originY = h / 2 - glyphH / 2
  const step = 1 / cfg.gridSteps

  const inside: Array<{ ux: number; uy: number; depth: number }> = []
  const aura: Array<{ ux: number; uy: number }> = []
  for (let gy = 0; gy < cfg.gridSteps; gy++) {
    for (let gx = 0; gx < cfg.gridSteps; gx++) {
      const ux = (gx + 0.5) * step
      const uy = (gy + 0.5) * step
      const d = sdf9(ux, uy)
      if (d <= 0) {
        inside.push({ ux, uy, depth: Math.min(1, -d / HALF_STROKE) })
      } else if (d <= AURA_BAND && Math.random() < cfg.auraChance) {
        aura.push({ ux, uy })
      }
    }
  }

  const particles: HeroParticle[] = []
  const spawn = (
    ux: number,
    uy: number,
    size: number,
    depth: number,
    sparkle: boolean
  ): void => {
    const hx = originX + ux * glyphW
    const hy = originY + uy * glyphH
    particles.push({
      hx,
      hy,
      x: hx,
      y: hy,
      vx: 0,
      vy: 0,
      size,
      hue: Math.random() * 360,
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.7 + Math.random() * 0.9,
      depth,
      sparkle
    })
  }

  // Body: distribute the target count over the inside cells deterministically
  // (accumulator keeps the total at ~cfg.particles regardless of cell count).
  let acc = 0
  const per = cfg.particles / Math.max(1, inside.length)
  for (const cell of inside) {
    acc += per
    let count = Math.floor(acc)
    acc -= count
    while (count-- > 0) {
      spawn(
        cell.ux + (Math.random() - 0.5) * step * 0.9,
        cell.uy + (Math.random() - 0.5) * step * 0.9,
        cfg.sizeMul * (0.85 + cell.depth * 0.9) * (0.75 + Math.random() * 0.5),
        cell.depth,
        false
      )
    }
  }

  // Edge aura: dim, small particles hovering just outside the stroke.
  for (const cell of aura) {
    spawn(
      cell.ux + (Math.random() - 0.5) * step,
      cell.uy + (Math.random() - 0.5) * step,
      cfg.sizeMul * 0.55 * (0.7 + Math.random() * 0.6),
      0.2,
      false
    )
  }

  // Sparkles: a few larger twinkling stars placed inside the glyph.
  let placed = 0
  let tries = 0
  while (placed < cfg.sparkles && tries < 600) {
    tries++
    const ux = Math.random()
    const uy = Math.random()
    if (sdf9(ux, uy) < -0.02) {
      placed++
      spawn(ux, uy, cfg.sizeMul * (1.7 + Math.random() * 0.9), 1, true)
    }
  }

  return particles
}

export interface Simulation {
  readonly cfg: HeroModeConfig
  readonly particles: HeroParticle[]
  readonly particleCount: number
  /** Shared hue-cycle offset in degrees (renderers read, simulation owns). */
  readonly hueShift: number
  /**
   * Cursor state owned by the simulation; the input layer writes positions
   * into it. Lives here so physics has exactly one state owner.
   */
  readonly mouse: MouseState
  /** Rebuild the field for a new canvas size (keeps the same config). */
  resize(w: number, h: number): void
  /** Advance the fixed-step simulation by `dt` wall-clock seconds. */
  advance(dt: number): void
  /** Settle the simulation synchronously (clock-safe warm start). */
  warm(steps: number): void
}

export function createSimulation(
  mode: HeroMode,
  width: number,
  height: number
): Simulation {
  const cfg = MODE_CONFIGS[mode]
  const mouse = createMouseState()
  let particles = buildParticles(width, height, cfg)
  let acc = 0
  let simTime = 0
  let hueShift = 0

  return {
    cfg,
    mouse,
    get particles(): HeroParticle[] {
      return particles
    },
    get particleCount(): number {
      return Math.min(particles.length, MAX_PARTICLES)
    },
    get hueShift(): number {
      return hueShift
    },
    resize(w: number, h: number): void {
      particles = buildParticles(w, h, cfg)
    },
    advance(dt: number): void {
      acc += dt
      let steps = 0
      while (acc >= STEP && steps < MAX_STEPS) {
        simTime += STEP
        hueShift = (hueShift + cfg.hueSpeed * STEP) % 360
        stepAll(particles, cfg, mouse, simTime)
        acc -= STEP
        steps++
      }
      if (acc > STEP * MAX_STEPS) acc = STEP // drop backlog
    },
    warm(steps: number): void {
      for (let i = 0; i < steps; i++) {
        simTime += STEP
        hueShift = (hueShift + cfg.hueSpeed * STEP) % 360
        stepAll(particles, cfg, mouse, simTime)
      }
    }
  }
}

/** One fixed physics step: spring home, idle wobble, cursor forces, damping. */
function stepAll(
  particles: HeroParticle[],
  cfg: HeroModeConfig,
  mouse: MouseState,
  simTime: number
): void {
  const pushR2 = cfg.mouseRadius * cfg.mouseRadius
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    p.vx += (p.hx - p.x) * RETURN_STIFFNESS
    p.vy += (p.hy - p.y) * RETURN_STIFFNESS
    // Coherent idle wobble: slow per-particle sine drift so the glyph always
    // breathes even with no cursor around (time-based, so fixed stepping
    // keeps it smooth and framerate independent).
    p.vx += Math.sin(simTime / 620 + p.phase) * IDLE_WOBBLE
    p.vy += Math.cos(simTime / 540 + p.phase * 1.3) * IDLE_WOBBLE
    if (mouse.active) {
      const dx = p.x - mouse.x
      const dy = p.y - mouse.y
      const d2 = dx * dx + dy * dy
      if (d2 < pushR2) {
        const dist = Math.sqrt(d2) || 1
        const fall = 1 - dist / cfg.mouseRadius
        const push = fall * fall * cfg.mouseForce
        p.vx += (dx / dist) * push
        p.vy += (dy / dist) * push
        p.vx += mouse.svx * fall * cfg.mouseDrag
        p.vy += mouse.svy * fall * cfg.mouseDrag
        const swirl = fall * fall * cfg.mouseSwirl
        p.vx += (-dy / dist) * swirl
        p.vy += (dx / dist) * swirl
      }
    }
    p.vx *= DAMPING
    p.vy *= DAMPING
    p.x += p.vx
    p.y += p.vy
  }
}
