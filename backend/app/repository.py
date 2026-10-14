"""The one seam between the API and its storage.

Every router talks to a `Repo` and nothing else, so the same handlers serve a
real Postgres and the in-memory seed catalogue. `init_repo()` decides which at
startup: a reachable DATABASE_URL gives `PostgresRepo`, anything else gives
`MemoryRepo` and one log line saying why. That fallback is the point rather than
a shortcut — the POC has to demo on a laptop with nothing installed, which is the
same philosophy as the query layer falling back to keyword search.

`MemoryRepo` is genuinely mutable: an admin write, a logged search and a click
all land in process lists and are visible to the next request, so a demo session
behaves. It forgets everything on restart, which is the honest limit of it.

Two shapes meet here and nowhere else: snake_case columns with Decimal money and
uuid keys on one side, camelCase pydantic with floats and strings on the other.
The itinerary, the inclusions and the policy ids have no tables in the POC
schema, so they are derived from the trip; `_itinerary` names what would fix it.

The seed dataset (`app/seed_data.py`) is read as plain dicts in wire shape:
DESTINATIONS, TRIPS, GUIDES, PLACES, SYNONYMS, PROMOTIONS, DATA_SOURCES,
REVIEW_QUEUE, ADMIN_CONFIG and SAMPLE_SEARCH_LOG.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from math import asin, cos, radians, sin, sqrt
from typing import Any, Optional, Protocol

from sqlalchemy import case, delete, distinct, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from . import db, ingest, models, seed_data
from .config import settings
from .schemas import (
    AdminConfig,
    AnalyticsOverview,
    DataSource,
    Departure,
    Destination,
    EventRequest,
    Guide,
    IngestResult,
    ItineraryDay,
    MergeCandidate,
    ParsedQuery,
    Place,
    Promotion,
    SearchFilters,
    SearchableField,
    Synonym,
    TimelinePoint,
    TopQuery,
    Trip,
    TripDetail,
    ZeroResultQuery,
)

log = logging.getLogger("traveliq.repository")

# The five values the wire type allows. trips.audience is text[], so a feed can
# put anything in it; a stray value is dropped rather than allowed to fail
# validation and take a whole search down.
_AUDIENCES = ("Family", "Couples", "Solo", "Small groups", "Adventure")

# Booking conditions live in rag.py's retrieval corpus, not in a table. A trip
# detail cites all four because they all apply to every booking.
_POLICY_IDS = (
    "policy-booking",
    "policy-cancellation",
    "policy-baggage",
    "policy-atol",
)

_CONFIG_SCOPE = "default"
_SIMILAR_TRIPS = 4
_DEPARTURES_AHEAD = 6
_TOP_QUERIES = 8
_ZERO_RESULT_QUERIES = 6
_AUDIT_KEPT = 200  # in-memory only; Postgres keeps the whole audit_log
_EARTH_RADIUS_MILES = 3958.8

# Readable seed ids ('trip-01', 'promo-04') are not uuids, and the tables want
# uuids. Hashing the natural key into a namespace uuid gives both: ids stay
# stable across reseeds, so every insert can upsert on the primary key and
# running the seed twice changes nothing.
_SEED_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://traveliq.local/seed")


def seed_uuid(kind: str, key: str) -> uuid.UUID:
    """A stable uuid for a seed row, derived from its natural key."""
    return uuid.uuid5(_SEED_NAMESPACE, f"{kind}:{key}")


# --- Small shared helpers ---------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalise(query: str) -> str:
    """What the top-searches and zero-result reports group by, so 'Iceland  '
    and 'iceland' count as one query rather than two."""
    return " ".join(query.lower().split())


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _rate(part: float, whole: float) -> float:
    return round(part / whole, 4) if whole else 0.0


def _window(days: int) -> tuple[date, datetime]:
    """`days` whole days ending today. Whole days, not the last 720 hours, so the
    KPI tiles and the timeline under them cover exactly the same rows — and so
    today's own searches appear, which a plain `now - 30 days` cut misses."""
    first = _now().date() - timedelta(days=days - 1)
    return first, datetime.combine(first, time.min, tzinfo=timezone.utc)


def _as_uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        return None


def _parse_when(value: Optional[str]) -> Optional[datetime]:
    """An ISO date or timestamp from the wire as a tz-aware datetime. Naive
    values are read as UTC, which is what the application stores."""
    if not value:
        return None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        log.warning("unparseable timestamp %r; storing null instead", value)
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def logged_at(row: dict[str, Any]) -> datetime:
    """When a hand-written search-log row happened. The dataset dates itself
    however reads best at the point of writing — an ISO timestamp, or an age in
    hours or days — and all three land on the same window here."""
    stamped = _parse_when(row.get("at") or row.get("lastSeen"))
    if stamped is not None:
        return stamped
    hours = float(row.get("hoursAgo", 0)) or float(row.get("daysAgo", 0)) * 24
    return _now() - timedelta(hours=hours)


def _money(value: float) -> Decimal:
    return Decimal(str(round(float(value), 2)))


def _distance_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    a = (
        sin((phi2 - phi1) / 2) ** 2
        + cos(phi1) * cos(phi2) * sin(radians(lng2 - lng1) / 2) ** 2
    )
    return round(2 * _EARTH_RADIUS_MILES * asin(sqrt(a)), 1)


def _trip_as_place(trip: Trip) -> Place:
    """A product shown on the Discover map. It sits at its destination's centre
    (distance 0 by construction, so radius never hides it), and its location
    string carries the country so a country search reaches the whole catalogue."""
    destination = trip.destination
    return Place(
        id=trip.id,
        name=trip.title,
        type="trip",
        category="trips",
        location=f"{destination.name}, {destination.country}",
        rating=trip.rating,
        distanceMiles=0.0,
        price=f"From £{trip.priceFrom:,.0f}",
        lat=destination.lat,
        lng=destination.lng,
        imageUrl=trip.imageUrl,
    )


def _rank_suggestions(
    prefix: str, history: list[str], vocabulary: list[str], limit: int
) -> list[str]:
    """History first: a phrase that has already returned results for somebody is
    a better suggestion than a bare destination name."""
    needle = _normalise(prefix)
    leading: list[str] = []
    trailing: list[str] = []
    for candidate in [*history, *vocabulary]:
        lowered = candidate.lower()
        if not needle or lowered.startswith(needle):
            leading.append(candidate)
        elif needle in lowered:
            trailing.append(candidate)

    seen: set[str] = set()
    ordered: list[str] = []
    for candidate in [*leading, *trailing]:
        key = candidate.lower()
        if key not in seen:
            seen.add(key)
            ordered.append(candidate)
    return ordered[:limit]


