import { afterEach, expect, test } from 'vitest'
import { client, synced, testServer, waitFor } from './helpers.js'

const open = []
afterEach(async () => {
  for (const c of open.splice(0)) await c.close()
})

test('undo only reverts my own changes', async () => {
  const srv = await testServer()
  open.push({ close: () => srv.close() })
  const a = client(srv), b = client(srv)
  open.push(a, b)
  await synced(a, b)

  const mine = a.add({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
  a.commit()
  const theirs = b.add({ type: 'rect', x: 50, y: 50, w: 10, h: 10 })
  b.commit()
  await waitFor(() => a.read(theirs) && b.read(mine))

  a.undo.undo()
  expect(a.read(mine)).toBeNull()
  expect(a.read(theirs)).toBeTruthy() // b's shape is untouched
  expect(a.undo.canUndo()).toBe(false) // nothing of b's sits on a's stack

  await waitFor(() => b.read(mine) === null)
  b.undo.undo()
  expect(b.read(theirs)).toBeNull()
})

test("moving someone else's shape can be undone without deleting it", async () => {
  const srv = await testServer()
  open.push({ close: () => srv.close() })
  const a = client(srv, 'room-test-4'), b = client(srv, 'room-test-4')
  open.push(a, b)
  await synced(a, b)

  const id = b.add({ type: 'rect', x: 10, y: 10, w: 5, h: 5 })
  await waitFor(() => a.read(id))
  a.patch(id, { x: 99 })
  a.commit()
  expect(a.read(id).x).toBe(99)
  a.undo.undo()
  expect(a.read(id)).toMatchObject({ x: 10 })
})
