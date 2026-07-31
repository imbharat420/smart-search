// Filtering for the inspiration gallery. All twelve guides arrive in a single
// /guides call, so narrowing them in the browser is instant and lets the tag row
// show real counts instead of asking the backend for facets it does not compute.

import type { Guide } from '../../types'

export type DurationBand = 'any' | 'short' | 'week' | 'long'

export interface GuideFilters {
  tags: string[]
  duration: DurationBand
  author: string
  savedOnly: boolean
}

export const EMPTY_FILTERS: GuideFilters = {
  tags: [],
  duration: 'any',
  author: '',
  savedOnly: false,
}

export const DURATION_BANDS: { value: DurationBand; label: string }[] = [
  { value: 'any', label: 'Any length' },
  { value: 'short', label: 'Short break, up to 4 days' },
  { value: 'week', label: 'A week, 5 to 7 days' },
  { value: 'long', label: 'Longer, 8 days or more' },
]

export function toBand(value: string): DurationBand {
  return DURATION_BANDS.find((band) => band.value === value)?.value ?? 'any'
}

export function toggleTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}

export function searchGuides(guides: Guide[], query: string): Guide[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return guides
  return guides.filter((guide) =>
    `${guide.title} ${guide.location} ${guide.tags.join(' ')}`.toLowerCase().includes(needle),
  )
}

function inBand(days: number, band: DurationBand): boolean {
  if (band === 'short') return days <= 4
  if (band === 'week') return days >= 5 && days <= 7
  if (band === 'long') return days >= 8
  return true
}

export function applyGuideFilters(guides: Guide[], filters: GuideFilters, saved: string[]): Guide[] {
  return guides.filter((guide) => {
    // Tags are AND-ed, the same way stacked filters behave on the search screen.
    if (filters.tags.some((tag) => !guide.tags.includes(tag))) return false
    if (!inBand(guide.days, filters.duration)) return false
    if (filters.author && guide.author !== filters.author) return false
    if (filters.savedOnly && !saved.includes(guide.id)) return false
    return true
  })
}

export function activeFilterCount(filters: GuideFilters): number {
  return (
    filters.tags.length +
    (filters.duration === 'any' ? 0 : 1) +
    (filters.author ? 1 : 0) +
    (filters.savedOnly ? 1 : 0)
  )
}

export function tagsByFrequency(guides: Guide[]): string[] {
  const counts = new Map<string, number>()
  for (const guide of guides) {
    for (const tag of guide.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

export function authorsOf(guides: Guide[]): string[] {
  return [...new Set(guides.map((guide) => guide.author))].sort((a, b) => a.localeCompare(b))
}
