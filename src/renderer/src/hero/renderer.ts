// Renderers for the Hero theme's particle "9".
//
// Presenters only: they read the simulation's field and draw it. All physics
// (step accumulator, warm-up, mouse) lives in simulation.ts; these modules
// advance nothing. The WebGL renderer draws the whole field in ONE draw call
// of GL point sprites with fixed-capacity dual VBOs (attributes uploaded on
// syncField, positions streamed every frame — never reallocated, so a growing
// pane can never throw). The 2D renderer is a prerendered-sprite fallback.

import type { HeroModeConfig, MouseState, Simulation } from './simulation'
import { MAX_PARTICLES } from './simulation'

/** Maximum device pixels per CSS pixel — fill-rate guard for 4K displays. */
export const MAX_DPR = 1.5

export interface HeroRenderer {
  /** Upload the current field to GPU/state (after build or resize). */
  syncField(): void
  /** Draw the current field state. `now` is wall-clock performance.now() ms. */
  frame(now: number): void
  destroy(): void
}

const VERT_SRC = `
precision mediump float;
attribute vec2 aPos;
attribute float aSize;
attribute float aHue;
attribute float aPhase;
attribute float aPulseSpeed;
attribute float aDepth;
attribute float aSparkle;

uniform vec2 uResolution;
uniform float uTime;
uniform float uHueShift;
uniform float uAlphaMul;

varying float vHue;
varying float vCoreA;
varying float vHaloA;
varying float vCoreR;
varying float vSparkle;

void main() {
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  float pulse = 0.55 + 0.45 * sin(uTime * aPulseSpeed + aPhase);
  float twinkle = mix(1.0, 0.45 + 0.55 * abs(sin(uTime * 1.7 + aPhase * 3.1)), aSparkle);
  float lum = 0.4 + 0.6 * aDepth;
  float alpha = (0.1 + pulse * 0.28) * uAlphaMul * lum * twinkle;
  float coreDia = aSize * (0.6 + pulse * 0.45) * (1.0 + aSparkle * 0.8) * 2.0;
  float haloDia = aSize * (2.1 + pulse * 1.5) * (1.0 + aSparkle * 0.5) * 2.0;

  gl_PointSize = max(haloDia, 1.0);
  vHue = aHue + uHueShift;
  vCoreA = alpha * mix(1.0, 1.5, aSparkle);
  vHaloA = alpha * 0.22;
  vCoreR = coreDia / haloDia;
  vSparkle = aSparkle;
}
`

