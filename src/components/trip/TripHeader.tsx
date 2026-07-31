import { Link } from 'react-router-dom'
import { ChevronRight, Clock, MapPin, Plane, Users } from 'lucide-react'
import type { Trip } from '../../types'
import { nights } from '../../lib/format'
import { Badge } from '../ui/badge'
import { RatingLine } from '../ui/stars'

export function TripHeader({ trip }: { trip: Trip }) {
  return (
    <header>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <li>
            <Link to="/search" className="font-medium transition-colors hover:text-foreground">
              Search
            </Link>
          </li>
          <li aria-hidden="true" className="flex">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li>
            <Link
              to={`/search?destination=${trip.destination.slug}`}
              className="font-medium transition-colors hover:text-foreground"
            >
              {trip.destination.name}
            </Link>
          </li>
          <li aria-hidden="true" className="flex">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li aria-current="page" className="max-w-[16rem] truncate text-foreground sm:max-w-none">
            {trip.title}
          </li>
        </ol>
      </nav>

      <h1 className="mt-5 max-w-3xl text-3xl font-extrabold tracking-tight md:text-4xl">
        {trip.title}
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">{trip.summary}</p>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          {trip.destination.name}, {trip.destination.country}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span className="tabular-nums">{trip.durationDays} days</span>, {nights(trip.durationDays)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          <span className="tabular-nums">{trip.groupSizeMax}</span> travellers maximum
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Plane className="h-3.5 w-3.5" />
          {trip.directFlights ? 'Direct flights' : 'One connection'}
        </span>
        <RatingLine value={trip.rating} count={trip.reviewCount} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {trip.themes.map((theme) => (
          <Badge key={theme} tone="brand">
            {theme}
          </Badge>
        ))}
        {trip.audience.map((audience) => (
          <Badge key={audience}>{audience}</Badge>
        ))}
        {!trip.available && <Badge tone="warning">Sold out for this season</Badge>}
      </div>

      {/* Provenance is on the page on purpose: this record is a merge, not a single feed. */}
      <p className="mt-4 text-xs text-muted-foreground">
        Operated by {trip.supplier} &middot; catalogue record merged from {trip.sources.join(', ')}
      </p>
    </header>
  )
}
