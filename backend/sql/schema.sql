-- TravelIQ Search Engine - PostgreSQL schema (Postgres 16)
--
-- The reviewable artefact. backend/app/models.py declares the same 19 tables for
-- SQLAlchemy and the two are kept in step by hand; if they ever disagree, this is
-- the file a DBA signs off and the models follow it.
--
-- Conventions
--   * uuid surrogate keys everywhere (gen_random_uuid(), built in since PG 13).
--     Rows arrive concurrently from a CMS export, supplier feeds and an
--     enrichment job, so ids must be mintable before insert. Natural keys sit
--     alongside as unique constraints and are what the API looks up by:
--     trips.slug, destinations.slug, suppliers.key, (source_key, external_id).
--   * money is numeric(10,2), never double precision.
--   * every timestamp is timestamptz; the application stores UTC.
--   * text[] for the free-text facets, so one GIN index serves both the filter
--     and the facet count; smallint[] for months, which holds 1..12 and is
--     filtered numerically.
--   * check constraints only where they encode a rule the application cannot be
--     trusted to remember: bounded ratings, 0..1 scores, and the four small
--     enumerations (role, kind, status, event type).
--
-- Idempotent: safe to re-run. Order: this file, then indexes.sql.

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram similarity, for typo-tolerant title search

-- Production path for the semantic layer. The POC keeps embeddings in process
-- (numpy, app/rag.py) so it can run with no extension privileges at all; moving
-- them into Postgres means enabling this and adding trips.embedding vector(1536).
-- CREATE EXTENSION IF NOT EXISTS vector;


-- Keeps updated_at honest for writers that are not the ORM (psql, migrations).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================ people ========

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         varchar(320) NOT NULL UNIQUE,
    display_name  varchar(120) NOT NULL,
    role          varchar(16) NOT NULL DEFAULT 'traveller',
    -- Authentication is not implemented in the POC. The column exists so the
    -- admin routes have somewhere to hang once a real auth provider is wired in.
    password_hash text,
    last_seen_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_users_role CHECK (role IN ('traveller', 'editor', 'admin'))
);


-- ========================================================= catalogue ========

CREATE TABLE IF NOT EXISTS destinations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       varchar(120) NOT NULL UNIQUE,   -- URL segment: /search?destination=iceland
    name       varchar(160) NOT NULL,
    country    varchar(120) NOT NULL,
    region     varchar(120) NOT NULL,          -- 'Nordics', 'Southern Europe' - a facet, not prose
    lat        numeric(9, 6) NOT NULL,
    lng        numeric(9, 6) NOT NULL,
    image_url  text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_destinations_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT ck_destinations_lng CHECK (lng BETWEEN -180 AND 180)
);


-- A feed we take trips from. Surfaces on the wire as DataSource, which is why the
-- sync status and record count live here rather than in a separate health table.
CREATE TABLE IF NOT EXISTS suppliers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key           varchar(64) NOT NULL UNIQUE,  -- 'cms', 'supplier-atlas', 'enrichment'
    name          varchar(160) NOT NULL,
    kind          varchar(16) NOT NULL,
    status        varchar(16) NOT NULL DEFAULT 'healthy',
    last_sync_at  timestamptz,
    record_count  integer NOT NULL DEFAULT 0,   -- rows this feed currently accounts for
    contact_email varchar(320),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_suppliers_kind CHECK (kind IN ('cms', 'supplier', 'enrichment')),
    CONSTRAINT ck_suppliers_status CHECK (status IN ('healthy', 'syncing', 'stale', 'error')),
    CONSTRAINT ck_suppliers_record_count CHECK (record_count >= 0)
);


