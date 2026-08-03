"""Retrieval, ranking and faceting for trip search.

An embedding index over the trip catalogue gives semantic search: cosine
similarity against a query vector from the same provider that built the index
(vectors from different providers are not comparable, so the provider is pinned
at build time). When no embedding provider is configured — or a live query embed
fails, or the vector width no longer matches — scoring degrades to the lexical
scorer below and /search keeps working. `mode` in the response says which of the
two answered, because that fallback is a documented behaviour rather than a
secret.

On top of scoring this module does the merchandising work: filters from the NL
parse and the UI (the UI always wins), synonym expansion, a deterministic boost
for each parsed field a trip agrees with, promotions (pin, boost, hide), facet
counts, and the relaxation helper that tells a zero-result search which
constraint to drop.

Paging is the search router's job — everything here returns the whole result set
so facet counts and totals cover it.
"""
from __future__ import annotations

import calendar
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Callable, NamedTuple, Optional

import numpy as np

from . import llm, nlq
from .config import settings
from .providers import SimBand
from .schemas import (
    Facet,
    FacetValue,
    ParsedQuery,
    Promotion,
    SearchFilters,
    SearchResult,
    Synonym,
    Trip,
)

log = logging.getLogger("traveliq.rag")

# --- Similarity -> "match %" mapping ---------------------------------------
# The usable cosine band differs per embedding family, so it travels with the
# provider (providers.py SimBand, overridable via EMBED_SIM_* in .env). This one
# applies before an index is built and matches text-embedding-3.
_DEFAULT_BAND = SimBand(0.16, 0.52, 0.20, 0.28)
_QV_CACHE_MAX = 64  # free tiers are rate-limited; don't re-embed the same query

_LEXICAL_FLOOR = 0.12
_AGREEMENT_STEP = 0.025  # per parsed field a trip agrees with
_AGREEMENT_CAP = 0.12
_DURATION_TOLERANCE = 2  # days either side of a parsed trip length
_PRICE_CAPS = (750, 1000, 1500, 2000, 3000, 5000)
_DURATION_BUCKETS: tuple[tuple[int, str, str], ...] = (
    (4, "1-4", "Up to 4 days"),
    (7, "5-7", "5 to 7 days"),
    (10, "8-10", "8 to 10 days"),
    (999, "11+", "11 days or more"),
)

_STOPWORDS = {
    "a", "an", "the", "for", "to", "of", "in", "on", "and", "or", "with",
    "under", "over", "below", "above", "my", "me", "is", "are", "be", "best",
    "good", "some", "what", "whats", "your", "you", "i", "need", "want",
    "looking", "that", "this", "about", "can", "do", "does", "us", "it",
    "trip", "trips", "holiday", "holidays", "somewhere", "go", "going", "would",
    "like", "please", "not", "too",
}

