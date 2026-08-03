// Identifies one conversation so the backend can key its trip-plan state on it.
// sessionStorage, not the localStorage that originStore.ts uses: a device location
// genuinely is durable, whereas a half-answered travel plan silently resumed a week
// later would be worse than starting fresh.

const KEY = 'travelIQ.sessionId'

// Survives a storage failure (private browsing) for the page's lifetime, so the
// conversation keeps its state until reload rather than losing it on every turn.
let inMemoryId: string | null = null

// varchar(64) in the backend's session column — the cap is the database's, not ours.
const MAX_LENGTH = 64

function mintId(): string {
  // randomUUID is missing on older Safari and on any non-secure origin, so fall back
  // to a timestamp plus randomness — unique enough to key one sitting's plan on.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().slice(0, MAX_LENGTH)
    }
  } catch {
    // Fall through to the timestamp form below.
  }
  const random = Math.random().toString(36).slice(2)
  return `s-${Date.now().toString(36)}-${random}`.slice(0, MAX_LENGTH)
}

export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing) {
      // Mirror it in memory too: if storage starts throwing later in the sitting
      // (quota, or an embedding page revoking access) we carry on with this same id
      // rather than minting a new one and orphaning the plan the backend already has.
      inMemoryId = existing.slice(0, MAX_LENGTH)
      return inMemoryId
    }
    const minted = mintId()
    sessionStorage.setItem(KEY, minted)
    inMemoryId = minted
    return minted
  } catch {
    if (!inMemoryId) inMemoryId = mintId()
    return inMemoryId
  }
}

export function resetSession(): void {
  inMemoryId = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing was persisted anyway — the in-memory id above is already cleared.
  }
}
