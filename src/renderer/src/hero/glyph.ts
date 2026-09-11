// Glyph geometry for the Hero theme's signature "9".
//
// Pure analytic math — no state, no DOM. The glyph is a signed distance field
// (negative inside the stroke) built from a ring (the bowl) and a segment
// (the tail), sampled by the simulation to place particles.

/** Signed distance from (px, py) to the segment (ax, ay) -> (bx, by). */
function sdSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby))
  )
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
}

// The "9": a ring (the bowl) plus a segment sweeping down from the bowl's
// right edge (the tail). Coordinates live in the unit square, y pointing down.
const BOWL = { cx: 0.46, cy: 0.3, r: 0.205 }
const TAIL = { ax: 0.665, ay: 0.3, bx: 0.55, by: 0.925 }
/** Half-width of the glyph stroke in unit-square distance. */
export const HALF_STROKE = 0.072

/** Signed distance to the "9" glyph (negative inside the stroke). */
export function sdf9(px: number, py: number): number {
  const dRing =
    Math.abs(Math.hypot(px - BOWL.cx, py - BOWL.cy) - BOWL.r) - HALF_STROKE
  const dTail =
    sdSegment(px, py, TAIL.ax, TAIL.ay, TAIL.bx, TAIL.by) - HALF_STROKE
  return Math.min(dRing, dTail)
}

// The glyph's visible width is ~0.554 of its height (ring outer edge to ring
// outer edge); X_SCALE converts unit-square x into glyph space accordingly.
export const VISIBLE_W_FACTOR = 0.56
export const X_SCALE = VISIBLE_W_FACTOR / 0.554

/** Width of the soft aura band around the stroke, in unit-square distance. */
export const AURA_BAND = 0.022
