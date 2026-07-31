# Release notes — TravelIQ Search Engine POC

| | |
|---|---|
| Product | TravelIQ Search Engine — AI-powered smart search and discovery for travel and hospitality |
| Build | POC 0.1.0 (`FastAPI title="TravelIQ API", version="0.1.0"`) |
| Sprint | Sprint 1 — POC foundation to working search, Thu 23 July – Wed 29 July 2026 |
| Releases | Five, one per working day, merged `--no-ff` into `master` in order |
| Source of the plan | `docs/sprint-plan.md` |
| Source of the criteria | `docs/scope-and-limitations.md` §7, twenty numbered checks |
| Basis | The e-commerce POC in this repository ("ShopSense") was converted rather than restarted: the multi-provider LLM chain, the SSE chat transport, the embedding index and the lexical fallback survived; the domain, the catalogue and the whole interface were rebuilt |

Each release below gives the day it merged, its feature branches, what shipped for a traveller and
what shipped underneath, the files that carry it, a walk-through anyone can perform in the running
application, the acceptance criteria it satisfies, and what was deliberately left out.

Unless a step says otherwise, every walk-through assumes the frontend on `http://localhost:5173`
(`npm install`, `npm run dev`) and the API on `http://localhost:8000`
(`cd backend`, `uv run uvicorn app.main:app --reload`). Where a step needs a provider key, Postgres or
a stopped service, it says so. Criterion numbers in square brackets refer to
`docs/scope-and-limitations.md` §7.

---

## Release 1 — `release/1-foundation-and-docs`

**Merged Day 1, Thursday 23 July 2026.**
Branches: `feature/doc-review-and-gaps`, `feature/system-architecture`, `feature/scope-and-limitations`,
`feature/design-tokens`.

The document review came first on purpose. Every architectural decision in the following four days
either resolves one of its findings or is recorded as blocked on one.

### What shipped

Nothing a traveller can click yet. What a reader gets is the honest description of the product before
it exists, plus the layer everything else is built on.

- **`docs/doc-review.md`** — 27 findings against `docs/TravelIQ-Search-Engine-Overview.docx`, each
  quoting the sentence at issue, naming the commercial or technical impact, a recommended resolution
  and an owning role. It is the document that catches the contradictions: Algolia named as the search
  engine alongside a no-lock-in claim, Next.js and NestJS named while this repository is Vite and
  FastAPI, "well under a second" with no budget and no measurement method, an undefined review-queue
  SLA and undefined match thresholds, no auth or roles model, no multi-currency, no i18n data model,
  and — for a UK travel product — no ATOL or financial-protection story.
- **`docs/architecture.md`** — container diagram, the search sequence from browser through `/search`,
  `nlq`, `rag`, the repository and back out through `/events`, the ingestion sequence, a module map
  for both applications, a degradation matrix in which every row is a code path that exists, and the
  production delta.
- **`docs/scope-and-limitations.md`** — in-scope and out-of-scope with a destination for every
  exclusion, nine assumptions, eight constraints, non-functional targets that are measurable with
  what was built, fourteen numbered POC limitations, and the twenty acceptance criteria the sprint is
  signed off against.
- **The token and contract layer.** `src/index.css` carries the oklch palette from the design
  reference, refined for contrast: brand yellow is never a text colour on white and never a
  full-strength large-area fill, `--panel` is the warm off-white band, `--ink` is the dark CTA fill.
  One type family (Plus Jakarta Sans) on a fixed scale. `src/types.ts` is the single domain
  vocabulary and mirrors `backend/app/schemas.py` field for field, so JSON crosses the wire without a
  translation layer.
- **`src/lib/api.ts` as the only I/O surface.** Every request is bounded by a 6 s `AbortController`,
  and every read degrades to the seeded catalogue in `src/mock/` instead of throwing.
  `usingMockData()` flips true the first time that happens, which is what later lets the interface
  show a **Demo data** pill rather than an empty screen.
- **The seeded catalogue** the fallback needs: 33 trips, 23 destinations, 12 guides, 11 places, admin
  fixtures, and booking, cancellation, baggage and financial-protection policies. It ships with a
  real local search, parse and analytics rollup (`localSearch`, `localParse`, `localAnalytics`) so the
  offline path is a working search rather than a placeholder.
- The ShopSense components, its two mock API modules and the stray `backend/app/catalog copy.py` were
  removed in the same pass, so nothing dangles.

### Files

`docs/doc-review.md`, `docs/architecture.md`, `docs/scope-and-limitations.md`, `docs/sprint-plan.md`,
`index.html`, `src/index.css`, `src/main.tsx`, `src/types.ts`,
`src/lib/{utils,format,meta,api}.ts`, `src/mock/{catalog,guides,places,admin,policies}.ts`.

