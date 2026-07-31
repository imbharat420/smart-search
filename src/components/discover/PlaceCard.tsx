import { Heart, MapPin, Star } from 'lucide-react'
import type { Place } from '../../types'
import { Card, CardBody } from '../ui/card'
import { cn } from '../../lib/utils'

interface PlaceCardProps {
  place: Place
  saved: boolean
  highlighted: boolean
  onToggleSave: (id: string) => void
  onOpen: (place: Place) => void
  onHover: (id: string | null) => void
}

export function PlaceCard({
  place,
  saved,
  highlighted,
  onToggleSave,
  onOpen,
  onHover,
}: PlaceCardProps) {
  return (
    <Card
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(place.id)}
      onBlur={() => onHover(null)}
      className={cn('relative w-48 shrink-0', highlighted && 'shadow-md ring-2 ring-[var(--ring)]')}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-accent">
        <img
          src={place.imageUrl}
          alt={place.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <button
          type="button"
          onClick={() => onToggleSave(place.id)}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${place.name} from saved places` : `Save ${place.name}`}
          // The pseudo-element carries the 40px tap target so the button itself can stay
          // small enough not to sit on top of the photograph.
          className="absolute right-2 top-2 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-background"
        >
          <Heart
            className={cn(
              'h-4 w-4',
              saved && 'fill-[var(--primary-strong)] text-[var(--primary-strong)]',
            )}
          />
        </button>
      </div>
      <CardBody className="gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold leading-snug">
            <button
              type="button"
              onClick={() => onOpen(place)}
              className="block max-w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:content-['']"
            >
              {place.name}
            </button>
          </h3>
          {typeof place.rating === 'number' && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums">
              <Star className="h-3 w-3 fill-[var(--primary-strong)] text-[var(--primary-strong)]" />
              {place.rating.toFixed(1)}
            </span>
          )}
        </div>
        <p className="text-xs capitalize text-muted-foreground">{place.type}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{place.location}</span>
          </span>
          <span className="shrink-0 tabular-nums">{place.price ?? `${place.distanceMiles} mi`}</span>
        </div>
      </CardBody>
    </Card>
  )
}
