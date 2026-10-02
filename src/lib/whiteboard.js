import { HANDLES, handlePoint, hitTest, resizeBox, resizePatch, round, simplify } from './geometry.js'
import { toScreen, toWorld, visibleRect, zoomAt, fitBox } from './viewport.js'
import { drawCursor, drawDraft, drawObject, measureText } from './draw.js'
import { Scene } from './scene.js'

const TEXT_SIZE = { 2: 20, 4: 28, 8: 40 }
const SHAPE_TOOLS = new Set(['line', 'rect', 'ellipse'])
const KEY_TOOLS = { v: 'select', p: 'pen', l: 'line', r: 'rect', o: 'ellipse', t: 'text', e: 'eraser', h: 'hand' }

// Owns the two canvases, the viewport, the selection and every pointer gesture.
// React only draws the toolbar around it and subscribes to `ui`.
export class Whiteboard {
  constructor({ board, awareness, user, staticCanvas, liveCanvas }) {
    this.board = board
    this.awareness = awareness
    this.user = user
    this.sc = staticCanvas
    this.lc = liveCanvas
    this.sctx = staticCanvas.getContext('2d')
    this.lctx = liveCanvas.getContext('2d')
    this.scene = new Scene(board)

    this.vp = { x: 0, y: 0, scale: 1 }
    this.drawn = { ...this.vp } // the viewport the static bitmap really shows
    this.tmp = document.createElement('canvas')
    this.size = { w: 1, h: 1, dpr: 1 }
    this.tool = 'select'
    this.color = '#111111'
    this.width = 2
    this.selection = new Set()
    this.gesture = null
    this.draft = null
    this.editing = null
    this.spaceDown = false
    this.userMoved = false
    this.fullStatic = true
    this.panPending = false
    this.zoomPending = false
    this.settleTimer = 0
    this.liveDirty = true
    this.raf = 0
    this.listeners = new Set()
    this.stats = { staticMs: 0, frames: 0 }
    this.cursorTimer = 0
    this.draftTimer = 0
    this.pendingCursor = undefined

    awareness.setLocalState({ user, cursor: null, draft: null, sel: [] })
    this.offs = [
      this.scene.onChange(() => {
        this.#pruneSelection()
        this.#schedule()
        this.#emit()
      }),
    ]
    const onAware = () => { this.liveDirty = true; this.#schedule(); this.#emit() }
    awareness.on('change', onAware)
    this.offs.push(() => awareness.off('change', onAware))
    const onStack = () => this.#emit()
    for (const ev of ['stack-item-added', 'stack-item-popped']) {
      board.undo.on(ev, onStack)
      this.offs.push(() => board.undo.off(ev, onStack))
    }

    this.#bind()
    this.#emit()
  }

  // ---------- public api ----------

  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getUi = () => this.ui

  resize(w, h, dpr = 1) {
    this.size = { w, h, dpr }
    for (const c of [this.sc, this.lc]) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    this.fullStatic = true
    this.liveDirty = true
    if (!this.userMoved && !this.scene.size) this.vp = { x: w / 2, y: h / 2, scale: 1 }
    this.#schedule()
  }

  setTool(tool) {
    this.#finishText()
    this.tool = tool
    if (tool !== 'select') this.#setSelection([])
    this.#cursor()
    this.liveDirty = true
    this.#schedule()
    this.#emit()
  }

  setColor(c) {
    this.color = c
    if (this.selection.size) {
      this.board.patchMany([...this.selection].map((id) => [id, { color: c }]))
      this.board.commit()
    }
    this.#emit()
  }

  setWidth(w) {
    this.width = w
    if (this.selection.size) {
      const patches = []
      for (const id of this.selection) {
        const o = this.scene.get(id)
        if (!o) continue
        patches.push([id, o.type === 'text' ? { size: TEXT_SIZE[w], ...this.#textBox(o.text, TEXT_SIZE[w]) } : { sw: w }])
      }
      this.board.patchMany(patches)
      this.board.commit()
    }
    this.#emit()
  }

  undo() { this.#finishText(); this.board.undo.undo(); this.#afterHistory() }
  redo() { this.#finishText(); this.board.undo.redo(); this.#afterHistory() }

  zoomBy(factor) {
    this.#setViewport(zoomAt(this.vp, this.size.w / 2, this.size.h / 2, factor))
  }

  resetView() {
    this.#setViewport({ x: this.size.w / 2, y: this.size.h / 2, scale: 1 })
  }

  fit() {
    const all = [...this.scene.entries.keys()]
    this.#setViewport(fitBox(this.scene.boundsOf(all), this.size.w, this.size.h))
  }

  refresh() {
    this.fullStatic = true
    this.liveDirty = true
    this.#schedule()
  }

  // Called once after the first sync: jump to the content, unless the user already moved.
  fitOnce() {
    if (!this.userMoved && this.scene.size) {
      this.fit()
      this.userMoved = false
    }
  }

  panBy(dx, dy) { this.#setViewport({ ...this.vp, x: this.vp.x + dx, y: this.vp.y + dy }) }
  zoomAtScreen(sx, sy, f) { this.#setViewport(zoomAt(this.vp, sx, sy, f)) }

  selectAll() { this.#setSelection([...this.scene.entries.keys()]) }

  deleteSelection() {
    if (!this.selection.size) return
    this.board.remove([...this.selection])
    this.board.commit()
    this.#setSelection([])
  }

  // Text editor hooks, called by the React overlay.
  commitText(text) {
    const ed = this.editing
    if (!ed) return
    this.editing = null
    const t = text.replace(/\s+$/, '')
    if (ed.id) {
      this.scene.markDirty(this.scene.entries.get(ed.id)?.bbox ?? { x: 0, y: 0, w: 0, h: 0 })
      if (!t) this.board.remove([ed.id])
      else this.board.patch(ed.id, { text: t, ...this.#textBox(t, ed.size) })
    } else if (t) {
      const id = this.board.add({ type: 'text', x: ed.x, y: ed.y, text: t, size: ed.size, color: ed.color, ...this.#textBox(t, ed.size) })
      this.#setSelection([id])
    }
    this.board.commit()
    if (!ed.id) this.tool = 'select'
    this.#cursor()
    this.#schedule()
    this.#emit()
  }

  cancelText() {
    if (!this.editing) return
    const id = this.editing.id
    this.editing = null
    if (id) this.scene.markDirty(this.scene.entries.get(id).bbox)
    this.#schedule()
    this.#emit()
  }

  // Run one frame right now. The benchmark uses this to time rendering.
  renderNow() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.#frame()
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    clearTimeout(this.settleTimer)
    clearTimeout(this.cursorTimer)
    clearTimeout(this.draftTimer)
    this.unbind?.()
    this.offs.forEach((off) => off())
    this.awareness.setLocalState(null)
  }

  // ---------- state helpers ----------

  #textBox(text, size) { return measureText(text, size) }

  #setViewport(vp) {
    if (vp.scale !== this.vp.scale) {
      // Zoom: show a stretched copy of the last frame now, redraw crisp once the zoom settles.
      this.zoomPending = true
      clearTimeout(this.settleTimer)
      this.settleTimer = setTimeout(() => { this.fullStatic = true; this.#schedule() }, 140)
    } else {
      this.panPending = true
    }
    this.vp = vp
    this.userMoved = true
    this.liveDirty = true
    this.#schedule()
    this.#emit()
  }

  #setSelection(ids) {
    this.selection = new Set(ids)
    this.awareness.setLocalStateField('sel', [...this.selection])
    this.liveDirty = true
    this.#schedule()
    this.#emit()
  }

  #pruneSelection() {
    const keep = [...this.selection].filter((id) => this.scene.entries.has(id))
    if (keep.length !== this.selection.size) this.#setSelection(keep)
  }

  #afterHistory() {
    this.#pruneSelection()
    this.liveDirty = true
    this.#emit()
  }

  #emit() {
    const peers = []
    for (const [id, s] of this.awareness.getStates()) {
      if (id !== this.board.doc.clientID && s.user) peers.push({ id, ...s.user })
    }
    this.ui = {
      tool: this.tool,
      color: this.color,
      width: this.width,
      selected: this.selection.size,
      zoom: Math.round(this.vp.scale * 100),
      canUndo: this.board.undo.canUndo(),
      canRedo: this.board.undo.canRedo(),
      peers,
      me: this.user,
      editing: this.editing,
      vp: this.vp,
      count: this.scene.size,
    }
    this.listeners.forEach((fn) => fn())
  }

  #cursor() {
    const t = this.spaceDown ? 'hand' : this.tool
    this.lc.style.cursor = { select: 'default', hand: 'grab', text: 'text', eraser: 'cell' }[t] ?? 'crosshair'
  }

  // ---------- pointer input ----------

  #bind() {
    const c = this.lc
    const down = (e) => this.#onDown(e)
    const move = (e) => this.#onMove(e)
    const up = (e) => this.#onUp(e)
    const wheel = (e) => this.#onWheel(e)
    const dbl = (e) => this.#onDouble(e)
    const key = (e) => this.#onKey(e)
    const keyUp = (e) => {
      if (e.key === ' ' && this.spaceDown) { this.spaceDown = false; this.#cursor() }
    }
    const leave = () => this.#sendCursor(null)
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('pointerleave', leave)
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('dblclick', dbl)
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', keyUp)
    this.unbind = () => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
      c.removeEventListener('pointerleave', leave)
      c.removeEventListener('wheel', wheel)
      c.removeEventListener('dblclick', dbl)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', keyUp)
    }
    this.#cursor()
  }

  #pt(e) {
    const r = this.lc.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    return { sx, sy, ...toWorld(this.vp, sx, sy) }
  }

  #topHit(x, y) {
    const tol = 5 / this.vp.scale
    const probe = { x: x - tol, y: y - tol, w: tol * 2, h: tol * 2 }
    const near = this.scene.query(probe)
    for (let i = near.length - 1; i >= 0; i--) if (hitTest(near[i].obj, x, y, tol)) return near[i].obj
    return null
  }

  #hitHandle(sx, sy) {
    if (this.tool !== 'select' || !this.selection.size) return null
    const box = this.scene.boundsOf(this.selection)
    if (!box) return null
    for (const h of HANDLES) {
      const [wx, wy] = handlePoint(box, h)
      const s = toScreen(this.vp, wx, wy)
      if (Math.abs(s.x - sx) <= 7 && Math.abs(s.y - sy) <= 7) return h
    }
    return null
  }

  #onDown(e) {
    if (e.button === 2) return
    this.lc.setPointerCapture(e.pointerId)
    const p = this.#pt(e)
    if (this.editing) this.#finishText()

    if (e.button === 1 || this.spaceDown || this.tool === 'hand') {
      this.gesture = { kind: 'pan', sx: p.sx, sy: p.sy, vp: this.vp }
      this.lc.style.cursor = 'grabbing'
      return
    }

    if (this.tool === 'select') {
      const handle = this.#hitHandle(p.sx, p.sy)
      if (handle) {
        const snap = new Map([...this.selection].map((id) => [id, this.scene.get(id)]))
        this.gesture = { kind: 'resize', handle, from: this.scene.boundsOf(this.selection), p, snap }
        return
      }
      const hit = this.#topHit(p.x, p.y)
      if (hit) {
        if (e.shiftKey) {
          const next = new Set(this.selection)
          next.has(hit.id) ? next.delete(hit.id) : next.add(hit.id)
          this.#setSelection([...next])
        } else if (!this.selection.has(hit.id)) {
          this.#setSelection([hit.id])
        }
        const snap = new Map([...this.selection].map((id) => [id, this.scene.get(id)]))
        this.gesture = { kind: 'move', p, snap, moved: false }
      } else {
        if (!e.shiftKey) this.#setSelection([])
        this.gesture = { kind: 'marquee', p, cur: p, base: new Set(this.selection) }
      }
      return
    }

    if (this.tool === 'text') {
      // The editor opens on pointerup. Opening it now would lose focus to the
      // browser's own mousedown focus handling and commit an empty text.
      this.gesture = { kind: 'text', p }
      return
    }

    if (this.tool === 'eraser') {
      this.gesture = { kind: 'erase', gone: new Set() }
      this.#eraseAt(p)
      return
    }

    if (this.tool === 'pen') {
      this.gesture = { kind: 'draw', type: 'pen', pts: [p.x, p.y], last: p }
    } else if (SHAPE_TOOLS.has(this.tool)) {
      this.gesture = { kind: 'draw', type: this.tool, start: p, cur: p }
    }
    this.#updateDraft(e)
  }

  #onMove(e) {
    const p = this.#pt(e)
    this.#sendCursor({ x: p.x, y: p.y })
    const g = this.gesture
    if (!g) return
    switch (g.kind) {
      case 'pan':
        this.#setViewport({ ...g.vp, x: g.vp.x + p.sx - g.sx, y: g.vp.y + p.sy - g.sy })
        break
      case 'move': {
        const dx = p.x - g.p.x, dy = p.y - g.p.y
        if (!g.moved && Math.hypot(dx, dy) * this.vp.scale < 3) return
        g.moved = true
        this.board.patchMany([...g.snap].map(([id, o]) => [id, { x: round(o.x + dx, 2), y: round(o.y + dy, 2) }]))
        break
      }
      case 'resize': {
        const dx = p.x - g.p.x, dy = p.y - g.p.y
        const lock = e.shiftKey || g.snap.size > 1 || [...g.snap.values()].some((o) => o.type === 'text')
        const to = resizeBox(g.from, g.handle, dx, dy, lock)
        if (to.w < 2 || to.h < 2) return
        this.board.patchMany([...g.snap].map(([id, o]) => [id, resizePatch(o, g.from, to)]))
        break
      }
      case 'marquee': {
        g.cur = p
        const r = { x: Math.min(g.p.x, p.x), y: Math.min(g.p.y, p.y), w: Math.abs(p.x - g.p.x), h: Math.abs(p.y - g.p.y) }
        const ids = new Set(g.base)
        for (const e2 of this.scene.query(r)) ids.add(e2.obj.id)
        this.#setSelection([...ids])
        break
      }
      case 'erase':
        this.#eraseAt(p)
        break
      case 'draw':
        if (g.type === 'pen') {
          // coalesced events give every sample the browser saw, not one per frame
          const events = e.getCoalescedEvents?.() ?? [e]
          for (const ev of events.length ? events : [e]) {
            const q = this.#pt(ev)
            if (Math.hypot(q.sx - g.last.sx, q.sy - g.last.sy) >= 1.5) {
              g.pts.push(q.x, q.y)
              g.last = q
            }
          }
        } else {
          g.cur = p
        }
        this.#updateDraft(e)
        break
    }
    this.liveDirty = true
    this.#schedule()
  }

  #onUp(e) {
    const g = this.gesture
    this.gesture = null
    if (!g) return
    if (this.lc.hasPointerCapture(e.pointerId)) this.lc.releasePointerCapture(e.pointerId)
    this.#cursor()
    switch (g.kind) {
      case 'move':
      case 'resize':
      case 'erase':
        this.board.commit()
        break
      case 'text': {
        const hit = this.#topHit(g.p.x, g.p.y)
        if (hit?.type === 'text') this.#editText(hit)
        else this.#openText({ x: g.p.x, y: g.p.y })
        break
      }
      case 'draw': {
        const obj = this.#draftObject(g, e.shiftKey)
        if (obj) {
          const id = this.board.add(obj)
          this.board.commit()
          if (g.type !== 'pen') {
            this.#setSelection([id])
            this.tool = 'select'
            this.#cursor()
          }
        }
        break
      }
    }
    this.draft = null
    this.#publishDraft(null)
    this.liveDirty = true
    this.#schedule()
    this.#emit()
  }

  #onWheel(e) {
    e.preventDefault()
    const p = this.#pt(e)
    const line = e.deltaMode === 1
    const notched = line || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100)
    const mod = e.ctrlKey || e.metaKey
    // Pinch on a trackpad arrives as small ctrl+wheel deltas, a mouse notch is 100 or more.
    const rate = mod && !notched ? 0.01 : 0.0015
    if (mod || notched) {
      this.zoomAtScreen(p.sx, p.sy, Math.exp(-e.deltaY * (line ? 33 : 1) * rate))
    } else {
      this.panBy(-e.deltaX, -e.deltaY)
    }
  }

  #onDouble(e) {
    if (this.tool !== 'select') return
    const p = this.#pt(e)
    const hit = this.#topHit(p.x, p.y)
    if (hit?.type === 'text') this.#editText(hit)
  }

  #onKey(e) {
    const tag = document.activeElement?.tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT') return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return }
    if (mod && k === 'a') { e.preventDefault(); this.selectAll(); return }
    if (mod) return
    if (k === ' ') { e.preventDefault(); if (!this.spaceDown) { this.spaceDown = true; this.#cursor() } return }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSelection(); return }
    if (k === 'escape') { this.#setSelection([]); this.setTool('select'); return }
    if (k === '=' || k === '+') return this.zoomBy(1.25)
    if (k === '-') return this.zoomBy(0.8)
    if (k === '0') return this.resetView()
    if (k === '1' && e.shiftKey) return this.fit()
    if (KEY_TOOLS[k]) this.setTool(KEY_TOOLS[k])
  }

  // ---------- gestures ----------

  #eraseAt(p) {
    const g = this.gesture
    const tol = 8 / this.vp.scale
    const probe = { x: p.x - tol, y: p.y - tol, w: tol * 2, h: tol * 2 }
    const ids = this.scene.query(probe).filter((e) => !g.gone.has(e.obj.id) && hitTest(e.obj, p.x, p.y, tol)).map((e) => e.obj.id)
    if (!ids.length) return
    ids.forEach((id) => g.gone.add(id))
    this.board.remove(ids)
  }

  #draftObject(g, shift) {
    const sw = this.width
    const base = { color: this.color, sw }
    const minSize = 3 / this.vp.scale
    if (g.type === 'pen') {
      const pts = simplify(g.pts, 0.6 / this.vp.scale)
      let minX = Infinity, minY = Infinity
      for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); minY = Math.min(minY, pts[i + 1]) }
      const points = pts.map((v, i) => round(v - (i % 2 ? minY : minX)))
      return { type: 'pen', x: round(minX, 2), y: round(minY, 2), points: points.length >= 2 ? points : [0, 0], ...base }
    }
    const { start: a, cur: b } = g
    let dx = b.x - a.x, dy = b.y - a.y
    if (g.type === 'line') {
      if (shift) {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(dx, dy)
        dx = Math.cos(ang) * len
        dy = Math.sin(ang) * len
      }
      if (Math.hypot(dx, dy) < minSize) return null
      return { type: 'line', x: a.x, y: a.y, w: round(dx, 2), h: round(dy, 2), ...base }
    }
    if (shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * m
      dy = Math.sign(dy || 1) * m
    }
    if (Math.max(Math.abs(dx), Math.abs(dy)) < minSize) return null
    return { type: g.type, x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy), ...base }
  }

  #updateDraft(e) {
    const g = this.gesture
    if (g?.kind !== 'draw') return
    if (g.type === 'pen') {
      this.draft = { type: 'pen', x: 0, y: 0, points: g.pts, color: this.color, sw: this.width }
    } else {
      this.draft = this.#draftObject(g, e.shiftKey)
    }
    this.draftTimer ||= setTimeout(() => {
      this.draftTimer = 0
      if (this.gesture?.kind === 'draw') this.#publishDraft(this.#shareable(this.gesture))
    }, 50)
  }

  // What other people see while you draw. Pens go out simplified so the payload stays small.
  #shareable(g) {
    if (g.type !== 'pen') return this.draft
    const pts = simplify(g.pts, 0.5 / this.vp.scale)
    return { type: 'pen', x: 0, y: 0, points: pts.map((v) => round(v, 1)), color: this.color, sw: this.width }
  }

  #publishDraft(d) {
    clearTimeout(this.draftTimer)
    this.draftTimer = 0
    this.awareness.setLocalStateField('draft', d)
  }

  #sendCursor(c) {
    this.pendingCursor = c
    this.cursorTimer ||= setTimeout(() => {
      this.cursorTimer = 0
      this.awareness.setLocalStateField('cursor', this.pendingCursor)
    }, 40)
  }

  // ---------- text ----------

  #openText({ x, y }) {
    this.editing = { id: null, x, y, text: '', size: TEXT_SIZE[this.width], color: this.color }
    this.#emit()
  }

  #editText(o) {
    this.editing = { id: o.id, x: o.x, y: o.y, text: o.text, size: o.size, color: o.color }
    this.scene.markDirty(this.scene.entries.get(o.id).bbox)
    this.#setSelection([o.id])
    this.#schedule()
    this.#emit()
  }

  #finishText() {
    // the textarea commits itself on blur, this just covers a tool switch or undo mid-edit
    if (this.editing) this.commitText(document.querySelector('[data-scrawl-text]')?.value ?? this.editing.text)
  }

  // ---------- rendering ----------

  #schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.#frame() })
  }

  #frame() {
    const dirty = this.scene.takeDirty()
    if (this.fullStatic || dirty === 'all') {
      this.fullStatic = this.panPending = this.zoomPending = false
      clearTimeout(this.settleTimer)
      this.drawn = { ...this.vp }
      this.#drawStatic(null)
    } else {
      if (this.zoomPending) this.#previewZoom()
      else if (this.panPending) this.#blitPan()
      this.zoomPending = this.panPending = false
      if (dirty) this.#drawStatic(dirty)
    }
    if (this.liveDirty) {
      this.liveDirty = false
      this.#drawLive()
    }
  }

  // Pan by moving the pixels we already have and drawing only the strips that came into view.
  #blitPan() {
    const { dpr } = this.size
    const sx = Math.round((this.vp.x - this.drawn.x) * dpr)
    const sy = Math.round((this.vp.y - this.drawn.y) * dpr)
    if (!sx && !sy) return
    const W = this.sc.width, H = this.sc.height
    if (Math.abs(sx) >= W || Math.abs(sy) >= H) {
      this.drawn = { ...this.vp }
      return this.#drawStatic(null)
    }
    const t0 = performance.now()
    const ctx = this.sctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(this.sc, sx, sy)
    ctx.globalCompositeOperation = 'source-over'
    this.drawn = { ...this.drawn, x: this.drawn.x + sx / dpr, y: this.drawn.y + sy / dpr }
    const toWorld = (dx, dy, dw, dh) => ({
      x: (dx / dpr - this.drawn.x) / this.drawn.scale,
      y: (dy / dpr - this.drawn.y) / this.drawn.scale,
      w: dw / dpr / this.drawn.scale,
      h: dh / dpr / this.drawn.scale,
    })
    if (sx) this.#drawStatic(toWorld(sx > 0 ? 0 : W + sx, 0, Math.abs(sx), H))
    if (sy) this.#drawStatic(toWorld(0, sy > 0 ? 0 : H + sy, W, Math.abs(sy)))
    this.stats.staticMs = performance.now() - t0
  }

  #previewZoom() {
    const { dpr } = this.size
    const k = this.vp.scale / this.drawn.scale
    const t = this.tmp
    t.width = this.sc.width
    t.height = this.sc.height
    t.getContext('2d').drawImage(this.sc, 0, 0)
    const ctx = this.sctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.sc.width, this.sc.height)
    ctx.setTransform(k, 0, 0, k, (this.vp.x - k * this.drawn.x) * dpr, (this.vp.y - k * this.drawn.y) * dpr)
    ctx.drawImage(t, 0, 0)
    this.drawn = { ...this.vp }
  }

  // Paint the whole canvas (rect null) or one world-space rectangle of it, using the drawn viewport.
  #drawStatic(rect) {
    const t0 = performance.now()
    const { w, h, dpr } = this.size
    const { scale, x, y } = this.drawn
    const ctx = this.sctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    let world
    if (!rect) {
      ctx.clearRect(0, 0, this.sc.width, this.sc.height)
      world = visibleRect(this.drawn, w, h)
    } else {
      const px = Math.floor((rect.x * scale + x) * dpr) - 2
      const py = Math.floor((rect.y * scale + y) * dpr) - 2
      const pw = Math.ceil(rect.w * scale * dpr) + 4
      const ph = Math.ceil(rect.h * scale * dpr) + 4
      ctx.save()
      ctx.beginPath()
      ctx.rect(px, py, pw, ph)
      ctx.clip()
      ctx.clearRect(px, py, pw, ph)
      // Query what touches the clip, not the requested rect: the clip is a little bigger,
      // and anything inside it that we skip would be wiped without being redrawn.
      world = { x: (px / dpr - x) / scale, y: (py / dpr - y) / scale, w: pw / dpr / scale, h: ph / dpr / scale }
    }
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y)
    const skip = this.editing?.id
    for (const e of this.scene.query(world)) drawObject(ctx, e, skip, scale)
    if (rect) ctx.restore()
    this.stats.staticMs = performance.now() - t0
    this.stats.frames++
  }

  #drawLive() {
    const { w, h, dpr } = this.size
    const { scale, x, y } = this.vp
    const ctx = this.lctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.lc.width, this.lc.height)
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y)

    const states = [...this.awareness.getStates()].filter(([id, s]) => id !== this.board.doc.clientID && s.user)
    for (const [, s] of states) if (s.draft) drawDraft(ctx, s.draft, 0.75)
    if (this.draft) drawDraft(ctx, this.draft)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    for (const [, s] of states) {
      for (const id of s.sel ?? []) {
        const e = this.scene.entries.get(id)
        if (!e) continue
        const a = toScreen(this.vp, e.bbox.x, e.bbox.y)
        ctx.strokeStyle = s.user.color
        ctx.lineWidth = 1
        ctx.strokeRect(a.x - 0.5, a.y - 0.5, e.bbox.w * scale + 1, e.bbox.h * scale + 1)
      }
    }

    if (this.tool === 'select' && this.selection.size && !this.editing) this.#drawSelection(ctx)

    if (this.gesture?.kind === 'marquee') {
      const g = this.gesture
      const a = toScreen(this.vp, g.p.x, g.p.y), b = toScreen(this.vp, g.cur.x, g.cur.y)
      ctx.fillStyle = 'rgba(17,17,17,0.04)'
      ctx.strokeStyle = '#111111'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y)
      ctx.setLineDash([])
    }

    for (const [, s] of states) {
      if (!s.cursor) continue
      const c = toScreen(this.vp, s.cursor.x, s.cursor.y)
      if (c.x < -20 || c.y < -20 || c.x > w + 20 || c.y > h + 20) continue
      drawCursor(ctx, c.x, c.y, s.user.name, s.user.color)
    }
  }

  #drawSelection(ctx) {
    const box = this.scene.boundsOf(this.selection)
    if (!box) return
    const a = toScreen(this.vp, box.x, box.y)
    const w = box.w * this.vp.scale, h = box.h * this.vp.scale
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 1
    if (this.selection.size > 1) {
      ctx.globalAlpha = 0.35
      for (const id of this.selection) {
        const e = this.scene.entries.get(id)
        if (!e) continue
        const s = toScreen(this.vp, e.bbox.x, e.bbox.y)
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, e.bbox.w * this.vp.scale, e.bbox.h * this.vp.scale)
      }
      ctx.globalAlpha = 1
    }
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h)
    ctx.fillStyle = '#FFFFFF'
    for (const hd of HANDLES) {
      const [wx, wy] = handlePoint(box, hd)
      const s = toScreen(this.vp, wx, wy)
      ctx.fillRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7)
      ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7)
    }
  }
}
