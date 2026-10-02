import { afterEach, expect, test } from 'vitest'
import { client, newDb, synced, testServer, waitFor } from './helpers.js'

const open = []
afterEach(async () => {
  for (const c of open.splice(0)) await c.close()
})

test('room survives a clean restart (snapshot path)', async () => {
  const db = await newDb()
  const s1 = await testServer(db)
  const a = client(s1)
  await synced(a)
  const ids = [1, 2, 3].map((n) => a.add({ type: 'rect', x: n, y: n, w: 4, h: 4 }))
  await new Promise((r) => setTimeout(r, 150))
  a.close()
  await s1.close() // shutdown compacts

  const s2 = await testServer(db)
  open.push({ close: () => s2.close() })
  const b = client(s2)
  open.push(b)
  await synced(b)
  await waitFor(() => ids.every((id) => b.read(id)))
})

test('room survives a crash with no compaction (log replay path)', async () => {
  const db = await newDb()
  const s1 = await testServer(db, { flushMs: 30, compactEvery: 1000 })
  const a = client(s1)
  await synced(a)
  const first = a.add({ type: 'rect', x: 1, y: 1, w: 2, h: 2 })
  await new Promise((r) => setTimeout(r, 120))
  a.patch(first, { x: 77 })
  const second = a.add({ type: 'ellipse', x: 3, y: 3, w: 2, h: 2 })
  await new Promise((r) => setTimeout(r, 120))
  expect(await s1.store.logSize('room-test-1')).toBeGreaterThanOrEqual(2)
  a.close()
  // no rooms.shutdown(): this is what a killed process leaves behind
  s1.io.close()
  await new Promise((r) => s1.server.close(r))

  const s2 = await testServer(db)
  open.push({ close: () => s2.close() })
  const b = client(s2)
  open.push(b)
  await synced(b)
  await waitFor(() => b.read(second))
  expect(b.read(first).x).toBe(77)
})
