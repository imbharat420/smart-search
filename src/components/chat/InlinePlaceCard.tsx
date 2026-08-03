import { Navigation } from 'lucide-react'
import type { Place } from '../../types'

interface InlinePlaceCardProps {
  place: Place
}

const CATEGORY_LABEL: Record<Place['category'], string> = {
  'things-to-do': 'Thing to do',
  restaurants: 'Restaurant',
  stays: 'Stay',
}

export function InlinePlaceCard({ place }: InlinePlaceCardProps) {
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
      target="_blank"
      rel="noreferrer"
      className="group flex gap-3 rounded-2xl border bg-card p-2 transition-shadow hover:shadow-md"
    >
      <img
        src={place.imageUrl}
        alt=""
        loading="lazy"
        className="h-20 w-20 shrink-0 rounded-xl bg-accent object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-1">
        <span className="line-clamp-2 text-sm font-semibold leading-snug">{place.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {CATEGORY_LABEL[place.category]} · {place.location}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Navigation className="h-3.5 w-3.5 shrink-0" />
          <span className="tabular-nums">{place.distanceMiles} mi away</span>
          {place.price && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold tabular-nums text-foreground">{place.price}</span>
            </>
          )}
        </span>
      </span>
    </a>
  )
}
