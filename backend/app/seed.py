"""`python -m app.seed` — create the schema and load the demo catalogue.

Idempotent by construction. Every readable seed id ('trip-01', 'promo-04') is
hashed into a stable uuid (`repository.seed_uuid`), so every insert can be an
upsert on the primary key: running this twice refreshes the rows and changes
nothing else. `--reset` empties the tables first, for when the shape of the
dataset has changed rather than its contents, and `--dry-run` reports what would
be written without opening a connection.

The API does not need any of this. With no DATABASE_URL it serves the same
dataset from memory (see repository.MemoryRepo); seeding is what makes a demo
session survive a restart and what puts real rows under the analytics SQL.

Usage:
    uv run python -m app.seed
    uv run python -m app.seed --reset
    uv run python -m app.seed --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from . import db, models, seed_data
from .config import settings
from .repository import departures_for, field_priority_rules, logged_at, seed_uuid
from .schemas import AdminConfig, Trip

log = logging.getLogger("traveliq.seed")

# Children first. `truncate ... cascade` would not need the order — listing it
# this way is how a reader checks that nothing has been left out.
_TRUNCATE_ORDER = (
    "saved_items",
    "bookings",
    "search_events",
    "search_queries",
    "merge_candidates",
    "source_records",
    "audit_log",
    "promotions",
    "synonyms",
    "search_config",
    "field_priority_rules",
    "trip_departures",
    "trip_media",
    "pois",
    "guides",
    "trips",
    "suppliers",
    "destinations",
    "users",
)

# A demo database, not a load test. The sample log arrives pre-aggregated — one
# entry standing for a few hundred identical searches — and each entry becomes at
# most this many rows. The ratios the analytics tab reports (click-through,
# conversion, zero-result share) are preserved exactly either way.
_SEARCH_ROWS_PER_ENTRY = 40

# promotions.weight is numeric(4,2) and the admin panel caps a weight at 10, so a
# seed row that reads 100 ("pin hardest") is clamped rather than overflowing.
_MAX_WEIGHT = Decimal("99.99")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _num(value: Any, places: int) -> Decimal:
    return Decimal(str(round(float(value), places)))


def _when(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        log.warning("unparseable timestamp %r in the seed dataset; storing null", value)
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _slug(value: str, limit: int = 160) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:limit]


@dataclass
class _Table:
    """One table's worth of rows, with the constraint an upsert conflicts on."""

    name: str
    model: type[models.Base]
    rows: list[dict[str, Any]]
    conflict: list[str]


# --- Row builders -----------------------------------------------------------

def _user_rows() -> list[dict[str, Any]]:
    """Optional: nothing references users, because authentication is not
    implemented. Seeding an editor and an admin gives promotions and config
    changes a plausible author in the audit trail."""
    people = getattr(seed_data, "USERS", [])
    return [
        {
            "id": seed_uuid("user", str(row["email"]).lower()),
            "email": str(row["email"]).lower(),
            "display_name": row.get("displayName") or row.get("name") or row["email"],
            "role": row.get("role", "traveller"),
            "password_hash": None,
            "last_seen_at": _when(row.get("lastSeenAt")),
        }
        for row in people
    ]


def _destination_rows() -> list[dict[str, Any]]:
    return [
        {
            "id": seed_uuid("destination", row["slug"]),
            "slug": row["slug"],
            "name": row["name"],
            "country": row["country"],
            "region": row["region"],
            "lat": _num(row["lat"], 6),
            "lng": _num(row["lng"], 6),
            "image_url": row["imageUrl"],
        }
        for row in seed_data.DESTINATIONS
    ]


def _supplier_rows() -> list[dict[str, Any]]:
    """The feeds, which surface on the wire as DataSource. A trip's operator has
    no row here — see repository._trip_out for the column that is missing."""
    return [
        {
            "id": seed_uuid("supplier", row["key"]),
            "key": row["key"],
            "name": row["label"],
            "kind": row["kind"],
            "status": row["status"],
            "last_sync_at": _when(row.get("lastSyncAt")),
            "record_count": int(row.get("recordCount", 0)),
            "contact_email": f"feeds+{row['key']}@traveliq.local",
        }
        for row in seed_data.DATA_SOURCES
    ]


