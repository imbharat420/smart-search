import { Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Trip } from '../../types'
import { money } from '../../lib/format'
import { cn } from '../../lib/utils'

interface InlineTripCardProps {
  trip: Trip
  // Matches the numbered citation pill above, when this trip was cited.
  marker?: number
  flashing?: boolean
  innerRef?: (element: HTMLAnchorElement | null) => void
}

export function InlineTripCard({ trip, marker, flashing, innerRef }: InlineTripCardProps) {
  return (
    <Link
      ref={innerRef}
      to={`/trip/${trip.slug}`}
      className={cn(
        'group flex gap-3 rounded-2xl border bg-card p-2 transition-shadow hover:shadow-md',
        flashing && 'shadow-md ring-2 ring-[var(--ring)] ring-offset-2',
      )}
    >
      <img
        src={trip.imageUrl}
        alt=""
        loading="lazy"
        className="h-20 w-20 shrink-0 rounded-xl bg-accent object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 pr-1">
        <span className="line-clamp-2 text-sm font-semibold leading-snug">
          {marker !== undefined && (
            <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold tabular-nums text-primary-foreground">
              {marker}
            </span>
          )}
          {trip.title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {trip.destination.name}, {trip.destination.country}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="tabular-nums">{trip.durationDays} days</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold tabular-nums text-foreground">
            from {money(trip.priceFrom)}
          </span>
        </span>
      </span>
    </Link>
  )
}