# --- Derived trip detail ---------------------------------------------------

_DAY_NOTES = (
    "A full day out with your guide at a pace the whole group can hold. Lunch is "
    "included and the afternoon is left loose, so the plan can follow the weather "
    "rather than the timetable.",
    "The morning is guided and the afternoon is yours. Your guide leaves a short "
    "list of what is worth the walk and what is worth skipping.",
    "An earlier start, to be somewhere quiet before the coach parties arrive. A "
    "long lunch afterwards and nothing else pencilled in.",
)


def _itinerary(trip: Trip) -> list[ItineraryDay]:
    """A day-by-day outline derived from the trip's own shape.

    There is no itinerary table in the POC schema, so this stands in for
    editorial copy: a `trips.itinerary` JSONB column, or an `itinerary_days`
    table if the CMS needs to edit a single day, is what would replace it.
    """
    place = trip.destination.name
    if trip.durationDays <= 1:
        return [
            ItineraryDay(
                day=1,
                title=f"A day in {place}",
                detail=(
                    f"One full day, guided from the moment you arrive. {trip.summary}"
                ),
            )
        ]

    days = [
        ItineraryDay(
            day=1,
            title=f"Arrive in {place}",
            detail=(
                "Transfer from the airport and time to settle in. Your guide meets "
                "everyone before dinner to walk through the week and answer the "
                "questions a brochure never covers."
            ),
        )
    ]
    subjects = trip.activities or trip.themes or ["Exploring"]
    for offset in range(trip.durationDays - 2):
        days.append(
            ItineraryDay(
                day=2 + offset,
                title=f"{subjects[offset % len(subjects)]} around {place}",
                detail=_DAY_NOTES[offset % len(_DAY_NOTES)],
            )
        )
    days.append(
        ItineraryDay(
            day=trip.durationDays,
            title="Homeward",
            detail=(
                f"A slow last morning in {place}, bags left at the hotel, and the "
                "transfer back to the airport in good time for the flight home."
            ),
        )
    )
    return days


def _included(trip: Trip) -> list[str]:
    nights = max(1, trip.durationDays - 1)
    flights = (
        "Return flights from the UK, direct"
        if trip.directFlights
        else "Return flights from the UK, one connection"
    )
    included = [
        flights,
        "Private airport transfers at both ends",
        f"{nights} night{'' if nights == 1 else 's'} of accommodation with breakfast",
        f"An English-speaking guide throughout, with the group capped at {trip.groupSizeMax}",
    ]
    if "Walking" in trip.activities:
        included.append("Route notes, 1:25,000 maps and daily bag transfers")
    if "Skiing" in trip.activities:
        included.append("Six-day lift pass and two mornings of instruction")
    if "Dog sledding" in trip.activities:
        included.append("Thermal suit, boots and mittens in every size")
    if "Diving" in trip.activities:
        included.append("Two guided dives a day with tanks and weights")
    if "Northern Lights" in trip.themes:
        included.append("Guided aurora hunts, repeated free of charge if the sky closes in")
    if "Rail journeys" in trip.themes:
        included.append("All rail tickets, reserved and in second class")
    included.append("ATOL protection and a 24-hour UK duty phone")
    return included


def departures_for(trip: Trip) -> list[Departure]:
    """The next few departures, generated from the trip's departure months and
    its lead-in price. Postgres stores real rows in trip_departures and reads
    those; this is what fills the table when the catalogue is seeded, and what
    the in-memory repository answers with directly."""
    if not trip.months:
        return []
    today = date.today()
    horizon = today + timedelta(days=21)  # nobody sells a departure inside three weeks
    out: list[Departure] = []
    year, month = today.year, today.month
    while len(out) < _DEPARTURES_AHEAD and year <= today.year + 2:
        if month in trip.months:
            for day in (9, 23):
                when = date(year, month, day)
                if when <= horizon or len(out) >= _DEPARTURES_AHEAD:
                    continue
                index = len(out)
                out.append(
                    Departure(
                        id=f"{trip.slug}-{when.isoformat()}",
                        date=when.isoformat(),
                        # Shoulder dates undercut the peak by a few per cent, which
                        # is the shape a real yield curve has.
                        price=round(trip.priceFrom * (1.0 + 0.04 * (index % 3))),
                        seatsLeft=2 + (index * 3 + len(trip.slug)) % 12,
                        direct=trip.directFlights,
                    )
                )
        month += 1
        if month > 12:
            month, year = 1, year + 1
    return out


def _similar(trip: Trip, catalogue: list[Trip]) -> list[Trip]:
    """Same destination first, then anything sharing a theme."""
    themes = set(trip.themes)
    same_place = [
        t for t in catalogue if t.id != trip.id and t.destination.slug == trip.destination.slug
    ]
    same_theme = [
        t
        for t in catalogue
        if t.id != trip.id and t not in same_place and themes.intersection(t.themes)
    ]
    return [*same_place, *same_theme][:_SIMILAR_TRIPS]


# --- Row -> wire -----------------------------------------------------------

def _destination_out(row: models.Destination) -> Destination:
    return Destination(
        id=str(row.id),
        slug=row.slug,
        name=row.name,
        country=row.country,
        region=row.region,
        lat=float(row.lat),
        lng=float(row.lng),
        imageUrl=row.image_url,
    )


def _trip_out(row: models.Trip) -> Trip:
    return Trip(
        id=str(row.id),
        slug=row.slug,
        title=row.title,
        summary=row.summary,
        description=row.description,
        destination=_destination_out(row.destination),
        themes=list(row.themes),
        activities=list(row.activities),
        audience=[a for a in row.audience if a in _AUDIENCES],
        durationDays=row.duration_days,
        priceFrom=float(row.price_from),
        currency="GBP",
        rating=float(row.rating),
        reviewCount=row.review_count,
        climate=row.climate,
        months=[int(m) for m in row.months],
        directFlights=row.direct_flights,
        groupSizeMax=row.group_size_max,
        available=row.available,
        imageUrl=row.image_url,
        gallery=[m.url for m in row.media],
        # The operator's trading name has no column in the POC schema, so the
        # Postgres path shows the feed that owns the trip instead. A
        # trips.operator_name column would carry the real thing.
        supplier=row.supplier.name if row.supplier else (row.sources[0] if row.sources else ""),
        sources=list(row.sources),
        pinned=row.pinned,
        badges=list(row.badges),
    )


