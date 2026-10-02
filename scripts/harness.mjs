// Starts the built app against a throwaway MongoDB so e2e and bench run anywhere.
import { spawn } from 'node:child_process'
import { MongoMemoryServer } from 'mongodb-memory-server'

export async function startApp(port) {
  const mongod = await MongoMemoryServer.create()
  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(port), MONGODB_URI: mongod.getUri(), MONGODB_DB: 'harness' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('listening') && resolve())
    server.once('exit', () => reject(new Error('server exited early')))
  })
  return {
    url: `http://localhost:${port}`,
    async stop() {
      const exited = new Promise((r) => server.once('exit', r))
      server.kill('SIGTERM')
      await exited // the server saves its rooms on SIGTERM, mongod has to outlive that
      await mongod.stop()
    },
  }
}
