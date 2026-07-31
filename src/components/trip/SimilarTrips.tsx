import { Link } from 'react-router-dom'
import { ArrowRight, MapPin } from 'lucide-react'
import type { Trip } from '../../types'
import { money } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Card, CardBody, CardMedia } from '../ui/card'
import { RatingLine } from '../ui/stars'

export function SimilarTrips({ trips }: { trips: Trip[] }) {
  if (trips.length === 0) return null

  return (
    <section className="mt-14 border-t pt-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Similar trips</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Ranked on shared themes, activities and country &mdash; the same signals the search
            index scores against.
          </p>
        </div>
        <Link
          to="/search"
          className="hidden shrink-0 items-center gap-1.5 text-sm font-semibold transition-colors hover:text-muted-foreground sm:inline-flex"
        >
          All trips
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {trips.map((trip) => (
          <Link key={trip.id} to={`/trip/${trip.slug}`} className="block">
            <Card className="h-full">
              <CardMedia
                src={trip.imageUrl}
                alt={trip.title}
                aspect="4/5"
                badge={
                  <Badge tone="brand" size="sm">
                    <span className="tabular-nums">{trip.durationDays}</span> days
                  </Badge>
                }
              />
              <CardBody>
                <h3 className="font-semibold leading-snug">{trip.title}</h3>
                <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {trip.destination.name}, {trip.destination.country}
                </p>
                <RatingLine value={trip.rating} count={trip.reviewCount} className="mt-auto pt-1" />
                <p className="text-sm">
                  <span className="font-bold tabular-nums">
                    {money(trip.priceFrom, trip.currency)}
                  </span>{' '}
                  <span className="text-xs text-muted-foreground">per person</span>
                </p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}