def _departure_out(row: models.TripDeparture) -> Departure:
    return Departure(
        id=str(row.id),
        date=row.departure_date.isoformat(),
        price=float(row.price),
        seatsLeft=row.seats_left,
        direct=row.direct,
    )


def _guide_out(row: models.Guide) -> Guide:
    return Guide(
        id=str(row.id),
        slug=row.slug,
        title=row.title,
        location=row.location,
        author=row.author,
        days=row.days,
        imageUrl=row.image_url,
        tags=list(row.tags),
    )


def _place_out(row: models.Poi, distance: float) -> Place:
    return Place(
        id=str(row.id),
        name=row.name,
        type=row.kind,
        category=row.category,
        location=row.location,
        rating=float(row.rating) if row.rating is not None else None,
        distanceMiles=distance,
        price=row.price_band,
        lat=float(row.lat),
        lng=float(row.lng),
        imageUrl=row.image_url,
    )


def _trip_place_out(row: models.Trip) -> Place:
    """A product on the Discover map, pinned at its destination's centre —
    trips carry no lat/lng of their own, the destination is their location."""
    return Place(
        id=str(row.id),
        name=row.title,
        type="trip",
        category="trips",
        location=f"{row.destination.name}, {row.destination.country}",
        rating=float(row.rating),
        distanceMiles=0.0,
        price=f"From £{row.price_from:,.0f}",
        lat=float(row.destination.lat),
        lng=float(row.destination.lng),
        imageUrl=row.image_url,
    )


def _synonym_out(row: models.Synonym) -> Synonym:
    return Synonym(
        id=str(row.id),
        term=row.term,
        alternatives=list(row.alternatives),
        market=row.market,
    )


def _promotion_out(row: models.Promotion, trip_title: str) -> Promotion:
    return Promotion(
        id=str(row.id),
        tripId=str(row.trip_id),
        tripTitle=trip_title,
        kind=row.kind,
        weight=float(row.weight),
        startsAt=_iso(row.starts_at),
        endsAt=_iso(row.ends_at),
    )


def _source_out(row: models.Supplier, field_priority: list[str]) -> DataSource:
    return DataSource(
        id=str(row.id),
        key=row.key,
        label=row.name,
        kind=row.kind,
        status=row.status,
        lastSyncAt=_iso(row.last_sync_at),
        recordCount=row.record_count,
        fieldPriority=field_priority,
    )


def _candidate_out(row: models.MergeCandidate) -> MergeCandidate:
    return MergeCandidate(
        id=str(row.id),
        leftTitle=row.left_title,
        rightTitle=row.right_title,
        leftSource=row.left_source,
        rightSource=row.right_source,
        score=float(row.score),
        reasons=list(row.reasons),
        status=row.status,
    )


def _config_out(row: models.SearchConfig) -> AdminConfig:
    return AdminConfig(
        searchableFields=[SearchableField.model_validate(f) for f in row.searchable_fields],
        enabledFilters=list(row.enabled_filters),
        resultsPerPage=row.results_per_page,
        fallbackToLexical=row.fallback_to_lexical,
    )


def _default_config() -> AdminConfig:
    return AdminConfig.model_validate(seed_data.ADMIN_CONFIG)


def field_priority_rules() -> list[dict[str, Any]]:
    """The per-field source priority, in the shape ingest.py reads, derived from
    each source's ordered `fieldPriority` list — first field wins hardest, and
    lowest number wins a contested field.

    One list rather than two: `sources()` reads field_priority_rules back out to
    rebuild exactly this ordering, so the seed and the admin panel cannot drift.
    """
    return [
        {
            "sourceKey": source["key"],
            "fieldName": field,
            "priority": (index + 1) * 10,
            "conditions": {},
        }
        for source in seed_data.DATA_SOURCES
        for index, field in enumerate(source.get("fieldPriority", []))
    ]


# --- The interface ---------------------------------------------------------

class Repo(Protocol):
    """What the routers depend on. Structural, not inherited: the two
    implementations below are checked against it by the type checker, and
    neither has to import the other."""

    kind: str

    async def trips(self) -> list[Trip]: ...
    async def trip_by_slug(self, slug: str) -> Optional[TripDetail]: ...
    async def destinations(self) -> list[Destination]: ...
    async def guides(self) -> list[Guide]: ...
    async def places(
        self, q: str = "", category: str = "", radius_miles: float = 25.0
    ) -> list[Place]: ...

    async def log_search(
        self,
        query: str,
        parsed: ParsedQuery,
        filters: Optional[SearchFilters],
        total: int,
        took_ms: int,
        mode: str,
    ) -> str: ...
    async def log_event(self, req: EventRequest) -> None: ...
    async def analytics_overview(self, days: int = 30) -> AnalyticsOverview: ...
    async def suggestions(self, prefix: str, limit: int = 6) -> list[str]: ...

    async def config_get(self) -> AdminConfig: ...
    async def config_set(self, cfg: AdminConfig) -> AdminConfig: ...
    async def synonyms(self) -> list[Synonym]: ...
    async def synonym_add(self, s: Synonym) -> Synonym: ...
    async def synonym_delete(self, sid: str) -> None: ...
    async def promotions(self) -> list[Promotion]: ...
    async def promotion_add(self, p: Promotion) -> Promotion: ...
    async def promotion_delete(self, pid: str) -> None: ...
    async def sources(self) -> list[DataSource]: ...
    async def source_sync(self, key: str) -> DataSource: ...
    async def review_queue(self) -> list[MergeCandidate]: ...
    async def review_resolve(self, cid: str, approve: bool) -> MergeCandidate: ...
    async def ingest_records(self, source_key: str, records: list[dict]) -> IngestResult: ...
    async def audit(self, actor: str, action: str, detail: dict) -> None: ...


# --- In-memory ------------------------------------------------------------

@dataclass
class _SearchRecord:
    """One row of search history. The seed log arrives pre-aggregated — one entry
    standing for `searches` identical queries — and a search logged this session
    is the same record with a weight of one, so the analytics pass never has to
    know which is which."""

    id: str
    query: str
    searches: int
    results: int
    clicks: int
    bookings: int
    at: datetime


