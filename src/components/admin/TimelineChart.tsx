import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TimelinePoint } from '../../types'
import { shortDate } from '../../lib/format'

const FACETS = [
  { key: 'searches', label: 'Searches', unit: 'searches' },
  { key: 'clicks', label: 'Result clicks', unit: 'clicks' },
  { key: 'bookings', label: 'Bookings', unit: 'bookings' },
] as const

const count = (value: number): string => value.toLocaleString('en-GB')

const dayTick = (value: string): string =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

interface FacetTooltipProps {
  unit: string
  active?: boolean
  label?: string | number
  payload?: { value?: number }[]
}

function FacetTooltip({ unit, active, label, payload }: FacetTooltipProps) {
  const value = payload?.[0]?.value
  if (!active || value === undefined) return null

  return (
    <div className="rounded-xl border bg-card px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground">{shortDate(String(label))}</p>
      <p className="text-sm font-semibold tabular-nums">
        {count(value)} {unit}
      </p>
    </div>
  )
}

// Three stacked facets rather than three lines on one axis: bookings run an order
// of magnitude below searches, so a shared scale flattens them onto the baseline
// and a second y-axis would misstate both. Each facet keeps its own scale, the
// hue stays constant, and the heading carries identity instead of colour. The
// shared syncId ties the three crosshairs to one date.
export function TimelineChart({ points }: { points: TimelinePoint[] }) {
  return (
    <div className="space-y-5">
      {FACETS.map((facet, i) => {
        const values = points.map((point) => point[facet.key])
        const latest = values[values.length - 1] ?? 0
        const total = values.reduce((sum, value) => sum + value, 0)
        const last = i === FACETS.length - 1

        return (
          <div key={facet.key}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h4 className="text-sm font-semibold">
                {facet.label} <span className="font-normal text-muted-foreground">per day</span>
              </h4>
              <p className="text-xs tabular-nums text-muted-foreground">
                latest {count(latest)} · {count(total)} over the period
              </p>
            </div>
            <div className={last ? 'h-32' : 'h-28'}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={points}
                  syncId="traveliq-funnel"
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  desc={`${facet.label} per day, ${count(total)} over the period`}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={32}
                    height={last ? 24 : 6}
                    tick={last ? { fill: 'var(--muted-foreground)', fontSize: 11 } : false}
                    tickFormatter={dayTick}
                  />
                  <YAxis
                    width={48}
                    tickCount={3}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    tickFormatter={count}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                    content={<FacetTooltip unit={facet.unit} />}
                  />
                  <Area
                    type="monotone"
                    dataKey={facet.key}
                    stroke="var(--ink)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="var(--ink)"
                    fillOpacity={0.07}
                    dot={false}
                    activeDot={{ r: 4, fill: 'var(--ink)', stroke: 'var(--card)', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
