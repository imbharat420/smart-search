// Heuristic "near me" detection for the assistant chat, in the same spirit as
// src/mock/catalog.ts's localParse — a client-side fallback layer, not an NLQ
// replacement. Distances in the message are read in whichever unit the reader
// used (km or miles) and converted, since Place data and milesBetween() are
// mile-based internally but the product is framed in km.

const NEAR_ME_PATTERN = /\b(near me|nearby|close by|around me|around here|in my area|close to me)\b/i
const DISTANCE_PATTERN = /(\d+(?:\.\d+)?)\s*(kilometers?|kilometres?|km|miles?|mi)\b/i
const MILES_PER_KM = 0.621371
const DEFAULT_RADIUS_KM = 25

export interface NearMeIntent {
  radiusKm: number
  radiusMiles: number
}

export function parseNearMe(text: string): NearMeIntent | null {
  const match = text.match(DISTANCE_PATTERN)
  // A bare distance ("restaurants within 10km") is as strong a signal as the
  // phrase "near me" itself — treat either as the trigger.
  if (!NEAR_ME_PATTERN.test(text) && !match) return null

  if (!match) {
    return { radiusKm: DEFAULT_RADIUS_KM, radiusMiles: DEFAULT_RADIUS_KM * MILES_PER_KM }
  }

  const value = Number(match[1])
  const isMiles = match[2].toLowerCase().startsWith('mi')
  return isMiles
    ? { radiusKm: value / MILES_PER_KM, radiusMiles: value }
    : { radiusKm: value, radiusMiles: value * MILES_PER_KM }
}