CREATE TABLE IF NOT EXISTS trips (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            varchar(160) NOT NULL UNIQUE,
    title           varchar(200) NOT NULL,
    summary         text NOT NULL,      -- one sentence, shown on the result card
    description     text NOT NULL,      -- full copy, third weight in the tsvector
    destination_id  uuid NOT NULL REFERENCES destinations (id) ON DELETE RESTRICT,
    -- A trip outlives the feed it arrived on, so retiring a supplier must not
    -- take the trip with it.
    supplier_id     uuid REFERENCES suppliers (id) ON DELETE SET NULL,

    themes          text[] NOT NULL DEFAULT '{}',      -- 'Northern Lights', 'Beach', 'Culture'
    activities      text[] NOT NULL DEFAULT '{}',      -- 'Walking', 'Diving', 'Food tour'
    audience        text[] NOT NULL DEFAULT '{}',      -- 'Family', 'Couples', 'Solo', ...
    months          smallint[] NOT NULL DEFAULT '{}',  -- departure months, 1..12
    badges          text[] NOT NULL DEFAULT '{}',
    -- Provenance keys, denormalised from source_records so a result card can show
    -- where a trip came from without a join per row.
    sources         text[] NOT NULL DEFAULT '{}',

    duration_days   smallint NOT NULL,
    price_from      numeric(10, 2) NOT NULL,   -- lead-in price; real prices are per departure
    currency        varchar(3) NOT NULL DEFAULT 'GBP',
    rating          numeric(3, 2) NOT NULL DEFAULT 0,
    review_count    integer NOT NULL DEFAULT 0,
    climate         varchar(8) NOT NULL,
    direct_flights  boolean NOT NULL DEFAULT false,
    group_size_max  smallint NOT NULL,
    available       boolean NOT NULL DEFAULT true,
    image_url       text NOT NULL,             -- hero; the rest of the gallery is trip_media
    pinned          boolean NOT NULL DEFAULT false,   -- editorial pin, mirrors an active promotion

    -- Stored, weighted document. Title outranks summary outranks description, so
    -- ts_rank_cd gives a sensible order without every query restating the weights.
    search_document tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
    ) STORED,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_trips_duration CHECK (duration_days BETWEEN 1 AND 60),
    CONSTRAINT ck_trips_price_from CHECK (price_from >= 0),
    CONSTRAINT ck_trips_rating CHECK (rating BETWEEN 0 AND 5),
    CONSTRAINT ck_trips_review_count CHECK (review_count >= 0),
    CONSTRAINT ck_trips_climate CHECK (climate IN ('warm', 'mild', 'cold')),
    CONSTRAINT ck_trips_group_size CHECK (group_size_max BETWEEN 1 AND 60),
    CONSTRAINT ck_trips_currency CHECK (char_length(currency) = 3)
);


-- Gallery imagery. The hero stays on trips.image_url because every result card
-- needs it; everything else lives here so a trip can gain photographs without
-- rewriting the trips row.
CREATE TABLE IF NOT EXISTS trip_media (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id    uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    url        text NOT NULL,
    kind       varchar(16) NOT NULL DEFAULT 'gallery',
    alt_text   text,                            -- needed for AA; null means "not written yet"
    position   smallint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_trip_media_trip_url UNIQUE (trip_id, url),
    CONSTRAINT ck_trip_media_kind CHECK (kind IN ('hero', 'gallery', 'map'))
);


CREATE TABLE IF NOT EXISTS trip_departures (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id        uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    departure_date date NOT NULL,
    price          numeric(10, 2) NOT NULL,
    currency       varchar(3) NOT NULL DEFAULT 'GBP',
    seats_left     smallint NOT NULL DEFAULT 0,
    direct         boolean NOT NULL DEFAULT false,   -- direct flights on this date specifically
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_trip_departures_trip_date UNIQUE (trip_id, departure_date),
    CONSTRAINT ck_trip_departures_price CHECK (price >= 0),
    CONSTRAINT ck_trip_departures_seats CHECK (seats_left >= 0)
);


