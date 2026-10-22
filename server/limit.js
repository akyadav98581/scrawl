import { createClient } from 'redis'

// Fixed-window counter. Redis if REDIS_URL is set, otherwise a Map.
// When Redis errors we allow the request.
export async function createLimiter(url) {
  if (!url) return memoryLimiter()
  const client = createClient({ url }).on('error', (err) => console.error('redis:', err.message))
  await client.connect()
  return {
    async allow(key, limit, windowSec) {
      try {
        const [count] = await client.multi().incr(`limit:${key}`).expire(`limit:${key}`, windowSec, 'NX').exec()
        return count <= limit
      } catch {
        return true
      }
    },
    close: () => client.quit(),
  }
}

export function memoryLimiter() {
  const hits = new Map()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, h] of hits) if (h.resetAt <= now) hits.delete(key)
  }, 60_000).unref()
  return {
    async allow(key, limit, windowSec) {
      const now = Date.now()
      let h = hits.get(key)
      if (!h || h.resetAt <= now) hits.set(key, (h = { count: 0, resetAt: now + windowSec * 1000 }))
      return ++h.count <= limit
    },
    async close() {
      clearInterval(sweep)
    },
  }
}