const FRAG_SRC = `
precision mediump float;
varying float vHue;
varying float vCoreA;
varying float vHaloA;
varying float vCoreR;
varying float vSparkle;

vec3 hue2rgb(float h) {
  float hp = mod(h, 360.0) / 60.0;
  return clamp(vec3(
    abs(hp - 3.0) - 1.0,
    2.0 - abs(hp - 2.0),
    2.0 - abs(hp - 4.0)
  ), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  float falloff = 1.0 - r2;
  vec3 rgb = hue2rgb(vHue);
  float coreMask = 1.0 - smoothstep(vCoreR * 0.45, vCoreR, r);
  vec3 coreCol = mix(rgb * 0.9 + 0.1, vec3(1.0), vSparkle);
  vec3 col = coreCol * vCoreA * coreMask + rgb * vHaloA * falloff * falloff;
  gl_FragColor = vec4(col, 1.0);
}
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string
): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  sim: Simulation
): HeroRenderer | null {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  })
  if (!gl) return null

  const cfg: HeroModeConfig = sim.cfg
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog)
    return null
  }
  gl.useProgram(prog)

  // Dual VBOs with FIXED capacity: per-particle attributes (uploaded on
  // syncField) and a dedicated position VBO (streamed every frame). Buffers
  // are sized once for MAX_PARTICLES — rebuilds after resize reuse them via
  // bufferSubData, so growth can never throw or reallocate.
  const ATTR_STRIDE = 24 // size, hue, phase, pulseSpeed, depth, sparkle
  const attrData = new Float32Array(MAX_PARTICLES * 6)
  const posData = new Float32Array(MAX_PARTICLES * 2)

  const attrBuf = gl.createBuffer()
  const posBuf = gl.createBuffer()
  if (!attrBuf || !posBuf) {
    gl.deleteProgram(prog)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf)
  gl.bufferData(gl.ARRAY_BUFFER, attrData.byteLength, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  gl.bufferData(gl.ARRAY_BUFFER, posData.byteLength, gl.DYNAMIC_DRAW)

  const loc = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aSize: gl.getAttribLocation(prog, 'aSize'),
    aHue: gl.getAttribLocation(prog, 'aHue'),
    aPhase: gl.getAttribLocation(prog, 'aPhase'),
    aPulseSpeed: gl.getAttribLocation(prog, 'aPulseSpeed'),
    aDepth: gl.getAttribLocation(prog, 'aDepth'),
    aSparkle: gl.getAttribLocation(prog, 'aSparkle')
  }
  const bindAttribs = (): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.enableVertexAttribArray(loc.aPos)
    gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 8, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf)
    gl.enableVertexAttribArray(loc.aSize)
    gl.vertexAttribPointer(loc.aSize, 1, gl.FLOAT, false, ATTR_STRIDE, 0)
    gl.enableVertexAttribArray(loc.aHue)
    gl.vertexAttribPointer(loc.aHue, 1, gl.FLOAT, false, ATTR_STRIDE, 4)
    gl.enableVertexAttribArray(loc.aPhase)
    gl.vertexAttribPointer(loc.aPhase, 1, gl.FLOAT, false, ATTR_STRIDE, 8)
    gl.enableVertexAttribArray(loc.aPulseSpeed)
    gl.vertexAttribPointer(loc.aPulseSpeed, 1, gl.FLOAT, false, ATTR_STRIDE, 12)
    gl.enableVertexAttribArray(loc.aDepth)
    gl.vertexAttribPointer(loc.aDepth, 1, gl.FLOAT, false, ATTR_STRIDE, 16)
    gl.enableVertexAttribArray(loc.aSparkle)
    gl.vertexAttribPointer(loc.aSparkle, 1, gl.FLOAT, false, ATTR_STRIDE, 20)
  }

  const uResolution = gl.getUniformLocation(prog, 'uResolution')
  const uTime = gl.getUniformLocation(prog, 'uTime')
  const uHueShift = gl.getUniformLocation(prog, 'uHueShift')
  const uAlphaMul = gl.getUniformLocation(prog, 'uAlphaMul')
  gl.uniform1f(uAlphaMul, cfg.alphaMul)

  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE) // additive: overlapping particles accumulate light

  let width = 0

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w
      canvas.height = h
    }
    // Viewport and uResolution are idempotent and MUST be pushed even when
    // the surface is unchanged: a canvas that starts at its target size
    // (e.g. 300x150 at DPR 1) never enters the branch above, and a (0,0)
    // uResolution turns every vertex into NaN — nothing rasterizes.
    gl.viewport(0, 0, w, h)
    gl.uniform2f(uResolution, rect.width, rect.height)
    width = w
  }

  return {
    syncField(): void {
      const ps = sim.particles
      const n = Math.min(ps.length, MAX_PARTICLES)
      for (let i = 0; i < n; i++) {
        const p = ps[i]
        const o6 = i * 6
        attrData[o6] = p.size
        attrData[o6 + 1] = p.hue
        attrData[o6 + 2] = p.phase
        attrData[o6 + 3] = p.pulseSpeed
        attrData[o6 + 4] = p.depth
        attrData[o6 + 5] = p.sparkle ? 1 : 0
        posData[i * 2] = p.x
        posData[i * 2 + 1] = p.y
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, attrData.subarray(0, n * 6))
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData.subarray(0, n * 2))
      bindAttribs()
    },
    frame(now: number): void {
      resize()
      if (width === 0) return

      const ps = sim.particles
      const n = Math.min(ps.length, MAX_PARTICLES)
      for (let i = 0; i < n; i++) {
        posData[i * 2] = ps[i].x
        posData[i * 2 + 1] = ps[i].y
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData.subarray(0, n * 2))

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(uTime, now / 1000)
      gl.uniform1f(uHueShift, sim.hueShift)
      gl.drawArrays(gl.POINTS, 0, n)
    },
    destroy(): void {
      gl.deleteBuffer(attrBuf)
      gl.deleteBuffer(posBuf)
      gl.deleteProgram(prog)
    }
  }
}

export function create2DRenderer(
  canvas: HTMLCanvasElement,
  sim: Simulation
): HeroRenderer {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const cfg: HeroModeConfig = sim.cfg

  // Prerendered glow sprites tinted into 12 hue buckets — zero per-frame
  // gradient/arc work, just fast drawImage calls.
  const SPRITE = 32
  const HUES = 12
  const base = document.createElement('canvas')
  base.width = SPRITE
  base.height = SPRITE
  const bctx = base.getContext('2d')
  if (bctx) {
    const grad = bctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    bctx.fillStyle = grad
    bctx.fillRect(0, 0, SPRITE, SPRITE)
  }
  const tinted: HTMLCanvasElement[] = []
  for (let hIdx = 0; hIdx < HUES; hIdx++) {
    const c = document.createElement('canvas')
    c.width = SPRITE
    c.height = SPRITE
    const cctx = c.getContext('2d')
    if (cctx && bctx) {
      cctx.drawImage(base, 0, 0)
      cctx.globalCompositeOperation = 'multiply'
      cctx.fillStyle = `hsl(${(hIdx * 360) / HUES}, 95%, 62%)`
      cctx.fillRect(0, 0, SPRITE, SPRITE)
      cctx.globalCompositeOperation = 'destination-in'
      cctx.drawImage(base, 0, 0)
    }
    tinted.push(c)
  }

  let width = 0

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return
    const dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1))
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w
      canvas.height = h
    }
    width = w
  }

  return {
    // The 2D renderer reads the field directly; nothing to upload.
    syncField(): void {
      void sim
    },
    frame(now: number): void {
      resize()
      if (width === 0) return

      const dpr = canvas.width / canvas.clientWidth || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      ctx.globalCompositeOperation = 'lighter'
      const ps = sim.particles
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        const pulse = 0.55 + 0.45 * Math.sin((now / 1000) * p.pulseSpeed + p.phase)
        const lum = 0.4 + 0.6 * p.depth
        const alpha = (0.1 + pulse * 0.28) * cfg.alphaMul * lum
        const hue = (p.hue + sim.hueShift) % 360
        const bucket = Math.round((hue / 360) * HUES) % HUES
        const spr = tinted[bucket]
        const size = p.size * (2.1 + pulse * 1.5) * (p.sparkle ? 1.5 : 1) * 2
        ctx.globalAlpha = Math.min(1, alpha)
        ctx.drawImage(spr, p.x - size / 2, p.y - size / 2, size, size)
      }
      ctx.globalAlpha = 1
    },
    // Release the sprite cache; the renderer cannot draw after this.
    destroy(): void {
      tinted.length = 0
    }
  }
}

/** Pick the best available renderer for this canvas. */
export function createHeroRenderer(
  canvas: HTMLCanvasElement,
  sim: Simulation
): HeroRenderer {
  const glRenderer = createWebGLRenderer(canvas, sim)
  if (glRenderer) return glRenderer
  return create2DRenderer(canvas, sim)
}

// Re-exported for the component's context-loss wiring convenience.
export type { MouseState }