### Verify by hand

1. `npm install`, then `npm run dev`, and open `http://localhost:5173`.
2. Open devtools, select `:root` and read the custom properties. Every colour is an `oklch(...)`
   value; the type stack is one family. Search the compiled stylesheet for a hex literal in a
   component class and you will not find one.
3. Run `npx tsc --noEmit`. It must be silent. [1, the TypeScript half]
4. Read `docs/doc-review.md` end to end and check every finding quotes the overview and names an
   owner — there is no filler entry.
5. Read `docs/scope-and-limitations.md` §6 aloud. Those fourteen sentences are the pre-demonstration
   script. [20, three of the five documents]

### Acceptance criteria satisfied

Release acceptance from `docs/sprint-plan.md` §1: the four documents read end to end without a
walk-through, and the token layer compiles clean. From `docs/scope-and-limitations.md` §7: criterion 1
in part (TypeScript compiles; the Python half lands with Release 3), and criterion 20 in part.

### Deliberately deferred

- **No Figma library.** The design system is delivered as tokens in code plus `docs/design-system.md`.
  What would fix it: a Figma library whose variables are generated from `src/index.css` so the two
  cannot drift. Budgeted as two days in the next sprint.
- **Three findings resolved as *decision required*, not answered** — A-01 search engine and its cost
  model, D-02 trade-pricing enforcement, C-01/C-02 multi-currency and multi-locale scope. Each has a
  named owner and a needed-by date in `docs/sprint-plan.md` §5.
- **No automated contrast checking.** Token pairs are checked once by hand in `docs/design-system.md`.

---

## Release 2 — `release/2-design-system-ui`

**Merged Day 2, Friday 24 July 2026.**
Branches: `feature/ui-primitives`, `feature/app-shell-routing`, `feature/wireframes-and-mockups`,
`feature/core-screens`.

### What shipped

This is the release where the repository becomes something you can show someone.

- **A landing page** on `/`, full-bleed and outside the shell: the warm brand band with
  "Search the way travellers talk", a primary **Try a search** action that opens `/search` already
  carrying the overview's first worked query, a secondary **Ask the assistant**, how-it-works,
  popular itineraries, a POC coverage panel and the footer.
- **Inspiration** on `/inspiration` — twelve guides in a gallery grid, filtered by tag, with a saved
  set, a filter sheet on mobile and a working empty state.
- **Discover** on `/discover` — a place list split against a static map with plotted pins, the three
  category rails (things to do, restaurants, stays), a radius control in miles and a place detail
  sheet. The map is honest about being an image; the radius filtering and distance ordering behind it
  are real.
- **The shell** — a 16 px icon rail carrying Home, Search, Inspiration, Discover, Assistant and Admin,
  with the active route indicated and announced, collapsing to bottom tabs below `md`. The traveller
  account button raises a toast saying accounts arrive with the auth service rather than pretending.
- **A quiet 404** with a route back, and `sonner` mounted once in `App.tsx`, themed entirely through
  the token variables.
- **Thirteen UI primitives** with frozen props — button, card, badge, chip, input, skeleton, switch,
  slider, tabs, select, sheet, stars, empty. Every one merges an incoming `className` through `cn()`,
  shows a visible `focus-visible` ring, keeps a hit target of at least 40 px and uses no `any`. The
  sheet traps focus, closes on Escape and locks scroll.
- **`docs/wireframes.md` and `docs/design-system.md`** — all eight screens at desktop and mobile with
  their loading, empty and error states, the three user flows, the token table, the type scale, the
  component inventory with a usage rule each, the do-and-do-not list and the accessibility notes.

### Files

`src/App.tsx`, `src/components/ui/*.tsx` (13), `src/components/layout/{AppShell,SideRail,BottomTabs,SiteFooter}.tsx`,
`src/pages/{Landing,Inspiration,Discover,NotFound}.tsx`,
`src/components/landing/*`, `src/components/inspiration/*`, `src/components/discover/*`,
`docs/wireframes.md`, `docs/design-system.md`.

### Verify by hand

1. Open `http://localhost:5173/`. The landing page renders full-bleed with no side rail.
2. Press Tab from the top of the page. Focus moves through the nav and both hero actions with a
   visible ring at every stop, and never disappears. [16, for the shell]
3. Click **Ask the assistant**. The shell appears with the rail on the left and Assistant lit.
4. Click Inspiration in the rail. Toggle two tags. The grid filters, the count updates, and toggling
   a third that no guide carries gives the empty state rather than a blank column.
5. Click Discover. Switch category rails, drag the radius control down to its minimum and watch the
   list shorten, then open a place to get the detail sheet. Press Escape to close it — focus returns
   to the card you opened.
