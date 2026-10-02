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

/**
 * Containment: the canvas clips at its own box, so a particle flung past the
 * edge would vanish mid-glyph and read as a hard black slice through the "9".
 * A soft force wall engages EDGE_SLACK beyond the glyph's home bounds (only
 * particles already outside it, so resting particles feel nothing); a hard
 * clamp at the canvas edge with damped reflection is the absolute backstop.
 * Stiffness matters: the stage glyph sits ~3% below the canvas top, so the
 * wall must stop even a cursor parked on the edge (sustained push ≈ force /
 * WALL_RETURN ≈ 7px of penetration) within that margin. At DAMPING = 0.9 the
 * wall is critically damped — no overshoot, no jitter.
 */
const EDGE_SLACK = 3
const WALL_RETURN = 0.2
const EDGE_INSET = 2
const EDGE_BOUNCE = 0.35
/**
 * Per-step speed cap (px per 60 Hz step). Bounds how far one violent cursor
 * sweep can fling a particle before the walls and home spring take over.
 */
const MAX_SPEED = 20

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
    mouseRadius: 85,
    mouseForce: 0.5,
    mouseDrag: 0.03,
    mouseSwirl: 0.18
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
    mouseRadius: 90,
    mouseForce: 0.25,
    mouseDrag: 0.02,
    mouseSwirl: 0.12
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

/** Axis-aligned bounds of the particles' home positions (glyph extents). */
interface HomeBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function computeHomeBounds(particles: HeroParticle[]): HomeBounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < particles.length; i++) {
    const hx = particles[i].hx
    const hy = particles[i].hy
    if (hx < minX) minX = hx
    if (hx > maxX) maxX = hx
    if (hy < minY) minY = hy
    if (hy > maxY) maxY = hy
  }
  return { minX, maxX, minY, maxY }
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
  width0: number,
  height0: number
): Simulation {
  const cfg = MODE_CONFIGS[mode]
  const mouse = createMouseState()
  let width = width0
  let height = height0
  let particles = buildParticles(width0, height0, cfg)
  let home = computeHomeBounds(particles)
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
      width = w
      height = h
      particles = buildParticles(w, h, cfg)
      home = computeHomeBounds(particles)
    },
    advance(dt: number): void {
      acc += dt
      let steps = 0
      while (acc >= STEP && steps < MAX_STEPS) {
        simTime += STEP
        hueShift = (hueShift + cfg.hueSpeed * STEP) % 360
        stepAll(particles, cfg, mouse, simTime, home, width, height)
        acc -= STEP
        steps++
      }
      if (acc > STEP * MAX_STEPS) acc = STEP // drop backlog
    },
    warm(steps: number): void {
      for (let i = 0; i < steps; i++) {
        simTime += STEP
        hueShift = (hueShift + cfg.hueSpeed * STEP) % 360
        stepAll(particles, cfg, mouse, simTime, home, width, height)
      }
    }
  }
}

/** One fixed physics step: spring home, idle wobble, cursor forces, damping. */
function stepAll(
  particles: HeroParticle[],
  cfg: HeroModeConfig,
  mouse: MouseState,
  simTime: number,
  home: HomeBounds,
  canvasW: number,
  canvasH: number
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
    // Containment: soft force wall just past the glyph's home bounds, so a
    // flung particle decelerates and turns around before reaching the canvas
    // edge (which would clip it — a hard black slice through the glyph).
    const slackL = home.minX - EDGE_SLACK
    const slackR = home.maxX + EDGE_SLACK
    const slackT = home.minY - EDGE_SLACK
    const slackB = home.maxY + EDGE_SLACK
    if (p.x < slackL) p.vx += (slackL - p.x) * WALL_RETURN
    else if (p.x > slackR) p.vx += (slackR - p.x) * WALL_RETURN
    if (p.y < slackT) p.vy += (slackT - p.y) * WALL_RETURN
    else if (p.y > slackB) p.vy += (slackB - p.y) * WALL_RETURN
    p.vx *= DAMPING
    p.vy *= DAMPING
    // Speed cap: bounds the fling a violent sweep can impart.
    const sp2 = p.vx * p.vx + p.vy * p.vy
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const s = MAX_SPEED / Math.sqrt(sp2)
      p.vx *= s
      p.vy *= s
    }
    p.x += p.vx
    p.y += p.vy
    // Hard clamp at the canvas edge: the absolute guarantee that no particle
    // ever renders outside the canvas box (damped reflection keeps the pile
    // from sticking).
    const limR = canvasW - EDGE_INSET
    const limB = canvasH - EDGE_INSET
    if (p.x < EDGE_INSET) {
      p.x = EDGE_INSET
      if (p.vx < 0) p.vx = -p.vx * EDGE_BOUNCE
    } else if (p.x > limR) {
      p.x = limR
      if (p.vx > 0) p.vx = -p.vx * EDGE_BOUNCE
    }
    if (p.y < EDGE_INSET) {
      p.y = EDGE_INSET
      if (p.vy < 0) p.vy = -p.vy * EDGE_BOUNCE
    } else if (p.y > limB) {
      p.y = limB
      if (p.vy > 0) p.vy = -p.vy * EDGE_BOUNCE
    }
  }
}
