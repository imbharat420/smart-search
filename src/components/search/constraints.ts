// Everything that constrains a search, put into words: the chips read off ParsedQuery, the
// chips read off the explicit URL filters, and the sentence surgery that removing a parsed
// chip performs.
//
// Removing a parsed chip has to edit the sentence, because the parse is a pure function of it
// and /search has no way of being told "ignore the month you found". A phrasing these patterns
// miss is left in place and the chip stays; accepting a list of dismissed dimensions on
// /search is the fix.

import type { ParsedQuery, SearchFilters } from '../../types'
import { money, monthName } from '../../lib/format'

export type ParsedChipKey =
  | 'destination'
  | 'theme'
  | 'activity'
  | 'month'
  | 'duration'
  | 'budget'
  | 'audience'
  | 'climate'
  | 'direct'
  | 'group'

export interface ParsedChip {
  key: ParsedChipKey
  label: string
}

export interface FilterChip {
  fields: (keyof SearchFilters)[]
  label: string
}

// Which explicit filter a parsed chip owns, so dismissing the chip also clears the filter it
// was merged into.
export const CHIP_FILTER_FIELDS: Record<ParsedChipKey, (keyof SearchFilters)[]> = {
  destination: ['destination'],
  theme: ['theme'],
  activity: ['activity'],
  month: ['month'],
  duration: ['minDuration', 'maxDuration'],
  budget: ['maxPrice'],
  audience: ['audience'],
  climate: ['climate'],
  direct: ['directOnly'],
  group: [],
}