6. Resize the window to 360 px. The rail becomes bottom tabs; nothing scrolls sideways. Resize to
   1920 px. Nothing stretches past its container. [17]
7. Enter `/nowhere` in the address bar. You get the quiet 404 with a route back, inside the shell.
8. Read the tab title on each of the four screens — each sets its own. [18, for these routes]

### Acceptance criteria satisfied

Release acceptance from `docs/sprint-plan.md` §1: all eight routes reachable and responsive from
360 px to 1920 px, a full keyboard pass of the shell, and no screen hardcoding a colour. From §7:
criteria 16 and 17 for the screens that exist at this point, 18 in part.

### Deliberately deferred

- **The map is a static image.** A tile provider would fix it; this is limitation 3 in
  `docs/scope-and-limitations.md` §6.
- **`/search`, `/trip/:slug`, `/assistant` and `/admin` resolve but are not yet the finished screens.**
  They land in Releases 4 and 5.
- **No dark theme.** The token file is structured for one, but a second palette was not in scope and a
  half-checked dark mode is worse than none.

---

## Release 3 — `release/3-database`

**Merged Day 3, Monday 27 July 2026.**
Branches: `feature/er-diagram`, `feature/postgres-schema`, `feature/search-data-model`,
`feature/api-db-mapping`.

### What shipped

Postgres becomes the system of record — and, just as importantly, stops being a precondition for the
application starting.

- **Nineteen tables as plain reviewable DDL** in `backend/sql/schema.sql`, grouped into catalogue,
  ingestion, merchandising and analytics: `users`, `destinations`, `suppliers`, `trips`, `trip_media`,
  `trip_departures`, `guides`, `pois`, `source_records`, `merge_candidates`, `field_priority_rules`,
  `synonyms`, `promotions`, `search_config`, `search_queries`, `search_events`, `bookings`,
  `saved_items`, `audit_log`. uuid surrogate keys, natural keys as unique constraints (`trips.slug`,
  `destinations.slug`, `suppliers.key`, `(source_key, external_id)`), `numeric(10,2)` money,
  `timestamptz` throughout, and check constraints only where they encode a rule the application cannot
  be trusted to remember. `backend/app/models.py` declares the same shape in SQLAlchemy 2.0; the SQL
  is treated as authoritative.
- **The retrieval shape** in `backend/sql/indexes.sql`, each index carrying its reason in a comment: a
  GIN index over a stored generated `tsvector` on title, summary and description; GIN on the `themes`,
  `activities` and `audience` arrays so one index serves both the filter and the facet count;
  `pg_trgm` GIN on title for typo tolerance; btree on `price_from`, `duration_days` and `rating`;
  `search_queries(created_at desc)` and `search_events(search_id)`. `months` is `smallint[]` so month
  filtering is numeric rather than a cast per row.
- **One repository interface.** `backend/app/repository.py` exposes the `Repo` protocol with
  `PostgresRepo` and `MemoryRepo` behind it and a `get_repo` dependency. No router touches
  SQLAlchemy. `init_repo` pings Postgres and hands back `MemoryRepo` rather than raising, so an unset
  or unreachable `DATABASE_URL` still boots — and `/health` reports which one won.
- **`docker compose up`** gives Postgres 16 with a volume, and `python -m app.seed` creates and seeds
  from empty, idempotently, from the plain-dict dataset in `backend/app/seed_data.py`.
- **`docs/database-schema.md`** — the ER diagram with cardinalities, a table dictionary explaining
  every table and every non-obvious column, the index rationale, and a map from each API route to the
  tables it reads and writes. It notes where the currency and locale dimensions would attach, so
  findings C-01 and C-02 have a landing place.

### Files

`backend/sql/schema.sql`, `backend/sql/indexes.sql`, `backend/docker-compose.yml`,
`backend/app/{models,db,repository,schemas,config,seed,seed_data}.py`, `backend/.env.example`,
`backend/requirements.txt`, `backend/pyproject.toml`, `docs/database-schema.md`.

### Verify by hand

1. With no `.env` and no `DATABASE_URL`, run `uv run uvicorn app.main:app` from `backend/`. It starts
   and prints `catalogue: in-memory seed, 33 trips — DATABASE_URL is not set`. [2]
2. `curl http://localhost:8000/health` reports `"db": "memory"` and the trip count.
3. `docker compose up -d`, set `DATABASE_URL=postgresql+asyncpg://...` in `backend/.env`, then
   `uv run python -m app.seed`. Run it a second time — it is idempotent and the counts do not double.
