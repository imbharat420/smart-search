import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Place } from '../../types'
import { Empty } from '../ui/empty'
import { Skeleton } from '../ui/skeleton'
import { PlaceCard } from './PlaceCard'

interface PlaceRailProps {
  title: string
  places: Place[]
  loading: boolean
  emptyBody: string
  savedIds: ReadonlySet<string>
  hoveredId: string | null
  onToggleSave: (id: string) => void
  onOpen: (place: Place) => void
  onHover: (id: string | null) => void
}

const NUDGE =
  'flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40'

export function PlaceRail({
  title,
  places,
  loading,
  emptyBody,
  savedIds,
  hoveredId,
  onToggleSave,
  onOpen,
  onHover,
}: PlaceRailProps) {
  const track = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const sync = useCallback(() => {
    const el = track.current
    if (!el) return
    const furthest = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= furthest - 1)
  }, [])

  // A narrower window, or fewer cards after a radius change, can remove the overflow entirely.
  useEffect(() => {
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [sync, places.length, loading])

  const nudge = (direction: 1 | -1) => {
    const el = track.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(220, el.clientWidth * 0.75), behavior: 'smooth' })
  }

  const showControls = !loading && (!atStart || !atEnd)

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="border-b-2 border-[var(--primary-strong)]/70 pb-1.5 pr-8 text-xl font-bold tracking-tight">
            {title}
          </h2>
          {!loading && places.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">{places.length}</span>
          )}
        </div>
        {showControls && (
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Scroll</span>
            <button
              type="button"
              onClick={() => nudge(-1)}
              disabled={atStart}
              aria-label={`Scroll ${title} back`}
              className={NUDGE}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              disabled={atEnd}
              aria-label={`Scroll ${title} forward`}
              className={NUDGE}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex gap-3 pb-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-48 shrink-0 overflow-hidden rounded-2xl border bg-card">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : places.length === 0 ? (
        <Empty title="Nothing in range" body={emptyBody} className="py-10" />
      ) : (
        <div ref={track} onScroll={sync} className="scrollbar-thin flex gap-3 overflow-x-auto pb-3">
          {places.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              saved={savedIds.has(place.id)}
              highlighted={hoveredId === place.id}
              onToggleSave={onToggleSave}
              onOpen={onOpen}
              onHover={onHover}
            />
          ))}
        </div>
      )}
    </section>
  )
}
