import * as Y from 'yjs'

// Every local edit goes through this origin so undo can tell mine from theirs.
export const LOCAL = Symbol('local')

// A board is one Y.Map of objects. Each object is itself a Y.Map, so two people
// changing different properties of the same shape both win. Same property: last writer wins.
export function createBoard(doc = new Y.Doc()) {
  const objects = doc.getMap('objects')
  const undo = new Y.UndoManager(objects, {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: 1e9, // one gesture is one undo step, we cut steps by hand with commit()
  })

  const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

  return {
    doc, objects, undo,

    add(props) {
      const id = newId()
      doc.transact(() => {
        const m = new Y.Map()
        for (const [k, v] of Object.entries({ z: Date.now(), ...props })) m.set(k, v)
        objects.set(id, m)
      }, LOCAL)
      return id
    },

    // Bulk insert in one transaction. Used for imports and the benchmark.
    addMany(list) {
      const ids = []
      doc.transact(() => {
        for (const props of list) {
          const id = newId()
          const m = new Y.Map()
          for (const [k, v] of Object.entries({ z: Date.now() + ids.length / 1e4, ...props })) m.set(k, v)
          objects.set(id, m)
          ids.push(id)
        }
      }, LOCAL)
      return ids
    },

    patch(id, props) {
      const m = objects.get(id)
      if (!m) return
      doc.transact(() => {
        for (const [k, v] of Object.entries(props)) m.set(k, v)
      }, LOCAL)
    },

    // Same patch for many objects in one transaction, so it is one network update.
    patchMany(patches) {
      doc.transact(() => {
        for (const [id, props] of patches) {
          const m = objects.get(id)
          if (m) for (const [k, v] of Object.entries(props)) m.set(k, v)
        }
      }, LOCAL)
    },

    remove(ids) {
      doc.transact(() => {
        for (const id of ids) objects.delete(id)
      }, LOCAL)
    },

    read(id) {
      const m = objects.get(id)
      return m ? { id, ...m.toJSON() } : null
    },

    snapshot() {
      return Object.fromEntries([...objects.entries()].map(([id, m]) => [id, m.toJSON()]))
    },

    commit: () => undo.stopCapturing(),
  }
}
