// Prism Arcade — the Prism 9 easter egg.
//
// Nine tiny, self-contained mini-games, one for each version digit of Prism 9.
// Every game is simple and 2D, competitive (a clear score chase) and beatable
// with an explicit target. Beating all nine permanently unlocks the Hero
// theme: the RGB "9" particle background takes over the workspace and the
// hero title disappears.
//
// Design rules kept throughout: pointer-first input, generous hit boxes,
// no audio, no assets, no dependencies. Canvas engines draw on a transparent
// layer above a shared decorative backdrop, so every game shares the same
// arcade atmosphere.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowCounterClockwise,
  CaretLeft,
  CheckCircle,
  SealCheck,
  Confetti,
  Medal,
  GameController,
  Trophy
} from '@phosphor-icons/react'

const TOTAL_GAMES = 9

interface GameSummary {
  id: string
  title: string
  tagline: string
  goal: string
  /** Score that counts the game as beaten. */
  target: number
  /** Formatted display for the target score. */
  targetLabel: string
  /** Unit appended to live scores in the HUD. */
  unit: string
  accent: string
  hint: string
}

const GAME_SUMMARIES: GameSummary[] = [
  {
    id: 'reflex',
    title: 'Photon Reflex',
    tagline: 'Strike targets inside a shrinking light window.',
    goal: 'Clear 9 targets before the timer runs out.',
    target: 9,
    targetLabel: '9 hits',
    unit: 'hits',
    accent: '#38bdf8',
    hint: 'Every hit adds a moment of time. The clock only moves forward.'
  },
  {
    id: 'snake',
    title: 'Data Serpent',
    tagline: 'Classic trail growth inside a tight grid.',
    goal: 'Eat 9 data bits without biting your own tail.',
    target: 9,
    targetLabel: '9 bits',
    unit: 'bits',
    accent: '#4ade80',
    hint: 'Arrows or WASD. Every bit also adds two seconds to the clock.'
  },
  {
    id: 'breakout',
    title: 'Brick Cascade',
    tagline: 'One paddle, one ball, zero mercy.',
    goal: 'Destroy 9 bricks with only 3 lives.',
    target: 9,
    targetLabel: '9 bricks',
    unit: 'bricks',
    accent: '#fb923c',
    hint: 'The paddle follows your cursor. Missing the ball costs a life.'
  },
  {
    id: 'dodge',
    title: 'Drift Vector',
    tagline: 'Weave the dot through rising debris.',
    goal: 'Survive 9 seconds without touching anything.',
    target: 9,
    targetLabel: '9 s',
    unit: 's',
    accent: '#a78bfa',
    hint: 'The dot trails your cursor with a little lag. Commit early.'
  },
  {
    id: 'precision',
    title: 'Aperture',
    tagline: 'Stop the sweeping tick inside the ring.',
    goal: 'Nail 9 stops in a row. One miss ends the run.',
    target: 9,
    targetLabel: '9 stops',
    unit: 'stops',
    accent: '#f472b6',
    hint: 'Space or click to stop the tick. The zone narrows every hit.'
  },
  {
    id: 'memory',
    title: 'Echo Matrix',
    tagline: 'Repeat the grid flashes before they fade.',
    goal: 'Repeat a sequence of length 9 without a mistake.',
    target: 9,
    targetLabel: '9 steps',
    unit: 'steps',
    accent: '#22d3ee',
    hint: 'Watch the flashes, then repeat. One wrong tile ends the run.'
  },
  {
    id: 'stack',
    title: 'Light Stack',
    tagline: 'Drop slices on the tower before it wobbles.',
    goal: 'Stack 9 blocks without missing.',
    target: 9,
    targetLabel: '9 blocks',
    unit: 'blocks',
    accent: '#facc15',
    hint: 'Space or click to drop. Each slice speeds up as you climb.'
  },
  {
    id: 'type',
    title: 'Glyph Rush',
    tagline: 'Type the glyphs before they reach the line.',
    goal: 'Type 9 glyphs without losing all 3 cores.',
    target: 9,
    targetLabel: '9 glyphs',
    unit: 'glyphs',
    accent: '#34d399',
    hint: 'Press the letter you see. Each glyph that lands costs a core.'
  },
  {
    id: 'orbit',
    title: 'Orbit Trap',
    tagline: 'Carve the ring, herd the particles, hold them in.',
    goal: 'Trap 9 particles before time runs out. 3 escapes void the run.',
    target: 9,
    targetLabel: '9 trapped',
    unit: 'trapped',
    accent: '#f87171',
    hint: 'Drag to shrink the ring and trap particles. Escapes cost time; 3 void the run.'
  }
]

type Phase = 'playing' | 'won' | 'lost'

interface FloatingScore {
  id: number
  text: string
  x: number
  y: number
  color: string
}

interface GameFrameProps {
  width: number
  height: number
  phase: Phase
  /** Live score updates for the HUD. */
  onScore: (score: number) => void
  /** End the run. */
  finish: (won: boolean, finalScore: number) => void
  /** Spawn a small floating label at game coordinates. */
  pushText: (text: string, x: number, y: number, color: string) => void
}

// ─────────────────────────────────────────────────────────────
// Shared canvas helpers
// ─────────────────────────────────────────────────────────────

function drawNeonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size = 14,
  weight = '700'
): void {
  ctx.font = `${weight} ${size}px ui-monospace, 'Cascadia Code', Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.shadowBlur = 0
}

function drawOverlayText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: string[]
): void {
  ctx.fillStyle = 'rgba(3,7,18,0.55)'
  ctx.fillRect(0, 0, width, height)
  const startY = height / 2 - (lines.length - 1) * 20
  lines.forEach((line, i) => {
    drawNeonText(
      ctx,
      line,
      width / 2,
      startY + i * 40,
      i === 0 ? '#ffffff' : 'rgba(255,255,255,0.8)',
      i === 0 ? 26 : 14,
      i === 0 ? '700' : '500'
    )
  })
}
void drawOverlayText

/** Underlay shown behind every game: dotted grid + faint vignette. */
function drawArcadeBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = '#05070f'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255,255,255,0.045)'
  for (let gx = 20; gx < width; gx += 46) {
    for (let gy = 20; gy < height; gy += 46) {
      ctx.fillRect(gx, gy, 2, 2)
    }
  }
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

interface AmbientParticle {
  x: number
  y: number
  size: number
  speed: number
  phase: number
  hue: number
}

function makeAmbientParticles(count: number, width: number, height: number): AmbientParticle[] {
  const particles: AmbientParticle[] = []
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1.5 + Math.random() * 2.5,
      speed: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      hue: Math.random() * 360
    })
  }
  return particles
}

function drawAmbientParticles(
  ctx: CanvasRenderingContext2D,
  particles: AmbientParticle[],
  width: number,
  height: number,
  time: number
): void {
  ctx.save()
  for (const p of particles) {
    p.y -= p.speed
    if (p.y < -8) {
      p.y = height + 8
      p.x = Math.random() * width
    }
    ctx.globalAlpha = 0.22 + Math.sin(time * 2 + p.phase) * 0.12
    ctx.fillStyle = `hsl(${p.hue} 90% 65%)`
    ctx.shadowColor = ctx.fillStyle
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Count-down timer hook shared by timed games. */
function useCountdown(
  running: boolean,
  initialSeconds: number,
  onExpire: () => void
): { timeLeft: number; addTime: (seconds: number) => void } {
  const [timeLeft, setTimeLeft] = useState(initialSeconds)
  const deadlineRef = useRef(0)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  // Deadline initialization lives in an effect: refs must not be touched
  // during render. Declared before the timer effect so it runs first.
  useEffect(() => {
    if (deadlineRef.current === 0) {
      deadlineRef.current = Date.now() + initialSeconds * 1000
    }
    onExpireRef.current = onExpire
  })

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      const remaining = Math.max(0, (deadlineRef.current - Date.now()) / 1000)
      setTimeLeft(remaining)
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current()
      }
    }, 100)
    return () => clearInterval(timer)
  }, [running])

  const addTime = useCallback((seconds: number): void => {
    deadlineRef.current += seconds * 1000
  }, [])

  return { timeLeft, addTime }
}

// ─────────────────────────────────────────────────────────────
// 1 ── Photon Reflex
// ─────────────────────────────────────────────────────────────

function PhotonReflex({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const [targets, setTargets] = useState<Array<{ id: number; x: number; y: number; r: number }>>([])
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const nextIdRef = useRef(1)

  const { timeLeft, addTime } = useCountdown(phase === 'playing', 10, () => {
    if (!finishedRef.current) {
      finishedRef.current = true
      finish(false, scoreRef.current)
    }
  })

  useEffect(() => {
    if (phase !== 'playing') return
    const spawn = (): void => {
      setTargets((prev) => {
        if (prev.length >= 2) return prev
        return [
          ...prev,
          {
            id: nextIdRef.current++,
            x: 60 + Math.random() * (width - 120),
            y: 120 + Math.random() * (height - 190),
            r: 26
          }
        ]
      })
    }
    const id = setInterval(spawn, 750)
    spawn()
    return () => clearInterval(id)
  }, [phase, width, height])

  const handleHit = (target: { id: number; x: number; y: number }, e: React.MouseEvent): void => {
    if (finishedRef.current) return
    e.stopPropagation()
    setTargets((prev) => prev.filter((t) => t.id !== target.id))
    scoreRef.current += 1
    onScore(scoreRef.current)
    addTime(0.7)
    pushText('+1', target.x, target.y, '#38bdf8')
    if (scoreRef.current >= 9) {
      finishedRef.current = true
      finish(true, scoreRef.current)
    }
  }

  return (
    <div className="absolute inset-0" style={{ cursor: 'crosshair' }}>
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          onMouseDown={(e) => handleHit(target, e)}
          className="absolute rounded-full"
          style={{
            left: target.x - target.r,
            top: target.y - target.r,
            width: target.r * 2,
            height: target.r * 2,
            background:
              'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(56,189,248,0.9) 45%, rgba(56,189,248,0.05) 75%)',
            border: '2px solid rgba(56,189,248,0.9)',
            boxShadow: '0 0 18px rgba(56,189,248,0.75)',
            animation: 'hero-pulse 1.2s ease-in-out infinite',
            cursor: 'crosshair'
          }}
          title="Hit"
        />
      ))}
      <div className="pointer-events-none absolute inset-x-0 top-[86px] text-center font-mono text-sm">
        <span className={timeLeft <= 3 ? 'font-bold text-[#ff5f6d]' : 'text-white/70'}>
          {timeLeft.toFixed(1)}s
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 2 ── Data Serpent (canvas)
// ─────────────────────────────────────────────────────────────

const SNAKE_CELL = 22

function DataSerpent({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const stateRef = useRef({
    cells: [{ x: 6, y: 6 }],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: { x: 12, y: 6 },
    stepAccum: 0,
    lastFrame: 0
  })

  const cols = Math.max(10, Math.floor(width / SNAKE_CELL))
  const rows = Math.max(8, Math.floor((height - 40) / SNAKE_CELL))

  const { timeLeft, addTime } = useCountdown(phase === 'playing', 20, () => {
    if (!finishedRef.current) {
      finishedRef.current = true
      finish(false, scoreRef.current)
    }
  })

  const turn = useCallback((dx: number, dy: number): void => {
    const state = stateRef.current
    if (state.dir.x === -dx && state.dir.y === -dy) return
    if ((dx !== 0 && state.dir.x === dx) || (dy !== 0 && state.dir.y === dy)) return
    state.nextDir = { x: dx, y: dy }
  }, [])

  const placeFood = useCallback((): void => {
    const state = stateRef.current
    let next = state.food
    for (let guard = 0; guard < 60; guard++) {
      next = {
        x: 1 + Math.floor(Math.random() * (cols - 2)),
        y: 1 + Math.floor(Math.random() * (rows - 2))
      }
      if (!state.cells.some((c) => c.x === next.x && c.y === next.y)) break
    }
    state.food = next
  }, [cols, rows])

  useEffect(() => {
    if (phase !== 'playing') return
    placeFood()
  }, [phase, placeFood])

  useEffect(() => {
    if (phase !== 'playing') return
    const onKey = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase()
      if (key === 'arrowup' || key === 'w') {
        e.preventDefault()
        turn(0, -1)
      } else if (key === 'arrowdown' || key === 's') {
        e.preventDefault()
        turn(0, 1)
      } else if (key === 'arrowleft' || key === 'a') {
        e.preventDefault()
        turn(-1, 0)
      } else if (key === 'arrowright' || key === 'd') {
        e.preventDefault()
        turn(1, 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, turn])

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const state = stateRef.current
    state.cells = [{ x: 4, y: Math.floor(rows / 2) }]
    state.dir = { x: 1, y: 0 }
    state.nextDir = { x: 1, y: 0 }
    state.stepAccum = 0
    state.lastFrame = performance.now()

    let raf = 0
    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(100, now - state.lastFrame)
      state.lastFrame = now

      if (!finishedRef.current) {
        state.stepAccum += dt
        while (state.stepAccum >= 115 && !finishedRef.current) {
          state.stepAccum -= 115
          state.dir = state.nextDir
          const head = { x: state.cells[0].x + state.dir.x, y: state.cells[0].y + state.dir.y }
          const hitWall = head.x <= 0 || head.y <= 0 || head.x >= cols - 1 || head.y >= rows - 1
          const hitSelf = state.cells.some((c) => c.x === head.x && c.y === head.y)
          if (hitWall || hitSelf) {
            finishedRef.current = true
            finish(false, scoreRef.current)
            break
          }
          state.cells.unshift(head)
          if (head.x === state.food.x && head.y === state.food.y) {
            scoreRef.current += 1
            onScore(scoreRef.current)
            addTime(2)
            pushText('+1', head.x * SNAKE_CELL + 11, head.y * SNAKE_CELL + 11, '#4ade80')
            if (scoreRef.current >= 9) {
              finishedRef.current = true
              finish(true, scoreRef.current)
              break
            }
            placeFood()
          } else {
            state.cells.pop()
          }
        }
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      const offsetX = (width - cols * SNAKE_CELL) / 2
      const offsetY = (height - rows * SNAKE_CELL) / 2 + 14

      ctx.strokeStyle = 'rgba(255,255,255,0.09)'
      ctx.lineWidth = 1
      ctx.strokeRect(offsetX, offsetY, cols * SNAKE_CELL, rows * SNAKE_CELL)

      const fx = offsetX + state.food.x * SNAKE_CELL + SNAKE_CELL / 2
      const fy = offsetY + state.food.y * SNAKE_CELL + SNAKE_CELL / 2
      const pulse = 4 + Math.sin(now / 180) * 1.4
      ctx.shadowColor = '#4ade80'
      ctx.shadowBlur = 14
      ctx.fillStyle = 'rgba(74,222,128,0.95)'
      ctx.beginPath()
      ctx.arc(fx, fy, pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      state.cells.forEach((cell, i) => {
        const cx = offsetX + cell.x * SNAKE_CELL + SNAKE_CELL / 2
        const cy = offsetY + cell.y * SNAKE_CELL + SNAKE_CELL / 2
        const isHead = i === 0
        ctx.fillStyle = isHead ? 'rgba(255,255,255,0.95)' : `rgba(74,222,128,${0.75 - i * 0.03})`
        ctx.shadowColor = '#4ade80'
        ctx.shadowBlur = isHead ? 12 : 4
        ctx.beginPath()
        ctx.roundRect(cx - 8, cy - 8, 16, 16, isHead ? 6 : 4)
        ctx.fill()
      })
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, width, height, cols, rows, finish, onScore, addTime, pushText, placeFood])

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-[86px] text-center font-mono text-sm text-white/70">
        {timeLeft.toFixed(1)}s · arrows / WASD
      </div>
      {phase === 'playing' && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
          {(
            [
              ['↑', 0, -1],
              ['↓', 0, 1],
              ['←', -1, 0],
              ['→', 1, 0]
            ] as Array<[string, number, number]>
          ).map(([label, dx, dy]) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                turn(dx, dy)
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] font-mono text-sm text-white/80 transition-all hover:bg-white/[0.14] active:scale-90"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 3 ── Brick Cascade (canvas)
// ─────────────────────────────────────────────────────────────

function BrickCascade({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const scoreRef = useRef(0)
  const livesRef = useRef(3)
  const finishedRef = useRef(false)
  const paddleRef = useRef(width / 2)
  const ballRef = useRef({ x: width / 2, y: height - 120, vx: 2.4, vy: -3.6, stuck: true })
  const [lives, setLives] = useState(3)

  const brickLayout = useCallback(
    (id: number): { x: number; y: number; w: number; h: number } => {
      const bricksPerRow = 4
      const col = id % bricksPerRow
      const row = Math.floor(id / bricksPerRow)
      const brickW = Math.min(150, (width - 140) / bricksPerRow)
      const brickH = 26
      const startX = (width - (brickW * bricksPerRow + (bricksPerRow - 1) * 14)) / 2
      const startY = 130
      return { x: startX + col * (brickW + 14), y: startY + row * (brickH + 12), w: brickW, h: brickH }
    },
    [width]
  )

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    scoreRef.current = 0
    livesRef.current = 3
    setLives(3)
    finishedRef.current = false
    paddleRef.current = width / 2
    ballRef.current = { x: width / 2, y: height - 120, vx: 2.4, vy: -3.6, stuck: true }
    onScore(0)

    const alive = new Set<number>()
    for (let i = 0; i < 12; i++) alive.add(i)

    let raf = 0
    const loop = (): void => {
      const ball = ballRef.current
      if (!finishedRef.current) {
        if (ball.stuck) {
          ball.x = paddleRef.current
          ball.y = height - 118
          if (Math.random() < 0.02) ball.stuck = false // auto-launch after a beat
        } else {
          ball.x += ball.vx
          ball.y += ball.vy
          if (ball.x < 14) {
            ball.x = 14
            ball.vx = Math.abs(ball.vx)
          }
          if (ball.x > width - 14) {
            ball.x = width - 14
            ball.vx = -Math.abs(ball.vx)
          }
          if (ball.y < 104) {
            ball.y = 104
            ball.vy = Math.abs(ball.vy)
          }

          // Paddle
          const paddleY = height - 56
          const paddleW = 116
          if (
            ball.vy > 0 &&
            ball.y >= paddleY - 10 &&
            ball.y <= paddleY + 14 &&
            ball.x >= paddleRef.current - paddleW / 2 - 8 &&
            ball.x <= paddleRef.current + paddleW / 2 + 8
          ) {
            ball.vy = -Math.abs(ball.vy) * 1.02
            ball.vx += (ball.x - paddleRef.current) * 0.045
            ball.vx = Math.max(-5.2, Math.min(5.2, ball.vx))
          }

          // Bricks
          for (const id of Array.from(alive)) {
            const rect = brickLayout(id)
            if (ball.x > rect.x - 10 && ball.x < rect.x + rect.w + 10 && ball.y > rect.y - 10 && ball.y < rect.y + rect.h + 10) {
              alive.delete(id)
              ball.vy = Math.abs(ball.vy) * (ball.y < rect.y + rect.h / 2 ? -1 : 1)
              scoreRef.current += 1
              onScore(scoreRef.current)
              pushText('+1', ball.x, ball.y, '#fb923c')
              if (scoreRef.current >= 9) {
                finishedRef.current = true
                finish(true, scoreRef.current)
              }
              break
            }
          }

          // Miss
          if (!finishedRef.current && ball.y > height - 12) {
            livesRef.current -= 1
            setLives(livesRef.current)
            if (livesRef.current <= 0) {
              finishedRef.current = true
              finish(false, scoreRef.current)
            } else {
              ball.stuck = true
              ball.vx = 2.4
              ball.vy = -3.6
            }
          }
        }
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      alive.forEach((id) => {
        const rect = brickLayout(id)
        ctx.fillStyle = 'rgba(251,146,60,0.85)'
        ctx.shadowColor = '#fb923c'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6)
        ctx.fill()
      })
      ctx.shadowBlur = 0

      ctx.shadowColor = '#fb923c'
      ctx.shadowBlur = 16
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2)
      ctx.fill()

      const paddleY = height - 56
      const grad = ctx.createLinearGradient(paddleRef.current - 58, 0, paddleRef.current + 58, 0)
      grad.addColorStop(0, 'rgba(251,146,60,0.4)')
      grad.addColorStop(0.5, '#ffffff')
      grad.addColorStop(1, 'rgba(251,146,60,0.4)')
      ctx.fillStyle = grad
      ctx.shadowColor = '#fb923c'
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.roundRect(paddleRef.current - 58, paddleY, 116, 10, 5)
      ctx.fill()
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, width, height, brickLayout, finish, onScore, pushText])

  const handleMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = zoneRef.current?.getBoundingClientRect()
    if (!rect) return
    paddleRef.current = Math.max(70, Math.min(width - 70, e.clientX - rect.left))
  }

  return (
    <div ref={zoneRef} className="absolute inset-0" onMouseMove={handleMove} style={{ cursor: 'none' }}>
      <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-[86px] text-center font-mono text-sm text-white/70">
        {'♥'.repeat(Math.max(0, lives))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 4 ── Drift Vector (canvas)
// ─────────────────────────────────────────────────────────────

function DriftVector({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const dotRef = useRef({ x: width / 2, y: height - 120, tx: width / 2, ty: height - 120 })
  const finishedRef = useRef(false)

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dot = dotRef.current
    dot.x = width / 2
    dot.y = height - 120
    dot.tx = width / 2
    dot.ty = height - 120
    finishedRef.current = false
    onScore(0)

    const obstacles: Array<{ id: number; x: number; y: number; w: number; h: number; vy: number; hue: number }> = []
    let nextId = 1
    let lastSpawn = 0
    let lastMilestone = 0
    const startedAt = performance.now()

    let raf = 0
    const loop = (): void => {
      const now = performance.now()
      const t = (now - startedAt) / 1000

      if (!finishedRef.current) {
        if (t >= 9) {
          finishedRef.current = true
          finish(true, 9)
        } else {
          // Spawn
          if (now - lastSpawn > 520 - Math.min(300, t * 30)) {
            lastSpawn = now
            const w = 26 + Math.random() * 60
            obstacles.push({
              id: nextId++,
              x: 20 + Math.random() * (width - 40 - w),
              y: -30,
              w,
              h: 12 + Math.random() * 16,
              vy: 110 + Math.random() * 90 + t * 26,
              hue: Math.random() * 360
            })
          }

          // Move + collision
          dot.x += (dot.tx - dot.x) * 0.22
          dot.y += (dot.ty - dot.y) * 0.22
          for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i]
            o.y += (o.vy * 16) / 1000
            if (o.y > height + 40) {
              obstacles.splice(i, 1)
              continue
            }
            const cx = Math.max(o.x, Math.min(dot.x, o.x + o.w))
            const cy = Math.max(o.y, Math.min(dot.y, o.y + o.h))
            const dx = dot.x - cx
            const dy = dot.y - cy
            if (dx * dx + dy * dy < 10.5 * 10.5) {
              finishedRef.current = true
              pushText('HIT', dot.x, dot.y, '#ff5f6d')
              finish(false, Math.floor(t))
              break
            }
          }

          const milestone = Math.floor(t)
          if (milestone > lastMilestone && milestone < 9) {
            lastMilestone = milestone
            pushText(`${milestone}s`, width / 2, 130, '#a78bfa')
          }
          onScore(Math.floor(t))
        }
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      for (const o of obstacles) {
        ctx.fillStyle = `hsla(${o.hue},95%,68%,0.92)`
        ctx.shadowColor = `hsla(${o.hue},95%,68%,0.9)`
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.roundRect(o.x, o.y, o.w, o.h, 5)
        ctx.fill()
      }
      ctx.shadowBlur = 0

      ctx.shadowColor = '#a78bfa'
      ctx.shadowBlur = 18
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, width, height, finish, onScore, pushText])

  const handleMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = zoneRef.current?.getBoundingClientRect()
    if (!rect) return
    dotRef.current.tx = e.clientX - rect.left
    dotRef.current.ty = e.clientY - rect.top
  }

  return (
    <div ref={zoneRef} className="absolute inset-0" onMouseMove={handleMove} style={{ cursor: 'none' }}>
      <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 5 ── Aperture (SVG)
// ─────────────────────────────────────────────────────────────

function Aperture({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const [angle, setAngle] = useState(0)
  const [zone, setZone] = useState({ start: 300, size: 55 })
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const zoneRef = useRef({ start: 300, size: 55 })
  const angleRef = useRef(0)

  useEffect(() => {
    if (phase !== 'playing') return
    let raf = 0
    let last = performance.now()
    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(50, now - last) / 1000
      last = now
      angleRef.current = (angleRef.current + 150 * dt) % 360
      setAngle(angleRef.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  const stop = useCallback((): void => {
    if (finishedRef.current || phase !== 'playing') return
    // Angular distance between the tick and the zone center (0 = dead on).
    const diff = Math.abs(((angleRef.current - zoneRef.current.start + 540) % 360) - 180)
    const inZone = diff <= zoneRef.current.size / 2
    const cx = width / 2
    const cy = height / 2 + 10
    if (!inZone) {
      finishedRef.current = true
      pushText('MISS', cx, cy - 70, '#ff5f6d')
      finish(false, scoreRef.current)
      return
    }
    scoreRef.current += 1
    onScore(scoreRef.current)
    pushText('+1', cx, cy - 70, '#f472b6')
    if (scoreRef.current >= 9) {
      finishedRef.current = true
      finish(true, scoreRef.current)
      return
    }
    const nextSize = Math.max(18, zoneRef.current.size - 3.5)
    const nextStart = (zoneRef.current.start + 90 + Math.random() * 180) % 360
    zoneRef.current = { start: nextStart, size: nextSize }
    setZone(zoneRef.current)
  }, [phase, width, height, finish, onScore, pushText])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop])

  const cx = width / 2
  const cy = height / 2 + 10
  const radius = Math.min(width, height) * 0.24

  const arcPath = (startDeg: number, sizeDeg: number): string => {
    const toXY = (deg: number): [number, number] => [
      cx + Math.cos((deg * Math.PI) / 180) * radius,
      cy + Math.sin((deg * Math.PI) / 180) * radius
    ]
    const [x1, y1] = toXY(startDeg - sizeDeg / 2)
    const [x2, y2] = toXY(startDeg + sizeDeg / 2)
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${radius} ${radius} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
  }

  return (
    <div className="absolute inset-0" onClick={stop}>
      <svg width={width} height={height} className="absolute left-0 top-0">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={10} />
        <path
          d={arcPath(zone.start, zone.size)}
          stroke="#f472b6"
          strokeWidth={12}
          fill="none"
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 8px rgba(244,114,182,0.8))' }}
        />
        <line
          x1={cx + Math.cos((angle * Math.PI) / 180) * (radius - 18)}
          y1={cy + Math.sin((angle * Math.PI) / 180) * (radius - 18)}
          x2={cx + Math.cos((angle * Math.PI) / 180) * (radius + 18)}
          y2={cy + Math.sin((angle * Math.PI) / 180) * (radius + 18)}
          stroke="#ffffff"
          strokeWidth={3.5}
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.9))' }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-[86px] text-center font-mono text-sm text-white/60">
        Space / click inside the pink arc
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 6 ── Echo Matrix (memory grid)
// ─────────────────────────────────────────────────────────────

function EchoMatrix({ width, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const [sequence, setSequence] = useState<number[]>([])
  const [activeTile, setActiveTile] = useState<number | null>(null)
  const [isShowing, setIsShowing] = useState(true)
  const [litTiles, setLitTiles] = useState<Set<number>>(new Set())
  const inputIndexRef = useRef(0)
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  // Pseudo-random tile stream for appended sequence steps. Generated lazily
  // outside render so the lint rules stay satisfied and rounds stay varied.
  const nextTileRef = useRef(11)
  const TILE_HUES = [190, 320, 130, 45]

  const tileGeometry = useMemo(() => {
    const gridCols = 4
    const tileW = Math.min(110, (width - 160) / gridCols)
    const startX = (width - (tileW * gridCols + (gridCols - 1) * 16)) / 2
    const startY = 130
    return { gridCols, tileW, startX, startY }
  }, [width])

  const playSequence = useCallback((seq: number[]): void => {
    setIsShowing(true)
    inputIndexRef.current = 0
    setLitTiles(new Set())
    let i = 0
    const step = (): void => {
      if (i >= seq.length) {
        setActiveTile(null)
        setIsShowing(false)
        return
      }
      setActiveTile(seq[i])
      window.setTimeout(() => {
        setActiveTile(null)
        i += 1
        window.setTimeout(step, 140)
      }, 360)
    }
    window.setTimeout(step, 500)
  }, [])

  useEffect(() => {
    if (phase !== 'playing') return
    // Round 1 starts with a single tile; each round appends one more.
    const first = [nextTileRef.current % 8]
    nextTileRef.current = (nextTileRef.current * 5 + 13) % 100000
    const kickoff = window.setTimeout(() => {
      setSequence(first)
      playSequence(first)
    }, 300)
    return () => window.clearTimeout(kickoff)
  }, [phase, playSequence])

  const handleTile = (index: number): void => {
    if (isShowing || finishedRef.current || phase !== 'playing') return
    setLitTiles((prev) => {
      const next = new Set(prev)
      next.add(index)
      return next
    })
    window.setTimeout(() => {
      setLitTiles((prev) => {
        const next = new Set(prev)
        next.delete(index)
        return next
      })
    }, 200)

    if (sequence[inputIndexRef.current] !== index) {
      finishedRef.current = true
      pushText('MISS', width / 2, 112, '#ff5f6d')
      finish(false, scoreRef.current)
      return
    }
    const nextInput = inputIndexRef.current + 1
    inputIndexRef.current = nextInput
    setInputIndex(nextInput)
    if (nextInput >= sequence.length) {
      scoreRef.current = sequence.length
      onScore(scoreRef.current)
      pushText('OK', width / 2, 112, '#22d3ee')
      if (scoreRef.current >= 9) {
        finishedRef.current = true
        finish(true, scoreRef.current)
        return
      }
      const next = [...sequence, nextTileRef.current % 8]
      nextTileRef.current = (nextTileRef.current * 5 + 13) % 100000
      setSequence(next)
      playSequence(next)
    }
  }

  // Rounds are tracked in state, so progress display stays render-pure.
  const [inputIndex, setInputIndex] = useState(0)
  const { gridCols, tileW, startX, startY } = tileGeometry

  return (
    <div className="absolute inset-0">
      {Array.from({ length: 8 }).map((_, i) => {
        const col = i % gridCols
        const row = Math.floor(i / gridCols)
        const isActive = activeTile === i
        const isLit = litTiles.has(i)
        const hue = TILE_HUES[i % TILE_HUES.length]
        return (
          <button
            key={i}
            type="button"
            onMouseDown={() => handleTile(i)}
            className="absolute rounded-2xl transition-all duration-150"
            style={{
              left: startX + col * (tileW + 16),
              top: startY + row * (tileW + 16),
              width: tileW,
              height: tileW,
              background: isActive
                ? `hsla(${hue},95%,70%,0.95)`
                : isLit
                  ? `hsla(${hue},95%,60%,0.55)`
                  : 'rgba(255,255,255,0.05)',
              border: `1px solid ${isActive ? `hsla(${hue},95%,80%,0.9)` : 'rgba(255,255,255,0.08)'}`,
              boxShadow: isActive ? `0 0 18px hsla(${hue},95%,70%,0.8)` : 'none',
              cursor: 'pointer'
            }}
            title="Tile"
          />
        )
      })}
      <div className="pointer-events-none absolute inset-x-0 top-[92px] text-center font-mono text-sm text-white/60">
        {isShowing ? 'Watch…' : `Repeat — ${inputIndex}/${sequence.length}`}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 7 ── Light Stack
// ─────────────────────────────────────────────────────────────

// Rendered fully on canvas (no per-frame React state) with an explicit
// cut preview: the kept region of the moving slice glows, the doomed parts
// render faint and dashed, and cut lines project down to the tower top.
function LightStack({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const movingRef = useRef({ x: width / 2 - 75, w: 150 })
  const dirRef = useRef(1)
  const stackedRef = useRef<Array<{ x: number; w: number }>>([])
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const spawnFromLeftRef = useRef(true)

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const baseY = height - 80
    const layerHeight = 26
    const layerGap = 6

    movingRef.current = { x: width / 2 - 75, w: 150 }
    dirRef.current = 1
    stackedRef.current = []
    scoreRef.current = 0
    finishedRef.current = false
    spawnFromLeftRef.current = true
    onScore(0)

    let last = performance.now()
    let raf = 0

    const drawSlice = (x: number, w: number, y: number, hue: number, alpha: number, dashed: boolean): void => {
      if (w <= 0) return
      ctx.globalAlpha = alpha
      const grad = ctx.createLinearGradient(x, 0, x + w, 0)
      grad.addColorStop(0, `hsla(${hue},95%,64%,0.95)`)
      grad.addColorStop(1, `hsla(${(hue + 40) % 360},95%,64%,0.95)`)
      ctx.fillStyle = grad
      if (!dashed) {
        ctx.shadowColor = `hsla(${hue},95%,64%,0.6)`
        ctx.shadowBlur = 12
      }
      ctx.beginPath()
      ctx.roundRect(x, y, w, layerHeight, 6)
      if (dashed) {
        ctx.fill()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = `hsla(${hue},95%,72%,0.9)`
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.fill()
      }
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }

    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(50, now - last) / 1000
      last = now

      if (!finishedRef.current) {
        const speed = 170 + scoreRef.current * 26
        movingRef.current.x += dirRef.current * speed * dt
        if (movingRef.current.x < 20) {
          movingRef.current.x = 20
          dirRef.current = 1
        }
        if (movingRef.current.x + movingRef.current.w > width - 20) {
          movingRef.current.x = width - 20 - movingRef.current.w
          dirRef.current = -1
        }
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      const stackCount = stackedRef.current.length
      const movingY = baseY - (stackCount + 1) * (layerHeight + layerGap)
      const towerTopY = baseY - stackCount * (layerHeight + layerGap)

      // Base pedestal
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.roundRect(width / 2 - 95, baseY, 190, 10, 5)
      ctx.fill()

      // Tower
      stackedRef.current.forEach((layer, i) => {
        drawSlice(layer.x, layer.w, baseY - (i + 1) * (layerHeight + layerGap), (i * 40) % 360, 1, false)
      })

      // Cut preview: compute the kept region against the tower top.
      const cur = movingRef.current
      const prev = stackedRef.current[stackCount - 1] || { x: width / 2 - 75, w: 150 }
      const left = Math.max(cur.x, prev.x)
      const right = Math.min(cur.x + cur.w, prev.x + prev.w)
      const overlap = right - left
      const hue = (stackCount * 40) % 360

      if (!finishedRef.current) {
        // Projection lines from the cut edges down through the tower top.
        if (overlap > 0) {
          ctx.setLineDash([4, 4])
          ctx.strokeStyle = 'rgba(250,204,21,0.85)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(left, movingY)
          ctx.lineTo(left, towerTopY + 14)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(right, movingY)
          ctx.lineTo(right, towerTopY + 14)
          ctx.stroke()
          ctx.setLineDash([])
        }
        // Kept region solid and bright; the doomed remainder faint + dashed.
        drawSlice(left, overlap, movingY, hue, 1, false)
        drawSlice(cur.x, left - cur.x, movingY, hue, 0.22, true)
        drawSlice(right, cur.x + cur.w - right, movingY, hue, 0.22, true)
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, width, height, finish, onScore, pushText])

  const drop = useCallback((): void => {
    if (finishedRef.current || phase !== 'playing') return
    const layerHeight = 26
    const layerGap = 6
    const baseY = height - 80
    const prev = stackedRef.current[stackedRef.current.length - 1] || { x: width / 2 - 75, w: 150 }
    const current = movingRef.current
    const left = Math.max(current.x, prev.x)
    const right = Math.min(current.x + current.w, prev.x + prev.w)
    const overlap = right - left
    if (overlap <= 8) {
      finishedRef.current = true
      pushText('MISS', width / 2, height - 200, '#ff5f6d')
      finish(false, scoreRef.current)
      return
    }
    stackedRef.current = [...stackedRef.current, { x: left, w: overlap }]
    scoreRef.current += 1
    onScore(scoreRef.current)
    pushText('+1', left + overlap / 2, baseY - (stackedRef.current.length + 1) * (layerHeight + layerGap), '#facc15')
    if (scoreRef.current >= 9) {
      finishedRef.current = true
      finish(true, scoreRef.current)
      return
    }
    // Next slice keeps the landed width and spawns from the alternating
    // side, so it never starts superimposed on the tower.
    spawnFromLeftRef.current = !spawnFromLeftRef.current
    const fromLeft = spawnFromLeftRef.current
    movingRef.current = { x: fromLeft ? 20 : width - 20 - overlap, w: overlap }
    dirRef.current = fromLeft ? 1 : -1
  }, [phase, width, height, finish, onScore, pushText])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        drop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drop])

  return (
    <div className="absolute inset-0" onMouseDown={drop}>
      <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-[92px] text-center font-mono text-sm text-white/60">
        Space / click to drop · the bright section is what survives the cut
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 8 ── Glyph Rush (canvas)
// ─────────────────────────────────────────────────────────────

const GLYPH_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Rendered fully on canvas: no per-frame React state, no setState storms —
// the earlier DOM/state version flooded React with updates and froze the app.
function GlyphRush({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glyphsRef = useRef<Array<{ id: number; char: string; x: number; y: number; vy: number; hue: number }>>([])
  const coresRef = useRef(3)
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const nextIdRef = useRef(1)

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    glyphsRef.current = []
    coresRef.current = 3
    scoreRef.current = 0
    finishedRef.current = false
    onScore(0)

    let lastSpawn = performance.now()
    let lastFrame = lastSpawn
    let raf = 0

    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(50, now - lastFrame) / 1000
      lastFrame = now

      if (!finishedRef.current) {
        if (now - lastSpawn > 1250 - Math.min(600, scoreRef.current * 90)) {
          lastSpawn = now
          glyphsRef.current.push({
            id: nextIdRef.current++,
            char: GLYPH_SET[Math.floor(Math.random() * GLYPH_SET.length)],
            x: 40 + Math.random() * (width - 80),
            y: 120,
            vy: 55 + Math.random() * 45 + scoreRef.current * 9,
            hue: Math.random() * 360
          })
        }

        const survivors: typeof glyphsRef.current = []
        for (const g of glyphsRef.current) {
          g.y += g.vy * dt
          if (g.y > height - 64) {
            coresRef.current -= 1
            pushText('-1 CORE', g.x, height - 90, '#ff5f6d')
            if (coresRef.current <= 0) {
              finishedRef.current = true
              finish(false, scoreRef.current)
            }
            continue
          }
          survivors.push(g)
        }
        glyphsRef.current = survivors
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      for (const g of glyphsRef.current) {
        ctx.font = "700 26px ui-monospace, 'Cascadia Code', Consolas, monospace"
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = `hsl(${g.hue} 95% 70%)`
        ctx.shadowColor = `hsla(${g.hue},95%,70%,0.9)`
        ctx.shadowBlur = 14
        ctx.fillText(g.char, g.x, g.y)
      }
      ctx.shadowBlur = 0

      const lineY = height - 56
      const lineGrad = ctx.createLinearGradient(0, 0, width, 0)
      lineGrad.addColorStop(0, 'rgba(255,255,255,0)')
      lineGrad.addColorStop(0.5, 'rgba(255,255,255,0.35)')
      lineGrad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = lineGrad
      ctx.fillRect(0, lineY, width, 2)

      // Cores readout (drawn here so the whole game is canvas-driven).
      ctx.font = "600 14px ui-monospace, 'Cascadia Code', Consolas, monospace"
      ctx.textAlign = 'center'
      for (let i = 0; i < Math.max(0, coresRef.current); i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.shadowColor = 'rgba(52,211,153,0.8)'
        ctx.shadowBlur = 8
        ctx.fillText('◆', width / 2 + (i - 1) * 18, 96)
      }
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, width, height, finish, onScore, pushText])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (phase !== 'playing' || finishedRef.current) return
      const key = e.key.toUpperCase()
      if (key.length !== 1 || key < 'A' || key > 'Z') return
      const idx = glyphsRef.current.findIndex((g) => g.char === key)
      if (idx < 0) return
      const glyph = glyphsRef.current[idx]
      glyphsRef.current.splice(idx, 1)
      scoreRef.current += 1
      onScore(scoreRef.current)
      pushText('+1', glyph.x, glyph.y, '#34d399')
      if (scoreRef.current >= 9) {
        finishedRef.current = true
        finish(true, scoreRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, finish, onScore, pushText])

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />
}

// ─────────────────────────────────────────────────────────────
// 9 ── Orbit Trap (canvas)
// ─────────────────────────────────────────────────────────────

// Full skill game with an explicit physical model:
//
// - Free particles are deflected by the ring (soft barrier), so they hover
//   and circle just OUTSIDE it — a big idle ring traps nothing. AFK loses.
// - Dragging inward compresses the barrier; releasing springs the ring back
//   out, and the boundary overtakes slow, scattered particles — that is how
//   you trap them. Timing the release is the core skill.
// - Trapped particles orbit inside but push outward with pressure that grows
//   the smaller the ring is. Shrinking deep to catch new ones squeezes the
//   old ones past the boundary — 3 escapes void the run. 60s hard limit.
function OrbitTrap({ width, height, phase, onScore, finish, pushText }: GameFrameProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const scoreRef = useRef(0)
  const escapesRef = useRef(0)
  const finishedRef = useRef(false)

  const [trappedCount, setTrappedCount] = useState(0)
  const [remaining, setRemaining] = useState(60)
  const [escapeCount, setEscapeCount] = useState(0)

  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    scoreRef.current = 0
    escapesRef.current = 0
    finishedRef.current = false
    onScore(0)
    setTrappedCount(0)
    setEscapeCount(0)
    setRemaining(60)

    interface Particle {
      id: number
      x: number
      y: number
      vx: number
      vy: number
      hue: number
      spin: number
      inside: boolean
    }
    const particles: Particle[] = []
    let nextId = 1
    let lastSpawn = 0
    const startedAt = performance.now()
    const cx = width / 2
    const cy = height / 2 + 8
    const TIME_LIMIT = 60
    const RING_MAX = 150
    const RING_MIN = 40

    // Ring physics: only the player shrinks it (drag inward); it springs back.
    const ring = { r: RING_MAX }
    let dragActive = false

    const zone = zoneRef.current
    const onDown = (e: MouseEvent): void => {
      if (!zone || finishedRef.current) return
      const rect = zone.getBoundingClientRect()
      const d = Math.hypot(e.clientX - rect.left - cx, e.clientY - rect.top - cy)
      if (Math.abs(d - ring.r) < 26) dragActive = true
    }
    const onMove = (e: MouseEvent): void => {
      if (!dragActive || !zone || finishedRef.current) return
      const rect = zone.getBoundingClientRect()
      const d = Math.hypot(e.clientX - rect.left - cx, e.clientY - rect.top - cy)
      ring.r = Math.max(RING_MIN, Math.min(RING_MAX, d))
    }
    const onUp = (): void => {
      dragActive = false
    }
    zone?.addEventListener('mousedown', onDown)
    zone?.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    let raf = 0
    let lastFrame = startedAt
    let prevRingR = RING_MAX
    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(50, now - lastFrame) / 1000
      lastFrame = now
      const t = (now - startedAt) / 1000

      if (!finishedRef.current) {
        // Spring-back: the expanding boundary is the trapping mechanism.
        prevRingR = ring.r
        if (!dragActive && ring.r < RING_MAX) {
          ring.r = Math.min(RING_MAX, ring.r + 130 * dt)
        }
        const ringExpanded = ring.r > prevRingR + 0.01

        const left = Math.max(0, TIME_LIMIT - t)
        setRemaining((prev) => (Math.abs(prev - left) >= 0.1 ? left : prev))
        if (t >= TIME_LIMIT) {
          finishedRef.current = true
          finish(false, scoreRef.current)
        } else {
          // Spawn from the arena edges, aimed loosely across the arena.
          if (now - lastSpawn > 1150 && particles.filter((p) => !p.inside).length < 5) {
            lastSpawn = now
            const edge = Math.floor(Math.random() * 4)
            const jitter = (): number => Math.random()
            const px = edge === 0 ? 30 : edge === 1 ? width - 30 : 30 + jitter() * (width - 60)
            const py = edge === 2 ? 110 : edge === 3 ? height - 90 : 110 + jitter() * (height - 200)
            const toC = Math.atan2(cy - py, cx - px)
            const ang = toC + (Math.random() - 0.5) * 1.4
            const spd = 70 + Math.random() * 50
            particles.push({
              id: nextId++,
              x: px,
              y: py,
              vx: Math.cos(ang) * spd,
              vy: Math.sin(ang) * spd,
              hue: Math.random() * 360,
              spin: Math.random() > 0.5 ? 1 : -1,
              inside: false
            })
          }

          for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i]
            const dx = cx - p.x
            const dy = cy - p.y
            const dist = Math.hypot(dx, dy) || 1
            const ux = dx / dist
            const uy = dy / dist

            if (!p.inside && dist < ring.r - 8) {
              // TRAP — only possible while the boundary is expanding, i.e.
              // the released ring engulfed the particle. Fast particles can
              // never punch their way in (hard projection below), so there
              // is no such thing as a free trap.
              if (ringExpanded) {
                p.inside = true
                scoreRef.current += 1
                onScore(scoreRef.current)
                setTrappedCount(scoreRef.current)
                pushText('TRAPPED', p.x, p.y, '#f87171')
                if (scoreRef.current >= 9) {
                  finishedRef.current = true
                  finish(true, scoreRef.current)
                }
              }
            } else if (p.inside && dist > ring.r + 8) {
              // Squeezed past the boundary by a deep shrink.
              particles.splice(i, 1)
              escapesRef.current += 1
              setEscapeCount(escapesRef.current)
              pushText('ESCAPED', p.x, p.y, '#ff5f6d')
              if (escapesRef.current >= 3) {
                finishedRef.current = true
                finish(false, scoreRef.current)
              }
              continue
            }

            if (!p.inside) {
              // Hard containment: free particles can never sit inside the
              // boundary. Project out and bounce the radial component —
              // this kills any tunneling, no matter the speed.
              if (dist < ring.r + 6) {
                p.x = cx + ux * (ring.r + 6)
                p.y = cy + uy * (ring.r + 6)
                const vr = p.vx * ux + p.vy * uy
                if (vr > 0) {
                  p.vx -= ux * vr * 1.5
                  p.vy -= uy * vr * 1.5
                }
              }
              // Soft cushion just outside the boundary keeps them hovering
              // and orbiting instead of buzzing against the wall.
              const pen = ring.r + 46 - dist
              if (pen > 0) {
                const push = 340 * Math.min(1, pen / 60)
                p.vx -= ux * push * dt
                p.vy -= uy * push * dt
              }
              p.vx += -uy * p.spin * 26 * dt
              p.vy += ux * p.spin * 26 * dt
            } else {
              // Orbit spring toward 0.6·ring.r keeps them contained...
              const orbitR = 0.6 * ring.r
              p.vx += ux * (orbitR - dist) * 6 * dt
              p.vy += uy * (orbitR - dist) * 6 * dt
              // ...plus swirl, fighting an outward pressure that grows as
              // the ring gets smaller — deep shrinks are dangerous.
              p.vx += -uy * p.spin * 42 * dt
              p.vy += ux * p.spin * 42 * dt
              const pressure = (16 + 2 * scoreRef.current) * Math.pow(110 / Math.max(60, ring.r), 2)
              p.vx -= ux * pressure * dt
              p.vy -= uy * pressure * dt
            }

            p.vx *= 0.985
            p.vy *= 0.985
            const sp = Math.hypot(p.vx, p.vy)
            if (sp > 240) {
              p.vx = (p.vx / sp) * 240
              p.vy = (p.vy / sp) * 240
            }
            p.x += p.vx * dt
            p.y += p.vy * dt

            if (p.x < 30 || p.x > width - 30) {
              p.vx = -p.vx
              p.x = Math.max(30, Math.min(width - 30, p.x))
            }
            if (p.y < 110 || p.y > height - 90) {
              p.vy = -p.vy
              p.y = Math.max(110, Math.min(height - 90, p.y))
            }
          }
        }
      }

      // Draw
      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = dragActive ? 'rgba(255,255,255,0.95)' : 'rgba(248,113,113,0.85)'
      ctx.lineWidth = dragActive ? 4 : 3
      ctx.shadowColor = dragActive ? '#ffffff' : '#f87171'
      ctx.shadowBlur = dragActive ? 22 : 18
      ctx.beginPath()
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2)
      ctx.stroke()
      // Grab affordance: a faint outer halo shows the drag handle.
      ctx.globalAlpha = 0.25
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, ring.r + 14, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      for (const p of particles) {
        ctx.fillStyle = p.inside ? '#ffffff' : `hsl(${p.hue} 95% 65%)`
        ctx.shadowColor = p.inside ? '#f87171' : `hsl(${p.hue} 95% 65%)`
        ctx.shadowBlur = 12
        ctx.beginPath()
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      zone?.removeEventListener('mousedown', onDown)
      zone?.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [phase, width, height, finish, onScore, pushText])

  return (
    <div ref={zoneRef} className="absolute inset-0" style={{ cursor: 'grab', userSelect: 'none' }}>
      <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-[86px] text-center font-mono text-sm">
        <span className="text-white/70">trapped {trappedCount}/9 · </span>
        <span className={escapeCount > 0 ? 'font-bold text-[#ff5f6d]' : 'text-white/70'}>
          escapes {escapeCount}/3 ·{' '}
        </span>
        <span className={remaining <= 10 ? 'font-bold text-[#ff5f6d]' : 'text-white/70'}>
          {remaining.toFixed(1)}s
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Arcade shell
// ─────────────────────────────────────────────────────────────

interface ArcadeGameProps {
  onClose: () => void
  heroUnlocked: boolean
  unlockedThisSession: boolean
  onHeroUnlocked: () => void
  getHighScore: (id: string) => number
  saveHighScore: (id: string, score: number) => void
}

export function ArcadeGame({
  onClose,
  heroUnlocked,
  unlockedThisSession,
  onHeroUnlocked,
  getHighScore,
  saveHighScore
}: ArcadeGameProps): React.JSX.Element {
  const [view, setView] = useState<'hub' | 'game'>('hub')
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {}
    for (const g of GAME_SUMMARIES) initial[g.id] = getHighScore(g.id)
    return initial
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (view === 'game') {
          setView('hub')
          setActiveGameId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, onClose])

  const beatenCount = GAME_SUMMARIES.filter((g) => (scores[g.id] ?? 0) >= g.target).length

  const recordResult = useCallback(
    (gameId: string, won: boolean, finalScore: number): void => {
      const best = scores[gameId] ?? 0
      const nextBest = Math.max(best, finalScore)
      if (nextBest !== best) {
        saveHighScore(gameId, nextBest)
      }
      setScores((prev) => ({ ...prev, [gameId]: nextBest }))

      const totalBeaten = GAME_SUMMARIES.filter((g) =>
        g.id === gameId ? nextBest >= g.target : (scores[g.id] ?? 0) >= g.target
      ).length
      if (won && totalBeaten === TOTAL_GAMES && !heroUnlocked) {
        onHeroUnlocked()
      }
    },
    [scores, saveHighScore, heroUnlocked, onHeroUnlocked]
  )

  const renderHub = (): React.JSX.Element => (
    <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-8 custom-scrollbar">
      <div className="flex w-full max-w-4xl flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-3">
          <GameController size={30} weight="duotone" className="text-[#38bdf8]" />
          <h2 className="text-2xl font-bold tracking-tight text-white">Prism Arcade</h2>
          <span
            className="rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold"
            style={{
              borderColor: 'rgba(56,189,248,0.4)',
              color: '#38bdf8',
              background: 'rgba(56,189,248,0.08)'
            }}
          >
            v9.0.0
          </span>
        </div>
        <p className="max-w-xl text-xs leading-relaxed text-white/55">
          Nine tiny games. Beat the target score in every one to permanently unlock the Hero theme —
          a live particle 9 that dances behind the interface.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5">
          <Trophy size={14} className="text-[#facc15]" />
          <span className="text-xs font-semibold text-white/85">
            {beatenCount} / {TOTAL_GAMES} games beaten
          </span>
          <span className="h-3 w-px bg-white/15" />
          <span className="font-mono text-[10px] text-white/50">
            {beatenCount === TOTAL_GAMES ? 'Hero theme unlocked' : 'Target: beat them all'}
          </span>
        </div>
      </div>

      {unlockedThisSession && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[#facc15]/40 bg-[#facc15]/10 px-5 py-3.5 shadow-[0_0_40px_rgba(250,204,21,0.25)]">
          <Confetti size={26} weight="duotone" className="text-[#facc15]" />
          <div className="text-left">
            <p className="text-sm font-bold text-[#fde68a]">Hero theme unlocked!</p>
            <p className="text-[11px] text-white/60">
              Close the Arcade to see the particle 9 behind your workspace.
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 grid w-full max-w-4xl grid-cols-1 gap-3.5 pb-8 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_SUMMARIES.map((game, index) => {
          const score = scores[game.id] ?? 0
          const beaten = score >= game.target
          return (
            <button
              key={game.id}
              type="button"
              onClick={() => {
                setActiveGameId(game.id)
                setView('game')
              }}
              className={`group relative flex flex-col gap-2 overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 cursor-pointer outline-none active:scale-[0.98] ${
                beaten
                  ? 'border-[#4ade80]/40 bg-[#4ade80]/[0.06]'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-white/35">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {beaten ? (
                  <span className="flex items-center gap-1 rounded-full bg-[#4ade80]/15 px-2 py-0.5 text-[10px] font-bold text-[#4ade80]">
                    <SealCheck size={11} weight="bold" /> Beaten
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-white/45">
                    <Medal size={11} /> {game.targetLabel}
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{game.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-white/50">{game.tagline}</p>
              </div>
              <p className="text-[11px] font-medium text-white/70">{game.goal}</p>
              <div className="mt-auto flex items-center justify-between pt-1">
                <span className="font-mono text-[10px] text-white/40">
                  best {score} {game.unit}
                </span>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: game.accent, boxShadow: `0 0 8px ${game.accent}` }}
                />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  const activeSummary = GAME_SUMMARIES.find((g) => g.id === activeGameId)

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex select-none flex-col items-center animate-fade-in"
      style={{ background: 'rgba(2,4,10,0.92)', backdropFilter: 'blur(20px)' }}
    >
      <div className="absolute left-5 right-5 top-5 z-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {view === 'game' && (
            <button
              type="button"
              onClick={() => {
                setView('hub')
                setActiveGameId(null)
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-white transition-all hover:bg-white/[0.12]"
              title="Back to Arcade hub"
            >
              <CaretLeft size={16} weight="bold" />
            </button>
          )}
          <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2">
            <GameController size={17} weight="duotone" className="text-[#38bdf8]" />
            <span className="text-xs font-bold tracking-wide text-white">
              {view === 'hub' ? 'PRISM ARCADE' : activeSummary?.title.toUpperCase() || ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition-all hover:bg-red-500/80"
            title="Close the Arcade"
          >
            <X size={17} weight="bold" />
          </button>
        </div>
      </div>

      {view === 'hub' || !activeSummary ? (
        renderHub()
      ) : (
        <GameScreen
          summary={activeSummary}
          getHighScore={() => getHighScore(activeSummary.id)}
          saveHighScore={(s) => saveHighScore(activeSummary.id, s)}
          onExit={(won, finalScore) => {
            recordResult(activeSummary.id, won, finalScore)
            setView('hub')
            setActiveGameId(null)
          }}
        />
      )}
    </div>,
    document.body
  )
}

