import { useEffect, useState } from 'react'
import { ArrowLeftRight, CheckCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import type { MergeCandidate } from '../../types'
import { api } from '../../lib/api'
import { pct } from '../../lib/format'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Empty } from '../ui/empty'
import { Skeleton } from '../ui/skeleton'
import { AdminSection } from './AdminSection'

// Confidence bands share one hue per band: the track is the same colour as the
// fill at low opacity, so the state reads across the whole meter.
const BANDS = [
  { floor: 0.8, label: 'Likely the same trip', track: 'bg-[var(--success)]/15', fill: 'bg-[var(--success)]' },
  { floor: 0.7, label: 'Plausible, worth a look', track: 'bg-[var(--warning)]/20', fill: 'bg-[var(--warning)]' },
  { floor: 0, label: 'Weak — probably two products', track: 'bg-destructive/15', fill: 'bg-destructive' },
]

function band(score: number) {
  return BANDS.find((entry) => score >= entry.floor) ?? BANDS[BANDS.length - 1]
}

function ScoreMeter({ score }: { score: number }) {
  const tone = band(score)
  return (
    <div
      role="meter"
      aria-label="Match confidence"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(score * 100)}
      aria-valuetext={pct(score)}
      className={`h-2 w-full overflow-hidden rounded-full ${tone.track}`}
    >
      <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${score * 100}%` }} />
    </div>
  )
}

function Side({ title, source, role }: { title: string; source: string; role: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">
        {role} · {source}
      </p>
      <p className="mt-1 text-[15px] font-semibold leading-snug">{title}</p>
    </div>
  )
}

export function ReviewQueue() {
  const [candidates, setCandidates] = useState<MergeCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.reviewQueue().then((list) => {
      if (cancelled) return
      setCandidates(list)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const resolve = async (candidate: MergeCandidate, approve: boolean) => {
    setBusy(candidate.id)
    const next = await api.resolveReview(candidate.id, approve)
    setCandidates((prev) => prev.map((c) => (c.id === next.id ? next : c)))
    setBusy(null)
    toast.success(approve ? 'Merged into one trip' : 'Kept as two separate trips', {
      description: candidate.leftTitle,
    })
  }

  const pending = candidates.filter((candidate) => candidate.status === 'pending')
  const resolved = candidates.filter((candidate) => candidate.status !== 'pending')

  return (
    <AdminSection
      title="Review queue"
      hint="Matches above 0.86 merge on their own and matches below 0.60 become new trips. Everything in between lands here for a human decision, because a wrong merge loses a real product."
      action={
        pending.length > 0 ? (
          <Badge tone="warning">
            {pending.length} waiting on {pending.length === 1 ? 'a decision' : 'decisions'}
          </Badge>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <Empty
          icon={<CheckCheck />}
          title="The queue is clear, which is the good outcome"
          body="Every record that arrived from a feed either matched an existing trip confidently or was created as a new one. Uncertain matches appear here within a sync."
        />
      ) : (
        <ul className="space-y-4">
          {pending.map((candidate) => {
            const tone = band(candidate.score)
            return (
              <li key={candidate.id} className="rounded-2xl border bg-panel p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-semibold">{tone.label}</p>
                  <p className="text-xs text-muted-foreground">
                    match score <span className="tabular-nums">{pct(candidate.score)}</span>
                  </p>
                </div>
                <div className="mt-2">
                  <ScoreMeter score={candidate.score} />
                </div>

                <div className="mt-4 grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <Side title={candidate.leftTitle} source={candidate.leftSource} role="Existing" />
                  <ArrowLeftRight
                    aria-hidden
                    className="mx-auto size-4 shrink-0 text-muted-foreground"
                  />
                  <Side title={candidate.rightTitle} source={candidate.rightSource} role="Incoming" />
                </div>

                <p className="mt-4 text-xs font-medium text-muted-foreground">Why they matched</p>
                <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                  {candidate.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span aria-hidden>·</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    onClick={() => resolve(candidate, true)}
                    disabled={busy === candidate.id}
                  >
                    <ThumbsUp />
                    Approve merge
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resolve(candidate, false)}
                    disabled={busy === candidate.id}
                  >
                    <ThumbsDown />
                    Keep separate
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {resolved.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground">Recently resolved</p>
          <ul className="mt-2 space-y-2">
            {resolved.map((candidate) => (
              <li key={candidate.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={candidate.status === 'approved' ? 'success' : 'neutral'} size="sm">
                  {candidate.status === 'approved' ? 'Merged' : 'Kept separate'}
                </Badge>
                <span className="text-muted-foreground">
                  {candidate.leftTitle} · {candidate.rightSource}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AdminSection>
  )
}
