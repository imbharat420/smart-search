import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ExternalLink } from 'lucide-react'
import type { Place } from '../../types'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { MAX_PINS } from './constants'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
// A demo/placeholder token renders nothing but tile-load errors, so the static
// fallback below is what a reader without a real token actually sees.
const TOKEN_IS_USABLE = !!TOKEN && !TOKEN.startsWith('pk.demo')

if (TOKEN_IS_USABLE) mapboxgl.accessToken = TOKEN!

const FALLBACK_MAP = 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&q=80'

interface MapPanelProps {
  places: Place[]
  origin: { lat: number; lng: number } | null
  radiusMiles: number
  hoveredId: string | null
  onHover: (id: string | null) => void
  onSelect: (place: Place) => void
}

function popupHtml(place: Place, index: number): string {
  const bits = [
    `<span style="font-weight:700">${index}. ${place.name}</span>`,
    `<span style="display:block;opacity:0.7;text-transform:capitalize">${place.type} · ${place.distanceMiles} mi</span>`,
  ]
  if (place.price) bits.push(`<span style="display:block;opacity:0.7">${place.price}</span>`)
  return `<div style="font-size:12px;line-height:1.5;font-family:inherit">${bits.join('')}</div>`
}

// Mapbox positions a Marker by writing `transform: translate(...)` onto the
// element passed as `{ element }` — so the hover scale below is applied to an
// inner child instead, never to the root, or it would overwrite Mapbox's own
// positioning transform and the pin would jump to the wrong spot on hover.
function pinElement(index: number): { root: HTMLDivElement; pin: HTMLDivElement } {
  const root = document.createElement('div')
  const pin = document.createElement('div')
  pin.style.cssText = `
    width: 1.5rem; height: 1.5rem; border-radius: 9999px;
    background: var(--primary-strong); color: var(--primary-foreground);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; font-family: inherit;
    box-shadow: 0 1px 4px rgba(0,0,0,0.35); border: 2px solid var(--card);
    cursor: pointer; transition: transform 120ms ease;
  `
  pin.textContent = String(index)
  root.appendChild(pin)
  return { root, pin }
}

function originElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width: 1.1rem; height: 1.1rem; border-radius: 9999px;
    background: var(--periwinkle-ink); border: 3px solid var(--card);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--periwinkle-ink) 25%, transparent),
      0 1px 4px rgba(0,0,0,0.35);
  `
  return el
}

export function MapPanel({
  places,
  origin,
  radiusMiles,
  hoveredId,
  onHover,
  onSelect,
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const popupsRef = useRef<Map<string, mapboxgl.Popup>>(new Map())
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null)

  const pins = places.slice(0, MAX_PINS)

  // Mount once. React StrictMode double-invokes effects in dev, so a stale
  // instance is torn down before a second is ever created.
  useEffect(() => {
    if (!TOKEN_IS_USABLE || !containerRef.current) return

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [0, 20],
      zoom: 1,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current.clear()
      popupsRef.current.clear()
      originMarkerRef.current?.remove()
      originMarkerRef.current = null
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Markers: add/remove to match `pins` without rebuilding ones already on the
  // map, so a hover-driven re-render never flickers an existing pin.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const seen = new Set(pins.map((p) => p.id))
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
        popupsRef.current.delete(id)
      }
    }

    pins.forEach((place, i) => {
      const existing = markersRef.current.get(place.id)
      if (existing) {
        existing.setLngLat([place.lng, place.lat])
        return
      }
      const popup = new mapboxgl.Popup({ offset: 16, closeButton: false, closeOnClick: false })
        .setHTML(popupHtml(place, i + 1))
      const { root } = pinElement(i + 1)
      const marker = new mapboxgl.Marker({ element: root })
        .setLngLat([place.lng, place.lat])
        .setPopup(popup)
        .addTo(map)

      const el = marker.getElement()
      el.addEventListener('mouseenter', () => {
        onHover(place.id)
        marker.togglePopup()
      })
      el.addEventListener('mouseleave', () => {
        onHover(null)
        if (popup.isOpen()) marker.togglePopup()
      })
      el.addEventListener('click', () => onSelect(place))

      markersRef.current.set(place.id, marker)
      popupsRef.current.set(place.id, popup)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins.map((p) => `${p.id}:${p.lat}:${p.lng}`).join('|')])

  // Origin marker, independent of the place pins.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!origin) {
      originMarkerRef.current?.remove()
      originMarkerRef.current = null
      return
    }
    if (originMarkerRef.current) {
      originMarkerRef.current.setLngLat([origin.lng, origin.lat])
    } else {
      originMarkerRef.current = new mapboxgl.Marker({ element: originElement() })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map)
    }
  }, [origin])

  // Fit the view to whatever is now on the map. Keyed on the same coordinate
  // string as the marker effect (not on hover) so panning to read a popup never
  // gets fought by a re-fit.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const points: [number, number][] = pins.map((p) => [p.lng, p.lat])
    if (origin) points.push([origin.lng, origin.lat])

    if (points.length === 0) return
    if (points.length === 1) {
      map.flyTo({ center: points[0], zoom: 12, duration: 800 })
      return
    }
    const bounds = points.reduce(
      (b, point) => b.extend(point),
      new mapboxgl.LngLatBounds(points[0], points[0]),
    )
    map.fitBounds(bounds, { padding: 72, maxZoom: 14, duration: 800 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins.map((p) => `${p.id}:${p.lat}:${p.lng}`).join('|'), origin?.lat, origin?.lng])

  // Hover driven from the place rail: lift the matching pin and show its popup.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      // First child is the visual pin — the root element itself carries
      // Mapbox's own positioning transform and must not be touched here.
      const pin = marker.getElement().firstElementChild as HTMLElement | null
      const popup = popupsRef.current.get(id)
      if (id === hoveredId) {
        if (pin) {
          pin.style.transform = 'scale(1.25)'
          pin.style.zIndex = '10'
        }
        if (popup && !popup.isOpen()) marker.togglePopup()
      } else {
        if (pin) {
          pin.style.transform = ''
          pin.style.zIndex = ''
        }
        if (popup?.isOpen()) marker.togglePopup()
      }
    })
  }, [hoveredId])

  const view =
    pins.length > 0 || origin
      ? { lat: origin?.lat ?? pins[0].lat, lng: origin?.lng ?? pins[0].lng }
      : null

  return (
    <div className="relative h-full w-full overflow-hidden bg-accent">
      {TOKEN_IS_USABLE ? (
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      ) : (
        <>
          <img
            src={FALLBACK_MAP}
            alt="Map of the search area"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-background/20" />
          <div className="absolute left-4 top-4 max-w-[15rem] rounded-2xl border bg-card/95 px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold">Map unavailable</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Set VITE_MAPBOX_TOKEN in .env to render the live map. Places are still listed below.
            </p>
          </div>
        </>
      )}

      {view && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="absolute left-4 top-4 shadow-sm"
        >
          <a
            href={`https://www.google.com/maps/@${view.lat.toFixed(4)},${view.lng.toFixed(4)},14z`}
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

// Default export only so React.lazy (Discover.tsx) can dynamic-import this
// module without pulling mapbox-gl into the main bundle.
export default MapPanel