def _historical_searches() -> list[_SearchRecord]:
    records: list[_SearchRecord] = []
    for row in seed_data.SAMPLE_SEARCH_LOG:
        records.append(
            _SearchRecord(
                id="",  # never carries events: its clicks are already counted
                query=_normalise(str(row.get("query", ""))),
                searches=max(1, int(row.get("searches", 1))),
                results=int(row.get("results", 1)),
                clicks=int(row.get("clicks", 0)),
                bookings=int(row.get("bookings", 0)),
                at=logged_at(row),
            )
        )
    return records


class MemoryRepo:
    """The seed catalogue, held in process and mutable.

    Admin writes, searches and events all stick for the life of the server, so a
    demo session behaves like the real thing. It forgets on restart — that is the
    whole of the difference, and `python -m app.seed` against a real Postgres is
    what makes it durable."""

    kind: str = "memory"

    def __init__(self) -> None:
        self._trips = [Trip.model_validate(row) for row in seed_data.TRIPS]
        self._destinations = [Destination.model_validate(row) for row in seed_data.DESTINATIONS]
        self._guides = [Guide.model_validate(row) for row in seed_data.GUIDES]
        self._places = [Place.model_validate(row) for row in seed_data.PLACES]
        self._synonyms = [Synonym.model_validate(row) for row in seed_data.SYNONYMS]
        self._promotions = [Promotion.model_validate(row) for row in seed_data.PROMOTIONS]
        self._sources = [DataSource.model_validate(row) for row in seed_data.DATA_SOURCES]
        self._queue = [MergeCandidate.model_validate(row) for row in seed_data.REVIEW_QUEUE]
        self._config = _default_config()
        self._searches = _historical_searches()
        self._audit: list[dict[str, Any]] = []

    # -- Catalogue ---------------------------------------------------------

    async def trips(self) -> list[Trip]:
        return list(self._trips)

    async def trip_by_slug(self, slug: str) -> Optional[TripDetail]:
        trip = next((t for t in self._trips if t.slug == slug), None)
        if trip is None:
            return None
        return TripDetail(
            trip=trip,
            itinerary=_itinerary(trip),
            departures=departures_for(trip),
            similar=_similar(trip, self._trips),
            included=_included(trip),
            policyIds=list(_POLICY_IDS),
        )

    async def destinations(self) -> list[Destination]:
        return list(self._destinations)

    async def guides(self) -> list[Guide]:
        return list(self._guides)

    async def places(
        self, q: str = "", category: str = "", radius_miles: float = 25.0
    ) -> list[Place]:
        needle = q.lower().strip()
        candidates = list(self._places)
        if not category or category == "trips":
            candidates.extend(_trip_as_place(t) for t in self._trips)
        found = [
            p
            for p in candidates
            if (not category or p.category == category)
            and p.distanceMiles <= radius_miles
            and (
                not needle
                or needle in p.name.lower()
                or needle in p.location.lower()
                or needle in p.type.lower()
            )
        ]
        return sorted(found, key=lambda p: p.distanceMiles)

    # -- Analytics ---------------------------------------------------------

    async def log_search(
        self,
        query: str,
        parsed: ParsedQuery,
        filters: Optional[SearchFilters],
        total: int,
        took_ms: int,
        mode: str,
    ) -> str:
        search_id = str(uuid.uuid4())
        self._searches.append(
            _SearchRecord(
                id=search_id,
                query=_normalise(query),
                searches=1,
                results=total,
                clicks=0,
                bookings=0,
                at=_now(),
            )
        )
        log.debug(
            "logged search %r parsed by %s, %d results in %dms (%s)",
            query,
            parsed.source,
            total,
            took_ms,
            mode,
        )
        return search_id

    async def log_event(self, req: EventRequest) -> None:
        record = next((s for s in self._searches if s.id and s.id == req.searchId), None)
        if record is None:
            log.debug("dropping %s event: no search %r in this session", req.type, req.searchId)
            return
        if req.type == "click":
            record.clicks += 1
        elif req.type == "booking":
            record.bookings += 1
        # Impressions are accepted and dropped. Click-through here is clicks per
        # search, which is what the analytics tab plots; clicks per impression
        # needs the per-position rows that search_events holds under Postgres.

    async def analytics_overview(self, days: int = 30) -> AnalyticsOverview:
        first_day, since = _window(days)
        window = [s for s in self._searches if s.at >= since]
        searches = sum(s.searches for s in window)
        clicks = sum(s.clicks for s in window)
        bookings = sum(s.bookings for s in window)
        zero = sum(s.searches for s in window if s.results == 0)

        return AnalyticsOverview(
            totalSearches=searches,
            zeroResultRate=_rate(zero, searches),
            clickThroughRate=_rate(clicks, searches),
            conversionRate=_rate(bookings, searches),
            topQueries=_memory_top_queries(window),
            zeroResults=_memory_zero_results(window),
            timeline=_memory_timeline(window, first_day, days),
        )

    async def suggestions(self, prefix: str, limit: int = 6) -> list[str]:
        vocabulary = [d.name for d in self._destinations]
        vocabulary += sorted({theme for t in self._trips for theme in t.themes})
        return _rank_suggestions(prefix, self._successful_queries(), vocabulary, limit)

    def _successful_queries(self) -> list[str]:
        volume: dict[str, int] = {}
        for record in self._searches:
            if record.results > 0 and record.query:
                volume[record.query] = volume.get(record.query, 0) + record.searches
        return sorted(volume, key=lambda q: -volume[q])

    # -- Admin -------------------------------------------------------------

    async def config_get(self) -> AdminConfig:
        return self._config

    async def config_set(self, cfg: AdminConfig) -> AdminConfig:
        self._config = cfg
        return cfg

    async def synonyms(self) -> list[Synonym]:
        return list(self._synonyms)

    async def synonym_add(self, s: Synonym) -> Synonym:
        self._synonyms = [existing for existing in self._synonyms if existing.id != s.id]
        self._synonyms.append(s)
        return s

    async def synonym_delete(self, sid: str) -> None:
        self._synonyms = [s for s in self._synonyms if s.id != sid]

    async def promotions(self) -> list[Promotion]:
        return list(self._promotions)

    async def promotion_add(self, p: Promotion) -> Promotion:
        self._promotions = [existing for existing in self._promotions if existing.id != p.id]
        self._promotions.append(p)
        return p

    async def promotion_delete(self, pid: str) -> None:
        self._promotions = [p for p in self._promotions if p.id != pid]

    async def sources(self) -> list[DataSource]:
        return list(self._sources)

    async def source_sync(self, key: str) -> DataSource:
        source = next((s for s in self._sources if s.key == key), None)
        if source is None:
            raise LookupError(f"no data source with key {key}")
        # A real sync calls the supplier API and posts what it gets to /ingest.
        # Here the feed is already loaded, so the sync is the status change.
        source.status = "healthy"
        source.lastSyncAt = _now().isoformat()
        return source

    async def review_queue(self) -> list[MergeCandidate]:
        pending = [c for c in self._queue if c.status == "pending"]
        return sorted(pending, key=lambda c: -c.score)

    async def review_resolve(self, cid: str, approve: bool) -> MergeCandidate:
        candidate = next((c for c in self._queue if c.id == cid), None)
        if candidate is None:
            raise LookupError(f"no merge candidate with id {cid}")
        candidate.status = "approved" if approve else "rejected"
        return candidate

    async def ingest_records(self, source_key: str, records: list[dict]) -> IngestResult:
        result, candidates = await ingest.run_ingest(
            source_key, records, self._trips, field_priority_rules()
        )
        known = {c.id for c in self._queue}
        self._queue.extend(c for c in candidates if c.id not in known)
        # run_ingest merges into a working copy it does not hand back, so the
        # trips held here keep their current field values. Folding a merge in
        # means replaying ingest.merge_fields per record, which is what the
        # Postgres path would do inside its transaction.
        return result

    async def audit(self, actor: str, action: str, detail: dict) -> None:
        self._audit.append({"actor": actor, "action": action, "detail": detail, "at": _now()})
        del self._audit[:-_AUDIT_KEPT]