# Traveller-facing policy documents the assistant can retrieve and cite. They
# live here because retrieval is their only consumer; a production build would
# read them from the policy CMS alongside the trip content.
POLICIES = [
    {
        "id": "policy-booking",
        "label": "Booking and payment",
        "keywords": ["book", "booking", "deposit", "pay", "payment", "balance", "confirm"],
        "summary": "A £150 per-person deposit secures a departure; the balance is due 10 weeks before travel.",
        "body": (
            "Trips are held for 48 hours from enquiry. A deposit of £150 per person confirms the "
            "booking and the balance is due 10 weeks before departure — inside 10 weeks the full "
            "amount is payable at the time of booking. We accept UK debit and credit cards and "
            "bank transfer; card payments carry no surcharge. Your confirmation invoice and ATOL "
            "certificate are issued together, usually within one working day."
        ),
    },
    {
        "id": "policy-cancellation",
        "label": "Cancellations and amendments",
        "keywords": [
            "cancel", "cancellation", "refund", "amend", "amendment", "change",
            "postpone", "reschedule",
        ],
        "summary": "Free date changes up to 70 days before departure; a sliding cancellation scale after that.",
        "body": (
            "You can move your departure date once free of charge up to 70 days before travel, "
            "subject to availability and any fare difference. Cancellations are charged on a "
            "sliding scale: deposit only more than 70 days out, 50 per cent between 70 and 43 "
            "days, 75 per cent between 42 and 29 days, and 100 per cent inside 28 days. Name "
            "changes cost £45 per person plus any airline fee. If we cancel a departure you "
            "choose between a full refund and an alternative date."
        ),
    },
    {
        "id": "policy-baggage",
        "label": "Flights and baggage",
        "keywords": [
            "flight", "flights", "baggage", "luggage", "hold", "carry on", "cabin",
            "direct", "seat", "airline",
        ],
        "summary": "One 23kg hold bag and one cabin bag on all flight-inclusive trips; direct routings are flagged on each departure.",
        "body": (
            "Flight-inclusive trips include one 23kg hold bag and one cabin bag per person. Ski "
            "and dive trips carry equipment free of charge where the airline allows it; oversized "
            "items are chargeable and must be declared at booking. Regional departures from "
            "Manchester, Edinburgh, Glasgow and Birmingham are available on most itineraries for "
            "a supplement. Whether a departure is direct is shown on the departure itself, and "
            "the direct-flights filter uses that field rather than an estimate."
        ),
    },
    {
        "id": "policy-atol",
        "label": "ATOL and financial protection",
        "keywords": [
            "atol", "protected", "protection", "abta", "insurance", "insured",
            "bonded", "safe", "money",
        ],
        "summary": "Flight-inclusive holidays are ATOL protected; travel insurance is a condition of booking.",
        "body": (
            "Every flight-inclusive holiday sold in the UK is ATOL protected and you receive your "
            "ATOL certificate with the booking confirmation — if we cease trading your trip is "
            "covered and you are repatriated. Trips without flights are covered by our trust "
            "account arrangement. Travel insurance including medical cover and repatriation is a "
            "condition of booking; please send us your policy number and 24-hour emergency line "
            "before departure."
        ),
    },
]


# --- Text helpers ----------------------------------------------------------

def _tokenize(text: str) -> list[str]:
    words = re.sub(r"[^a-z0-9\s]", " ", text.lower()).split()
    return [w for w in words if len(w) > 1 and w not in _STOPWORDS]


def _match_score(sim: float, band: SimBand) -> float:
    span = band.hi - band.lo or 1e-6
    t = (sim - band.lo) / span
    return round(max(0.05, min(0.98, 0.05 + t * 0.93)), 4)


def _money(amount: float) -> str:
    return f"£{amount:,.0f}"


def _month_label(month: int) -> str:
    return calendar.month_name[month] if 1 <= month <= 12 else str(month)


def _loose_eq(left: str, right: str) -> bool:
    a, b = left.strip().lower(), right.strip().lower()
    return a == b or (len(a) > 3 and len(b) > 3 and (a in b or b in a))


def _mentions_destination(trip: Trip, needle: str) -> bool:
    d = trip.destination
    haystack = f"{d.slug} {d.name} {d.country} {d.region} {trip.title}".lower()
    return needle in haystack or needle.replace(" ", "-") in haystack


def _doc_text(trip: Trip) -> str:
    return (
        f"{trip.title}. {trip.destination.name}, {trip.destination.country}. "
        f"{', '.join(trip.themes)}. {', '.join(trip.activities)}. {trip.summary}"
    )


def _lexical_score(tokens: list[str], trip: Trip) -> float:
    """Weighted field overlap with cheap prefix/substring fuzz for typos. Only
    used when the embedding layer is unavailable."""
    if not tokens:
        return 0.0
    fields = (
        (set(_tokenize(trip.title)), 1.0),
        (set(_tokenize(f"{trip.destination.name} {trip.destination.country} {trip.destination.region}")), 0.9),
        (set(_tokenize(" ".join(trip.themes))), 0.85),
        (set(_tokenize(" ".join(trip.activities))), 0.8),
        (set(_tokenize(" ".join(trip.audience))), 0.7),
        (set(_tokenize(trip.summary)), 0.6),
        (set(_tokenize(trip.description)), 0.45),
    )
    total = 0.0
    for token in tokens:
        best = 0.0
        for words, weight in fields:
            if token in words:
                best = max(best, weight)
            elif any(word.startswith(token[:4]) or token in word for word in words):
                best = max(best, weight * 0.65)
        total += best
    return round(min(0.97, (total / len(tokens)) * 0.97), 4)