def _rule_rows() -> list[dict[str, Any]]:
    return [
        {
            "id": seed_uuid("rule", f"{rule['sourceKey']}|{rule['fieldName']}"),
            "source_key": rule["sourceKey"],
            "field_name": rule["fieldName"],
            "priority": rule["priority"],
            "conditions": rule["conditions"],
        }
        for rule in field_priority_rules()
    ]


def _gallery(trip: Trip) -> list[str]:
    """The hero first, then the rest. trip_media is unique on (trip_id, url), so
    a gallery that repeats the hero would otherwise fail the insert."""
    return list(dict.fromkeys([trip.imageUrl, *trip.gallery]))


def _trip_rows(trips: list[Trip], feed_keys: set[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for trip in trips:
        owner = next((key for key in trip.sources if key in feed_keys), None)
        rows.append(
            {
                "id": seed_uuid("trip", trip.slug),
                "slug": trip.slug,
                "title": trip.title,
                "summary": trip.summary,
                "description": trip.description,
                "destination_id": seed_uuid("destination", trip.destination.slug),
                "supplier_id": seed_uuid("supplier", owner) if owner else None,
                "themes": list(trip.themes),
                "activities": list(trip.activities),
                "audience": list(trip.audience),
                "months": list(trip.months),
                "badges": list(trip.badges or []),
                "sources": list(trip.sources),
                "duration_days": trip.durationDays,
                "price_from": _num(trip.priceFrom, 2),
                "currency": trip.currency,
                "rating": _num(trip.rating, 2),
                "review_count": trip.reviewCount,
                "climate": trip.climate,
                "direct_flights": trip.directFlights,
                "group_size_max": trip.groupSizeMax,
                "available": trip.available,
                "image_url": trip.imageUrl,
                "pinned": bool(trip.pinned),
            }
        )
    return rows


def _media_rows(trips: list[Trip]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for trip in trips:
        for position, url in enumerate(_gallery(trip)):
            rows.append(
                {
                    "id": seed_uuid("trip-media", f"{trip.slug}|{url}"),
                    "trip_id": seed_uuid("trip", trip.slug),
                    "url": url,
                    "kind": "hero" if position == 0 else "gallery",
                    "alt_text": f"{trip.title} — {trip.destination.name}",
                    "position": position,
                }
            )
    return rows


def _departure_rows(trips: list[Trip]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for trip in trips:
        for departure in departures_for(trip):
            rows.append(
                {
                    "id": seed_uuid("departure", f"{trip.slug}|{departure.date}"),
                    "trip_id": seed_uuid("trip", trip.slug),
                    "departure_date": date.fromisoformat(departure.date),
                    "price": _num(departure.price, 2),
                    "currency": "GBP",
                    "seats_left": departure.seatsLeft,
                    "direct": departure.direct,
                }
            )
    return rows


def _guide_rows() -> list[dict[str, Any]]:
    published = _now()
    return [
        {
            "id": seed_uuid("guide", row["slug"]),
            "slug": row["slug"],
            "title": row["title"],
            "location": row["location"],
            "author": row["author"],
            "days": row["days"],
            "image_url": row["imageUrl"],
            "tags": list(row.get("tags", [])),
            # Staggered so the gallery has a newest-first order worth reading.
            "published_at": published - timedelta(days=index * 6),
        }
        for index, row in enumerate(seed_data.GUIDES)
    ]


def _poi_rows() -> list[dict[str, Any]]:
    """Places are given the destination whose name appears in their location, so
    the repository can measure a real distance from that centre instead of
    trusting a number the seed made up."""
    centres = {row["name"]: row["slug"] for row in seed_data.DESTINATIONS}
    rows: list[dict[str, Any]] = []
    for row in seed_data.PLACES:
        location = str(row["location"])
        home = next((slug for name, slug in centres.items() if name in location), None)
        rows.append(
            {
                "id": seed_uuid("poi", row["id"]),
                "destination_id": seed_uuid("destination", home) if home else None,
                "name": row["name"],
                "kind": row["type"],
                "category": row["category"],
                "location": location,
                "rating": _num(row["rating"], 2) if row.get("rating") is not None else None,
                "price_band": row.get("price"),
                "lat": _num(row["lat"], 6),
                "lng": _num(row["lng"], 6),
                "image_url": row["imageUrl"],
            }
        )
    return rows


def _synonym_rows() -> list[dict[str, Any]]:
    return [
        {
            "id": seed_uuid("synonym", f"{row['term']}|{row.get('market', 'en-GB')}"),
            "term": row["term"],
            "alternatives": list(row["alternatives"]),
            "market": row.get("market", "en-GB"),
        }
        for row in seed_data.SYNONYMS
    ]


def _promotion_rows(
    trip_ids: dict[str, uuid.UUID], author: Optional[uuid.UUID]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in seed_data.PROMOTIONS:
        trip_id = trip_ids.get(str(row.get("tripId", ""))) or trip_ids.get(
            str(row.get("tripTitle", ""))
        )
        if trip_id is None:
            log.warning(
                "skipping promotion %s: nothing in the catalogue matches %r",
                row.get("id"),
                row.get("tripId"),
            )
            continue
        rows.append(
            {
                "id": seed_uuid("promotion", str(row["id"])),
                "trip_id": trip_id,
                "kind": row["kind"],
                "weight": min(_num(row.get("weight", 1), 2), _MAX_WEIGHT),
                "starts_at": _when(row.get("startsAt")),
                "ends_at": _when(row.get("endsAt")),
                "created_by": author,
            }
        )
    return rows


def _config_rows(author: Optional[uuid.UUID]) -> list[dict[str, Any]]:
    cfg = AdminConfig.model_validate(seed_data.ADMIN_CONFIG)
    return [
        {
            "id": seed_uuid("search-config", "default"),
            "scope": "default",
            "searchable_fields": [f.model_dump() for f in cfg.searchableFields],
            "enabled_filters": list(cfg.enabledFilters),
            "results_per_page": cfg.resultsPerPage,
            "fallback_to_lexical": cfg.fallbackToLexical,
            "updated_by": author,
        }
    ]


def _review_rows(
    trip_ids: dict[str, uuid.UUID]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The review queue and the source records it points at.

    A queue entry describes a match against a feed payload the demo dataset does
    not carry, and merge_candidates.right_source_record_id is a real foreign key,
    so each entry gets a stand-in source_records row holding the title it was
    matched on. A live feed writes the whole payload there.
    """
    records: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    for row in seed_data.REVIEW_QUEUE:
        left = trip_ids.get(str(row["leftTitle"]))
        if left is None:
            log.warning(
                "skipping review-queue entry %s: %r is not a seeded trip",
                row.get("id"),
                row["leftTitle"],
            )
            continue
        external_id = _slug(str(row["rightTitle"]))
        record_id = seed_uuid("source-record", f"{row['rightSource']}|{external_id}")
        resolved = row.get("status", "pending") != "pending"
        records.append(
            {
                "id": record_id,
                "source_key": row["rightSource"],
                "external_id": external_id,
                "payload": {"title": row["rightTitle"], "source": row["rightSource"]},
                "checksum": None,
                "trip_id": left if resolved else None,
                "status": "merged" if row.get("status") == "approved" else "queued",
                "processed_at": _now() if resolved else None,
            }
        )
        candidates.append(
            {
                "id": seed_uuid("merge", str(row["id"])),
                "left_trip_id": left,
                "right_source_record_id": record_id,
                "left_title": row["leftTitle"],
                "right_title": row["rightTitle"],
                "left_source": row["leftSource"],
                "right_source": row["rightSource"],
                "score": _num(row["score"], 3),
                "reasons": list(row.get("reasons", [])),
                "status": row.get("status", "pending"),
                "resolved_by": None,
                "resolved_at": _now() if resolved else None,
            }
        )
    return records, candidates


def _search_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The sample log expanded into search_queries and the clicks and bookings
    attributed to it, which is what the analytics SQL actually reads.

    Impressions are not seeded: nothing in AnalyticsOverview reads them, and
    /events records them live once a results page is on screen.
    """
    queries: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    for entry_index, entry in enumerate(seed_data.SAMPLE_SEARCH_LOG):
        query = str(entry.get("query", "")).strip()
        if not query:
            continue
        volume = max(1, int(entry.get("searches", 1)))
        rows = min(volume, _SEARCH_ROWS_PER_ENTRY)
        results = int(entry.get("results", 1))
        clicked = round(rows * int(entry.get("clicks", 0)) / volume)
        booked = round(rows * int(entry.get("bookings", 0)) / volume)
        started = logged_at(entry)
        # Roughly one row in four fell back to the heuristic parser, which is the
        # mix the documented fallback is designed for.
        source = str(entry.get("parseSource") or ("heuristic" if entry_index % 4 == 3 else "ai"))

        for index in range(rows):
            search_id = seed_uuid("search", f"{entry_index}|{index}")
            at = started - timedelta(minutes=index * 7)
            queries.append(
                {
                    "id": search_id,
                    "user_id": None,
                    "session_id": f"seed-{entry_index:03d}",
                    "raw_query": query,
                    "normalised_query": " ".join(query.lower().split()),
                    "parsed": {},
                    "filters": None,
                    "parse_source": source,
                    "confidence": Decimal("0.45") if source == "heuristic" else Decimal("0.82"),
                    "mode": "lexical" if source == "heuristic" else "semantic",
                    "result_count": results,
                    "took_ms": 120 + (index * 37 + entry_index * 11) % 300,
                    "created_at": at,
                }
            )
            if index < clicked:
                events.append(
                    {
                        "id": seed_uuid("event", f"{entry_index}|{index}|click"),
                        "search_id": search_id,
                        "trip_id": None,
                        "type": "click",
                        "position": index % 6,
                        "value": None,
                        "created_at": at + timedelta(seconds=9),
                    }
                )
            if index < booked:
                events.append(
                    {
                        "id": seed_uuid("event", f"{entry_index}|{index}|booking"),
                        "search_id": search_id,
                        "trip_id": None,
                        "type": "booking",
                        "position": index % 6,
                        "value": _num(900 + (index * 137) % 900, 2),
                        "created_at": at + timedelta(minutes=4),
                    }
                )

    return queries, events


def build_plan() -> list[_Table]:
    """Every row the seed would write, in insert order.

    Pure — it touches seed_data and nothing else — so `--dry-run` can report from
    it without a database, and so a mistake in the dataset surfaces as a readable
    error before any transaction is open.
    """
    trips = [Trip.model_validate(row) for row in seed_data.TRIPS]
    trip_ids: dict[str, uuid.UUID] = {}
    for raw, trip in zip(seed_data.TRIPS, trips):
        # Promotions and queue entries reference a trip by whichever handle the
        # dataset had: the seed id, the slug, or the title.
        stable = seed_uuid("trip", trip.slug)
        for handle in (str(raw.get("id", "")), trip.slug, trip.title):
            if handle:
                trip_ids[handle] = stable

    users = _user_rows()
    author = next(
        (row["id"] for row in users if row["role"] in ("editor", "admin")),
        None,
    )
    feed_keys = {str(row["key"]) for row in seed_data.DATA_SOURCES}
    source_records, candidates = _review_rows(trip_ids)
    queries, events = _search_rows()

    return [
        _Table("users", models.User, users, ["email"]),
        _Table("destinations", models.Destination, _destination_rows(), ["slug"]),
        _Table("suppliers", models.Supplier, _supplier_rows(), ["key"]),
        _Table(
            "field_priority_rules",
            models.FieldPriorityRule,
            _rule_rows(),
            ["source_key", "field_name"],
        ),
        _Table("trips", models.Trip, _trip_rows(trips, feed_keys), ["slug"]),
        _Table("trip_media", models.TripMedia, _media_rows(trips), ["trip_id", "url"]),
        _Table(
            "trip_departures",
            models.TripDeparture,
            _departure_rows(trips),
            ["trip_id", "departure_date"],
        ),
        _Table("guides", models.Guide, _guide_rows(), ["slug"]),
        _Table("pois", models.Poi, _poi_rows(), ["id"]),
        _Table("synonyms", models.Synonym, _synonym_rows(), ["term", "market"]),
        _Table("promotions", models.Promotion, _promotion_rows(trip_ids, author), ["id"]),
        _Table("search_config", models.SearchConfig, _config_rows(author), ["scope"]),
        _Table("source_records", models.SourceRecord, source_records, ["source_key", "external_id"]),
        _Table("merge_candidates", models.MergeCandidate, candidates, ["id"]),
        _Table("search_queries", models.SearchQuery, queries, ["id"]),
        _Table("search_events", models.SearchEvent, events, ["id"]),
    ]


# --- Writing ---------------------------------------------------------------

async def _upsert(s: AsyncSession, table: _Table) -> None:
    if not table.rows:
        return
    stmt = pg_insert(table.model).values(table.rows)
    columns = [name for name in table.rows[0] if name != "id" and name not in table.conflict]
    assignments = {name: stmt.excluded[name] for name in columns}
    if "updated_at" in table.model.__table__.c:
        # onupdate= never reaches an ON CONFLICT SET clause, so the timestamp is
        # set here or a reseed leaves it stale.
        assignments["updated_at"] = _now()
    await s.execute(
        stmt.on_conflict_do_update(index_elements=table.conflict, set_=assignments)
    )


async def _truncate(s: AsyncSession) -> None:
    log.info("--reset: emptying %d tables before loading", len(_TRUNCATE_ORDER))
    await s.execute(text(f"truncate table {', '.join(_TRUNCATE_ORDER)} cascade"))


async def insert_seed(*, reset: bool = False) -> dict[str, int]:
    """Load the dataset into an existing schema. Returns the row count per table.

    Also called from repository._ensure_seeded, so a fresh database that the API
    finds empty is loaded on first boot rather than needing a second command."""
    plan = build_plan()
    async with db.session() as s:
        if reset:
            await _truncate(s)
        for table in plan:
            await _upsert(s, table)
    return {table.name: len(table.rows) for table in plan}


# --- CLI -------------------------------------------------------------------

def _report(counts: dict[str, int], verb: str) -> None:
    width = max((len(name) for name in counts), default=0)
    for name, count in counts.items():
        log.info("  %-*s  %6d", width, name, count)
    log.info("%s %d rows across %d tables", verb, sum(counts.values()), len(counts))
    log.info(
        "empty by design: bookings and saved_items (a checkout and a signed-in "
        "traveller create those), audit_log (the admin panel writes it)"
    )


def _dsn_target() -> str:
    """The DSN with the credentials taken off, for an error message."""
    return settings.database_url.rsplit("@", 1)[-1] or "the configured host"


async def _run(reset: bool, dry_run: bool) -> int:
    if dry_run:
        plan = build_plan()
        _report({table.name: len(table.rows) for table in plan}, "would write")
        return 0

    if not settings.db_configured():
        log.error(
            "DATABASE_URL is not set, so there is nothing to seed.\n"
            "  Start one:  docker compose -f backend/docker-compose.yml up -d\n"
            "  Then put the DSN in backend/.env, for example:\n"
            "    DATABASE_URL=postgresql+asyncpg://traveliq:traveliq@localhost:5432/traveliq\n"
            "  The API does not need it: with no DSN it serves the in-memory seed catalogue."
        )
        return 2

    try:
        if not await db.ping():
            log.error(
                "cannot reach postgres at %s.\n"
                "  Check the container is running (docker compose ps) and that the user, "
                "password and database name in DATABASE_URL match it.",
                _dsn_target(),
            )
            return 3
        await db.create_all()
        counts = await insert_seed(reset=reset)
    finally:
        await db.dispose()

    _report(counts, "wrote")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.seed",
        description="Create the TravelIQ schema and load the demo catalogue.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="empty every table first — use when the dataset's shape has changed, "
        "not just its contents. Destroys searches and bookings recorded so far.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report the row count per table without connecting to anything",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="[seed] %(message)s")
    return asyncio.run(_run(args.reset, args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
