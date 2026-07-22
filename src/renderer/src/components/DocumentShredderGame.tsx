import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowsCounterClockwise, Flame, FileText } from '@phosphor-icons/react'

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
    const bufferSize = ctx.sampleRate * 0.12
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

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

  // Play score escalation chime sound
  playScoreChime(score: number): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 1046.5]
    const baseFreq = notes[Math.min(score - 1, notes.length - 1)] || 523.25

    const osc = ctx.createOscillator()
    const osc2 = ctx.createOscillator()

    osc.type = 'sine'
    osc2.type = 'triangle'

    osc.frequency.setValueAtTime(baseFreq, now)
    osc2.frequency.setValueAtTime(baseFreq * 2, now)

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

    const subOsc = ctx.createOscillator()
    subOsc.type = 'sine'
    subOsc.frequency.setValueAtTime(160, now)
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.4)

    const subGain = ctx.createGain()
    subGain.gain.setValueAtTime(0.6, now)
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)

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

  // Play crystalline shimmer synth sound on 7 interactive hover
  playShimmer(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const freq = 1200 + Math.random() * 800

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now)

    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.04, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.25)
  }

  // Play epic victory fanfare arpeggio
  playVictoryFanfare(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0]
    arpeggio.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.08
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)

      gain.gain.setValueAtTime(0.001, now)
      gain.gain.linearRampToValueAtTime(0.22, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.7)
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

interface SevenParticle {
  originX: number
  originY: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  radius: number
  phase: number
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

  // Mouse / touch trail tracking
  const trailRef = useRef<Point[]>([])
  const mousePosRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const isMouseDownRef = useRef(false)

  // Game entities
  const itemsRef = useRef<Item[]>([])
  const particlesRef = useRef<Particle[]>([])
  const nextItemIdRef = useRef(1)
  const spawnTimerRef = useRef(0)
  const screenShakeRef = useRef(0)

