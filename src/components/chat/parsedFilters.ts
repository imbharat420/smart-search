// Turns what the query parser extracted into the three things the assistant needs: read-only
// chips, a SearchFilters object, and a shareable /search URL.

import type { ParsedQuery, SearchFilters } from '../../types'
import { money, monthName } from '../../lib/format'

const CLIMATE_LABELS: Record<string, string> = {
  warm: 'Warm and sunny',
  mild: 'Mild',
  cold: 'Cold and snowy',
}

export interface ParsedChip {
  key: string
  label: string
}

// Inferred filters become stated ones on the way to /search. That is deliberate: an explicit
// filter always outranks an inferred one, so the traveller can then remove any single chip.
export function parsedToFilters(parsed: ParsedQuery): SearchFilters {
  const filters: SearchFilters = {}
  if (parsed.destination) filters.destination = parsed.destination
  if (parsed.themes && parsed.themes.length > 0) filters.theme = parsed.themes[0]
  if (parsed.activities && parsed.activities.length > 0) filters.activity = parsed.activities[0]
  if (parsed.audience && parsed.audience.length > 0) filters.audience = parsed.audience[0]
  if (parsed.months && parsed.months.length > 0) filters.month = parsed.months[0]
  if (parsed.maxPrice !== undefined) filters.maxPrice = parsed.maxPrice
  if (parsed.climate) filters.climate = parsed.climate
  if (parsed.directFlights) filters.directOnly = true
  if (parsed.durationDays !== undefined) {
    // Widened by a day either side to match how the retrieval layer treats trip length, so the
    // count on the button agrees with the results page.
    filters.minDuration = Math.max(1, parsed.durationDays - 1)
    filters.maxDuration = parsed.durationDays + 1
  }
  return filters
}

export function searchUrl(query: string, filters: SearchFilters): string {
  const params = new URLSearchParams()
  const trimmed = query.trim()
  if (trimmed) params.set('q', trimmed)

  // Spelled out rather than looped so the URL vocabulary is readable in one place.
  const pairs: [string, string | number | boolean | undefined][] = [
    ['destination', filters.destination],
    ['theme', filters.theme],
    ['activity', filters.activity],
    ['audience', filters.audience],
    ['month', filters.month],
    ['minDuration', filters.minDuration],
    ['maxDuration', filters.maxDuration],
    ['maxPrice', filters.maxPrice],
    ['climate', filters.climate],
    ['directOnly', filters.directOnly],
    ['availableOnly', filters.availableOnly],
  ]
  for (const [key, value] of pairs) {
    if (value === undefined || value === false) continue
    params.set(key, String(value))
  }
  return `/search?${params.toString()}`
}

function capitalise(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function parsedChips(parsed: ParsedQuery): ParsedChip[] {
  const chips: ParsedChip[] = []

  if (parsed.destination) chips.push({ key: 'destination', label: capitalise(parsed.destination) })
  for (const theme of parsed.themes ?? []) chips.push({ key: `theme-${theme}`, label: `Theme: ${theme}` })
  for (const activity of parsed.activities ?? []) chips.push({ key: `activity-${activity}`, label: activity })
  for (const who of parsed.audience ?? []) chips.push({ key: `audience-${who}`, label: who })

  const months = parsed.months ?? []
  if (months.length === 1) {
    chips.push({ key: 'months', label: monthName(months[0]) })
  } else if (months.length > 1) {
    chips.push({
      key: 'months',
      label: `${monthName(months[0])} – ${monthName(months[months.length - 1])}`,
    })
  }

  if (parsed.durationDays !== undefined) {
    chips.push({ key: 'duration', label: `Around ${parsed.durationDays} days` })
  }
  if (parsed.maxPrice !== undefined) {
    chips.push({ key: 'maxPrice', label: `Under ${money(parsed.maxPrice)}` })
  }
  if (parsed.climate) chips.push({ key: 'climate', label: CLIMATE_LABELS[parsed.climate] })
  if (parsed.groupSizeMax !== undefined) {
    // Group size has no filter on /search yet, so this chip shows understanding only. Adding
    // groupSizeMax to SearchFilters is what would make it travel with the rest.
    chips.push({ key: 'groupSizeMax', label: `Up to ${parsed.groupSizeMax} travellers` })
  }
  if (parsed.directFlights) chips.push({ key: 'direct', label: 'Direct flights only' })

  return chips
}
