import { afterEach, expect, test } from 'vitest'
import { client, sameState, synced, testServer, waitFor } from './helpers.js'

const open = []
afterEach(async () => {
  for (const c of open.splice(0)) await c.close()
})

test('edits made offline merge after reconnect', async () => {
  const srv = await testServer()
  open.push({ close: () => srv.close() })
  const a = client(srv), b = client(srv)
  open.push(a, b)
  await synced(a, b)

  const shared = a.add({ type: 'rect', x: 0, y: 0, w: 10, h: 10 })
  await waitFor(() => b.read(shared))

  a.link.socket.disconnect()
  await waitFor(() => !a.link.synced)

  const aOnly = a.add({ type: 'pen', x: 5, y: 5, points: [0, 0, 4, 4] }) // drawn offline
  a.patch(shared, { x: 33 })
  const bOnly = b.add({ type: 'ellipse', x: 2, y: 2, w: 8, h: 8 })
  b.patch(shared, { y: 44 })
  await waitFor(() => b.read(aOnly) === null) // b has not heard from a

  a.link.socket.connect()
  await synced(a)
  await waitFor(() => sameState(a, b))

  expect(a.read(bOnly)).toBeTruthy()
  expect(b.read(aOnly)).toBeTruthy()
  expect(b.read(shared)).toMatchObject({ x: 33, y: 44 })
})

test('a client that was offline for the whole edit session catches up', async () => {
  const srv = await testServer()
  open.push({ close: () => srv.close() })
  const a = client(srv, 'room-test-3'), b = client(srv, 'room-test-3')
  open.push(a, b)
  await synced(a, b)
  b.link.socket.disconnect()
  await waitFor(() => !b.link.synced)
  const ids = [1, 2, 3].map((n) => a.add({ type: 'rect', x: n, y: n, w: 1, h: 1 }))
  await new Promise((r) => setTimeout(r, 120))
  b.link.socket.connect()
  await synced(b)
  await waitFor(() => ids.every((id) => b.read(id)))
})
