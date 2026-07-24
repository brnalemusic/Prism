import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowsCounterClockwise,
  SpeakerHigh,
  SpeakerSimpleX,
  Magnet,
  Atom,
  Flame,
  Planet,
  Globe
} from '@phosphor-icons/react'

// --- Web Audio API Procedural Synthesizer ---
class QuantumAudioSynth {
  private ctx: AudioContext | null = null
  private isMuted: boolean = false
  private lastPopTime: number = 0

  private getContext(): AudioContext | null {
    if (this.isMuted) return null
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted
  }

  public playPop(pitch: number = 1.0, velocity: number = 1.0): void {
    const nowMs = Date.now()
    if (nowMs - this.lastPopTime < 60) return // Throttling to prevent ear-piercing spam
    this.lastPopTime = nowMs

    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    // Pentatonic scale frequency
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]
    const index = Math.floor(Math.abs(pitch * 5)) % scale.length
    const freq = scale[index] || 440.0

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.3, now + 0.06)

    const vol = Math.min(0.12, Math.max(0.01, velocity * 0.015))
    gain.gain.setValueAtTime(vol, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.08)
  }

  public playTargetHit(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    // Harmonic bell chord
    const freqs = [523.25, 659.25, 783.99, 1046.5]
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(f, now + i * 0.03)

      gain.gain.setValueAtTime(0.1, now + i * 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.03 + 0.35)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now + i * 0.03)
      osc.stop(now + i * 0.03 + 0.35)
    })
  }

  public playQuantum8Activation(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const chord = [220, 329.63, 440, 554.37, 659.25, 880, 1108.73, 1318.51]
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.05)

      gain.gain.setValueAtTime(0.15, now + i * 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.6)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now + i * 0.05)
      osc.stop(now + i * 0.05 + 0.6)
    })
  }
}

// --- Interfaces ---
interface QuantumSphere {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  mass: number
  insideTargetIds: number[]
}

interface TargetRing {
  id: number
  x: number
  y: number
  radius: number
  color: string
  active: boolean
  pulse: number
}

interface ParticleSpark {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  color: string
}

interface FloatingText {
  id: number
  text: string
  x: number
  y: number
  alpha: number
  color: string
}

type GravityMode = 'attract' | 'repel' | 'zerog' | 'earth'

