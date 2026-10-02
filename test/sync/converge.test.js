import { afterEach, expect, test } from 'vitest'
import { client, sameState, synced, testServer, waitFor } from './helpers.js'

const open = []
afterEach(async () => {
  for (const c of open.splice(0)) await c.close()
})

test('concurrent edits to one shape converge, and a late joiner sees the same thing', async () => {
  const srv = await testServer()
  open.push({ close: () => srv.close() })
  const a = client(srv), b = client(srv)
  open.push(a, b)
  await synced(a, b)

  const id = a.add({ type: 'rect', x: 0, y: 0, w: 50, h: 50, color: '#111' })
  await waitFor(() => b.read(id))

  // Both write the same property before either update can arrive.
  a.patch(id, { x: 100, color: '#9F2F2D' })
  b.patch(id, { x: 200, y: 40 })
  const onlyA = a.add({ type: 'ellipse', x: 1, y: 1, w: 5, h: 5 })
  b.remove([id])
  b.add({ type: 'line', x: 9, y: 9, w: 3, h: 3 })

  await waitFor(() => sameState(a, b))
  expect(a.read(onlyA)).toBeTruthy() // an unrelated add survives the delete

  const c = client(srv)
  open.push(c)
  await synced(c)
  await waitFor(() => sameState(a, c))
  expect(Object.keys(c.snapshot()).length).toBe(Object.keys(a.snapshot()).length)
})

test('different properties of one shape both survive', async () => {
  const srv = await testServer()
  open.push({ close: () => srv.close() })
  const a = client(srv, 'room-test-2'), b = client(srv, 'room-test-2')
  open.push(a, b)
  await synced(a, b)
  const id = a.add({ type: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#111' })
  await waitFor(() => b.read(id))
  a.patch(id, { x: 70 })
  b.patch(id, { color: '#1F6C9F' })
  await waitFor(() => sameState(a, b))
  expect(a.read(id)).toMatchObject({ x: 70, color: '#1F6C9F' })
})
