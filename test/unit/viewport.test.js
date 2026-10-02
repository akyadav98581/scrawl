import { expect, test } from 'vitest'
import { fitBox, toScreen, toWorld, visibleRect, zoomAt } from '../../src/lib/viewport.js'

test('toWorld and toScreen are inverses', () => {
  const vp = { x: 120, y: -40, scale: 2.5 }
  const w = toWorld(vp, 300, 200)
  const s = toScreen(vp, w.x, w.y)
  expect(s.x).toBeCloseTo(300)
  expect(s.y).toBeCloseTo(200)
})

test('zoomAt keeps the world point under the cursor fixed', () => {
  const vp = { x: 50, y: 30, scale: 1 }
  const before = toWorld(vp, 400, 250)
  const next = zoomAt(vp, 400, 250, 1.8)
  const after = toWorld(next, 400, 250)
  expect(after.x).toBeCloseTo(before.x)
  expect(after.y).toBeCloseTo(before.y)
  expect(next.scale).toBeCloseTo(1.8)
})

test('zoom is clamped', () => {
  expect(zoomAt({ x: 0, y: 0, scale: 7 }, 0, 0, 10).scale).toBe(8)
  expect(zoomAt({ x: 0, y: 0, scale: 0.06 }, 0, 0, 0.01).scale).toBe(0.05)
})

test('visibleRect covers the screen in world units', () => {
  const r = visibleRect({ x: -100, y: -50, scale: 2 }, 800, 600)
  expect(r).toEqual({ x: 50, y: 25, w: 400, h: 300 })
})

test('fitBox puts the box in the middle of the screen', () => {
  const vp = fitBox({ x: 1000, y: 1000, w: 400, h: 200 }, 1000, 800)
  const c = toScreen(vp, 1200, 1100)
  expect(c.x).toBeCloseTo(500)
  expect(c.y).toBeCloseTo(400)
  expect(fitBox(null, 1000, 800).scale).toBe(1)
})
