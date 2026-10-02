# Scrawl

A shared whiteboard. Open a room, send the link, and everyone in it draws on the same infinite canvas at the same time. Pens, lines, rectangles, ellipses and text, with live cursors and a board that is still there tomorrow.

Vite, React and Tailwind on the front. The canvas is plain Canvas 2D, no Konva or Fabric. Node, Socket.io and Yjs on the back, MongoDB for storage.

## Run it

```
npm install
npm run dev
```

That starts the server on :3001 and Vite on :5173. With no `MONGODB_URI` set, the server boots a local mongod and keeps its data in `.data/mongo`, so you need nothing installed. Open http://localhost:5173, make a room, then open the same link in a second window.

Keys: `V` select, `P` pen, `L` line, `R` rectangle, `O` ellipse, `T` text, `E` eraser, `H` or hold `Space` to pan. `Ctrl+Z` undo, `Ctrl+Shift+Z` redo, `Delete` removes the selection, `Shift+1` fits the board to the screen. A mouse wheel zooms around the cursor, trackpad scrolling pans, pinch zooms.

## How sync works

Each board is a Yjs document. The document holds one map of objects, and each object is its own small map (`type`, `x`, `y`, `color`, and so on). The server keeps one document per room in memory and relays updates between sockets.

When a client connects it sends its state vector. The server answers with whatever the client is missing and its own state vector, and the client sends back whatever the server is missing. That one exchange is also the reconnect path. If you lose your connection you keep drawing, and when you come back both sides merge without losing anything. A copy of the room also sits in IndexedDB, so a reload while offline keeps your work.

Local edits are batched for 30 ms and sent as one merged update. A pen stroke is not streamed point by point into the document. While you draw, other people see a throttled preview over the presence channel, and the stroke is simplified and written once when you lift the pen.

### Conflict handling

Because every object is a map, two people editing different properties of one shape both win. One drags it while the other recolours it, and you get both. If they set the same property at the same moment, Yjs picks a winner by client id, the same on every machine, so everyone ends up looking at the same board. A delete beats a concurrent edit of the same shape.

One quirk I left alone: `x` and `y` are separate properties. If two people drag the same shape at the same instant, the result can take `x` from one and `y` from the other. Storing the position as a single `[x, y]` value would fix that. It hasn't mattered enough to change.

Undo uses `Y.UndoManager` and tracks only changes made with the local origin. Pressing undo reverts your last action, never somebody else's. One gesture (a drag, a stroke, an erase sweep) is one undo step.

### Storage

Two collections. `snapshots` holds one full document per room. `updates` is an append-only log of Yjs updates. The server batches incoming updates for 400 ms before writing one log entry. Once a room has 200 entries, or when it empties out, or when the process gets SIGTERM, the log is folded into a new snapshot and trimmed. On load the server applies the snapshot, then replays the log.

If the process dies between writing a snapshot and trimming the log, nothing breaks. Replaying old updates over a newer snapshot changes nothing, because Yjs updates are idempotent. Anything lost in the last 400 ms of a hard crash comes back when the clients reconnect and send their diff.

A snapshot has to fit in one 16 MB MongoDB document. That is a lot of strokes, but it is a limit.

## Rendering and performance

There are two canvases. The static one holds the committed objects. The live one sits on top and is repainted every frame with the things that move: in-progress strokes, selection handles, marquee, remote cursors and remote drafts. The dot grid is a CSS background that follows the viewport, so the canvas never paints it.

Pan and zoom are done by hand. The viewport is `{ x, y, scale }` and goes straight into `ctx.setTransform`. No CSS scaling.

Techniques that keep it fast on a big board:

- Objects outside the viewport are skipped. Each object has a cached bounding box.
- When one object changes, only the rectangle around it is cleared and repainted, using a clip.
- Panning copies the pixels already on the canvas and paints only the strips that scrolled into view.
- Zooming draws a stretched copy of the last frame while the wheel is moving, then repaints crisp 140 ms after it stops.
- Tiny objects zoomed far out are drawn as small blobs, mid-size pens as a plain polyline, and smoothed curves cached per object.

Benchmark, 5000 objects (half of them pen strokes) scattered over a 6000 by 4000 area, 1440 by 900 window, headless Firefox on a laptop with software canvas. Run it with `npm run bench`.

| Scenario | render p50 | render p95 | frame p95 |
| --- | --- | --- | --- |
| Pan, every object in view | 9 ms | 12 ms | 19 ms |
| Zoom in and out, every object in view | 7 ms | 11 ms | 25 ms |
| Pan at 100% | 11 ms | 15 ms | 20 ms |
| Drag one object | 4 ms | 6 ms | 18 ms |
| Crisp redraw after a zoom, all in view | 40 ms | 44 ms | n/a |
| Crisp redraw after a zoom, 100% | 29 ms | 33 ms | n/a |

The slowest per-frame number is a frame p95 of 25 ms against a 33 ms budget (30 fps), and the slowest render p95 15 ms. The zoom rows measure the stretched preview. The crisp redraw is the real cost of a full repaint, so it has its own rows. It happens once, after the zoom stops. The benchmark also checks that a panned canvas is pixel for pixel the same as a full redraw (0.000% of pixels differ), and the end-to-end test does the same after move, resize, recolour, delete and undo.

## Deploy on Render

The repo has a `render.yaml`. One web service builds the client and serves it, and the same process runs Socket.io.

1. Create a free MongoDB Atlas cluster. Add a database user. Under Network Access allow `0.0.0.0/0`, because Render's free tier has no fixed outgoing address.
2. In Render, create a Blueprint from this repo.
3. Paste the Atlas connection string into `MONGODB_URI` in the dashboard.

Health check is `/healthz`. The server saves every open room on SIGTERM, so a deploy does not drop recent strokes.

The free web service sleeps when idle. The first visit after that takes up to a minute, and the board shows a "Waking the server" notice while it connects. Atlas M0 gives you 512 MB.

## Scaling

Run one instance. Rooms live in memory on one process, and the log sequence numbers assume a single writer per room. That is fine for a demo and for a few hundred people.

To run more than one instance you need three changes. Turn on sticky sessions at the load balancer so a room's sockets land together, or route by room id. Add the Socket.io Redis adapter so updates reach sockets on other instances. And let only one instance own a room's database writes, for example with a lease in Redis. None of that is in here.

## Tests

```
npm test        # geometry, viewport, and the sync server against a real mongod
npm run build
npm run e2e     # two Firefox tabs: every tool, sync, cursors, resize, undo, zoom, redraw check
npm run bench
```

The sync tests run two socket.io clients against the real server code and check that concurrent edits converge, that offline edits merge, that undo stays local, and that a room comes back after a restart, both from a snapshot and from a log with no compaction.

First run of the e2e and bench scripts needs `npx playwright install firefox`.

## What is not here

No login, comments, image upload or export. Rooms are unlisted but anyone with the link can edit, and there is no rate limiting on updates. I'd add all of that before pointing real users at it.
