import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Guide, Trip } from '../../types'
import { money } from '../../lib/format'
import { Button } from '../ui/button'
import { Card, CardBody, CardMedia } from '../ui/card'
import { Skeleton } from '../ui/skeleton'

interface RailItem {
  key: string
  to: string
  title: string
  sub: string
  imageUrl: string
}

interface RailProps {
  title: string
  subtitle: string
  items: RailItem[]
}

const TRACK =
  'scrollbar-thin -mx-1 grid grid-flow-col auto-cols-[minmax(210px,1fr)] gap-4 overflow-x-auto px-1 pb-2'

function Rail({ title, subtitle, items }: RailProps) {
  const track = useRef<HTMLDivElement>(null)

  const nudge = (direction: -1 | 1) => {
    const element = track.current
    if (!element) return
    element.scrollBy({ left: direction * Math.round(element.clientWidth * 0.8), behavior: 'smooth' })
  }

  if (items.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          <button
            type="button"
            aria-label={`Scroll ${title} left`}
            onClick={() => nudge(-1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border bg-background text-foreground transition-colors hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Scroll ${title} right`}
            onClick={() => nudge(1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border bg-background text-foreground transition-colors hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={track} className={TRACK}>
        {items.map((item) => (
          <Link key={item.key} to={item.to} className="min-w-0">
            <Card className="h-full">
              <CardMedia src={item.imageUrl} alt={item.title} aspect="4/3" />
              <CardBody className="gap-1 p-3">
                <span className="line-clamp-2 text-sm font-semibold leading-snug">{item.title}</span>
                <span className="truncate text-xs text-muted-foreground">{item.sub}</span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}

function RailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-44 rounded-lg" />
      <div className="grid grid-flow-col auto-cols-[minmax(210px,1fr)] gap-4 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-2xl border bg-card">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-4/5 rounded-md" />
              <Skeleton className="h-3 w-1/2 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface DiscoveryRailsProps {
  trips: Trip[]
  guides: Guide[]
  loading: boolean
}

export function DiscoveryRails({ trips, guides, loading }: DiscoveryRailsProps) {
  const recent = trips.slice(0, 6)
  const rated = [...trips.slice(6)].sort((a, b) => b.rating - a.rating).slice(0, 6)

  const toItem = (trip: Trip, sub: string): RailItem => ({
    key: trip.id,
    to: `/trip/${trip.slug}`,
    title: trip.title,
    sub,
    imageUrl: trip.imageUrl,
  })

  return (
    <div className="space-y-10 px-5 py-6 md:px-8">
      {/* <div className="flex justify-end">
        <Button asChild variant="brand">
          <Link to="/inspiration">Create a trip</Link>
        </Button>
      </div> */}

      {loading ? (
        <>
          <RailSkeleton />
          <RailSkeleton />
        </>
      ) : (
        <>
          <Rail
            title="Jump back in"
            subtitle="Recently viewed is not stored yet, so pinned catalogue trips stand in"
            items={recent.map((trip) =>
              toItem(trip, `${trip.destination.name} · ${trip.durationDays} days`),
            )}
          />
          <Rail
            title="For you"
            subtitle="Ranked by traveller rating rather than a personal profile"
            items={rated.map((trip) =>
              toItem(trip, `${money(trip.priceFrom)} · rated ${trip.rating.toFixed(1)}`),
            )}
          />
          <Rail
            title="Get inspired"
            subtitle="Guides written by our creators"
            items={guides.slice(0, 6).map((guide) => ({
              key: guide.id,
              to: `/inspiration?guide=${guide.slug}`,
              title: guide.title,
              sub: `${guide.location} · ${guide.days} days`,
              imageUrl: guide.imageUrl,
            }))}
          />
        </>
      )}
    </div>
  )
}
