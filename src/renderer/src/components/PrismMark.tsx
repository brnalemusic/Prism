import clsx from 'clsx'

/**
 * Prism brand mark: the seven-beam spectral dispersion fan from the app icon,
 * drawn as vector geometry so it can light up beam by beam. Used by the boot
 * LoadingScreen (beams track boot progress) and by welcome / empty states.
 *
 * PERFORMANCE: only opacity and transform are transitioned. The optional light
 * sweep is a single composited CSS animation and is skipped entirely under
 * prefers-reduced-motion by the global guard in main.css.
 */

/** Spectral order taken from resources/icon.png (red → violet). */
export const PRISM_SPECTRUM = [
  '#ff3b3b',
  '#ff944d',
  '#ffdf5f',
  '#82dc59',
  '#1a8fd6',
  '#7c63d1',
  '#6a2df0'
] as const

const BEAM_COUNT = PRISM_SPECTRUM.length
const VIEWBOX = 120
const TOP_Y = 10
const BOTTOM_Y = 110
const TOP_SPAN: [number, number] = [14, 106]
const BOTTOM_SPAN: [number, number] = [41, 79]
const TOP_GAP = 2.6
const BOTTOM_GAP = 1.3

function beamPolygon(index: number): string {
  const topWidth = (TOP_SPAN[1] - TOP_SPAN[0] - TOP_GAP * (BEAM_COUNT - 1)) / BEAM_COUNT
  const bottomWidth =
    (BOTTOM_SPAN[1] - BOTTOM_SPAN[0] - BOTTOM_GAP * (BEAM_COUNT - 1)) / BEAM_COUNT
  const tx0 = TOP_SPAN[0] + index * (topWidth + TOP_GAP)
  const bx0 = BOTTOM_SPAN[0] + index * (bottomWidth + BOTTOM_GAP)
  const round = (n: number): string => n.toFixed(2)
  return [
    `${round(tx0)},${TOP_Y}`,
    `${round(tx0 + topWidth)},${TOP_Y}`,
    `${round(bx0 + bottomWidth)},${BOTTOM_Y}`,
    `${round(bx0)},${BOTTOM_Y}`
  ].join(' ')
}

const BEAMS = PRISM_SPECTRUM.map((color, index) => ({ color, points: beamPolygon(index) }))

export type PrismMarkTone = 'live' | 'error'

interface PrismMarkProps {
  /** Pixel size of the square tile. */
  size?: number
  /** How many beams are lit (0-7). Defaults to all seven. */
  lit?: number
  /** `error` desaturates and dims the lit beams. */
  tone?: PrismMarkTone
  /** Plays a slow light sweep across the tile (loading feedback). */
  sweeping?: boolean
  className?: string
}

export function PrismMark({
  size = 72,
  lit = BEAM_COUNT,
  tone = 'live',
  sweeping = false,
  className
}: PrismMarkProps): React.JSX.Element {
  const litCount = Math.max(0, Math.min(BEAM_COUNT, Math.round(lit)))
  const radius = Math.round(size * 0.3)

  return (
    <div
      aria-hidden="true"
      className={clsx('prism-mark relative shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {/* Spectral bloom beneath the tile. Static; its opacity follows progress. */}
      <div
        className="pointer-events-none absolute left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: size * 2.4,
          height: size * 1.6,
          opacity: tone === 'error' ? 0.12 : 0.18 + (litCount / BEAM_COUNT) * 0.42,
          background:
            'radial-gradient(closest-side, rgba(255,148,77,0.32), rgba(124,99,209,0.22) 45%, transparent 100%)'
        }}
      />

      {/* Double-bezel tile: outer machined shell + inner dark core. */}
      <div
        className="relative h-full w-full border border-white/[0.09] bg-white/[0.035] p-[3px] shadow-[0_18px_48px_-18px_rgba(0,0,0,0.75)]"
        style={{ borderRadius: radius }}
      >
        <div
          className="relative h-full w-full overflow-hidden bg-[#05060a] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]"
          style={{ borderRadius: radius - 3 }}
        >
          <svg
            viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
            className={clsx(
              'absolute inset-0 h-full w-full transition-[filter] duration-500',
              tone === 'error' && 'grayscale'
            )}
          >
            {BEAMS.map((beam, index) => {
              const isLit = index < litCount
              return (
                <polygon
                  key={beam.color}
                  points={beam.points}
                  fill={beam.color}
                  className="transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    opacity: isLit ? (tone === 'error' ? 0.42 : 1) : 0.13,
                    transitionDelay: `${index * 55}ms`
                  }}
                />
              )
            })}
          </svg>
          {sweeping && tone !== 'error' && <span className="prism-mark-sweep" />}
        </div>
      </div>
    </div>
  )
}
