import React, { useEffect, useRef, useState } from 'react'
import { X, RotateCcw, Trophy, Sparkles, Bomb as BombIcon, FileText } from '@phosphor-icons/react'

// --- Web Audio API Sound Synthesizer ---
class SoundSynthesizer {
  private ctx: AudioContext | null = null

  private getContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  // Play high-speed slash swoosh sound
  playSwoosh(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    // Noise buffer
    const bufferSize = ctx.sampleRate * 0.12
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    // Filter sweep for blade swoosh
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(800, now)
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.05)
    filter.frequency.exponentialRampToValueAtTime(400, now + 0.12)
    filter.Q.setValueAtTime(3.0, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.25, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    noise.start(now)
    noise.stop(now + 0.12)
  }

  // Play paper shred / tear sound effect
  playShred(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const bufferSize = ctx.sampleRate * 0.15
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04))
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.setValueAtTime(1200, now)
    filter.frequency.linearRampToValueAtTime(3500, now + 0.08)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)

    // Crisp high snap oscillator overlay
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(900, now)
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.06)

    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(0.2, now)
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    osc.connect(oscGain)
    oscGain.connect(ctx.destination)

    noise.start(now)
    noise.stop(now + 0.15)
    osc.start(now)
    osc.stop(now + 0.06)
  }

  // Play score escalation chime sound (higher pitch per score)
  playScoreChime(score: number): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 1046.5] // C5 to C6 pentatonic/diatonic scale
    const baseFreq = notes[Math.min(score - 1, notes.length - 1)] || 523.25

    const osc = ctx.createOscillator()
    const osc2 = ctx.createOscillator()

    osc.type = 'sine'
    osc2.type = 'triangle'

    osc.frequency.setValueAtTime(baseFreq, now)
    osc2.frequency.setValueAtTime(baseFreq * 2, now) // Harmonics

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)

    osc.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc2.start(now)
    osc.stop(now + 0.35)
    osc2.stop(now + 0.35)
  }

  // Play explosive bomb detonate sound
  playExplosion(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime

    // Sub-bass frequency drop
    const subOsc = ctx.createOscillator()
    subOsc.type = 'sine'
    subOsc.frequency.setValueAtTime(160, now)
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.4)

    const subGain = ctx.createGain()
    subGain.gain.setValueAtTime(0.6, now)
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)

    // Noise blast
    const bufferSize = ctx.sampleRate * 0.45
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1000, now)
    filter.frequency.linearRampToValueAtTime(100, now + 0.4)

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.5, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)

    subOsc.connect(subGain)
    subGain.connect(ctx.destination)

    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(ctx.destination)

    subOsc.start(now)
    subOsc.stop(now + 0.5)
    noise.start(now)
    noise.stop(now + 0.45)
  }

  // Play epic majestic victory fanfare arpeggio for reaching score 7
  playVictoryFanfare(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98] // C5, E5, G5, C6, E6, G6
    arpeggio.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.08
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)

      gain.gain.setValueAtTime(0.001, now)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.6)
    })
  }
}

const audioSynth = new SoundSynthesizer()

// --- Types ---
interface Point {
  x: number
  y: number
  time: number
}

interface Item {
  id: number
  type: 'document' | 'bomb'
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  vRot: number
  radius: number
  docType?: { label: string; ext: string; color: string }
  isSliced: boolean
  slicedAngle?: number
  halfLeft?: { x: number; y: number; vx: number; vy: number; rot: number; vRot: number }
  halfRight?: { x: number; y: number; vx: number; vy: number; rot: number; vRot: number }
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  alpha: number
  decay: number
}

const DOC_TYPES = [
  { label: 'Prism Engine', ext: '.prism', color: '#00F0FF' },
  { label: 'Architecture', ext: '.docx', color: '#3B82F6' },
  { label: 'Source Code', ext: '.ts', color: '#A855F7' },
  { label: 'PDF Report', ext: '.pdf', color: '#EF4444' },
  { label: 'JSON Config', ext: '.json', color: '#10B981' },
  { label: 'Markdown Spec', ext: '.md', color: '#F59E0B' }
]