4. Restart the API. It now prints `catalogue: postgres, 33 trips — DATABASE_URL is set and reachable`
   and `/health` reports `"db": "postgres"`. [3]
5. Run the same three worked queries against both configurations and compare the result sets. They
   match, because ranking is the same in-process code either way.
6. `docker compose stop`, restart the API without changing anything else. It prints
   `postgres is configured but unreachable` and serves the seeded catalogue instead of failing.
7. Read `backend/sql/schema.sql` top to bottom as a DBA would. Every table has a comment, every index
   in `indexes.sql` has a stated reason.

### Acceptance criteria satisfied

Release acceptance from `docs/sprint-plan.md` §1: the same benchmark searches return the same results
against Postgres and against the in-memory catalogue, and `/health` reports `db` correctly in both.
From §7: criteria 2 and 3, and the Python half of criterion 1.

### Deliberately deferred

- **Retrieval does not yet use the Postgres indexes.** The `Repo` protocol has no `search` method:
  `PostgresRepo` hands the catalogue to `rag.py`, which ranks in process. The `tsvector`, `pg_trgm`
  and array GIN indexes are created, documented and correct, but they are on the production query
  path, not on the POC's. What would fix it: a `search()` method on the protocol that pushes the
  filter and the lexical score into SQL, with `rag.py` reduced to re-ranking.
- **No `pgvector`.** The semantic layer is numpy in `rag.py`. `pgvector` is documented as the
  production path in `docs/architecture.md`.
- **No migrations.** `schema.sql` plus `seed.py` is the whole story; Alembic is a first-release
  requirement, not a POC one.
- **Nothing persists without Postgres** — limitation 10. With `DATABASE_URL` unset, admin edits,
  promotions, synonyms and logged searches live for the process lifetime only.

---

## Release 4 — `release/4-smart-search`

**Merged Day 4, Tuesday 28 July 2026.** The marquee release.
Branches: `feature/nl-query-understanding`, `feature/instant-filters-url-state`,
`feature/unified-catalog-dedup`, `feature/trip-detail-booking`.

### What shipped

- **Query understanding that never fails.** `nlq.parse` asks the chat chain for strict JSON at
  temperature 0 with one retry inside an 8 s ceiling, validates it against the wire model, and on any
  failure falls through to a deterministic keyword and regex extractor flagged `source="heuristic"`.
  The heuristic handles month names, "next winter" as the northern-hemisphere aurora season,
  "N day" and "N night", "under", "below" and "max £N", "direct flights", warm and cold, and the party
  words family, couples, solo and small groups. Repeated sentences come back from an LRU of 256 keyed
  on the normalised query, so the second search for the same phrase costs nothing.
- **`/search`, the screen the document is really about.** The sentence the traveller typed sits above
  the chips TravelIQ extracted from it — `Theme: Northern Lights`, `Nov – Mar`, `Family`,
  `under £1,200` — each one removable, and removing a chip edits the sentence as well as the filter so
  the two never disagree. Beside them, a **Parsed by AI** or **Keyword fallback** indicator driven by
  `parsed.source` and `mode`: the overview's headline promise and its documented fallback, both
  legible instead of hidden.
- **Filtering that tells the truth.** Facet counts in the rail are computed over the same relevant set
  the page is sliced from, each facet excluding its own dimension, so a facet reading 7 returns 7. The
  header shows the result window, the total and `tookMs`. Sorting is relevance, price either way,
  rating or duration. Pagination is numbered links, not infinite scroll, because the overview asks for
  crawlable result pages.
- **Every constraint in the URL.** `/search?q=...&destination=iceland&month=11&maxPrice=1200&sort=price-asc&page=2`
  is written in a fixed order by hand, read on mount, and restores the sentence, the chips, the
  facets, the sort and the page. Typing is debounced at 250 ms and guarded by a request-id ref, so a
  slow response for a half-typed sentence can never overwrite a fast one for the finished sentence.
  Skeletons appear on first load only; later loads dim the existing grid.
- **A zero-result state that is a way out rather than a dead end.** The response carries suggestions,
  and the screen adds one-click relaxations built from the live constraints — *Ignore under £1,200*,
  *Clear Departure month* — falling back to the three worked queries from the overview, which always
  return something.
- **The unified catalogue.** `ingest.py` normalises each inbound record, then scores it on title
  similarity 0.50, destination 0.25, duration 0.15 and price 0.10, redistributing the weight of any
  signal missing on one side. At or above 0.86 it merges unattended, honouring per-field source
  priority — the CMS owns how a trip reads, the supplier owns what it costs and when it goes,
  enrichment owns what travellers thought of it. Between 0.60 and 0.86 it writes a `merge_candidates`
  row with the reasons an editor will read and publishes nothing. Below 0.60 it creates a new trip.
  Records in different destinations are capped below the review floor and can never auto-merge; slug,
  id and provenance are never overwritten by a feed.
