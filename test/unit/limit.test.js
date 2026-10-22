import { afterEach, expect, test, vi } from 'vitest'
import { memoryLimiter } from '../../server/limit.js'

afterEach(() => vi.useRealTimers())

test('blocks after the limit and opens again when the window ends', async () => {
  vi.useFakeTimers()
  const lim = memoryLimiter()
  expect(await lim.allow('a', 2, 60)).toBe(true)
  expect(await lim.allow('a', 2, 60)).toBe(true)
  expect(await lim.allow('a', 2, 60)).toBe(false)
  expect(await lim.allow('b', 2, 60)).toBe(true) // other keys are separate
  vi.advanceTimersByTime(61_000)
  expect(await lim.allow('a', 2, 60)).toBe(true)
  await lim.close()
})
