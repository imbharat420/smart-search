import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import type { SearchResult } from '../../types'
import { money } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardBody, CardMedia } from '../ui/card'
import { RatingLine } from '../ui/stars'

interface ResultCardProps {
  result: SearchResult
  position: number
  onSelect: (result: SearchResult, position: number) => void
}

export function ResultCard({ result, position, onSelect }: ResultCardProps) {
  const { trip, score, matchedOn } = result
  const extraThemes = trip.themes.length - 2

  return (
    <Card className="relative">
      <CardMedia
        src={trip.imageUrl}
        alt={trip.title}
        badge={
          <>
            <Badge tone="brand" size="sm">
              <span className="tabular-nums">{Math.round(score * 100)}%</span> match
            </Badge>
            {trip.pinned && (
              <Badge tone="neutral" size="sm" className="bg-background/90">
                Promoted
              </Badge>
            )}
          </>
        }
      />
      <CardBody className="gap-2.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {trip.destination.name}, {trip.destination.country}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">{trip.durationDays} days</span>
        </div>

        <h3 className="line-clamp-2 font-semibold leading-snug">{trip.title}</h3>

        <div className="flex flex-wrap gap-1.5">
          {trip.themes.slice(0, 2).map((theme) => (
            <Badge key={theme} size="sm">
              {theme}
            </Badge>
          ))}
          {extraThemes > 0 && <Badge size="sm">+{extraThemes}</Badge>}
        </div>

        <RatingLine value={trip.rating} count={trip.reviewCount} />

        {matchedOn.length > 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Matched on</span>{' '}
            {matchedOn.slice(0, 3).join(' · ')}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 border-t pt-3">
          <div>
            <p className="text-[11px] text-muted-foreground">from</p>
            <p className="text-lg font-bold leading-none tabular-nums">{money(trip.priceFrom)}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  trip.available ? 'bg-[var(--success)]' : 'bg-muted-foreground/40',
                )}
              />
              {trip.available ? 'Departures available' : 'Waitlist only'}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            {/* The stretched pseudo-element makes the whole card clickable through one real link. */}
            <Link
              to={`/trip/${trip.slug}`}
              onClick={() => onSelect(result, position)}
              className="after:absolute after:inset-0 after:content-['']"
            >
              View trip
            </Link>
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
