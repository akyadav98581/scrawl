// 5000 objects on the board, then pan, zoom and drag while timing every frame.
import { firefox } from 'playwright'
import { startApp } from './harness.mjs'

const LIMIT_MS = 33 // 30 fps floor for anything that runs every frame
const SETTLE_MS = 100 // one redraw after a zoom ends, nobody is mid-gesture
const app = await startApp(3112)
const browser = await firefox.launch()
let pass = true

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await page.goto(`${app.url}/r/benchroom?debug=1`)
  await page.waitForFunction(() => window.__wb)

  const results = await page.evaluate(async (N) => {
    const wb = window.__wb
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const colors = ['#111111', '#787774', '#B8403D', '#B07A12', '#3F7A45', '#2E6FA3']
    const list = []
    for (let i = 0; i < N; i++) {
      const base = { x: rnd() * 6000 - 3000, y: rnd() * 4000 - 2000, color: colors[i % 6], sw: [2, 4, 8][i % 3] }
      const r = rnd()
      if (r < 0.5) {
        const pts = [0, 0]
        for (let k = 0; k < 40; k++) pts.push(pts[pts.length - 2] + rnd() * 12 - 4, pts[pts.length - 1] + rnd() * 12 - 6)
        list.push({ type: 'pen', ...base, points: pts })
      } else if (r < 0.7) list.push({ type: 'rect', ...base, w: 40 + rnd() * 160, h: 30 + rnd() * 120 })
      else if (r < 0.85) list.push({ type: 'ellipse', ...base, w: 40 + rnd() * 140, h: 30 + rnd() * 100 })
      else if (r < 0.95) list.push({ type: 'line', ...base, w: rnd() * 200 - 100, h: rnd() * 120 - 60 })
      else list.push({ type: 'text', ...base, text: 'note ' + i, size: 20, w: 90, h: 26 })
    }
    wb.board.addMany(list)
    const raf = () => new Promise((r) => requestAnimationFrame(r))
    await raf()

    const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]
    async function run(name, setup, step, frames = 180) {
      setup()
      await raf()
      const cpu = [], gaps = []
      let last = performance.now()
      for (let i = 0; i < frames; i++) {
        step(i)
        const t0 = performance.now()
        wb.renderNow()
        cpu.push(performance.now() - t0)
        await raf()
        const now = performance.now()
        gaps.push(now - last)
        last = now
      }
      return { name, cpuP50: pct(cpu, 0.5), cpuP95: pct(cpu, 0.95), frameP95: pct(gaps, 0.95) }
    }

    const out = []
    out.push(await run('pan, all objects in view', () => wb.fit(), (i) => wb.panBy(Math.sin(i / 9) * 14, Math.cos(i / 11) * 9)))
    out.push(await run('zoom in and out, all objects in view', () => wb.fit(), (i) => wb.zoomAtScreen(720, 450, i % 40 < 20 ? 1.04 : 1 / 1.04)))
    out.push(await run('pan at 100%', () => { wb.resetView(); wb.panBy(-300, -200) }, (i) => wb.panBy(Math.sin(i / 7) * 20, 6)))
    // A zoom is drawn as a stretched copy of the last frame, then redrawn crisp once it settles.
    // That redraw is the real cost, so time it on its own.
    const settle = async (name, setup) => {
      setup()
      wb.renderNow()
      const t = []
      for (let i = 0; i < 25; i++) {
        wb.refresh()
        const t0 = performance.now()
        wb.renderNow()
        t.push(performance.now() - t0)
        await raf()
      }
      return { name, settle: true, cpuP50: pct(t, 0.5), cpuP95: pct(t, 0.95), frameP95: 0 }
    }
    out.push(await settle('crisp redraw after zoom, all in view', () => wb.fit()))
    out.push(await settle('crisp redraw after zoom, 100%', () => { wb.resetView(); wb.panBy(-300, -200) }))

    // The pan shortcut must produce the same pixels as a full redraw.
    wb.fit()
    wb.refresh() // fit() only stretches the old frame, start from a crisp one
    wb.renderNow()
    for (let i = 0; i < 30; i++) { wb.panBy(7, -5); wb.renderNow() }
    const grab = () => wb.sctx.getImageData(0, 0, wb.sc.width, wb.sc.height).data
    const panned = grab()
    wb.vp = { ...wb.drawn } // same transform as the bitmap, so any difference is a seam
    wb.refresh()
    wb.renderNow()
    const full = grab()
    let drawnPx = 0, diff = 0
    for (let i = 3; i < full.length; i += 4) {
      if (full[i] || panned[i]) drawnPx++
      if (Math.abs(full[i] - panned[i]) > 100) diff++
    }
    const seamPct = (diff / Math.max(drawnPx, 1)) * 100

    const first = [...wb.scene.entries.keys()][0]
    out.push(await run('drag one object (dirty rect only)', () => wb.resetView(), (i) => wb.board.patch(first, { x: 100 + i * 2, y: 100 + Math.sin(i / 8) * 40 })))
    return { objects: wb.scene.size, out, seamPct }
  }, 5000)

  console.log(`objects on board: ${results.objects}`)
  for (const r of results.out) {
    const ok = r.settle ? r.cpuP95 < SETTLE_MS : r.cpuP95 < LIMIT_MS && r.frameP95 < LIMIT_MS
    pass &&= ok
    console.log(`${ok ? 'ok  ' : 'SLOW'}  ${r.name.padEnd(40)} render p50 ${r.cpuP50.toFixed(1)} ms  p95 ${r.cpuP95.toFixed(1)} ms   frame p95 ${r.frameP95.toFixed(1)} ms`)
  }
  const seamOk = results.seamPct < 0.5
  pass &&= seamOk
  console.log(`${seamOk ? 'ok  ' : 'SLOW'}  pan shortcut vs full redraw: ${results.seamPct.toFixed(3)}% of drawn pixels differ`)
} finally {
  await browser.close()
  await app.stop()
}
console.log(pass ? 'BENCH_PASS' : 'BENCH_FAIL')
process.exit(pass ? 0 : 1)
