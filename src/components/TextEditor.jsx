import { useLayoutEffect, useRef } from 'react'
import { LINE_HEIGHT } from '../lib/draw.js'

// A plain textarea laid over the canvas at the text's world position.
export default function TextEditor({ wb, ui }) {
  const ref = useRef(null)
  const { editing: ed, vp } = ui

  const grow = () => {
    const el = ref.current
    el.style.width = '1px'
    el.style.height = '1px'
    el.style.width = `${Math.max(el.scrollWidth + 4, ed.size * vp.scale * 3)}px`
    el.style.height = `${el.scrollHeight}px`
  }

  useLayoutEffect(() => {
    ref.current.value = ed.text
    ref.current.focus()
    ref.current.select()
    grow()
  }, [ed.id, ed.x, ed.y]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <textarea
      ref={ref}
      data-scrawl-text
      rows={1}
      spellCheck={false}
      onInput={grow}
      onBlur={(e) => wb.commitText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') wb.cancelText()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.target.blur()
      }}
      style={{
        left: vp.x + ed.x * vp.scale,
        top: vp.y + ed.y * vp.scale,
        fontSize: ed.size * vp.scale,
        lineHeight: LINE_HEIGHT,
        color: ed.color,
      }}
      className="absolute m-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0 font-sans outline outline-1 outline-offset-4 outline-line"
    />
  )
}
