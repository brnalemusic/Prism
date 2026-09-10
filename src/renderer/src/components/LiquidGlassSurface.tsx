import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { usePerformanceMode } from '../hooks/usePerformanceMode'
import { glassNormalField } from './liquidGlassGeometry'

export interface LiquidGlassSurfaceProps {
  refraction?: number
  blur?: number
  chromaticAberration?: number
  specular?: number
  opacity?: number
  distortionRadius?: number
  centerAttenuation?: number
  centerBlur?: number
  /** Filter-chain saturation lift (1 = neutral). Compensates tint damping. */
  saturation?: number
}

/** Decorative child of a positioned glass host; controls remain in the normal DOM. */
export function LiquidGlassSurface({
  refraction = 30,
  blur = 2,
  chromaticAberration = 0.5,
  specular = 0.09,
  opacity = 0.28,
  distortionRadius = 28,
  centerAttenuation = 0,
  centerBlur = 0,
  saturation = 1.35
}: LiquidGlassSurfaceProps): React.JSX.Element {
  const { mode } = usePerformanceMode()
  const id = `prism-glass-${useId().replace(/:/g, '')}`
  const anchor = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [geometry, setGeometry] = useState<{ width: number; height: number; map: string } | null>(
    null
  )

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const transparency = matchMedia('(prefers-reduced-transparency: reduce)')
    const update = (): void =>
      setAllowed(!motion.matches && !transparency.matches && !document.hidden)
    update()
    motion.addEventListener('change', update)
    transparency.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      motion.removeEventListener('change', update)
      transparency.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  useEffect(() => {
    const host = anchor.current?.parentElement
    if (!host || mode !== 'max' || !allowed) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(host)
    return () => {
      observer.disconnect()
      setVisible(false)
    }
  }, [mode, allowed])

  const active = mode === 'max' && allowed && visible
  useEffect(() => {
    const host = anchor.current?.parentElement
    if (!host || !active) {
      setGeometry(null)
      return
    }
    let previous = ''
    const update = (): void => {
      const style = getComputedStyle(host)
      const width = host.offsetWidth
      const height = host.offsetHeight
      if (!width || !height) return
      const radii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius
      ].map((value) =>
        value.endsWith('%')
          ? (Math.min(width, height) * parseFloat(value)) / 100
          : parseFloat(value) || 0
      )
      const key = `${width}:${height}:${radii.join(':')}:${distortionRadius}`
      if (key === previous) return
      previous = key
      setGeometry({ width, height, map: glassNormalField(width, height, radii, distortionRadius) })
    }
    const resize = new ResizeObserver(update)
    const mutation = new MutationObserver(update)
    resize.observe(host)
    mutation.observe(host, { attributes: true, attributeFilter: ['class', 'style'] })
    update()
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [active, distortionRadius])

  useEffect(() => {
    const host = anchor.current?.parentElement
    if (!host || !active || !geometry) return
    host.setAttribute('data-liquid-glass', 'active')
    return () => host.removeAttribute('data-liquid-glass')
  }, [active, geometry])

  // The folded lens profile peaks at |D| = 1 near the rim and inverts to
  // -0.16 inside the band. Clamp the displacement scale so the largest
  // sample offset stays inside the plate: outward sampling would fall
  // outside the compositor input and cut transparent notches at corners.
  const band = Math.max(1, distortionRadius)
  const scale = Math.max(0, Math.min(refraction, band * 0.9))
  const style = {
    '--liquid-filter': `url("#${id}")`,
    '--liquid-specular': Math.max(0, Math.min(0.3, specular)),
    '--liquid-opacity': Math.max(0, Math.min(1, opacity)),
    '--liquid-center-attenuation': Math.max(0, Math.min(0.3, centerAttenuation)),
    '--liquid-center-blur': `${Math.max(0, centerBlur)}px`,
    '--liquid-edge-band': `${band}px`
  } as CSSProperties
  return (
    <span ref={anchor} className="liquid-glass-anchor" aria-hidden="true" style={style}>
      {active && geometry && (
        <>
          <svg className="liquid-glass-definitions" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter
                id={id}
                x="0"
                y="0"
                width={geometry.width}
                height={geometry.height}
                filterUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
              >
                <feImage
                  href={geometry.map}
                  x="0"
                  y="0"
                  width={geometry.width}
                  height={geometry.height}
                  result="normals"
                />
                <feGaussianBlur in="normals" stdDeviation="0.8" result="smoothNormals" />
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation={Math.max(0, blur)}
                  result="backdrop"
                />
                <feDisplacementMap
                  in="backdrop"
                  in2="smoothNormals"
                  scale={scale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="green"
                />
                <feDisplacementMap
                  in="backdrop"
                  in2="smoothNormals"
                  scale={scale + chromaticAberration}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="red"
                />
                <feDisplacementMap
                  in="backdrop"
                  in2="smoothNormals"
                  scale={Math.max(0, scale - chromaticAberration)}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="blue"
                />
                <feColorMatrix
                  in="red"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="r"
                />
                <feColorMatrix
                  in="green"
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="g"
                />
                <feColorMatrix
                  in="blue"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="b"
                />
                <feBlend in="r" in2="g" mode="screen" result="rg" />
                <feBlend in="rg" in2="b" mode="screen" result="rgb" />
                {/* Lift saturation and brightness back to the vividness the
                    tint veil damps, matching frosted iOS optics. */}
                <feColorMatrix in="rgb" type="saturate" values={String(saturation)} />
                <feComponentTransfer>
                  <feFuncR type="linear" slope="1.04" intercept="0" />
                  <feFuncG type="linear" slope="1.04" intercept="0" />
                  <feFuncB type="linear" slope="1.04" intercept="0" />
                </feComponentTransfer>
              </filter>
            </defs>
          </svg>
          <span className="liquid-glass-optics" />
          {(centerAttenuation > 0 || centerBlur > 0) && (
            <span className="liquid-glass-readability" />
          )}
          <span className="liquid-glass-light" />
        </>
      )}
    </span>
  )
}
