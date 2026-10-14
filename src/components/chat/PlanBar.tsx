import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import type { BudgetBand, TripPlanState } from '../../types'
import { cn } from '../../lib/utils'

// The same five buckets backend/app/plan.py's region chips use — a patch value
// outside this list would be dropped by its coercion, so the dialog only offers
// what the plan can actually hold.
const REGIONS = ['Europe', 'Asia', 'Americas', 'Africa & Middle East', 'Oceania'] as const

const BUDGETS: { band: BudgetBand | null; label: string; blurb: string }[] = [
  { band: null, label: 'Any budget', blurb: 'Leave it open' },
  { band: 'budget', label: '£ On a budget', blurb: 'Best value trips first' },
  { band: 'mid', label: '££ Mid-range', blurb: 'Comfort without the splurge' },
  { band: 'luxury', label: '£££ Luxury', blurb: 'The premium end of the catalogue' },
]

const BUDGET_PILL: Record<BudgetBand, string> = {
  budget: '£ Budget',
  mid: '££ Mid-range',
  luxury: '£££ Luxury',
}

type Slot = 'where' | 'when' | 'who' | 'budget'

interface PlanBarProps {
  state?: TripPlanState
  busy: boolean
  // The dialogs do not talk to the backend themselves: an Update is one ordinary
  // chat turn — a sentence for the transcript plus an exact slot patch — the same
  // contract the quick-reply chips use, so the plan has one door for changes.
  onApply: (sentence: string, patch: Record<string, unknown>) => void
}

/**
 * The plan at a glance, on top of the thread: Where · When · Who · Budget.
 *
 * Each pill shows its slot's current value once the plan holds one, and opens a
 * small dialog to set or clear it. The assistant still asks its own questions in
 * order — this bar is for the traveller who already knows the answer and does
 * not want to wait to be asked.
 */
