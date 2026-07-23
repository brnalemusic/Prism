import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowsCounterClockwise, Flame, FileText, Sparkle, Play } from '@phosphor-icons/react'

// --- Web Audio API Sound Synthesizer with Pre-baked Buffers ---
class SoundSynthesizer {
  private ctx: AudioContext | null = null
  private noiseBuffers: {
    swoosh: AudioBuffer | null
    shred: AudioBuffer | null
    explosion: AudioBuffer | null
  } = { swoosh: null, shred: null, explosion: null }

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

  // Pre-bake noise audio buffers into memory during preloader phase
  preloadBuffers(): void {
    const ctx = this.getContext()
    if (!ctx) return

    // 1. Swoosh noise buffer (0.12s)
    const swooshLen = Math.floor(ctx.sampleRate * 0.12)
    const swooshBuf = ctx.createBuffer(1, swooshLen, ctx.sampleRate)
    const swooshData = swooshBuf.getChannelData(0)
    for (let i = 0; i < swooshLen; i++) {
      swooshData[i] = Math.random() * 2 - 1
    }
    this.noiseBuffers.swoosh = swooshBuf

    // 2. Shred noise buffer (0.15s with exponential decay)
    const shredLen = Math.floor(ctx.sampleRate * 0.15)
    const shredBuf = ctx.createBuffer(1, shredLen, ctx.sampleRate)
    const shredData = shredBuf.getChannelData(0)
    for (let i = 0; i < shredLen; i++) {
      shredData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04))
    }
    this.noiseBuffers.shred = shredBuf

    // 3. Explosion noise buffer (0.45s)
    const expLen = Math.floor(ctx.sampleRate * 0.45)
    const expBuf = ctx.createBuffer(1, expLen, ctx.sampleRate)
    const expData = expBuf.getChannelData(0)
    for (let i = 0; i < expLen; i++) {
      expData[i] = Math.random() * 2 - 1
    }
    this.noiseBuffers.explosion = expBuf
  }

  // Play high-speed slash swoosh sound
  playSwoosh(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffers.swoosh || ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate)

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
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffers.shred || ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate)

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

    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffers.explosion || ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate)

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

  // Play interactive preloader pop sound
  playPop(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const freq = 600 + Math.random() * 400

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05)

    gain.gain.setValueAtTime(0.15, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.08)
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

interface DocType {
  label: string
  ext: string
  color: string
}

interface Item {
  active: boolean
  id: number
  type: 'document' | 'bomb'
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  vRot: number
  radius: number
  docType?: DocType
  isSliced: boolean
  slicedAngle?: number
  halfLeft?: { x: number; y: number; vx: number; vy: number; rot: number; vRot: number }
  halfRight?: { x: number; y: number; vx: number; vy: number; rot: number; vRot: number }
}

interface Particle {
  active: boolean
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

interface PreloaderSpark {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  popped: boolean
}

const DOC_TYPES: DocType[] = [
  { label: 'Prism Engine', ext: '.prism', color: '#00F0FF' },
  { label: 'Architecture', ext: '.docx', color: '#3B82F6' },
  { label: 'Source Code', ext: '.ts', color: '#A855F7' },
  { label: 'PDF Report', ext: '.pdf', color: '#EF4444' },
  { label: 'JSON Config', ext: '.json', color: '#10B981' },
  { label: 'Markdown Spec', ext: '.md', color: '#F59E0B' }
]

// --- Offscreen Sprite Texture Cache Generator ---
interface SpriteCache {
  docs: Record<string, HTMLCanvasElement>
  halvesLeft: Record<string, HTMLCanvasElement>
  halvesRight: Record<string, HTMLCanvasElement>
  bomb: HTMLCanvasElement
  particleGlow: Record<string, HTMLCanvasElement>
}

const createOffscreenCanvas = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w)
  canvas.height = Math.ceil(h)
  return canvas
}

