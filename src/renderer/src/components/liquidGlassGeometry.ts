/** Vector normal field for a rounded plate. This describes the lens, never its backdrop. */
export function glassNormalField(
  width: number,
  height: number,
  radii: number[],
  depth: number
): string {
  const band = Math.max(1, Math.min(depth, width / 2, height / 2))
  const corners = radii.map((radius) => Math.max(0, Math.min(radius, width / 2, height / 2)))
  const rings = 32
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
    // Circular bevel cross-section: the surface normal tilts towards the rim.
    // Snell's law bends the ray inside glass (n = 1.46). Project its lateral
    // travel through a finite thickness onto the live backdrop plane.
    const distance = (ring + 0.5) / rings
    const incidence = Math.acos(distance) * 0.84
    const transmitted = Math.asin(Math.sin(incidence) / 1.46)
    const thickness = 0.65 + 0.35 * Math.sqrt(1 - Math.pow(1 - distance, 2))
    const shoulder = Math.min(1, (1 - distance) / 0.18)
    const smoothShoulder = shoulder * shoulder * (3 - 2 * shoulder)
    const strength =
      Math.min(1, thickness * Math.tan(incidence - transmitted) * 1.6) * smoothShoulder
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
      // Trace the view ray backwards into the convex plate, towards its center.
      // Outward sampling would request pixels beyond the compositor input and
      // create transparent cutouts at high curvature.
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
