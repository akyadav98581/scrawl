import { expect, test } from 'vitest'
import {
  bboxOf, hitTest, rectsIntersect, resizeBox, resizePatch, simplify, traceSmooth, unionRect,
} from '../../src/lib/geometry.js'

const rect = { type: 'rect', x: 10, y: 10, w: 100, h: 50, sw: 2 }
const ellipse = { type: 'ellipse', x: 0, y: 0, w: 100, h: 60, sw: 2 }
const line = { type: 'line', x: 0, y: 0, w: 100, h: 0, sw: 2 }
const pen = { type: 'pen', x: 50, y: 50, points: [0, 0, 20, 0, 20, 20], sw: 2 }

test('bbox pads by half the stroke, except text', () => {
  expect(bboxOf(rect)).toEqual({ x: 9, y: 9, w: 102, h: 52 })
  expect(bboxOf({ type: 'text', x: 5, y: 5, w: 30, h: 12 })).toEqual({ x: 5, y: 5, w: 30, h: 12 })
  const b = bboxOf(pen)
  expect(b.x).toBeLessThanOrEqual(49) // never tighter than the raw points
  expect(b.y).toBeLessThanOrEqual(49)
  expect(b.x + b.w).toBeGreaterThanOrEqual(71)
  expect(b.y + b.h).toBeGreaterThanOrEqual(71)
})

test('pen bbox contains the smoothed curve, which overshoots sharp turns', () => {
  const o = { type: 'pen', x: 0, y: 0, points: [0, 0, 100, 0, 100, 100, 0, 100, 0, 0], sw: 0 }
  const path = []
  traceSmooth({ moveTo() {}, lineTo() {}, bezierCurveTo: (a, b, c, d, e, f) => path.push([a, b], [c, d], [e, f]) }, o.points)
  const box = bboxOf(o)
  for (const [x, y] of path) {
    expect(x).toBeGreaterThanOrEqual(box.x - 1e-9)
    expect(x).toBeLessThanOrEqual(box.x + box.w + 1e-9)
    expect(y).toBeGreaterThanOrEqual(box.y - 1e-9)
    expect(y).toBeLessThanOrEqual(box.y + box.h + 1e-9)
  }
})

test('bbox of a line drawn right-to-left is normalised', () => {
  expect(bboxOf({ type: 'line', x: 100, y: 50, w: -60, h: -20, sw: 0 })).toEqual({ x: 40, y: 30, w: 60, h: 20 })
})

test('hit tests per shape', () => {
  expect(hitTest(rect, 50, 30, 0)).toBe(true)
  expect(hitTest(rect, 200, 30, 0)).toBe(false)
  expect(hitTest(ellipse, 50, 30, 0)).toBe(true)
  expect(hitTest(ellipse, 2, 2, 0)).toBe(false) // corner of the bbox, outside the curve
  expect(hitTest(line, 50, 1, 0)).toBe(true)
  expect(hitTest(line, 50, 20, 0)).toBe(false)
  expect(hitTest(line, 50, 20, 20)).toBe(true) // tolerance grows the target
  expect(hitTest(pen, 70, 60, 0)).toBe(true) // on the vertical leg
  expect(hitTest(pen, 55, 70, 0)).toBe(false)
})

test('rect and intersect helpers', () => {
  expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
  expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 })).toBe(false)
  expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 5, h: 30 })).toEqual({ x: 0, y: 0, w: 25, h: 35 })
  expect(unionRect(null, { x: 1, y: 1, w: 1, h: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 1 })
})

test('simplify drops collinear points and keeps corners', () => {
  const flat = [0, 0, 5, 0.1, 10, 0, 10, 10]
  expect(simplify(flat, 0.5)).toEqual([0, 0, 10, 0, 10, 10])
  const wiggle = []
  for (let i = 0; i <= 100; i++) wiggle.push(i, Math.sin(i / 5) * 0.2)
  expect(simplify(wiggle, 0.5).length).toBe(4) // flat enough to be one segment
  expect(simplify([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4])
})

test('traceSmooth emits one bezier per segment and ends on the last point', () => {
  const calls = []
  const rec = { moveTo: (...a) => calls.push(['m', ...a]), lineTo: (...a) => calls.push(['l', ...a]), bezierCurveTo: (...a) => calls.push(['b', ...a]) }
  traceSmooth(rec, [0, 0, 10, 10, 20, 0, 30, 10], 5, 5)
  expect(calls[0]).toEqual(['m', 5, 5])
  expect(calls.filter((c) => c[0] === 'b').length).toBe(3)
  expect(calls.at(-1).slice(-2)).toEqual([35, 15])
  // a spline passes through its points, so each bezier ends on a control point
  expect(calls[1].slice(-2)).toEqual([15, 15])
})

test('resizeBox moves only the dragged edges', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 }
  expect(resizeBox(box, 'se', 20, 10)).toEqual({ x: 0, y: 0, w: 120, h: 60 })
  expect(resizeBox(box, 'nw', 10, 10)).toEqual({ x: 10, y: 10, w: 90, h: 40 })
  expect(resizeBox(box, 'e', -30, 99)).toEqual({ x: 0, y: 0, w: 70, h: 50 })
})

test('resizeBox flips when dragged past the opposite edge', () => {
  expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'e', -150, 0)).toEqual({ x: -50, y: 0, w: 50, h: 50 })
})

test('resizeBox with aspect lock keeps the ratio and the anchor corner', () => {
  const r = resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'se', 100, 0, true)
  expect(r.w / r.h).toBeCloseTo(2)
  expect(r.x).toBe(0)
  expect(r.y).toBe(0)
  const nw = resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'nw', -50, -10, true)
  expect(nw.x + nw.w).toBeCloseTo(100)
  expect(nw.y + nw.h).toBeCloseTo(50)
})

test('resizePatch scales a rect and a pen stroke into the new box', () => {
  const from = { x: 0, y: 0, w: 100, h: 100 }
  const to = { x: 0, y: 0, w: 200, h: 50 }
  expect(resizePatch({ type: 'rect', x: 0, y: 0, w: 100, h: 100 }, from, to)).toEqual({ x: 0, y: 0, w: 200, h: 50 })
  const p = resizePatch({ type: 'pen', x: 0, y: 0, points: [0, 0, 100, 100] }, from, to)
  expect(p).toEqual({ x: 0, y: 0, points: [0, 0, 200, 50] })
  const l = resizePatch({ type: 'line', x: 0, y: 0, w: 100, h: -100 }, { x: 0, y: -100, w: 100, h: 100 }, { x: 0, y: -100, w: 50, h: 100 })
  expect(l).toEqual({ x: 0, y: 0, w: 50, h: -100 })
})
