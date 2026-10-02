import { randomName, randomUserColor } from './palette.js'

// Name and colour live in localStorage so you stay the same person across rooms.
// Private windows can block storage, so every access is wrapped.
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export function getIdentity() {
  let name = read('scrawl.name')
  let color = read('scrawl.color')
  if (!name) { name = randomName(); write('scrawl.name', name) }
  if (!color) { color = randomUserColor(); write('scrawl.color', color) }
  return { name, color }
}

export const setName = (n) => write('scrawl.name', n.trim().slice(0, 24) || randomName())

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function newRoomId() {
  const b = crypto.getRandomValues(new Uint8Array(8))
  return [...b].map((v) => ALPHABET[v % ALPHABET.length]).join('')
}

export function recentRooms() {
  try { return JSON.parse(read('scrawl.rooms') ?? '[]') } catch { return [] }
}

export function rememberRoom(id) {
  const rest = recentRooms().filter((r) => r.id !== id)
  write('scrawl.rooms', JSON.stringify([{ id, at: Date.now() }, ...rest].slice(0, 6)))
}