def _expand_query(query: str, synonyms: list[Synonym]) -> str:
    """Append the other side of every synonym group the query already mentions,
    so "aurora" also retrieves trips tagged "Northern Lights". Market is ignored
    for now — the POC ships a single en-GB market."""
    if not query.strip() or not synonyms:
        return query
    text = query.lower()
    extra: list[str] = []
    for group in synonyms:
        forms = [form for form in (group.term, *group.alternatives) if form.strip()]
        if not any(form.lower() in text for form in forms):
            continue
        extra.extend(form for form in forms if form.lower() not in text)
    if not extra:
        return query
    return f"{query} {' '.join(dict.fromkeys(extra))}"


# --- Constraints -----------------------------------------------------------

@dataclass(frozen=True)
class _Constraint:
    """One hard filter. `field` matches the facet key it belongs to so a facet
    can exclude its own dimension from its own counts, and `explicit` marks the
    ones that came from the UI — those are never relaxed."""

    field: str
    label: str
    explicit: bool
    test: Callable[[Trip], bool]


def _constraints(parsed: ParsedQuery, filters: Optional[SearchFilters]) -> list[_Constraint]:
    """Explicit UI filters always bind. A parsed field binds when the traveller
    stated it as a requirement (destination, dates, budget, length, climate,
    party size, direct flights); taste signals — themes, activities, audience —
    only influence ranking, which keeps a rich sentence from filtering itself
    down to nothing."""
    out: list[_Constraint] = []
    f = filters or SearchFilters()

    destination = f.destination or parsed.destination
    if destination:
        needle = destination.strip().lower()
        out.append(
            _Constraint(
                "destination", destination, bool(f.destination),
                lambda t: _mentions_destination(t, needle),
            )
        )

    months = [f.month] if f.month else list(parsed.months or [])
    if months:
        wanted = set(months)
        shown = ", ".join(_month_label(m) for m in months[:3])
        out.append(
            _Constraint(
                "month", f"departures in {shown}", bool(f.month),
                lambda t: bool(wanted.intersection(t.months)),
            )
        )

    cap = f.maxPrice or parsed.maxPrice
    if cap:
        out.append(
            _Constraint("maxPrice", f"under {_money(cap)}", bool(f.maxPrice), lambda t: t.priceFrom <= cap)
        )

    explicit_duration = f.minDuration is not None or f.maxDuration is not None
    if explicit_duration:
        low, high = f.minDuration, f.maxDuration
        duration_label = "trip length " + " to ".join(str(v) for v in (low, high) if v is not None) + " days"
    elif parsed.durationDays:
        # Suppliers sell the same week as seven or eight days, so a parsed
        # length is a band rather than an equality test.
        band = max(_DURATION_TOLERANCE, round(parsed.durationDays * 0.2))
        low, high = parsed.durationDays - band, parsed.durationDays + band
        duration_label = f"around {parsed.durationDays} days"
    else:
        low = high = None
        duration_label = ""
    if low is not None or high is not None:
        out.append(
            _Constraint(
                "duration", duration_label, explicit_duration,
                lambda t: (low is None or t.durationDays >= low) and (high is None or t.durationDays <= high),
            )
        )

    climate = f.climate or parsed.climate
    if climate:
        out.append(
            _Constraint("climate", f"{climate} climate", bool(f.climate), lambda t: t.climate == climate)
        )

    if f.theme:
        theme = f.theme
        out.append(_Constraint("theme", theme, True, lambda t: any(_loose_eq(x, theme) for x in t.themes)))
    if f.activity:
        activity = f.activity
        out.append(
            _Constraint("activity", activity, True, lambda t: any(_loose_eq(x, activity) for x in t.activities))
        )
    if f.audience:
        audience = f.audience
        out.append(
            _Constraint("audience", audience, True, lambda t: any(_loose_eq(x, audience) for x in t.audience))
        )

    direct = f.directOnly if f.directOnly is not None else parsed.directFlights
    if direct:
        out.append(
            _Constraint("directOnly", "direct flights", f.directOnly is not None, lambda t: t.directFlights)
        )
    if f.availableOnly:
        out.append(_Constraint("availableOnly", "available departures", True, lambda t: t.available))

    if parsed.groupSizeMax:
        size = parsed.groupSizeMax
        out.append(_Constraint("groupSize", f"room for {size} travellers", False, lambda t: t.groupSizeMax >= size))

    return out


