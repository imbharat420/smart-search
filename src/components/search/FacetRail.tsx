import { useState } from 'react'
import { Check } from 'lucide-react'
import type { Climate, Facet, FacetValue, SearchFilters } from '../../types'
import { money } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'

// Bounds a little wider than the seeded catalogue (£489–£4,200, 3–16 days), so the top of each
// slider reads as "no limit" rather than as the most expensive trip.
const PRICE_MIN = 400
const PRICE_MAX = 4400
const PRICE_STEP = 100
const DURATION_MIN = 2
const DURATION_MAX = 21

const LIST_FACETS: { key: string; limit: number }[] = [
  { key: 'destination', limit: 6 },
  { key: 'theme', limit: 6 },
  { key: 'activity', limit: 5 },
  { key: 'month', limit: 6 },
  { key: 'audience', limit: 5 },
  { key: 'climate', limit: 3 },
]

export function countFilters(filters: SearchFilters): number {
  return Object.values(filters).filter((value) => value !== undefined && value !== false).length
}

interface FacetListProps {
  facet: Facet
  limit: number
  isSelected: (value: FacetValue) => boolean
  onToggle: (value: string) => void
}

function FacetList({ facet, limit, isSelected, onToggle }: FacetListProps) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? facet.values : facet.values.slice(0, limit)

  return (
    <section className="border-b pb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {facet.label}
      </h3>
      <ul className="-mx-2">
        {shown.map((value) => {
          const selected = isSelected(value)
          return (
            <li key={value.value}>
              <button
                type="button"
                onClick={() => onToggle(value.value)}
                aria-pressed={selected}
                className={cn(
                  'flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  selected && 'bg-accent font-semibold',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    selected ? 'border-primary bg-primary' : 'bg-card',
                  )}
                >
                  {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{value.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {value.count}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {facet.values.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 cursor-pointer text-xs font-semibold underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
        >
          {expanded ? 'Show fewer' : `Show all ${facet.values.length}`}
        </button>
      )}
    </section>
  )
}

interface FacetRailProps {
  facets: Facet[]
  filters: SearchFilters
  onChange: (filters: SearchFilters) => void
}

export function FacetRail({ facets, filters, onChange }: FacetRailProps) {
  const active = countFilters(filters)
  const lists = LIST_FACETS.map((entry) => ({
    ...entry,
    facet: facets.find((facet) => facet.key === entry.key),
  })).filter((entry) => entry.facet && entry.facet.values.length > 0)

  const patch = (change: Partial<SearchFilters>) => onChange({ ...filters, ...change })

  const toggle = (facetKey: string, value: string) => {
    if (facetKey === 'month') {
      patch({ month: filters.month === Number(value) ? undefined : Number(value) })
      return
    }
    if (facetKey === 'climate') {
      patch({ climate: filters.climate === value ? undefined : (value as Climate) })
      return
    }
    const field = facetKey as 'destination' | 'theme' | 'activity' | 'audience'
    const next: SearchFilters = { ...filters }
    next[field] = filters[field] === value ? undefined : value
    onChange(next)
  }

  const selectedIn = (facetKey: string) => (value: FacetValue) => {
    if (facetKey === 'month') return filters.month === Number(value.value)
    if (facetKey === 'climate') return filters.climate === value.value
    const field = facetKey as 'destination' | 'theme' | 'activity' | 'audience'
    return filters[field] === value.value
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold tracking-tight">Filters</h2>
        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="cursor-pointer text-xs font-semibold text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Clear all ({active})
          </button>
        )}
      </div>

      {lists.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No trips left to count. Clear a filter to bring the counts back.
        </p>
      )}

      {lists.map((entry) => (
        <FacetList
          key={entry.key}
          facet={entry.facet as Facet}
          limit={entry.limit}
          isSelected={selectedIn(entry.key)}
          onToggle={(value) => toggle(entry.key, value)}
        />
      ))}

      <section className="border-b pb-5">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Trip length
        </h3>
        <Slider
          label="At least"
          min={DURATION_MIN}
          max={DURATION_MAX}
          value={filters.minDuration ?? DURATION_MIN}
          onChange={(value) =>
            patch({
              minDuration: value === DURATION_MIN ? undefined : value,
              maxDuration:
                filters.maxDuration !== undefined && filters.maxDuration < value
                  ? value
                  : filters.maxDuration,
            })
          }
          format={(value) => (value === DURATION_MIN ? 'Any' : `${value} days`)}
        />
        <Slider
          label="At most"
          min={DURATION_MIN}
          max={DURATION_MAX}
          value={filters.maxDuration ?? DURATION_MAX}
          onChange={(value) =>
            patch({
              maxDuration: value === DURATION_MAX ? undefined : value,
              minDuration:
                filters.minDuration !== undefined && filters.minDuration > value
                  ? value
                  : filters.minDuration,
            })
          }
          format={(value) => (value === DURATION_MAX ? 'Any' : `${value} days`)}
        />
      </section>

      <section className="border-b pb-5">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Budget
        </h3>
        <Slider
          label="Max price per person"
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          value={filters.maxPrice ?? PRICE_MAX}
          onChange={(value) => patch({ maxPrice: value >= PRICE_MAX ? undefined : value })}
          format={(value) => (value >= PRICE_MAX ? 'Any price' : money(value))}
        />
      </section>

      <section className="flex flex-col gap-1">
        <Switch
          label="Direct flights only"
          checked={filters.directOnly ?? false}
          onChange={(checked) => patch({ directOnly: checked ? true : undefined })}
        />
        <Switch
          label="Available departures only"
          checked={filters.availableOnly ?? false}
          onChange={(checked) => patch({ availableOnly: checked ? true : undefined })}
        />
      </section>
    </div>
  )
}
