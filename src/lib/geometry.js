// Pure geometry for the board. No DOM, so it all runs under vitest.
//
// Object shapes (all coordinates are world units):
//   rect, ellipse  { x, y, w, h }              w and h are >= 0
//   line           { x, y, w, h }              runs from (x,y) to (x+w, y+h), w and h may be negative
//   pen            { x, y, points: [x0,y0,..] } points are relative to (x,y)
//   text           { x, y, w, h, text, size }  w and h are measured when the text is committed

export const rectsIntersect = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

export const unionRect = (a, b) => {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export const growRect = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + n * 2, h: r.h + n * 2 })

export function bboxOf(o) {
  const pad = (o.sw ?? 2) / 2
  let b
  if (o.type === 'pen') {
    // The smoothed curve can swing past its points, but it stays inside the hull of its
    // bezier control points. Use those so a repaint never clips the stroke.
    const p = o.points
    const n = p.length / 2
    const at = (i, k) => p[Math.max(0, Math.min(n - 1, i)) * 2 + k]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const take = (x, y) => {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (let i = 0; i < n; i++) {
      take(at(i, 0), at(i, 1))
      take(at(i, 0) + (at(i + 1, 0) - at(i - 1, 0)) / 6, at(i, 1) + (at(i + 1, 1) - at(i - 1, 1)) / 6)
      take(at(i + 1, 0) - (at(i + 2, 0) - at(i, 0)) / 6, at(i + 1, 1) - (at(i + 2, 1) - at(i, 1)) / 6)
    }
    b = { x: o.x + minX, y: o.y + minY, w: maxX - minX, h: maxY - minY }
  } else if (o.type === 'line') {
    b = { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) }
  } else {
    b = { x: o.x, y: o.y, w: o.w, h: o.h }
  }
  return o.type === 'text' ? b : growRect(b, pad)
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// tol is in world units, the caller divides its pixel slop by the zoom.
export function hitTest(o, x, y, tol) {
  const slop = tol + (o.sw ?? 2) / 2
  switch (o.type) {
    case 'rect':
      return x >= o.x - slop && x <= o.x + o.w + slop && y >= o.y - slop && y <= o.y + o.h + slop
    case 'text':
      return x >= o.x - tol && x <= o.x + o.w + tol && y >= o.y - tol && y <= o.y + o.h + tol
    case 'ellipse': {
      const rx = o.w / 2 + slop, ry = o.h / 2 + slop
      if (rx <= 0 || ry <= 0) return false
      const nx = (x - (o.x + o.w / 2)) / rx, ny = (y - (o.y + o.h / 2)) / ry
      return nx * nx + ny * ny <= 1
    }
    case 'line':
      return distToSegment(x, y, o.x, o.y, o.x + o.w, o.y + o.h) <= slop
    case 'pen': {
      const p = o.points
      if (p.length === 2) return Math.hypot(x - o.x - p[0], y - o.y - p[1]) <= slop
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (distToSegment(x, y, o.x + p[i], o.y + p[i + 1], o.x + p[i + 2], o.y + p[i + 3]) <= slop) return true
      }
      return false
    }
    default:
      return false
  }
}

// Ramer-Douglas-Peucker on a flat [x,y,x,y,...] array. Keeps the endpoints.
export function simplify(pts, tol) {
  const n = pts.length / 2
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let far = -1, farD = tol
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1])
      if (d > farD) { far = i; farD = d }
    }
    if (far > -1) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

// Catmull-Rom spline through the points, written as cubic beziers.
// `path` is a Path2D or a canvas context, anything with moveTo/lineTo/bezierCurveTo.
export function traceSmooth(path, pts, ox = 0, oy = 0) {
  const n = pts.length / 2
  const X = (i) => pts[Math.max(0, Math.min(n - 1, i)) * 2] + ox
  const Y = (i) => pts[Math.max(0, Math.min(n - 1, i)) * 2 + 1] + oy
  path.moveTo(X(0), Y(0))
  if (n === 1) {
    path.lineTo(X(0) + 0.01, Y(0))
    return
  }
  for (let i = 0; i < n - 1; i++) {
    path.bezierCurveTo(
      X(i) + (X(i + 1) - X(i - 1)) / 6, Y(i) + (Y(i + 1) - Y(i - 1)) / 6,
      X(i + 1) - (X(i + 2) - X(i)) / 6, Y(i + 1) - (Y(i + 2) - Y(i)) / 6,
      X(i + 1), Y(i + 1),
    )
  }
}

