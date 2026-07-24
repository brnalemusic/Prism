import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowsCounterClockwise,
  Sparkle,
  SpeakerHigh,
  SpeakerSimpleX,
  Magnet,
  Atom,
  Lightning,
  Flame,
  Planet,
  Globe
} from '@phosphor-icons/react'

// --- Web Audio API Procedural Synthesizer ---
class QuantumAudioSynth {
  private ctx: AudioContext | null = null
  private isMuted: boolean = false

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

  public playPop(pitchMultiplier: number = 1.0, velocity: number = 1.0): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    // Pentatonic frequency scale for harmonic pleasantness
    const baseFreqs = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0]
    const index = Math.floor(Math.abs(pitchMultiplier * 10)) % baseFreqs.length
    const freq = baseFreqs[index] || 440.0

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.08)

    const vol = Math.min(0.25, 0.05 + velocity * 0.02)
    gain.gain.setValueAtTime(vol, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.12)
  }

  public playVortexHum(strength: number): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(55, now)
    osc.frequency.linearRampToValueAtTime(110 + strength * 40, now + 0.1)

    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(200 + strength * 300, now)

    gain.gain.setValueAtTime(0.02 * strength, now)
    gain.gain.linearRampToValueAtTime(0.001, now + 0.12)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.12)
  }

  public playEnergyCharge(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const notes = [440, 554.37, 659.25, 880, 1108.73]
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, now + idx * 0.04)

      gain.gain.setValueAtTime(0.08, now + idx * 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.2)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now + idx * 0.04)
      osc.stop(now + idx * 0.04 + 0.2)
    })
  }

  public playQuantum8Activation(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    // Ascending arpeggio chime
    const chord = [220, 329.63, 440, 554.37, 659.25, 880, 1108.73, 1318.51, 1760]
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = i % 2 === 0 ? 'sine' : 'triangle'
      osc.frequency.setValueAtTime(freq, now + i * 0.06)

      gain.gain.setValueAtTime(0.12, now + i * 0.06)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.8)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now + i * 0.06)
      osc.stop(now + i * 0.06 + 0.8)
    })
  }
}

