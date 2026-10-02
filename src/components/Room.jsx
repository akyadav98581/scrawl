import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import { createBoard } from '../lib/doc.js'
import { getIdentity, rememberRoom } from '../lib/identity.js'
import { connectRoom } from '../lib/sync.js'
import { Whiteboard } from '../lib/whiteboard.js'
import TextEditor from './TextEditor.jsx'
import Toolbar from './Toolbar.jsx'
import TopBar from './TopBar.jsx'

export default function Room({ id }) {
  const wrap = useRef(null)
  const staticRef = useRef(null)
  const liveRef = useRef(null)
  const [wb, setWb] = useState(null)
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    rememberRoom(id)
    const board = createBoard()
    const awareness = new Awareness(board.doc)
    const idb = new IndexeddbPersistence(`scrawl-${id}`, board.doc)
    const board2d = new Whiteboard({
      board, awareness, user: getIdentity(),
      staticCanvas: staticRef.current, liveCanvas: liveRef.current,
    })

    let first = true
    const link = connectRoom({
      doc: board.doc, awareness, room: id,
      onStatus: (s) => {
        setStatus(s)
        if (s === 'online' && first) { first = false; board2d.fitOnce() }
      },
    })

    const fit = () => {
      const r = wrap.current.getBoundingClientRect()
      board2d.resize(r.width, r.height, window.devicePixelRatio || 1)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrap.current)
    fit()

    // Text is measured on canvas, so wait for the web font before the first real paint.
    document.fonts?.load('20px "Geist Variable"').then(() => board2d.refresh())

    if (new URLSearchParams(location.search).has('debug')) window.__wb = board2d
    setWb(board2d)

    return () => {
      ro.disconnect()
      link.destroy()
      board2d.destroy()
      idb.destroy()
      board.doc.destroy()
      setWb(null)
    }
  }, [id])

  return (
    <div ref={wrap} className="fixed inset-0 touch-none select-none overflow-hidden bg-bone">
      {wb && <Grid wb={wb} />}
      <canvas ref={staticRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={liveRef} className="absolute inset-0 h-full w-full" data-testid="board" />
      {wb && <Chrome wb={wb} status={status} roomId={id} />}
    </div>
  )
}

// The dot grid is a CSS background that follows the viewport, so the canvas never paints it.
const dotTile = (step) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${step}' height='${step}'><circle cx='${step / 2}' cy='${step / 2}' r='0.8' fill='#d8d6d0'/></svg>`)}")`

function gridStyle(vp) {
  let step = 24 * vp.scale
  while (step < 14) step *= 2
  step = Math.round(step * 100) / 100
  return {
    backgroundImage: dotTile(step),
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${vp.x - step / 2}px ${vp.y - step / 2}px`,
  }
}

function Grid({ wb }) {
  const ui = useSyncExternalStore(wb.subscribe, wb.getUi)
  return <div className="absolute inset-0" style={gridStyle(ui.vp)} />
}

function Chrome({ wb, status, roomId }) {
  const ui = useSyncExternalStore(wb.subscribe, wb.getUi)
  return (
    <>
      <TopBar ui={ui} status={status} roomId={roomId} />
      <Toolbar wb={wb} ui={ui} />
      {ui.editing && <TextEditor wb={wb} ui={ui} />}
      {status === 'waking' && (
        <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-md border border-line bg-yellow-wash px-4 py-2 text-sm text-yellow-ink">
          Waking the server. Free hosting sleeps when idle, so the first connect can take up to a minute.
        </div>
      )}
    </>
  )
}