CREATE TABLE IF NOT EXISTS guides (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         varchar(160) NOT NULL UNIQUE,
    title        varchar(200) NOT NULL,
    location     varchar(160) NOT NULL,
    author       varchar(120) NOT NULL,
    days         smallint NOT NULL,
    image_url    text NOT NULL,
    tags         text[] NOT NULL DEFAULT '{}',
    published_at timestamptz,                  -- null = draft, excluded from GET /guides
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_guides_days CHECK (days BETWEEN 1 AND 60)
);


-- Things to do, restaurants and stays for the Discover map. distance_miles is
-- deliberately absent: it is relative to wherever the traveller searched from, so
-- it is computed per request from lat/lng rather than stored.
CREATE TABLE IF NOT EXISTS pois (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    destination_id uuid REFERENCES destinations (id) ON DELETE SET NULL,
    name           varchar(200) NOT NULL,
    kind           varchar(32) NOT NULL,        -- museum, restaurant, hotel, landmark
    category       varchar(24) NOT NULL,        -- which Discover rail this belongs to
    location       varchar(200) NOT NULL,
    rating         numeric(3, 2),
    price_band     varchar(8),                  -- '£' .. '££££'
    lat            numeric(9, 6) NOT NULL,
    lng            numeric(9, 6) NOT NULL,
    image_url      text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_pois_category CHECK (category IN ('things-to-do', 'restaurants', 'stays')),
    CONSTRAINT ck_pois_rating CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
    CONSTRAINT ck_pois_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT ck_pois_lng CHECK (lng BETWEEN -180 AND 180)
);


-- ======================================= unified catalogue: ingest ==========

-- Every payload a feed has ever handed us, kept verbatim. Without this the merge
-- is irreversible: you cannot re-run a changed priority rule over history, and you
-- cannot answer "where did this price come from?".
CREATE TABLE IF NOT EXISTS source_records (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key   varchar(64) NOT NULL REFERENCES suppliers (key) ON DELETE CASCADE,
    external_id  varchar(200) NOT NULL,        -- the feed's own id for this trip
    payload      jsonb NOT NULL,
    checksum     varchar(64),                  -- md5 of the normalised payload; skips unchanged rows
    trip_id      uuid REFERENCES trips (id) ON DELETE SET NULL,   -- what it resolved to
    status       varchar(16) NOT NULL DEFAULT 'new',
    received_at  timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    CONSTRAINT uq_source_records_source_external UNIQUE (source_key, external_id),
    CONSTRAINT ck_source_records_status
        CHECK (status IN ('new', 'merged', 'queued', 'rejected'))
);


-- An incoming record that looks like an existing trip but not confidently enough
-- to merge unattended (score between REVIEW_FLOOR and AUTO_MERGE in app/ingest.py).
-- The admin review queue reads this table.
CREATE TABLE IF NOT EXISTS merge_candidates (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    left_trip_id           uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    right_source_record_id uuid NOT NULL REFERENCES source_records (id) ON DELETE CASCADE,
    -- Titles and source keys are copied in so a resolved candidate still reads as
    -- an audit trail after the trip is retitled or the feed retired.
    left_title             varchar(200) NOT NULL,
    right_title            varchar(200) NOT NULL,
    left_source            varchar(64) NOT NULL,
    right_source           varchar(64) NOT NULL,
    score                  numeric(4, 3) NOT NULL,
    reasons                text[] NOT NULL DEFAULT '{}',   -- 'title 0.91', 'same destination'
    status                 varchar(16) NOT NULL DEFAULT 'pending',
    resolved_by            uuid REFERENCES users (id) ON DELETE SET NULL,
    resolved_at            timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_merge_candidates_score CHECK (score BETWEEN 0 AND 1),
    CONSTRAINT ck_merge_candidates_status
        CHECK (status IN ('pending', 'approved', 'rejected'))
);


