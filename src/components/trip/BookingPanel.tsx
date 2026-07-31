import { useState } from 'react'
import { Minus, Plane, Plus, Users } from 'lucide-react'
import type { Departure, Trip } from '../../types'
import { money, shortDate } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Select } from '../ui/select'

export interface BookingRequest {
  departure: Departure
  party: number
  total: number
}

interface BookingPanelProps {
  trip: Trip
  departures: Departure[]
  onRequest: (booking: BookingRequest) => void
  className?: string
}

const STEP_BUTTON =
  'flex h-10 w-10 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

export function BookingPanel({ trip, departures, onRequest, className }: BookingPanelProps) {
  const [departureId, setDepartureId] = useState(departures[0]?.id ?? '')
  const [wanted, setWanted] = useState(2)

  const departure: Departure | undefined =
    departures.find((option) => option.id === departureId) ?? departures[0]
  // Seats left on the chosen departure beat the trip-wide group cap, and swapping departure
  // silently trims an oversized party rather than showing an impossible total.
  const maxParty = departure ? Math.min(departure.seatsLeft, trip.groupSizeMax) : trip.groupSizeMax
  const party = Math.min(wanted, Math.max(1, maxParty))
  const total = (departure?.price ?? trip.priceFrom) * party

  return (
    <div className={cn('rounded-2xl border bg-card p-5 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">From</p>
          <p className="text-2xl font-bold tabular-nums">{money(trip.priceFrom, trip.currency)}</p>
          <p className="text-xs text-muted-foreground">per person, {trip.currency}</p>
        </div>
        <Badge tone={trip.available ? 'success' : 'warning'}>
          {trip.available ? 'Available' : 'Sold out'}
        </Badge>
      </div>

      <div className="mt-5 space-y-4 border-t pt-5">
        {departure ? (
          <>
            <div>
              <Select
                label="Departure"
                value={departure.id}
                onChange={setDepartureId}
                options={departures.map((option) => ({
                  value: option.id,
                  label: `${shortDate(option.date)}, ${money(option.price, trip.currency)}`,
                }))}
                className="flex w-full justify-between"
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Plane className="h-3.5 w-3.5" />
                  {departure.direct ? 'Direct flight' : 'One connection'}
                </span>
                <span aria-hidden="true">&middot;</span>
                <span
                  className={cn(
                    'tabular-nums',
                    departure.seatsLeft <= 6 && 'font-semibold text-foreground',
                  )}
                >
                  {departure.seatsLeft} seats left
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-muted-foreground" />
                Travellers
              </span>
              <div className="flex items-center gap-1 rounded-full border p-1">
                <button
                  type="button"
                  onClick={() => setWanted(party - 1)}
                  disabled={party <= 1}
                  aria-label="One fewer traveller"
                  className={STEP_BUTTON}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span aria-live="polite" className="w-7 text-center text-sm font-semibold tabular-nums">
                  {party}
                </span>
                <button
                  type="button"
                  onClick={() => setWanted(party + 1)}
                  disabled={party >= maxParty}
                  aria-label="One more traveller"
                  className={STEP_BUTTON}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-end justify-between gap-3 border-t pt-4">
              <div>
                <p className="text-sm font-semibold">Total</p>
                <p className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{money(departure.price, trip.currency)}</span> &times;{' '}
                  {party} {party === 1 ? 'traveller' : 'travellers'}
                </p>
              </div>
              <p className="text-xl font-bold tabular-nums">{money(total, trip.currency)}</p>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!trip.available}
              onClick={() => onRequest({ departure, party, total })}
            >
              Request booking
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No departures have come through for this trip yet. Availability arrives with the supplier
            feed &mdash; run a sync from the data sources tab in the admin panel.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          No payment is taken. TravelIQ records the request so the analytics screen can report
          conversion by search term; holding a seat needs the supplier booking API.
        </p>
      </div>
    </div>
  )
}
