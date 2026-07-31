import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Compass, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../lib/api'
import { usePageMeta } from '../lib/meta'
import type { Guide } from '../types'
import { Button } from '../components/ui/button'
import { Empty } from '../components/ui/empty'
import { SearchField } from '../components/ui/input'
import { SkeletonCard } from '../components/ui/skeleton'
import { GuideCard } from '../components/inspiration/GuideCard'
import { GuideFilterSheet } from '../components/inspiration/GuideFilterSheet'
import { GuideTagRow } from '../components/inspiration/GuideTagRow'
import type { DurationBand, GuideFilters } from '../components/inspiration/guideFilters'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyGuideFilters,
  authorsOf,
  searchGuides,
  tagsByFrequency,
  toggleTag,
} from '../components/inspiration/guideFilters'
import { useSavedGuides } from '../components/inspiration/useSavedGuides'

// The row shows the themes that earn their place; the filter sheet lists them all.
const ROW_TAG_LIMIT = 8

export function Inspiration() {
  usePageMeta(
    'Inspiration gallery — TravelIQ',
    'Curated travel guides from creators around the world. Filter by theme, length or author, then turn any guide into a live search.',
  )

  const [params, setParams] = useSearchParams()
  const [guides, setGuides] = useState<Guide[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [duration, setDuration] = useState<DurationBand>('any')
  const [author, setAuthor] = useState('')
  const [savedOnly, setSavedOnly] = useState(false)
  const { saved, toggle } = useSavedGuides()

  useEffect(() => {
    let cancelled = false
    // api.guides() degrades to the seeded catalogue instead of rejecting, so there
    // is no error branch to render here.
    api.guides().then((data) => {
      if (cancelled) return
      setGuides(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Tag selection is shareable, so the URL owns it rather than component state.
  // The memo watches the joined string because getAll() returns a fresh array each render.
  const tagParam = params.getAll('tag').join('|')
  const activeTags = useMemo(() => (tagParam ? tagParam.split('|') : []), [tagParam])

  const setTagParams = useCallback(
    (tags: string[]) => {
      const next = new URLSearchParams(params)
      next.delete('tag')
      for (const tag of tags) next.append('tag', tag)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const filters = useMemo<GuideFilters>(
    () => ({ tags: activeTags, duration, author, savedOnly }),
    [activeTags, duration, author, savedOnly],
  )

  const commitFilters = useCallback(
    (next: GuideFilters) => {
      setDuration(next.duration)
      setAuthor(next.author)
      setSavedOnly(next.savedOnly)
      setTagParams(next.tags)
    },
    [setTagParams],
  )

  const clearAll = () => {
    setQuery('')
    commitFilters(EMPTY_FILTERS)
  }

  const searched = useMemo(() => searchGuides(guides, query), [guides, query])
  const results = useMemo(() => applyGuideFilters(searched, filters, saved), [searched, filters, saved])
  const allTags = useMemo(() => tagsByFrequency(guides), [guides])
  const authors = useMemo(() => authorsOf(guides), [guides])

  // Counts come from the text-matched set so the row reads as a facet of the
  // search rather than of itself.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const guide of searched) {
      for (const tag of guide.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return counts
  }, [searched])

  const rowTags = useMemo(() => {
    const top = allTags.slice(0, ROW_TAG_LIMIT)
    return [...top, ...activeTags.filter((tag) => !top.includes(tag))]
  }, [allTags, activeTags])

  const activeCount = activeFilterCount(filters)
  const savedHere = guides.filter((guide) => saved.includes(guide.id)).length
  const countLine = loading
    ? 'Loading guides'
    : `Showing ${results.length} of ${guides.length} guides${savedHere > 0 ? ` · ${savedHere} saved` : ''}`

  return (
    <div className="min-h-full bg-panel">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-8 md:px-10 md:py-12">
        <header className="space-y-5">
          <div className="space-y-3">
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
              Inspiration gallery
            </h1>
            <p className="max-w-2xl text-[15px] text-muted-foreground">
              Guides written by the people who travelled them. Narrow the collection by theme,
              length or author, then turn any guide into a live search of the TravelIQ catalogue.
            </p>
          </div>

          <div className="flex gap-3">
            <SearchField
              value={query}
              onChange={setQuery}
              className="flex-1"
              aria-label="Search guides"
              placeholder="Search locations, guides or themes"
              trailing={
                query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : undefined
              }
            />
            <Button
              variant="outline"
              size="lg"
              onClick={() => setSheetOpen(true)}
              className="shrink-0 px-5"
            >
              <SlidersHorizontal />
              Filter
              {activeCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </div>

          {!loading && rowTags.length > 0 && (
            <GuideTagRow
              tags={rowTags}
              active={activeTags}
              counts={tagCounts}
              onToggle={(tag) => setTagParams(toggleTag(activeTags, tag))}
              onClear={() => setTagParams([])}
            />
          )}
        </header>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight">Featured guides</h2>
            <div className="flex items-center gap-3">
              <p aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
                {countLine}
              </p>
              {(query !== '' || activeCount > 0) && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="cursor-pointer text-xs font-semibold text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : results.length === 0 ? (
            <Empty
              icon={<Compass />}
              title="No guides match those filters"
              body="Try a single theme, a wider length band, or clear the search and browse the whole collection."
              action={
                <Button variant="outline" onClick={clearAll}>
                  Clear all filters
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((guide) => (
                <GuideCard
                  key={guide.id}
                  guide={guide}
                  saved={saved.includes(guide.id)}
                  onToggleSave={() => toggle(guide.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <GuideFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        tags={allTags}
        authors={authors}
        filters={filters}
        matchCount={results.length}
        onApply={commitFilters}
      />
    </div>
  )
}