- **`/trip/:slug`** — gallery, itinerary by day, a departures table with price, seats remaining and
  whether the flight is direct, a **Request booking** panel that prices a party against the chosen
  departure and records a booking event, similar trips, and the practical and policy detail including
  financial protection. Opening a trip from results posts a click event against its originating
  `searchId`. `Product`/`TouristTrip` JSON-LD is emitted. An unknown slug returns a 404 whose message
  says where slugs come from, and the page renders a quiet not-found state rather than an error.

### Files

`backend/app/nlq.py`, `backend/app/rag.py`, `backend/app/chat.py`, `backend/app/ingest.py`,
`backend/app/routers/{search,content,ingest}.py`,
`src/pages/Search.tsx`, `src/components/search/*` (SearchBar, ParsedChips, FacetRail, ResultCard,
ResultGrid, SortSelect, Pagination, ZeroResults, constraints.ts),
`src/pages/TripDetail.tsx`, `src/components/trip/*`.

### Verify by hand

1. Open `/search` and type `northern lights trip for a family next winter, not too expensive`. Chips
   appear for the theme, the winter window, the family audience and the budget ceiling, with
   **Parsed by AI** beside them if a provider key is configured. [4]
2. Type `7 day walking holiday in italy with small groups`, then
   `somewhere warm in november under 1200 direct flights`. Duration, activity, destination and group
   size on the first; climate, month, price ceiling and direct flights on the second. [4]
3. Remove the **under £1,200** chip. The sentence loses that clause, the URL loses `maxPrice`, the
   result count rises, and the page returns to one.
4. Stop the API, unset every provider key, restart it, and repeat step 1. The indicator now reads
   **Keyword fallback** and the results are still relevant. [5]
5. Pick any five facet values across three dimensions. Note each count, apply it, and check the header
   total equals the count you noted. [6]
6. Copy the address bar into a new tab. Sentence, chips, facets, sort and page all restore. [7]
7. Search for `submarine safari in the alps under 40 pounds`. You get the zero-result state with at
   least three suggestions and the relaxation buttons; the first suggestion returns results. [8]
8. Page to the last page. Every number is reachable and the last page is not empty. [9]
9. Open a result. The itinerary, the departures table and the booking panel render; devtools shows a
   `POST /events` with `type: "click"` and the `searchId` from the search you came from. [10]
10. View source and find the `application/ld+json` block on the trip page. [18]
11. `POST /ingest/atlas` with two records whose titles differ slightly and whose destinations match.
    The response reports `merged` or `queued`; a queued pair appears in the admin review queue with
    its reasons, and searching for the queued title returns nothing until it is approved. [13, 14]

### Acceptance criteria satisfied

Release acceptance from `docs/sprint-plan.md` §1: each of the three worked queries returns relevant
results and the chips the overview claims, on both the AI and the heuristic path; facet counts agree
with the result set on five spot checks; the URL round-trips into a new tab; nothing in the review
queue appears on `/search`. From §7: criteria 4, 5, 6, 7, 8, 9, 10 for the click half, 14 and 18 for
the trip page.

### Deliberately deferred

- **No 30-record ingest fixture ships.** Criterion 13 assumes one; today it is exercised by hand
  against records you write. What would fix it: `backend/fixtures/ingest-atlas.json` with thirty
  labelled records, twelve of them true pairs, checked into the repository.
- **Auto-merges do not apply on the in-memory path.** `MemoryRepo.ingest_records` queues candidates
  and reports honest counts, but the working copy `run_ingest` merges into is not written back — the
  comment in `repository.py` says so. The Postgres path persists the merge inside its transaction.
- **The embedding index is built at startup only** — limitation 7. A trip ingested at runtime is
  scored lexically until the process restarts.
- **Ingestion is synchronous and 500 records per request,** and every inbound record is scored against
  the whole catalogue. Correct at 33 trips, quadratic at 20,000.
- **No unmerge.** An incorrect auto-merge is recorded in `audit_log` and cannot be reversed in the
  product — finding E-01.
- **No booking.** **Request booking** is a priced enquiry that ends in a toast. No payment, no ATOL
  certificate, no package classification.
- **`/search` is unmeasured above 33 trips.** The performance target in
  `docs/scope-and-limitations.md` §5 is stated, not verified.

---

## Release 5 — `release/5-admin-analytics`

**Merged Day 5, Wednesday 29 July 2026.**
Branches: `feature/admin-control-panel`, `feature/search-analytics`, `feature/api-integrations`,
`feature/seo-and-release-notes`.

### What shipped

