// The shared TravelIQ domain. Every shape here matches the backend wire format
// field-for-field (see backend/app/schemas.py), so the UI is written once and the
// mock layer in src/mock/ is the only thing that gets swapped out.

export type Climate = 'warm' | 'mild' | 'cold'
export type Audience = 'Family' | 'Couples' | 'Solo' | 'Small groups' | 'Adventure'

export interface Destination {
  id: string
  slug: string
  name: string
  country: string
  region: string
  lat: number
  lng: number
  imageUrl: string
}

export interface Departure {
  id: string
  date: string // ISO yyyy-mm-dd
  price: number
  seatsLeft: number
  direct: boolean
}

export interface Trip {
  id: string
  slug: string
  title: string
  summary: string
  description: string
  destination: Destination
  themes: string[] // 'Northern Lights', 'Beach', 'City break', 'Wildlife', 'Culture'
  activities: string[] // 'Walking', 'Diving', 'Skiing', 'Food tour'
  audience: Audience[]
  durationDays: number
  priceFrom: number
  currency: 'GBP'
  rating: number // 0..5
  reviewCount: number
  climate: Climate
  months: number[] // 1..12 departure months
  directFlights: boolean
  groupSizeMax: number
  available: boolean
  imageUrl: string
  gallery: string[]
  supplier: string
  sources: string[] // provenance: 'cms' | 'supplier-atlas' | 'enrichment'
  pinned?: boolean
  badges?: string[]
}

export interface ParsedQuery {
  destination?: string
  months?: number[]
  durationDays?: number
  maxPrice?: number
  themes?: string[]
  activities?: string[]
  audience?: string[]
  climate?: Climate
  groupSizeMax?: number
  directFlights?: boolean
  source: 'ai' | 'heuristic' // which layer produced this
  confidence: number // 0..1
}

export interface SearchFilters {
  destination?: string
  theme?: string
  activity?: string
  month?: number
  minDuration?: number
  maxDuration?: number
  maxPrice?: number
  climate?: Climate
  directOnly?: boolean
  availableOnly?: boolean
  audience?: string
}

export interface FacetValue {
  value: string
  label: string
  count: number
}

export interface Facet {
  key: keyof SearchFilters | string
  label: string
  values: FacetValue[]
}

export interface SearchResult {
  trip: Trip
  score: number // 0..1 relevance
  matchedOn: string[] // 'theme: Northern Lights', 'month: November'
}

export interface SearchResponse {
  searchId: string
  results: SearchResult[]
  total: number
  page: number
  pageSize: number
  facets: Facet[]
  parsed: ParsedQuery
  tookMs: number
  mode: 'semantic' | 'lexical' // which retrieval layer answered
  suggestions?: string[] // shown when total === 0
}

export interface ItineraryDay {
  day: number
  title: string
  detail: string
}

export interface TripDetail {
  trip: Trip
  itinerary: ItineraryDay[]
  departures: Departure[]
  similar: Trip[]
  included: string[]
  policyIds: string[]
}

export interface Guide {
  id: string
  slug: string
  title: string
  location: string
  author: string
  days: number
  imageUrl: string
  tags: string[]
}

export interface Place {
  id: string
  name: string
  type: string // 'museum' | 'restaurant' | 'hotel' | 'landmark' | 'trip'
  category: 'things-to-do' | 'restaurants' | 'stays' | 'trips'
  location: string
  rating?: number
  distanceMiles: number
  price?: string
  lat: number
  lng: number
  imageUrl: string
}

export interface Citation {
  id: string
  label: string
  sourceId: string
}

// ---- assistant plan state ----
// Mirrors backend/app/schemas.py TripPlanState / QuickReply / QuickReplyGroup.
// The six parameters the assistant tracks across a conversation, held as one
// explicit object rather than re-read from the transcript each turn.

export type BudgetBand = 'budget' | 'mid' | 'luxury'
export type Pace = 'slow' | 'balanced' | 'packed'
export type PlanSlot = 'duration' | 'budget' | 'region' | 'holidayType' | 'pace' | 'groupSize'

export interface TripPlanState {
  durationDays?: number
  budgetBand?: BudgetBand
  maxPrice?: number
  region?: string
  holidayType?: string[]
  pace?: Pace
  groupSize?: number
  // Bookkeeping the backend owns; the UI reads `unconfirmed` to mark a slot that
  // a later change may have invalidated, and otherwise leaves these alone.
  skipCounts?: Record<string, number>
  askedCounts?: Record<string, number>
  turnCount?: number
  unconfirmed?: string[]
}