class _Agreement(NamedTuple):
    reasons: list[str]   # readable, straight into SearchResult.matchedOn
    taste: int           # of those, how many are theme/activity/audience matches
    possible: int        # how many the parse could have produced for any trip


def _agreements(trip: Trip, parsed: ParsedQuery) -> _Agreement:
    """Where this trip and the parsed sentence agree. `taste` is what lets a
    weakly-scored trip survive the relevance floor — a Northern Lights trip
    should not be dropped because the embedding of "aurora hunting with the kids"
    landed slightly low — and `possible` is the denominator that turns the
    agreements into a match percentage."""
    reasons: list[str] = []
    taste = 0
    possible = 0

    if parsed.destination:
        possible += 1
        if _mentions_destination(trip, parsed.destination.strip().lower()):
            reasons.append(f"destination: {trip.destination.name}")
    for theme in parsed.themes or []:
        possible += 1
        hit = next((x for x in trip.themes if _loose_eq(x, theme)), None)
        if hit:
            reasons.append(f"theme: {hit}")
            taste += 1
    for activity in parsed.activities or []:
        possible += 1
        hit = next((x for x in trip.activities if _loose_eq(x, activity)), None)
        if hit:
            reasons.append(f"activity: {hit}")
            taste += 1
    for audience in parsed.audience or []:
        possible += 1
        hit = next((x for x in trip.audience if _loose_eq(x, audience)), None)
        if hit:
            reasons.append(f"audience: {hit}")
            taste += 1
    if parsed.months:
        possible += 1
        month = next((m for m in parsed.months if m in trip.months), None)
        if month:
            reasons.append(f"month: {_month_label(month)}")
    if parsed.durationDays:
        possible += 1
        band = max(_DURATION_TOLERANCE, round(parsed.durationDays * 0.2))
        if abs(trip.durationDays - parsed.durationDays) <= band:
            reasons.append(f"duration: {trip.durationDays} days")
    if parsed.maxPrice:
        possible += 1
        if trip.priceFrom <= parsed.maxPrice:
            reasons.append(f"budget: under {_money(parsed.maxPrice)}")
    if parsed.climate:
        possible += 1
        if trip.climate == parsed.climate:
            reasons.append(f"climate: {parsed.climate}")
    if parsed.directFlights:
        possible += 1
        if trip.directFlights:
            reasons.append("direct flights")
    if parsed.groupSizeMax:
        possible += 1
        if trip.groupSizeMax >= parsed.groupSizeMax:
            reasons.append(f"group of {parsed.groupSizeMax}")

    return _Agreement(reasons, taste, possible)


# --- Promotions ------------------------------------------------------------

