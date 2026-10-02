import { io } from 'socket.io-client'
import * as Y from 'yjs'
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'

// Origin for updates that came from the server, so we never echo them back.
export const REMOTE = Symbol('remote')

// Pipes a Y.Doc and its awareness over one socket.io connection.
// Local edits are batched for flushMs and sent as one merged update.
// After every (re)connect we swap state vectors, so edits made offline merge both ways.
export function connectRoom({ doc, awareness, room, url, onStatus = () => {}, flushMs = 30, wakingAfterMs = 4000 }) {
  const socket = io(url, { transports: ['websocket'], reconnectionDelayMax: 3000 })
  let synced = false
  let everConnected = false
  let queue = []
  let timer = null
  let wakingTimer = setTimeout(() => !everConnected && onStatus('waking'), wakingAfterMs)
  onStatus('connecting')

  const flush = () => {
    timer = null
    if (!queue.length) return
    socket.emit('update', Y.mergeUpdates(queue))
    queue = []
  }

  const onDocUpdate = (update, origin) => {
    if (origin === REMOTE || !synced) return // unsynced edits ride along in the join diff
    queue.push(update)
    timer ??= setTimeout(flush, flushMs)
  }

  const onAwareness = ({ added, updated, removed }, origin) => {
    if (origin === REMOTE || !synced) return
    socket.emit('awareness', encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
  }

  doc.on('update', onDocUpdate)
  awareness.on('update', onAwareness)

  socket.on('connect', () => {
    synced = false
    socket.emit('join', { room, sv: Y.encodeStateVector(doc) }, (res) => {
      if (res.error) return onStatus('error')
      Y.applyUpdate(doc, new Uint8Array(res.update), REMOTE)
      const diff = Y.encodeStateAsUpdate(doc, new Uint8Array(res.sv))
      if (diff.length > 2) socket.emit('update', diff) // [0,0] is an empty update
      queue = []
      synced = true
      everConnected = true
      clearTimeout(wakingTimer)
      socket.emit('awareness', encodeAwarenessUpdate(awareness, [doc.clientID]))
      onStatus('online')
    })
  })

  socket.on('update', (buf) => Y.applyUpdate(doc, new Uint8Array(buf), REMOTE))
  socket.on('awareness', (buf) => applyAwarenessUpdate(awareness, new Uint8Array(buf), REMOTE))

  const dropRemotePresence = () => {
    const others = [...awareness.getStates().keys()].filter((id) => id !== doc.clientID)
    removeAwarenessStates(awareness, others, REMOTE)
  }

  socket.on('disconnect', () => {
    synced = false
    dropRemotePresence()
    onStatus('offline')
  })
  socket.on('connect_error', () => onStatus(everConnected ? 'offline' : 'connecting'))

  return {
    socket,
    get synced() { return synced },
    destroy() {
      clearTimeout(timer)
      clearTimeout(wakingTimer)
      doc.off('update', onDocUpdate)
      awareness.off('update', onAwareness)
      removeAwarenessStates(awareness, [doc.clientID], 'destroy')
      socket.disconnect()
    },
  }
}
