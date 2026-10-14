// Identifies one conversation so the backend can key its trip-plan state and its
// stored transcript on it (backend/app/sessions.py). localStorage rather than the
// sessionStorage this started with: the conversation is now persisted server-side
// and restored on load, so the id has to outlive the tab or the stored thread
// would be orphaned on every restart. Resuming is explicit on screen — the
// restored messages are visible, and "New chat" (resetSession) starts fresh.

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
    const existing = localStorage.getItem(KEY)
    if (existing) {
      // Mirror it in memory too: if storage starts throwing later in the sitting
      // (quota, or an embedding page revoking access) we carry on with this same id
      // rather than minting a new one and orphaning the plan the backend already has.
      inMemoryId = existing.slice(0, MAX_LENGTH)
      return inMemoryId
    }
    const minted = mintId()
    localStorage.setItem(KEY, minted)
    inMemoryId = minted
    return minted
  } catch {
    if (!inMemoryId) inMemoryId = mintId()
    return inMemoryId
  }
}

// Switch this browser to an existing conversation — the chat drawer picking a
// thread from the list. The id was one of ours to begin with, so length is the
// only thing worth guarding.
export function setSessionId(id: string): void {
  const cleaned = id.slice(0, MAX_LENGTH)
  inMemoryId = cleaned
  try {
    localStorage.setItem(KEY, cleaned)
  } catch {
    // The in-memory mirror above keeps the sitting coherent, same as getSessionId.
  }
}

export function resetSession(): void {
  inMemoryId = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was persisted anyway — the in-memory id above is already cleared.
  }
}
