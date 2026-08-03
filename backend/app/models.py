"""SQLAlchemy 2.0 models — the system of record for TravelIQ.

Primary keys are `uuid` throughout. Two reasons: rows arrive from several
directions at once (CMS export, supplier feed, enrichment job) so an id that can
be minted client-side without a round trip removes a whole class of ordering
problem from ingest.py; and the wire contract in src/types.ts types every id as
an opaque string, so nothing downstream cares what the bytes mean. Where an
identifier is genuinely part of the domain it gets its own unique constraint
next to the surrogate key — trips.slug, destinations.slug, suppliers.key,
source_records(source_key, external_id) — and those are what the API looks up by.

Money is Numeric(10,2) (never float — 0.1 + 0.2 has no place in a price), all
timestamps are TIMESTAMP WITH TIME ZONE, and the free-text facets that the
search rail counts over (themes, activities, audience) are Postgres arrays so a
single GIN index serves both the filter and the facet count. `months` is
smallint[] rather than text[]: it holds 1..12 and every filter over it is a
numeric membership test, which a text array would make us cast on each row.

The tsvector column on trips is generated and stored rather than computed by an
expression index — see sql/indexes.sql for the reasoning.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

TRIP_DOCUMENT = (
    "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(summary, '')), 'B') || "
    "setweight(to_tsvector('english', coalesce(description, '')), 'C')"
)


class Base(DeclarativeBase):
    # Only the types where one rule holds everywhere: money at two decimals,
    # timestamps always tz-aware, free-form payloads as JSONB. Anything with a
    # narrower precision (rating, match score) declares its own column type.
    type_annotation_map = {
        Decimal: Numeric(10, 2),
        datetime: DateTime(timezone=True),
        dict[str, Any]: JSONB,
    }


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    # onupdate only fires for ORM writes; sql/schema.sql adds a trigger so raw
    # SQL and psql sessions keep the column honest too.
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


# --- People ----------------------------------------------------------------

class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default="traveller")
    # Authentication is not implemented in the POC — the column exists so the
    # admin routes have somewhere to hang once a real auth provider is wired in.
    password_hash: Mapped[Optional[str]] = mapped_column(Text)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column()

    __table_args__ = (
        CheckConstraint("role in ('traveller', 'editor', 'admin')", name="ck_users_role"),
    )


# --- Catalogue -------------------------------------------------------------

class Destination(Base, TimestampMixin):
    __tablename__ = "destinations"

    id: Mapped[uuid.UUID] = _pk()
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    country: Mapped[str] = mapped_column(String(120), nullable=False)
    region: Mapped[str] = mapped_column(String(120), nullable=False)
    lat: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)

    trips: Mapped[list["Trip"]] = relationship(back_populates="destination")

    __table_args__ = (
        CheckConstraint("lat between -90 and 90", name="ck_destinations_lat"),
        CheckConstraint("lng between -180 and 180", name="ck_destinations_lng"),
    )


class Supplier(Base, TimestampMixin):
    """A feed we take trips from. Surfaces on the wire as DataSource, which is
    why status and record_count live here rather than in a separate health table."""

    __tablename__ = "suppliers"

    id: Mapped[uuid.UUID] = _pk()
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="healthy")
    last_sync_at: Mapped[Optional[datetime]] = mapped_column()
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    contact_email: Mapped[Optional[str]] = mapped_column(String(320))

    __table_args__ = (
        CheckConstraint("kind in ('cms', 'supplier', 'enrichment')", name="ck_suppliers_kind"),
        CheckConstraint(
            "status in ('healthy', 'syncing', 'stale', 'error')", name="ck_suppliers_status"
        ),
        CheckConstraint("record_count >= 0", name="ck_suppliers_record_count"),
    )


class Trip(Base, TimestampMixin):
    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = _pk()
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    destination_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("destinations.id", ondelete="RESTRICT"), nullable=False
    )
    # A trip outlives the feed it arrived on, so losing a supplier row must not
    # take the trip with it.
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL")
    )

    themes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    activities: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    audience: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    months: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger), nullable=False, server_default="{}"
    )
    badges: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    # Provenance keys, denormalised from source_records so a result card can show
    # where a trip came from without a join per row.
    sources: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")

    duration_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    price_from: Mapped[Decimal] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="GBP")
    rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False, server_default="0")
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    climate: Mapped[str] = mapped_column(String(32), nullable=False)
    direct_flights: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    group_size_max: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    search_document: Mapped[Optional[str]] = mapped_column(
        TSVECTOR, Computed(TRIP_DOCUMENT, persisted=True)
    )

    # Lazy loading is a footgun under asyncio (an implicit IO on attribute
    # access raises), so the two collections a trip is never useful without are
    # eager by default.
    destination: Mapped["Destination"] = relationship(back_populates="trips", lazy="joined")
    supplier: Mapped[Optional["Supplier"]] = relationship(lazy="joined")
    media: Mapped[list["TripMedia"]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        order_by="TripMedia.position",
        lazy="selectin",
    )
    departures: Mapped[list["TripDeparture"]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        order_by="TripDeparture.departure_date",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint("duration_days between 1 and 60", name="ck_trips_duration"),
        CheckConstraint("price_from >= 0", name="ck_trips_price_from"),
        CheckConstraint("rating between 0 and 5", name="ck_trips_rating"),
        CheckConstraint("review_count >= 0", name="ck_trips_review_count"),
        CheckConstraint("climate in ('warm', 'mild', 'cold')", name="ck_trips_climate"),
        CheckConstraint("group_size_max between 1 and 60", name="ck_trips_group_size"),
        CheckConstraint("char_length(currency) = 3", name="ck_trips_currency"),
    )


class TripMedia(Base):
    """Gallery images. The hero lives on trips.image_url because every result
    card needs it; everything else is here so a trip can gain photographs
    without rewriting the trips row."""

    __tablename__ = "trip_media"

    id: Mapped[uuid.UUID] = _pk()
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="gallery")
    alt_text: Mapped[Optional[str]] = mapped_column(Text)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    trip: Mapped["Trip"] = relationship(back_populates="media")

    __table_args__ = (
        UniqueConstraint("trip_id", "url", name="uq_trip_media_trip_url"),
        CheckConstraint("kind in ('hero', 'gallery', 'map')", name="ck_trip_media_kind"),
    )


class TripDeparture(Base):
    __tablename__ = "trip_departures"

    id: Mapped[uuid.UUID] = _pk()
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    departure_date: Mapped[date] = mapped_column(Date, nullable=False)
    price: Mapped[Decimal] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="GBP")
    seats_left: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    direct: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    trip: Mapped["Trip"] = relationship(back_populates="departures")

    __table_args__ = (
        UniqueConstraint("trip_id", "departure_date", name="uq_trip_departures_trip_date"),
        CheckConstraint("price >= 0", name="ck_trip_departures_price"),
        CheckConstraint("seats_left >= 0", name="ck_trip_departures_seats"),
    )


class Guide(Base, TimestampMixin):
    __tablename__ = "guides"

    id: Mapped[uuid.UUID] = _pk()
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    location: Mapped[str] = mapped_column(String(160), nullable=False)
    author: Mapped[str] = mapped_column(String(120), nullable=False)
    days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    published_at: Mapped[Optional[datetime]] = mapped_column()

    __table_args__ = (CheckConstraint("days between 1 and 60", name="ck_guides_days"),)


class Poi(Base, TimestampMixin):
    """Things to do, restaurants and stays for the Discover map. distance_miles
    is deliberately absent: it is relative to whatever the traveller searched
    from, so it is computed per request from lat/lng, not stored."""

    __tablename__ = "pois"

    id: Mapped[uuid.UUID] = _pk()
    destination_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("destinations.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # museum, restaurant, hotel, ...
    category: Mapped[str] = mapped_column(String(24), nullable=False)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    rating: Mapped[Optional[Decimal]] = mapped_column(Numeric(3, 2))
    price_band: Mapped[Optional[str]] = mapped_column(String(20))  # e.g. '££', '£38/night', 'From £9'
    lat: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "category in ('things-to-do', 'restaurants', 'stays')", name="ck_pois_category"
        ),
        CheckConstraint("rating is null or rating between 0 and 5", name="ck_pois_rating"),
        CheckConstraint("lat between -90 and 90", name="ck_pois_lat"),
        CheckConstraint("lng between -180 and 180", name="ck_pois_lng"),
    )


# --- Unified catalogue: ingest, matching, merge ------------------------------

class SourceRecord(Base):
    """Every payload a feed has ever handed us, kept verbatim. Without this the
    merge is irreversible — you cannot re-run a rule change over history, and
    you cannot answer "where did this price come from?"."""

    __tablename__ = "source_records"

    id: Mapped[uuid.UUID] = _pk()
    source_key: Mapped[str] = mapped_column(
        ForeignKey("suppliers.key", ondelete="CASCADE"), nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(nullable=False)
    # md5 of the normalised payload: lets a re-sync skip rows that have not moved.
    checksum: Mapped[Optional[str]] = mapped_column(String(64))
    trip_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="new")
    received_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    processed_at: Mapped[Optional[datetime]] = mapped_column()

    __table_args__ = (
        UniqueConstraint("source_key", "external_id", name="uq_source_records_source_external"),
        CheckConstraint(
            "status in ('new', 'merged', 'queued', 'rejected')", name="ck_source_records_status"
        ),
    )


class MergeCandidate(Base):
    """An incoming record that looks like an existing trip but not confidently
    enough to merge unattended (score between review_floor and
    auto_merge_threshold). The admin review queue reads this table."""

    __tablename__ = "merge_candidates"

    id: Mapped[uuid.UUID] = _pk()
    left_trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    right_source_record_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("source_records.id", ondelete="CASCADE"), nullable=False
    )
    # Titles and source keys are copied in so a resolved candidate still reads
    # as an audit trail after the trip has been retitled or the feed retired.
    left_title: Mapped[str] = mapped_column(String(200), nullable=False)
    right_title: Mapped[str] = mapped_column(String(200), nullable=False)
    left_source: Mapped[str] = mapped_column(String(64), nullable=False)
    right_source: Mapped[str] = mapped_column(String(64), nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    reasons: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    resolved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("score between 0 and 1", name="ck_merge_candidates_score"),
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="ck_merge_candidates_status"
        ),
    )


class FieldPriorityRule(Base):
    """Per-field source priority: CMS wins the copy and the imagery, the
    supplier wins price, dates and availability, enrichment wins ratings.
    Lowest priority number wins a contested field."""

    __tablename__ = "field_priority_rules"

    id: Mapped[uuid.UUID] = _pk()
    source_key: Mapped[str] = mapped_column(
        ForeignKey("suppliers.key", ondelete="CASCADE"), nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(64), nullable=False)
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="100")
    # e.g. {"onlyIf": {"available": true}, "maxAgeHours": 24} — read by
    # ingest.merge_fields, kept as JSONB so a new condition needs no migration.
    conditions: Mapped[dict[str, Any]] = mapped_column(nullable=False, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("source_key", "field_name", name="uq_field_priority_source_field"),
        CheckConstraint("priority > 0", name="ck_field_priority_rules_priority"),
    )


# --- Search configuration ---------------------------------------------------

class Synonym(Base, TimestampMixin):
    """Query-time expansion, per market: "northern lights" also matches
    "aurora"; "cheap" also matches "value" and "budget"."""

    __tablename__ = "synonyms"

    id: Mapped[uuid.UUID] = _pk()
    term: Mapped[str] = mapped_column(String(120), nullable=False)
    alternatives: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    market: Mapped[str] = mapped_column(String(16), nullable=False, server_default="en-GB")

    __table_args__ = (
        UniqueConstraint("term", "market", name="uq_synonyms_term_market"),
        CheckConstraint("cardinality(alternatives) > 0", name="ck_synonyms_alternatives"),
    )


class Promotion(Base):
    """Merchandising override applied after ranking: pin to position one, boost
    by weight, or hide entirely. trip_title is not stored — the board joins it."""

    __tablename__ = "promotions"

    id: Mapped[uuid.UUID] = _pk()
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    weight: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, server_default="1")
    starts_at: Mapped[Optional[datetime]] = mapped_column()
    ends_at: Mapped[Optional[datetime]] = mapped_column()
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("kind in ('pin', 'boost', 'hide')", name="ck_promotions_kind"),
        CheckConstraint("weight >= 0", name="ck_promotions_weight"),
        CheckConstraint(
            "starts_at is null or ends_at is null or ends_at > starts_at",
            name="ck_promotions_window",
        ),
    )


class SearchConfig(Base):
    """One live row (scope = 'default'). Kept as a table rather than a settings
    file because the admin panel edits it at runtime and the change must survive
    a redeploy."""

    __tablename__ = "search_config"

    id: Mapped[uuid.UUID] = _pk()
    scope: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False, server_default="default"
    )
    # [{"field": "title", "weight": 1.0, "enabled": true}, ...] — shape mirrors
    # SearchableField on the wire, so the panel round-trips it untouched.
    searchable_fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    enabled_filters: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    results_per_page: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="12")
    fallback_to_lexical: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "results_per_page between 1 and 60", name="ck_search_config_results_per_page"
        ),
    )


# --- Analytics -------------------------------------------------------------

class SearchQuery(Base):
    """One row per /search call — this row's id is the searchId the frontend
    then attributes impressions, clicks and bookings to."""

    __tablename__ = "search_queries"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    session_id: Mapped[Optional[str]] = mapped_column(String(64))
    raw_query: Mapped[str] = mapped_column(Text, nullable=False)
    # Lowercased, whitespace-collapsed. Top-searches and zero-result reports
    # group by this so "Iceland  " and "iceland" are one query, not two.
    normalised_query: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict[str, Any]] = mapped_column(nullable=False, server_default="{}")
    filters: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    parse_source: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 3))
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    took_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    events: Mapped[list["SearchEvent"]] = relationship(
        back_populates="search", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("parse_source in ('ai', 'heuristic')", name="ck_search_queries_source"),
        CheckConstraint("mode in ('semantic', 'lexical')", name="ck_search_queries_mode"),
        CheckConstraint(
            "confidence is null or confidence between 0 and 1",
            name="ck_search_queries_confidence",
        ),
        CheckConstraint("result_count >= 0", name="ck_search_queries_result_count"),
        CheckConstraint("took_ms >= 0", name="ck_search_queries_took_ms"),
    )


class SearchEvent(Base):
    __tablename__ = "search_events"

    id: Mapped[uuid.UUID] = _pk()
    search_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("search_queries.id", ondelete="CASCADE"), nullable=False
    )
    # A deleted trip must not delete the click that proves the search worked.
    trip_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL")
    )
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    position: Mapped[Optional[int]] = mapped_column(SmallInteger)
    value: Mapped[Optional[Decimal]] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    search: Mapped["SearchQuery"] = relationship(back_populates="events")

    __table_args__ = (
        CheckConstraint(
            "type in ('impression', 'click', 'booking')", name="ck_search_events_type"
        ),
        CheckConstraint("position is null or position >= 0", name="ck_search_events_position"),
    )


# --- Commerce --------------------------------------------------------------

class Booking(Base, TimestampMixin):
    """Payment and confirmation are out of scope for the POC: /events records a
    'booking' event and the analytics conversion rate reads that. This table is
    the shape a real checkout would write to — wiring it up needs a payment
    provider and a supplier availability call, nothing structural here."""

    __tablename__ = "bookings"

    id: Mapped[uuid.UUID] = _pk()
    reference: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trips.id", ondelete="RESTRICT"), nullable=False
    )
    departure_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("trip_departures.id", ondelete="SET NULL")
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Attribution: this is what makes "conversion by search term" answerable.
    search_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("search_queries.id", ondelete="SET NULL")
    )
    travellers: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="1")
    total_amount: Mapped[Decimal] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="GBP")
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")

    __table_args__ = (
        CheckConstraint("travellers between 1 and 60", name="ck_bookings_travellers"),
        CheckConstraint("total_amount >= 0", name="ck_bookings_total_amount"),
        CheckConstraint(
            "status in ('pending', 'confirmed', 'cancelled')", name="ck_bookings_status"
        ),
    )


class SavedItem(Base):
    """Collections — a traveller's saved trips and guides. Exactly one target
    per row, enforced rather than trusted."""

    __tablename__ = "saved_items"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    trip_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE")
    )
    guide_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("guides.id", ondelete="CASCADE")
    )
    collection_name: Mapped[str] = mapped_column(String(80), nullable=False, server_default="Saved")
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(trip_id is not null) <> (guide_id is not null)", name="ck_saved_items_one_target"
        ),
        # Partial uniques, because a plain UNIQUE over nullable columns lets the
        # same trip be saved to the same collection any number of times.
        Index(
            "uq_saved_items_trip",
            "user_id",
            "collection_name",
            "trip_id",
            unique=True,
            postgresql_where=text("trip_id is not null"),
        ),
        Index(
            "uq_saved_items_guide",
            "user_id",
            "collection_name",
            "guide_id",
            unique=True,
            postgresql_where=text("guide_id is not null"),
        ),
    )


class AuditLog(Base):
    """Who changed what, in the admin panel and in ingest. entity_id carries no
    foreign key on purpose: it points at whichever table entity_type names, and
    the log must outlive the row it describes."""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = _pk()
    actor: Mapped[str] = mapped_column(String(320), nullable=False, server_default="system")
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String(64))
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    detail: Mapped[dict[str, Any]] = mapped_column(nullable=False, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
