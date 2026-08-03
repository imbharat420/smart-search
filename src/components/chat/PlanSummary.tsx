// The readback of the six tracked trip parameters (docs/assistant-rag-architecture.md §1.5.1),
// rendered as a sibling of ParsedSummary.tsx: same panel, same chip primitive, same header line.
// Unlike QuickReplies.tsx — which draws its own buttons because a quick reply is an action, not a
// value — this is display-with-remove, so it uses ui/chip.tsx and its built-in remove affordance.

import { TriangleAlert } from 'lucide-react'
import type { BudgetBand, Pace, PlanSlot, TripPlanState } from '../../types'
import { money } from '../../lib/format'
import { Chip } from '../ui/chip'

interface PlanSummaryProps {
  state: TripPlanState
  onClear?: (slot: PlanSlot) => void
}

const SLOT_COUNT = 6

// plan.py only ever invalidates a slot because the region moved (`region` → `budget`), so the hint
// can name the cause; `state.unconfirmed` itself carries the invalidated slot, not the trigger.
const STALE_HINT = 'Worth double-checking since the region changed'

// Band shorthand mirrors the quick-reply chips in §2 ("Mid £1k-£3k"), so the readback reads back
// roughly the words the traveller tapped rather than money(1000) → "£1,000", which reads as a
// precision the band does not have. money() handles the explicit figure below, where it belongs.
const BUDGET_LABELS: Record<BudgetBand, string> = {
  budget: 'Budget under £1k',
  mid: 'Mid £1k–£3k',
  luxury: 'Luxury £3k+',
}

const PACE_LABELS: Record<Pace, string> = {
  slow: 'Easy pace',
  balanced: 'Balanced pace',
  packed: 'Packed days',
}

// Exported alongside slotChips(): a caller that reuses the table needs to be able to name its rows.
export interface PlanChip {
  key: string
  slot: PlanSlot
  label: string
}

// One table rather than six ternaries in the markup: the state-to-English mapping is the whole
// substance of this component, so it lives in one place that can be read top to bottom.
export function slotChips(state: TripPlanState): PlanChip[] {
  const chips: PlanChip[] = []

  if (state.durationDays !== undefined) {
    const unit = state.durationDays === 1 ? 'day' : 'days'
    chips.push({ key: 'duration', slot: 'duration', label: `About ${state.durationDays} ${unit}` })
  }

  // An explicit number beats a band: "around two grand" is a sharper answer than "mid-range".
  if (state.maxPrice !== undefined) {
    chips.push({ key: 'budget', slot: 'budget', label: `Up to ${money(state.maxPrice)}` })
  } else if (state.budgetBand) {
    chips.push({ key: 'budget', slot: 'budget', label: BUDGET_LABELS[state.budgetBand] })
  }

  if (state.region) {
    // The bucket name arrives ready to show ("Africa & Middle East") — recasing it would only
    // corrupt it.
    chips.push({ key: 'region', slot: 'region', label: state.region })
  }

  // One chip per theme, so a traveller who picked three can drop just the one they regret. Deduped
  // because a repeated theme would otherwise show twice under one React key.
  for (const theme of new Set(state.holidayType ?? [])) {
    chips.push({ key: `holidayType-${theme}`, slot: 'holidayType', label: theme })
  }

  if (state.pace) {
    chips.push({ key: 'pace', slot: 'pace', label: PACE_LABELS[state.pace] })
  }

  if (state.groupSize !== undefined) {
    const label =
      state.groupSize === 1 ? 'Solo' : state.groupSize === 2 ? 'Couple' : `${state.groupSize} travellers`
    chips.push({ key: 'groupSize', slot: 'groupSize', label })
  }

  return chips
}

export function PlanSummary({ state, onClear }: PlanSummaryProps) {
  const chips = slotChips(state)
  if (chips.length === 0) return null

  const unconfirmed = new Set(state.unconfirmed ?? [])
  const filled = new Set(chips.map((chip) => chip.slot)).size

  return (
    <div className="rounded-2xl border bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Your trip so far</p>
        <span className="text-xs tabular-nums text-muted-foreground">{filled} of {SLOT_COUNT} set</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          // A flagged slot keeps its value rather than being cleared: a stale answer still steers
          // retrieval, whereas an empty slot steers nothing and costs the traveller another question.
          const stale = unconfirmed.has(chip.slot)
          const element = (
            <Chip
              key={chip.key}
              label={chip.label}
              tone={stale ? 'warning' : 'brand'}
              icon={stale ? <TriangleAlert className="text-[var(--warning)]" /> : undefined}
              onRemove={onClear ? () => onClear(chip.slot) : undefined}
            />
          )
          if (!stale) return element
          // Chip takes no title of its own, so the hover explanation hangs on a wrapper; the
          // sr-only copy carries the same warning the tone and icon carry visually, and comes
          // first so it is heard before the value and its remove button.
          return (
            <span key={chip.key} className="inline-flex max-w-full items-center" title={STALE_HINT}>
              <span className="sr-only">{STALE_HINT}</span>
              {element}
            </span>
          )
        })}
      </div>
    </div>
  )
}