const bakeSpriteCache = (): SpriteCache => {
  const docs: Record<string, HTMLCanvasElement> = {}
  const halvesLeft: Record<string, HTMLCanvasElement> = {}
  const halvesRight: Record<string, HTMLCanvasElement> = {}
  const particleGlow: Record<string, HTMLCanvasElement> = {}

  const cardW = 68
  const cardH = 86

  // Bake full document cards & halves for each extension
  DOC_TYPES.forEach((dt) => {
    // 1. Full Document Sprite
    const canvas = createOffscreenCanvas(cardW + 30, cardH + 30)
    const ctx = canvas.getContext('2d')!
    ctx.translate((cardW + 30) / 2, (cardH + 30) / 2)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)'
    ctx.strokeStyle = dt.color
    ctx.lineWidth = 2.5
    ctx.shadowColor = dt.color
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

    ctx.fillStyle = dt.color
    ctx.beginPath()
    ctx.roundRect(-cardW / 2 + 10, cardH / 2 - 22, 48, 15, 5)
    ctx.fill()

    ctx.fillStyle = '#000000'
    ctx.font = 'bold 10px Outfit, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(dt.ext, -cardW / 2 + 34, cardH / 2 - 11)

    docs[dt.ext] = canvas

    // 2. Left Half Sprite
    const canvasL = createOffscreenCanvas(cardW / 2 + 20, cardH + 20)
    const ctxL = canvasL.getContext('2d')!
    ctxL.translate(20, (cardH + 20) / 2)
    ctxL.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctxL.strokeStyle = dt.color
    ctxL.lineWidth = 2
    ctxL.shadowColor = dt.color
    ctxL.shadowBlur = 10
    ctxL.beginPath()
    ctxL.roundRect(-32, -43, 30, 86, 5)
    ctxL.fill()
    ctxL.stroke()
    halvesLeft[dt.ext] = canvasL

    // 3. Right Half Sprite
    const canvasR = createOffscreenCanvas(cardW / 2 + 20, cardH + 20)
    const ctxR = canvasR.getContext('2d')!
    ctxR.translate(0, (cardH + 20) / 2)
    ctxR.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctxR.strokeStyle = dt.color
    ctxR.lineWidth = 2
    ctxR.shadowColor = dt.color
    ctxR.shadowBlur = 10
    ctxR.beginPath()
    ctxR.roundRect(2, -43, 30, 86, 5)
    ctxR.fill()
    ctxR.stroke()
    halvesRight[dt.ext] = canvasR

    // 4. Glow particle texture map
    const pCanvas = createOffscreenCanvas(32, 32)
    const pCtx = pCanvas.getContext('2d')!
    const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, dt.color)
    grad.addColorStop(0.5, dt.color)
    grad.addColorStop(1, 'transparent')
    pCtx.fillStyle = grad
    pCtx.beginPath()
    pCtx.arc(16, 16, 16, 0, Math.PI * 2)
    pCtx.fill()
    particleGlow[dt.color] = pCanvas
  })

  // Bake Bomb Sprite
  const r = 36
  const bombCanvas = createOffscreenCanvas((r + 20) * 2, (r + 20) * 2)
  const bCtx = bombCanvas.getContext('2d')!
  bCtx.translate(r + 20, r + 20)
  bCtx.shadowColor = '#EF4444'
  bCtx.shadowBlur = 20

  const bombGrad = bCtx.createRadialGradient(-r / 3, -r / 3, 4, 0, 0, r)
  bombGrad.addColorStop(0, '#64748B')
  bombGrad.addColorStop(0.6, '#1E293B')
  bombGrad.addColorStop(1, '#0F172A')

  bCtx.fillStyle = bombGrad
  bCtx.strokeStyle = '#EF4444'
  bCtx.lineWidth = 2.5
  bCtx.beginPath()
  bCtx.arc(0, 0, r, 0, Math.PI * 2)
  bCtx.fill()
  bCtx.stroke()

  bCtx.shadowBlur = 0
  bCtx.fillStyle = '#EF4444'
  bCtx.font = 'bold 22px sans-serif'
  bCtx.textAlign = 'center'
  bCtx.textBaseline = 'middle'
  bCtx.fillText('💣', 0, 0)

  return { docs, halvesLeft, halvesRight, bomb: bombCanvas, particleGlow }
}

