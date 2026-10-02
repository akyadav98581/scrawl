// Drives the production build in Firefox: two tabs in one room, every tool, sync, undo, zoom.
import { mkdirSync } from 'node:fs'
import { firefox } from 'playwright'
import { startApp } from './harness.mjs'

const app = await startApp(3111)
const BASE = app.url
mkdirSync('shots', { recursive: true })

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 40))
  }
  return false
}

const browser = await firefox.launch()
try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()
  for (const p of [A, B]) p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); failed++ })

  // landing -> new room
  await A.goto(BASE)
  await A.screenshot({ path: 'shots/landing.png' })
  await A.getByRole('button', { name: 'New room' }).click()
  await A.waitForURL(/\/r\/[a-z0-9]{8}$/)
  const roomUrl = A.url()
  check('landing creates a room and navigates to it', /\/r\//.test(roomUrl))

  await A.goto(roomUrl + '?debug=1')
  await B.goto(roomUrl + '?debug=1')
  const live = (p) => until(async () => (await p.getByTestId('status').textContent().catch(() => '')).includes('Live'))
  check('both tabs reach Live', (await live(A)) && (await live(B)))

  const types = (p) => p.evaluate(() => [...__wb.scene.entries.values()].map((e) => e.obj.type).sort().join(','))
  const count = (p) => p.evaluate(() => __wb.scene.size)
  const drag = async (p, pts, opts = {}) => {
    await p.mouse.move(...pts[0])
    await p.mouse.down()
    for (const pt of pts.slice(1)) await p.mouse.move(...pt, { steps: 4 })
    if (opts.shift) await p.keyboard.down('Shift')
    await p.mouse.up()
    if (opts.shift) await p.keyboard.up('Shift')
  }

  // every tool, on A
  await A.keyboard.press('r'); await drag(A, [[300, 200], [450, 300]])
  await A.keyboard.press('o'); await drag(A, [[550, 200], [700, 300]])
  await A.keyboard.press('l'); await drag(A, [[300, 400], [450, 450]])
  await A.keyboard.press('p'); await drag(A, [[550, 400], [600, 430], [650, 380], [700, 450]])
  await A.keyboard.press('t'); await A.mouse.click(300, 550)
  await A.keyboard.type('hello board')
  await A.keyboard.press('Control+Enter')
  check('rect, ellipse, line, pen, text all created', (await types(A)) === 'ellipse,line,pen,rect,text', await types(A))
  check('shape tools drop back to select', (await A.evaluate(() => __wb.tool)) === 'select')

  check('B sees all five objects', await until(async () => (await types(B)) === 'ellipse,line,pen,rect,text'))

  // eraser
  await A.keyboard.press('p'); await drag(A, [[800, 650], [830, 655], [860, 645], [900, 650]])
  check('second pen stroke added', (await count(A)) === 6)
  await A.keyboard.press('e'); await drag(A, [[790, 650], [910, 650]])
  check('eraser removes the stroke', (await count(A)) === 5)
  check('erase syncs to B', await until(async () => (await count(B)) === 5))

  // cursors and presence
  await A.mouse.move(500, 600, { steps: 5 })
  check('B receives A cursor', await until(() => B.evaluate(() => [...__wb.awareness.getStates().values()].some((s) => s.cursor && s.user))))
  check('presence shows one other person on each side', (await B.getByTestId('peers').locator('span[title]').count()) === 2)

  // live preview while drawing
  await A.keyboard.press('p')
  await A.mouse.move(100, 700); await A.mouse.down(); await A.mouse.move(180, 740, { steps: 6 })
  check('B sees A draft before release', await until(() => B.evaluate(() => [...__wb.awareness.getStates().values()].some((s) => s.draft?.type === 'pen')), 3000))
  await A.mouse.up()
  check('draft clears after release', await until(() => B.evaluate(() => ![...__wb.awareness.getStates().values()].some((s) => s.draft))))
  await A.keyboard.press('e'); await drag(A, [[90, 700], [200, 745]]) // clean up that stroke
  check('back to five objects', await until(async () => (await count(A)) === 5 && (await count(B)) === 5))

  // B moves A's rect
  const rectOf = (p) => p.evaluate(() => [...__wb.scene.entries.values()].find((e) => e.obj.type === 'rect').obj)
  const before = await rectOf(A)
  await B.keyboard.press('v')
  await drag(B, [[375, 250], [415, 255], [455, 250]])
  check('B moved the rect, A sees it', await until(async () => Math.abs((await rectOf(A)).x - (before.x + 80)) < 3), JSON.stringify(await rectOf(A)))

  // resize from the SE handle
  const handle = await B.evaluate(() => {
    const b = __wb.scene.boundsOf(__wb.selection), v = __wb.vp
    return [(b.x + b.w) * v.scale + v.x, (b.y + b.h) * v.scale + v.y]
  })
  const mid = await rectOf(B)
  await drag(B, [handle, [handle[0] + 25, handle[1] + 15], [handle[0] + 50, handle[1] + 30]])
  const after = await rectOf(A)
  check('resize grows the rect and syncs', await until(async () => (await rectOf(A)).w > mid.w + 40), `w ${mid.w} -> ${after.w}`)

  // undo is per user: A's last action was erasing the stray stroke, so undo brings it back
  const bRect = await rectOf(B)
  await A.keyboard.press('Control+z')
  check('A undo reverts A own last action (the erase)', await until(async () => (await count(A)) === 6))
  const stillBs = await until(async () => {
    const r = await rectOf(A)
    return Math.abs(r.x - bRect.x) < 1 && Math.abs(r.w - bRect.w) < 1
  }, 1500)
  check("A undo left B's move and resize alone", stillBs, JSON.stringify({ bRect, now: await rectOf(A) }))
  check('undo syncs to B', await until(async () => (await count(B)) === 6))
  await A.keyboard.press('Control+Shift+z')
  check('redo applies the erase again', await until(async () => (await count(A)) === 5 && (await count(B)) === 5))
  // B has not drawn anything of its own, so B undo must do nothing to A's work
  await B.keyboard.press('Control+z')
  await B.keyboard.press('Control+z')
  await new Promise((r) => setTimeout(r, 300))
  const bUndo = await rectOf(B)
  check("B undo reverts B's resize and move, not A's drawings", (await count(B)) === 5 && bUndo.w < bRect.w)

  // select by marquee, colour change, delete
  await A.keyboard.press('v')
  await drag(A, [[250, 150], [760, 330]])
  const sel = await A.evaluate(() => __wb.selection.size)
  check('marquee selects what it touches', sel >= 2, `selected ${sel}`)
  await A.getByRole('button', { name: 'Colour #B8403D' }).click()
  check('colour change applies to the selection and syncs', await until(() => B.evaluate(() => [...__wb.scene.entries.values()].some((e) => e.obj.color === '#B8403D'))))
  await A.keyboard.press('Delete')
  check('delete removes the selection', (await A.evaluate(() => __wb.selection.size)) === 0 && (await count(A)) < 4)

  // viewport
  await A.keyboard.press('0')
  const v0 = await A.evaluate(() => ({ ...__wb.vp }))
  await A.mouse.move(400, 300)
  const w0 = await A.evaluate(() => ({ x: (400 - __wb.vp.x) / __wb.vp.scale, y: (300 - __wb.vp.y) / __wb.vp.scale }))
  await A.mouse.wheel(0, -200)
  await until(async () => (await A.evaluate(() => __wb.vp.scale)) > v0.scale)
  const v1 = await A.evaluate(() => ({ ...__wb.vp }))
  const w1 = { x: (400 - v1.x) / v1.scale, y: (300 - v1.y) / v1.scale }
  check('wheel zooms around the cursor', v1.scale > v0.scale && Math.abs(w1.x - w0.x) < 0.5 && Math.abs(w1.y - w0.y) < 0.5, `scale ${v0.scale} -> ${v1.scale.toFixed(2)}`)
  await A.keyboard.down(' ')
  await drag(A, [[400, 300], [460, 340]])
  await A.keyboard.up(' ')
  const v2 = await A.evaluate(() => ({ ...__wb.vp }))
  check('space-drag pans', Math.abs(v2.x - v1.x - 60) < 2 && Math.abs(v2.y - v1.y - 40) < 2)

  // Incremental repaints (dirty rects, pan shortcut) must match a from-scratch redraw pixel for pixel.
  const C = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage()
  await C.goto(BASE + '/r/redrawcheck?debug=1')
  await C.waitForFunction(() => window.__wb)
  const redraw = await C.evaluate(async () => {
    const wb = __wb, wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const grab = () => wb.sctx.getImageData(0, 0, wb.sc.width, wb.sc.height).data
    const differing = async () => {
      await wait(250)
      const inc = grab()
      wb.refresh(); wb.renderNow()
      const full = grab()
      let d = 0
      for (let i = 3; i < full.length; i += 4) if (Math.abs(full[i] - inc[i]) > 40) d++
      return d
    }
    const ids = wb.board.addMany([
      { type: 'rect', x: -200, y: -150, w: 150, h: 100, color: '#111111', sw: 2 },
      { type: 'ellipse', x: 50, y: -120, w: 150, h: 100, color: '#3F7A45', sw: 4 },
      { type: 'pen', x: -150, y: 80, points: [0, 0, 40, 30, 90, 10, 140, 50], color: '#B8403D', sw: 4 },
      { type: 'line', x: -200, y: 200, w: 300, h: 60, color: '#2E6FA3', sw: 2 },
    ])
    await wait(500) // let the first-sync fit settle
    wb.refresh(); wb.renderNow()
    const steps = {}
    wb.board.patch(ids[0], { x: -100, y: -100 }); steps.move = await differing()
    wb.board.patchMany([[ids[0], { w: 230, h: 60 }]]); steps.resize = await differing()
    wb.board.patch(ids[1], { color: '#B07A12' }); steps.recolour = await differing()
    for (let i = 0; i < 20; i++) { wb.panBy(9, -4); wb.renderNow() }
    steps.pan = await differing()
    wb.board.remove([ids[0], ids[2]]); steps.delete = await differing()
    wb.board.undo.stopCapturing(); wb.board.undo.undo(); steps.undo = await differing()
    return steps
  })
  // A handful of edge pixels can differ because the browser rasterises a clipped curve slightly
  // differently. Anything above that is a real stale-pixel bug.
  check('incremental repaint matches a full redraw after move, resize, recolour, pan, delete, undo',
    Object.values(redraw).every((d) => d <= 16), JSON.stringify(redraw))

  await A.screenshot({ path: 'shots/board-a.png' })
  await B.screenshot({ path: 'shots/board-b.png' })
} catch (err) {
  console.log('E2E ERROR', err)
  failed++
} finally {
  await browser.close()
  await app.stop()
}

console.log(failed ? `E2E_FAIL (${failed})` : 'E2E_OK')
process.exit(failed ? 1 : 0)