export function QuantumPhysicsGame({ onClose }: { onClose: () => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const synthRef = useRef<QuantumAudioSynth>(new QuantumAudioSynth())

  const [gravityMode, setGravityMode] = useState<GravityMode>('attract')
  const [isMuted, setIsMuted] = useState(false)
  const [score, setScore] = useState<number>(0)
  const [isUnlocked8, setIsUnlocked8] = useState<boolean>(false)

  const mousePosRef = useRef<{ x: number; y: number; isDown: boolean }>({
    x: 0,
    y: 0,
    isDown: false
  })
  const draggedBallRef = useRef<QuantumSphere | null>(null)

  const spheresRef = useRef<QuantumSphere[]>([])
  const targetsRef = useRef<TargetRing[]>([])
  const particlesRef = useRef<ParticleSpark[]>([])
  const floatingTextsRef = useRef<FloatingText[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const scoreRef = useRef<number>(0)

  const toggleMute = (): void => {
    const nextState = !isMuted
    setIsMuted(nextState)
    synthRef.current.setMuted(nextState)
  }

  // Initialize Game Objects
  const initGame = (width: number, height: number): void => {
    // 1. Quantum Spheres
    const spheres: QuantumSphere[] = []
    const colors = ['#00f3ff', '#7000ff', '#ff0077', '#00ffaa', '#ffaa00']

    for (let i = 0; i < 16; i++) {
      const radius = 16 + Math.random() * 12
      spheres.push({
        id: i,
        x: 80 + Math.random() * (width - 160),
        y: 80 + Math.random() * (height - 240),
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        radius,
        color: colors[i % colors.length],
        mass: radius,
        insideTargetIds: []
      })
    }
    spheresRef.current = spheres

    // 2. Quantum Target Rings (4 corners/orbit zones)
    const targets: TargetRing[] = [
      { id: 1, x: width * 0.2, y: height * 0.25, radius: 45, color: '#00f3ff', active: true, pulse: 0 },
      { id: 2, x: width * 0.8, y: height * 0.25, radius: 45, color: '#ff0077', active: true, pulse: 0 },
      { id: 3, x: width * 0.3, y: height * 0.7, radius: 45, color: '#00ffaa', active: true, pulse: 0 },
      { id: 4, x: width * 0.7, y: height * 0.7, radius: 45, color: '#7000ff', active: true, pulse: 0 }
    ]
    targetsRef.current = targets
  }

  const spawnSparks = (x: number, y: number, color: string, count: number = 10): void => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 5
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3,
        alpha: 1.0,
        color
      })
    }
  }

  const spawnFloatingText = (text: string, x: number, y: number, color: string): void => {
    floatingTextsRef.current.push({
      id: Math.random(),
      text,
      x,
      y,
      alpha: 1.0,
      color
    })
  }

  const handleReset = (): void => {
    scoreRef.current = 0
    setScore(0)
    setIsUnlocked8(false)
    if (canvasRef.current) {
      initGame(canvasRef.current.width, canvasRef.current.height)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = (): void => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight
      if (spheresRef.current.length === 0) {
        initGame(canvas.width, canvas.height)
      }
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    let shaderTime = 0

    // Main Game Physics & Render Loop
    const loop = (): void => {
      shaderTime += 0.02
      const width = canvas.width
      const height = canvas.height

      // Clear Screen
      ctx.fillStyle = '#060812'
      ctx.fillRect(0, 0, width, height)

      // Background Quantum Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)'
      ctx.lineWidth = 1
      const gridSize = 45
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      const mouse = mousePosRef.current

      // If Stylized 8 is unlocked, render ONLY the 8 Shader & Mouse interaction
      if (isUnlocked8) {
        ctx.save()

        const t = shaderTime
        const center8X = width / 2
        const center8Y = height * 0.45
        const size8 = Math.min(width, height) * 0.24

        // Mouse Parallax & Shader Distortion
        const mDx = (mouse.x - center8X) * 0.06
        const mDy = (mouse.y - center8Y) * 0.06

        // Deep Quantum Nebula Backdrop
        const bgGrad = ctx.createRadialGradient(
          center8X + mDx,
          center8Y + mDy,
          10,
          center8X,
          center8Y,
          size8 * 2.5
        )
        bgGrad.addColorStop(0, 'rgba(0, 243, 255, 0.15)')
        bgGrad.addColorStop(0.5, 'rgba(112, 0, 255, 0.08)')
        bgGrad.addColorStop(1, 'rgba(5, 7, 15, 0.95)')
        ctx.fillStyle = bgGrad
        ctx.fillRect(0, 0, width, height)

        // Radial Energy Beams
        for (let i = 0; i < 20; i++) {
          const angle = (i / 20) * Math.PI * 2 + t * 0.4
          ctx.beginPath()
          ctx.moveTo(center8X, center8Y)
          ctx.lineTo(center8X + Math.cos(angle) * width * 0.8, center8Y + Math.sin(angle) * height * 0.8)
          ctx.strokeStyle = `rgba(0, 243, 255, ${0.025 + Math.sin(t * 3 + i) * 0.015})`
          ctx.lineWidth = 2
          ctx.stroke()
        }

        // Render Stylized Interlocking Figure '8'
        const topCY = center8Y - size8 * 0.48
        const botCY = center8Y + size8 * 0.48
        const r8 = size8 * 0.52

        // Outer Glow Rings of the '8'
        ;[
          { y: topCY, r: r8, color1: '#00f3ff', color2: '#7000ff' },
          { y: botCY, r: r8 * 1.08, color1: '#ff0077', color2: '#00f3ff' }
        ].forEach((ring, idx) => {
          ctx.save()
          ctx.beginPath()
          ctx.arc(center8X + (idx === 0 ? mDx : -mDx), ring.y + mDy, ring.r, 0, Math.PI * 2)

          const ringGrad = ctx.createConicGradient(t * 1.2 + idx * Math.PI, center8X, ring.y)
          ringGrad.addColorStop(0, ring.color1)
          ringGrad.addColorStop(0.5, ring.color2)
          ringGrad.addColorStop(1, ring.color1)

          ctx.strokeStyle = ringGrad
          ctx.lineWidth = 18 + Math.sin(t * 3 + idx) * 4
          ctx.shadowColor = ring.color1
          ctx.shadowBlur = 35
          ctx.stroke()

          // Inner white neon core curve
          ctx.beginPath()
          ctx.arc(center8X + (idx === 0 ? mDx : -mDx), ring.y + mDy, ring.r, 0, Math.PI * 2)
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 4
          ctx.shadowColor = '#ffffff'
          ctx.shadowBlur = 10
          ctx.stroke()
          ctx.restore()
        })

        // Orbiting Quantum Particle Dust around 8
        for (let p = 0; p < 36; p++) {
          const pAngle = (p / 36) * Math.PI * 2 + t * 1.8
          const isTop = p % 2 === 0
          const pY = isTop ? topCY : botCY
          const px = center8X + Math.cos(pAngle) * (r8 + (isTop ? 18 : 22)) + (isTop ? mDx : -mDx)
          const py = pY + Math.sin(pAngle) * (r8 + (isTop ? 18 : 22)) + mDy

          ctx.beginPath()
          ctx.arc(px, py, 3 + Math.sin(t * 4 + p) * 1.5, 0, Math.PI * 2)
          ctx.fillStyle = isTop ? '#00f3ff' : '#ff0077'
          ctx.shadowColor = isTop ? '#00f3ff' : '#ff0077'
          ctx.shadowBlur = 12
          ctx.fill()
        }

        ctx.restore()

        animationFrameRef.current = requestAnimationFrame(loop)
        return
      }

      // --- GAMEPLAY MODE ---

      // Render Gravity Vortex Indicator (ONLY when mouse is pressed)
      if (mouse.isDown) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(mouse.x, mouse.y, 40 + Math.sin(shaderTime * 6) * 6, 0, Math.PI * 2)
        ctx.strokeStyle =
          gravityMode === 'attract'
            ? 'rgba(0, 243, 255, 0.6)'
            : gravityMode === 'repel'
              ? 'rgba(255, 0, 119, 0.6)'
              : 'rgba(112, 0, 255, 0.6)'
        ctx.lineWidth = 2.5
        ctx.setLineDash([5, 5])
        ctx.stroke()
        ctx.restore()
      }

      // Draw Quantum Target Rings
      const targets = targetsRef.current
      targets.forEach((target) => {
        target.pulse += 0.03
        ctx.save()
        ctx.beginPath()
        ctx.arc(target.x, target.y, target.radius + Math.sin(target.pulse) * 4, 0, Math.PI * 2)

        ctx.strokeStyle = target.color
        ctx.lineWidth = 3
        ctx.shadowColor = target.color
        ctx.shadowBlur = 15
        ctx.stroke()

        // Inner glowing core
        ctx.beginPath()
        ctx.arc(target.x, target.y, target.radius * 0.4, 0, Math.PI * 2)
        ctx.fillStyle = target.color
        ctx.globalAlpha = 0.2 + Math.sin(target.pulse * 2) * 0.1
        ctx.fill()
        ctx.restore()
      })

      // Physics & Ball Collisions
      const spheres = spheresRef.current

      spheres.forEach((sphere, i) => {
        // Skip position update for dragged ball
        if (sphere !== draggedBallRef.current) {
          // Mouse Gravity Impulses (Active ONLY when mouse IS down)
          if (mouse.isDown) {
            const dx = mouse.x - sphere.x
            const dy = mouse.y - sphere.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist > 5 && dist < 380) {
              const forceScale = (250 / (dist + 30)) * (gravityMode === 'repel' ? -0.8 : 0.7)
              sphere.vx += (dx / dist) * forceScale
              sphere.vy += (dy / dist) * forceScale
            }
          }

          // Apply Gravity Modes
          if (gravityMode === 'earth') {
            sphere.vy += 0.35 // Downward acceleration
          }

          // Max Velocity Cap to prevent physics explosions
          const currentVel = Math.sqrt(sphere.vx * sphere.vx + sphere.vy * sphere.vy)
          if (currentVel > 14) {
            sphere.vx = (sphere.vx / currentVel) * 14
            sphere.vy = (sphere.vy / currentVel) * 14
          }

          // Velocity Dampening (Friction)
          sphere.vx *= 0.985
          sphere.vy *= 0.985

          // Position Update
          sphere.x += sphere.vx
          sphere.y += sphere.vy

          // Boundary Collisions with Realistic Velocity Damping
          if (sphere.x - sphere.radius < 0) {
            sphere.x = sphere.radius
            sphere.vx *= -0.75
            if (Math.abs(sphere.vx) > 0.5) synthRef.current.playPop(0.8, Math.abs(sphere.vx))
          }
          if (sphere.x + sphere.radius > width) {
            sphere.x = width - sphere.radius
            sphere.vx *= -0.75
            if (Math.abs(sphere.vx) > 0.5) synthRef.current.playPop(0.8, Math.abs(sphere.vx))
          }
          if (sphere.y - sphere.radius < 0) {
            sphere.y = sphere.radius
            sphere.vy *= -0.75
            if (Math.abs(sphere.vy) > 0.5) synthRef.current.playPop(0.8, Math.abs(sphere.vy))
          }

          // Floor Boundary in Earth G (Prevent Jittering)
          if (sphere.y + sphere.radius > height) {
            sphere.y = height - sphere.radius
            sphere.vy *= -0.65 // Damping bounce
            sphere.vx *= 0.92 // Floor friction

            if (Math.abs(sphere.vy) < 0.4) {
              sphere.vy = 0 // Rest on floor cleanly!
            } else {
              synthRef.current.playPop(1.2, Math.abs(sphere.vy))
            }
          }
        }

        // Check Target Ring Captures / Hits (Entry-based scoring ONLY!)
        targets.forEach((target) => {
          const tDx = target.x - sphere.x
          const tDy = target.y - sphere.y
          const tDist = Math.sqrt(tDx * tDx + tDy * tDy)
          const isInside = tDist < target.radius
          const isAlreadyInside = sphere.insideTargetIds.includes(target.id)

          if (isInside && !isAlreadyInside) {
            // Ball just ENTERED the ring! Score points once on entry.
            sphere.insideTargetIds.push(target.id)

            const gain = parseFloat((Math.random() * 3.5 + 0.5).toFixed(1))
            const nextScore = Math.min(100, parseFloat((scoreRef.current + gain).toFixed(1)))
            scoreRef.current = nextScore
            setScore(nextScore)

            synthRef.current.playTargetHit()
            spawnSparks(sphere.x, sphere.y, target.color, 12)
            spawnFloatingText(`+${gain}%`, sphere.x, sphere.y - 20, target.color)

            if (nextScore >= 100 && !isUnlocked8) {
              setIsUnlocked8(true)
              synthRef.current.playQuantum8Activation()
            }
          } else if (!isInside && isAlreadyInside) {
            // Ball EXITED the ring! Allow scoring again upon next entry.
            sphere.insideTargetIds = sphere.insideTargetIds.filter((id) => id !== target.id)
          }
        })

        // Ball-on-Ball Elastic Collisions
        for (let j = i + 1; j < spheres.length; j++) {
          const other = spheres[j]
          const dx = other.x - sphere.x
          const dy = other.y - sphere.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = sphere.radius + other.radius

          if (dist < minDist && dist > 0) {
            // Positional separation to prevent overlap bugs
            const overlap = (minDist - dist) * 0.5
            const nx = dx / dist
            const ny = dy / dist

            if (sphere !== draggedBallRef.current) {
              sphere.x -= nx * overlap
              sphere.y -= ny * overlap
            }
            if (other !== draggedBallRef.current) {
              other.x += nx * overlap
              other.y += ny * overlap
            }

            // Elastic Velocity Exchange
            const kx = sphere.vx - other.vx
            const ky = sphere.vy - other.vy
            const p = (2 * (nx * kx + ny * ky)) / (sphere.mass + other.mass)

            if (sphere !== draggedBallRef.current) {
              sphere.vx -= p * other.mass * nx
              sphere.vy -= p * other.mass * ny
            }
            if (other !== draggedBallRef.current) {
              other.vx += p * sphere.mass * nx
              other.vy += p * sphere.mass * ny
            }

            // Bounce Audio FX
            const relVel = Math.sqrt(kx * kx + ky * ky)
            if (relVel > 1.2) {
              synthRef.current.playPop(sphere.radius / 15, relVel)
            }
          }
        }

        // Draw Sphere
        ctx.save()
        ctx.beginPath()
        ctx.arc(sphere.x, sphere.y, sphere.radius, 0, Math.PI * 2)

        const grad = ctx.createRadialGradient(
          sphere.x - sphere.radius * 0.3,
          sphere.y - sphere.radius * 0.3,
          sphere.radius * 0.1,
          sphere.x,
          sphere.y,
          sphere.radius
        )
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(0.4, sphere.color)
        grad.addColorStop(1, 'rgba(0,0,0,0.85)')

        ctx.fillStyle = grad
        ctx.shadowColor = sphere.color
        ctx.shadowBlur = 12
        ctx.fill()
        ctx.restore()
      })

      // Render Particle Sparks
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i]
        p.x += p.vx
        p.y += p.vy
        p.alpha -= 0.03
        if (p.alpha <= 0) {
          particlesRef.current.splice(i, 1)
          continue
        }

        ctx.save()
        ctx.globalAlpha = p.alpha
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.shadowColor = p.color
        ctx.shadowBlur = 6
        ctx.fill()
        ctx.restore()
      }

      // Render Floating Text
      for (let i = floatingTextsRef.current.length - 1; i >= 0; i--) {
        const ft = floatingTextsRef.current[i]
        ft.y -= 1.2
        ft.alpha -= 0.02
        if (ft.alpha <= 0) {
          floatingTextsRef.current.splice(i, 1)
          continue
        }

        ctx.save()
        ctx.globalAlpha = ft.alpha
        ctx.font = 'bold 13px system-ui, sans-serif'
        ctx.fillStyle = ft.color
        ctx.shadowColor = ft.color
        ctx.shadowBlur = 10
        ctx.textAlign = 'center'
        ctx.fillText(ft.text, ft.x, ft.y)
        ctx.restore()
      }

      animationFrameRef.current = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [gravityMode, isUnlocked8])

  // Mouse / Drag Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    mousePosRef.current = { x, y, isDown: true }

    // Check ball grab
    const clickedBall = spheresRef.current.find((s) => {
      const dx = s.x - x
      const dy = s.y - y
      return Math.sqrt(dx * dx + dy * dy) <= s.radius + 6
    })

    if (clickedBall) {
      draggedBallRef.current = clickedBall
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    mousePosRef.current.x = x
    mousePosRef.current.y = y

    if (draggedBallRef.current) {
      draggedBallRef.current.vx = (x - draggedBallRef.current.x) * 0.4
      draggedBallRef.current.vy = (y - draggedBallRef.current.y) * 0.4
      draggedBallRef.current.x = x
      draggedBallRef.current.y = y
    }
  }

  const handleMouseUp = (): void => {
    mousePosRef.current.isDown = false
    draggedBallRef.current = null
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-xl animate-fade-in select-none">
      {/* ── Top Bar Controls (Hidden when 8 is unlocked) ── */}
      {!isUnlocked8 && (
        <div className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between pointer-events-none">
          {/* Title */}
          <div className="flex items-center gap-3 bg-white/[0.06] border border-white/10 rounded-2xl px-4 py-2 backdrop-blur-md pointer-events-auto">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-primary/20 text-accent-primary">
              <Atom size={20} className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-wide">
                  PRISM 8 QUANTUM ALIGNMENT
                </span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-primary/20 text-accent-primary border border-accent-primary/30">
                  v8.0.0
                </span>
              </div>
              <span className="text-[10px] text-text-secondary/70">
                Guide or fling quantum spheres into the 4 target energy rings!
              </span>
            </div>
          </div>

          {/* Gravity Toolbar */}
          <div className="hidden md:flex items-center gap-1.5 bg-black/60 border border-white/10 rounded-2xl p-1.5 backdrop-blur-md pointer-events-auto shadow-2xl">
            <button
              onClick={() => setGravityMode('attract')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                gravityMode === 'attract'
                  ? 'bg-accent-primary text-black font-bold shadow-lg'
                  : 'text-text-secondary hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Magnet size={14} />
              Attract
            </button>
            <button
              onClick={() => setGravityMode('repel')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                gravityMode === 'repel'
                  ? 'bg-pink-500 text-white font-bold shadow-lg'
                  : 'text-text-secondary hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Flame size={14} />
              Repel
            </button>
            <button
              onClick={() => setGravityMode('earth')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                gravityMode === 'earth'
                  ? 'bg-amber-400 text-black font-bold shadow-lg'
                  : 'text-text-secondary hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Globe size={14} />
              Earth G
            </button>
            <button
              onClick={() => setGravityMode('zerog')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                gravityMode === 'zerog'
                  ? 'bg-purple-500 text-white font-bold shadow-lg'
                  : 'text-text-secondary hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Planet size={14} />
              Zero-G
            </button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              onClick={toggleMute}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10 text-white hover:bg-white/15 transition-all"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <SpeakerSimpleX size={18} /> : <SpeakerHigh size={18} />}
            </button>
            <button
              onClick={handleReset}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10 text-white hover:bg-white/15 transition-all"
              title="Reset Game"
            >
              <ArrowsCounterClockwise size={18} />
            </button>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 border border-white/20 text-white hover:bg-red-500/80 transition-all cursor-pointer"
              title="Close Easter Egg"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>
      )}

      {/* ── Canvas Interactive Area ── */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* ── Bottom Progress Bar (Hidden when 8 is unlocked) ── */}
      {!isUnlocked8 ? (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 pointer-events-auto bg-black/80 border border-white/15 px-6 py-3 rounded-2xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-text-primary">CORE CHARGE</span>
            <div className="w-56 h-3 rounded-full bg-white/10 overflow-hidden border border-white/10 p-0.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 transition-all duration-300 shadow-[0_0_15px_rgba(0,243,255,0.8)]"
                style={{ width: `${score}%` }}
              />
            </div>
            <span className="text-xs font-bold text-cyan-400 tabular-nums">{score}%</span>
          </div>
        </div>
      ) : (
        /* ── Minimal Restart Button Centered at Bottom when 8 is Unlocked ── */
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 font-mono text-xs px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/20 shadow-2xl transition-all active:scale-95 cursor-pointer"
          >
            <ArrowsCounterClockwise size={14} />
            Restart
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 font-mono text-xs px-6 py-2.5 rounded-full bg-cyan-400 hover:bg-cyan-300 text-black font-bold shadow-2xl transition-all active:scale-95 cursor-pointer"
          >
            <X size={14} weight="bold" />
            Close
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
