import { useState } from 'react'
import type { Departure, Trip } from '../../types'
import { money } from '../../lib/format'
import { Button } from '../ui/button'
import { Sheet } from '../ui/sheet'
import { BookingPanel } from './BookingPanel'
import type { BookingRequest } from './BookingPanel'

interface BookingBarProps {
  trip: Trip
  departures: Departure[]
  onRequest: (booking: BookingRequest) => void
}

export function BookingBar({ trip, departures, onRequest }: BookingBarProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Sits above the mobile tab bar. From lg the sticky panel in the right column takes over. */}
      <div className="fixed inset-x-0 bottom-16 z-30 flex items-center justify-between gap-4 border-t bg-card/95 px-6 py-3 backdrop-blur md:bottom-0 lg:hidden">
        <div>
          <p className="text-xs text-muted-foreground">
            From, per person &middot; <span className="tabular-nums">{trip.durationDays} days</span>
          </p>
          <p className="text-lg font-bold tabular-nums">{money(trip.priceFrom, trip.currency)}</p>
        </div>
        <Button onClick={() => setOpen(true)}>Check dates</Button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Request a booking">
        <div className="p-5">
          <BookingPanel
            trip={trip}
            departures={departures}
            className="border-0 p-0 shadow-none"
            onRequest={(booking) => {
              setOpen(false)
              onRequest(booking)
            }}
          />
        </div>
      </Sheet>
    </>
  )
}
