import { bboxOf, simplify, traceSmooth } from './geometry.js'

export const FONT = '"Geist Variable", system-ui, sans-serif'
export const MONO = '"Geist Mono Variable", ui-monospace, monospace'
export const LINE_HEIGHT = 1.3

// Shapes that end up a few pixels wide are drawn as flat blobs, and mid-size pens as a
// plain polyline. Zoomed out on a busy board that is most of what is on screen.
const BLOB_PX = 3
const POLYLINE_PX = 48

export function drawObject(ctx, entry, skipId, scale = 1) {
  const o = entry.obj
  if (o.id === skipId) return
  const px = Math.max(entry.bbox.w, entry.bbox.h) * scale

  if (px < BLOB_PX) {
    const b = entry.bbox
    ctx.globalAlpha = o.type === 'text' ? 0.35 : 0.7
    ctx.fillStyle = o.color
    ctx.fillRect(b.x, b.y, Math.max(b.w, 1 / scale), Math.max(b.h, 1 / scale))
    ctx.globalAlpha = 1
    return
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = o.color
  ctx.fillStyle = o.color
  ctx.lineWidth = o.sw ?? 2
  switch (o.type) {
    case 'rect':
      ctx.strokeRect(o.x, o.y, o.w, o.h)
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'line':
      ctx.beginPath()
      ctx.moveTo(o.x, o.y)
      ctx.lineTo(o.x + o.w, o.y + o.h)
      ctx.stroke()
      break
    case 'pen': {
      ctx.save()
      ctx.translate(o.x, o.y)
      if (px < POLYLINE_PX) {
        // cached per zoom bucket, so panning never rebuilds it
        const bucket = Math.round(Math.log2(scale) * 2)
        if (entry.lodBucket !== bucket) {
          const pts = simplify(o.points, 1 / scale)
          entry.lod = new Path2D()
          entry.lod.moveTo(pts[0], pts[1])
          for (let i = 2; i < pts.length; i += 2) entry.lod.lineTo(pts[i], pts[i + 1])
          entry.lodBucket = bucket
        }
        ctx.stroke(entry.lod)
      } else {
        if (!entry.path) {
          entry.path = new Path2D()
          traceSmooth(entry.path, o.points)
        }
        ctx.stroke(entry.path)
      }
      ctx.restore()
      break
    }
    case 'text':
      if (o.size * scale < 5) {
        ctx.globalAlpha = 0.35
        ctx.fillRect(o.x, o.y + o.h * 0.3, o.w, o.h * 0.4)
        ctx.globalAlpha = 1
        break
      }
      ctx.font = `${o.size}px ${FONT}`
      ctx.textBaseline = 'top'
      o.text.split('\n').forEach((line, i) => ctx.fillText(line, o.x, o.y + i * o.size * LINE_HEIGHT))
      break
  }
}

// A draft is an object that is still being drawn. Same drawing code, no cache.
export function drawDraft(ctx, d, alpha = 1) {
  ctx.save()
  ctx.globalAlpha = alpha
  const obj = { id: 'draft', z: 0, sw: 2, ...d }
  drawObject(ctx, { obj, bbox: bboxOf(obj), path: null }, null, 1e6) // 1e6: never use the zoomed-out shortcuts
  ctx.restore()
}

export function measureText(text, size) {
  measureText.ctx ??= document.createElement('canvas').getContext('2d')
  const ctx = measureText.ctx
  ctx.font = `${size}px ${FONT}`
  const lines = text.split('\n')
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
  return { w: Math.ceil(w), h: Math.ceil(lines.length * size * LINE_HEIGHT) }
}

export function drawCursor(ctx, sx, sy, name, color) {
  ctx.save()
  ctx.translate(sx, sy)
  ctx.fillStyle = color
  ctx.strokeStyle = '#FBFBFA'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 15)
  ctx.lineTo(4, 11.5)
  ctx.lineTo(7.5, 18)
  ctx.lineTo(10, 17)
  ctx.lineTo(6.5, 10.5)
  ctx.lineTo(11.5, 10.5)
  ctx.closePath()
  ctx.stroke()
  ctx.fill()
  ctx.font = `500 11px ${MONO}`
  const w = ctx.measureText(name).width + 12
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(12, 16, w, 18, 3)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 18, 25.5)
  ctx.restore()
}
