import { CornerDownRight } from 'lucide-react'
import type { Citation, ParsedQuery, Trip, TripPlanState } from '../../types'

// One completed answer, reduced to the fields the suggestion rules read. Structural
// rather than ThreadMessage so this module depends on types.ts alone.
export interface FollowUpInput {
  question?: string
  trips?: Trip[]
  citations?: Citation[]
  state?: TripPlanState
  parsed?: ParsedQuery
  places?: unknown[]
  needsLocation?: unknown
}

// Each booking-conditions prompt is keyed by the words that mean it was just asked,
// so the row never suggests the question the traveller is currently reading the
// answer to. The prompts mirror rag.py's four policy documents.
const POLICY_PROMPTS: { asked: RegExp; prompt: string }[] = [
  { asked: /deposit|balance|instalment/i, prompt: 'How much deposit do I pay, and when is the balance due?' },
  { asked: /cancel|refund/i, prompt: 'What happens if I need to cancel?' },
  { asked: /baggage|luggage|suitcase/i, prompt: "What's the baggage allowance?" },
  { asked: /atol|protect|trading/i, prompt: 'Is my booking ATOL protected?' },
]

const MAX_SUGGESTIONS = 3

// Rounds a mid-range trip price up to a clean ceiling, so "under £1,500" reads like
// a person wrote it rather than "under £1,485".
function budgetCeiling(trips: Trip[]): number {
  const prices = trips.map((trip) => trip.priceFrom).sort((a, b) => a - b)
  const mid = prices[Math.floor(prices.length / 2)]
  return Math.max(500, Math.ceil(mid / 250) * 250)
}

/**
 * The next questions worth asking after this answer, in the traveller's own terms.
 *
 * Deliberately deterministic and client-side: the backend's quick-reply chips are
 * the next question while the six-slot plan is still being filled (plan.py owns
 * that), so this row only fills the turns where no chips came — a finished plan, a
 * loop-broken one, or a booking-conditions answer. Everything suggested here is a
 * question the system can genuinely answer from the catalogue or the four policy
 * documents, so a tap never leads to a dead end.
 */
export function buildFollowUps(input: FollowUpInput): string[] {
  // The near-me flow is a place-index lookup with its own affordances.
  if (input.needsLocation || (input.places && input.places.length > 0)) return []

  const question = input.question ?? ''
  const trips = input.trips ?? []
  const policyTurn = trips.length === 0 && (input.citations ?? []).some((c) => c.sourceId.startsWith('policy-'))

  if (policyTurn) {
    return POLICY_PROMPTS.filter(({ asked }) => !asked.test(question))
      .map(({ prompt }) => prompt)
      .slice(0, MAX_SUGGESTIONS)
  }

  if (trips.length === 0) {
    // Nothing matched (or the stream failed): offer ways forward that always answer.
    return ["Show me what's popular right now", 'Somewhere warm with direct flights', 'How much deposit do I pay?']
  }

  const out: string[] = []
  const budgetKnown =
    input.state?.maxPrice !== undefined || input.state?.budgetBand !== undefined || input.parsed?.maxPrice !== undefined
  if (!budgetKnown && trips.length > 1) out.push(`Only show trips under £${budgetCeiling(trips).toLocaleString('en-GB')}`)
  if (!input.parsed?.directFlights && trips.some((trip) => !trip.directFlights)) {
    out.push('Which of these have direct flights?')
  }
  if (!input.parsed?.months?.length) out.push('What months do these depart?')
  out.push(`Tell me more about ${trips[0].title}`)
  out.push('How much deposit would I pay?')
  return out.slice(0, MAX_SUGGESTIONS)
}

interface FollowUpSuggestionsProps {
  suggestions: string[]
  onPick: (prompt: string) => void
  disabled?: boolean
}

// The same pill as SuggestedPrompts/QuickReplies, so the thread speaks one chip
// language whether it is offering openers, answers or follow-ups.
const PILL =
  'max-w-full cursor-pointer rounded-full border bg-card px-4 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-40'

export function FollowUpSuggestions({ suggestions, onPick, disabled }: FollowUpSuggestionsProps) {
  if (suggestions.length === 0) return null

  return (
    <div role="group" aria-label="Suggested follow-up questions">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <CornerDownRight className="size-3.5 shrink-0" aria-hidden="true" />
        Ask next
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((prompt) => (
          <button key={prompt} type="button" disabled={disabled} onClick={() => onPick(prompt)} className={PILL}>
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}