- **`/admin`, five tabs against real endpoints.** Search setup — which fields are searched and how
  heavily, which filters `/search` may expose, results per page, and the lexical-fallback toggle.
  Promotion — pin, boost and hide with a scheduling window. Synonyms — the words travellers use that
  the catalogue does not. Data sources — per-source health, record counts, last sync, a manual sync,
  and the merge review queue with approve and reject. Analytics. Every mutation writes an `audit_log`
  entry through the repository, because these settings change what a traveller sees without a deploy
  and "who turned the price filter off?" has to be answerable. Every payload is validated in the
  router, so a bad value returns a 400 naming the problem rather than a 500 from the layer that
  trusted it.
- **Merchandising you can see working.** Pinning a trip moves it to the top of the next matching
  search and the result carries the reason `pinned in merchandising`; boosting says
  `boosted in merchandising`; hiding removes it. All three are reversible from the same board.
- **Search analytics from one endpoint over one window,** so every tile describes the same moment:
  four KPI tiles (searches, zero-result rate, click-through, conversion), a timeline, a top-queries
  table with CTR and conversion per term, and a zero-result table. A zero-result row links straight to
  the synonym tab with the term pre-filled, which is the loop the overview asks for — see what
  travellers could not find, then fix it without a developer. Charts follow the `dataviz` guidance:
  one hue per series from the token palette, at most three series, no gridline noise, axis labels with
  units and `tabular-nums` in tooltips.
- **Startup that cannot be broken and does not stay quiet about it.** `main.py` prints which chat
  provider won and its fallback chain, which repository won and why, and whether the embedding index
  built — and serves the API either way. None of the three is a precondition.
- **The assistant on `/assistant`,** streaming `ChatChunk` over SSE in the order the screen renders
  against: the parsed query first so the chips arrive before any prose, then the retrieved trips so
  the cards are on screen while the answer is still arriving, then the tokens, then the citations,
  then done. The system prompt confines it to the retrieved trips and one policy document, in British
  English with sterling prices, and requires a citation the first time it names a trip.
- **Graceful degradation end to end.** Stop FastAPI mid-session and every screen keeps working against
  the seeded catalogue with the **Demo data** pill visible, including the admin screens, whose edits
  then live until the next reload and say so.
- **SEO groundwork.** Every route sets its own `<title>` and meta description through `usePageMeta`,
  filters are readable URL parameters, pagination is numbered, and the trip page emits JSON-LD. SSR,
  the canonical allowlist and sitemaps are documented as the production delta rather than faked.
- **Documentation for a new machine.** `README.md` and `backend/README.md` carry a working setup from
  a clean checkout, the fallbacks to expect at each step, and what is missing before an installable
  1.0. This file is the fifth document.

### Files

`backend/app/main.py`, `backend/app/routers/{admin,analytics}.py`,
`backend/app/routers/{search,content,chat}.py`, `backend/app/repository.py` (analytics rollups),
`src/pages/{Admin,Assistant}.tsx`, `src/components/admin/*` (SearchSetup, PromotionBoard,
SynonymTable, SourceHealth, ReviewQueue, AnalyticsPanel, TimelineChart, AdminSection, TabPanel),
`src/components/chat/*`, `src/lib/api.ts`, `src/lib/meta.ts`,
`src/components/trip/structuredData.ts`, `docs/release-notes.md`, `README.md`, `backend/README.md`.

### Verify by hand

1. Open `/admin`. The five tabs are in the URL as `?tab=`, so a tab is linkable.
2. On **Search setup**, drag the weight on *Trip title* down, turn off *Budget ceiling*, save. Reload
   the page — the values persisted (with Postgres) or persisted for the session (without it), and the
   header states which.
3. On **Promotion**, pin a trip you know matches `walking holiday in italy`. Search that phrase: the
   trip is first and its reasons include `pinned in merchandising`. Remove the pin and search again —
   it returns to its earned position. [11]
4. Change the pin to a hide and search again. The trip is gone. Remove the promotion to bring it
   back. [11]
5. On **Synonyms**, add `aurora` with the alternative `Northern Lights`. Search `aurora in march` and
   the Northern Lights trips come back. [12]
6. On **Data sources**, press Sync on the supplier feed. The status and last-sync time update. Work a
   review-queue item with Approve and confirm an entry appears in `audit_log`. [13]
7. On **Analytics**, note the click-through tile. In another tab, run a search and open a result. Come
   back, reload the tab, and the click is in the window. [10]
8. Go to `/assistant` and ask *is there a cancellation charge if I cancel eight weeks before?* The
   answer cites the policy id. Ask for *a five-night trip to Antarctica in June under £400* and it
   says plainly that it has nothing suitable and offers one way to widen the search, rather than
   inventing a departure. [19]
