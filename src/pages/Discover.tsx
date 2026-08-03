import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Compass, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import type { Place } from '../types'
import { api } from '../lib/api'
import type { Coords } from '../lib/geo'
import { milesBetween } from '../lib/geo'
import { usePageMeta } from '../lib/meta'
import { cn } from '../lib/utils'
import { getStoredOrigin, setStoredOrigin } from '../lib/originStore'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { Empty } from '../components/ui/empty'
import { LocationField } from '../components/discover/LocationField'
import { MAX_PINS } from '../components/discover/constants'
import { PlaceRail } from '../components/discover/PlaceRail'
import { PlaceSheet } from '../components/discover/PlaceSheet'
import { RadiusControl } from '../components/discover/RadiusControl'

// mapbox-gl is a heavy dependency (~700 kB gzip) that only this page needs, so
// it loads as its own chunk instead of sitting in every route's bundle.
const MapPanel = lazy(() => import('../components/discover/MapPanel'))

const RAILS: { category: Place['category']; title: string; nothing: string }[] = [
  {
    category: 'things-to-do',
    title: 'Things To Do',
    nothing: 'No museums, palaces or guided tours are indexed',
  },
  { category: 'restaurants', title: 'Restaurants', nothing: 'No restaurants are indexed' },
  { category: 'stays', title: 'Stays', nothing: 'No hotels or guesthouses are indexed' },
]

export function Discover() {
  usePageMeta(
    'Location discovery — TravelIQ',
    'Things to do, restaurants and stays around your destination, with map pins that follow the list.',
  )

  const [where, setWhere] = useState('Jaipur')
  const [query, setQuery] = useState('Jaipur')
  const [radius, setRadius] = useState(25)
  // The assistant chat can also collect a shared location — reusing it here
  // means granting it once (in either place) covers both.
  const [origin, setOrigin] = useState<Coords | null>(() => getStoredOrigin())
  const [locating, setLocating] = useState(false)
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const [active, setActive] = useState<Place | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(where.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [where])

  // Radius and a device origin re-run this because the backend narrows /places by
  // radius; until the typed client carries that parameter the same narrowing is
  // applied below, so the rails, the pins and the count always agree.
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    Promise.all(RAILS.map((rail) => api.places({ q: query, category: rail.category })))
      .then((groups) => {
        if (cancelled) return
        setPlaces(groups.flat())
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, radius, origin, attempt])

  const near = useMemo(() => {
    if (!places) return []
    const measured = origin
      ? places.map((p) => ({
          ...p,
          distanceMiles: Math.round(milesBetween(origin, p) * 10) / 10,
        }))
      : places
    return measured
      .filter((p) => p.distanceMiles <= radius)
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
  }, [places, origin, radius])

  const outsideRadius = (places?.length ?? 0) - near.length
  const pinAt = active ? near.findIndex((p) => p.id === active.id) : -1
  const detail = pinAt >= 0 ? near[pinAt] : active

  function toggleSave(id: string) {
    const wasSaved = savedIds.has(id)
    setSavedIds((current) => {
      const next = new Set(current)
      if (wasSaved) next.delete(id)
      else next.add(id)
      return next
    })
    const place = near.find((p) => p.id === id)
    if (!wasSaved && place) {
      toast.success(`Saved ${place.name}`, {
        description: 'Collections are held in memory until saved_items is wired up.',
      })
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      toast.error('This browser will not share a location', {
        description: 'Type a town or city instead.',
      })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const here = { lat: position.coords.latitude, lng: position.coords.longitude }
        setOrigin(here)
        setStoredOrigin(here)
        toast.success('Using your device location', {
          description: 'Distances are measured from where you are.',
        })
      },
      (error) => {
        setLocating(false)
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied'
            : 'Could not read your location',
          { description: 'Still showing places around the location you searched.' },
        )
      },
      { timeout: 8000, maximumAge: 300000 },
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      <div className="min-w-0 px-6 py-10 md:px-10">
        <header className="max-w-xl">
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Location discovery</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            Name a place and TravelIQ gathers what is worth doing, where to eat and where to sleep
            from a single index of points of interest. Every numbered pin on the map is a card in
            these rails.
          </p>
        </header>

        <div className="mt-7 space-y-3">
          <LocationField
            value={where}
            onChange={setWhere}
            locating={locating}
            onNearMe={locateMe}
          />
          <div className="flex flex-wrap items-center gap-3">
            <RadiusControl value={radius} onChange={setRadius} />
            {origin && (
              <Chip
                label={`Near you · ${origin.lat.toFixed(2)}, ${origin.lng.toFixed(2)}`}
                icon={<LocateFixed />}
                onRemove={() => setOrigin(null)}
              />
            )}
          </div>
          <div className="min-h-4">
            {places && (
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{near.length}</span>{' '}
                places within <span className="tabular-nums">{radius}</span> miles of{' '}
                {origin ? 'your device location' : query || 'the whole index'}
                {outsideRadius > 0 && (
                  <>
                    {' · '}
                    <span className="tabular-nums">{outsideRadius}</span> further out
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        {failed ? (
          <Empty
            className="mt-10"
            icon={<Compass />}
            title="Places could not be loaded"
            body="The place index did not answer. Try again, or search a different location."
            action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
          />
        ) : (
          <div
            aria-busy={busy}
            className={cn(
              'mt-10 space-y-10 transition-opacity',
              busy && places !== null && 'opacity-60',
            )}
          >
            {RAILS.map((rail) => (
              <PlaceRail
                key={rail.category}
                title={rail.title}
                places={near.filter((p) => p.category === rail.category)}
                loading={places === null}
                emptyBody={`${rail.nothing} within ${radius} miles of this location. Widen the radius, or search somewhere else.`}
                savedIds={savedIds}
                hoveredId={hovered}
                onToggleSave={toggleSave}
                onOpen={setActive}
                onHover={setHovered}
              />
            ))}
          </div>
        )}
      </div>

      <aside className="relative hidden bg-accent lg:block">
        <div className="sticky top-0 h-screen">
          <Suspense fallback={<div className="h-full w-full animate-pulse bg-accent" />}>
            <MapPanel
              places={near}
              origin={origin}
              radiusMiles={radius}
              hoveredId={hovered}
              onHover={setHovered}
              onSelect={setActive}
            />
          </Suspense>
        </div>
      </aside>

      <PlaceSheet
        place={detail}
        pinIndex={pinAt >= 0 && pinAt < MAX_PINS ? pinAt + 1 : undefined}
        saved={detail !== null && savedIds.has(detail.id)}
        onToggleSave={toggleSave}
        onClose={() => setActive(null)}
      />
    </div>
  )
}
