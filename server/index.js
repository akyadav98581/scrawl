import { startServer } from './app.js'
import { createStore, openDatabase } from './store.js'

const { db, close } = await openDatabase()
const srv = await startServer({ store: createStore(db), port: Number(process.env.PORT) || 3001 })
console.log(`scrawl listening on :${srv.port}`)

// Render sends SIGTERM on deploy. Save every open room before the process goes.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await srv.close()
    await close()
    process.exit(0)
  })
}
