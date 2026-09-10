/**
 * Vector normal field for a rounded plate. This describes the lens, never
 * its backdrop.
 *
 * Displacement profile v2 — "folded lens". Real convex glass does not
 * stretch its backdrop monotonically: the compressed ring near the rim
 * samples nearly the same content as the flat center, so the image appears
 * to fold back over itself just inside the edge before settling. This
 * module encodes that behaviour as three stacked smoothstep lobes over the
 * normalized edge distance t (0 = rim, 1 = inner edge of the optical band):
 *
 *   rise    0 → 1 across [0, 0.45]   compression towards the rim
 *   fold    0 → 1 across [0.45, 0.8] pull-back that overlaps earlier rings
 *   settle  0 → 1 across [0.8, 1]    return to exactly neutral
 *
 *   D(t) = rise · (1 − fold) − dip · fold · (1 − settle)
 *
 * D is zero at both ends (a sharp, unmoved rim line; a seamless join to
 * the flat center), peaks at +1 near t = 0.4 and dips to −dip near t = 0.8.
 * The negative lobe is the perceived inversion: inner rings sample content
 * the outer rings already showed, slightly magnified.
 */
function lensProfile(t: number): number {
  const smoothstep = (a: number, b: number, x: number): number => {
    const clamped = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return clamped * clamped * (3 - 2 * clamped)
  }
  const rise = smoothstep(0, 0.45, t)
  const fold = smoothstep(0.45, 0.8, t)
  const settle = smoothstep(0.8, 1, t)
  const dip = 0.16
  return rise * (1 - fold) - dip * fold * (1 - settle)
}

export function glassNormalField(
  width: number,
  height: number,
  radii: number[],
  depth: number
): string {
  const band = Math.max(1, Math.min(depth, width / 2, height / 2))
  const corners = radii.map((radius) => Math.max(0, Math.min(radius, width / 2, height / 2)))
  const rings = 48
  const segments = 24
  const point = (corner: number, angle: number, inset: number): [number, number] => {
    const radius = corners[corner]
    const r = Math.max(0, radius - inset)
    const cx =
      corner === 0 || corner === 3 ? Math.max(radius, inset) : width - Math.max(radius, inset)
    const cy = corner < 2 ? Math.max(radius, inset) : height - Math.max(radius, inset)
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  }
  const paths: string[] = []
  for (let ring = 0; ring < rings; ring++) {
    const outer = (ring / rings) * band
    const inner = ((ring + 1) / rings) * band
    // Normalized distance from the rim, driving the folded lens profile.
    const distance = (ring + 0.5) / rings
    const strength = lensProfile(distance)
    const perimeter: { p: [number, number]; q: [number, number]; angle: number }[] = []
    for (let corner = 0; corner < 4; corner++) {
      const start = Math.PI + (corner * Math.PI) / 2
      for (let step = 0; step <= segments; step++) {
        const angle = start + ((step / segments) * Math.PI) / 2
        perimeter.push({ p: point(corner, angle, outer), q: point(corner, angle, inner), angle })
      }
    }
    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i]
      const b = perimeter[(i + 1) % perimeter.length]
      const angle = i === perimeter.length - 1 ? a.angle : (a.angle + b.angle) / 2
      // Trace the view ray backwards into the convex plate, towards its
      // center. The profile can locally invert (fold), which is what makes
      // the backdrop appear to fold over itself instead of smearing
      // outwards. Outward sampling would request pixels beyond the
      // compositor input and create transparent cutouts at high curvature;
      // the host clamps the displacement scale so the peak sample offset
      // always stays inside the plate.
      const red = (50 - Math.cos(angle) * strength * 50).toFixed(3)
      const green = (50 - Math.sin(angle) * strength * 50).toFixed(3)
      const points = [a.p, b.p, b.q, a.q]
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ')
      paths.push(`<polygon points="${points}" fill="rgb(${red}%,${green}%,50%)"/>`)
    }
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="rgb(50%,50%,50%)"/>${paths.join('')}</svg>`)}`
}
