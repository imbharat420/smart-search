import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { AnalyticsOverview } from '../../types'
import { api, usingMockData } from '../../lib/api'
import { pct } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Select } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { AdminSection } from './AdminSection'
import { TimelineChart } from './TimelineChart'
import { sinceLabel } from './relativeTime'

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

// Above this the zero-result rate stops being noise and starts being missing inventory.
const ZERO_RESULT_TARGET = 0.05

function KpiTile({
  label,
  value,
  hint,
  badge,
}: {
  label: string
  value: string
  hint: string
  badge?: ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {badge}
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export function AnalyticsPanel({ onAddSynonym }: { onAddSynonym: (query: string) => void }) {
  const [days, setDays] = useState('30')
  const [data, setData] = useState<AnalyticsOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.analytics(Number(days)).then((overview) => {
      if (cancelled) return
      setData(overview)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [days])

  // The range control stays mounted through a reload so the row does not jump.
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[15px] text-muted-foreground">
        Counted from the impression, click and booking events logged against each search id.
      </p>
      <Select value={days} onChange={setDays} options={RANGES} label="Range" />
    </div>
  )

  if (loading || !data) {
    return (
      <>
        {header}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </>
    )
  }

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Total searches"
          value={data.totalSearches.toLocaleString('en-GB')}
          hint={`Across the last ${days} days`}
        />
        <KpiTile
          label="Zero-result rate"
          value={pct(data.zeroResultRate)}
          hint="Searches that came back with nothing"
          badge={
            data.zeroResultRate > ZERO_RESULT_TARGET ? (
              <Badge tone="warning" size="sm">
                over {pct(ZERO_RESULT_TARGET)} target
              </Badge>
            ) : undefined
          }
        />
        <KpiTile
          label="Click-through rate"
          value={pct(data.clickThroughRate)}
          hint="Result clicks per search"
        />
        <KpiTile
          label="Conversion"
          value={pct(data.conversionRate)}
          hint="Bookings per search"
        />
      </div>

      <AdminSection
        title="Search funnel"
        hint="Each measure keeps its own vertical scale, because bookings are an order of magnitude smaller than searches and would otherwise sit flat on the baseline. Hover one chart to read the same day on all three."
      >
        <TimelineChart points={data.timeline} />
        {usingMockData() && (
          <p className="mt-4 text-xs text-muted-foreground">
            The backend is unreachable, so this is the seeded 30-day fixture and the range selector
            has no effect. Start the FastAPI service for real figures.
          </p>
        )}
      </AdminSection>

      <AdminSection
        title="Top searches"
        hint="What travellers ask for most, and how well the results answer them."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Query
                </th>
                <th scope="col" className="w-28 px-5 py-3 text-right font-semibold">
                  Searches
                </th>
                <th scope="col" className="w-24 px-5 py-3 text-right font-semibold">
                  CTR
                </th>
                <th scope="col" className="w-32 px-5 py-3 text-right font-semibold">
                  Conversion
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topQueries.map((row) => (
                <tr key={row.query} className="border-b last:border-b-0">
                  <th scope="row" className="px-5 py-3 font-medium">
                    {row.query}
                  </th>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {row.searches.toLocaleString('en-GB')}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{pct(row.ctr)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{pct(row.conversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <AdminSection
        title="Searches that found nothing"
        hint="Each of these is either vocabulary the catalogue does not share or inventory it does not hold. A synonym fixes the first case; the second needs a buyer."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Query
                </th>
                <th scope="col" className="w-28 px-5 py-3 text-right font-semibold">
                  Volume
                </th>
                <th scope="col" className="w-40 px-5 py-3 font-semibold">
                  Last seen
                </th>
                <th scope="col" className="w-44 px-5 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.zeroResults.map((row) => (
                <tr key={row.query} className="border-b last:border-b-0">
                  <th scope="row" className="px-5 py-3 font-medium">
                    {row.query}
                  </th>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {row.searches.toLocaleString('en-GB')}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{sinceLabel(row.lastSeen)}</td>
                  <td className="px-5 py-3">
                    <Button variant="outline" size="sm" onClick={() => onAddSynonym(row.query)}>
                      <Plus />
                      Add a synonym
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>
    </>
  )
}
