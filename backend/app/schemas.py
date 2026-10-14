"""Wire schemas. Field names are camelCase to match the frontend's TypeScript
types exactly (see src/types.ts) so the JSON needs no translation layer.

These are the shapes the API speaks, not the shapes the database stores — the
repository is what maps between them (snake_case columns, Decimal money, uuid
ids) and it is the only place that knows about both."""
from typing import Any, Literal, Optional

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
    type: str  # 'museum' | 'restaurant' | 'hotel' | 'landmark' | 'trip'
    category: Literal["things-to-do", "restaurants", "stays", "trips"]
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


# ---- Assistant plan state ------------------------------------------------
# The six parameters the assistant tracks across a conversation. They live in one
# explicit object rather than being re-derived from the transcript on every turn:
# a JSON state is cheap to send, cannot drift from what the UI is showing, and
# makes "change my mind about the budget" a field write instead of a contradiction
# the model has to notice in scrollback. app/plan.py owns the merge rules.

BudgetBand = Literal["budget", "mid", "luxury"]
Pace = Literal["slow", "balanced", "packed"]
# The slot names are the wire vocabulary: chip payloads, skip counters and the
# frontend's summary panel all key off these exact strings.
PlanSlot = Literal["duration", "budget", "region", "holidayType", "pace", "groupSize"]


class TripPlanState(BaseModel):
    """What the assistant knows about the trip so far.

    Every field is optional and stays optional — a slot the traveller skipped is
    indistinguishable from one never asked about, which is the point: retrieval
    runs on whatever is filled and never blocks waiting for the rest.
    """

    # -- The six tracked parameters --
    durationDays: Optional[int] = None
    budgetBand: Optional[BudgetBand] = None
    # Set when the traveller named a number rather than picking a band. Both can
    # be present: a band from a chip, then a precise figure typed afterwards.
    maxPrice: Optional[float] = None
    region: Optional[str] = None  # a bucket key from plan.region_buckets()
    holidayType: Optional[list[str]] = None  # Trip.themes vocabulary
    pace: Optional[Pace] = None  # ranking signal only — no catalogue column
    groupSize: Optional[int] = None

    # -- Bookkeeping, so loop-breaking is a rule rather than a judgement call --
    # Per-slot count of skips and reversals; plan.py stops asking at the ceiling.
    skipCounts: dict[str, int] = Field(default_factory=dict)
    # Per-slot count of times we have put the question. Guards the case where a
    # traveller answers something unrelated and the same slot comes round again.
    askedCounts: dict[str, int] = Field(default_factory=dict)
    turnCount: int = 0
    # Slots whose value predates a change that may have invalidated it — e.g. a
    # budget agreed for Europe, then the region moved to Asia. Kept, not erased:
    # a stale answer is better than no answer, and the assistant re-confirms in
    # one line instead of asking from scratch. Written by events.py subscribers.
    unconfirmed: list[str] = Field(default_factory=list)


class QuickReply(BaseModel):
    """One tappable chip. `value` is what lands in the transcript so the thread
    reads like a conversation; `patch` is what actually updates the state, so a
    tap never depends on the parser re-reading its own label."""

    label: str
    value: str
    patch: dict[str, Any] = Field(default_factory=dict)


class QuickReplyGroup(BaseModel):
    """The chips accompanying one question. Always exactly one slot per turn, and
    always with a skip — `skip` is a complete answer, not a way to stall."""

    slot: PlanSlot
    prompt: str
    options: list[QuickReply] = Field(default_factory=list)
    skip: QuickReply


class ChatChunk(BaseModel):
    """One streamed piece of a chat response. Serialised with exclude_none so
    each SSE event carries only the field it represents.

    Chunk order is the contract the Assistant screen renders against: parsed,
    then state, then trips, then quickReplies, then tokens, then citations, then
    done. See app/chat.py for why.
    """
    token: Optional[str] = None
    trips: Optional[list[Trip]] = None
    citations: Optional[list[Citation]] = None
    parsed: Optional[ParsedQuery] = None
    state: Optional[TripPlanState] = None
    quickReplies: Optional[QuickReplyGroup] = None
    # Which provider/model actually answered this turn — the chain in llm.py means
    # it varies turn to turn, so the pill next to the reply must not read /health.
    provider: Optional[str] = None
    model: Optional[str] = None
    done: Optional[bool] = None


class Message(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class StoredMessage(BaseModel):
    """One transcript row as sessions.py stores and returns it: the text plus the
    raw payload blob. The history endpoint is what turns the blob back into typed
    fields (and trip ids back into trips) — the store itself never interprets it."""
    role: str  # 'user' | 'assistant'
    content: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ChatHistoryMessage(BaseModel):
    """One restored message, shaped for the Assistant screen: the same extras a
    live turn streams (ChatChunk), minus the ephemeral ones (state rides on the
    response instead, and near-me places never reach the backend at all)."""
    role: str  # 'user' | 'assistant'
    content: str
    trips: Optional[list[Trip]] = None
    citations: Optional[list[Citation]] = None
    quickReplies: Optional[QuickReplyGroup] = None
    parsed: Optional[ParsedQuery] = None
    provider: Optional[str] = None
    model: Optional[str] = None


class ChatHistoryResponse(BaseModel):
    sessionId: str
    messages: list[ChatHistoryMessage] = Field(default_factory=list)
    # The plan as the last turn left it, or None for a conversation that never
    # moved a slot — the UI hangs it on the newest reply so PlanSummary renders.
    state: Optional[TripPlanState] = None


class ChatSessionMeta(BaseModel):
    """One row of the chat list: enough to label, sort and act on a conversation
    without loading its transcript."""
    sessionId: str
    title: Optional[str] = None
    pinned: bool = False
    updatedAt: Optional[str] = None  # ISO 8601
    turnCount: int = 0


class ChatSessionList(BaseModel):
    sessions: list[ChatSessionMeta] = Field(default_factory=list)


class ChatSessionPatch(BaseModel):
    """PATCH /chat/sessions/{id} body — send only what changes."""
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    pinned: Optional[bool] = None


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
    # Opaque per-conversation id, minted by the browser (see src/lib/sessionStore.ts).
    # Absent means "no memory" — the turn still answers, it just starts from an
    # empty plan, which is exactly how the endpoint behaved before state existed.
    sessionId: Optional[str] = None
    # Set when the traveller tapped a chip rather than typing. Applied verbatim so
    # a tap is exact, instead of round-tripping the chip's own label through the
    # parser and hoping it reads back the same.
    slotPatch: Optional[dict[str, Any]] = None


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
    # Assistant capabilities, reported because every one of them has a documented
    # degraded mode — an operator seeing `graphNodes: 0` or `rerank: false` should
    # be able to tell "switched off" from "silently broken" without reading logs.
    sessionStore: Optional[Literal["postgres", "memory"]] = None
    graphNodes: int = 0
    graphEdges: int = 0
    rerank: bool = False
    # Observability: whether per-turn pipeline traces are leaving for LangSmith,
    # and under which project — same "switched off vs silently broken" reporting
    # as the fields above. Off is a documented mode, never an error.
    tracing: bool = False
    tracingProject: Optional[str] = None
