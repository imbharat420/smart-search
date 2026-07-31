import { useEffect, useRef, useState } from 'react'
import { EyeOff, Pin, Trash2, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { Promotion, SearchResult, Trip } from '../../types'
import { api } from '../../lib/api'
import { money, shortDate } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Empty } from '../ui/empty'
import { Input, SearchField } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Slider } from '../ui/slider'
import { AdminSection } from './AdminSection'

const KIND_META = {
  pin: { badge: 'Pinned', action: 'Pin', tone: 'brand' as const },
  boost: { badge: 'Boosted', action: 'Boost', tone: 'warning' as const },
  hide: { badge: 'Hidden', action: 'Hide', tone: 'danger' as const },
}

const KINDS = ['pin', 'boost', 'hide'] as const

function KindIcon({ kind }: { kind: Promotion['kind'] }) {
  if (kind === 'pin') return <Pin />
  if (kind === 'boost') return <TrendingUp />
  return <EyeOff />
}

function windowLabel(promotion: Promotion): string {
  const { startsAt, endsAt } = promotion
  if (!startsAt && !endsAt) return 'Always on'
  if (startsAt && endsAt) return `${shortDate(startsAt)} to ${shortDate(endsAt)}`
  if (startsAt) return `From ${shortDate(startsAt)}`
  return `Until ${shortDate(endsAt ?? '')}`
}

export function PromotionBoard() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(true)
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loadingPromotions, setLoadingPromotions] = useState(true)
  const [campaign, setCampaign] = useState({ startsAt: '', endsAt: '' })
  const [boostWeight, setBoostWeight] = useState(25)
  const [busy, setBusy] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    let cancelled = false
    api.promotions().then((list) => {
      if (cancelled) return
      setPromotions(list)
      setLoadingPromotions(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    const timer = window.setTimeout(async () => {
      setSearching(true)
      const res = await api.search({ query, pageSize: 8 })
      // Guards against out-of-order responses when the merchandiser types quickly.
      if (id !== requestId.current) return
      setResults(res.results)
      setSearching(false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const promote = async (trip: Trip, kind: Promotion['kind']) => {
    if (promotions.some((p) => p.tripId === trip.id && p.kind === kind)) {
      toast.info(`${trip.title} already has a ${kind}`)
      return
    }
    if (campaign.startsAt && campaign.endsAt && campaign.endsAt < campaign.startsAt) {
      toast.error('The campaign window ends before it starts')
      return
    }

    setBusy(`${trip.id}-${kind}`)
    const created = await api.addPromotion({
      tripId: trip.id,
      tripTitle: trip.title,
      kind,
      weight: kind === 'pin' ? 100 : kind === 'boost' ? boostWeight : 0,
      startsAt: campaign.startsAt || undefined,
      endsAt: campaign.endsAt || undefined,
    })
    setPromotions((prev) => [created, ...prev])
    setBusy(null)
    toast.success(`${KIND_META[kind].badge}: ${trip.title}`, {
      description: windowLabel(created),
    })
  }

  const remove = async (promotion: Promotion) => {
    setBusy(promotion.id)
    await api.deletePromotion(promotion.id)
    setPromotions((prev) => prev.filter((p) => p.id !== promotion.id))
    setBusy(null)
    toast.success(`Removed the ${promotion.kind} on ${promotion.tripTitle}`)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <AdminSection
        title="Merchandising board"
        hint="A pin outranks relevance: a pinned trip leads every result set it matches. A boost only adds weight to the score, and a hide keeps the trip published but out of search."
      >
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Find a trip by name, destination or theme"
          aria-label="Find a trip to promote"
        />

        <div className="mt-5 grid gap-4 rounded-2xl border bg-panel p-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-medium text-muted-foreground">Campaign starts</span>
            <Input
              type="date"
              value={campaign.startsAt}
              onChange={(e) => setCampaign({ ...campaign, startsAt: e.target.value })}
              className="mt-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-muted-foreground">Campaign ends</span>
            <Input
              type="date"
              value={campaign.endsAt}
              onChange={(e) => setCampaign({ ...campaign, endsAt: e.target.value })}
              className="mt-1.5"
            />
          </label>
          <div className="sm:col-span-2">
            <Slider
              label="Boost strength"
              min={5}
              max={50}
              step={5}
              value={boostWeight}
              onChange={setBoostWeight}
              format={(value) => `+${value}`}
            />
            <p className="text-xs text-muted-foreground">
              The window and strength apply to the next placement you create. Leave both dates empty
              for an always-on placement.
            </p>
          </div>
        </div>

        {searching && results.length === 0 ? (
          <ul className="mt-2 space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <li key={row} className="flex items-center justify-between gap-4 py-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-8 w-40" />
              </li>
            ))}
          </ul>
        ) : results.length === 0 ? (
          <p className="mt-6 text-[15px] text-muted-foreground">
            Nothing matches that. Try a destination, a theme such as wildlife, or clear the box to
            see the whole catalogue.
          </p>
        ) : (
          <ul className="mt-2">
            {results.map(({ trip }) => (
              <li
                key={trip.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{trip.title}</p>
                  <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
                    {trip.destination.name} · {trip.durationDays} days · from{' '}
                    {money(trip.priceFrom)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {KINDS.map((kind) => (
                    <Button
                      key={kind}
                      variant="outline"
                      size="sm"
                      onClick={() => promote(trip, kind)}
                      disabled={busy !== null}
                    >
                      <KindIcon kind={kind} />
                      {KIND_META[kind].action}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        title="Live placements"
        hint="Placements are read by the ranking layer on every search, so removing one takes effect immediately."
      >
        {loadingPromotions ? (
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
        ) : promotions.length === 0 ? (
          <Empty
            icon={<Pin />}
            title="No placements yet"
            body="Pick a trip on the left and pin, boost or hide it. Relevance alone decides the order until you do."
          />
        ) : (
          <ul className="space-y-3">
            {promotions.map((promotion) => (
              <li
                key={promotion.id}
                className="flex items-start justify-between gap-3 rounded-2xl border bg-panel p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={KIND_META[promotion.kind].tone} size="sm">
                      <KindIcon kind={promotion.kind} />
                      {KIND_META[promotion.kind].badge}
                    </Badge>
                    {promotion.kind !== 'hide' && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        weight {promotion.weight}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[15px] font-semibold leading-snug">
                    {promotion.tripTitle}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{windowLabel(promotion)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(promotion)}
                  disabled={busy === promotion.id}
                  aria-label={`Remove the ${promotion.kind} on ${promotion.tripTitle}`}
                  className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  )
}
