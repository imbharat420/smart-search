import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Citation, ParsedQuery, UiMessage } from '../../types'
import { CitationPills } from './CitationPills'
import { InlineTripCard } from './InlineTripCard'
import { ParsedSummary } from './ParsedSummary'

// UiMessage plus the three things only the assistant screen tracks: the question this reply
// answers, what the query parser pulled out of it, and how many trips those filters match.
export interface ThreadMessage extends UiMessage {
  question?: string
  parsed?: ParsedQuery
  matchTotal?: number
}

const FLASH_MS = 1200

export function ChatBubble({ message }: { message: ThreadMessage }) {
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
            // Plain text on purpose: rendering markdown would need a sanitising renderer, which
            // this POC does not ship.
            <span className="whitespace-pre-wrap">{message.content}</span>
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
