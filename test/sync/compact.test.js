import { afterEach, expect, test } from 'vitest'
import { client, newDb, sameState, synced, testServer, waitFor } from './helpers.js'

const open = []
afterEach(async () => {
  for (const c of open.splice(0)) await c.close()
})

test('compaction folds the log into one snapshot and keeps the state', async () => {
  const db = await newDb()
  const s1 = await testServer(db, { flushMs: 25, compactEvery: 1000 })
  open.push({ close: () => s1.close() })
  const a = client(s1)
  open.push(a)
  await synced(a)

  const id = a.add({ type: 'rect', x: 0, y: 0, w: 5, h: 5 })
  for (let n = 1; n <= 6; n++) {
    a.patch(id, { x: n })
    await new Promise((r) => setTimeout(r, 60)) // each lands as its own log row
  }
  const before = await s1.store.logSize('room-test-1')
  expect(before).toBeGreaterThanOrEqual(5)

  await s1.rooms.compactNow('room-test-1')
  expect(await s1.store.logSize('room-test-1')).toBe(0)
  const { snapshot } = await s1.store.load('room-test-1')
  expect(snapshot).toBeTruthy()

  // fresh server, same db: state comes back from the snapshot alone
  const s2 = await testServer(db)
  open.push({ close: () => s2.close() })
  const b = client(s2)
  open.push(b)
  await synced(b)
  await waitFor(() => sameState(a, b))
  expect(b.read(id).x).toBe(6)
})

test('log auto-compacts once it reaches compactEvery', async () => {
  const s = await testServer(await newDb(), { flushMs: 20, compactEvery: 3 })
  open.push({ close: () => s.close() })
  const a = client(s, 'room-test-9')
  open.push(a)
  await synced(a)
  const id = a.add({ type: 'rect', x: 0, y: 0, w: 1, h: 1 })
  for (let n = 1; n <= 8; n++) {
    a.patch(id, { x: n })
    await new Promise((r) => setTimeout(r, 50))
  }
  await waitFor(async () => (await s.store.logSize('room-test-9')) < 3)
  expect((await s.store.load('room-test-9')).snapshot).toBeTruthy()
})
