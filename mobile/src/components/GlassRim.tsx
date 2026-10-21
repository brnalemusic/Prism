import { useId, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

const CYAN = '#22D3EE'
const MAGENTA = '#F472B6'
const WHITE = '#FFFFFF'

interface GlassRimProps {
  /** Corner radius of the host surface, in points. */
  radius: number
  /**
   * Chromatic dispersion is theme-agnostic by design (it is literal light
   * splitting at a glass edge), so only its strength varies per surface.
   */
  strong?: boolean
}

/**
 * The spectral edge of a glass surface: two faint off-color strokes offset
 * around the rim (dispersion), a white specular stroke that brightens toward
 * the top edge, and a soft inner shade near the bottom edge that gives the
 * glass its apparent thickness. Stroke-only SVG — crisp at every density,
 * zero blur cost.
 */
export function GlassRim({ radius, strong = false }: GlassRimProps): React.JSX.Element | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const rawId = useId()
  // Gradient ids are global within each Svg; sanitize React's ":r1:" form.
  const lightId = `rimLight-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setSize((prev) => {
      if (prev && prev.width === width && prev.height === height) return prev
      return { width, height }
    })
  }

  if (!size) {
    return <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout} />
  }

  const { width, height } = size
  const half = Math.min(width, height) / 2
  const clamp = (wanted: number): number => Math.max(0, Math.min(wanted, half))
  const d = strong ? 1.25 : 1

  // Dispersed strokes hug the rim at ~1–3pt before the true radius so the
  // spectral fringe reads as refraction, not as a second border.
  const whiteRect = { x: 1, y: 1, w: width - 2, h: height - 2, rx: clamp(radius - 1), sw: 1.5 }
  const cyanRect = { x: 2, y: 2, w: width - 4, h: height - 4, rx: clamp(radius - 2), sw: 1.25 }
  const magentaRect = { x: 3, y: 3, w: width - 6, h: height - 6, rx: clamp(radius - 3), sw: 1 }
  const shadeRect = { x: 2, y: 2, w: width - 4, h: height - 4, rx: clamp(radius - 2), sw: 2.5 }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      <Svg width={width} height={height} style={styles.svg}>
        <Defs>
          <LinearGradient id={lightId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={WHITE} stopOpacity={0.16 * d} />
            <Stop offset="0.35" stopColor={WHITE} stopOpacity={0.05 * d} />
            <Stop offset="1" stopColor={WHITE} stopOpacity={0.02 * d} />
          </LinearGradient>
        </Defs>
        <Rect
          x={cyanRect.x}
          y={cyanRect.y}
          width={cyanRect.w}
          height={cyanRect.h}
          rx={cyanRect.rx}
          stroke={CYAN}
          strokeWidth={cyanRect.sw}
          strokeOpacity={0.07 * d}
          fill="none"
        />
        <Rect
          x={magentaRect.x}
          y={magentaRect.y}
          width={magentaRect.w}
          height={magentaRect.h}
          rx={magentaRect.rx}
          stroke={MAGENTA}
          strokeWidth={magentaRect.sw}
          strokeOpacity={0.055 * d}
          fill="none"
        />
        <Rect
          x={whiteRect.x}
          y={whiteRect.y}
          width={whiteRect.w}
          height={whiteRect.h}
          rx={whiteRect.rx}
          stroke={`url(#${lightId})`}
          strokeWidth={whiteRect.sw}
          fill="none"
        />
        <Rect
          x={shadeRect.x}
          y={shadeRect.y}
          width={shadeRect.w}
          height={shadeRect.h}
          rx={shadeRect.rx}
          stroke="rgba(0, 0, 0, 1)"
          strokeOpacity={0.13 * d}
          strokeWidth={shadeRect.sw}
          fill="none"
        />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  svg: {
    flex: 1
  }
})
