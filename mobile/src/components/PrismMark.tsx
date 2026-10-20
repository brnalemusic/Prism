import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'
import { useTheme } from '../state/settings'

interface PrismMarkProps {
  size?: number
  /** Overrides the theme accent, used on top of accent-coloured surfaces. */
  color?: string
  glow?: boolean
}

/**
 * The Prism mark redrawn for native: a light triangle splitting a beam into
 * a spectrum. Drawn as vectors so it stays crisp at every size.
 */
export function PrismMark({ size = 28, color, glow = false }: PrismMarkProps): React.JSX.Element {
  const theme = useTheme()
  const stroke = color ?? theme.accent
  const soft = color ?? theme.accentSoft

  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel="Prism">
      <Defs>
        <LinearGradient id="prismBody" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={soft} stopOpacity={0.34} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0.04} />
        </LinearGradient>
      </Defs>
      {glow ? <Path d="M24 6 L43 39 H5 Z" fill={stroke} opacity={0.12} /> : null}
      <Path
        d="M24 6 L43 39 H5 Z"
        fill="url(#prismBody)"
        stroke={stroke}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <Path d="M16.5 27.5 H31.5" stroke={stroke} strokeWidth={1.6} opacity={0.75} />
      <Path
        d="M33 23.5 L44 18"
        stroke={soft}
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.9}
      />
      <Path
        d="M33.6 27.5 L45 27.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.9}
      />
      <Path
        d="M33 31.5 L44 37"
        stroke={soft}
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.55}
      />
    </Svg>
  )
}
