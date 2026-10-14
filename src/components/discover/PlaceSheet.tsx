import { Heart, Navigation } from 'lucide-react'
import type { Place } from '../../types'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Sheet } from '../ui/sheet'
import { RatingLine } from '../ui/stars'

const CATEGORY_LABEL: Record<Place['category'], string> = {
  'things-to-do': 'Thing to do',
  restaurants: 'Restaurant',
  stays: 'Stay',
  trips: 'Trip',
}

interface PlaceSheetProps {
  place: Place | null
  pinIndex?: number
  saved: boolean
  onToggleSave: (id: string) => void
  onClose: () => void
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

export function PlaceSheet({ place, pinIndex, saved, onToggleSave, onClose }: PlaceSheetProps) {
  return (
    <Sheet open={place !== null} onClose={onClose} title="Place detail">
      {place && (
        <div>
          <img
            src={place.imageUrl}
            alt={place.name}
            className="aspect-[16/10] w-full object-cover"
          />
          <div className="space-y-5 p-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="brand" size="sm">
                  {CATEGORY_LABEL[place.category]}
                </Badge>
                <span className="text-xs capitalize text-muted-foreground">{place.type}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">{place.name}</h2>
              {typeof place.rating === 'number' && <RatingLine value={place.rating} />}
            </div>

            <dl className="divide-y overflow-hidden rounded-2xl border">
              <DetailRow label="Area" value={place.location} />
              <DetailRow label="Distance" value={`${place.distanceMiles} miles`} />
              {place.price && <DetailRow label="Typical price" value={place.price} />}
              <DetailRow
                label="Coordinates"
                value={`${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`}
              />
              {pinIndex !== undefined && <DetailRow label="Map pin" value={`Pin ${pinIndex}`} />}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={saved ? 'outline' : 'brand'}
                onClick={() => onToggleSave(place.id)}
                aria-pressed={saved}
              >
                <Heart
                  className={
                    saved ? 'fill-[var(--primary-strong)] text-[var(--primary-strong)]' : undefined
                  }
                />
                {saved ? 'Saved' : 'Save place'}
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation />
                  Directions
                </a>
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Opening hours, menus and live availability come from the POI provider in production.
              This build reads the seeded place index, so what you see above is everything TravelIQ
              holds for {place.name}.
            </p>
          </div>
        </div>
      )}
    </Sheet>
  )
}
