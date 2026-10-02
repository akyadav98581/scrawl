import { useState } from 'react'
import { ArrowRight, Scribble } from '@phosphor-icons/react'
import { go } from '../App.jsx'
import { getIdentity, newRoomId, recentRooms, setName } from '../lib/identity.js'
import Demo from './Demo.jsx'

const STEPS = [
  ['01', 'Open a room', 'One click makes a board with its own link. No account, nothing to set up.'],
  ['02', 'Send the link', 'Whoever opens it lands on the same board, with their own cursor and colour.'],
  ['03', 'Draw together', 'Strokes, shapes and text show up on every screen while they are being drawn. Close the tab and the board is still there later.'],
]

const KEYS = [
  ['V', 'Select'], ['P', 'Pen'], ['L', 'Line'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['T', 'Text'],
  ['E', 'Eraser'], ['Space', 'Hold to pan'], ['Ctrl Z', 'Undo'], ['Shift 1', 'Fit to screen'],
]

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const outline = 'rounded-md border border-line bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.08em] transition hover:border-ink/30 hover:bg-wash active:scale-[0.98]'

export default function Landing() {
  const [name, setNameState] = useState(() => getIdentity().name)
  const [code, setCode] = useState('')
  const rooms = recentRooms()

  const open = (id) => { setName(name); go(`/r/${id}`) }
  const join = (e) => {
    e.preventDefault()
    const id = code.trim().split('/').pop()
    if (/^[A-Za-z0-9_-]{6,64}$/.test(id)) open(id)
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-10">
        <span className="flex items-center gap-2 font-serif text-2xl tracking-tight">
          <Scribble size={24} weight="bold" />
          Scrawl
        </span>
        <nav className="hidden items-center gap-10 text-xs font-medium uppercase tracking-[0.08em] text-mute md:flex">
          <a href="#how" className="transition hover:text-ink">How it works</a>
          <a href="#keys" className="transition hover:text-ink">Shortcuts</a>
        </nav>
        <button onClick={() => open(newRoomId())} className={outline}>Start drawing</button>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-24 pt-8 sm:px-10 lg:min-h-[calc(100dvh-88px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:pb-16">
          <div>
            <p className="rise flex items-center gap-3 font-mono text-xs uppercase tracking-[0.12em] text-mute" style={{ '--i': 0 }}>
              <span className="pulse" />
              Real time, no sign-up
            </p>
            <h1 className="rise mt-6 font-serif text-[2.9rem] leading-[1.02] tracking-[-0.03em] sm:text-7xl xl:text-[5.5rem]" style={{ '--i': 1 }}>
              One board,<br />two people drawing on it at once.
            </h1>
            <p className="rise mt-6 max-w-md text-lg leading-relaxed text-mute" style={{ '--i': 2 }}>
              Open a room and send someone the link. Pens, shapes and text appear on both screens as they happen.
            </p>

            <div className="rise mt-10 flex flex-col gap-5" style={{ '--i': 3 }}>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.08em] text-mute">
                Your name
                <input
                  value={name}
                  onChange={(e) => setNameState(e.target.value)}
                  maxLength={24}
                  className="w-64 rounded-md border border-line bg-paper px-3 py-2 text-sm normal-case tracking-normal text-ink"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => open(newRoomId())}
                  className="rounded-md bg-ink px-6 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-white transition hover:-translate-y-0.5 hover:bg-soft active:scale-[0.98]"
                >
                  New room
                </button>
                <form onSubmit={join} className="flex items-center rounded-md border border-line bg-paper">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Room code or link"
                    className="w-44 bg-transparent px-3 py-3 font-mono text-sm outline-none placeholder:text-mute"
                  />
                  <button type="submit" aria-label="Join room" className="border-l border-line px-3 py-3 text-mute transition hover:text-ink">
                    <ArrowRight size={16} weight="bold" />
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="rise" style={{ '--i': 4 }}>
            <Demo />
          </div>
        </section>

        <section id="how" className="border-t border-line">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
            <h2 className="font-serif text-4xl tracking-[-0.02em] sm:text-5xl">How it works</h2>
            <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
              {STEPS.map(([n, title, body]) => (
                <li key={n} className="bg-paper p-8 sm:p-10">
                  <span className="font-mono text-xs text-mute">{n}</span>
                  <h3 className="mt-10 text-xl font-medium tracking-tight">{title}</h3>
                  <p className="mt-3 leading-relaxed text-mute">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="keys" className="border-t border-line bg-paper">
          <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10">
            <h2 className="font-serif text-4xl tracking-[-0.02em] sm:text-5xl">Keyboard first</h2>
            <p className="mt-4 max-w-md leading-relaxed text-mute">Every tool has a key. A mouse wheel zooms around the cursor, trackpad scrolling pans, pinch zooms.</p>
            <dl className="mt-12 grid grid-cols-2 border-l border-t border-line sm:grid-cols-3 lg:grid-cols-5">
              {KEYS.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-r border-line px-5 py-4">
                  <dt className="text-sm text-soft">{label}</dt>
                  <dd><kbd className="whitespace-nowrap">{k}</kbd></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-12 sm:px-10 md:flex-row md:justify-between">
          <div>
            <span className="font-serif text-xl">Scrawl</span>
            <p className="mt-2 font-mono text-xs text-mute">Yjs, Socket.io, MongoDB, plain Canvas 2D</p>
          </div>
          {rooms.length > 0 && (
            <div className="w-full max-w-xs">
              <p className="mb-3 text-xs uppercase tracking-[0.08em] text-mute">Recent rooms</p>
              <ul className="divide-y divide-line border-y border-line">
                {rooms.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <button onClick={() => open(r.id)} className="flex w-full items-center justify-between py-2.5 text-left transition hover:text-mute">
                      <span className="font-mono text-sm">{r.id}</span>
                      <span className="text-xs text-mute">{ago(r.at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}
