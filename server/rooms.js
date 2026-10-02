import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'

const FLUSH_MS = 400 // how long we batch incoming updates before one DB write
const IDLE_MS = 30_000 // empty room stays in memory this long
const COMPACT_EVERY = 200 // log rows before we fold them into the snapshot

export class Rooms {
  constructor(io, store, opts = {}) {
    this.io = io
    this.store = store
    this.opts = { flushMs: FLUSH_MS, idleMs: IDLE_MS, compactEvery: COMPACT_EVERY, ...opts }
    this.rooms = new Map() // id -> Promise<Room>
  }

  get(id) {
    let p = this.rooms.get(id)
    if (!p) {
      p = this.#open(id).catch((err) => {
        this.rooms.delete(id)
        throw err
      })
      this.rooms.set(id, p)
    }
    return p
  }

  async #open(id) {
    const doc = new Y.Doc()
    const { snapshot, updates, lastSeq } = await this.store.load(id)
    doc.transact(() => {
      if (snapshot) Y.applyUpdate(doc, snapshot)
      for (const u of updates) Y.applyUpdate(doc, u)
    }, 'load')

    const awareness = new Awareness(doc)
    awareness.setLocalState(null) // the server has no cursor of its own

    const room = {
      id, doc, awareness, lastSeq,
      logCount: updates.length,
      sockets: new Set(),
      pending: [],
      flushTimer: null,
      idleTimer: null,
      chain: Promise.resolve(),
    }

    doc.on('update', (update, origin) => {
      if (origin?.id) origin.to(id).emit('update', update)
      else if (origin !== 'load') this.io.to(id).emit('update', update)
      if (origin === 'load') return
      room.pending.push(update)
      room.flushTimer ??= setTimeout(() => this.#flush(room), this.opts.flushMs)
    })

    awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin?.data) {
        for (const c of added) origin.data.awarenessIds.add(c)
        for (const c of removed) origin.data.awarenessIds.delete(c)
      }
      const msg = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])
      if (origin?.id) origin.to(id).emit('awareness', msg)
      else this.io.to(id).emit('awareness', msg)
    })

    return room
  }

  #run(room, fn) {
    room.chain = room.chain.then(fn).catch((err) => console.error(`room ${room.id}:`, err))
    return room.chain
  }

  #flush(room) {
    clearTimeout(room.flushTimer)
    room.flushTimer = null
    if (!room.pending.length) return room.chain
    const merged = Y.mergeUpdates(room.pending)
    room.pending = []
    return this.#run(room, async () => {
      await this.store.append(room.id, room.lastSeq + 1, merged)
      room.lastSeq += 1
      room.logCount += 1
      if (room.logCount >= this.opts.compactEvery) await this.#compact(room)
    })
  }

  async #compact(room) {
    const snapshot = Y.encodeStateAsUpdate(room.doc)
    await this.store.compact(room.id, snapshot, room.lastSeq)
    room.logCount = 0
  }

  // Flush what is pending, then fold the log into a snapshot.
  async compactNow(id) {
    const room = await this.get(id)
    await this.#flush(room)
    await this.#run(room, () => this.#compact(room))
  }

  async join(socket, id, clientSV) {
    const room = await this.get(id)
    clearTimeout(room.idleTimer)
    room.sockets.add(socket.id)
    socket.join(id)
    const ids = [...room.awareness.getStates().keys()]
    if (ids.length) socket.emit('awareness', encodeAwarenessUpdate(room.awareness, ids))
    return {
      room,
      reply: { update: Y.encodeStateAsUpdate(room.doc, clientSV), sv: Y.encodeStateVector(room.doc) },
    }
  }

  applyUpdate(room, socket, buf) {
    try {
      Y.applyUpdate(room.doc, new Uint8Array(buf), socket)
    } catch (err) {
      console.warn(`room ${room.id}: dropped bad update from ${socket.id}`)
    }
  }

  applyAwareness(room, socket, buf) {
    try {
      applyAwarenessUpdate(room.awareness, new Uint8Array(buf), socket)
    } catch {
      // ignore malformed presence
    }
  }

  leave(socket, room) {
    room.sockets.delete(socket.id)
    removeAwarenessStates(room.awareness, [...socket.data.awarenessIds], null)
    if (room.sockets.size === 0) {
      room.idleTimer = setTimeout(() => this.#unload(room), this.opts.idleMs)
    }
  }

  async #unload(room) {
    await this.compactNow(room.id)
    if (room.sockets.size > 0) return // someone came back while we were saving
    this.rooms.delete(room.id)
    room.awareness.destroy()
    room.doc.destroy()
  }

  async shutdown() {
    const all = await Promise.allSettled([...this.rooms.values()])
    await Promise.all(
      all.filter((r) => r.status === 'fulfilled').map(async ({ value: room }) => {
        clearTimeout(room.idleTimer)
        await this.#flush(room)
        await this.#run(room, () => this.#compact(room))
      }),
    )
  }
}