const CLIMATE_LABELS: Record<string, string> = {
  warm: 'Warm',
  mild: 'Mild',
  cold: 'Cold',
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

// Months arrive in the order the parser found them, which is what makes a winter read
// 'November – March' rather than 'January – December'.
function monthLabel(months: number[]): string {
  if (months.length === 1) return monthName(months[0])
  const consecutive = months.every((month, i) => i === 0 || month === (months[i - 1] % 12) + 1)
  if (consecutive) return `${monthName(months[0])} – ${monthName(months[months.length - 1])}`
  const names = months.slice(0, 3).map(monthName)
  return months.length > 3 ? `${names.join(', ')} +${months.length - 3}` : names.join(', ')
}

export function describeParsed(parsed: ParsedQuery): ParsedChip[] {
  const chips: ParsedChip[] = []
  if (parsed.destination) {
    chips.push({ key: 'destination', label: `Destination: ${titleCase(parsed.destination)}` })
  }
  if (parsed.themes && parsed.themes.length > 0) {
    chips.push({ key: 'theme', label: `Theme: ${parsed.themes.join(', ')}` })
  }
  if (parsed.activities && parsed.activities.length > 0) {
    chips.push({ key: 'activity', label: `Activity: ${parsed.activities.join(', ')}` })
  }
  if (parsed.months && parsed.months.length > 0) {
    chips.push({ key: 'month', label: monthLabel(parsed.months) })
  }
  if (parsed.durationDays) {
    chips.push({ key: 'duration', label: `${parsed.durationDays} days` })
  }
  if (parsed.maxPrice) {
    chips.push({ key: 'budget', label: `Under ${money(parsed.maxPrice)}` })
  }
  if (parsed.audience && parsed.audience.length > 0) {
    chips.push({ key: 'audience', label: parsed.audience.join(', ') })
  }
  if (parsed.climate) {
    chips.push({ key: 'climate', label: `${CLIMATE_LABELS[parsed.climate] ?? parsed.climate} climate` })
  }
  if (parsed.directFlights) {
    chips.push({ key: 'direct', label: 'Direct flights only' })
  }
  if (parsed.groupSizeMax) {
    chips.push({ key: 'group', label: `Group of ${parsed.groupSizeMax}` })
  }
  return chips
}

export function describeFilters(filters: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = []
  if (filters.destination) {
    chips.push({ fields: ['destination'], label: `destination ${titleCase(filters.destination)}` })
  }
  if (filters.theme) chips.push({ fields: ['theme'], label: `theme ${filters.theme}` })
  if (filters.activity) chips.push({ fields: ['activity'], label: `activity ${filters.activity}` })
  if (filters.audience) chips.push({ fields: ['audience'], label: `travellers ${filters.audience}` })
  if (filters.month) chips.push({ fields: ['month'], label: `${monthName(filters.month)} departures` })
  if (filters.minDuration !== undefined || filters.maxDuration !== undefined) {
    chips.push({ fields: ['minDuration', 'maxDuration'], label: 'the trip length limits' })
  }
  if (filters.maxPrice !== undefined) {
    chips.push({ fields: ['maxPrice'], label: `the ${money(filters.maxPrice)} price cap` })
  }
  if (filters.climate) {
    chips.push({
      fields: ['climate'],
      label: `${(CLIMATE_LABELS[filters.climate] ?? filters.climate).toLowerCase()} climate`,
    })
  }
  if (filters.directOnly) chips.push({ fields: ['directOnly'], label: 'direct flights only' })
  if (filters.availableOnly) {
    chips.push({ fields: ['availableOnly'], label: 'available departures only' })
  }
  return chips
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MONTH_PATTERN = new RegExp(
  `\\b(?:${MONTH_NAMES.flatMap((name) => [name, name.slice(0, 3)]).join('|')}|winter|spring|summer|autumn|fall)\\b`,
  'gi',
)
const DURATION_PATTERN = /\b\d{1,2}\s*[- ]?\s*(?:day|days|night|nights|week|weeks)\b|\b(?:long\s+)?weekend\b/gi
const BUDGET_PATTERN =
  /(?:under|below|less than|no more than|max(?:imum)?(?: of)?|up to|budget of|around)\s*£?\s*\d[\d,]*|£\s*\d[\d,]*|\b(?:cheap|budget|affordable|inexpensive|good value|not too expensive)\b/gi
const DIRECT_PATTERN = /\b(?:with\s+)?(?:direct|non-?stop|no connections?)\s*(?:flights?)?\b/gi
const AUDIENCE_PATTERN =
  /\b(?:for\s+)?(?:a|an|the|my|our)?\s*(?:famil(?:y|ies)|kids|children|couples?|honeymoon(?:ers)?|solo(?: travellers?)?|small groups?|groups?|adventurous|adventure)\b/gi
const CLIMATE_PATTERN =
  /\b(?:warm(?:th)?|hot|sunny|sunshine|tropical|mild|temperate|cool|cold|snowy|snow|arctic|freezing)\b/gi
const GROUP_PATTERN = /\b(?:group|party) of\s*\d{1,2}\b|\b(?:there (?:are|will be)|we are)\s*\d{1,2}\b/gi

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A vocabulary value is stripped whole, then word by word, so 'Northern Lights' also clears a
// sentence that only said 'northern lights tour'.
function valuePatterns(values: string[]): RegExp[] {
  const patterns: RegExp[] = []
  for (const value of values) {
    patterns.push(new RegExp(`\\b${escapeRe(value)}\\b`, 'gi'))
    for (const word of value.split(/[\s/&-]+/)) {
      if (word.length >= 4) patterns.push(new RegExp(`\\b${escapeRe(word)}\\b`, 'gi'))
    }
  }
  return patterns
}

const PHRASE_PATTERNS: Record<
  Exclude<ParsedChipKey, 'destination' | 'theme' | 'activity'>,
  RegExp
> = {
  month: MONTH_PATTERN,
  duration: DURATION_PATTERN,
  budget: BUDGET_PATTERN,
  audience: AUDIENCE_PATTERN,
  climate: CLIMATE_PATTERN,
  direct: DIRECT_PATTERN,
  group: GROUP_PATTERN,
}

function patternsFor(key: ParsedChipKey, parsed: ParsedQuery): RegExp[] {
  if (key === 'destination') return parsed.destination ? valuePatterns([parsed.destination]) : []
  if (key === 'theme') return valuePatterns(parsed.themes ?? [])
  if (key === 'activity') return valuePatterns(parsed.activities ?? [])
  return [PHRASE_PATTERNS[key]]
}

// Stripping a phrase leaves connectives hanging ('for a family next , not too expensive'),
// so the remainder is tidied back into a sentence a person would have typed.
function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\b(?:in|to|for|with|next|during|under|around|somewhere)\s*(?=[,.]|$)/gi, '')
    .replace(/^[\s,.]+|[\s,.]+$/g, '')
    .trim()
}

export function stripFromQuery(query: string, key: ParsedChipKey, parsed: ParsedQuery): string {
  let stripped = query
  for (const pattern of patternsFor(key, parsed)) stripped = stripped.replace(pattern, ' ')
  return tidy(stripped)
}
