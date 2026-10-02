import { MongoClient } from 'mongodb'
import { inject } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { startServer } from '../../server/app.js'
import { createStore } from '../../server/store.js'
import { createBoard } from '../../src/lib/doc.js'
import { connectRoom } from '../../src/lib/sync.js'

let mongo
// Fresh, empty database per call. Pass the same one to two servers to simulate a restart.
export async function newDb() {
  mongo ??= await MongoClient.connect(inject('mongoUri'))
  return mongo.db('t' + Math.random().toString(36).slice(2, 10))
}

export async function testServer(db, roomOpts = { flushMs: 40 }) {
  db ??= await newDb()
  const store = createStore(db)
  const srv = await startServer({ store, roomOpts })
  return { ...srv, db, store, url: `http://localhost:${srv.port}` }
}

export function client(srv, room = 'room-test-1') {
  const board = createBoard()
  const awareness = new Awareness(board.doc)
  const link = connectRoom({ doc: board.doc, awareness, room, url: srv.url, flushMs: 10 })
  return { ...board, board, awareness, link, close: () => link.destroy() }
}

export async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('waitFor timed out: ' + String(fn))
    await new Promise((r) => setTimeout(r, 15))
  }
}

export const synced = (...cs) => waitFor(() => cs.every((c) => c.link.synced))
export const sameState = (a, b) => JSON.stringify(sortKeys(a.snapshot())) === JSON.stringify(sortKeys(b.snapshot()))

function sortKeys(o) {
  if (Array.isArray(o)) return o.map(sortKeys)
  if (o && typeof o === 'object') return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]))
  return o
}