-- Per-field source priority: the CMS wins the copy and the imagery, the supplier
-- wins price, dates and availability, enrichment wins ratings and review counts.
-- The lowest priority number wins a contested field.
CREATE TABLE IF NOT EXISTS field_priority_rules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key varchar(64) NOT NULL REFERENCES suppliers (key) ON DELETE CASCADE,
    field_name varchar(64) NOT NULL,
    priority   smallint NOT NULL DEFAULT 100,
    -- e.g. {"onlyIf": {"available": true}, "maxAgeHours": 24} - read by
    -- ingest.merge_fields, JSONB so a new condition needs no migration.
    conditions jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_field_priority_source_field UNIQUE (source_key, field_name),
    CONSTRAINT ck_field_priority_rules_priority CHECK (priority > 0)
);


-- ============================================== search configuration ========

-- Query-time expansion, per market: "northern lights" also matches "aurora".
CREATE TABLE IF NOT EXISTS synonyms (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    term         varchar(120) NOT NULL,
    alternatives text[] NOT NULL,
    market       varchar(16) NOT NULL DEFAULT 'en-GB',   -- the same term can differ per market
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_synonyms_term_market UNIQUE (term, market),
    CONSTRAINT ck_synonyms_alternatives CHECK (cardinality(alternatives) > 0)
);


-- Merchandising override applied after ranking: pin to position one, boost by
-- weight, or hide entirely. The trip title is not stored - the board joins it.
CREATE TABLE IF NOT EXISTS promotions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id    uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    kind       varchar(8) NOT NULL,
    weight     numeric(4, 2) NOT NULL DEFAULT 1,   -- multiplier for 'boost'; ignored otherwise
    starts_at  timestamptz,                        -- null at both ends = always on
    ends_at    timestamptz,
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_promotions_kind CHECK (kind IN ('pin', 'boost', 'hide')),
    CONSTRAINT ck_promotions_weight CHECK (weight >= 0),
    CONSTRAINT ck_promotions_window
        CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);


-- One live row (scope = 'default'). A table rather than a settings file because
-- the admin panel edits it at runtime and the change must survive a redeploy.
CREATE TABLE IF NOT EXISTS search_config (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope               varchar(32) NOT NULL UNIQUE DEFAULT 'default',
    -- [{"field": "title", "weight": 1.0, "enabled": true}, ...] - the same shape
    -- as SearchableField on the wire, so the panel round-trips it untouched.
    searchable_fields   jsonb NOT NULL,
    enabled_filters     text[] NOT NULL DEFAULT '{}',
    results_per_page    smallint NOT NULL DEFAULT 12,
    fallback_to_lexical boolean NOT NULL DEFAULT true,   -- the keyword fallback, as a switch
    updated_by          uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_search_config_results_per_page CHECK (results_per_page BETWEEN 1 AND 60)
);


-- ========================================================= analytics ========

-- One row per POST /search. This row's id is the searchId the frontend then
-- attributes impressions, clicks and bookings to.
CREATE TABLE IF NOT EXISTS search_queries (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid REFERENCES users (id) ON DELETE SET NULL,
    session_id       varchar(64),               -- anonymous visitors still need attribution
    raw_query        text NOT NULL,
    -- Lowercased and whitespace-collapsed. Top searches and the zero-result report
    -- group by this, so 'Iceland  ' and 'iceland' are one query rather than two.
    normalised_query text NOT NULL,
    parsed           jsonb NOT NULL DEFAULT '{}',   -- the ParsedQuery we actually acted on
    filters          jsonb,                         -- explicit UI filters, if any
    parse_source     varchar(16) NOT NULL,          -- 'ai' | 'heuristic'
    confidence       numeric(4, 3),
    mode             varchar(16) NOT NULL,          -- 'semantic' | 'lexical'
    result_count     integer NOT NULL DEFAULT 0,    -- 0 drives the zero-result report
    took_ms          integer NOT NULL DEFAULT 0,    -- measured latency, not an estimate
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_search_queries_source CHECK (parse_source IN ('ai', 'heuristic')),
    CONSTRAINT ck_search_queries_mode CHECK (mode IN ('semantic', 'lexical')),
    CONSTRAINT ck_search_queries_confidence
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT ck_search_queries_result_count CHECK (result_count >= 0),
    CONSTRAINT ck_search_queries_took_ms CHECK (took_ms >= 0)
);


