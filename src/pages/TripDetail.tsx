import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Compass, RotateCcw } from 'lucide-react'
import type { TripDetail as TripDetailData } from '../types'
import { api } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { usePageMeta } from '../lib/meta'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Empty } from '../components/ui/empty'
import { Sheet } from '../components/ui/sheet'
import { Skeleton } from '../components/ui/skeleton'
import { BookingBar } from '../components/trip/BookingBar'
import { BookingPanel } from '../components/trip/BookingPanel'
import type { BookingRequest } from '../components/trip/BookingPanel'
import { SimilarTrips } from '../components/trip/SimilarTrips'
import { TripGallery } from '../components/trip/TripGallery'
import { TripHeader } from '../components/trip/TripHeader'
import { TripIncluded } from '../components/trip/TripIncluded'
import { TripItinerary } from '../components/trip/TripItinerary'
import { TripPractical } from '../components/trip/TripPractical'
import { useTripStructuredData } from '../components/trip/structuredData'

type LoadState = 'loading' | 'ready' | 'missing' | 'error'

export function TripDetail() {
  const { slug = '' } = useParams()
  const [detail, setDetail] = useState<TripDetailData | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [attempt, setAttempt] = useState(0)
  const [booked, setBooked] = useState<BookingRequest | null>(null)

  const trip = detail?.trip
  usePageMeta(
    trip ? `${trip.title} — ${trip.destination.name} — TravelIQ` : 'Trip — TravelIQ',
    trip?.summary,
  )
  useTripStructuredData(detail)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setDetail(null)
    setBooked(null)
    // Following a similar-trips link only swaps the route param, so the browser would otherwise
    // keep the scroll offset from halfway down the previous trip.
    window.scrollTo({ top: 0 })

    api
      .trip(slug)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState(err instanceof Error && err.message === 'not-found' ? 'missing' : 'error')
      })

    return () => {
      cancelled = true
    }
  }, [slug, attempt])

  const requestBooking = async (booking: BookingRequest) => {
    if (!detail) return
    setBooked(booking)
    // The conversion signal behind the analytics screen. A supplier booking API would follow it.
    await api.event({ type: 'booking', tripId: detail.trip.id, value: booking.total })
  }

  if (state === 'loading') return <DetailSkeleton />

  if (state === 'missing') {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-20 md:px-10 md:py-28">
        <Empty
          icon={<Compass />}
          title="That trip is no longer in the catalogue"
          body="The link may come from an older supplier feed, or the departure has been withdrawn. Search again and TravelIQ will rebuild the filters from your sentence."
          action={
            <Button asChild>
              <Link to="/search">Back to search</Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (state === 'error' || !detail || !trip) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-20 md:px-10 md:py-28">
        <Empty
          icon={<RotateCcw />}
          title="We could not load this trip"
          body="The catalogue service did not answer and the offline copy has no record of this trip either."
          action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 pb-36 pt-8 md:px-10 md:pt-10 lg:pb-16">
      <TripHeader trip={trip} />

      <div className="mt-8">
        <TripGallery title={trip.title} images={[trip.imageUrl, ...trip.gallery]} />
      </div>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <div className="min-w-0 space-y-12">
          <section>
            <h2 className="text-xl font-bold tracking-tight">About this trip</h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {trip.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {trip.activities.map((activity) => (
                <Badge key={activity}>{activity}</Badge>
              ))}
            </div>
          </section>

          <TripIncluded items={detail.included} />
          <TripItinerary days={detail.itinerary} />
          <TripPractical policyIds={detail.policyIds} />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-8">
            <BookingPanel trip={trip} departures={detail.departures} onRequest={requestBooking} />
          </div>
        </aside>
      </div>

      <SimilarTrips trips={detail.similar} />

      <BookingBar trip={trip} departures={detail.departures} onRequest={requestBooking} />

      <Sheet open={booked !== null} onClose={() => setBooked(null)} title="Request received">
        {booked && (
          <div className="flex flex-col gap-5 p-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Your request is with our team</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">
                {trip.title}, departing {shortDate(booked.departure.date)} for{' '}
                <span className="tabular-nums">{booked.party}</span>{' '}
                {booked.party === 1 ? 'traveller' : 'travellers'}.
              </p>
            </div>

            <dl className="rounded-2xl border bg-card p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Departure</dt>
                <dd className="font-semibold tabular-nums">{shortDate(booked.departure.date)}</dd>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Flights</dt>
                <dd className="font-semibold">
                  {booked.departure.direct ? 'Direct' : 'One connection'}
                </dd>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2">
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-bold tabular-nums">{money(booked.total, trip.currency)}</dd>
              </div>
            </dl>

            <p className="rounded-2xl bg-panel p-4 text-sm leading-relaxed text-muted-foreground">
              Nothing is reserved and no card details were taken. This proof of concept writes the
              request to the search events table so the analytics screen can report conversion by
              search term. Holding a seat, pricing it live and taking payment is a supplier booking
              API plus a payment provider, both out of scope here.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setBooked(null)}>
                Keep reading
              </Button>
              <Button variant="brand" asChild>
                <Link to="/search">Search other trips</Link>
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 pt-8 md:px-10 md:pt-10">
      <Skeleton className="h-3 w-52" />
      <Skeleton className="mt-6 h-9 w-3/4 max-w-xl rounded-xl" />
      <Skeleton className="mt-4 h-4 w-1/2 max-w-md" />
      <Skeleton className="mt-5 h-3 w-72" />

      <div className="mt-8 grid gap-3 lg:grid-cols-[1.65fr_1fr]">
        <Skeleton className="aspect-[16/10] w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-rows-2">
          {[0, 1, 2, 3].map((cell) => (
            <Skeleton key={cell} className="aspect-[4/3] w-full rounded-2xl lg:aspect-auto" />
          ))}
        </div>
      </div>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40 rounded-lg" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="space-y-3 pt-6">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-20 w-full rounded-2xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  )
}