9. Stop FastAPI. Keep clicking — every screen still renders, the **Demo data** pill appears in the
   search header, and the assistant answers from the seeded catalogue while saying it is doing so. [15]
10. View source on each of the eight routes and read the `<title>` and description. [18]
11. Read all five documents in `docs/` against the running product. [20]

### Acceptance criteria satisfied

Release acceptance from `docs/sprint-plan.md` §1: the twenty criteria in
`docs/scope-and-limitations.md` §7 pass, and the degradation matrix is reproduced by hand — key
removed, Postgres stopped, FastAPI stopped — with the interface stating which path it is on in each
case. From §7 specifically: criteria 10, 11, 12, 13, 15, 18, 19 and 20.

### Deliberately deferred

- **No authentication anywhere** — limitation 1. `/admin` is open to anyone who reaches the port; the
  `X-Actor` header on admin mutations is attribution for the audit log, not identity. The page says so
  in its header rather than faking a login. CORS is a localhost allowlist by default, which is not a
  substitute.
- **The Appearance tab of the overview is not built** — limitation 13. Search setup, promotion,
  synonyms, data sources and analytics are real; branding, widget layout and result-card appearance
  are not. Note against limitation 13 as currently written: the admin UI explains the missing
  authentication but does not yet name the missing Appearance tab. What would fix it: one sentence in
  the `/admin` header listing it beside the auth note, which is a five-minute change and should be
  made before the next demonstration.
- **Analytics are seeded** — limitation 6. The 30-day window is generated data with real searches
  appended as you use the POC, and the panel says so. Conversion is driven by the enquiry event
  because there is no booking. There is no consent gate, so every event is recorded, and raw query
  text is stored indefinitely with no scrubbing — a DPIA item before any real traffic, finding D-05.
- **No server-side rendering** — limitation 4, and the central SEO claim in §7 of the overview is
  therefore not met. Titles, descriptions and JSON-LD are written on mount, so a crawler that does not
  execute JavaScript sees none of them. What would fix it: prerendering the eight routes at build time
  or moving the shell to a server-rendered framework. No sitemap and no canonical policy either.
- **Single market: `en-GB`, GBP, miles** — limitation 5. `Synonym.market` is stored and not applied.
- **No automated tests and no CI** — limitation 12. Verification is `npx tsc --noEmit`, a clean Python
  import, and the walk-throughs above.

---

## Traceability — the six feature areas of the overview document

Assessed against what the code does today, not against what it is designed to do next.

