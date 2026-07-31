import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { Trip } from '../../types'
import { TRIPS } from '../../mock/catalog'
import { Button } from '../ui/button'
import { ItineraryCard } from './ItineraryCard'

// Pinned trips lead, then the best rated, and only one per country so the row reads as a
// world tour rather than four variations on the aurora. Static on purpose: the landing page
// must render before any API call resolves.
function pickFeatured(trips: Trip[], count: number): Trip[] {
  const ranked = [...trips].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      b.rating - a.rating ||
      b.reviewCount - a.reviewCount,
  )

  const picked: Trip[] = []
  const seen = new Set<string>()
  for (const trip of ranked) {
    if (seen.has(trip.destination.country)) continue
    seen.add(trip.destination.country)
    picked.push(trip)
    if (picked.length === count) break
  }
  return picked
}

const FEATURED = pickFeatured(TRIPS, 4)

export function PopularItineraries() {
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  function toggleSave(trip: Trip) {
    const next = !saved[trip.slug]
    setSaved((current) => ({ ...current, [trip.slug]: next }))

    if (next) {
      toast.success(`Saved ${trip.title}`, {
        description:
          'Collections belong in the saved_items table; this POC holds them in memory for the session.',
      })
      return
    }
    toast.info(`Removed ${trip.title}`)
  }

  return (
    <section id="itineraries" className="bg-primary/20 py-20">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Popular itineraries</h2>
          <p className="mt-4 text-[15px] text-muted-foreground">
            Two of these are pinned in the admin panel for this month&rsquo;s campaign, which is why
            they lead the row. The rest is ranking.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED.map((trip) => (
            <ItineraryCard
              key={trip.id}
              trip={trip}
              saved={Boolean(saved[trip.slug])}
              onToggleSave={() => toggleSave(trip)}
            />
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <Button asChild variant="outline">
            <Link to="/search">Browse all {TRIPS.length} trips</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
