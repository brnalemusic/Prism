import { useId } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'

interface FluidGenerationPlaceholderProps {
  cancelled?: boolean
  label?: string
}

const pointerSpring = { stiffness: 72, damping: 17, mass: 0.62 }

export function FluidGenerationPlaceholder({
  cancelled = false,
  label = 'Generating image'
}: FluidGenerationPlaceholderProps): React.JSX.Element {
  const id = useId().replace(/:/g, '')
  const gooFilter = `${id}-goo`
  const flowFilter = `${id}-flow`
  const reducedMotion = useReducedMotion()
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const pointerPresence = useMotionValue(0)
  const liquidX = useSpring(pointerX, pointerSpring)
  const liquidY = useSpring(pointerY, pointerSpring)
  const presence = useSpring(pointerPresence, { stiffness: 110, damping: 20 })
  const sheetX = useTransform(liquidX, (value) => value * -0.08)
  const sheetY = useTransform(liquidY, (value) => value * -0.08)
  const labelX = useTransform(liquidX, (value) => value * 0.018)
  const labelY = useTransform(liquidY, (value) => value * 0.018)
  const cancelledLabel = label.toLowerCase().includes('edit')
    ? 'Editing stopped'
    : 'Generation stopped'

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (cancelled || reducedMotion || event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    pointerX.set((event.clientX - bounds.left - bounds.width / 2) * 0.82)
    pointerY.set((event.clientY - bounds.top - bounds.height / 2) * 0.82)
    pointerPresence.set(1)
  }

  const releasePointer = (): void => {
    pointerX.set(0)
    pointerY.set(0)
    pointerPresence.set(0)
  }

  return (
    <div
      className={`image-generation-fluid${cancelled ? ' is-cancelled' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={cancelled ? cancelledLabel : label}
      onPointerMove={handlePointerMove}
      onPointerLeave={releasePointer}
      onPointerCancel={releasePointer}
    >
      <svg className="image-generation-filter-bank" aria-hidden="true">
        <defs>
          <filter id={gooFilter} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="blurred" />
            <feColorMatrix in="blurred" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
          </filter>
          <filter id={flowFilter} x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011 0.018"
              numOctaves="2"
              seed="14"
              result="flowNoise"
            >
              {!cancelled && !reducedMotion && (
                <animate
                  attributeName="baseFrequency"
                  dur="14s"
                  values="0.011 0.018;0.017 0.026;0.009 0.022;0.011 0.018"
                  repeatCount="indefinite"
                />
              )}
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="flowNoise"
              scale="31"
              xChannelSelector="R"
              yChannelSelector="B"
            />
            <feGaussianBlur stdDeviation="0.45" />
          </filter>
        </defs>
      </svg>

      <motion.div
        className="image-generation-liquid-sheet"
        aria-hidden="true"
        style={{
          x: reducedMotion ? 0 : sheetX,
          y: reducedMotion ? 0 : sheetY,
          filter: `url(#${flowFilter})`
        }}
      />
      <div
        className="image-generation-liquid-body"
        aria-hidden="true"
        style={{ filter: `url(#${gooFilter})` }}
      >
        <span className="image-generation-liquid-blob blob-a" />
        <span className="image-generation-liquid-blob blob-b" />
        <span className="image-generation-liquid-blob blob-c" />
        <span className="image-generation-liquid-blob blob-d" />
        <motion.span
          className="image-generation-liquid-blob pointer-blob"
          style={{
            x: reducedMotion ? 0 : liquidX,
            y: reducedMotion ? 0 : liquidY,
            opacity: reducedMotion ? 0 : presence
          }}
        />
      </div>
      <span className="image-generation-fluid-vignette" aria-hidden="true" />
      <span className="image-generation-fluid-specular" aria-hidden="true" />
      <motion.span
        className="image-generation-label"
        aria-hidden="true"
        style={{ x: reducedMotion ? 0 : labelX, y: reducedMotion ? 0 : labelY }}
      >
        {cancelled ? cancelledLabel : label}
      </motion.span>
    </div>
  )
}
