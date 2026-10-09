# Scrawl

A shared whiteboard. Open a room, send the link, and everyone in it draws on the same canvas at the same time.

**Live:** https://scrawl-wymi.onrender.com (the free server sleeps when idle, so the first load can take up to a minute)

Pens, lines, rectangles, ellipses, text, live cursors, and undo that only touches your own changes. Boards are saved, so a room is still there when you come back.

Built with Vite, React and Tailwind. The canvas is plain Canvas 2D, no drawing library. Node, Socket.io and Yjs on the server, MongoDB for storage.

## Run it locally

```
npm install
npm run dev
```

Open http://localhost:5173, make a room, then open the same link in a second window. With no `MONGODB_URI` set, the server starts its own local mongod, so there is nothing else to install.

Keys: `V` select, `P` pen, `L` line, `R` rectangle, `O` ellipse, `T` text, `E` eraser, hold `Space` to pan, `Ctrl+Z` undo, `Shift+1` fit to screen. Mouse wheel zooms, trackpad scroll pans.

## How it works

Each board is a Yjs document with one map of shapes, and every shape is a small map of its own. The server keeps one document per room in memory and passes updates between sockets. On connect, the client and the server swap state vectors and send each other whatever the other is missing. That also covers reconnects: edits made offline merge when you come back.

A pen stroke isn't streamed into the document point by point. Others see a throttled preview while you draw, and the simplified stroke is written once when you lift the pen.

### Conflicts

Two people changing different properties of one shape both win, so one can move it while the other recolours it. If they change the same property at once, Yjs picks the same winner on every machine. A delete beats a concurrent edit. One known quirk: `x` and `y` are separate properties, so two people dragging the same shape at the same instant can end up with `x` from one and `y` from the other.

### Storage

MongoDB holds a snapshot per room and a log of updates. The server writes the log in batches and folds it into a new snapshot after 200 entries, when a room empties, or on shutdown. Loading a room is the snapshot plus a replay of the log. A snapshot has to fit in one 16 MB document.

## Performance

There are two canvases: committed shapes underneath, and a live layer on top for strokes in progress, selection and cursors. The viewport goes straight into `setTransform`. Only the rectangle around a changed shape is repainted, panning copies existing pixels and paints just the new strips, and shapes far off screen are skipped.

Measured with 5000 objects in headless Firefox (software canvas, 1440x900) using `npm run bench`: panning and zooming stay under a frame p95 of 25 ms, dragging a shape takes about 6 ms at p95, and a full crisp redraw after a zoom takes 29 to 44 ms. A panned canvas matches a full redraw pixel for pixel.

## Deploy on Render

1. Make a free MongoDB Atlas cluster and a database user. Under Network Access allow `0.0.0.0/0`, since Render's free tier has no fixed IP.
2. In Render, create a Blueprint from this repo. It reads `render.yaml`.
3. Paste the Atlas connection string into `MONGODB_URI`.

The free service sleeps when idle, and the page shows "Waking the server" while it connects. I point an uptime monitor at `/healthz` to keep it awake.

## Scaling

Run one instance. Rooms live in memory, and the log numbering assumes one writer per room. More instances would need sticky sessions (or routing by room id), the Socket.io Redis adapter, and a single owner for each room's writes. None of that is here.

## Tests

```
npm test       # geometry, viewport, sync server against a real mongod
npm run e2e    # two Firefox tabs: tools, sync, cursors, resize, undo, zoom
npm run bench
```

The first run of e2e and bench needs `npx playwright install firefox`.

## Not here

No login, comments, image upload or export, and no rate limiting. Anyone with a room link can edit.