export function PlanBar({ state, busy, onApply }: PlanBarProps) {
  const [openSlot, setOpenSlot] = useState<Slot | null>(null)
  const [days, setDays] = useState(7)
  const [travellers, setTravellers] = useState(2)

  useEffect(() => {
    if (!openSlot) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenSlot(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSlot])

  function open(slot: Slot) {
    // Seed the dialog from the live plan so Update-without-touching keeps what
    // the assistant already knows instead of resetting it.
    if (slot === 'when') setDays(state?.durationDays ?? 7)
    if (slot === 'who') setTravellers(state?.groupSize ?? 2)
    setOpenSlot(slot)
  }

  function apply(sentence: string, patch: Record<string, unknown>) {
    setOpenSlot(null)
    onApply(sentence, patch)
  }

  const pills: { slot: Slot; label: string; set: boolean }[] = [
    { slot: 'where', label: state?.region ?? 'Where', set: Boolean(state?.region) },
    {
      slot: 'when',
      label: state?.durationDays ? `${state.durationDays} days` : 'When',
      set: Boolean(state?.durationDays),
    },
    {
      slot: 'who',
      label: state?.groupSize
        ? `${state.groupSize} traveller${state.groupSize === 1 ? '' : 's'}`
        : 'Who',
      set: Boolean(state?.groupSize),
    },
    {
      slot: 'budget',
      label: state?.budgetBand ? BUDGET_PILL[state.budgetBand] : 'Budget',
      set: Boolean(state?.budgetBand),
    },
  ]

  return (
    <>
      <div
        role="group"
        aria-label="Trip plan"
        className="mx-auto flex w-fit max-w-full items-center overflow-x-auto rounded-full border bg-card px-1 py-1"
      >
        {pills.map(({ slot, label, set }, i) => (
          <button
            key={slot}
            type="button"
            disabled={busy}
            onClick={() => open(slot)}
            className={cn(
              'cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60',
              set ? 'font-semibold' : 'text-muted-foreground',
              i > 0 && 'border-l border-border/60 rounded-l-none',
              i < pills.length - 1 && 'rounded-r-none',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {openSlot === 'where' && (
        <Sheet title="Where" subtitle="Pick a part of the world" onClose={() => setOpenSlot(null)}>
          <ul className="flex flex-col gap-1">
            {REGIONS.map((region) => (
              <li key={region}>
                <button
                  type="button"
                  onClick={() => apply(`Let's focus on ${region}.`, { region })}
                  className={cn(
                    'w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                    state?.region === region && 'bg-accent font-semibold',
                  )}
                >
                  {region}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() =>
                  apply("Actually, let's leave the region open.", { clear: 'region' })
                }
                className="w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                Anywhere — leave it open
              </button>
            </li>
          </ul>
        </Sheet>
      )}

      {openSlot === 'when' && (
        <Sheet
          title="When"
          subtitle="How many days?"
          onClose={() => setOpenSlot(null)}
          footer={
            <SheetActions
              onClear={() => apply("Actually, let's leave the trip length open.", { clear: 'duration' })}
              clearLabel="Clear"
              onUpdate={() => apply(`Plan for ${days} days.`, { durationDays: days })}
            />
          }
        >
          <Stepper
            value={days}
            min={1}
            max={60}
            onChange={setDays}
            format={(n) => `${n} day${n === 1 ? '' : 's'}`}
          />
        </Sheet>
      )}

      {openSlot === 'who' && (
        <Sheet
          title="Who"
          subtitle={`${travellers} traveller${travellers === 1 ? '' : 's'}`}
          onClose={() => setOpenSlot(null)}
          footer={
            <SheetActions
              onClear={() => apply("Actually, let's leave the group size open.", { clear: 'groupSize' })}
              clearLabel="Clear"
              onUpdate={() =>
                apply(
                  travellers === 1
                    ? 'It will just be me travelling.'
                    : `There will be ${travellers} of us travelling.`,
                  { groupSize: travellers },
                )
              }
            />
          }
        >
          <Stepper
            value={travellers}
            min={1}
            max={40}
            onChange={setTravellers}
            format={(n) => `${n}`}
          />
        </Sheet>
      )}

      {openSlot === 'budget' && (
        <Sheet title="Budget" subtitle="Select your budget range" onClose={() => setOpenSlot(null)}>
          <ul className="flex flex-col gap-1">
            {BUDGETS.map(({ band, label, blurb }) => {
              const selected = (state?.budgetBand ?? null) === band
              return (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() =>
                      band === null
                        ? apply("Actually, let's leave the budget open.", { clear: 'budget' })
                        : apply(
                            band === 'budget'
                              ? "Let's keep it budget-friendly."
                              : band === 'mid'
                                ? 'A mid-range budget works for us.'
                                : "We're happy to go luxury.",
                            { budgetBand: band },
                          )
                    }
                    className={cn(
                      'w-full cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent',
                      selected && 'bg-accent',
                    )}
                  >
                    <span className={cn('block text-sm', selected && 'font-semibold')}>{label}</span>
                    <span className="block text-xs text-muted-foreground">{blurb}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
    </>
  )
}

function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div className="animate-rise relative w-full max-w-sm rounded-2xl border bg-background p-5 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute left-4 top-4 cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div className="mb-4 text-center">
          <p className="text-base font-semibold">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
        {footer}
      </div>
    </div>
  )
}

function SheetActions({
  onClear,
  clearLabel,
  onUpdate,
}: {
  onClear: () => void
  clearLabel: string
  onUpdate: () => void
}) {
  return (
    <div className="mt-5 flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onClear}
        className="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
      >
        {clearLabel}
      </button>
      <button
        type="button"
        onClick={onUpdate}
        className="cursor-pointer rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Update
      </button>
    </div>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
  format,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  format: (n: number) => string
}) {
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Fewer"
        className="flex size-9 cursor-pointer items-center justify-center rounded-full border transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <span className="min-w-20 text-center text-lg font-semibold tabular-nums">
        {format(value)}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="More"
        className="flex size-9 cursor-pointer items-center justify-center rounded-full border transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
