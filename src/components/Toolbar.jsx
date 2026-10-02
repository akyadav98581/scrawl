import {
  ArrowClockwise, ArrowCounterClockwise, ArrowsOut, Circle, Cursor, Eraser, HandGrabbing, LineSegment, Minus,
  PencilSimple, Plus, Square, TextT,
} from '@phosphor-icons/react'
import { COLORS, WIDTHS } from '../lib/palette.js'

const TOOLS = [
  ['select', Cursor, 'Select', 'V'],
  ['pen', PencilSimple, 'Pen', 'P'],
  ['line', LineSegment, 'Line', 'L'],
  ['rect', Square, 'Rectangle', 'R'],
  ['ellipse', Circle, 'Ellipse', 'O'],
  ['text', TextT, 'Text', 'T'],
  ['eraser', Eraser, 'Eraser', 'E'],
  ['hand', HandGrabbing, 'Pan', 'H'],
]

const btn = 'grid size-9 place-items-center rounded-md text-soft transition active:scale-[0.96] enabled:hover:bg-wash disabled:text-line'

export default function Toolbar({ wb, ui }) {
  return (
    <>
      <div className="absolute inset-x-0 bottom-5 flex justify-center px-3">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-line bg-paper p-1" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map(([id, Icon, label, key]) => (
            <button
              key={id}
              title={`${label} (${key})`}
              aria-label={label}
              aria-pressed={ui.tool === id}
              onClick={() => wb.setTool(id)}
              className={`${btn} ${ui.tool === id ? 'bg-ink text-white enabled:hover:bg-ink' : ''}`}
            >
              <Icon size={18} weight="bold" />
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-line" />

          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map((c) => (
              <button
                key={c}
                title={c}
                aria-label={`Colour ${c}`}
                aria-pressed={ui.color === c}
                onClick={() => wb.setColor(c)}
                style={{ background: c }}
                className={`size-[18px] rounded-sm border border-black/10 ${ui.color === c ? 'outline outline-1 outline-offset-2 outline-ink' : ''}`}
              />
            ))}
          </div>

          <span className="mx-1 h-5 w-px bg-line" />

          {WIDTHS.map((w) => (
            <button
              key={w}
              title={`Stroke ${w}`}
              aria-label={`Stroke ${w}`}
              aria-pressed={ui.width === w}
              onClick={() => wb.setWidth(w)}
              className={`${btn} ${ui.width === w ? 'bg-wash' : ''}`}
            >
              <span className="block w-4 rounded-full bg-ink" style={{ height: Math.max(1.5, w / 1.6) }} />
            </button>
          ))}
        </div>
      </div>

      <div className="absolute bottom-5 left-4 hidden items-center gap-0.5 rounded-lg border border-line bg-paper p-1 sm:flex">
        <button title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!ui.canUndo} onClick={() => wb.undo()} className={btn}>
          <ArrowCounterClockwise size={18} weight="bold" />
        </button>
        <button title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!ui.canRedo} onClick={() => wb.redo()} className={btn}>
          <ArrowClockwise size={18} weight="bold" />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button title="Zoom out (-)" aria-label="Zoom out" onClick={() => wb.zoomBy(0.8)} className={btn}>
          <Minus size={16} weight="bold" />
        </button>
        <button title="Reset zoom (0)" onClick={() => wb.resetView()} className="min-w-12 rounded-md px-1 text-center font-mono text-xs tabular-nums text-soft hover:bg-wash">
          {ui.zoom}%
        </button>
        <button title="Zoom in (+)" aria-label="Zoom in" onClick={() => wb.zoomBy(1.25)} className={btn}>
          <Plus size={16} weight="bold" />
        </button>
        <button title="Fit to content (Shift+1)" aria-label="Fit to content" onClick={() => wb.fit()} className={btn}>
          <ArrowsOut size={16} weight="bold" />
        </button>
      </div>

      <p className="pointer-events-none absolute bottom-6 right-5 hidden text-right text-xs leading-relaxed text-mute lg:block">
        <kbd>Space</kbd> drag to pan<br />
        <kbd>Ctrl</kbd> scroll to zoom
      </p>
    </>
  )
}
