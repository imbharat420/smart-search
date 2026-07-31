-- TravelIQ Search Engine - search and reporting indexes (Postgres 16)
--
-- Run after schema.sql. Every index below has a query behind it; if you cannot
-- name the query, delete the index - each one is a write cost on ingest, and
-- ingest runs far more often than any of these read paths.
--
-- Two deliberate choices worth arguing about up front:
--
-- 1. trips.search_document is a STORED GENERATED column, not an expression index.
--    An expression index on to_tsvector(...) would satisfy the WHERE clause just
--    as well, but ranking needs the vector as a value: ts_rank_cd(search_document,
--    query) can read the stored column, whereas an expression index forces Postgres
--    to rebuild the tsvector per candidate row at rank time. It also keeps the A/B/C
--    field weights in exactly one place, shared by the index and the ORDER BY,
--    instead of copied into every query. The cost is roughly one extra tsvector per
--    trip on disk, which for a catalogue this size is nothing.
--
-- 2. Free-text facets are arrays with GIN indexes rather than junction tables.
--    Themes, activities and audience are a closed-ish vocabulary that is only ever
--    read as a whole ('&&' to filter, unnest+count to build the facet rail), never
--    joined to attributes of its own. One GIN index answers both the filter and
--    the count; two junction tables would need four indexes and a join per facet.

-- ===================================================== trips: retrieval =====

-- Full-text search over title/summary/description with field weighting.
CREATE INDEX IF NOT EXISTS ix_trips_search_document
    ON trips USING gin (search_document);

-- Typo tolerance and mid-word matching on the one field travellers actually type
-- ("northen lights", "reykjavik"). Needs pg_trgm from schema.sql.
CREATE INDEX IF NOT EXISTS ix_trips_title_trgm
    ON trips USING gin (title gin_trgm_ops);

-- Facet filters and facet counts: themes && ARRAY['Northern Lights'].
CREATE INDEX IF NOT EXISTS ix_trips_themes
    ON trips USING gin (themes);

-- Same, for the activity rail.
CREATE INDEX IF NOT EXISTS ix_trips_activities
    ON trips USING gin (activities);

-- Same, for the "who is travelling" rail (Family, Couples, Solo, ...).
CREATE INDEX IF NOT EXISTS ix_trips_audience
    ON trips USING gin (audience);

-- "somewhere warm in november" resolves to months && ARRAY[11].
CREATE INDEX IF NOT EXISTS ix_trips_months
    ON trips USING gin (months);

-- Budget filter and the price-asc / price-desc sorts.
CREATE INDEX IF NOT EXISTS ix_trips_price_from
    ON trips (price_from);

-- "7 day walking holiday" filters a duration range and sorts by it.
CREATE INDEX IF NOT EXISTS ix_trips_duration_days
    ON trips (duration_days);

-- The rating sort, highest first.
CREATE INDEX IF NOT EXISTS ix_trips_rating
    ON trips (rating DESC);

-- Destination pages and the destination facet; the FK gives no index by itself.
CREATE INDEX IF NOT EXISTS ix_trips_destination_id
    ON trips (destination_id);

-- The default browse: available trips, cheapest first. Partial, because a sold-out
-- trip is never in that list and does not belong in the index.
CREATE INDEX IF NOT EXISTS ix_trips_available_price
    ON trips (price_from) WHERE available;

-- Pinned trips are read on every search to hoist them; there are a handful.
CREATE INDEX IF NOT EXISTS ix_trips_pinned
    ON trips (id) WHERE pinned;

-- Production path once pgvector is enabled and trips.embedding exists. Lists tuned
-- for a catalogue in the low thousands; revisit at 100k rows.
-- CREATE INDEX ix_trips_embedding ON trips
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);


-- ============================================ trips: children and media =====

-- The departures table on a trip page, in date order.
CREATE INDEX IF NOT EXISTS ix_trip_departures_trip_date
    ON trip_departures (trip_id, departure_date);

-- "which trips have a seat in November?" - only bookable dates are ever asked for.
CREATE INDEX IF NOT EXISTS ix_trip_departures_bookable
    ON trip_departures (departure_date) WHERE seats_left > 0;

-- Gallery fetch for one trip, already ordered.
CREATE INDEX IF NOT EXISTS ix_trip_media_trip_position
    ON trip_media (trip_id, position);


-- ================================================== guides and places =======

-- Guides are a few dozen rows, read whole and searched rarely, so an expression
-- index is the right trade here: no extra column to keep in step, and the rebuild
-- cost at query time is irrelevant at this cardinality. Contrast trips, above.
CREATE INDEX IF NOT EXISTS ix_guides_search
    ON guides USING gin (to_tsvector('english', title || ' ' || location));

-- Tag filter on the Inspiration grid.
CREATE INDEX IF NOT EXISTS ix_guides_tags
    ON guides USING gin (tags);