def _promotion_maps(promotions: list[Promotion]) -> tuple[set[str], set[str], dict[str, float]]:
    """Split live promotions into hidden ids, pinned ids and boost weights. ISO
    dates compare correctly as strings, so no parsing is needed to honour a
    scheduling window."""
    today = date.today().isoformat()
    hidden: set[str] = set()
    pinned: set[str] = set()
    boosts: dict[str, float] = {}
    for promo in promotions:
        if promo.startsAt and promo.startsAt[:10] > today:
            continue
        if promo.endsAt and promo.endsAt[:10] < today:
            continue
        if promo.kind == "hide":
            hidden.add(promo.tripId)
        elif promo.kind == "pin":
            pinned.add(promo.tripId)
        elif promo.kind == "boost" and promo.weight > 0:
            boosts[promo.tripId] = promo.weight
    return hidden, pinned, boosts


def _apply_pins(results: list[SearchResult], pinned: set[str]) -> list[SearchResult]:
    """Pinned trips move to the top keeping their relative order; everything
    else keeps the order the sort produced."""
    front_ids = {r.trip.id for r in results if r.trip.id in pinned or r.trip.pinned}
    if not front_ids:
        return results
    front = [r for r in results if r.trip.id in front_ids]
    return front + [r for r in results if r.trip.id not in front_ids]


_SORTERS: dict[str, Callable[[SearchResult], tuple]] = {
    "price-asc": lambda r: (r.trip.priceFrom, -r.score),
    "price-desc": lambda r: (-r.trip.priceFrom, -r.score),
    "rating": lambda r: (-r.trip.rating, -r.trip.reviewCount),
    "duration": lambda r: (r.trip.durationDays, r.trip.priceFrom),
    "relevance": lambda r: (-r.score, -r.trip.rating, r.trip.priceFrom),
}


# --- Facets ----------------------------------------------------------------

class _FacetSpec(NamedTuple):
    key: str
    label: str
    extract: Callable[[Trip], list[tuple[str, str]]]
    natural_order: Optional[tuple[str, ...]]


def _duration_bucket(trip: Trip) -> list[tuple[str, str]]:
    for ceiling, value, label in _DURATION_BUCKETS:
        if trip.durationDays <= ceiling:
            return [(value, label)]
    return []


def _price_buckets(trip: Trip) -> list[tuple[str, str]]:
    # Cumulative, because the filter is a ceiling: "Under £1,500" must also
    # count the £900 trips.
    return [(str(cap), f"Under {_money(cap)}") for cap in _PRICE_CAPS if trip.priceFrom <= cap]


_FACET_SPECS: tuple[_FacetSpec, ...] = (
    _FacetSpec("destination", "Destination", lambda t: [(t.destination.slug, t.destination.name)], None),
    _FacetSpec("theme", "Theme", lambda t: [(x, x) for x in t.themes], None),
    _FacetSpec("activity", "Activity", lambda t: [(x, x) for x in t.activities], None),
    _FacetSpec("audience", "Travelling as", lambda t: [(x, x) for x in t.audience], None),
    _FacetSpec(
        "month", "Departure month",
        lambda t: [(str(m), _month_label(m)) for m in t.months],
        tuple(str(m) for m in range(1, 13)),
    ),
    _FacetSpec(
        "duration", "Trip length", _duration_bucket,
        tuple(value for _, value, _ in _DURATION_BUCKETS),
    ),
    _FacetSpec("maxPrice", "Price", _price_buckets, tuple(str(cap) for cap in _PRICE_CAPS)),
    _FacetSpec(
        "climate", "Climate",
        lambda t: [(t.climate, t.climate.capitalize())],
        ("warm", "mild", "cold"),
    ),
    _FacetSpec(
        "directOnly", "Flights",
        lambda t: [("true", "Direct flights only")] if t.directFlights else [],
        None,
    ),
)


