import { ArrowsOut, Circle, Cursor, Eraser, HandGrabbing, LineSegment, PencilSimple, Square, TextT } from '@phosphor-icons/react'

// A looping fake board for the landing page. Three shapes draw themselves while two
// cursors travel along the same paths, so it reads as two people at work.
const RECT = 'M 90 90 h 200 v 120 h -200 z'
const CURVE = 'M 60 330 C 110 270, 150 390, 210 330 S 290 280, 350 340 S 410 380, 450 310'
const ELLIPSE = 'M 470 150 a 80 52 0 1 0 0.01 0'
const LOOP = 12

function Cursor2({ path, begin, color, name }) {
  return (
    <g opacity="0">
      <animateMotion dur={`${LOOP}s`} begin={`${begin}s`} repeatCount="indefinite" path={path} keyPoints="0;1;1" keyTimes="0;0.28;1" calcMode="linear" />
      <animate attributeName="opacity" dur={`${LOOP}s`} begin={`${begin}s`} repeatCount="indefinite" values="0;1;1;0;0" keyTimes="0;0.02;0.92;0.98;1" />
      <path d="M0 0 L0 15 L4 11.5 L7.5 18 L10 17 L6.5 10.5 L11.5 10.5 Z" fill={color} stroke="#fff" strokeWidth="1.5" />
      <rect x="12" y="16" width={name.length * 6.6 + 14} height="18" rx="3" fill={color} />
      <text x="19" y="29" fontSize="11" fontFamily="Geist Mono Variable, monospace" fill="#fff">{name}</text>
    </g>
  )
}

export default function Demo() {
  const delays = [0.3, 4, 7.7]
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-paper" aria-hidden="true">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-mono text-xs text-mute">k7d2m9xa</span>
        <span className="flex items-center gap-3 font-mono text-xs text-soft">
          <span className="flex items-center gap-2"><span className="pulse" />Live</span>
          <span className="flex gap-1">
            <span className="grid size-6 place-items-center rounded-md bg-[#2e6fa31f] text-[10px] font-medium text-[#2e6fa3]">QH</span>
            <span className="grid size-6 place-items-center rounded-md bg-[#b8403d1f] text-[10px] font-medium text-[#b8403d]">LW</span>
          </span>
        </span>
      </div>

      <div className="dots relative">
        <svg viewBox="0 0 600 440" className="block h-auto w-full">
          <rect className="fill-in" x="90" y="90" width="200" height="120" fill="#fdebec" style={{ animationDelay: `${delays[0]}s` }} />
          <path className="draw" pathLength="1" d={RECT} fill="none" stroke="#111" strokeWidth="2" strokeLinejoin="round" style={{ animationDelay: `${delays[0]}s` }} />
          <path className="draw" pathLength="1" d={CURVE} fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round" style={{ animationDelay: `${delays[1]}s` }} />
          <path className="draw" pathLength="1" d={ELLIPSE} fill="none" stroke="#3f7a45" strokeWidth="2.5" style={{ animationDelay: `${delays[2]}s` }} />
          <Cursor2 path={RECT} begin={delays[0]} color="#2e6fa3" name="Quiet Heron" />
          <Cursor2 path={CURVE} begin={delays[1]} color="#b8403d" name="Lucky Wren" />
          <Cursor2 path={ELLIPSE} begin={delays[2]} color="#2e6fa3" name="Quiet Heron" />
        </svg>
      </div>

      <div className="flex justify-center border-t border-line p-3">
        <div className="flex items-center gap-1 rounded-lg border border-line p-1 text-soft">
          {[Cursor, PencilSimple, LineSegment, Square, Circle, TextT, Eraser, HandGrabbing, ArrowsOut].map((Icon, i) => (
            <span key={i} className={`grid size-8 place-items-center rounded-md ${i === 1 ? 'bg-ink text-white' : ''}`}>
              <Icon size={16} weight="bold" />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
