import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import type { Trip } from '../../types'
import { money, nights } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardBody, CardMedia } from '../ui/card'
import { RatingLine } from '../ui/stars'

interface ItineraryCardProps {
  trip: Trip
  saved: boolean
  onToggleSave: () => void
}

export function ItineraryCard({ trip, saved, onToggleSave }: ItineraryCardProps) {
  const flag = trip.pinned ? 'Pinned' : trip.badges?.[0]
  const href = `/trip/${trip.slug}`

  return (
    <Card>
      {/* The title link below goes to the same place, so the image is hidden from tab order and AT. */}
      <Link to={href} tabIndex={-1} aria-hidden="true" className="block">
        <CardMedia
          src={trip.imageUrl}
          alt={trip.title}
          aspect="4/5"
          badge={
            flag ? (
              <Badge tone={trip.pinned ? 'brand' : 'neutral'} size="sm">
                {flag}
              </Badge>
            ) : undefined
          }
        />
      </Link>

      <CardBody className="gap-3">
        <div>
          <h3 className="font-semibold leading-snug">
            <Link to={href} className="hover:underline">
              {trip.title}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {trip.destination.name}, {trip.destination.country} &middot;{' '}
            {nights(trip.durationDays)} &middot; from{' '}
            <span className="tabular-nums">{money(trip.priceFrom)}</span>
          </p>
        </div>

        <RatingLine value={trip.rating} count={trip.reviewCount} />

        <div className="mt-auto flex items-center gap-2">
          <Button asChild size="sm">
            <Link to={href}>Customise</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={saved}
            onClick={onToggleSave}
            className="px-3"
          >
            <Heart
              className={cn(saved && 'fill-[var(--primary-strong)] text-[var(--primary-strong)]')}
            />
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