  // Quantum 7 Shader Particle Swarm State
  const sevenParticlesRef = useRef<SevenParticle[]>([])
  const sevenInitializedRef = useRef(false)
  const lastShimmerTimeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const handleResize = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      sevenInitializedRef.current = false // Re-generate 7 mesh on resize
    }

    handleResize()
    window.addEventListener('resize', handleResize)

    // Helper: Generate particle mesh centered perfectly on canvas
    const initSevenMesh = (w: number, h: number): void => {
      const particles: SevenParticle[] = []
      const scale = Math.min(w, h) * 0.45

      // Offset origin left so the combined 7 bounding box centers at w / 2
      const centerX = w / 2 - scale * 0.15
      const centerY = h / 2

      // Top horizontal bar of "7"
      const barTopY = centerY - scale * 0.45
      const barWidth = scale * 0.72
      const barThickness = scale * 0.13
      const startX = centerX - barWidth / 2

      // Populate Top Bar
      for (let i = 0; i < 300; i++) {
        const px = startX + Math.random() * barWidth
        const py = barTopY + (Math.random() - 0.5) * barThickness
        particles.push(createSevenParticle(px, py))
      }

      // Diagonal stem of "7"
      const stemTopX = startX + barWidth - barThickness / 2
      const stemBottomX = centerX - scale * 0.15
      const stemBottomY = centerY + scale * 0.45

      for (let i = 0; i < 400; i++) {
        const t = Math.random()
        const px = stemTopX + (stemBottomX - stemTopX) * t + (Math.random() - 0.5) * (barThickness * 0.95)
        const py = barTopY + (stemBottomY - barTopY) * t + (Math.random() - 0.5) * (barThickness * 0.7)
        particles.push(createSevenParticle(px, py))
      }

      sevenParticlesRef.current = particles
      sevenInitializedRef.current = true
    }

    const createSevenParticle = (ox: number, oy: number): SevenParticle => {
      const colors = ['#00F0FF', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#FFFFFF']
      return {
        originX: ox,
        originY: oy,
        x: ox + (Math.random() - 0.5) * 80,
        y: oy + (Math.random() - 0.5) * 80,
        vx: 0,
        vy: 0,
        color: colors[Math.floor(Math.random() * colors.length)],
        radius: Math.random() * 2.8 + 1.2,
        phase: Math.random() * Math.PI * 2
      }
    }

    // Pointer tracking
    const updatePointer = (clientX: number, clientY: number): void => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left) * (canvas.width / rect.width)
      const y = (clientY - rect.top) * (canvas.height / rect.height)
      mousePosRef.current = { x, y }
      trailRef.current.push({ x, y, time: Date.now() })
    }

    const handleWindowPointerMove = (e: PointerEvent): void => {
      updatePointer(e.clientX, e.clientY)

      if (!isVictoryRef.current) {
        const trail = trailRef.current
        if (trail.length >= 3) {
          const p1 = trail[trail.length - 3]
          const p2 = trail[trail.length - 1]
          const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y)
          if (speed > 70 && Math.random() < 0.3) {
            audioSynth.playSwoosh()
          }
        }
      }
    }

    const handleWindowPointerDown = (e: PointerEvent): void => {
      isMouseDownRef.current = true
      trailRef.current = []
      updatePointer(e.clientX, e.clientY)
    }

    const handleWindowPointerUp = (): void => {
      isMouseDownRef.current = false
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerdown', handleWindowPointerDown)
    window.addEventListener('pointerup', handleWindowPointerUp)

    // Helper: spawn item high into the air
    const spawnItem = (): void => {
      if (isGameOverRef.current || isVictoryRef.current) return

      const w = canvas.width
      const h = canvas.height

      const isBomb = Math.random() < 0.22
      const startX = Math.random() * (w - 300) + 150
      const startY = h + 50

      const vx = (Math.random() - 0.5) * 7
      const vy = -(Math.random() * 5 + 16.5)

      const docType = isBomb ? undefined : DOC_TYPES[Math.floor(Math.random() * DOC_TYPES.length)]

      itemsRef.current.push({
        id: nextItemIdRef.current++,
        type: isBomb ? 'bomb' : 'document',
        x: startX,
        y: startY,
        vx,
        vy,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.08,
        radius: isBomb ? 36 : 50,
        docType,
        isSliced: false
      })
    }

    // Line-Circle collision test
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

    // Spawn particles helper
    const spawnParticles = (x: number, y: number, color: string, count = 25): void => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = Math.random() * 9 + 2
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

    // Main Loop
    const loop = (): void => {
      const w = canvas.width
      const h = canvas.height
      const now = Date.now()

      // Screen Shake
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

      // Background - Obsidian Deep Black Space
      ctx.fillStyle = '#050608'
      ctx.fillRect(-20, -20, w + 40, h + 40)

      // Dynamic Radial Prism Aura
      const mouseX = mousePosRef.current.x
      const mouseY = mousePosRef.current.y

      const auraX = isVictoryRef.current ? w / 2 : mouseX
      const auraY = isVictoryRef.current ? h / 2 : mouseY

      const bgGlow = ctx.createRadialGradient(auraX, auraY, 40, auraX, auraY, Math.max(w, h) * 0.75)
      bgGlow.addColorStop(0, 'rgba(0, 240, 255, 0.09)')
      bgGlow.addColorStop(0.35, 'rgba(139, 92, 246, 0.05)')
      bgGlow.addColorStop(0.7, 'rgba(236, 72, 153, 0.02)')
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = bgGlow
      ctx.fillRect(0, 0, w, h)

      // --- VICTORY SHADER RENDERER MODE FOR "7" ---
      if (isVictoryRef.current) {
        if (!sevenInitializedRef.current) {
          initSevenMesh(w, h)
        }

        // Draw Interactive Light Rays connecting Mouse to 7 Center
        ctx.save()
        const centerX = w / 2
        const centerY = h / 2

        const rayGrad = ctx.createLinearGradient(centerX, centerY, mouseX, mouseY)
        rayGrad.addColorStop(0, 'rgba(0, 240, 255, 0.35)')
        rayGrad.addColorStop(0.5, 'rgba(139, 92, 246, 0.2)')
        rayGrad.addColorStop(1, 'rgba(236, 72, 153, 0)')

        ctx.strokeStyle = rayGrad
        ctx.lineWidth = 3
        ctx.shadowColor = '#00F0FF'
        ctx.shadowBlur = 20

        ctx.beginPath()
        ctx.moveTo(centerX, centerY)
        ctx.lineTo(mouseX, mouseY)
        ctx.stroke()
        ctx.restore()

        // Update and Render Quantum 7 Particles with Mouse Vortex Interaction
        const sevenParticles = sevenParticlesRef.current
        sevenParticles.forEach((p) => {
          p.phase += 0.03

          const dx = mouseX - p.x
          const dy = mouseY - p.y
          const dist = Math.hypot(dx, dy)
          const maxRepelDist = 180

          if (dist < maxRepelDist && dist > 1) {
            const force = (1 - dist / maxRepelDist) * 12
            const angle = Math.atan2(dy, dx)
            const swirlAngle = angle + Math.PI / 2

            p.vx -= Math.cos(swirlAngle) * force * 0.4 + Math.cos(angle) * force * 0.3
            p.vy -= Math.sin(swirlAngle) * force * 0.4 + Math.sin(angle) * force * 0.3

            if (now - lastShimmerTimeRef.current > 120 && Math.random() < 0.1) {
              audioSynth.playShimmer()
              lastShimmerTimeRef.current = now
            }
          }

          const odx = p.originX - p.x
          const ody = p.originY - p.y
          p.vx += odx * 0.045
          p.vy += ody * 0.045

          p.vx *= 0.88
          p.vy *= 0.88

          p.x += p.vx
          p.y += p.vy

          ctx.save()
          const pulseRadius = p.radius + Math.sin(p.phase) * 0.6
          ctx.fillStyle = p.color
          ctx.shadowColor = p.color
          ctx.shadowBlur = 12

          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(0.5, pulseRadius), 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        })

        // Draw Ambient Light Flare around Mouse Cursor in Victory
        ctx.save()
        ctx.fillStyle = '#FFFFFF'
        ctx.shadowColor = '#00F0FF'
        ctx.shadowBlur = 30
        ctx.beginPath()
        ctx.arc(mouseX, mouseY, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else {
        // --- GAME PLAYING MODE ---
        trailRef.current = trailRef.current.filter((p) => now - p.time < 200)
        const trail = trailRef.current

        if (trail.length >= 2) {
          itemsRef.current.forEach((item) => {
            if (!item.isSliced && !isGameOverRef.current && !isVictoryRef.current) {
              for (let i = 1; i < trail.length; i++) {
                const p1 = trail[i - 1]
                const p2 = trail[i]

                if (checkLineCircleIntersect(p1, p2, item.x, item.y, item.radius)) {
                  item.isSliced = true

                  const sliceAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
                  item.slicedAngle = sliceAngle

                  if (item.type === 'document') {
                    audioSynth.playShred()

                    const perpAngle = sliceAngle + Math.PI / 2
                    const sepSpeed = 6

                    item.halfLeft = {
                      x: item.x,
                      y: item.y,
                      vx: item.vx + Math.cos(perpAngle) * sepSpeed,
                      vy: item.vy + Math.sin(perpAngle) * sepSpeed - 3,
                      rot: item.rotation,
                      vRot: -0.18
                    }
                    item.halfRight = {
                      x: item.x,
                      y: item.y,
                      vx: item.vx - Math.cos(perpAngle) * sepSpeed,
                      vy: item.vy - Math.sin(perpAngle) * sepSpeed - 3,
                      rot: item.rotation,
                      vRot: 0.18
                    }

                    spawnParticles(item.x, item.y, item.docType?.color || '#00F0FF', 30)

                    const newScore = scoreRef.current + 1
                    scoreRef.current = newScore
                    setScore(newScore)
                    audioSynth.playScoreChime(newScore)

                    if (newScore >= 7) {
                      isVictoryRef.current = true
                      setVictory(true)
                      audioSynth.playVictoryFanfare()
                      itemsRef.current = []
                    }
                  } else if (item.type === 'bomb') {
                    audioSynth.playExplosion()
                    screenShakeRef.current = 40
                    spawnParticles(item.x, item.y, '#EF4444', 60)
                    spawnParticles(item.x, item.y, '#F59E0B', 45)
                    isGameOverRef.current = true
                    setGameOver(true)
                  }
                  break
                }
              }
            }
          })
        }

        if (!isGameOverRef.current && !isVictoryRef.current) {
          spawnTimerRef.current++
          if (spawnTimerRef.current > 42) {
            spawnItem()
            if (Math.random() < 0.45) spawnItem()
            spawnTimerRef.current = 0
          }
        }

        const gravity = 0.23

        itemsRef.current.forEach((item) => {
          if (!item.isSliced) {
            item.x += item.vx
            item.y += item.vy
            item.vy += gravity
            item.rotation += item.vRot

            ctx.save()
            ctx.translate(item.x, item.y)
            ctx.rotate(item.rotation)

            if (item.type === 'document') {
              const cardW = 68
              const cardH = 86

              ctx.fillStyle = 'rgba(255, 255, 255, 0.09)'
              ctx.strokeStyle = item.docType?.color || '#00F0FF'
              ctx.lineWidth = 2.5
              ctx.shadowColor = item.docType?.color || '#00F0FF'
              ctx.shadowBlur = 14

              ctx.beginPath()
              ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10)
              ctx.fill()
              ctx.stroke()

              ctx.shadowBlur = 0
              ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
              ctx.fillRect(-cardW / 2 + 12, -cardH / 2 + 18, 30, 4)
              ctx.fillRect(-cardW / 2 + 12, -cardH / 2 + 28, 44, 3)
              ctx.fillRect(-cardW / 2 + 12, -cardH / 2 + 37, 38, 3)
              ctx.fillRect(-cardW / 2 + 12, -cardH / 2 + 46, 42, 3)

              ctx.fillStyle = item.docType?.color || '#00F0FF'
              ctx.beginPath()
              ctx.roundRect(-cardW / 2 + 10, cardH / 2 - 22, 48, 15, 5)
              ctx.fill()

              ctx.fillStyle = '#000000'
              ctx.font = 'bold 10px Outfit, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(item.docType?.ext || '.prism', -cardW / 2 + 34, cardH / 2 - 11)
            } else {
              const r = item.radius
              ctx.shadowColor = '#EF4444'
              ctx.shadowBlur = 20

              const bombGrad = ctx.createRadialGradient(-r / 3, -r / 3, 4, 0, 0, r)
              bombGrad.addColorStop(0, '#64748B')
              bombGrad.addColorStop(0.6, '#1E293B')
              bombGrad.addColorStop(1, '#0F172A')

              ctx.fillStyle = bombGrad
              ctx.strokeStyle = '#EF4444'
              ctx.lineWidth = 2.5
              ctx.beginPath()
              ctx.arc(0, 0, r, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()

              ctx.shadowBlur = 0
              ctx.fillStyle = '#EF4444'
              ctx.font = 'bold 22px sans-serif'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('💣', 0, 0)

              const sparkAngle = Math.random() * Math.PI * 2
              ctx.fillStyle = '#F59E0B'
              ctx.beginPath()
              ctx.arc(Math.cos(sparkAngle) * (r + 5), Math.sin(sparkAngle) * (r + 5), 4, 0, Math.PI * 2)
              ctx.fill()
            }

            ctx.restore()
          } else if (item.halfLeft && item.halfRight) {
            item.halfLeft.x += item.halfLeft.vx
            item.halfLeft.y += item.halfLeft.vy
            item.halfLeft.vy += gravity
            item.halfLeft.rot += item.halfLeft.vRot

            item.halfRight.x += item.halfRight.vx
            item.halfRight.y += item.halfRight.vy
            item.halfRight.vy += gravity
            item.halfRight.rot += item.halfRight.vRot

            ctx.save()
            ctx.translate(item.halfLeft.x, item.halfLeft.y)
            ctx.rotate(item.halfLeft.rot)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
            ctx.strokeStyle = item.docType?.color || '#00F0FF'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.roundRect(-32, -43, 30, 86, 5)
            ctx.fill()
            ctx.stroke()
            ctx.restore()

            ctx.save()
            ctx.translate(item.halfRight.x, item.halfRight.y)
            ctx.rotate(item.halfRight.rot)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
            ctx.strokeStyle = item.docType?.color || '#00F0FF'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.roundRect(2, -43, 30, 86, 5)
            ctx.fill()
            ctx.stroke()
            ctx.restore()
          }
        })

        itemsRef.current = itemsRef.current.filter((item) => {
          if (!item.isSliced) return item.y < h + 120
          return item.halfLeft && item.halfLeft.y < h + 120
        })

        if (trail.length >= 2) {
          ctx.save()
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          for (let i = 1; i < trail.length; i++) {
            const p1 = trail[i - 1]
            const p2 = trail[i]
            const progress = i / trail.length
            const width = progress * 10 + 2

            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)

            ctx.strokeStyle = `rgba(0, 240, 255, ${progress})`
            ctx.shadowColor = '#00F0FF'
            ctx.shadowBlur = 18
            ctx.lineWidth = width
            ctx.stroke()
          }

          const lastPoint = trail[trail.length - 1]
          ctx.fillStyle = '#FFFFFF'
          ctx.shadowColor = '#00F0FF'
          ctx.shadowBlur = 25
          ctx.beginPath()
          ctx.arc(lastPoint.x, lastPoint.y, 6, 0, Math.PI * 2)
          ctx.fill()

          ctx.restore()
        }
      }

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

      ctx.restore()
      animationFrameId = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerdown', handleWindowPointerDown)
      window.removeEventListener('pointerup', handleWindowPointerUp)
    }
  }, [])

  const restartGame = (): void => {
    itemsRef.current = []
    particlesRef.current = []
    trailRef.current = []
    scoreRef.current = 0
    isGameOverRef.current = false
    isVictoryRef.current = false
    sevenInitializedRef.current = false
    setScore(0)
    setGameOver(false)
    setVictory(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-2xl animate-fade-in select-none overflow-hidden">
      {/* Interactive Game & Shader Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair touch-none"
      />

      {/* Top Header Controls & Score */}
      <div className="absolute top-6 left-8 right-8 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-3 bg-white/[0.05] border border-white/10 backdrop-blur-md px-5 py-2.5 rounded-2xl shadow-2xl">
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
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-4 text-red-400">
            <Flame size={36} weight="fill" />
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
              <ArrowsCounterClockwise size={16} weight="bold" />
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* MINIMALIST VICTORY OVERLAY WITH CLEAN BOTTOM-CENTER RESTART BUTTON */}
      {victory && (
        <div className="absolute bottom-8 z-30 flex items-center justify-center pointer-events-auto animate-soft-pop">
          <button
            onClick={restartGame}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs px-5 py-2.5 rounded-full backdrop-blur-xl shadow-[0_0_30px_rgba(0,240,255,0.25)] transition-all active:scale-95 cursor-pointer"
          >
            <ArrowsCounterClockwise size={15} weight="bold" />
            <span>Play Again</span>
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

export default DocumentShredderGame
