import { useState } from 'react'
import { Check, Link } from '@phosphor-icons/react'
import { go } from '../App.jsx'

const STATUS = {
  online: ['Live', 'bg-green-ink'],
  connecting: ['Connecting', 'bg-yellow-ink'],
  waking: ['Waking server', 'bg-yellow-ink'],
  offline: ['Offline, edits are kept', 'bg-red-ink'],
  error: ['Could not join', 'bg-red-ink'],
}

const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()

function Avatar({ name, color, ring }) {
  return (
    <span
      title={name}
      style={{ background: `${color}1f`, color }}
      className={`grid size-7 place-items-center rounded-md font-mono text-[11px] font-medium ${ring ? 'outline outline-1 outline-offset-1 outline-line' : ''}`}
    >
      {initials(name)}
    </span>
  )
}

export default function TopBar({ ui, status, roomId }) {
  const [copied, setCopied] = useState(false)
  const [label, dot] = STATUS[status] ?? STATUS.connecting

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
    } catch {
      window.prompt('Copy this link', location.href)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
      <div className="pointer-events-auto flex items-baseline gap-3 rounded-lg border border-line bg-paper px-3.5 py-2">
        <button onClick={() => go('/')} className="font-serif text-xl leading-none tracking-tight">Scrawl</button>
        <span className="hidden font-mono text-xs text-mute sm:inline">{roomId}</span>
      </div>

      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-paper p-1.5 pl-3">
        <span className="hidden items-center gap-2 font-mono text-xs text-soft md:flex" data-testid="status">
          <span className={`size-1.5 rounded-full ${dot}`} />
          {label}
        </span>
        <div className="flex items-center gap-1" data-testid="peers">
          {ui.peers.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} color={p.color} />)}
          {ui.peers.length > 4 && <span className="px-1 font-mono text-xs text-mute">+{ui.peers.length - 4}</span>}
          <Avatar name={ui.me.name} color={ui.me.color} ring />
        </div>
        <button
          onClick={share}
          className="flex items-center gap-2 rounded-md bg-ink px-3 py-1.5 text-sm text-white transition active:scale-[0.98] hover:bg-soft"
        >
          {copied ? <Check size={14} weight="bold" /> : <Link size={14} weight="bold" />}
          {copied ? 'Copied' : 'Share'}
        </button>
      </div>
    </header>
  )
}
