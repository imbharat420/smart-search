import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'traveliq.saved.guides'

function readSaved(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    // Private-browsing modes throw on localStorage, so saving degrades to this session only.
    return []
  }
}

// Saved guides live in localStorage rather than on the account: the POC has no
// auth, and the saved_items table plus a /me/saved endpoint is what would move
// this collection onto the server.
export function useSavedGuides(): { saved: string[]; toggle: (id: string) => void } {
  const [saved, setSaved] = useState<string[]>(readSaved)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch {
      // Same story as readSaved — nothing to recover, so nothing to report.
    }
  }, [saved])

  const toggle = useCallback((id: string) => {
    setSaved((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [id, ...current],
    )
  }, [])

  return { saved, toggle }
}
