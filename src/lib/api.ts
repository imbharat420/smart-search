// Typed client for the TravelIQ backend (see docs/architecture.md for the route table).
//
// Two rules shape this module. Every request is bounded by a 6s abort, and every
// read degrades to the seeded catalogue in src/mock instead of throwing, so the
// POC still demonstrates the product when FastAPI or Postgres is not running.
// `usingMockData()` flips true the first time that happens and the shell shows a
// "demo data" pill.

import type {
  AdminConfig,
  AnalyticsOverview,
  ChatChunk,
  ChatMessage,
  DataSource,
  Destination,
  Guide,
  MergeCandidate,
  Place,
  Promotion,
  SearchFilters,
  SearchResponse,
  Synonym,
  Trip,
  TripDetail,
} from '../types'
import {
  DESTINATIONS,
  THEMES,
  TRIPS,
  localAnalytics,
  localParse,
  localSearch,
  localTrip,
} from '../mock/catalog'
import { GUIDES } from '../mock/guides'
import { PLACES } from '../mock/places'
import { ADMIN_CONFIG, PROMOTIONS, REVIEW_QUEUE, SOURCES, SYNONYMS } from '../mock/admin'
import { money } from './format'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'
const TIMEOUT_MS = 6000

let fellBack = false
let localSeq = 0

export function usingMockData(): boolean {
  return fellBack
}

class HttpError extends Error {
  readonly status: number

  constructor(path: string, status: number) {
    super(`${path} responded ${status}`)
    this.status = status
  }
}

// A 200 whose body is not the shape this client expects. It happens when an older
// build of the API is still running — the ShopSense backend answered /search with a
// bare SearchResult[], which then surfaced as "cannot read properties of undefined"
// deep inside a page. Treating it as a fallback keeps the UI honest instead.
class ContractError extends Error {
  constructor(path: string) {
    super(`${path} answered with an unexpected shape`)
  }
}

const skewWarned = new Set<string>()

function warnSkew(path: string): void {
  if (skewWarned.has(path)) return
  skewWarned.add(path)
  console.warn(
    `[traveliq] ${BASE_URL}${path} answered 200 with a body this client does not recognise, ` +
      'so the seeded catalogue is being used for it. This usually means an older backend build ' +
      'is still running — restart it with: uv run uvicorn app.main:app --reload --port 8000',
  )
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isArrayOf = (value: unknown): boolean => Array.isArray(value)

const hasArrays = (value: unknown, keys: string[]): boolean =>
  isObject(value) && keys.every((key) => Array.isArray(value[key]))

const isSearchResponse = (value: unknown): boolean =>
  hasArrays(value, ['results', 'facets']) && isObject(value) && isObject(value.parsed)

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
    if (!res.ok) throw new HttpError(path, res.status)
    // DELETE endpoints answer with an empty body, which JSON.parse would choke on.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  } finally {
    window.clearTimeout(timer)
  }
}

