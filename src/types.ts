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
  type: string // 'museum' | 'restaurant' | 'hotel' | 'landmark'
  category: 'things-to-do' | 'restaurants' | 'stays'
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

/** One streamed piece of a chat response. */
export interface ChatChunk {
  token?: string
  trips?: Trip[]
  citations?: Citation[]
  parsed?: ParsedQuery
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