// ---- selection box and resizing ----

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function handlePoint(box, h) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  return {
    nw: [box.x, box.y], n: [cx, box.y], ne: [box.x + box.w, box.y], e: [box.x + box.w, cy],
    se: [box.x + box.w, box.y + box.h], s: [cx, box.y + box.h], sw: [box.x, box.y + box.h], w: [box.x, cy],
  }[h]
}

// Drag handle `h` of `box` by (dx, dy). The opposite edge stays put.
// keepAspect locks the ratio. Result is normalised, so dragging past the far edge flips it.
export function resizeBox(box, h, dx, dy, keepAspect = false) {
  let x1 = box.x, y1 = box.y, x2 = box.x + box.w, y2 = box.y + box.h
  if (h.includes('w')) x1 += dx
  if (h.includes('e')) x2 += dx
  if (h.includes('n')) y1 += dy
  if (h.includes('s')) y2 += dy
  if (keepAspect && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h
    let w = Math.abs(x2 - x1), hh = Math.abs(y2 - y1)
    const horizontalOnly = h === 'e' || h === 'w'
    const verticalOnly = h === 'n' || h === 's'
    if (horizontalOnly) hh = w / ratio
    else if (verticalOnly) w = hh * ratio
    else if (w / ratio > hh) hh = w / ratio
    else w = hh * ratio
    // anchor on the opposite corner or edge
    const ax = h.includes('w') ? box.x + box.w : h.includes('e') ? box.x : box.x + box.w / 2
    const ay = h.includes('n') ? box.y + box.h : h.includes('s') ? box.y : box.y + box.h / 2
    const sx = h.includes('w') ? -1 : h.includes('e') ? 1 : 0
    const sy = h.includes('n') ? -1 : h.includes('s') ? 1 : 0
    x1 = sx === 0 ? ax - w / 2 : Math.min(ax, ax + sx * w)
    x2 = sx === 0 ? ax + w / 2 : Math.max(ax, ax + sx * w)
    y1 = sy === 0 ? ay - hh / 2 : Math.min(ay, ay + sy * hh)
    y2 = sy === 0 ? ay + hh / 2 : Math.max(ay, ay + sy * hh)
  }
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

// Property changes that carry object `o` from `from` box into `to` box.
// Selection boxes include stroke padding, so we map the raw geometry, not the padded box.
export function resizePatch(o, from, to) {
  const sx = from.w > 0 ? to.w / from.w : 1
  const sy = from.h > 0 ? to.h / from.h : 1
  const mx = (v) => to.x + (v - from.x) * sx
  const my = (v) => to.y + (v - from.y) * sy
  switch (o.type) {
    case 'pen': {
      const abs = o.points.map((v, i) => (i % 2 ? my(v + o.y) : mx(v + o.x)))
      const minX = Math.min(...abs.filter((_, i) => i % 2 === 0))
      const minY = Math.min(...abs.filter((_, i) => i % 2 === 1))
      return { x: minX, y: minY, points: abs.map((v, i) => round(i % 2 ? v - minY : v - minX)) }
    }
    case 'line':
      return { x: mx(o.x), y: my(o.y), w: o.w * sx, h: o.h * sy }
    case 'text': {
      const k = Math.min(Math.abs(sx), Math.abs(sy)) || 1
      return { x: mx(o.x), y: my(o.y), size: Math.max(6, o.size * k), w: o.w * k, h: o.h * k }
    }
    default:
      return { x: mx(o.x), y: my(o.y), w: o.w * Math.abs(sx), h: o.h * Math.abs(sy) }
  }
}

export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d