async function withFallback<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: () => T,
  accept?: (value: unknown) => boolean,
): Promise<T> {
  try {
    const data = await request<T>(path, init)
    if (accept && !accept(data)) throw new ContractError(path)
    return data
  } catch (err) {
    fellBack = true
    if (err instanceof ContractError) warnSkew(path)
    return fallback()
  }
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

// Mutable copies of the seeded admin data, so the admin screens still respond to
// edits while the backend is unreachable. Nothing here survives a reload.
const offline: {
  config: AdminConfig
  synonyms: Synonym[]
  promotions: Promotion[]
  sources: DataSource[]
  reviewQueue: MergeCandidate[]
} = {
  config: { ...ADMIN_CONFIG },
  synonyms: [...SYNONYMS],
  promotions: [...PROMOTIONS],
  sources: [...SOURCES],
  reviewQueue: [...REVIEW_QUEUE],
}

function localSuggest(q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const pool = [
    ...DESTINATIONS.map((d) => d.name),
    ...THEMES,
    ...TRIPS.map((t) => t.title),
  ]
  const seen = new Set<string>()
  const hits: string[] = []
  for (const candidate of pool) {
    const lower = candidate.toLowerCase()
    if (!lower.includes(needle) || seen.has(lower)) continue
    seen.add(lower)
    hits.push(candidate)
    if (hits.length === 6) break
  }
  return hits
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function offlineAnswer(trips: Trip[]): string {
  if (trips.length === 0) {
    return 'I cannot reach the TravelIQ service, so I am answering from the seeded demo catalogue — and nothing in it is a close match. Try naming a month, a budget in pounds, or a theme such as the northern lights. Start the FastAPI backend for grounded answers with citations.'
  }
  const [lead, ...rest] = trips
  let text = `The TravelIQ service is unreachable, so this answer comes from the seeded demo catalogue. The closest match is ${lead.title} in ${lead.destination.name} — ${lead.durationDays} days from ${money(lead.priceFrom)} per person.`
  if (rest.length > 0) {
    text += ` Also worth a look: ${rest.map((t) => `${t.title} (${money(t.priceFrom)})`).join(' and ')}.`
  }
  return `${text} Start the FastAPI backend for live retrieval, policy citations, streamed reasoning and the guided trip plan.`
}

// Canned stream used when /chat cannot be opened. It is grounded in the same
// local catalogue the search fallback uses, so the demo stays coherent.
//
// It deliberately emits no `state` or `quickReplies`: the six-slot plan lives in
// backend/app/plan.py, and reimplementing its merge and loop-break rules here would
// put the conversation's behaviour in two places that could disagree. Offline the
// assistant answers without chips and `offlineAnswer` says so, which is the same
// honest-degradation line the rest of this module takes.
async function* offlineChat(messages: ChatMessage[]): AsyncGenerator<ChatChunk> {
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const parsed = localParse(question)
  const trips = localSearch({ query: question, pageSize: 3 }).results.slice(0, 3).map((r) => r.trip)

  await wait(280)
  yield { parsed }

  for (const word of offlineAnswer(trips).split(/(\s+)/)) {
    yield { token: word }
    if (word.trim()) await wait(16 + Math.random() * 22)
  }

  if (trips.length > 0) {
    yield { trips }
    yield {
      citations: trips.map((t) => ({
        id: `demo-${t.slug}`,
        label: t.title,
        sourceId: t.slug,
      })),
    }
  }
  yield { done: true }
}

/** Everything a chat turn carries beyond the transcript itself. */
export interface ChatTurnOptions {
  // Keys the backend's plan state (see src/lib/sessionStore.ts). Omitted means the
  // turn still answers, it just starts from an empty plan.
  sessionId?: string
  // Set only when the traveller tapped a quick-reply chip. Passed through verbatim —
  // the patch is the backend's own vocabulary and this client never reads into it.
  slotPatch?: Record<string, unknown>
}

async function openChatStream(
  messages: ChatMessage[],
  opts: ChatTurnOptions,
): Promise<Response | null> {
  const controller = new AbortController()
  // Only the response headers are on a clock; the stream itself may run for a while.
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        sessionId: opts.sessionId,
        slotPatch: opts.slotPatch,
      }),
      signal: controller.signal,
    })
    return res.ok ? res : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export const api = {
  search(body: {
    query: string
    filters?: SearchFilters
    page?: number
    pageSize?: number
    sort?: string
  }): Promise<SearchResponse> {
    return withFallback('/search', jsonBody('POST', body), () => localSearch(body), isSearchResponse)
  },

  async suggest(q: string): Promise<string[]> {
    const params = new URLSearchParams({ q })
    const data = await withFallback<{ suggestions: string[] }>(
      `/suggest?${params}`,
      undefined,
      () => ({ suggestions: localSuggest(q) }),
      (value) => hasArrays(value, ['suggestions']),
    )
    return data.suggestions ?? []
  },

  destinations(): Promise<Destination[]> {
    return withFallback('/destinations', undefined, () => DESTINATIONS, isArrayOf)
  },

  async trip(slug: string): Promise<TripDetail> {
    try {
      const detail = await request<TripDetail>(`/trips/${encodeURIComponent(slug)}`)
      if (!hasArrays(detail, ['itinerary', 'departures'])) throw new ContractError('/trips')
      return detail
    } catch (err) {
      // A 404 is a real answer from a healthy backend, so it is not a fallback case.
      if (err instanceof HttpError && err.status === 404) throw new Error('not-found')
      fellBack = true
      if (err instanceof ContractError) warnSkew('/trips')
      const local = localTrip(slug)
      if (!local) throw new Error('not-found')
      return local
    }
  },

  guides(): Promise<Guide[]> {
    return withFallback('/guides', undefined, () => GUIDES, isArrayOf)
  },

  places(params?: { q?: string; category?: string }): Promise<Place[]> {
    const query = new URLSearchParams()
    if (params?.q) query.set('q', params.q)
    if (params?.category) query.set('category', params.category)
    const suffix = query.toString() ? `?${query}` : ''
    return withFallback(`/places${suffix}`, undefined, () =>
      PLACES.filter((p) => {
        if (params?.category && p.category !== params.category) return false
        if (!params?.q) return true
        const needle = params.q.toLowerCase()
        return (
          p.name.toLowerCase().includes(needle) ||
          p.type.toLowerCase().includes(needle) ||
          p.location.toLowerCase().includes(needle)
        )
      }),
      isArrayOf,
    )
  },

  async *chat(messages: ChatMessage[], opts: ChatTurnOptions = {}): AsyncGenerator<ChatChunk> {
    const res = await openChatStream(messages, opts)
    const body = res?.body
    if (!body) {
      fellBack = true
      yield* offlineChat(messages)
      return
    }

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Server-Sent Events are separated by a blank line.
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const evt of events) {
        const line = evt.trim()
        if (!line.startsWith('data:')) continue
        const json = line.slice('data:'.length).trim()
        if (json) yield JSON.parse(json) as ChatChunk
      }
    }
  },

  async event(body: {
    type: 'impression' | 'click' | 'booking'
    searchId?: string
    tripId?: string
    position?: number
    value?: number
  }): Promise<void> {
    // Analytics must never break a page, so a failed beacon is simply dropped.
    await withFallback<{ ok: boolean }>('/events', jsonBody('POST', body), () => ({ ok: false }))
  },

  analytics(days = 30): Promise<AnalyticsOverview> {
    return withFallback(
      `/analytics/overview?days=${days}`,
      undefined,
      () => localAnalytics(),
      (value) => hasArrays(value, ['topQueries', 'zeroResults', 'timeline']),
    )
  },

  adminConfig(): Promise<AdminConfig> {
    return withFallback(
      '/admin/config',
      undefined,
      () => offline.config,
      (value) => hasArrays(value, ['searchableFields', 'enabledFilters']),
    )
  },

  saveAdminConfig(cfg: AdminConfig): Promise<AdminConfig> {
    return withFallback('/admin/config', jsonBody('PUT', cfg), () => {
      offline.config = cfg
      return cfg
    })
  },

  synonyms(): Promise<Synonym[]> {
    return withFallback('/admin/synonyms', undefined, () => offline.synonyms, isArrayOf)
  },

  addSynonym(s: Omit<Synonym, 'id'>): Promise<Synonym> {
    return withFallback('/admin/synonyms', jsonBody('POST', s), () => {
      const created: Synonym = { ...s, id: `local-syn-${++localSeq}` }
      offline.synonyms = [created, ...offline.synonyms]
      return created
    })
  },

  async deleteSynonym(id: string): Promise<void> {
    await withFallback<void>(`/admin/synonyms/${id}`, { method: 'DELETE' }, () => {
      offline.synonyms = offline.synonyms.filter((s) => s.id !== id)
    })
  },

  promotions(): Promise<Promotion[]> {
    return withFallback('/admin/promotions', undefined, () => offline.promotions, isArrayOf)
  },

  addPromotion(p: Omit<Promotion, 'id'>): Promise<Promotion> {
    return withFallback('/admin/promotions', jsonBody('POST', p), () => {
      const created: Promotion = { ...p, id: `local-promo-${++localSeq}` }
      offline.promotions = [created, ...offline.promotions]
      return created
    })
  },

  async deletePromotion(id: string): Promise<void> {
    await withFallback<void>(`/admin/promotions/${id}`, { method: 'DELETE' }, () => {
      offline.promotions = offline.promotions.filter((p) => p.id !== id)
    })
  },

  sources(): Promise<DataSource[]> {
    return withFallback('/admin/sources', undefined, () => offline.sources, isArrayOf)
  },

  syncSource(key: string): Promise<DataSource> {
    return withFallback(`/admin/sources/${key}/sync`, { method: 'POST' }, () => {
      const syncedAt = new Date().toISOString()
      offline.sources = offline.sources.map((s) =>
        s.key === key ? { ...s, status: 'healthy' as const, lastSyncAt: syncedAt } : s,
      )
      return offline.sources.find((s) => s.key === key) ?? offline.sources[0]
    })
  },

  reviewQueue(): Promise<MergeCandidate[]> {
    return withFallback('/admin/review-queue', undefined, () => offline.reviewQueue, isArrayOf)
  },

  resolveReview(id: string, approve: boolean): Promise<MergeCandidate> {
    const path = `/admin/review-queue/${id}/${approve ? 'approve' : 'reject'}`
    return withFallback(path, { method: 'POST' }, () => {
      const status = approve ? ('approved' as const) : ('rejected' as const)
      offline.reviewQueue = offline.reviewQueue.map((c) => (c.id === id ? { ...c, status } : c))
      return offline.reviewQueue.find((c) => c.id === id) ?? offline.reviewQueue[0]
    })
  },

  health(): Promise<{
    status: string
    db: string
    mode?: string
    trips: number
    chatProvider: string | null
  }> {
    return withFallback(
      '/health',
      undefined,
      () => ({
        status: 'offline',
        db: 'mock',
        mode: 'mock',
        trips: TRIPS.length,
        chatProvider: null,
      }),
      // An older build reports `products` instead of `trips` and has no `db`.
      (value) => isObject(value) && typeof value.trips === 'number' && 'db' in value,
    )
  },
}
