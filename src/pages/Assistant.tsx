import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Coords } from '../lib/geo'
import { milesBetween } from '../lib/geo'
import { usePageMeta } from '../lib/meta'
import type { NearMeIntent } from '../lib/nearMe'
import { parseNearMe } from '../lib/nearMe'
import { getStoredOrigin, setStoredOrigin } from '../lib/originStore'
import type { ChatMessage, Guide, ParsedQuery, Trip } from '../types'
import { ChatBubble } from '../components/chat/ChatBubble'
import type { ThreadMessage } from '../components/chat/ChatBubble'
import { Composer } from '../components/chat/Composer'
import { DiscoveryRails } from '../components/chat/DiscoveryRails'
import { ModelPill } from '../components/chat/ModelPill'
import { SuggestedPrompts } from '../components/chat/SuggestedPrompts'
import { parsedToFilters } from '../components/chat/parsedFilters'

const NEARBY_RESULT_LIMIT = 6

type HealthSnapshot = Awaited<ReturnType<typeof api.health>>

const HERO_IMAGE = 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=80'

const STREAM_FAILED =
  'The answer stopped early — the assistant stream closed before it finished. Send the question again, or open Search to browse the catalogue directly.'

export function Assistant() {
  usePageMeta(
    'AI assistant — TravelIQ',
    'Ask for a trip in your own words. TravelIQ answers from the trip catalogue and the booking conditions, and shows the trips and sources behind every reply.',
  )

  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<HealthSnapshot | null>(null)
  const [rails, setRails] = useState<{ trips: Trip[]; guides: Guide[] } | null>(null)
  // Shared with Discover.tsx via localStorage, so granting location once covers both.
  const [origin, setOrigin] = useState<Coords | null>(() => getStoredOrigin())

  const end = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const seq = useRef(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // None of these three throw: src/lib/api.ts degrades every read to the seeded catalogue.
      const [snapshot, response, guides] = await Promise.all([
        api.health(),
        api.search({ query: '', pageSize: 24 }),
        api.guides(),
      ])
      if (cancelled) return
      setHealth(snapshot)
      setRails({ trips: response.results.map((result) => result.trip), guides })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Follow the stream, unless the reader has scrolled up to re-read something.
  useEffect(() => {
    if (pinned.current) end.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // Below lg the thread has no scrollbar of its own and the page scrolls instead, so the pin has
  // to watch both.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      pinned.current = doc.scrollHeight - doc.scrollTop - doc.clientHeight < 120
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function patch(id: string, apply: (message: ThreadMessage) => ThreadMessage) {
    setMessages((prev) => prev.map((message) => (message.id === id ? apply(message) : message)))
  }

  // The count behind "See all N matches", so the button never promises results it cannot show.
  async function countMatches(id: string, query: string, parsed: ParsedQuery) {
    const filters = parsedToFilters(parsed)
    if (Object.keys(filters).length === 0) return
    const response = await api.search({ query, filters, page: 1, pageSize: 1 })
    patch(id, (message) => ({ ...message, matchTotal: response.total }))
  }

  // "Near me" bypasses the LLM entirely — it is a place-index lookup, not a
  // trip question, and the place index is the same one Discover.tsx reads.
  // /places has no notion of the reader's real coordinates (its own `radius`
  // narrows against each place's distance from a destination centre), so the
  // real distance is computed here exactly like Discover.tsx's `near` filter.
  async function answerNearby(id: string, here: Coords, radiusKm: number, radiusMiles: number) {
    const all = await api.places({})
    const nearby = all
      .map((place) => ({
        ...place,
        distanceMiles: Math.round(milesBetween(here, place) * 10) / 10,
      }))
      .filter((place) => place.distanceMiles <= radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
      .slice(0, NEARBY_RESULT_LIMIT)

    const radiusLabel = `${Math.round(radiusKm)} km`
    patch(id, (message) => ({
      ...message,
      content:
        nearby.length === 0
          ? `Nothing in the place index falls within ${radiusLabel} of your location. Try a wider radius, or open Discover to search a different area.`
          : `Here's what's within ${radiusLabel} of your location, closest first:`,
      places: nearby,
      needsLocation: undefined,
      streaming: false,
    }))
  }

  function handleShareLocation(replyId: string, shared: Coords, intent: NearMeIntent) {
    setOrigin(shared)
    setStoredOrigin(shared)
    patch(replyId, (message) => ({ ...message, streaming: true }))
    void answerNearby(replyId, shared, intent.radiusKm, intent.radiusMiles)
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return

    const replyId = `a${++seq.current}`
    const nearMe = parseNearMe(question)

    setMessages((prev) => [
      ...prev,
      { id: `u${++seq.current}`, role: 'user', content: question },
      { id: replyId, role: 'assistant', content: '', question, streaming: true },
    ])
    setDraft('')
    setBusy(true)
    pinned.current = true

    if (nearMe) {
      const here = origin ?? getStoredOrigin()
      if (here) {
        await answerNearby(replyId, here, nearMe.radiusKm, nearMe.radiusMiles)
      } else {
        patch(replyId, (message) => ({
          ...message,
          content:
            "I can pull up places near you, but I need your location first — share it, or name a neighbourhood or landmark instead.",
          needsLocation: { radiusKm: nearMe.radiusKm, radiusMiles: nearMe.radiusMiles },
          streaming: false,
        }))
      }
      setBusy(false)
      return
    }

    // Built before the optimistic append so the empty placeholder never reaches the model.
    const wire: ChatMessage[] = [
      ...messages.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: question },
    ]

    try {
      for await (const chunk of api.chat(wire)) {
        const { token, trips, citations, parsed, done } = chunk
        if (token) patch(replyId, (message) => ({ ...message, content: message.content + token }))
        if (trips) patch(replyId, (message) => ({ ...message, trips }))
        if (citations) patch(replyId, (message) => ({ ...message, citations }))
        if (parsed) {
          patch(replyId, (message) => ({ ...message, parsed }))
          void countMatches(replyId, question, parsed)
        }
        if (done) break
      }
    } catch {
      patch(replyId, (message) => ({
        ...message,
        content: message.content ? `${message.content}\n\n${STREAM_FAILED}` : STREAM_FAILED,
      }))
    } finally {
      patch(replyId, (message) => ({ ...message, streaming: false }))
      setBusy(false)
    }
  }

  const live = health !== null && health.status !== 'offline'

  return (
    <div className="lg:grid lg:h-screen lg:grid-cols-[1fr_1.15fr] lg:overflow-hidden">
      <section
        aria-label="TravelIQ assistant"
        // The 4rem is the mobile tab bar, which the shell only pads for below md.
        className="flex min-h-[calc(100dvh-4rem)] flex-col border-b md:min-h-screen lg:min-h-0 lg:border-b-0 lg:border-r"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-6 md:px-8">
          <div>
            <p className="text-sm font-semibold">TravelIQ assistant</p>
            <p className="text-xs text-muted-foreground">
              Grounded in the trip catalogue and the booking conditions
            </p>
          </div>
          <ModelPill
            provider={health?.chatProvider ?? null}
            live={live}
            loading={health === null}
          />
        </header>

        <div
          onScroll={(event) => {
            const element = event.currentTarget
            pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120
          }}
          // min-h-0 is what lets the thread scroll instead of pushing the composer off screen.
          className="scrollbar-thin flex min-h-0 flex-1 flex-col px-5 pb-6 md:px-8 lg:overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="m-auto w-full max-w-2xl py-6 text-center">
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Where to next?</h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
                Describe the trip in a sentence. TravelIQ reads the destination, month, budget and
                theme out of it, then answers from the catalogue with the sources it used.
              </p>
              <img
                src={HERO_IMAGE}
                alt="The northern lights over the mountains behind Tromso"
                loading="lazy"
                className="mx-auto mt-8 aspect-[16/10] w-full max-w-sm rounded-3xl bg-accent object-cover"
              />
              <SuggestedPrompts onPick={(prompt) => void send(prompt)} disabled={busy} />
            </div>
          ) : (
            <ol className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4">
              {messages.map((message) => (
                <li key={message.id}>
                  <ChatBubble
                    message={message}
                    onShareLocation={
                      message.needsLocation
                        ? (shared) => handleShareLocation(message.id, shared, message.needsLocation!)
                        : undefined
                    }
                  />
                </li>
              ))}
            </ol>
          )}
          <div ref={end} />
        </div>

        <div className="sticky bottom-16 z-10 border-t bg-background/95 px-5 py-4 backdrop-blur md:bottom-0 md:px-8">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send(draft)}
            onNearMe={() => void send('Places near me')}
            busy={busy}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Enter to send, Shift and Enter for a new line
          </p>
        </div>
      </section>

      <aside aria-label="Discover" className="scrollbar-thin bg-panel lg:overflow-y-auto">
        <DiscoveryRails
          trips={rails?.trips ?? []}
          guides={rails?.guides ?? []}
          loading={rails === null}
        />
      </aside>
    </div>
  )
}
