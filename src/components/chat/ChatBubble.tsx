import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Citation, ParsedQuery, PlanSlot, QuickReply, UiMessage } from '../../types'
import type { Coords } from '../../lib/geo'
import { CitationPills } from './CitationPills'
import { FollowUpSuggestions, buildFollowUps } from './FollowUpSuggestions'
import { InlinePlaceCard } from './InlinePlaceCard'
import { InlineTripCard } from './InlineTripCard'
import { MessageProse } from './MessageProse'
import { ParsedSummary } from './ParsedSummary'
import { PlanSummary } from './PlanSummary'
import { QuickReplies } from './QuickReplies'
import { ShareLocationPrompt } from './ShareLocationPrompt'

// UiMessage plus the four things only the assistant screen tracks: the question this reply
// answers, what the query parser pulled out of it, how many trips those filters match, and
// whether this turn's chips have already been used.
export interface ThreadMessage extends UiMessage {
  question?: string
  parsed?: ParsedQuery
  matchTotal?: number
  quickRepliesUsed?: boolean
}

const FLASH_MS = 1200

interface ChatBubbleProps {
  message: ThreadMessage
  // Only needed when message.needsLocation is set — see Assistant.tsx.
  onShareLocation?: (origin: Coords) => void
  // All three omitted for historical turns, which renders them read-only: only the newest
  // reply's chips and follow-ups are live, and a plan slot is only editable from the
  // latest state.
  onQuickReply?: (reply: QuickReply) => void
  onClearSlot?: (slot: PlanSlot) => void
  onFollowUp?: (prompt: string) => void
}

export function ChatBubble({
  message,
  onShareLocation,
  onQuickReply,
  onClearSlot,
  onFollowUp,
}: ChatBubbleProps) {
  const cards = useRef(new Map<string, HTMLAnchorElement>())
  const flashTimer = useRef<number | undefined>(undefined)
  const [flashing, setFlashing] = useState<string | null>(null)

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  if (message.role === 'user') {
    return (
      <div className="animate-rise flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-3 text-[15px] leading-relaxed">
          {message.content}
        </p>
      </div>
    )
  }

  const streaming = message.streaming ?? false
  const markers = new Map<string, number>()
  message.citations?.forEach((citation, i) => markers.set(citation.sourceId, i + 1))

  function reveal(citation: Citation) {
    const card = cards.current.get(citation.sourceId)
    if (!card) {
      toast.message(citation.label, {
        description: 'Quoted from the booking conditions, so there is no trip card to jump to.',
      })
      return
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // A timed ring rather than a keyframe: src/index.css owns the global animations.
    setFlashing(citation.sourceId)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashing(null), FLASH_MS)
  }

  return (
    <div className="animate-rise flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
      >
        T
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-[15px] leading-relaxed">
          {message.content ? (
            // MessageProse renders the light markdown the model actually emits (bullets,
            // bold, headings) as React nodes — nothing is parsed as HTML, so no sanitiser
            // is needed. It also swaps the model's bracketed source ids for the numbered
            // markers the Sources row uses, so no raw trip or policy id reaches the reader.
            <MessageProse
              content={message.content}
              citations={message.citations}
              streaming={streaming}
              onCitation={reveal}
            />
          ) : (
            streaming && (
              <span className="text-muted-foreground">Retrieving trips and booking conditions</span>
            )
          )}
          {streaming && (
            <span
              aria-hidden="true"
              className="caret ml-1 h-[1.05em] translate-y-[0.15em] rounded-sm bg-foreground align-middle"
            />
          )}
        </div>

        {message.citations && message.citations.length > 0 && (
          <CitationPills citations={message.citations} onSelect={reveal} />
        )}

        {message.trips && message.trips.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {message.trips.map((trip) => (
              <InlineTripCard
                key={trip.id}
                trip={trip}
                marker={markers.get(trip.id) ?? markers.get(trip.slug)}
                flashing={flashing === trip.id || flashing === trip.slug}
                innerRef={(element) => {
                  // The backend cites trips by id and the offline fallback by slug, so register both.
                  if (!element) {
                    cards.current.delete(trip.id)
                    cards.current.delete(trip.slug)
                    return
                  }
                  cards.current.set(trip.id, element)
                  cards.current.set(trip.slug, element)
                }}
              />
            ))}
          </div>
        )}

        {message.places && message.places.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {message.places.map((place) => (
              <InlinePlaceCard key={place.id} place={place} />
            ))}
          </div>
        )}

        {message.needsLocation && onShareLocation && (
          <ShareLocationPrompt onShare={onShareLocation} />
        )}

        {/* After the cards, because the reply's own shape is answer-then-follow-up: the
            model addresses the question, the trips land, then it asks one thing more. */}
        {message.quickReplies && (
          <QuickReplies
            group={message.quickReplies}
            onPick={onQuickReply ?? (() => {})}
            disabled={message.streaming || !onQuickReply}
            answered={message.quickRepliesUsed}
          />
        )}

        {/* The turns the plan chips do not cover — a finished plan, a loop-broken one,
            or a booking-conditions answer — still end with somewhere to go next.
            Live only on the newest completed reply, like the chips above. */}
        {onFollowUp && !streaming && (
          <FollowUpSuggestions suggestions={buildFollowUps(message)} onPick={onFollowUp} />
        )}

        {message.state && (
          <PlanSummary state={message.state} onClear={onClearSlot} />
        )}

        {message.parsed && (
          <ParsedSummary
            parsed={message.parsed}
            query={message.question ?? ''}
            total={message.matchTotal}
          />
        )}
      </div>
    </div>
  )
}
