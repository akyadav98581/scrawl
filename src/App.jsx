import { useEffect, useState } from 'react'
import Landing from './components/Landing.jsx'
import Room from './components/Room.jsx'

const roomFromPath = () => location.pathname.match(/^\/r\/([A-Za-z0-9_-]{6,64})\/?$/)?.[1] ?? null

export function go(path) {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [room, setRoom] = useState(roomFromPath)
  useEffect(() => {
    const onPop = () => setRoom(roomFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return room ? <Room key={room} id={room} /> : <Landing />
}