def _facets(pool: list[Trip], constraints: list[_Constraint]) -> list[Facet]:
    """Counts over the relevant set, each facet excluding its own dimension from
    its own counts — so choosing November does not reduce every other month to
    zero."""
    out: list[Facet] = []
    for spec in _FACET_SPECS:
        others = [c for c in constraints if c.field != spec.key]
        subset = [t for t in pool if all(c.test(t) for c in others)]
        counts: Counter[str] = Counter()
        labels: dict[str, str] = {}
        for trip in subset:
            for value, label in spec.extract(trip):
                counts[value] += 1
                labels.setdefault(value, label)
        if not counts:
            continue
        if spec.natural_order:
            ordered = [v for v in spec.natural_order if v in counts]
        else:
            ordered = sorted(counts, key=lambda v: (-counts[v], labels[v]))
        out.append(
            Facet(
                key=spec.key,
                label=spec.label,
                values=[FacetValue(value=v, label=labels[v], count=counts[v]) for v in ordered],
            )
        )
    return out


# --- Zero-result relaxation ------------------------------------------------

class Relaxation(NamedTuple):
    field: str
    label: str
    matches: int


def relaxations(
    parsed: ParsedQuery,
    filters: Optional[SearchFilters],
    trips: list[Trip],
    limit: int = 3,
) -> list[Relaxation]:
    """Which inferred constraint is costing the most results. Explicit UI filters
    are left alone — the traveller set those deliberately, so it is not ours to
    undo them."""
    constraints = _constraints(parsed, filters)
    out: list[Relaxation] = []
    for candidate in constraints:
        if candidate.explicit or not candidate.label:
            continue
        others = [c for c in constraints if c is not candidate]
        matches = sum(1 for t in trips if all(c.test(t) for c in others))
        if matches:
            out.append(Relaxation(candidate.field, candidate.label, matches))
    out.sort(key=lambda r: -r.matches)
    return out[:limit]


def suggestions(
    parsed: ParsedQuery,
    filters: Optional[SearchFilters],
    trips: list[Trip],
    limit: int = 3,
) -> list[str]:
    """Zero-result copy: what to drop, and how many trips that would return."""
    lines = [
        f"Search without {r.label} — "
        f"{r.matches} {'trip matches' if r.matches == 1 else 'trips match'} the rest"
        for r in relaxations(parsed, filters, trips, limit)
    ]
    if not lines:
        lines.append("Try a shorter phrase — a destination or a theme on its own")
        lines.append("Or browse the full collection and filter from there")
    return lines[:limit]


def policy_by_keyword(query: str) -> Optional[dict]:
    """The policy whose keyword list the query literally mentions, or None.

    Public because it is the sharpest available signal that a turn is asking about
    booking conditions rather than planning a trip: the words are in the sentence
    or they are not. chat.py uses it to decide whether a follow-up question about
    pace or budget would be a non-sequitur — the AI parse is no good for that,
    since it will happily read a theme out of "what is your cancellation policy?".
    """
    lower = query.lower()
    for doc in POLICIES:
        if any(word in lower for word in doc["keywords"]):
            return doc
    return None


