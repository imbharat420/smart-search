import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { Place } from '../../types'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

// Mapbox takes the pin colour as a URL parameter, and a URL cannot carry a CSS
// variable — this is the one literal colour in src/**. Keep it level with --primary.
const PIN_HEX = 'ffb400'

// Shown when the static tile request fails, which it does until a real token is set.
const FALLBACK_MAP = 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&q=80'

// The static endpoint accepts 15 overlays and labels 0-99; 12 keeps the URL readable.
export const MAX_PINS = 12

interface Viewport {
  lat: number
  lng: number
  zoom: number
}

interface MapPanelProps {
  places: Place[]
  origin: { lat: number; lng: number } | null
  radiusMiles: number
  hoveredId: string | null
  onHover: (id: string | null) => void
  onSelect: (place: Place) => void
}

function viewport(places: Place[], origin: { lat: number; lng: number } | null): Viewport {
  const lats = places.map((p) => p.lat)
  const lngs = places.map((p) => p.lng)
  const lat = origin?.lat ?? (Math.min(...lats) + Math.max(...lats)) / 2
  const lng = origin?.lng ?? (Math.min(...lngs) + Math.max(...lngs)) / 2

  // Each zoom level halves the visible span, and level 0 spans 360 degrees. The 0.02
  // floor stops a single pin from zooming to street level.
  const span = Math.max(
    Math.max(...lats) - Math.min(...lats),
    Math.max(...lngs) - Math.min(...lngs),
    0.02,
  )
  const zoom = Math.min(14, Math.max(8, Math.floor(Math.log2(360 / span)) - 1))
  return { lat, lng, zoom }
}

function staticMapUrl(places: Place[], view: Viewport): string {
  const token = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? 'pk.demo'
  const pins = places.map(
    (p, i) => `pin-s-${i + 1}+${PIN_HEX}(${p.lng.toFixed(4)},${p.lat.toFixed(4)})`,
  )
  const overlay = pins.length > 0 ? `${pins.join(',')}/` : ''
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}${view.lng.toFixed(4)},${view.lat.toFixed(4)},${view.zoom}/900x1280@2x?access_token=${token}`
}

export function MapPanel({
  places,
  origin,
  radiusMiles,
  hoveredId,
  onHover,
  onSelect,
}: MapPanelProps) {
  const [tilesFailed, setTilesFailed] = useState(false)

  const pins = places.slice(0, MAX_PINS)
  const view = pins.length > 0 || origin ? viewport(pins, origin) : null
  const src = view && !tilesFailed ? staticMapUrl(pins, view) : FALLBACK_MAP

  return (
    <div className="relative h-full w-full overflow-hidden bg-accent">
      <img
        src={src}
        alt={
          pins.length > 0
            ? `Map with ${pins.length} numbered pins for the places listed`
            : 'Map of the search area'
        }
        onError={() => setTilesFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-background/20" />

      <div className="absolute left-4 top-4 max-w-[15rem] rounded-2xl border bg-card/95 px-4 py-3 shadow-sm">
        <p className="text-xs font-semibold">Static map preview</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Pins are built from the coordinates of the places listed. A pannable map is a production
          integration; set VITE_MAPBOX_TOKEN to render the real tiles.
        </p>
      </div>

      {view && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="absolute right-4 top-4 shadow-sm"
        >
          <a
            href={`https://www.google.com/maps/@${view.lat.toFixed(4)},${view.lng.toFixed(4)},${view.zoom}z`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Maps
            <ExternalLink />
          </a>
        </Button>
      )}

      <div className="absolute inset-x-4 bottom-4 overflow-hidden rounded-2xl border bg-card/95 shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <p className="text-xs font-semibold">On the map</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {places.length} within {radiusMiles} mi
            {places.length > MAX_PINS && ` · first ${MAX_PINS} pinned`}
          </p>
        </div>
        {pins.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            Nothing to pin inside this radius. Widen it, or search another location.
          </p>
        ) : (
          <ul className="scrollbar-thin max-h-64 divide-y overflow-y-auto">
            {pins.map((place, i) => (
              <li key={place.id}>
                <button
                  type="button"
                  onMouseEnter={() => onHover(place.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(place.id)}
                  onBlur={() => onHover(null)}
                  onClick={() => onSelect(place)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent',
                    hoveredId === place.id && 'bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold tabular-nums text-primary-foreground',
                      hoveredId === place.id && 'ring-2 ring-foreground/50',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{place.name}</span>
                    <span className="block truncate text-[11px] capitalize text-muted-foreground">
                      {place.type} · <span className="tabular-nums">{place.distanceMiles}</span> mi
                    </span>
                  </span>
                  {place.price && (
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                      {place.price}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
