import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { Rooms } from './rooms.js'

const ROOM_ID = /^[A-Za-z0-9_-]{6,64}$/
const JOINS_PER_MIN = 60 // per client address
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

// Behind Render the address is in X-Forwarded-For. Spoofable without a proxy, so best effort.
const clientIp = (socket) => socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address

export async function startServer({ store, limiter, port = 0, roomOpts } = {}) {
  await store.init()
  const app = express()
  app.get('/healthz', (_req, res) => res.send('ok'))
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  const server = http.createServer(app)
  const io = new Server(server, { serveClient: false, maxHttpBufferSize: 8e6, transports: ['websocket'] })
  const rooms = new Rooms(io, store, roomOpts)

  io.on('connection', (socket) => {
    socket.data.awarenessIds = new Set()
    let room = null

    socket.on('join', async ({ room: id, sv } = {}, ack) => {
      if (room || typeof ack !== 'function') return
      if (!ROOM_ID.test(id)) return ack({ error: 'bad room id' })
      if (limiter && !(await limiter.allow(`join:${clientIp(socket)}`, JOINS_PER_MIN, 60))) return ack({ error: 'too many joins' })
      try {
        const joined = await rooms.join(socket, id, sv ? new Uint8Array(sv) : undefined)
        room = joined.room
        ack(joined.reply)
      } catch (err) {
        console.error('join failed', err)
        ack({ error: 'join failed' })
      }
    })

    socket.on('update', (buf) => room && rooms.applyUpdate(room, socket, buf))
    socket.on('awareness', (buf) => room && rooms.applyAwareness(room, socket, buf))
    socket.on('disconnect', () => room && rooms.leave(socket, room))
  })

  await new Promise((resolve) => server.listen(port, resolve))
  return {
    io, rooms, server,
    port: server.address().port,
    async close() {
      await rooms.shutdown()
      io.close()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
