import { bboxOf, growRect, rectsIntersect, unionRect } from './geometry.js'

// A plain-object mirror of the Yjs objects, with a cached bbox for each and a
// z-sorted list. It also collects a dirty rectangle so the renderer can repaint only
// the part of the canvas that changed.
export class Scene {
  constructor(board) {
    this.board = board
    this.entries = new Map() // id -> { obj, bbox, path }
    this.order = []
    this.orderStale = true
    this.dirty = null // null | 'all' | world rect
    this.listeners = new Set()

    for (const id of board.objects.keys()) this.#refresh(id, false)
    this.dirty = 'all'

    board.objects.observeDeep((events) => {
      const ids = new Set()
      for (const e of events) {
        if (e.target === board.objects) for (const k of e.keys.keys()) ids.add(k)
        else ids.add(e.path[0])
      }
      for (const id of ids) this.#refresh(id, true)
      this.listeners.forEach((fn) => fn())
    })
  }

  #refresh(id, track) {
    const old = this.entries.get(id)
    const m = this.board.objects.get(id)
    if (!m) {
      if (!old) return
      this.entries.delete(id)
      this.orderStale = true
      if (track) this.markDirty(old.bbox)
      return
    }
    const obj = { id, ...m.toJSON() }
    if (obj.type === 'pen' && !obj.points?.length) return // half-written, wait for the next update
    const bbox = bboxOf(obj)
    const oldBox = old?.bbox
    const oldZ = old?.obj.z
    // Update in place. `order` holds these same objects, a fresh one would leave it drawing stale geometry.
    const entry = old ?? { obj, bbox, path: null }
    Object.assign(entry, { obj, bbox, path: null, lod: null, lodBucket: undefined })
    this.entries.set(id, entry)
    if (!old || oldZ !== obj.z) this.orderStale = true
    if (track) {
      if (oldBox) this.markDirty(oldBox)
      this.markDirty(bbox)
    }
  }

  markDirty(rect) {
    if (this.dirty === 'all') return
    this.dirty = unionRect(this.dirty, growRect(rect, 2))
  }

  markAllDirty() { this.dirty = 'all' }

  takeDirty() {
    const d = this.dirty
    this.dirty = null
    return d
  }

  get sorted() {
    if (this.orderStale) {
      this.order = [...this.entries.values()].sort((a, b) => a.obj.z - b.obj.z || (a.obj.id < b.obj.id ? -1 : 1))
      this.orderStale = false
    }
    return this.order
  }

  // Entries touching `rect`, back to front.
  query(rect) {
    return this.sorted.filter((e) => rectsIntersect(e.bbox, rect))
  }

  get(id) { return this.entries.get(id)?.obj ?? null }

  get size() { return this.entries.size }

  boundsOf(ids) {
    let box = null
    for (const id of ids) {
      const e = this.entries.get(id)
      if (e) box = unionRect(box, e.bbox)
    }
    return box
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