// ─────────────────────────────────────────────────────────────
// Game screen (HUD + layers + overlays)
// ─────────────────────────────────────────────────────────────

interface GameScreenProps {
  summary: GameSummary
  getHighScore: () => number
  saveHighScore: (score: number) => void
  onExit: (won: boolean, finalScore: number) => void
}

function GameScreen({ summary, getHighScore, saveHighScore, onExit }: GameScreenProps): React.JSX.Element {
  const backdropRef = useRef<HTMLCanvasElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 900, height: 540 })
  const [phase, setPhase] = useState<Phase>('playing')
  const [score, setScore] = useState(0)
  const [floatingTexts, setFloatingTexts] = useState<FloatingScore[]>([])
  const [highScore, setHighScore] = useState(() => getHighScore())
  const [runKey, setRunKey] = useState(0)
  const nextTextId = useRef(1)

  // Measure the play panel so games receive pixel-accurate dimensions.
  useEffect(() => {
    const measure = (): void => {
      const rect = panelRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0) {
        setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [runKey])

  // Shared decorative layer: arcade backdrop + ambient particles.
  useEffect(() => {
    const canvas = backdropRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const render = (): void => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawArcadeBackdrop(ctx, w, h)
      if (!ambient) ambient = makeAmbientParticles(26, w, h)
      drawAmbientParticles(ctx, ambient, w, h, performance.now() / 1000)
    }

    let ambient: AmbientParticle[] | null = null
    let raf = 0
    const loop = (): void => {
      render()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [runKey])

  const finish = useCallback(
    (won: boolean, finalScore: number): void => {
      setPhase(won ? 'won' : 'lost')
      setScore(finalScore)
      if (finalScore > highScore) {
        setHighScore(finalScore)
        saveHighScore(finalScore)
      }
    },
    [highScore, saveHighScore]
  )

  const pushText = useCallback((text: string, x: number, y: number, color: string): void => {
    const id = nextTextId.current++
    setFloatingTexts((prev) => [...prev.slice(-8), { id, text, x, y, color }])
    window.setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((t) => t.id !== id))
    }, 1000)
  }, [])

  const restart = (): void => {
    setPhase('playing')
    setScore(0)
    setFloatingTexts([])
    setRunKey((k) => k + 1)
  }

  const gameProps: GameFrameProps = {
    width: size.width,
    height: size.height,
    phase,
    onScore: setScore,
    finish,
    pushText
  }

  const renderGame = (): React.ReactNode => {
    switch (summary.id) {
      case 'reflex':
        return <PhotonReflex {...gameProps} />
      case 'snake':
        return <DataSerpent {...gameProps} />
      case 'breakout':
        return <BrickCascade {...gameProps} />
      case 'dodge':
        return <DriftVector {...gameProps} />
      case 'precision':
        return <Aperture {...gameProps} />
      case 'memory':
        return <EchoMatrix {...gameProps} />
      case 'stack':
        return <LightStack {...gameProps} />
      case 'type':
        return <GlyphRush {...gameProps} />
      case 'orbit':
        return <OrbitTrap {...gameProps} />
      default:
        return null
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center px-6 pb-6">
      <div
        ref={panelRef}
        className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 shadow-2xl"
        style={{ height: 'min(560px, 70vh)' }}
      >
        <canvas ref={backdropRef} className="absolute inset-0 h-full w-full" />
        <div key={runKey} className="absolute inset-0">
          {phase === 'playing' && renderGame()}
        </div>
        {/* HUD */}
        {phase === 'playing' && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 backdrop-blur-md">
            <span className="font-mono text-sm font-bold" style={{ color: summary.accent }}>
              {score} <span className="text-[10px] font-medium text-white/50">{summary.unit}</span>
            </span>
            <span className="h-3 w-px bg-white/15" />
            <span className="font-mono text-[10px] text-white/60">target {summary.targetLabel}</span>
          </div>
        )}
        {floatingTexts.map((ft) => (
          <span
            key={ft.id}
            className="pointer-events-none absolute z-10 font-mono text-xs font-bold"
            style={{
              left: ft.x,
              top: ft.y,
              color: ft.color,
              textShadow: `0 0 10px ${ft.color}`,
              transform: 'translate(-50%, -50%)',
              animation: 'float-up-fade 1s ease-out forwards'
            }}
          >
            {ft.text}
          </span>
        ))}
        {phase !== 'playing' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/55 backdrop-blur-sm">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl border"
              style={{
                borderColor: phase === 'won' ? 'rgba(74,222,128,0.5)' : 'rgba(255,95,109,0.5)',
                background: phase === 'won' ? 'rgba(74,222,128,0.1)' : 'rgba(255,95,109,0.1)'
              }}
            >
              {phase === 'won' ? (
                <CheckCircle size={30} weight="duotone" className="text-[#4ade80]" />
              ) : (
                <X size={30} weight="duotone" className="text-[#ff5f6d]" />
              )}
            </div>
            <p className="text-xl font-bold text-white">
              {phase === 'won' ? 'Target beaten!' : 'Run over'}
            </p>
            <p className="font-mono text-sm text-white/60">
              score {score} · best {highScore} · target {summary.targetLabel}
            </p>
            <div className="mt-1 flex items-center gap-2.5">
              <button
                type="button"
                onClick={restart}
                className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs font-bold text-white transition-all hover:bg-white/20 active:scale-95"
              >
                <ArrowCounterClockwise size={14} weight="bold" /> Retry
              </button>
              <button
                type="button"
                onClick={() => onExit(phase === 'won', score)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-xs font-semibold text-white/85 transition-all hover:bg-white/[0.14] active:scale-95"
              >
                Back to hub
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-center font-mono text-[11px] text-white/40">{summary.hint}</p>
    </div>
  )
}
