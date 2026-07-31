import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CircleAlert, SlidersHorizontal } from 'lucide-react'
import type { Climate, SearchFilters, SearchResponse, SearchResult } from '../types'
import { api, usingMockData } from '../lib/api'
import { usePageMeta } from '../lib/meta'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Empty } from '../components/ui/empty'
import { Sheet } from '../components/ui/sheet'
import { SearchBar } from '../components/search/SearchBar'
import { ParsedChips } from '../components/search/ParsedChips'
import { FacetRail, countFilters } from '../components/search/FacetRail'
import { ResultGrid, ResultGridSkeleton } from '../components/search/ResultGrid'
import { SortSelect, sortLabel } from '../components/search/SortSelect'
import { Pagination } from '../components/search/Pagination'
import { ZeroResults, type RelaxAction } from '../components/search/ZeroResults'
import {
  CHIP_FILTER_FIELDS,
  describeFilters,
  describeParsed,
  stripFromQuery,
  type ParsedChipKey,
} from '../components/search/constraints'

const PAGE_SIZE = 12
const QUERY_DEBOUNCE_MS = 250
const CLIMATES: Climate[] = ['warm', 'mild', 'cold']

interface SearchState {
  query: string
  filters: SearchFilters
  sort: string
  page: number
}

function readNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function readFilters(params: URLSearchParams): SearchFilters {
  const climate = params.get('climate')
  return {
    destination: params.get('destination') ?? undefined,
    theme: params.get('theme') ?? undefined,
    activity: params.get('activity') ?? undefined,
    audience: params.get('audience') ?? undefined,
    month: readNumber(params, 'month'),
    minDuration: readNumber(params, 'minDuration'),
    maxDuration: readNumber(params, 'maxDuration'),
    maxPrice: readNumber(params, 'maxPrice'),
    climate: CLIMATES.find((value) => value === climate),
    directOnly: params.get('direct') === '1' ? true : undefined,
    availableOnly: params.get('available') === '1' ? true : undefined,
  }
}

function stateFromParams(params: URLSearchParams): SearchState {
  return {
    query: params.get('q') ?? '',
    filters: readFilters(params),
    sort: params.get('sort') ?? 'relevance',
    page: Math.max(1, readNumber(params, 'page') ?? 1),
  }
}

// Written by hand rather than by mutating the current params, so a shared link always reads in
// the same order: /search?q=...&destination=iceland&month=11&maxPrice=1200&sort=price-asc&page=2
function buildParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams()
  const { query, filters, sort, page } = state
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }

  set('q', query.trim())
  set('destination', filters.destination)
  set('theme', filters.theme)
  set('activity', filters.activity)
  set('audience', filters.audience)
  set('month', filters.month)
  set('minDuration', filters.minDuration)
  set('maxDuration', filters.maxDuration)
  set('maxPrice', filters.maxPrice)
  set('climate', filters.climate)
  if (filters.directOnly) params.set('direct', '1')
  if (filters.availableOnly) params.set('available', '1')
  if (sort !== 'relevance') params.set('sort', sort)
  if (page > 1) params.set('page', String(page))
  return params
}

function withoutFields(filters: SearchFilters, fields: (keyof SearchFilters)[]): SearchFilters {
  const next = { ...filters }
  for (const field of fields) delete next[field]
  return next
}

