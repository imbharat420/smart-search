import type { ItineraryDay } from '../../types'

export function TripItinerary({ days }: { days: ItineraryDay[] }) {
  if (days.length === 0) return null

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">Day by day</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
        The shape of the week rather than a timetable. Guides move days around for weather, and on
        the aurora trips they will always chase clear sky over a fixed plan.
      </p>

      <ol className="mt-5 space-y-3">
        {days.map((day) => (
          <li
            key={day.day}
            className="flex gap-4 rounded-2xl border bg-card p-4 transition-shadow hover:shadow-md"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold tabular-nums text-accent-foreground">
              {day.day}
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold leading-snug">{day.title}</h3>
              <p className="mt-1 text-[15px] text-muted-foreground">{day.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