CREATE TABLE IF NOT EXISTS search_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id  uuid NOT NULL REFERENCES search_queries (id) ON DELETE CASCADE,
    -- A deleted trip must not delete the click that proves the search worked.
    trip_id    uuid REFERENCES trips (id) ON DELETE SET NULL,
    type       varchar(16) NOT NULL,
    position   smallint,                        -- 0-based rank the card sat at
    value      numeric(10, 2),                  -- booking value, for conversion by search term
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_search_events_type CHECK (type IN ('impression', 'click', 'booking')),
    CONSTRAINT ck_search_events_position CHECK (position IS NULL OR position >= 0)
);


-- ========================================================== commerce ========

-- Payment and confirmation are out of scope for the POC: POST /events records a
-- 'booking' event and the analytics conversion rate reads that. This table is the
-- shape a real checkout would write to - wiring it up needs a payment provider and
-- a supplier availability call, nothing structural here.
CREATE TABLE IF NOT EXISTS bookings (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference    varchar(16) NOT NULL UNIQUE,   -- human reference, e.g. 'TQ-4F2K9A'
    trip_id      uuid NOT NULL REFERENCES trips (id) ON DELETE RESTRICT,
    departure_id uuid REFERENCES trip_departures (id) ON DELETE SET NULL,
    user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
    -- Attribution: this is what makes "conversion by search term" answerable.
    search_id    uuid REFERENCES search_queries (id) ON DELETE SET NULL,
    travellers   smallint NOT NULL DEFAULT 1,
    total_amount numeric(10, 2) NOT NULL,
    currency     varchar(3) NOT NULL DEFAULT 'GBP',
    status       varchar(16) NOT NULL DEFAULT 'pending',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_bookings_travellers CHECK (travellers BETWEEN 1 AND 60),
    CONSTRAINT ck_bookings_total_amount CHECK (total_amount >= 0),
    CONSTRAINT ck_bookings_status CHECK (status IN ('pending', 'confirmed', 'cancelled'))
);


-- Collections - a traveller's saved trips and guides. Exactly one target per row,
-- enforced rather than trusted.
CREATE TABLE IF NOT EXISTS saved_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    trip_id         uuid REFERENCES trips (id) ON DELETE CASCADE,
    guide_id        uuid REFERENCES guides (id) ON DELETE CASCADE,
    collection_name varchar(80) NOT NULL DEFAULT 'Saved',
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_saved_items_one_target
        CHECK ((trip_id IS NOT NULL) <> (guide_id IS NOT NULL))
);
-- De-duplication is two partial unique indexes rather than one UNIQUE, because
-- UNIQUE over a nullable column would let the same trip be saved any number of
-- times (every row differs by the NULL in the other column).
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_items_trip
    ON saved_items (user_id, collection_name, trip_id) WHERE trip_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_items_guide
    ON saved_items (user_id, collection_name, guide_id) WHERE guide_id IS NOT NULL;


-- Who changed what, in the admin panel and in ingest. entity_id carries no foreign
-- key on purpose: it points at whichever table entity_type names, and the log must
-- outlive the row it describes.
CREATE TABLE IF NOT EXISTS audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor       varchar(320) NOT NULL DEFAULT 'system',   -- email, or 'system' for a job
    action      varchar(64) NOT NULL,                     -- 'promotion.create', 'ingest.merge'
    entity_type varchar(64),
    entity_id   uuid,
    detail      jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);


-- ==================================================== updated_at wiring =====

-- Attached in one pass so adding a table means adding one name to this list.
-- CREATE TRIGGER has no IF NOT EXISTS, hence the drop that keeps the file re-runnable.
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'users', 'destinations', 'suppliers', 'trips', 'guides', 'pois',
        'synonyms', 'search_config', 'bookings'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I '
            'FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl
        );
    END LOOP;
END;
$$;