def _memory_top_queries(window: list[_SearchRecord]) -> list[TopQuery]:
    rolled: dict[str, list[int]] = {}
    for record in window:
        if record.results == 0 or not record.query:
            continue
        totals = rolled.setdefault(record.query, [0, 0, 0])
        totals[0] += record.searches
        totals[1] += record.clicks
        totals[2] += record.bookings
    ranked = sorted(rolled.items(), key=lambda item: -item[1][0])[:_TOP_QUERIES]
    return [
        TopQuery(
            query=query,
            searches=searches,
            ctr=_rate(clicks, searches),
            conversion=_rate(bookings, searches),
        )
        for query, (searches, clicks, bookings) in ranked
    ]


def _memory_zero_results(window: list[_SearchRecord]) -> list[ZeroResultQuery]:
    rolled: dict[str, tuple[int, datetime]] = {}
    for record in window:
        if record.results or not record.query:
            continue
        searches, last_seen = rolled.get(record.query, (0, record.at))
        rolled[record.query] = (searches + record.searches, max(last_seen, record.at))
    ranked = sorted(rolled.items(), key=lambda item: -item[1][0])[:_ZERO_RESULT_QUERIES]
    return [
        ZeroResultQuery(query=query, searches=searches, lastSeen=last_seen.isoformat())
        for query, (searches, last_seen) in ranked
    ]


def _memory_timeline(
    window: list[_SearchRecord], first_day: date, days: int
) -> list[TimelinePoint]:
    """One point per day across the whole window, gaps included, so the chart has
    a continuous axis instead of a line that jumps over quiet days."""
    rolled: dict[date, list[int]] = {}
    for record in window:
        totals = rolled.setdefault(record.at.date(), [0, 0, 0])
        totals[0] += record.searches
        totals[1] += record.clicks
        totals[2] += record.bookings

    points: list[TimelinePoint] = []
    day = first_day
    for _ in range(days):
        searches, clicks, bookings = rolled.get(day, [0, 0, 0])
        points.append(
            TimelinePoint(
                date=day.isoformat(), searches=searches, clicks=clicks, bookings=bookings
            )
        )
        day += timedelta(days=1)
    return points


# --- Postgres -------------------------------------------------------------