export const DocumentShredderGame: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [victory, setVictory] = useState(false)

  const scoreRef = useRef(0)
  const isGameOverRef = useRef(false)
  const isVictoryRef = useRef(false)

  // Track user drag path
  const trailRef = useRef<Point[]>([])
  const isMouseDownRef = useRef(false)

  // Game entities
  const itemsRef = useRef<Item[]>([])
  const particlesRef = useRef<Particle[]>([])
  const nextItemIdRef = useRef(1)
  const spawnTimerRef = useRef(0)
  const screenShakeRef = useRef(0)

  // Initialize and run Canvas Game Loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const handleResize = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    handleResize()
    window.addEventListener('resize', handleResize)

    // Helper: spawn item
    const spawnItem = (): void => {
      if (isGameOverRef.current || isVictoryRef.current) return

      const w = canvas.width
      const h = canvas.height

      // Determine item type: 75% document, 25% bomb
      const isBomb = Math.random() < 0.25
      const startX = Math.random() * (w - 200) + 100
      const startY = h + 40

      // Velocity targeting upper screen arc
      const vx = (Math.random() - 0.5) * 6
      const vy = -(Math.random() * 4 + 13) // Launch speed upward

      const docType = isBomb ? undefined : DOC_TYPES[Math.floor(Math.random() * DOC_TYPES.length)]

      itemsRef.current.push({
        id: nextItemIdRef.current++,
        type: isBomb ? 'bomb' : 'document',
        x: startX,
        y: startY,
        vx,
        vy,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.1,
        radius: isBomb ? 32 : 45,
        docType,
        isSliced: false
      })
    }

    // Helper: Line-Circle collision test for slashing
    const checkLineCircleIntersect = (
      p1: Point,
      p2: Point,
      cx: number,
      cy: number,
      r: number
    ): boolean => {
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const len = Math.hypot(dx, dy)
      if (len === 0) return false

      const u = ((cx - p1.x) * dx + (cy - p1.y) * dy) / (len * len)
      const clampedU = Math.max(0, Math.min(1, u))

      const nearestX = p1.x + clampedU * dx
      const nearestY = p1.y + clampedU * dy

      const dist = Math.hypot(cx - nearestX, cy - nearestY)
      return dist <= r
    }

    // Helper: Spawn particles
    const spawnParticles = (x: number, y: number, color: string, count = 20): void => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = Math.random() * 8 + 2
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: Math.random() * 6 + 3,
          alpha: 1,
          decay: Math.random() * 0.03 + 0.015
        })
      }
    }

    // Main Game Render & Update Loop
    const loop = (): void => {
      const w = canvas.width
      const h = canvas.height
      const now = Date.now()

      // Screen Shake handling
      let shakeOffsetX = 0
      let shakeOffsetY = 0
      if (screenShakeRef.current > 0) {
        shakeOffsetX = (Math.random() - 0.5) * screenShakeRef.current
        shakeOffsetY = (Math.random() - 0.5) * screenShakeRef.current
        screenShakeRef.current *= 0.88
        if (screenShakeRef.current < 0.5) screenShakeRef.current = 0
      }

      ctx.save()
      ctx.translate(shakeOffsetX, shakeOffsetY)

      // Clear Screen with subtle dark overlay
      ctx.fillStyle = '#090B10'
      ctx.fillRect(-20, -20, w + 40, h + 40)

      // Draw subtle background grid/glow
      const bgGlow = ctx.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, Math.max(w, h))
      bgGlow.addColorStop(0, 'rgba(0, 240, 255, 0.04)')
      bgGlow.addColorStop(0.5, 'rgba(120, 50, 255, 0.02)')
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = bgGlow
      ctx.fillRect(0, 0, w, h)

      // Clean old trail points (> 220ms)
      trailRef.current = trailRef.current.filter((p) => now - p.time < 220)

      // Check Slices if trail has points
      const trail = trailRef.current
      if (trail.length >= 2) {
        const lastP = trail[trail.length - 1]
        const prevP = trail[trail.length - 2]

        itemsRef.current.forEach((item) => {
          if (!item.isSliced && !isGameOverRef.current && !isVictoryRef.current) {
            if (checkLineCircleIntersect(prevP, lastP, item.x, item.y, item.radius)) {
              item.isSliced = true

              const sliceAngle = Math.atan2(lastP.y - prevP.y, lastP.x - prevP.x)
              item.slicedAngle = sliceAngle

              if (item.type === 'document') {
                // Audio effect
                audioSynth.playShred()

                // Half pieces velocities perpendicular to slice
                const perpAngle = sliceAngle + Math.PI / 2
                const sepSpeed = 5

                item.halfLeft = {
                  x: item.x,
                  y: item.y,
                  vx: item.vx + Math.cos(perpAngle) * sepSpeed,
                  vy: item.vy + Math.sin(perpAngle) * sepSpeed - 2,
                  rot: item.rotation,
                  vRot: -0.15
                }
                item.halfRight = {
                  x: item.x,
                  y: item.y,
                  vx: item.vx - Math.cos(perpAngle) * sepSpeed,
                  vy: item.vy - Math.sin(perpAngle) * sepSpeed - 2,
                  rot: item.rotation,
                  vRot: 0.15
                }

                // Spawn paper confetti particles
                spawnParticles(item.x, item.y, item.docType?.color || '#00F0FF', 25)

                // Increase Score
                const newScore = scoreRef.current + 1
                scoreRef.current = newScore
                setScore(newScore)
                audioSynth.playScoreChime(newScore)

                // Check Victory (7 Documents)
                if (newScore >= 7) {
                  isVictoryRef.current = true
                  setVictory(true)
                  audioSynth.playVictoryFanfare()
                  // Clear items
                  itemsRef.current = []
                }
              } else if (item.type === 'bomb') {
                // Bomb explosion!
                audioSynth.playExplosion()
                screenShakeRef.current = 35
                spawnParticles(item.x, item.y, '#EF4444', 50)
                spawnParticles(item.x, item.y, '#F59E0B', 40)
                isGameOverRef.current = true
                setGameOver(true)
              }
            }
          }
        })
      }

      // Spawner logic
      if (!isGameOverRef.current && !isVictoryRef.current) {
        spawnTimerRef.current++
        if (spawnTimerRef.current > 55) {
          spawnItem()
          // Occasionally spawn a second item simultaneously
          if (Math.random() < 0.4) spawnItem()
          spawnTimerRef.current = 0
        }
      }

      // Update & Draw Items
      const gravity = 0.38
      itemsRef.current.forEach((item) => {
        if (!item.isSliced) {
          item.x += item.vx
          item.y += item.vy
          item.vy += gravity
          item.rotation += item.vRot

          // Draw intact item
          ctx.save()
          ctx.translate(item.x, item.y)
          ctx.rotate(item.rotation)

          if (item.type === 'document') {
            // Render Document Card
            const cardW = 64
            const cardH = 80

            // Glowing Card Background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
            ctx.strokeStyle = item.docType?.color || '#00F0FF'
            ctx.lineWidth = 2
            ctx.shadowColor = item.docType?.color || '#00F0FF'
            ctx.shadowBlur = 12

            ctx.beginPath()
            ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 8)
            ctx.fill()
            ctx.stroke()

            // Text lines on doc
            ctx.shadowBlur = 0
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
            ctx.fillRect(-cardW / 2 + 10, -cardH / 2 + 16, 28, 4)
            ctx.fillRect(-cardW / 2 + 10, -cardH / 2 + 26, 44, 3)
            ctx.fillRect(-cardW / 2 + 10, -cardH / 2 + 35, 36, 3)
            ctx.fillRect(-cardW / 2 + 10, -cardH / 2 + 44, 40, 3)

            // Extension Badge
            ctx.fillStyle = item.docType?.color || '#00F0FF'
            ctx.beginPath()
            ctx.roundRect(-cardW / 2 + 8, cardH / 2 - 20, 48, 14, 4)
            ctx.fill()

            ctx.fillStyle = '#000000'
            ctx.font = 'bold 9px Outfit, sans-serif'
            ctx.textAlign = 'center'
            ctx.fillText(item.docType?.ext || '.prism', -cardW / 2 + 32, cardH / 2 - 10)
          } else {
            // Render Bomb
            const r = item.radius
            ctx.shadowColor = '#EF4444'
            ctx.shadowBlur = 18

            // Metallic Sphere
            const bombGrad = ctx.createRadialGradient(-r / 3, -r / 3, 4, 0, 0, r)
            bombGrad.addColorStop(0, '#475569')
            bombGrad.addColorStop(0.6, '#1E293B')
            bombGrad.addColorStop(1, '#0F172A')

            ctx.fillStyle = bombGrad
            ctx.strokeStyle = '#EF4444'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()

            // Fuse and Warning Icon
            ctx.shadowBlur = 0
            ctx.fillStyle = '#EF4444'
            ctx.font = 'bold 20px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('💣', 0, 0)

            // Burning Fuse Sparks
            const sparkAngle = Math.random() * Math.PI * 2
            ctx.fillStyle = '#F59E0B'
            ctx.beginPath()
            ctx.arc(Math.cos(sparkAngle) * (r + 4), Math.sin(sparkAngle) * (r + 4), 3, 0, Math.PI * 2)
            ctx.fill()
          }

          ctx.restore()
        } else if (item.halfLeft && item.halfRight) {
          // Update and Draw Sliced Halves
          item.halfLeft.x += item.halfLeft.vx
          item.halfLeft.y += item.halfLeft.vy
          item.halfLeft.vy += gravity
          item.halfLeft.rot += item.halfLeft.vRot

          item.halfRight.x += item.halfRight.vx
          item.halfRight.y += item.halfRight.vy
          item.halfRight.vy += gravity
          item.halfRight.rot += item.halfRight.vRot

          // Render Left Half
          ctx.save()
          ctx.translate(item.halfLeft.x, item.halfLeft.y)
          ctx.rotate(item.halfLeft.rot)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
          ctx.strokeStyle = item.docType?.color || '#00F0FF'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.roundRect(-30, -40, 28, 80, 4)
          ctx.fill()
          ctx.stroke()
          ctx.restore()

          // Render Right Half
          ctx.save()
          ctx.translate(item.halfRight.x, item.halfRight.y)
          ctx.rotate(item.halfRight.rot)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
          ctx.strokeStyle = item.docType?.color || '#00F0FF'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.roundRect(2, -40, 28, 80, 4)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      })

      // Filter out offscreen items
      itemsRef.current = itemsRef.current.filter((item) => {
        if (!item.isSliced) return item.y < h + 100
        return item.halfLeft && item.halfLeft.y < h + 100
      })

      // Update & Draw Particles
      particlesRef.current.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        p.alpha -= p.decay

        if (p.alpha > 0) {
          ctx.save()
          ctx.globalAlpha = Math.max(0, p.alpha)
          ctx.fillStyle = p.color
          ctx.shadowColor = p.color
          ctx.shadowBlur = 8
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      })
      particlesRef.current = particlesRef.current.filter((p) => p.alpha > 0)

      // Draw Mouse Blade Trail
      if (trail.length >= 2) {
        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        for (let i = 1; i < trail.length; i++) {
          const p1 = trail[i - 1]
          const p2 = trail[i]
          const progress = i / trail.length
          const width = progress * 7 + 1

          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)

          ctx.strokeStyle = `rgba(0, 240, 255, ${progress})`
          ctx.shadowColor = '#00F0FF'
          ctx.shadowBlur = 12
          ctx.lineWidth = width
          ctx.stroke()
        }

        ctx.restore()
      }

      ctx.restore() // Restore shake translate
      animationFrameId = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Mouse / Touch Event Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    isMouseDownRef.current = true
    trailRef.current = [{ x: e.clientX, y: e.clientY, time: Date.now() }]
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!isMouseDownRef.current) return
    const newPoint = { x: e.clientX, y: e.clientY, time: Date.now() }
    trailRef.current.push(newPoint)

    // Play blade swoosh sound periodically when moving fast
    const trail = trailRef.current
    if (trail.length >= 3) {
      const p1 = trail[trail.length - 3]
      const p2 = trail[trail.length - 1]
      const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (speed > 80 && Math.random() < 0.25) {
        audioSynth.playSwoosh()
      }
    }
  }

  const handlePointerUp = (): void => {
    isMouseDownRef.current = false
    trailRef.current = []
  }

  const restartGame = (): void => {
    itemsRef.current = []
    particlesRef.current = []
    trailRef.current = []
    scoreRef.current = 0
    isGameOverRef.current = false
    isVictoryRef.current = false
    setScore(0)
    setGameOver(false)
    setVictory(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl animate-fade-in select-none overflow-hidden">
      {/* Game Canvas */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute inset-0 cursor-crosshair touch-none"
      />

      {/* Top Header Controls & Score */}
      <div className="absolute top-6 left-8 right-8 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-3 bg-white/[0.06] border border-white/10 backdrop-blur-md px-5 py-2.5 rounded-2xl shadow-2xl">
          <FileText size={22} weight="bold" className="text-accent-primary animate-pulse" />
          <span className="text-sm font-medium text-text-secondary">Shredded Documents:</span>
          <span className="text-xl font-black text-white tracking-wider">
            {score} <span className="text-xs text-text-secondary font-semibold">/ 7</span>
          </span>
        </div>

        <button
          onClick={onClose}
          className="pointer-events-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold px-4 py-2.5 rounded-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
        >
          <X size={18} weight="bold" />
          <span>Exit Game</span>
        </button>
      </div>

      {/* GAME OVER MODAL */}
      {gameOver && (
        <div className="relative z-20 flex flex-col items-center justify-center p-8 bg-surface-primary/90 border border-red-500/30 rounded-3xl backdrop-blur-2xl shadow-2xl animate-soft-pop text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-4 text-red-400 animate-bounce">
            <BombIcon size={36} weight="fill" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">BOOM! BOMB HIT!</h2>
          <p className="text-xs text-text-secondary mb-6 leading-relaxed">
            The document shredder overheated after hitting an explosive bomb. Try again to reach 7 shredded documents!
          </p>
          <div className="flex items-center gap-3 w-full">
            <button
              onClick={restartGame}
              className="flex-1 flex items-center justify-center gap-2 bg-accent-primary hover:bg-accent-primary/90 text-white font-bold text-xs py-3 rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
            >
              <RotateCcw size={16} weight="bold" />
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* CINEMATIC STYLIZED "7" VICTORY REWARD */}
      {victory && (
        <div className="relative z-30 flex flex-col items-center justify-center p-10 bg-black/80 border border-white/20 rounded-3xl backdrop-blur-3xl shadow-[0_0_80px_rgba(0,240,255,0.4)] animate-soft-pop text-center max-w-md overflow-hidden">
          {/* Ambient Background Rays */}
          <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-purple-500/10 to-pink-500/10 animate-pulse pointer-events-none" />

          <div className="relative flex items-center justify-center my-6">
            {/* Holographic Glowing 7 */}
            <div className="relative flex items-center justify-center">
              <span className="text-[140px] font-black leading-none bg-gradient-to-b from-cyan-300 via-purple-400 to-pink-500 bg-clip-text text-transparent drop-shadow-[0_0_35px_rgba(0,240,255,0.8)] tracking-tighter select-none font-mono">
                7
              </span>

              {/* Glowing Prismatic Ring Overlay */}
              <div className="absolute -inset-6 rounded-full border-2 border-cyan-400/40 animate-spin-slow pointer-events-none blur-[1px]" />
              <div className="absolute -inset-10 rounded-full border border-purple-500/30 animate-pulse pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <Trophy size={20} weight="fill" className="text-yellow-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">
              Prism v7 Easter Egg Mastered
            </span>
            <Sparkles size={20} weight="fill" className="text-yellow-400" />
          </div>

          <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight">
            MAXIMUM LEVEL 7 ACHIEVED
          </h2>

          <p className="text-xs text-text-secondary/80 mb-6 leading-relaxed max-w-xs">
            You successfully shredded 7 documents without touching a single bomb! You have unlocked Prism 7's secret master badge.
          </p>

          <div className="flex items-center gap-3 w-full z-10">
            <button
              onClick={restartGame}
              className="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs py-3 rounded-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            >
              <RotateCcw size={16} weight="bold" />
              Play Again
            </button>
            <button
              onClick={onClose}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs py-3 rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
            >
              <X size={16} weight="bold" />
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DocumentShredderGame
