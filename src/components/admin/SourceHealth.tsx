import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { DataSource } from '../../types'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { AdminSection } from './AdminSection'
import { sinceLabel } from './relativeTime'

const KIND_LABELS: Record<DataSource['kind'], string> = {
  cms: 'CMS',
  supplier: 'Supplier feed',
  enrichment: 'Enrichment',
}

// The dot is decoration: every card also prints the status word, so state never
// depends on colour alone.
const STATUS_META: Record<DataSource['status'], { label: string; dot: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-[var(--success)] ring-[var(--success)]/20' },
  syncing: {
    label: 'Syncing',
    dot: 'bg-[var(--primary-strong)] ring-[var(--primary-strong)]/30 animate-pulse',
  },
  stale: { label: 'Stale', dot: 'bg-[var(--warning)] ring-[var(--warning)]/25' },
  error: { label: 'Failing', dot: 'bg-destructive ring-destructive/20' },
}

const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  summary: 'summary',
  description: 'description',
  imageUrl: 'lead image',
  gallery: 'gallery',
  themes: 'themes',
  activities: 'activities',
  priceFrom: 'price',
  months: 'departure months',
  available: 'availability',
  groupSizeMax: 'group size',
  directFlights: 'direct flights',
  rating: 'rating',
  reviewCount: 'review count',
  badges: 'badges',
}

export function SourceHealth() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.sources().then((list) => {
      if (cancelled) return
      setSources(list)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const sync = async (source: DataSource) => {
    setSources((prev) =>
      prev.map((s) => (s.key === source.key ? { ...s, status: 'syncing' as const } : s)),
    )
    const next = await api.syncSource(source.key)
    setSources((prev) => prev.map((s) => (s.key === next.key ? next : s)))
    toast.success(`${next.label} synced`, {
      description: `${next.recordCount.toLocaleString('en-GB')} records held by this source.`,
    })
  }

  return (
    <AdminSection
      title="Data sources"
      hint="The same trip arrives from several places. Each source owns the fields it is best at, and a sync replays it through the normalise, match and merge pipeline — anything it cannot place confidently drops into the review queue below."
    >
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((card) => (
            <Skeleton key={card} className="h-52 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sources.map((source) => {
            const status = STATUS_META[source.status]
            return (
              <article
                key={source.id}
                className="flex flex-col rounded-2xl border bg-panel p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold leading-snug">{source.label}</h3>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        aria-hidden
                        className={cn('inline-block size-2 shrink-0 rounded-full ring-4', status.dot)}
                      />
                      {status.label} · synced {sinceLabel(source.lastSyncAt)}
                    </p>
                  </div>
                  <Badge tone="neutral" size="sm">
                    {KIND_LABELS[source.kind]}
                  </Badge>
                </div>

                <dl className="mt-4 flex gap-8 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Records</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">
                      {source.recordCount.toLocaleString('en-GB')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Key</dt>
                    <dd className="mt-0.5 font-semibold">{source.key}</dd>
                  </div>
                </dl>

                <p className="mt-4 text-xs font-medium text-muted-foreground">This source wins</p>
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {source.fieldPriority.map((field, i) => (
                    <li
                      key={field}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs"
                    >
                      <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                      {FIELD_NAMES[field] ?? field}
                    </li>
                  ))}
                </ol>

                <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    {source.status === 'error'
                      ? 'Last run failed. Records from this source are stale until it recovers.'
                      : 'Earlier entries in the list beat every other source on that field.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sync(source)}
                    disabled={source.status === 'syncing'}
                  >
                    <RefreshCw className={source.status === 'syncing' ? 'animate-spin' : undefined} />
                    {source.status === 'syncing' ? 'Syncing' : 'Sync now'}
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </AdminSection>
  )
}