class PostgresRepo:
    """The system of record. Every method opens one transaction through
    `db.session()` and closes it before returning, so nothing hands a live
    session or a detached ORM row back to a router."""

    kind: str = "postgres"

    # -- Catalogue ---------------------------------------------------------

    async def _trip_rows(self) -> list[models.Trip]:
        async with db.session() as s:
            result = await s.scalars(select(models.Trip).order_by(models.Trip.title))
            return list(result.unique().all())

    async def trips(self) -> list[Trip]:
        return [_trip_out(row) for row in await self._trip_rows()]

    async def trip_by_slug(self, slug: str) -> Optional[TripDetail]:
        # The whole catalogue, because `similar` needs it anyway and it is one
        # query of a few dozen rows rather than two of one.
        rows = await self._trip_rows()
        row = next((r for r in rows if r.slug == slug), None)
        if row is None:
            return None

        trip = _trip_out(row)
        today = date.today()
        departures = [
            _departure_out(d) for d in row.departures if d.departure_date >= today
        ][:_DEPARTURES_AHEAD]
        if not departures:
            # The seeded departures have run out. Deriving the next few keeps the
            # booking panel usable; a live supplier feed keeps the table filled.
            departures = departures_for(trip)

        return TripDetail(
            trip=trip,
            itinerary=_itinerary(trip),
            departures=departures,
            similar=_similar(trip, [_trip_out(r) for r in rows]),
            included=_included(trip),
            policyIds=list(_POLICY_IDS),
        )

    async def destinations(self) -> list[Destination]:
        async with db.session() as s:
            rows = await s.scalars(select(models.Destination).order_by(models.Destination.name))
            return [_destination_out(row) for row in rows]

    async def guides(self) -> list[Guide]:
        async with db.session() as s:
            rows = await s.scalars(
                select(models.Guide).order_by(
                    models.Guide.published_at.desc().nullslast(), models.Guide.title
                )
            )
            return [_guide_out(row) for row in rows]

    async def places(
        self, q: str = "", category: str = "", radius_miles: float = 25.0
    ) -> list[Place]:
        """Distance is measured from the centre of the place's destination.
        Real geo-search — 'within 12 miles of where I am standing' — wants
        PostGIS and a `geography(Point)` column; that is the production path, and
        the POC does the trigonometry in Python over a few dozen rows instead."""
        like = f"%{q}%" if q else None
        found: list[Place] = []

        if category != "trips":
            stmt = select(models.Poi, models.Destination).outerjoin(
                models.Destination, models.Poi.destination_id == models.Destination.id
            )
            if category:
                stmt = stmt.where(models.Poi.category == category)
            if like:
                # The joined destination answers country searches — POI location
                # strings name districts and cities, not countries.
                stmt = stmt.where(
                    models.Poi.name.ilike(like)
                    | models.Poi.location.ilike(like)
                    | models.Poi.kind.ilike(like)
                    | models.Destination.name.ilike(like)
                    | models.Destination.country.ilike(like)
                )

            async with db.session() as s:
                rows = (await s.execute(stmt)).all()

            for poi, destination in rows:
                distance = (
                    _distance_miles(
                        float(destination.lat),
                        float(destination.lng),
                        float(poi.lat),
                        float(poi.lng),
                    )
                    if destination is not None
                    else 0.0
                )
                if distance <= radius_miles:
                    found.append(_place_out(poi, distance))

        if not category or category == "trips":
            # Every product in the catalogue doubles as a pin at its
            # destination's centre, so country and location searches reach the
            # trips as well as the POIs.
            trip_stmt = select(models.Trip).join(
                models.Destination, models.Trip.destination_id == models.Destination.id
            )
            if like:
                trip_stmt = trip_stmt.where(
                    models.Trip.title.ilike(like)
                    | models.Destination.name.ilike(like)
                    | models.Destination.country.ilike(like)
                    | models.Destination.region.ilike(like)
                )
            async with db.session() as s:
                trips = (await s.scalars(trip_stmt)).unique().all()
            found.extend(_trip_place_out(t) for t in trips)

        return sorted(found, key=lambda p: p.distanceMiles)

    # -- Analytics ---------------------------------------------------------

    async def log_search(
        self,
        query: str,
        parsed: ParsedQuery,
        filters: Optional[SearchFilters],
        total: int,
        took_ms: int,
        mode: str,
    ) -> str:
        row = models.SearchQuery(
            raw_query=query,
            normalised_query=_normalise(query),
            parsed=parsed.model_dump(exclude_none=True),
            filters=filters.model_dump(exclude_none=True) if filters else None,
            parse_source=parsed.source,
            confidence=Decimal(str(round(parsed.confidence, 3))),
            mode=mode,
            result_count=total,
            took_ms=took_ms,
        )
        async with db.session() as s:
            s.add(row)
            await s.flush()
            return str(row.id)

    async def log_event(self, req: EventRequest) -> None:
        search_id = _as_uuid(req.searchId)
        if search_id is None:
            log.warning("dropping %s event: searchId %r is not a uuid", req.type, req.searchId)
            return
        async with db.session() as s:
            # search_events.search_id is NOT NULL and a real foreign key, so a
            # beacon quoting an id we never issued is dropped rather than
            # allowed to become an integrity error on a fire-and-forget POST.
            known = await s.scalar(
                select(models.SearchQuery.id).where(models.SearchQuery.id == search_id)
            )
            if known is None:
                log.warning("dropping %s event: no search %s on record", req.type, search_id)
                return
            s.add(
                models.SearchEvent(
                    search_id=search_id,
                    trip_id=await self._resolve_trip_id(s, req.tripId),
                    type=req.type,
                    position=req.position,
                    value=_money(req.value) if req.value is not None else None,
                )
            )

    @staticmethod
    async def _resolve_trip_id(s: AsyncSession, value: Optional[str]) -> Optional[uuid.UUID]:
        """A trip id or a slug — the search screen has the slug in its URL, so
        both arrive in practice."""
        if not value:
            return None
        as_uuid = _as_uuid(value)
        if as_uuid is not None:
            return await s.scalar(select(models.Trip.id).where(models.Trip.id == as_uuid))
        return await s.scalar(select(models.Trip.id).where(models.Trip.slug == value))

    async def analytics_overview(self, days: int = 30) -> AnalyticsOverview:
        first_day, since = _window(days)
        queries = models.SearchQuery
        events = models.SearchEvent
        # count(distinct) throughout, because the outer join to search_events
        # multiplies one search into one row per event it produced.
        clicked = func.count(distinct(case((events.type == "click", events.id))))
        booked = func.count(distinct(case((events.type == "booking", events.id))))
        counted = func.count(distinct(queries.id))
        day = func.date_trunc("day", queries.created_at).label("day")

        async with db.session() as s:
            totals = (
                await s.execute(
                    select(
                        func.count(queries.id),
                        func.count(queries.id).filter(queries.result_count == 0),
                    ).where(queries.created_at >= since)
                )
            ).one()

            overall = (
                await s.execute(
                    select(clicked, booked)
                    .select_from(queries)
                    .outerjoin(events, events.search_id == queries.id)
                    .where(queries.created_at >= since)
                )
            ).one()

            top = (
                await s.execute(
                    select(queries.normalised_query, counted, clicked, booked)
                    .outerjoin(events, events.search_id == queries.id)
                    .where(queries.created_at >= since, queries.result_count > 0)
                    .group_by(queries.normalised_query)
                    .order_by(counted.desc())
                    .limit(_TOP_QUERIES)
                )
            ).all()

            empty = (
                await s.execute(
                    select(
                        queries.normalised_query,
                        func.count(queries.id),
                        func.max(queries.created_at),
                    )
                    .where(queries.created_at >= since, queries.result_count == 0)
                    .group_by(queries.normalised_query)
                    .order_by(func.count(queries.id).desc())
                    .limit(_ZERO_RESULT_QUERIES)
                )
            ).all()

            plotted = (
                await s.execute(
                    select(day, counted, clicked, booked)
                    .outerjoin(events, events.search_id == queries.id)
                    .where(queries.created_at >= since)
                    .group_by(day)
                    .order_by(day)
                )
            ).all()

        searches, zero = int(totals[0]), int(totals[1])
        clicks, bookings = int(overall[0]), int(overall[1])
        by_day = {
            when.date(): (int(count), int(click_count), int(booking_count))
            for when, count, click_count, booking_count in plotted
        }
        timeline: list[TimelinePoint] = []
        cursor = first_day
        for _ in range(days):
            counts = by_day.get(cursor, (0, 0, 0))
            timeline.append(
                TimelinePoint(
                    date=cursor.isoformat(),
                    searches=counts[0],
                    clicks=counts[1],
                    bookings=counts[2],
                )
            )
            cursor += timedelta(days=1)

        return AnalyticsOverview(
            totalSearches=searches,
            zeroResultRate=_rate(zero, searches),
            clickThroughRate=_rate(clicks, searches),
            conversionRate=_rate(bookings, searches),
            topQueries=[
                TopQuery(
                    query=query,
                    searches=int(count),
                    ctr=_rate(int(click_count), int(count)),
                    conversion=_rate(int(booking_count), int(count)),
                )
                for query, count, click_count, booking_count in top
            ],
            zeroResults=[
                ZeroResultQuery(
                    query=query, searches=int(count), lastSeen=last_seen.isoformat()
                )
                for query, count, last_seen in empty
            ],
            timeline=timeline,
        )

    async def suggestions(self, prefix: str, limit: int = 6) -> list[str]:
        queries = models.SearchQuery
        counted = func.count(queries.id)
        async with db.session() as s:
            history = (
                await s.execute(
                    select(queries.normalised_query)
                    .where(queries.result_count > 0)
                    .group_by(queries.normalised_query)
                    .order_by(counted.desc())
                    .limit(200)
                )
            ).scalars()
            names = (
                await s.scalars(select(models.Destination.name).order_by(models.Destination.name))
            ).all()
            themes = (await s.scalars(select(distinct(func.unnest(models.Trip.themes))))).all()
        return _rank_suggestions(prefix, list(history), [*names, *sorted(themes)], limit)

    # -- Admin -------------------------------------------------------------

    async def config_get(self) -> AdminConfig:
        async with db.session() as s:
            row = await s.scalar(
                select(models.SearchConfig).where(models.SearchConfig.scope == _CONFIG_SCOPE)
            )
        if row is None:
            log.warning("no search_config row for scope %r; serving the seed default", _CONFIG_SCOPE)
            return _default_config()
        return _config_out(row)

    async def config_set(self, cfg: AdminConfig) -> AdminConfig:
        values = {
            "searchable_fields": [f.model_dump() for f in cfg.searchableFields],
            "enabled_filters": list(cfg.enabledFilters),
            "results_per_page": cfg.resultsPerPage,
            "fallback_to_lexical": cfg.fallbackToLexical,
        }
        stmt = (
            pg_insert(models.SearchConfig)
            .values(id=seed_uuid("search-config", _CONFIG_SCOPE), scope=_CONFIG_SCOPE, **values)
            .on_conflict_do_update(
                index_elements=["scope"],
                # onupdate= does not reach an ON CONFLICT SET clause, so the
                # timestamp is set here or it never moves.
                set_={**values, "updated_at": func.now()},
            )
        )
        async with db.session() as s:
            await s.execute(stmt)
        return cfg

    async def synonyms(self) -> list[Synonym]:
        async with db.session() as s:
            rows = await s.scalars(
                select(models.Synonym).order_by(models.Synonym.term, models.Synonym.market)
            )
            return [_synonym_out(row) for row in rows]

    async def synonym_add(self, s: Synonym) -> Synonym:
        values = {"alternatives": list(s.alternatives)}
        stmt = (
            pg_insert(models.Synonym)
            .values(
                id=_as_uuid(s.id) or uuid.uuid4(), term=s.term, market=s.market, **values
            )
            .on_conflict_do_update(
                index_elements=["term", "market"],
                set_={**values, "updated_at": func.now()},
            )
            .returning(models.Synonym.id)
        )
        async with db.session() as session:
            stored = await session.scalar(stmt)
        return s.model_copy(update={"id": str(stored)})

    async def synonym_delete(self, sid: str) -> None:
        target = _as_uuid(sid)
        if target is None:
            return
        async with db.session() as s:
            await s.execute(delete(models.Synonym).where(models.Synonym.id == target))

    async def promotions(self) -> list[Promotion]:
        async with db.session() as s:
            rows = (
                await s.execute(
                    select(models.Promotion, models.Trip.title)
                    .join(models.Trip, models.Promotion.trip_id == models.Trip.id)
                    .order_by(models.Promotion.weight.desc(), models.Trip.title)
                )
            ).all()
        return [_promotion_out(row, title) for row, title in rows]

    async def promotion_add(self, p: Promotion) -> Promotion:
        async with db.session() as s:
            trip_id = await self._resolve_trip_id(s, p.tripId)
            if trip_id is None:
                raise LookupError(f"no trip matches {p.tripId!r}")
            row = models.Promotion(
                id=_as_uuid(p.id) or uuid.uuid4(),
                trip_id=trip_id,
                kind=p.kind,
                weight=Decimal(str(round(p.weight, 2))),
                starts_at=_parse_when(p.startsAt),
                ends_at=_parse_when(p.endsAt),
            )
            s.add(row)
            await s.flush()
            stored = str(row.id)
        return p.model_copy(update={"id": stored, "tripId": str(trip_id)})

    async def promotion_delete(self, pid: str) -> None:
        target = _as_uuid(pid)
        if target is None:
            return
        async with db.session() as s:
            await s.execute(delete(models.Promotion).where(models.Promotion.id == target))

    async def sources(self) -> list[DataSource]:
        rules = models.FieldPriorityRule
        async with db.session() as s:
            suppliers = (
                await s.scalars(
                    select(models.Supplier).order_by(models.Supplier.kind, models.Supplier.key)
                )
            ).all()
            ordered = (
                await s.execute(
                    select(rules.source_key, rules.field_name).order_by(
                        rules.source_key, rules.priority
                    )
                )
            ).all()

        priority: dict[str, list[str]] = {}
        for source_key, field_name in ordered:
            priority.setdefault(source_key, []).append(field_name)
        return [_source_out(row, priority.get(row.key, [])) for row in suppliers]

    async def source_sync(self, key: str) -> DataSource:
        rules = models.FieldPriorityRule
        async with db.session() as s:
            row = await s.scalar(select(models.Supplier).where(models.Supplier.key == key))
            if row is None:
                raise LookupError(f"no data source with key {key}")
            held = await s.scalar(
                select(func.count(models.SourceRecord.id)).where(
                    models.SourceRecord.source_key == key
                )
            )
            row.status = "healthy"
            row.last_sync_at = _now()
            # A real sync calls the supplier API and posts what it gets to
            # /ingest. Here the count is whatever this feed has actually sent,
            # falling back to the seeded figure for one that has sent nothing.
            row.record_count = int(held or 0) or row.record_count
            priority = (
                await s.scalars(
                    select(rules.field_name)
                    .where(rules.source_key == key)
                    .order_by(rules.priority)
                )
            ).all()
            await s.flush()
            return _source_out(row, list(priority))

    async def review_queue(self) -> list[MergeCandidate]:
        async with db.session() as s:
            rows = await s.scalars(
                select(models.MergeCandidate)
                .where(models.MergeCandidate.status == "pending")
                .order_by(models.MergeCandidate.score.desc())
            )
            return [_candidate_out(row) for row in rows]

    async def review_resolve(self, cid: str, approve: bool) -> MergeCandidate:
        target = _as_uuid(cid)
        async with db.session() as s:
            row = await s.get(models.MergeCandidate, target) if target else None
            if row is None:
                raise LookupError(f"no merge candidate with id {cid}")
            row.status = "approved" if approve else "rejected"
            row.resolved_at = _now()
            # The decision is recorded against the payload it was made about, so
            # a re-sync of the same record does not re-queue it. Applying an
            # approved merge to the trip row is the next step and needs the
            # payload replayed through ingest.merge_fields.
            await s.execute(
                update(models.SourceRecord)
                .where(models.SourceRecord.id == row.right_source_record_id)
                .values(status="merged" if approve else "rejected", processed_at=_now())
            )
            await s.flush()
            return _candidate_out(row)

    async def ingest_records(self, source_key: str, records: list[dict]) -> IngestResult:
        trips = await self.trips()
        rules = await self._field_priority_rules()
        result, candidates = await ingest.run_ingest(source_key, records, trips, rules)

        normalised = [ingest.normalise_record(raw, source_key) for raw in records]
        trip_ids = {t.title: _as_uuid(t.id) for t in trips if _as_uuid(t.id)}
        record_ids: dict[str, uuid.UUID] = {}

        async with db.session() as s:
            for raw, record in zip(records, normalised):
                external_id = record["externalId"] or record["slug"]
                row_id = seed_uuid("source-record", f"{source_key}|{external_id}")
                await s.execute(
                    pg_insert(models.SourceRecord)
                    .values(
                        id=row_id,
                        source_key=source_key,
                        external_id=external_id,
                        payload=raw,
                        checksum=_checksum(record),
                        status="new",
                    )
                    .on_conflict_do_update(
                        index_elements=["source_key", "external_id"],
                        set_={
                            "payload": raw,
                            "checksum": _checksum(record),
                            "received_at": func.now(),
                        },
                    )
                )
                record_ids[record["title"]] = row_id

            for candidate in candidates:
                left = trip_ids.get(candidate.leftTitle)
                right = record_ids.get(candidate.rightTitle)
                if left is None:
                    # The match was against another record in the same batch
                    # rather than against a published trip, so there is nothing
                    # for merge_candidates.left_trip_id to point at yet. The
                    # second sync of that feed is when it gets queued.
                    log.warning(
                        "not queueing %r: %r is not a published trip",
                        candidate.rightTitle,
                        candidate.leftTitle,
                    )
                    continue
                if right is None:
                    log.warning(
                        "not queueing %r: no source record was written for it",
                        candidate.rightTitle,
                    )
                    continue
                await s.execute(
                    pg_insert(models.MergeCandidate)
                    .values(
                        id=_as_uuid(candidate.id) or uuid.uuid4(),
                        left_trip_id=left,
                        right_source_record_id=right,
                        left_title=candidate.leftTitle,
                        right_title=candidate.rightTitle,
                        left_source=candidate.leftSource,
                        right_source=candidate.rightSource,
                        score=Decimal(str(round(candidate.score, 3))),
                        reasons=list(candidate.reasons),
                        status="pending",
                    )
                    # Candidate ids are deterministic, so a re-sync updates the
                    # same queue entry instead of filling the queue with copies
                    # of one decision.
                    .on_conflict_do_nothing(index_elements=["id"])
                )
        return result

    async def _field_priority_rules(self) -> list[dict]:
        async with db.session() as s:
            rows = await s.scalars(select(models.FieldPriorityRule))
            return [
                {
                    "sourceKey": row.source_key,
                    "fieldName": row.field_name,
                    "priority": row.priority,
                    "conditions": row.conditions,
                }
                for row in rows
            ]

    async def audit(self, actor: str, action: str, detail: dict) -> None:
        async with db.session() as s:
            s.add(models.AuditLog(actor=actor, action=action, detail=detail))


