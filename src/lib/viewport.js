// The viewport is { x, y, scale }: where world (0,0) sits on screen, and the zoom.
// We do the math ourselves and hand the result to ctx.setTransform, no CSS scaling.

export const MIN_SCALE = 0.05
export const MAX_SCALE = 8

export const toWorld = (vp, sx, sy) => ({ x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale })
export const toScreen = (vp, wx, wy) => ({ x: wx * vp.scale + vp.x, y: wy * vp.scale + vp.y })

// Zoom so the world point under (sx, sy) stays under the cursor.
export function zoomAt(vp, sx, sy, factor) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * factor))
  const k = scale / vp.scale
  return { scale, x: sx - (sx - vp.x) * k, y: sy - (sy - vp.y) * k }
}

export function visibleRect(vp, width, height) {
  return { x: -vp.x / vp.scale, y: -vp.y / vp.scale, w: width / vp.scale, h: height / vp.scale }
}

// Viewport that centres `box` with some breathing room. Used by "fit".
export function fitBox(box, width, height, pad = 80) {
  if (!box) return { x: width / 2, y: height / 2, scale: 1 }
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((width - pad * 2) / Math.max(box.w, 1), (height - pad * 2) / Math.max(box.h, 1), 1.5)),
  )
  return {
    scale,
    x: width / 2 - (box.x + box.w / 2) * scale,
    y: height / 2 - (box.y + box.h / 2) * scale,
  }
}
