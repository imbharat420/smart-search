// Remembers a shared device location across visits, so the assistant (and
// Discover) only has to ask for it once per browser rather than every session.
import type { Coords } from './geo'

const KEY = 'travelIQ.origin'

export function getStoredOrigin(): Coords | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Coords>
    if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
      return { lat: parsed.lat, lng: parsed.lng }
    }
    return null
  } catch {
    return null
  }
}

export function setStoredOrigin(origin: Coords): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(origin))
  } catch {
    // Storage can be unavailable (private browsing) — the feature just re-asks next time.
  }
}
