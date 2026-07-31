"""Wire schemas. Field names are camelCase to match the frontend's TypeScript
types exactly (see src/types.ts) so the JSON needs no translation layer.

These are the shapes the API speaks, not the shapes the database stores — the
repository is what maps between them (snake_case columns, Decimal money, uuid
ids) and it is the only place that knows about both."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Climate = Literal["warm", "mild", "cold"]
Audience = Literal["Family", "Couples", "Solo", "Small groups", "Adventure"]


# ---- Catalogue ------------------------------------------------------------

class Destination(BaseModel):
    id: str
    slug: str
    name: str
    country: str
    region: str
    lat: float
    lng: float
    imageUrl: str


class Departure(BaseModel):
    id: str
    date: str  # ISO yyyy-mm-dd
    price: float
    seatsLeft: int
    direct: bool


class Trip(BaseModel):
    id: str
    slug: str
    title: str
    summary: str
    description: str
    destination: Destination
    themes: list[str] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    audience: list[Audience] = Field(default_factory=list)
    durationDays: int
    priceFrom: float
    currency: Literal["GBP"] = "GBP"
    rating: float  # 0..5
    reviewCount: int
    climate: Climate
    months: list[int] = Field(default_factory=list)  # 1..12 departure months
    directFlights: bool
    groupSizeMax: int
    available: bool
    imageUrl: str
    gallery: list[str] = Field(default_factory=list)
    supplier: str
    sources: list[str] = Field(default_factory=list)  # 'cms' | 'supplier-atlas' | 'enrichment'
    pinned: Optional[bool] = None
    badges: Optional[list[str]] = None


class ItineraryDay(BaseModel):
    day: int
    title: str
    detail: str


class TripDetail(BaseModel):
    trip: Trip
    itinerary: list[ItineraryDay] = Field(default_factory=list)
    departures: list[Departure] = Field(default_factory=list)
    similar: list[Trip] = Field(default_factory=list)
    included: list[str] = Field(default_factory=list)
    policyIds: list[str] = Field(default_factory=list)


class Guide(BaseModel):
    id: str
    slug: str
    title: str
    location: str
    author: str
    days: int
    imageUrl: str
    tags: list[str] = Field(default_factory=list)


class Place(BaseModel):
    id: str
    name: str
    type: str  # 'museum' | 'restaurant' | 'hotel' | 'landmark'
    category: Literal["things-to-do", "restaurants", "stays"]
    location: str
    rating: Optional[float] = None
    distanceMiles: float
    price: Optional[str] = None
    lat: float
    lng: float
    imageUrl: str


# ---- Search --------------------------------------------------------------

class ParsedQuery(BaseModel):
    """What the query-understanding layer made of the traveller's sentence.
    `source` says which layer produced it, and the Search screen shows that
    distinction rather than hiding it — a heuristic parse is a documented
    fallback, not a failure."""
    destination: Optional[str] = None
    months: Optional[list[int]] = None
    durationDays: Optional[int] = None
    maxPrice: Optional[float] = None
    themes: Optional[list[str]] = None
    activities: Optional[list[str]] = None
    audience: Optional[list[str]] = None
    climate: Optional[Climate] = None
    groupSizeMax: Optional[int] = None
    directFlights: Optional[bool] = None
    source: Literal["ai", "heuristic"] = "heuristic"
    confidence: float = 0.0  # 0..1


class SearchFilters(BaseModel):
    destination: Optional[str] = None
    theme: Optional[str] = None
    activity: Optional[str] = None
    month: Optional[int] = None
    minDuration: Optional[int] = None
    maxDuration: Optional[int] = None
    maxPrice: Optional[float] = None
    climate: Optional[Climate] = None
    directOnly: Optional[bool] = None
    availableOnly: Optional[bool] = None
    audience: Optional[str] = None


class FacetValue(BaseModel):
    value: str
    label: str
    count: int


class Facet(BaseModel):
    key: str
    label: str
    values: list[FacetValue] = Field(default_factory=list)


class SearchResult(BaseModel):
    trip: Trip
    score: float  # 0..1 relevance
    matchedOn: list[str] = Field(default_factory=list)  # 'theme: Northern Lights'


class SearchResponse(BaseModel):
    searchId: str
    results: list[SearchResult] = Field(default_factory=list)
    total: int
    page: int
    pageSize: int
    facets: list[Facet] = Field(default_factory=list)
    parsed: ParsedQuery
    tookMs: int
    mode: Literal["semantic", "lexical"]
    suggestions: Optional[list[str]] = None  # shown when total == 0


# ---- Chat ----------------------------------------------------------------

class Citation(BaseModel):
    id: str
    label: str
    sourceId: str


class ChatChunk(BaseModel):
    """One streamed piece of a chat response. Serialised with exclude_none so
    each SSE event carries only the field it represents."""
    token: Optional[str] = None
    trips: Optional[list[Trip]] = None
    citations: Optional[list[Citation]] = None
    parsed: Optional[ParsedQuery] = None
    done: Optional[bool] = None


class Message(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


# ---- Admin ---------------------------------------------------------------

class SearchableField(BaseModel):
    field: str
    weight: float
    enabled: bool


class Synonym(BaseModel):
    id: str
    term: str
    alternatives: list[str] = Field(default_factory=list)
    market: str = "en-GB"


class Promotion(BaseModel):
    id: str
    tripId: str
    tripTitle: str
    kind: Literal["pin", "boost", "hide"]
    weight: float = 1.0
    startsAt: Optional[str] = None
    endsAt: Optional[str] = None


class DataSource(BaseModel):
    id: str
    key: str
    label: str
    kind: Literal["cms", "supplier", "enrichment"]
    status: Literal["healthy", "syncing", "stale", "error"]
    lastSyncAt: Optional[str] = None
    recordCount: int = 0
    fieldPriority: list[str] = Field(default_factory=list)  # fields this source wins, in order


class MergeCandidate(BaseModel):
    id: str
    leftTitle: str
    rightTitle: str
    leftSource: str
    rightSource: str
    score: float  # 0..1 match confidence
    reasons: list[str] = Field(default_factory=list)
    status: Literal["pending", "approved", "rejected"] = "pending"


class AdminConfig(BaseModel):
    searchableFields: list[SearchableField] = Field(default_factory=list)
    enabledFilters: list[str] = Field(default_factory=list)
    resultsPerPage: int = 12
    fallbackToLexical: bool = True


# ---- Analytics -----------------------------------------------------------

class TopQuery(BaseModel):
    query: str
    searches: int
    ctr: float
    conversion: float


class ZeroResultQuery(BaseModel):
    query: str
    searches: int
    lastSeen: str


class TimelinePoint(BaseModel):
    date: str
    searches: int
    clicks: int
    bookings: int


class AnalyticsOverview(BaseModel):
    totalSearches: int
    zeroResultRate: float
    clickThroughRate: float
    conversionRate: float
    topQueries: list[TopQuery] = Field(default_factory=list)
    zeroResults: list[ZeroResultQuery] = Field(default_factory=list)
    timeline: list[TimelinePoint] = Field(default_factory=list)


# ---- Request bodies ------------------------------------------------------

class SearchRequest(BaseModel):
    query: str = ""
    filters: Optional[SearchFilters] = None
    page: int = 1
    pageSize: int = 12
    sort: str = "relevance"  # relevance|price-asc|price-desc|rating|duration


class EventRequest(BaseModel):
    type: str  # impression|click|booking
    searchId: Optional[str] = None
    tripId: Optional[str] = None
    position: Optional[int] = None
    value: Optional[float] = None


class ChatRequest(BaseModel):
    messages: list[Message]


class IngestRequest(BaseModel):
    records: list[dict]


class IngestResult(BaseModel):
    """What one /ingest call did. `queued` is the honest number here — anything
    the matcher was not sure about waits for a human in the review queue."""
    received: int = 0
    merged: int = 0
    queued: int = 0
    rejected: int = 0


# ---- Service status -----------------------------------------------------

class Health(BaseModel):
    status: str
    configured: bool  # any LLM provider key present
    indexed: bool  # embedding index built
    trips: int
    db: Literal["postgres", "memory"]
    chatProvider: Optional[str] = None
    chatModel: Optional[str] = None
    fallbacks: list[str] = Field(default_factory=list)
    embedProvider: Optional[str] = None