-- Published guides in reverse-chronological order - the Inspiration default.
CREATE INDEX IF NOT EXISTS ix_guides_published_at
    ON guides (published_at DESC) WHERE published_at IS NOT NULL;

-- The Discover rails: one category, best rated first.
CREATE INDEX IF NOT EXISTS ix_pois_category_rating
    ON pois (category, rating DESC NULLS LAST);

-- Free-text place lookup ("blue lagoon"), typo-tolerant like trips.title.
CREATE INDEX IF NOT EXISTS ix_pois_name_trgm
    ON pois USING gin (name gin_trgm_ops);

-- Radius / near-me is computed in the application from lat and lng (haversine over
-- a small set). A real geospatial index means PostGIS and a geography column;
-- documented as the production path, not needed at this row count.
CREATE INDEX IF NOT EXISTS ix_pois_destination_id
    ON pois (destination_id);


-- ========================================================== ingest ==========

-- The ingest loop's own working set: unprocessed rows for one feed.
CREATE INDEX IF NOT EXISTS ix_source_records_source_status
    ON source_records (source_key, status);

-- "show me every source row behind this trip" - the provenance panel.
CREATE INDEX IF NOT EXISTS ix_source_records_trip_id
    ON source_records (trip_id) WHERE trip_id IS NOT NULL;

-- The review queue: pending candidates, most confident first (they are the quickest
-- for a human to confirm). Partial, because resolved rows are history.
CREATE INDEX IF NOT EXISTS ix_merge_candidates_pending
    ON merge_candidates (score DESC) WHERE status = 'pending';

-- Rule lookup during a merge: every field for one source, in priority order.
CREATE INDEX IF NOT EXISTS ix_field_priority_rules_source
    ON field_priority_rules (source_key, priority);


-- =========================================== search config and promotion ====

-- Synonym expansion loads one market's terms per search.
CREATE INDEX IF NOT EXISTS ix_synonyms_market_term
    ON synonyms (market, term);

-- Promotions in force right now, read on every search. The window comparison stays
-- in the query (now() is not immutable, so it cannot live in the predicate).
CREATE INDEX IF NOT EXISTS ix_promotions_kind_window
    ON promotions (kind, starts_at, ends_at);

-- The board groups by trip, and hiding a trip must be cheap to check.
CREATE INDEX IF NOT EXISTS ix_promotions_trip_id
    ON promotions (trip_id);


-- ======================================================= analytics ==========

-- Every analytics query is "the last N days", newest first.
CREATE INDEX IF NOT EXISTS ix_search_queries_created_at
    ON search_queries (created_at DESC);

-- Top searches: GROUP BY normalised_query over a date range.
CREATE INDEX IF NOT EXISTS ix_search_queries_normalised
    ON search_queries (normalised_query, created_at DESC);

-- The zero-result report reads a small slice of a large table, so it gets its own
-- partial index rather than scanning the date index and discarding 95% of rows.
CREATE INDEX IF NOT EXISTS ix_search_queries_zero_result
    ON search_queries (created_at DESC) WHERE result_count = 0;

-- How often the AI parse is actually answering versus the heuristic fallback -
-- the one number that says whether the headline feature is working.
CREATE INDEX IF NOT EXISTS ix_search_queries_parse_source
    ON search_queries (parse_source, created_at DESC);

-- Joining events back to their search: CTR and conversion per query.
CREATE INDEX IF NOT EXISTS ix_search_events_search_id
    ON search_events (search_id);

-- Site-wide CTR and conversion by day, without touching search_queries.
CREATE INDEX IF NOT EXISTS ix_search_events_type_created_at
    ON search_events (type, created_at DESC);

-- Per-trip performance: which cards get clicked when they are shown.
CREATE INDEX IF NOT EXISTS ix_search_events_trip_id
    ON search_events (trip_id) WHERE trip_id IS NOT NULL;

-- Revenue attributed to a search term.
CREATE INDEX IF NOT EXISTS ix_bookings_search_id
    ON bookings (search_id) WHERE search_id IS NOT NULL;

-- Bookings per trip, and the trip page's "recently booked" line.
CREATE INDEX IF NOT EXISTS ix_bookings_trip_created_at
    ON bookings (trip_id, created_at DESC);

-- The audit trail is read newest-first, and occasionally filtered to one entity.
CREATE INDEX IF NOT EXISTS ix_audit_log_created_at
    ON audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_audit_log_entity
    ON audit_log (entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- A traveller's collections, newest save first.
CREATE INDEX IF NOT EXISTS ix_saved_items_user_created_at
    ON saved_items (user_id, created_at DESC);


-- Fresh statistics matter more than any of the above on a just-seeded database:
-- without them the planner sequential-scans a catalogue it has never counted.
ANALYZE;