export const DocumentShredderGame: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // --- Preloader & Game State ---
  const [isLoading, setIsLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadStatus, setLoadStatus] = useState('Initializing Quantum Engine...')
  const [readyToLaunch, setReadyToLaunch] = useState(false)

  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [victory, setVictory] = useState(false)

  const scoreRef = useRef(0)
  const isGameOverRef = useRef(false)
  const isVictoryRef = useRef(false)
  const spriteCacheRef = useRef<SpriteCache | null>(null)

  // Mouse / touch trail tracking
  const trailRef = useRef<Point[]>([])
  const mousePosRef = useRef<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const isMouseDownRef = useRef(false)

  // Pre-allocated Pools (Zero-GC stutter)
  const itemsPoolRef = useRef<Item[]>([])
  const particlesPoolRef = useRef<Particle[]>([])
  const nextItemIdRef = useRef(1)
  const spawnTimerRef = useRef(0)
  const screenShakeRef = useRef(0)

  // Quantum 7 Shader Particle Swarm State
  const sevenParticlesRef = useRef<SevenParticle[]>([])
  const sevenInitializedRef = useRef(false)
  const lastShimmerTimeRef = useRef(0)

  // Preloader Interactive Sparks State
  const preloaderSparksRef = useRef<PreloaderSpark[]>([])

  // --- Interactive Preloader Sequence ---
  useEffect(() => {
    // Generate interactive floating quantum energy dots for preloader
    const colors = ['#00F0FF', '#3B82F6', '#A855F7', '#EC4899', '#10B981', '#F59E0B']
    const sparks: PreloaderSpark[] = []
    for (let i = 0; i < 24; i++) {
      sparks.push({
        id: i,
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 2.5,
        vy: (Math.random() - 0.5) * 2.5,
        radius: Math.random() * 12 + 8,
        color: colors[i % colors.length],
        popped: false
      })
    }
    preloaderSparksRef.current = sparks

    let currentStep = 0
    const steps = [
      { progress: 20, label: 'Charging Quantum Audio Synthesizer...' },
      { progress: 45, label: 'Pre-baking High-DPI Vector Card Sprites...' },
      { progress: 70, label: 'Assembling 7-Particle Quantum Swarm Mesh...' },
      { progress: 90, label: 'Calibrating Zero-G Physics & Memory Pools...' },
      { progress: 100, label: 'SYSTEM READY! CLICK TO PLAY' }
    ]

    const preloaderInterval = setInterval(() => {
      if (currentStep < steps.length) {
        const step = steps[currentStep]
        setLoadProgress(step.progress)
        setLoadStatus(step.label)

        if (step.progress === 20) {
          audioSynth.preloadBuffers()
        } else if (step.progress === 45) {
          spriteCacheRef.current = bakeSpriteCache()
        } else if (step.progress === 70) {
          initSevenMesh(window.innerWidth, window.innerHeight)
        } else if (step.progress === 90) {
          initPools()
        } else if (step.progress === 100) {
          setReadyToLaunch(true)
        }
        currentStep++
      } else {
        clearInterval(preloaderInterval)
      }
    }, 180)

    return () => clearInterval(preloaderInterval)
  }, [])

  // Helper: Initialize zero-allocation object pools
  const initPools = (): void => {
    const items: Item[] = []
    for (let i = 0; i < 30; i++) {
      items.push({
        active: false,
        id: 0,
        type: 'document',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rotation: 0,
        vRot: 0,
        radius: 50,
        isSliced: false
      })
    }
    itemsPoolRef.current = items

    const particles: Particle[] = []
    for (let i = 0; i < 250; i++) {
      particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        color: '#00F0FF',
        size: 4,
        alpha: 1,
        decay: 0.02
      })
    }
    particlesPoolRef.current = particles
  }

  // Helper: Generate particle mesh centered perfectly on canvas
  const initSevenMesh = (w: number, h: number): void => {
    const particles: SevenParticle[] = []
    const scale = Math.min(w, h) * 0.45

    const centerX = w / 2 - scale * 0.15
    const centerY = h / 2

    const barTopY = centerY - scale * 0.45
    const barWidth = scale * 0.72
    const barThickness = scale * 0.13
    const startX = centerX - barWidth / 2

    for (let i = 0; i < 300; i++) {
      const px = startX + Math.random() * barWidth
      const py = barTopY + (Math.random() - 0.5) * barThickness
      particles.push(createSevenParticle(px, py))
    }

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

  const launchGame = (): void => {
    if (!readyToLaunch) return
    setIsLoading(false)
  }

  // Interactive preloader spark pop interaction
  const handlePreloaderSparkClick = (id: number): void => {
    const spark = preloaderSparksRef.current.find((s) => s.id === id)
    if (spark && !spark.popped) {
      spark.popped = true
      audioSynth.playPop()
    }
  }

  useEffect(() => {
    if (isLoading) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const handleResize = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      sevenInitializedRef.current = false
    }

    handleResize()
    window.addEventListener('resize', handleResize)

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

    // Spawn item using object pool
    const spawnItem = (): void => {
      if (isGameOverRef.current || isVictoryRef.current) return

      const w = canvas.width
      const h = canvas.height
      const pool = itemsPoolRef.current
      const inactiveItem = pool.find((i) => !i.active)
      if (!inactiveItem) return

      const isBomb = Math.random() < 0.22
      const startX = Math.random() * (w - 300) + 150
      const startY = h + 50

      const vx = (Math.random() - 0.5) * 7
      const vy = -(Math.random() * 5 + 16.5)

      const docType = isBomb ? undefined : DOC_TYPES[Math.floor(Math.random() * DOC_TYPES.length)]

      inactiveItem.active = true
      inactiveItem.id = nextItemIdRef.current++
      inactiveItem.type = isBomb ? 'bomb' : 'document'
      inactiveItem.x = startX
      inactiveItem.y = startY
      inactiveItem.vx = vx
      inactiveItem.vy = vy
      inactiveItem.rotation = Math.random() * Math.PI * 2
      inactiveItem.vRot = (Math.random() - 0.5) * 0.08
      inactiveItem.radius = isBomb ? 36 : 50
      inactiveItem.docType = docType
      inactiveItem.isSliced = false
      inactiveItem.halfLeft = undefined
      inactiveItem.halfRight = undefined
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

    // Spawn particles using object pool
    const spawnParticles = (x: number, y: number, color: string, count = 25): void => {
      const pool = particlesPoolRef.current
      let spawned = 0
      for (let i = 0; i < pool.length && spawned < count; i++) {
        const p = pool[i]
        if (!p.active) {
          const angle = Math.random() * Math.PI * 2
          const speed = Math.random() * 9 + 2

          p.active = true
          p.x = x
          p.y = y
          p.vx = Math.cos(angle) * speed
          p.vy = Math.sin(angle) * speed
          p.color = color
          p.size = Math.random() * 6 + 3
          p.alpha = 1
          p.decay = Math.random() * 0.03 + 0.015
          spawned++
        }
      }
    }

    // Main Game Loop (Ultra-Optimized)
    const loop = (): void => {
      const w = canvas.width
      const h = canvas.height
      const now = Date.now()
      const sprites = spriteCacheRef.current

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

        // Draw Light Ray
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

        // Render Quantum 7 Particles
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
          itemsPoolRef.current.forEach((item) => {
            if (item.active && !item.isSliced && !isGameOverRef.current && !isVictoryRef.current) {
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
                      itemsPoolRef.current.forEach((it) => (it.active = false))
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

        itemsPoolRef.current.forEach((item) => {
          if (!item.active) return

          if (!item.isSliced) {
            item.x += item.vx
            item.y += item.vy
            item.vy += gravity
            item.rotation += item.vRot

            ctx.save()
            ctx.translate(item.x, item.y)
            ctx.rotate(item.rotation)

            if (item.type === 'document' && sprites && item.docType) {
              const docSprite = sprites.docs[item.docType.ext]
              if (docSprite) {
                ctx.drawImage(docSprite, -docSprite.width / 2, -docSprite.height / 2)
              }
            } else if (sprites) {
              const bombSprite = sprites.bomb
              ctx.drawImage(bombSprite, -bombSprite.width / 2, -bombSprite.height / 2)
            }

            ctx.restore()
          } else if (item.halfLeft && item.halfRight && sprites && item.docType) {
            item.halfLeft.x += item.halfLeft.vx
            item.halfLeft.y += item.halfLeft.vy
            item.halfLeft.vy += gravity
            item.halfLeft.rot += item.halfLeft.vRot

            item.halfRight.x += item.halfRight.vx
            item.halfRight.y += item.halfRight.vy
            item.halfRight.vy += gravity
            item.halfRight.rot += item.halfRight.vRot

            const leftSprite = sprites.halvesLeft[item.docType.ext]
            const rightSprite = sprites.halvesRight[item.docType.ext]

            if (leftSprite) {
              ctx.save()
              ctx.translate(item.halfLeft.x, item.halfLeft.y)
              ctx.rotate(item.halfLeft.rot)
              ctx.drawImage(leftSprite, -20, -leftSprite.height / 2)
              ctx.restore()
            }

            if (rightSprite) {
              ctx.save()
              ctx.translate(item.halfRight.x, item.halfRight.y)
              ctx.rotate(item.halfRight.rot)
              ctx.drawImage(rightSprite, 0, -rightSprite.height / 2)
              ctx.restore()
            }
          }

          // Deactivate items out of bounds
          if (!item.isSliced && item.y > h + 120) {
            item.active = false
          } else if (item.isSliced && item.halfLeft && item.halfLeft.y > h + 120) {
            item.active = false
          }
        })

        // Draw Slash Trail
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

      // Render Active Particles
      particlesPoolRef.current.forEach((p) => {
        if (!p.active) return
        p.x += p.vx
        p.y += p.vy
        p.alpha -= p.decay

        if (p.alpha <= 0) {
          p.active = false
        } else {
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
  }, [isLoading])

  const restartGame = (): void => {
    itemsPoolRef.current.forEach((it) => (it.active = false))
    particlesPoolRef.current.forEach((p) => (p.active = false))
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
      {/* ─── INTERACTIVE FUN PRELOADER OVERLAY ─── */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-3xl select-none p-6">
          {/* Interactive Floating Preloader Energy Sparks */}
          <div className="absolute inset-0 overflow-hidden pointer-events-auto">
            {preloaderSparksRef.current.map((spark) => (
              <button
                key={spark.id}
                onClick={() => handlePreloaderSparkClick(spark.id)}
                onMouseEnter={() => handlePreloaderSparkClick(spark.id)}
                style={{
                  top: `${spark.y}px`,
                  left: `${spark.x}px`,
                  backgroundColor: spark.popped ? 'transparent' : spark.color,
                  boxShadow: spark.popped ? 'none' : `0 0 20px ${spark.color}`,
                  width: `${spark.radius * 2}px`,
                  height: `${spark.radius * 2}px`
                }}
                className={`absolute rounded-full transition-all duration-300 transform -translate-x-1/2 -translate-y-1/2 cursor-pointer ${
                  spark.popped ? 'scale-0 opacity-0 pointer-events-none' : 'hover:scale-125 animate-pulse'
                }`}
              />
            ))}
          </div>

          {/* Preloader Main Card */}
          <div className="relative z-10 flex flex-col items-center max-w-md w-full bg-white/[0.04] border border-white/10 rounded-3xl p-8 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,240,255,0.15)] text-center">
            {/* Glowing Neon Progress Ring */}
            <div className="relative w-28 h-28 mb-6 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="text-white/10"
                  strokeWidth="8"
                  stroke="currentColor"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="text-accent-primary transition-all duration-300 ease-out"
                  strokeWidth="8"
                  strokeDasharray={264}
                  strokeDashoffset={264 - (264 * loadProgress) / 100}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <Sparkle size={24} weight="fill" className="text-accent-primary animate-spin mb-0.5" />
                <span className="text-xl font-black text-white tracking-wider">{loadProgress}%</span>
              </div>
            </div>

            {/* Stage Description */}
            <h3 className="text-lg font-bold text-white mb-2 tracking-wide">
              {readyToLaunch ? 'SYSTEM READY' : 'PRELOADING GAME ENGINE'}
            </h3>
            <p className="text-xs text-text-secondary mb-6 font-mono h-5 flex items-center justify-center animate-pulse">
              {loadStatus}
            </p>

            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mb-6">
              <div
                className="bg-gradient-to-r from-accent-primary via-purple-500 to-pink-500 h-full transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>

            <p className="text-[11px] text-text-secondary/70 italic mb-6">
              💡 Hint: Hover or click the floating energy sparks above while loading!
            </p>

            {/* Launch Button when Ready */}
            <button
              disabled={!readyToLaunch}
              onClick={launchGame}
              className={`w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl font-extrabold text-sm transition-all duration-300 shadow-xl cursor-pointer ${
                readyToLaunch
                  ? 'bg-gradient-to-r from-accent-primary to-purple-600 text-white hover:opacity-90 active:scale-95 shadow-[0_0_25px_rgba(0,240,255,0.4)]'
                  : 'bg-white/10 text-white/40 cursor-not-allowed'
              }`}
            >
              <Play size={18} weight="fill" />
              <span>{readyToLaunch ? 'START SHREDDING' : 'PRELOADING ASSETS...'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Interactive Game & Shader Canvas */}
      {!isLoading && (
        <>
          <canvas ref={canvasRef} className="absolute inset-0 cursor-crosshair touch-none" />

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
                The document shredder overheated after hitting an explosive bomb. Try again to reach 7 shredded
                documents!
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
        </>
      )}
    </div>,
    document.body
  )
}

export default DocumentShredderGame