export function Search() {
  const [params, setParams] = useSearchParams()
  const { query, filters, sort, page } = useMemo(() => stateFromParams(params), [params])
  const paramKey = params.toString()

  usePageMeta(
    query ? `${query} — TravelIQ search` : 'Smart search — TravelIQ',
    'Describe the trip you want in one sentence. TravelIQ turns it into filters you can see, adjust and share.',
  )

  const [text, setText] = useState(query)
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)

  const requestId = useRef(0)
  const debounce = useRef<number | undefined>(undefined)
  const lastPage = useRef(page)
  const resultsTop = useRef<HTMLDivElement>(null)

  // A deep link, a back navigation or a removed chip all rewrite the sentence for us.
  useEffect(() => setText(query), [query])

  useEffect(() => () => window.clearTimeout(debounce.current), [])

  // The sentence, every filter, the sort and the page all live in the URL, so the serialised
  // query string is the only dependency this needs.
  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    api
      .search({ query, filters, page, pageSize: PAGE_SIZE, sort })
      .then((result) => {
        // Guards against out-of-order responses when the user types quickly.
        if (id !== requestId.current) return
        setResponse(result)
        setFailed(false)
        setLoading(false)
      })
      .catch(() => {
        if (id !== requestId.current) return
        setFailed(true)
        setLoading(false)
      })
  }, [paramKey, reloads])

  // One impression per rendered page of results; searchId changes with every response.
  useEffect(() => {
    if (!response || response.results.length === 0) return
    void api.event({ type: 'impression', searchId: response.searchId, position: response.page })
  }, [response?.searchId])

  useEffect(() => {
    if (lastPage.current === page) return
    lastPage.current = page
    resultsTop.current?.scrollIntoView({ block: 'start' })
  }, [page])

  const apply = (
    change: (current: SearchState) => Partial<SearchState>,
    mode: 'push' | 'replace',
  ) => {
    setParams(
      (prev) => {
        const current = stateFromParams(prev)
        // Anything other than paging sends the traveller back to page one.
        return buildParams({ ...current, page: 1, ...change(current) })
      },
      { replace: mode === 'replace' },
    )
  }

  const onQueryChange = (next: string) => {
    setText(next)
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(
      () => apply(() => ({ query: next }), 'replace'),
      QUERY_DEBOUNCE_MS,
    )
  }

  const onQuerySubmit = (next: string) => {
    window.clearTimeout(debounce.current)
    setText(next)
    apply(() => ({ query: next }), 'push')
  }

  const onFilters = (next: SearchFilters) => apply(() => ({ filters: next }), 'push')

  const removeParsedChip = (key: ParsedChipKey) => {
    const parsed = response?.parsed
    if (!parsed) return
    apply(
      (current) => ({
        query: stripFromQuery(current.query, key, parsed),
        filters: withoutFields(current.filters, CHIP_FILTER_FIELDS[key]),
      }),
      'push',
    )
  }

  const onSelect = (result: SearchResult, position: number) => {
    void api.event({
      type: 'click',
      searchId: response?.searchId,
      tripId: result.trip.id,
      position,
    })
  }

  const hrefFor = (target: number) =>
    `/search?${buildParams({ query, filters, sort, page: target })}`

  const total = response?.total ?? 0
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const last = Math.min(total, page * PAGE_SIZE)
  const activeFilters = countFilters(filters)
  const showSkeletons = response === null && loading

  // Zero results is nearly always one constraint too many, so every live constraint — read from
  // the sentence or chosen in the rail — becomes a one-click way out.
  const relaxations: RelaxAction[] = []
  if (response && response.total === 0) {
    const parsedChips = describeParsed(response.parsed)
    const covered = new Set(parsedChips.flatMap((chip) => CHIP_FILTER_FIELDS[chip.key]))
    for (const chip of parsedChips) {
      relaxations.push({
        id: `parsed-${chip.key}`,
        label: `Ignore ${chip.label}`,
        onApply: () => removeParsedChip(chip.key),
      })
    }
    for (const chip of describeFilters(filters)) {
      if (chip.fields.every((field) => covered.has(field))) continue
      relaxations.push({
        id: `filter-${chip.fields.join('-')}`,
        label: `Clear ${chip.label}`,
        onApply: () => onFilters(withoutFields(filters, chip.fields)),
      })
    }
  }

  const rail = (
    <FacetRail facets={response?.facets ?? []} filters={filters} onChange={onFilters} />
  )

  return (
    <div className="min-h-full bg-panel">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-8 md:px-10 md:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Search the way you talk
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            One sentence is enough. TravelIQ reads it into filters you can see, remove and share —
            and says so plainly when it has to fall back to keyword matching.
          </p>
        </header>

        <div className="mt-6 max-w-4xl">
          <SearchBar
            value={text}
            onChange={onQueryChange}
            onSubmit={onQuerySubmit}
            busy={loading}
          />
        </div>

        {response && (
          <div className="mt-4 max-w-4xl">
            <ParsedChips
              parsed={response.parsed}
              mode={response.mode}
              onRemove={removeParsedChip}
            />
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[16.5rem_1fr] lg:gap-10">
          <aside className="hidden lg:block">
            <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-2xl border bg-card p-5 scrollbar-thin">
              {rail}
            </div>
          </aside>

          <div className="min-w-0">
            <div
              ref={resultsTop}
              className="flex scroll-mt-6 flex-wrap items-center justify-between gap-3 pb-5"
            >
              <p className="text-sm text-muted-foreground">
                {total === 0 ? (
                  'No trips'
                ) : (
                  <>
                    <span className="font-semibold tabular-nums text-foreground">
                      {first}–{last}
                    </span>{' '}
                    of <span className="tabular-nums">{total}</span> trips
                  </>
                )}
                {response && (
                  <>
                    {' · answered in '}
                    <span className="tabular-nums">{response.tookMs} ms</span>
                    {` · sorted by ${sortLabel(sort).toLowerCase()}`}
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
                {usingMockData() && (
                  <span title="The FastAPI backend is unreachable, so these results come from the seeded catalogue in src/mock. Start the backend for live retrieval.">
                    <Badge tone="warning">Demo data</Badge>
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSheetOpen(true)}
                  className="lg:hidden"
                >
                  <SlidersHorizontal />
                  {activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
                </Button>
                <SortSelect value={sort} onChange={(next) => apply(() => ({ sort: next }), 'push')} />
              </div>
            </div>

            {failed && !response ? (
              <Empty
                icon={<CircleAlert />}
                title="Search is unavailable"
                body="Neither the TravelIQ service nor the local demo catalogue answered. Check the backend is running, then try again."
                action={<Button onClick={() => setReloads((n) => n + 1)}>Try again</Button>}
              />
            ) : showSkeletons ? (
              <ResultGridSkeleton />
            ) : response && response.total === 0 ? (
              <ZeroResults
                query={query}
                parsed={response.parsed}
                suggestions={response.suggestions ?? []}
                relaxations={relaxations}
                onSuggestion={onQuerySubmit}
              />
            ) : (
              response && (
                <>
                  <ResultGrid
                    results={response.results}
                    page={response.page}
                    pageSize={response.pageSize}
                    dimmed={loading}
                    onSelect={onSelect}
                  />
                  <div className="pt-8">
                    <Pagination
                      page={page}
                      pageSize={PAGE_SIZE}
                      total={total}
                      hrefFor={hrefFor}
                    />
                  </div>
                </>
              )
            )}
          </div>
        </div>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} side="bottom" title="Filters">
        <div className="px-5 pb-8 pt-4">{rail}</div>
      </Sheet>
    </div>
  )
}
