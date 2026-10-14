import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { History } from 'lucide-react'
import { api } from '../lib/api'
import type { Coords } from '../lib/geo'
import { milesBetween } from '../lib/geo'
import { usePageMeta } from '../lib/meta'
import type { NearMeIntent } from '../lib/nearMe'
import { parseNearMe } from '../lib/nearMe'
import { getStoredOrigin, setStoredOrigin } from '../lib/originStore'
import { getSessionId, resetSession, setSessionId } from '../lib/sessionStore'
import type {
  ChatHistoryResponse,
  ChatMessage,
  ChatSessionMeta,
  Guide,
  ParsedQuery,
  PlanSlot,
  QuickReply,
  Trip,
} from '../types'
import { ChatBubble } from '../components/chat/ChatBubble'
import type { ThreadMessage } from '../components/chat/ChatBubble'
import { ChatHistoryPanel } from '../components/chat/ChatHistoryPanel'
import { Composer } from '../components/chat/Composer'
import { DiscoveryRails } from '../components/chat/DiscoveryRails'
import { ModelPill } from '../components/chat/ModelPill'
import { PlanBar } from '../components/chat/PlanBar'
import { SuggestedPrompts } from '../components/chat/SuggestedPrompts'
import { parsedToFilters } from '../components/chat/parsedFilters'

const NEARBY_RESULT_LIMIT = 6

type HealthSnapshot = Awaited<ReturnType<typeof api.health>>

const HERO_IMAGE = 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=80'

const STREAM_FAILED =
  'The answer stopped early — the assistant stream closed before it finished. Send the question again, or open Search to browse the catalogue directly.'