| # | Feature area (overview) | Release | Code that implements it | POC completeness |
|---|---|---|---|---|
| 1 | **AI query understanding** — one sentence to structured filters, with keyword search as the fallback | 4 | `backend/app/nlq.py` (strict-JSON extraction at temperature 0, one retry, 8 s ceiling, LRU of 256 on the normalised sentence, then a pure heuristic extractor); `backend/app/rag.py` agreement boosts per parsed field; `src/components/search/{ParsedChips,constraints}.tsx`; `src/mock/catalog.ts` `localParse` for the offline path | **Implemented.** Both layers run, `parse` never raises, and the screen names which one answered. Unverified: the field-accuracy targets in `docs/scope-and-limitations.md` §5 (≥90% AI, ≥75% heuristic) are stated against a 20-query benchmark that has no harness. |
| 2 | **Instant search and filtering** — live facet counts, typo tolerance, filters in the URL, predictive suggestions, near-me and radius | 4, on the primitives from 2 | `src/pages/Search.tsx`, `src/components/search/*`, `backend/app/routers/search.py`, `rag.py` facet counting and zero-result relaxation, `GET /suggest`, `src/components/discover/RadiusControl.tsx` | **Implemented,** with three named gaps. Typo tolerance is prefix and substring fuzz in the lexical scorer, not trigram similarity — the `pg_trgm` index exists but is not on the query path. Predictive suggestions come from destinations, themes and titles, not from real query history at volume. Near-me is radius over precomputed distances on `/discover`, not geo-search from the browser's location. |
| 3 | **Unified product catalogue** — same trip from CMS and supplier feeds, matched, merged, de-duplicated, per-field priority, review queue | 4 | `backend/app/ingest.py` (normalise, weighted match, `AUTO_MERGE = 0.86`, `REVIEW_FLOOR = 0.60`, `DEFAULT_FIELD_PRIORITY`), `backend/app/routers/ingest.py`, `repository.ingest_records`, `src/components/admin/{SourceHealth,ReviewQueue}.tsx` | **Partial.** Matching, thresholds, per-field priority and the review queue are real and audited on the Postgres path. On the in-memory path a merge is counted but not applied. No fixture ships, there is no unmerge, and an ingested trip is lexical-only until restart. |
| 4 | **Admin control panel** — search setup, appearance, promotion, synonyms, data sources, analytics | 5 | `backend/app/routers/admin.py`, `src/pages/Admin.tsx`, `src/components/admin/*` (9 modules) | **Partial.** Five of the six tabs the overview names are built, backed by real endpoints, validated in the router and audited on every mutation. Appearance is absent. No authentication and no role split, which for a panel that changes production search behaviour is the single largest gap in the build. |
| 5 | **Search analytics** — top searches, zero-result searches, CTR, conversion by search term | 5 | `backend/app/routers/analytics.py`, `repository.analytics_overview` and the search-history rollups, `src/components/admin/{AnalyticsPanel,TimelineChart}.tsx`, `POST /events` from `Search.tsx`, `ResultCard` and `BookingPanel` | **Partial.** The whole tab is real over one window and one endpoint, and a click made on `/search` shows up in CTR. But the 30-day history is seeded, conversion measures enquiries rather than bookings, and there is no consent gate or query scrubbing. |
| 6a | **PostgreSQL as the system of record** | 3 | `backend/sql/schema.sql`, `backend/sql/indexes.sql`, `backend/app/{models,db,repository,seed,seed_data}.py`, `backend/docker-compose.yml`, `docs/database-schema.md` | **Implemented.** Nineteen tables, reviewable DDL, SQLAlchemy models of the same shape, an idempotent seed, and a documented fallback to memory that is exercised rather than assumed. Caveat: retrieval and ranking run in process, so the FTS, trigram and array indexes are created and correct but not yet queried by `/search`; `pgvector` is documented, not installed. |
| 6b | **SEO** | 5, groundwork in 2 | `src/lib/meta.ts`, `buildParams` in `src/pages/Search.tsx`, `src/components/search/Pagination.tsx`, `src/components/trip/structuredData.ts` | **Partial.** Per-route metadata, readable filter URLs, numbered pagination and trip JSON-LD all ship. All of it is written on mount, so a crawler that does not execute JavaScript sees none of it. No SSR, no prerender, no sitemap, no canonical policy, no `hreflang`. |
| 6c | **Security** | documented in 1, partial mitigations in 5 | `docs/architecture.md` §6, `docs/scope-and-limitations.md` §6, the `X-Actor` attribution and `audit_log` writes plus per-payload validation in `backend/app/routers/admin.py`, the localhost CORS allowlist in `backend/app/config.py` | **Documented only.** No authentication, no roles, no rate limiting, no consent gate, no secret management beyond `.env`, and raw query text retained indefinitely. What exists is an audit trail with an unauthenticated actor and input validation at the router. Do not expose this build to the internet. |

---

## Recommended next sprint — the five highest-value items

In value order, each with the reason it beats the next thing on the list.

1. **Authentication and roles on `/admin`, with the audit log bound to a real identity.** The panel
   already changes what every traveller sees without a release, and today anyone who reaches the port
   can pin a trip or turn a filter off — no other gap can put wrong prices in front of customers.
2. **Push retrieval into Postgres: a `search()` method on the `Repo` protocol using the `tsvector`,
   `pg_trgm` and array GIN indexes that already exist, with `rag.py` reduced to re-ranking.** It turns
   three indexes from documentation into behaviour, delivers the trigram typo tolerance the overview
   promises, and is the only route to the stated performance target above a few thousand trips.
3. **The test harness the twenty acceptance criteria were written for: a labelled 20-query parse
   benchmark, the 30-record ingest fixture, and CI running `tsc --noEmit` plus the Python imports.**
   Every quality claim in `docs/scope-and-limitations.md` §5 is currently unverified, and the criteria
   are already written as a test plan — this is the cheapest possible conversion of prose into
   evidence.
4. **Prerender or server-render the eight routes, then add the sitemap and canonical policy.** SEO is
   an explicit section of the overview and is the one headline claim the POC does not meet at all;
   the readable URLs and JSON-LD are already in place, so the remaining work is infrastructure rather
   than redesign.
5. **Close the three carried-in client decisions — search engine and its cost model, trade-versus-public
   pricing, multi-currency and multi-locale scope — and land the schema consequences.** They are
   pencilled into `docs/database-schema.md` and block the trip, price and translation model, so every
   week they stay open makes the eventual migration more expensive than the feature.

Runners-up, in case capacity appears: the Figma library generated from `src/index.css` (two days,
stops the token drift the coded system cannot prevent on its own), unmerge for an incorrect
auto-merge (finding E-01), and a consent gate before any real traffic reaches the analytics tables
(finding D-05).