class TripIndex:
    def __init__(self) -> None:
        self.built = False
        # Pinned at build time: query vectors must come from the same provider
        # as the index, so this one does NOT fall through the chain.
        self.embed_provider: Optional[llm.Provider] = None
        self._vecs: Optional[np.ndarray] = None
        self._policy_vecs: Optional[np.ndarray] = None
        self._rows: dict[str, int] = {}
        self._built_ids: list[str] = []
        self._qv_cache: dict[str, np.ndarray] = {}

    @property
    def band(self) -> SimBand:
        return self.embed_provider.sim if self.embed_provider else _DEFAULT_BAND

    @staticmethod
    def _unit(v: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(v, axis=-1, keepdims=True)
        return v / (norms + 1e-9)

    async def build(self, trips: list[Trip]) -> None:
        """Embed the catalogue + policies through the first embedding-capable
        provider that answers. A failure here is not fatal: search stays on the
        lexical path until the next attempt."""
        ids = [t.id for t in trips]
        if not trips or (self.built and ids == self._built_ids):
            return
        if not llm.embed_providers():
            return

        texts = [_doc_text(t) for t in trips]
        texts += [f"{d['label']}. {d['summary']} {d['body']}" for d in POLICIES]
        try:
            provider, raw = await llm.embed(texts, input_type="passage")
        except Exception as exc:  # noqa: BLE001 — never block startup on a provider
            log.warning("index build failed (%s); search will use lexical scoring", exc)
            return

        vecs = self._unit(np.array(raw, dtype=np.float32))
        self._vecs = vecs[: len(trips)]
        self._policy_vecs = vecs[len(trips) :]
        self._rows = {t.id: i for i, t in enumerate(trips)}
        self._built_ids = ids
        self.embed_provider = provider
        self._qv_cache.clear()
        self.built = True
        log.info("indexed %d trips + %d policies via %s", len(trips), len(POLICIES), provider.label)

    def invalidate(self) -> None:
        """Mark the index stale so the next `build()` re-embeds instead of
        returning early.

        `build()` treats the trip id list as its version marker, which misses an
        *edited* trip — same id, changed description, stale vector. This clears
        that marker. It deliberately leaves the existing vectors in place and
        `built` True: re-embedding needs an await and the event bus is
        synchronous, so the honest behaviour is to keep serving slightly stale
        semantics until something calls `build()` again (startup, or ingest after
        a merge) rather than dropping the whole index to the lexical path on every
        admin edit."""
        self._built_ids = []
        self._qv_cache.clear()

    async def _embed_query(self, query: str) -> np.ndarray:
        cached = self._qv_cache.get(query)
        if cached is not None:
            return cached
        _, raw = await llm.embed([query], provider=self.embed_provider, input_type="query")
        v = self._unit(np.array(raw[0], dtype=np.float32))
        if len(self._qv_cache) >= _QV_CACHE_MAX:
            self._qv_cache.clear()
        self._qv_cache[query] = v
        return v

    async def _query_vec(self, query: str) -> Optional[np.ndarray]:
        """Query vector, or None if the pinned provider is unreachable — the
        caller then degrades to lexical scoring instead of erroring."""
        if not (self.built and self.embed_provider):
            return None
        try:
            v = await self._embed_query(query)
        except Exception as exc:  # noqa: BLE001 — degrade, never 500 a search
            log.warning(
                "query embed via %s failed (%s); using lexical scoring",
                self.embed_provider.name,
                exc,
            )
            return None
        # A vector of the wrong width can't be compared with the index (a model
        # id or output-dimension change under the same provider). Degrade too.
        width = self._vecs.shape[1] if self._vecs is not None else v.shape[0]
        if v.shape[0] != width:
            log.warning(
                "query vector from %s is %d-d but the index is %d-d; using lexical scoring",
                self.embed_provider.name,
                v.shape[0],
                width,
            )
            return None
        return v

    async def _score(self, query: str, pool: list[Trip]) -> tuple[dict[str, float], str, float]:
        """Score every trip in the pool, then say which layer did it and what
        the relevance floor for that layer is."""
        if not query.strip():
            # Browsing rather than searching: there is nothing to match against,
            # so rank on the catalogue's own quality signal.
            return {t.id: round(0.55 + t.rating / 5 * 0.35, 4) for t in pool}, "lexical", 0.0

        qv = await self._query_vec(query) if self._vecs is not None else None
        if qv is None:
            tokens = _tokenize(query)
            return {t.id: _lexical_score(tokens, t) for t in pool}, "lexical", _LEXICAL_FLOOR

        band = self.band
        sims = self._vecs @ qv  # cosine — both sides are normalised
        tokens = _tokenize(query)
        scores: dict[str, float] = {}
        for trip in pool:
            row = self._rows.get(trip.id)
            # A trip that arrived after the last build has no vector yet; score
            # it lexically rather than hiding it until the index is rebuilt.
            scores[trip.id] = (
                _lexical_score(tokens, trip) if row is None else _match_score(float(sims[row]), band)
            )
        return scores, "semantic", _match_score(band.min_product, band)

    async def search(
        self,
        query: str,
        parsed: ParsedQuery,
        filters: Optional[SearchFilters],
        trips: list[Trip],
        promotions: list[Promotion],
        synonyms: list[Synonym],
        sort: str = "relevance",
    ) -> tuple[list[SearchResult], list[Facet], str]:
        constraints = _constraints(parsed, filters)
        hidden, pinned, boosts = _promotion_maps(promotions)
        pool = [t for t in trips if t.id not in hidden]

        scores, mode, floor = await self._score(_expand_query(query, synonyms), pool)

        # Relevance first, filters second, so facet counts come from the same set
        # the results do. The relevance floor only decides membership when the
        # query produced no constraints at all: "somewhere warm in november under
        # 1200 direct flights" carries all of its meaning in the parsed fields
        # and almost none in words a trip description would repeat, so there the
        # constraints define the result set and the text only orders it.
        gated = not constraints
        relevant: list[tuple[Trip, _Agreement, float]] = []
        for trip in pool:
            agreement = _agreements(trip, parsed)
            base = scores.get(trip.id, 0.0)
            if gated and base < floor and not agreement.taste:
                continue
            relevant.append((trip, agreement, base))

        results: list[SearchResult] = []
        for trip, agreement, base in relevant:
            if not all(c.test(trip) for c in constraints):
                continue
            reasons = agreement.reasons
            score = base + min(_AGREEMENT_CAP, len(reasons) * _AGREEMENT_STEP)
            if agreement.possible:
                # A trip that meets every requirement the sentence stated is a
                # strong answer even when its wording shares nothing with the
                # query — which is the whole case for query understanding.
                score = max(score, 0.5 + 0.45 * len(reasons) / agreement.possible)
            score = min(0.99, score)
            weight = boosts.get(trip.id)
            if weight:
                score = min(0.99, score * weight)
                reasons = [*reasons, "boosted in merchandising"]
            if trip.id in pinned or trip.pinned:
                reasons = [*reasons, "pinned in merchandising"]
            results.append(SearchResult(trip=trip, score=round(score, 4), matchedOn=reasons))

        results.sort(key=_SORTERS.get(sort, _SORTERS["relevance"]))
        results = _apply_pins(results, pinned)
        facets = _facets([row[0] for row in relevant], constraints)
        return results, facets, mode

    async def retrieve_policy(self, query: str) -> Optional[dict]:
        """The single most relevant booking-conditions document, or None.

        Keyword match first, then the embedding if one is available and clears
        `min_policy` — the semantic hit wins because it catches the phrasings the
        keyword list does not ("what if I have to pull out" is a cancellation
        question containing none of the cancellation keywords).

        Split out of `retrieve_for_chat` so chat.py can do its own trip retrieval
        (candidate generation plus reranking) without either duplicating this or
        paying for a search it is about to throw away.
        """
        policy = policy_by_keyword(query)
        qv = await self._query_vec(query) if self._policy_vecs is not None else None
        if qv is not None:
            sims = self._policy_vecs @ qv
            best = int(np.argmax(sims))
            if float(sims[best]) >= self.band.min_policy:
                policy = POLICIES[best]
        return policy

    async def retrieve_for_chat(
        self, query: str, trips: list[Trip]
    ) -> tuple[list[Trip], Optional[dict]]:
        """Top trips plus the single most relevant policy, for the assistant's
        grounding context. The heuristic parse is used on purpose here — the chat
        path should not spend a second round trip on query understanding."""
        parsed = nlq.parse_heuristic(query)
        results, _, _ = await self.search(query, parsed, None, trips, [], [])
        top = [r.trip for r in results][: settings.chat_top_k]
        return top, await self.retrieve_policy(query)

    def relaxations(
        self, parsed: ParsedQuery, filters: Optional[SearchFilters], trips: list[Trip], limit: int = 3
    ) -> list[Relaxation]:
        return relaxations(parsed, filters, trips, limit)

    def suggestions(
        self, parsed: ParsedQuery, filters: Optional[SearchFilters], trips: list[Trip], limit: int = 3
    ) -> list[str]:
        return suggestions(parsed, filters, trips, limit)


index = TripIndex()
