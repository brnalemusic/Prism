import { useId } from 'react'

interface FluidGenerationPlaceholderProps {
  cancelled?: boolean
  label?: string
}

export function FluidGenerationPlaceholder({
  cancelled = false,
  label = 'Generating Image'
}: FluidGenerationPlaceholderProps): React.JSX.Element {
  const id = useId().replace(/:/g, '')
  const silkFilter = `${id}-silk`
  const upperGradient = `${id}-upper`
  const middleGradient = `${id}-middle`
  const lowerGradient = `${id}-lower`
  const cancelledLabel = label === 'Editing Image' ? 'Editing Cancelled' : 'Generation Cancelled'

  return (
    <div
      className={`image-generation-fluid${cancelled ? ' is-cancelled' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={cancelled ? cancelledLabel : label}
    >
      <svg
        className="image-generation-fluid-field"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={upperGradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--theme-aura-3)" stopOpacity="0.08" />
            <stop offset="0.42" stopColor="var(--accent-primary)" stopOpacity="0.32" />
            <stop offset="0.68" stopColor="var(--accent-secondary)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--theme-aura-1)" stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id={middleGradient} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--theme-aura-2)" stopOpacity="0.05" />
            <stop offset="0.38" stopColor="var(--accent-secondary)" stopOpacity="0.24" />
            <stop offset="0.7" stopColor="var(--accent-primary)" stopOpacity="0.3" />
            <stop offset="1" stopColor="var(--theme-aura-3)" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id={lowerGradient} x1="0" y1="0" x2="1" y2="0.65">
            <stop offset="0" stopColor="var(--accent-primary)" stopOpacity="0.08" />
            <stop offset="0.48" stopColor="var(--theme-aura-1)" stopOpacity="0.28" />
            <stop offset="0.72" stopColor="var(--accent-secondary)" stopOpacity="0.34" />
            <stop offset="1" stopColor="var(--theme-aura-3)" stopOpacity="0.04" />
          </linearGradient>
          <filter id={silkFilter} x="-20%" y="-25%" width="140%" height="150%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.006 0.021"
              numOctaves="2"
              seed="11"
              result="silkNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="silkNoise"
              scale="4.2"
              xChannelSelector="R"
              yChannelSelector="B"
            />
            <feGaussianBlur stdDeviation="0.55" />
          </filter>
        </defs>

        <g
          className="image-generation-ribbon image-generation-ribbon-a"
          filter={`url(#${silkFilter})`}
        >
          <path
            d="M-12 10 C9 11 16 25 35 27 C57 30 66 17 83 10 C95 5 105 6 114 3 L114 26 C101 25 94 31 82 37 C64 46 48 43 31 35 C13 27 2 29 -12 24 Z"
            fill={`url(#${upperGradient})`}
          />
          <path
            className="image-generation-ribbon-edge"
            d="M-10 12 C10 13 17 25 35 28 C57 31 67 18 84 11 C96 6 106 7 113 5"
          />
        </g>

        <g
          className="image-generation-ribbon image-generation-ribbon-b"
          filter={`url(#${silkFilter})`}
        >
          <path
            d="M-18 39 C2 27 18 31 30 43 C45 57 54 59 71 50 C87 41 99 35 116 42 L116 62 C101 56 91 59 78 67 C59 78 44 73 29 59 C15 47 1 47 -18 57 Z"
            fill={`url(#${middleGradient})`}
          />
          <path
            className="image-generation-ribbon-edge"
            d="M-14 40 C3 30 18 33 30 44 C45 57 54 60 72 51 C88 43 101 37 114 43"
          />
        </g>

        <g
          className="image-generation-ribbon image-generation-ribbon-c"
          filter={`url(#${silkFilter})`}
        >
          <path
            d="M-15 77 C4 65 20 68 35 78 C50 88 60 88 74 76 C89 63 103 64 116 72 L116 96 C99 86 91 85 78 94 C60 106 45 105 29 94 C14 83 0 86 -15 94 Z"
            fill={`url(#${lowerGradient})`}
          />
          <path
            className="image-generation-ribbon-edge"
            d="M-12 78 C5 67 20 70 35 79 C50 88 61 89 75 77 C90 65 103 66 114 73"
          />
        </g>

        <g
          className="image-generation-ribbon image-generation-ribbon-d"
          filter={`url(#${silkFilter})`}
        >
          <path
            d="M4 4 C19 17 22 31 16 47 C10 63 15 77 31 95 L13 108 C-4 87 -8 69 -1 49 C5 32 -1 20 -11 12 Z"
            fill={`url(#${middleGradient})`}
            opacity="0.5"
          />
        </g>
      </svg>
      <span className="image-generation-fluid-vignette" aria-hidden="true" />
      <span className="image-generation-label">{cancelled ? cancelledLabel : label}</span>
    </div>
  )
}