/** One tappable chip. `value` lands in the transcript, `patch` updates the state. */
export interface QuickReply {
  label: string
  value: string
  patch?: Record<string, unknown>
}

/** The chips accompanying one question — one slot per turn, always with a skip. */
export interface QuickReplyGroup {
  slot: PlanSlot
  prompt: string
  options: QuickReply[]
  skip: QuickReply
}

/**
 * One streamed piece of a chat response. Arrival order is the contract:
 * parsed, state, trips, quickReplies, tokens, citations, done.
 */
export interface ChatChunk {
  token?: string
  trips?: Trip[]
  citations?: Citation[]
  parsed?: ParsedQuery
  state?: TripPlanState
  quickReplies?: QuickReplyGroup
  // Which provider/model answered this turn. Per-turn, not per-session: the
  // backend's fallback chain means consecutive replies can come from different
  // models, which is exactly what the pill on the bubble is there to show.
  provider?: string
  model?: string
  done?: boolean
}

/** Wire shape sent to `api.chat`. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** A chat message as held in the UI, enriched with whatever streamed alongside it. */
export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  trips?: Trip[]
  citations?: Citation[]
  streaming?: boolean
  // The plan as it stood after this turn, and the chips this turn is asking with.
  // Both are per-message rather than per-thread so scrolling back shows what the
  // assistant knew at the time instead of rewriting history.
  state?: TripPlanState
  quickReplies?: QuickReplyGroup
  // Which of the multi-provider chain answered this reply (absent on user
  // messages, offline turns, and turns older than this field).
  provider?: string
  model?: string
  // "near me" handling (src/lib/nearMe.ts) is a client-side shortcut around the
  // place index, not part of the streamed trip-chat contract — set at most one
  // of the two below at a time.
  places?: Place[]
  needsLocation?: { radiusKm: number; radiusMiles: number }
}

/** One restored message from GET /chat/history — the persisted subset of UiMessage. */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  trips?: Trip[]
  citations?: Citation[]
  quickReplies?: QuickReplyGroup
  parsed?: ParsedQuery
  provider?: string
  model?: string
}

/** GET /chat/history response: the transcript plus the plan as the last turn left it. */
export interface ChatHistoryResponse {
  sessionId: string
  messages: ChatHistoryMessage[]
  state?: TripPlanState
}

/** One row of the chat list (GET /chat/sessions): label, sort keys, actions state. */
export interface ChatSessionMeta {
  sessionId: string
  title?: string
  pinned?: boolean
  updatedAt?: string
  turnCount?: number
}

// ---- admin + analytics ----

export interface SearchableField {
  field: string
  weight: number
  enabled: boolean
}

export interface Synonym {
  id: string
  term: string
  alternatives: string[]
  market: string
}

export interface Promotion {
  id: string
  tripId: string
  tripTitle: string
  kind: 'pin' | 'boost' | 'hide'
  weight: number
  startsAt?: string
  endsAt?: string
}

export interface DataSource {
  id: string
  key: string
  label: string
  kind: 'cms' | 'supplier' | 'enrichment'
  status: 'healthy' | 'syncing' | 'stale' | 'error'
  lastSyncAt?: string
  recordCount: number
  fieldPriority: string[] // ordered field names this source wins
}

export interface MergeCandidate {
  id: string
  leftTitle: string
  rightTitle: string
  leftSource: string
  rightSource: string
  score: number // 0..1 match confidence
  reasons: string[]
  status: 'pending' | 'approved' | 'rejected'
}

export interface AdminConfig {
  searchableFields: SearchableField[]
  enabledFilters: string[]
  resultsPerPage: number
  fallbackToLexical: boolean
}

export interface TopQuery {
  query: string
  searches: number
  ctr: number
  conversion: number
}

export interface ZeroResultQuery {
  query: string
  searches: number
  lastSeen: string
}

export interface TimelinePoint {
  date: string
  searches: number
  clicks: number
  bookings: number
}

export interface AnalyticsOverview {
  totalSearches: number
  zeroResultRate: number
  clickThroughRate: number
  conversionRate: number
  topQueries: TopQuery[]
  zeroResults: ZeroResultQuery[]
  timeline: TimelinePoint[]
}
