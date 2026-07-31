import { useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { AdminConfig, SearchableField } from '../../types'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Select } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { AdminSection } from './AdminSection'

const FIELD_LABELS: Record<string, string> = {
  title: 'Trip title',
  destination: 'Destination and country',
  themes: 'Themes',
  activities: 'Activities',
  summary: 'Summary',
  description: 'Full description',
  badges: 'Badges',
  supplier: 'Supplier name',
}

// The filter keys a merchandiser may expose on /search, in the order the facet rail reads them.
const FILTERS: { key: string; label: string }[] = [
  { key: 'destination', label: 'Destination' },
  { key: 'theme', label: 'Theme' },
  { key: 'activity', label: 'Activity' },
  { key: 'month', label: 'Departure month' },
  { key: 'minDuration', label: 'Minimum nights' },
  { key: 'maxDuration', label: 'Maximum nights' },
  { key: 'maxPrice', label: 'Budget ceiling' },
  { key: 'climate', label: 'Climate' },
  { key: 'directOnly', label: 'Direct flights only' },
  { key: 'availableOnly', label: 'Available departures only' },
  { key: 'audience', label: 'Party type' },
]

const PAGE_SIZES = [
  { value: '6', label: '6 per page' },
  { value: '9', label: '9 per page' },
  { value: '12', label: '12 per page' },
  { value: '18', label: '18 per page' },
  { value: '24', label: '24 per page' },
]

function countChanges(draft: AdminConfig, saved: AdminConfig): number {
  let changed = 0

  draft.searchableFields.forEach((field, i) => {
    const before = saved.searchableFields[i]
    if (!before) return
    if (field.enabled !== before.enabled) changed += 1
    if (field.weight !== before.weight) changed += 1
  })

  changed += FILTERS.filter(
    (filter) =>
      draft.enabledFilters.includes(filter.key) !== saved.enabledFilters.includes(filter.key),
  ).length

  if (draft.resultsPerPage !== saved.resultsPerPage) changed += 1
  if (draft.fallbackToLexical !== saved.fallbackToLexical) changed += 1

  return changed
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 [&_svg]:size-3.5 [&_svg]:shrink-0',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {active ? <Check /> : <Plus />}
      {label}
    </button>
  )
}

function SetupSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((block) => (
        <div key={block} className="rounded-2xl border bg-card p-5">
          <Skeleton className="h-5 w-56" />
          <div className="mt-6 space-y-4">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function SearchSetup() {
  const [saved, setSaved] = useState<AdminConfig | null>(null)
  const [draft, setDraft] = useState<AdminConfig | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.adminConfig().then((cfg) => {
      if (cancelled) return
      setSaved(cfg)
      setDraft(cfg)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!draft || !saved) return <SetupSkeleton />

  const changes = countChanges(draft, saved)

  const patchField = (index: number, patch: Partial<SearchableField>) =>
    setDraft({
      ...draft,
      searchableFields: draft.searchableFields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    })

  const toggleFilter = (key: string) =>
    setDraft({
      ...draft,
      enabledFilters: draft.enabledFilters.includes(key)
        ? draft.enabledFilters.filter((k) => k !== key)
        : [...draft.enabledFilters, key],
    })

  const save = async () => {
    setSaving(true)
    const next = await api.saveAdminConfig(draft)
    setSaved(next)
    setDraft(next)
    setSaving(false)
    toast.success('Search setup saved', {
      description: 'The ranking layer reads the new weights on the next search.',
    })
  }

  return (
    <>
      <AdminSection
        title="Searchable fields"
        hint="Weight is a multiplier on how much a match in that field contributes to the relevance score. Turn a field off and it is skipped entirely — its weight is kept so you can bring it back."
        bodyClassName="px-5 py-2"
      >
        <ul>
          {draft.searchableFields.map((field, i) => (
            <li
              key={field.field}
              className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-center sm:gap-10"
            >
              <Switch
                label={FIELD_LABELS[field.field] ?? field.field}
                checked={field.enabled}
                onChange={(enabled) => patchField(i, { enabled })}
              />
              <Slider
                label="Weight"
                min={0}
                max={1}
                step={0.05}
                value={field.weight}
                onChange={(weight) => patchField(i, { weight })}
                format={(value) => value.toFixed(2)}
                className={field.enabled ? undefined : 'opacity-45'}
              />
            </li>
          ))}
        </ul>
      </AdminSection>

      <AdminSection
        title="Filters on the results page"
        hint="Only the filters selected here appear in the facet rail. Everything else stays available to the natural-language layer, which can still infer it from the sentence a traveller types."
      >
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <FilterToggle
              key={filter.key}
              label={filter.label}
              active={draft.enabledFilters.includes(filter.key)}
              onClick={() => toggleFilter(filter.key)}
            />
          ))}
        </div>
      </AdminSection>

      <AdminSection
        title="Results and resilience"
        hint="Paging is numbered rather than infinite so every page of results stays crawlable."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <Select
            label="Results per page"
            value={String(draft.resultsPerPage)}
            onChange={(value) => setDraft({ ...draft, resultsPerPage: Number(value) })}
            options={PAGE_SIZES}
            className="w-full justify-between"
          />
          <div>
            <Switch
              label="Fall back to keyword search"
              checked={draft.fallbackToLexical}
              onChange={(fallbackToLexical) => setDraft({ ...draft, fallbackToLexical })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              When the embedding layer is slow or unavailable, answer from the lexical index instead
              of showing an error. Turning this off means a provider outage returns nothing.
            </p>
          </div>
        </div>
      </AdminSection>

      {changes > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-3 shadow-md">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{changes}</span> unsaved{' '}
            {changes === 1 ? 'change' : 'changes'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(saved)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