def _checksum(record: dict) -> str:
    """A content fingerprint so a re-sync can skip rows that have not moved.
    md5 because it is short and fast; nothing here is a security decision."""
    payload = json.dumps(record, sort_keys=True, default=str)
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


# --- Selection ------------------------------------------------------------

_repo: Optional[Repo] = None


async def init_repo() -> Repo:
    """Pick the repository and remember it. Called once from main.py's lifespan.

    A missing, malformed or unreachable DATABASE_URL is a fallback rather than an
    error: it costs one log line and the in-memory catalogue, never a failed
    boot."""
    global _repo
    _repo = await _choose_repo()
    return _repo


async def _choose_repo() -> Repo:
    if not settings.db_configured():
        log.info("DATABASE_URL is not set; serving the in-memory seed catalogue")
        return MemoryRepo()
    try:
        if not await db.ping():
            log.warning(
                "postgres is configured but unreachable; serving the in-memory seed catalogue"
            )
            return MemoryRepo()
        await db.create_all()
        await _ensure_seeded()
        return PostgresRepo()
    except Exception as exc:  # noqa: BLE001 — degrade to memory, never fail startup
        log.warning("postgres setup failed (%s); serving the in-memory seed catalogue", exc)
        return MemoryRepo()


async def _ensure_seeded() -> None:
    """An empty trips table means a database that exists but has never been
    seeded — a fresh `docker compose up`. Loading the dataset here means the
    first run works without a second command, and says so."""
    async with db.session() as s:
        held = await s.scalar(select(func.count(models.Trip.id)))
    if held:
        return
    # Imported here rather than at module scope: app.seed reads this module's
    # `seed_uuid` and `departures_for`, and only this one call goes the other way.
    from .seed import insert_seed

    counts = await insert_seed()
    log.info(
        "trips table was empty; auto-seeded %d trips and %d destinations from seed_data",
        counts.get("trips", 0),
        counts.get("destinations", 0),
    )


def get_repo() -> Repo:
    """FastAPI dependency: `repo: Repo = Depends(get_repo)`."""
    if _repo is None:
        raise RuntimeError(
            "the repository is not initialised — main.py's lifespan awaits init_repo() at "
            "startup, so a test or a script has to await it before calling get_repo()"
        )
    return _repo
