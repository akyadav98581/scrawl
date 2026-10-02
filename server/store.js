import { Binary, MongoClient } from 'mongodb'

// MongoDB storage for rooms: one snapshot doc per room plus an append-only log of Yjs updates.
// A snapshot has to fit in one 16 MB document, which is a lot of strokes.

const bytes = (bin) => new Uint8Array(bin.buffer)

export function createStore(db) {
  const snapshots = db.collection('snapshots') // _id = roomId
  const updates = db.collection('updates') // { roomId, seq, data }

  return {
    async init() {
      await updates.createIndex({ roomId: 1, seq: 1 }, { unique: true })
    },

    async load(roomId) {
      const snap = await snapshots.findOne({ _id: roomId })
      const log = await updates.find({ roomId }).sort({ seq: 1 }).toArray()
      return {
        snapshot: snap ? bytes(snap.data) : null,
        updates: log.map((r) => bytes(r.data)),
        lastSeq: log.length ? log[log.length - 1].seq : 0,
      }
    },

    // The caller owns the sequence number. Only one process writes a room (see README).
    async append(roomId, seq, update) {
      await updates.insertOne({ roomId, seq, data: new Binary(update), createdAt: new Date() })
    },

    // Snapshot first, then trim the log. If we die in between, replaying the old
    // log over the new snapshot is harmless because Yjs updates are idempotent.
    async compact(roomId, snapshot, uptoSeq) {
      await snapshots.updateOne(
        { _id: roomId },
        { $set: { data: new Binary(snapshot), updatedAt: new Date() } },
        { upsert: true },
      )
      await updates.deleteMany({ roomId, seq: { $lte: uptoSeq } })
    },

    logSize: (roomId) => updates.countDocuments({ roomId }),
  }
}

// Returns { db, close }. With MONGODB_URI set that is Atlas (or any Mongo).
// Without it we start a local mongod in .data/mongo, dev only.
export async function openDatabase(uri = process.env.MONGODB_URI) {
  let local = null
  if (!uri && process.env.NODE_ENV === 'production') throw new Error('MONGODB_URI is required in production')
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    const fs = await import('node:fs')
    fs.mkdirSync('.data/mongo', { recursive: true })
    local = await MongoMemoryServer.create({ instance: { dbPath: '.data/mongo', storageEngine: 'wiredTiger' } })
    uri = local.getUri()
    console.warn('MONGODB_URI not set, using a local mongod with data in .data/mongo')
  }
  const client = await MongoClient.connect(uri)
  return {
    db: client.db(process.env.MONGODB_DB || 'scrawl'),
    close: async () => {
      await client.close()
      await local?.stop()
    },
  }
}