// Removing a plan chip still goes through a normal turn: it is the traveller changing
// their mind, so it belongs in the transcript, and the backend has one door for state
// changes rather than a second endpoint that could disagree with this one. The patch
// carries the {clear} sentinel that backend/app/plan.py's merge understands; the
// sentence is what makes the thread still read like a conversation afterwards.
const CLEAR_PHRASE: Record<PlanSlot, string> = {
  duration: "Actually, let's leave the trip length open.",
  budget: "Actually, let's leave the budget open.",
  region: "Actually, let's leave the region open.",
  holidayType: "Actually, let's leave the holiday type open.",
  pace: "Actually, let's leave the pace open.",
  groupSize: "Actually, let's leave the group size open.",
}

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
  // The conversation id lives in the URL — /assistant/<id> — and keys both the
  // six-slot trip plan and the stored transcript (backend/app/sessions.py). The
  // URL is the source of truth: the drawer, New chat and the back button all
  // just navigate, and the route effect below loads whatever thread the URL
  // names. localStorage only remembers the *last* id, for bare /assistant.
  const navigate = useNavigate()
  const { sessionId: routeId } = useParams<{ sessionId: string }>()

  // Bare /assistant normalises to the last (or a fresh) conversation's URL, so
  // every open chat is bookmarkable and history entries always name a thread.
  useEffect(() => {
    if (!routeId) navigate(`/assistant/${getSessionId()}`, { replace: true })
  }, [routeId, navigate])

  // The routed chat becomes "the last one" that bare /assistant resumes.
  useEffect(() => {
    if (routeId) setSessionId(routeId)
  }, [routeId])

  // The chat drawer: every stored conversation, and whether it is on screen.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])

  // One stored transcript as ThreadMessages. Shared by the on-mount restore and
  // by picking a chat from the drawer, so both rebuild the screen identically.
  function buildThread(history: ChatHistoryResponse): ThreadMessage[] {
    let lastQuestion: string | undefined
    const thread: ThreadMessage[] = history.messages.map((message, i) => {
      const id = `h${++seq.current}`
      if (message.role === 'user') {
        lastQuestion = message.content
        return { id, role: 'user' as const, content: message.content }
      }
      return {
        id,
        role: 'assistant' as const,
        content: message.content,
        trips: message.trips,
        citations: message.citations,
        quickReplies: message.quickReplies,
        parsed: message.parsed,
        provider: message.provider,
        model: message.model,
        question: lastQuestion,
        // Only the thread's final chips may still be live — every earlier row
        // was already answered or superseded by the turns beneath it.
        quickRepliesUsed: i < history.messages.length - 1,
      }
    })

    // The plan as the last turn left it rides on the newest reply, the one
    // place PlanSummary is editable (see livePlan below).
    if (history.state) {
      for (let i = thread.length - 1; i >= 0; i--) {
        if (thread[i].role === 'assistant') {
          thread[i] = { ...thread[i], state: history.state }
          break
        }
      }
    }
    return thread
  }

  // Load the routed conversation — on mount, and again whenever the drawer, New
  // chat or the back button moves to another chat's URL. The backend keeps the
  // transcript per id; offline this quietly renders an empty thread and the
  // screen looks like a fresh chat.
  useEffect(() => {
    if (!routeId) return
    let cancelled = false
    // Switching URLs clears the screen first, so chat A's thread is never on
    // screen under chat B's address while B loads.
    setMessages([])
    setDraft('')

    const load = async () => {
      const [history, list] = await Promise.all([
        api.chatHistory(routeId),
        api.chatSessions(),
      ])
      if (cancelled) return
      setSessions(list)
      if (history.messages.length === 0) return
      const restored = buildThread(history)
      // Never clobber a message the traveller managed to send while this loaded.
      setMessages((prev) => (prev.length > 0 ? prev : restored))
    }

    void load()
    return () => {
      cancelled = true
    }
    // buildThread only touches refs, so routeId is genuinely the only dependency.
  }, [routeId])

  // A fresh conversation: mint a new id and go to its URL — the route effect
  // above does the clearing. The old chat stays stored under its own id.
  function startNewChat() {
    if (busy) return
    resetSession()
    setHistoryOpen(false)
    navigate(`/assistant/${getSessionId()}`)
  }

  // Drawer actions. The PATCH/DELETE endpoints answer with the refreshed list,
  // so applying their response keeps one source of truth for the ordering.
  function applySessions(next: ChatSessionMeta[] | null) {
    if (next) setSessions(next)
  }

  function openChat(id: string) {
    setHistoryOpen(false)
    if (busy || id === routeId) return
    navigate(`/assistant/${encodeURIComponent(id)}`)
  }

  async function handleDeleteChat(id: string) {
    applySessions(await api.deleteChatSession(id))
    // Deleting the open conversation leaves nothing at its URL — start fresh.
    if (id === routeId) {
      resetSession()
      navigate(`/assistant/${getSessionId()}`, { replace: true })
    }
  }

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

  async function send(text: string, slotPatch?: Record<string, unknown>) {
    const question = text.trim()
    // No routeId means the URL has not normalised yet (a millisecond on mount);
    // dropping the send beats a turn the store could never file anywhere.
    if (!question || busy || !routeId) return

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
      for await (const chunk of api.chat(wire, { sessionId: routeId, slotPatch })) {
        const { token, trips, citations, parsed, state, quickReplies, provider, model, done } = chunk
        if (token) patch(replyId, (message) => ({ ...message, content: message.content + token }))
        if (trips) patch(replyId, (message) => ({ ...message, trips }))
        if (citations) patch(replyId, (message) => ({ ...message, citations }))
        if (provider) patch(replyId, (message) => ({ ...message, provider, model }))
        if (state) patch(replyId, (message) => ({ ...message, state }))
        if (quickReplies) patch(replyId, (message) => ({ ...message, quickReplies }))
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
      // The first turn also titles the conversation server-side, and every turn
      // bumps its recency — refresh the drawer's list to match.
      void api.chatSessions().then(setSessions)
    }
  }

  // A tapped chip is a normal turn carrying an exact patch, so the backend never has to
  // read its own label back through the parser.
  function handleQuickReply(messageId: string, reply: QuickReply) {
    patch(messageId, (message) => ({ ...message, quickRepliesUsed: true }))
    void send(reply.value, reply.patch)
  }

  function handleClearSlot(slot: PlanSlot) {
    void send(CLEAR_PHRASE[slot], { clear: slot })
  }

  // Only the newest unanswered chip row is live, and only the newest plan is editable.
  // Older turns render read-only: their panels are a record of what the assistant knew
  // at the time, and letting someone edit a stale snapshot would write back a plan that
  // has since moved on. While a turn is in flight both are frozen, which is also what
  // gives the chips their disabled state (see ChatBubble).
  const reversed = [...messages].reverse()
  const liveChips = busy ? undefined : reversed.find((m) => m.quickReplies && !m.quickRepliesUsed)?.id
  const livePlan = busy ? undefined : reversed.find((m) => m.state)?.id
  // Follow-up suggestions ride the newest finished reply, but only when that turn is
  // not already asking its own question — two rows of things to tap would compete.
  const newestReply = reversed.find((m) => m.role === 'assistant')
  const liveFollowUps =
    busy || !newestReply || newestReply.streaming || newestReply.id === liveChips
      ? undefined
      : newestReply.id

  // What the plan bar's pills show: the plan as the newest turn left it.
  const planState = reversed.find((m) => m.state)?.state

  const live = health !== null && health.status !== 'offline'

  return (
    <div className="lg:grid lg:h-screen lg:grid-cols-[1fr_1.15fr] lg:overflow-hidden">
      <section
        aria-label="TravelIQ assistant"
        // The 4rem is the mobile tab bar, which the shell only pads for below md.
        className="flex min-h-[calc(100dvh-4rem)] flex-col border-b md:min-h-screen lg:min-h-0 lg:border-b-0 lg:border-r"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-6 md:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="Chat history"
              title="Chat history"
              className="cursor-pointer rounded-lg border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <History className="size-4" aria-hidden="true" />
            </button>
            <div>
              <p className="text-sm font-semibold">TravelIQ assistant</p>
              <p className="text-xs text-muted-foreground">
                Grounded in the trip catalogue and the booking conditions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={startNewChat}
                disabled={busy}
                className="cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
              >
                New chat
              </button>
            )}
            <ModelPill
              provider={health?.chatProvider ?? null}
              live={live}
              loading={health === null}
            />
          </div>
        </header>

        {/* The plan at a glance — Where · When · Who · Budget. Every Update is an
            ordinary turn with an exact slot patch, the same door the chips use. */}
        <div className="px-5 pb-3 md:px-8">
          <PlanBar
            state={planState}
            busy={busy}
            onApply={(sentence, slotPatch) => void send(sentence, slotPatch)}
          />
        </div>

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
                    onQuickReply={
                      message.id === liveChips
                        ? (reply) => handleQuickReply(message.id, reply)
                        : undefined
                    }
                    onClearSlot={message.id === livePlan ? handleClearSlot : undefined}
                    onFollowUp={
                      message.id === liveFollowUps ? (prompt) => void send(prompt) : undefined
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

      <ChatHistoryPanel
        open={historyOpen}
        sessions={sessions}
        activeId={routeId ?? ''}
        busy={busy}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => void openChat(id)}
        onNew={startNewChat}
        onPin={(id, pinned) => void api.updateChatSession(id, { pinned }).then(applySessions)}
        onRename={(id, title) => void api.updateChatSession(id, { title }).then(applySessions)}
        onDelete={(id) => void handleDeleteChat(id)}
      />
    </div>
  )
}