// --- Ball & Particle Types ---
interface QuantumSphere {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  hue: number
  mass: number
  charged: boolean
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

type GravityMode = 'attract' | 'repel' | 'zerog' | 'earth'

export function QuantumPhysicsGame({ onClose }: { onClose: () => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const synthRef = useRef<QuantumAudioSynth>(new QuantumAudioSynth())

  const [gravityMode, setGravityMode] = useState<GravityMode>('attract')
  const [isMuted, setIsMuted] = useState(false)
  const [energy, setEnergy] = useState<number>(0)
  const [isUnlocked8, setIsUnlocked8] = useState<boolean>(false)

  const mousePosRef = useRef<{ x: number; y: number; isDown: boolean }>({
    x: 0,
    y: 0,
    isDown: false
  })
  const draggedBallRef = useRef<QuantumSphere | null>(null)

  // Initialization & Animation Loop Ref
  const spheresRef = useRef<QuantumSphere[]>([])
  const particlesRef = useRef<ParticleSpark[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const energyRef = useRef<number>(0)

  // Handle Mute Toggle
  const toggleMute = (): void => {
    const nextState = !isMuted
    setIsMuted(nextState)
    synthRef.current.setMuted(nextState)
  }

  // Create initial spheres
  const initSpheres = (width: number, height: number): void => {
    const spheres: QuantumSphere[] = []
    const count = 22
    const colors = [
      '#00f3ff', // Quantum Cyan
      '#7000ff', // Violet Neon
      '#ff0077', // Plasma Pink
      '#00ffaa', // Matrix Emerald
      '#ffaa00' // Solar Amber
    ]

    for (let i = 0; i < count; i++) {
      const radius = 14 + Math.random() * 18
      const hue = Math.floor(Math.random() * 360)
      spheres.push({
        id: i,
        x: Math.random() * (width - 100) + 50,
        y: Math.random() * (height - 100) + 50,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        radius,
        color: colors[i % colors.length],
        hue,
        mass: radius,
        charged: false
      })
    }
    spheresRef.current = spheres
  }

  const spawnSparks = (x: number, y: number, color: string, count: number = 8): void => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 6
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

  // Restart / Reset
  const handleReset = (): void => {
    energyRef.current = 0
    setEnergy(0)
    setIsUnlocked8(false)
    if (canvasRef.current) {
      initSpheres(canvasRef.current.width, canvasRef.current.height)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas dimensions
    const resizeCanvas = (): void => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight
      if (spheresRef.current.length === 0) {
        initSpheres(canvas.width, canvas.height)
      }
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    let shaderTime = 0

    // Main Game Loop
    const loop = (): void => {
      shaderTime += 0.02
      const width = canvas.width
      const height = canvas.height

      // Clear Canvas
      ctx.fillStyle = '#05070f'
      ctx.fillRect(0, 0, width, height)

      // Background Quantum Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'
      ctx.lineWidth = 1
      const gridSize = 40
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

      // Render Gravity Vortex / Cursor Indicator
      const mouse = mousePosRef.current
      if (mouse.isDown && !isUnlocked8) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(mouse.x, mouse.y, 45 + Math.sin(shaderTime * 5) * 5, 0, Math.PI * 2)
        ctx.strokeStyle =
          gravityMode === 'attract'
            ? 'rgba(0, 243, 255, 0.5)'
            : gravityMode === 'repel'
              ? 'rgba(255, 0, 119, 0.5)'
              : 'rgba(112, 0, 255, 0.5)'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 6])
        ctx.stroke()
        ctx.restore()

        // Sound effect
        synthRef.current.playVortexHum(0.8)
      }

      // Core Energy Center Ring
      const centerX = width / 2
      const centerY = height / 2
      ctx.save()
      ctx.beginPath()
      ctx.arc(centerX, centerY, 60, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(0, 243, 255, ${0.15 + Math.sin(shaderTime * 2) * 0.1})`
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()

      // Update & Render Quantum Spheres
      const spheres = spheresRef.current

      spheres.forEach((sphere, i) => {
        // Physics update (Skip dragged ball)
        if (sphere !== draggedBallRef.current) {
          // Interactive Gravity Forces
          if (mouse.isDown) {
            const dx = mouse.x - sphere.x
            const dy = mouse.y - sphere.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist > 5 && dist < 450) {
              const force = (400 / (dist + 50)) * (gravityMode === 'repel' ? -1.5 : 1.2)
              sphere.vx += (dx / dist) * force
              sphere.vy += (dy / dist) * force
            }
          }

          // Apply Gravity Modes
          if (gravityMode === 'earth') {
            sphere.vy += 0.25
          } else if (gravityMode === 'attract' && !mouse.isDown) {
            // Slight core pull
            const dx = centerX - sphere.x
            const dy = centerY - sphere.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist > 10) {
              sphere.vx += (dx / dist) * 0.08
              sphere.vy += (dy / dist) * 0.08
            }
          }

          // Velocity Dampening
          sphere.vx *= 0.99
          sphere.vy *= 0.99

          // Position Update
          sphere.x += sphere.vx
          sphere.y += sphere.vy

          // Boundary Collisions
          if (sphere.x - sphere.radius < 0) {
            sphere.x = sphere.radius
            sphere.vx *= -0.85
            synthRef.current.playPop(sphere.radius / 20, Math.abs(sphere.vx))
          }
          if (sphere.x + sphere.radius > width) {
            sphere.x = width - sphere.radius
            sphere.vx *= -0.85
            synthRef.current.playPop(sphere.radius / 20, Math.abs(sphere.vx))
          }
          if (sphere.y - sphere.radius < 0) {
            sphere.y = sphere.radius
            sphere.vy *= -0.85
            synthRef.current.playPop(sphere.radius / 20, Math.abs(sphere.vy))
          }
          if (sphere.y + sphere.radius > height) {
            sphere.y = height - sphere.radius
            sphere.vy *= -0.85
            synthRef.current.playPop(sphere.radius / 20, Math.abs(sphere.vy))
          }
        }

        // Sphere-Sphere Collisions
        for (let j = i + 1; j < spheres.length; j++) {
          const other = spheres[j]
          const dx = other.x - sphere.x
          const dy = other.y - sphere.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = sphere.radius + other.radius

          if (dist < minDist) {
            // Collision Response
            const angle = Math.atan2(dy, dx)
            const overlap = minDist - dist

            // Separate
            const moveX = Math.cos(angle) * overlap * 0.5
            const moveY = Math.sin(angle) * overlap * 0.5

            if (sphere !== draggedBallRef.current) {
              sphere.x -= moveX
              sphere.y -= moveY
            }
            if (other !== draggedBallRef.current) {
              other.x += moveX
              other.y += moveY
            }

            // Elastic Collision Velocity
            const nx = dx / dist
            const ny = dy / dist
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

            // Audio & Spark FX
            const hitVel = Math.sqrt(sphere.vx * sphere.vx + sphere.vy * sphere.vy)
            if (hitVel > 0.8) {
              synthRef.current.playPop(sphere.radius / 15, hitVel)
              spawnSparks(
                (sphere.x + other.x) / 2,
                (sphere.y + other.y) / 2,
                sphere.color,
                Math.min(6, Math.floor(hitVel))
              )

              // Build up Quantum Energy!
              if (energyRef.current < 100) {
                const nextEnergy = Math.min(100, energyRef.current + 0.35)
                energyRef.current = nextEnergy
                setEnergy(Math.floor(nextEnergy))

                if (nextEnergy >= 100 && !isUnlocked8) {
                  setIsUnlocked8(true)
                  synthRef.current.playQuantum8Activation()
                }
              }
            }
          }
        }

        // Draw Sphere Glow & Body
        ctx.save()
        ctx.beginPath()
        ctx.arc(sphere.x, sphere.y, sphere.radius, 0, Math.PI * 2)

        const gradient = ctx.createRadialGradient(
          sphere.x - sphere.radius * 0.3,
          sphere.y - sphere.radius * 0.3,
          sphere.radius * 0.1,
          sphere.x,
          sphere.y,
          sphere.radius
        )
        gradient.addColorStop(0, '#ffffff')
        gradient.addColorStop(0.4, sphere.color)
        gradient.addColorStop(1, 'rgba(0,0,0,0.8)')

        ctx.fillStyle = gradient
        ctx.shadowColor = sphere.color
        ctx.shadowBlur = 15
        ctx.fill()
        ctx.restore()
      })

      // Update & Draw Particle Sparks
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i]
        p.x += p.vx
        p.y += p.vy
        p.alpha -= 0.025
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
        ctx.shadowBlur = 8
        ctx.fill()
        ctx.restore()
      }

      // --- STYLIZED QUANTUM '8' SHADER REVEAL ---
      if (isUnlocked8) {
        ctx.save()

        // Dark quantum aura backdrop
        ctx.fillStyle = 'rgba(5, 7, 15, 0.85)'
        ctx.fillRect(0, 0, width, height)

        const t = shaderTime

        // Render Hyper-Stylized Procedural Quantum 8
        const r8 = Math.min(width, height) * 0.16
        const center8X = width / 2
        const center8Y = height / 2

        // Top loop center & Bottom loop center of '8'
        const topY = center8Y - r8 * 0.85
        const botY = center8Y + r8 * 0.85

        // Interactive mouse distortion effect on stylized 8
        const mDx = (mouse.x - center8X) * 0.05
        const mDy = (mouse.y - center8Y) * 0.05

        // Glowing Rays behind 8
        for (let i = 0; i < 16; i++) {
          const angle = (i / 16) * Math.PI * 2 + t * 0.5
          ctx.beginPath()
          ctx.moveTo(center8X, center8Y)
          ctx.lineTo(center8X + Math.cos(angle) * width, center8Y + Math.sin(angle) * height)
          ctx.strokeStyle = `rgba(0, 243, 255, ${0.03 + Math.sin(t * 3 + i) * 0.02})`
          ctx.lineWidth = 3
          ctx.stroke()
        }

        // Render Stylized Outer Infinity Glow Rings
        ;[
          { y: topY, r: r8 },
          { y: botY, r: r8 * 1.05 }
        ].forEach((ring, idx) => {
          ctx.beginPath()
          ctx.arc(center8X + mDx * (idx ? 1 : -1), ring.y + mDy, ring.r, 0, Math.PI * 2)

          const ringGrad = ctx.createConicGradient(t + idx * Math.PI, center8X, ring.y)
          ringGrad.addColorStop(0, '#00f3ff')
          ringGrad.addColorStop(0.33, '#7000ff')
          ringGrad.addColorStop(0.66, '#ff0077')
          ringGrad.addColorStop(1, '#00f3ff')

          ctx.strokeStyle = ringGrad
          ctx.lineWidth = 16 + Math.sin(t * 4 + idx) * 3
          ctx.shadowColor = idx === 0 ? '#00f3ff' : '#ff0077'
          ctx.shadowBlur = 30
          ctx.stroke()

          // Inner plasma core ring
          ctx.beginPath()
          ctx.arc(center8X + mDx * (idx ? 1 : -1), ring.y + mDy, ring.r, 0, Math.PI * 2)
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 4
          ctx.stroke()
        })

        // Quantum Particles orbiting the stylized 8
        for (let p = 0; p < 24; p++) {
          const pAngle = (p / 24) * Math.PI * 2 + t * 1.5
          const isTop = p % 2 === 0
          const pY = isTop ? topY : botY
          const px = center8X + Math.cos(pAngle) * (r8 + 15)
          const py = pY + Math.sin(pAngle) * (r8 + 15)

          ctx.beginPath()
          ctx.arc(px, py, 3.5, 0, Math.PI * 2)
          ctx.fillStyle = isTop ? '#00f3ff' : '#ff0077'
          ctx.shadowColor = '#ffffff'
          ctx.shadowBlur = 10
          ctx.fill()
        }

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

    // Check if clicked on a ball to drag
    const clickedBall = spheresRef.current.find((s) => {
      const dx = s.x - x
      const dy = s.y - y
      return Math.sqrt(dx * dx + dy * dy) <= s.radius + 5
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

  // Force unlock 8 button for instant showcase
  const triggerInstant8 = (): void => {
    energyRef.current = 100
    setEnergy(100)
    setIsUnlocked8(true)
    synthRef.current.playQuantum8Activation()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl animate-fade-in select-none">
      {/* ── Top Bar Controls ── */}
      <div className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between pointer-events-none">
        {/* Left Badge */}
        <div className="flex items-center gap-3 bg-white/[0.06] border border-white/10 rounded-2xl px-4 py-2 backdrop-blur-md pointer-events-auto">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-primary/20 text-accent-primary">
            <Atom size={20} className="animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-wide">
                PRISM 8 QUANTUM CORE
              </span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-primary/20 text-accent-primary border border-accent-primary/30">
                v8.0.0
              </span>
            </div>
            <span className="text-[10px] text-text-secondary/70">
              Interactive Physics & WebGL Shader Easter Egg
            </span>
          </div>
        </div>

        {/* Center Gravity Toolbar */}
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
          {/* Sound Toggle */}
          <button
            onClick={toggleMute}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10 text-white hover:bg-white/15 transition-all"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <SpeakerSimpleX size={18} /> : <SpeakerHigh size={18} />}
          </button>

          {/* Reset */}
          <button
            onClick={handleReset}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10 text-white hover:bg-white/15 transition-all"
            title="Reset Game"
          >
            <ArrowsCounterClockwise size={18} />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 border border-white/20 text-white hover:bg-red-500/80 transition-all cursor-pointer"
            title="Close Easter Egg"
          >
            <X size={20} weight="bold" />
          </button>
        </div>
      </div>

      {/* ── Canvas Physics Area ── */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* ── Bottom HUD / Progress Gauge ── */}
      {!isUnlocked8 ? (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 pointer-events-auto bg-black/70 border border-white/10 px-6 py-3 rounded-2xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
              <Lightning size={14} className="text-accent-primary animate-pulse" />
              Quantum Charge
            </span>
            <div className="w-48 h-2.5 rounded-full bg-white/10 overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-accent-primary via-purple-500 to-pink-500 transition-all duration-300 shadow-[0_0_12px_rgba(0,243,255,0.8)]"
                style={{ width: `${energy}%` }}
              />
            </div>
            <span className="text-xs font-bold text-accent-primary tabular-nums">{energy}%</span>
          </div>

          <div className="flex items-center gap-4 text-[10px] text-text-secondary/60">
            <span>Bounce spheres or drag in vortex to charge singularity</span>
            <button
              onClick={triggerInstant8}
              className="text-accent-primary hover:underline font-semibold cursor-pointer"
            >
              Instant Core Reveal
            </button>
          </div>
        </div>
      ) : (
        /* ── Victory Stylized 8 Banner Overlay ── */
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-3 pointer-events-auto bg-gradient-to-b from-black/80 to-black/95 border border-accent-primary/40 px-8 py-5 rounded-3xl backdrop-blur-2xl shadow-[0_0_50px_rgba(0,243,255,0.3)] animate-soft-pop text-center max-w-md">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-accent-primary/15 border border-accent-primary/30 text-accent-primary text-xs font-bold">
            <Sparkle size={14} weight="fill" />
            SINGULARITY ACTIVATED
          </div>
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-500">
            PRISM 8 QUANTUM CORE
          </h2>
          <p className="text-xs text-text-secondary/80 leading-relaxed">
            Welcome to the future of AI workspace assistance. Prism v8.0.0 initialized with hyper-speed intelligence engine.
          </p>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-4 py-2 text-xs font-bold text-white transition-all cursor-pointer"
            >
              <ArrowsCounterClockwise size={14} />
              Replay Playground
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-2 rounded-xl bg-accent-primary hover:bg-accent-primary/90 text-black px-5 py-2 text-xs font-bold transition-all shadow-lg cursor-pointer"
            >
              Close & Enjoy Prism
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
