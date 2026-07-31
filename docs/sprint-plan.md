# Sprint plan — TravelIQ Search Engine POC

| | |
|---|---|
| Sprint | Sprint 1 — POC foundation to working search |
| Window | Thu 23 July – Wed 29 July 2026, five working days |
| Goal | A runnable POC of the overview document's five feature areas, and a documentation set that says exactly what was built, what was not, and what still needs a client decision. |
| Team | 1 delivery lead, 2 front end, 2 back end, 1 designer, 1 BA (part time) |
| Branching | Each `feature/*` merges `--no-ff` into its `release/*`; each `release/*` merges `--no-ff` into `master`. Five releases, twenty feature branches. |
| Definition of done, sprint level | `npx tsc --noEmit` clean, every backend module imports cleanly, the twenty acceptance criteria in `docs/scope-and-limitations.md` §7 pass, and every limitation is stated in the product or in the docs. |

Days below are the day the branch merges into its release, not the day work starts.

---

## 1. Releases

### Release 1 — `release/1-foundation-and-docs` · Day 1, Thu 23 July

The document review comes first on purpose. Every architectural decision in the following four days
either resolves a finding or is blocked on one.

| Feature branch | Deliverable | Acceptance criteria | Status |
|---|---|---|---|
| `feature/doc-review-and-gaps` | `docs/doc-review.md` | 27 findings, each with the sentence quoted from the overview, the issue class, the commercial or technical impact, a recommended resolution and an owner role. Covers at minimum: the Algolia contradiction, the Next.js/NestJS contradiction, the "no lock-in" claim, the unmeasurable "well under a second", the undefined review-queue SLA and match thresholds, the missing auth and roles model, no multi-currency, no i18n data model, no ATOL or financial-protection story, no trade-versus-public pricing enforcement, the analytics-versus-consent conflict, and the total absence of acceptance criteria. Ends with the list of documentation updates applied this sprint and the three decisions still blocked on the client. | Done |
| `feature/system-architecture` | `docs/architecture.md` | Container diagram; sequence diagram for the search path from browser through `/search`, `nlq`, `rag`, Postgres, response and `/events`; sequence diagram for ingestion from source through normalise, match, merge or review queue, to index; module map for both applications; a degradation matrix in which every row is a real code path; security and SEO sections mapped line by line to sections 6 and 7 of the overview with an honest POC column; and the production delta. | Done |
| `feature/scope-and-limitations` | `docs/scope-and-limitations.md` | In-scope and out-of-scope tables with a destination for every excluded item; nine assumptions with a consequence each; eight constraints; non-functional targets that are all measurable with what is built, each with its measurement method; fourteen numbered POC limitations; and twenty acceptance criteria for calling the POC done. | Done |
| `feature/design-tokens` | `index.html`, `src/index.css`, `src/types.ts`, `src/lib/{utils,format,meta,api}.ts` | The oklch token set from the design reference, refined for contrast: brand yellow is never a text colour on white and never a full-strength large-area fill. One type family with a fixed scale. `src/types.ts` mirrors `backend/app/schemas.py` field for field. `api.ts` is the only I/O surface, with a 6 s abort and a mock fallback for every read that must not throw. No component anywhere hardcodes a hex value. | Done |

**Release acceptance:** the four documents can be read end to end by a client team with no
walk-through, and the token layer builds with `npx tsc --noEmit` clean.

### Release 2 — `release/2-design-system-ui` · Day 2, Fri 24 July

| Feature branch | Deliverable | Acceptance criteria | Status |
|---|---|---|---|
| `feature/ui-primitives` | `src/components/ui/*` — 13 primitives | button, card, badge, chip, input, skeleton, switch, slider, tabs, select, sheet, stars, empty. Frozen props as specified. Every primitive merges an incoming `className` through `cn()`, shows a visible `focus-visible` ring, has a hit target of at least 40 px, uses no `any`, and takes a `forwardRef` only where a ref is genuinely needed. The sheet traps focus, closes on Escape and locks scroll. | Done |
| `feature/app-shell-routing` | `src/App.tsx`, `src/components/layout/*`, `src/pages/NotFound.tsx` | Eight routes resolve. Landing renders full-bleed outside the shell; every other route renders inside it. The side rail collapses to bottom tabs below the `md` breakpoint. The active route is indicated and announced. Unknown paths render a quiet 404 with a route back. `sonner` is mounted once, themed through the tokens. | Done |
| `feature/wireframes-and-mockups` | `docs/wireframes.md`, `docs/design-system.md` | All eight screens wireframed at desktop and mobile, plus the user flows. The design system documents the token table, the type scale, the component inventory with a usage rule per component, an explicit do-and-do-not list, and accessibility notes covering contrast pairs, the focus ring and hit targets. | Done |
| `feature/core-screens` | `src/pages/{Landing,Inspiration,Discover}.tsx` and their components | Landing carries the hero band, how-it-works, popular itineraries, featured-in and footer. Inspiration filters twelve guides by tag with a working empty state. Discover splits a list against a static map with the three category rails, a radius control in miles and a place detail sheet. Every page calls `usePageMeta` first, fetches with a `cancelled` flag, shows skeletons matching the final layout, and renders an empty state with a retry on failure. Nothing exceeds the design reference beyond colour, type, spacing and polish; no transition exceeds 250 ms. | Done |

**Release acceptance:** all eight routes reachable and responsive from 360 px to 1920 px; the keyboard
completes a full pass of the shell; no screen hardcodes a colour.

### Release 3 — `release/3-database` · Day 3, Mon 27 July

| Feature branch | Deliverable | Acceptance criteria | Status |
|---|---|---|---|
| `feature/er-diagram` | `docs/database-schema.md` | ER diagram covering all 19 tables with cardinalities; a table dictionary giving the purpose of every table and every non-obvious column; the index rationale; and a map from each API route to the tables it reads and writes. Notes where the currency and locale dimensions would attach, so findings C-01 and C-02 have a landing place. | Done |
| `feature/postgres-schema` | `backend/sql/schema.sql`, `backend/app/models.py`, `backend/docker-compose.yml` | 19 tables as plain reviewable DDL that a DBA can sign off, with the SQLAlchemy models declaring the same shape. uuid surrogate keys, natural keys as unique constraints (`trips.slug`, `destinations.slug`, `suppliers.key`, `(source_key, external_id)`), `numeric(10,2)` money, `timestamptz` throughout, and check constraints only where they encode a rule the application cannot be trusted to remember. `docker compose up` gives a working Postgres 16 with a volume. | Done |
| `feature/search-data-model` | `backend/sql/indexes.sql`, `backend/app/seed_data.py`, `backend/app/seed.py` | GIN over a stored generated `tsvector` on title, summary and description; GIN on the `themes`, `activities` and `audience` arrays so one index serves both the filter and the facet count; `pg_trgm` GIN on title for typo tolerance; btree on `price_from`, `duration_days` and `rating`; `search_queries(created_at desc)` and `search_events(search_id)`. `python -m app.seed` creates and seeds from empty and is idempotent. Every index has a stated reason in a comment. | Done |
| `feature/api-db-mapping` | `backend/app/{repository,schemas,db}.py` | One `Repo` protocol with `PostgresRepo` and `MemoryRepo` behind it and a `get_repo` dependency. No router touches SQLAlchemy. `init_repo` pings Postgres and hands back `MemoryRepo` rather than raising, so an unset or unreachable `DATABASE_URL` still boots. `/health` reports which won. Wire schemas are camelCase and mirror `src/types.ts` exactly, so JSON needs no translation layer. | Done |

**Release acceptance:** the same benchmark searches return the same results against Postgres and
against the in-memory catalogue; `/health` correctly reports `db` in both configurations.

### Release 4 — `release/4-smart-search` · Day 4, Tue 28 July

The marquee release. `/search` is held to the highest bar in the sprint.

| Feature branch | Deliverable | Acceptance criteria | Status |
|---|---|---|---|
| `feature/nl-query-understanding` | `backend/app/nlq.py`, `backend/app/rag.py`, `backend/app/chat.py` | `parse` never raises: LLM strict-JSON extraction at temperature 0 with one retry inside an 8 s ceiling, then a deterministic heuristic extractor flagged `source="heuristic"`. The heuristic handles month names, "next winter", "N day" and "N night", "under", "below" and "max £N", "direct flights", warm and cold, and the party words family, couples, solo and small groups. Repeated sentences resolve from an LRU of 256 keyed on the normalised query. Ranking keeps the `SimBand` calibration and degrades to the lexical scorer when there is no embedding provider, when a query embed fails, or when the vector width no longer matches the index — reporting `mode` either way. Facets, synonym expansion, promotion weighting, `matchedOn` reasons and zero-result relaxation all land here. | Done |
| `feature/instant-filters-url-state` | `src/pages/Search.tsx`, `src/components/search/*`, `backend/app/routers/search.py` | The sentence the traveller typed sits beside the chips TravelIQ extracted from it, each chip removable. A **Parsed by AI** or **Keyword fallback** indicator is driven by `parsed.source` and `mode` — the overview's headline promise and its documented fallback, both legible. Facet counts are live and agree with the result set. The header shows the result count and `tookMs`. Filters are synced to the URL and read on mount, so any result set is shareable and bookmarkable. Zero results offer the suggestions the API returned. Pagination is numbered, not infinite scroll. 250 ms debounce, an out-of-order response guard on a request id, and skeletons on first load only. The three worked queries from §3.1 of the overview read well end to end. | Done |
| `feature/unified-catalog-dedup` | `backend/app/ingest.py`, `backend/app/routers/ingest.py` | Normalise, then match on title similarity 0.50, destination 0.25, duration 0.15 and price 0.10, redistributing the weight of any signal missing on one side. At or above 0.86 merge unattended, honouring per-field source priority — CMS owns copy and images, supplier owns price, dates and availability, enrichment owns rating and reviews. Between 0.60 and 0.86 write a `merge_candidates` row with the reasons an editor will read, and publish nothing. Below 0.60 create a new trip. Records in different destinations are capped below the review floor and can never auto-merge. Slug, id and provenance are never overwritten by a feed. Returns `{received, merged, queued, rejected}` and writes an `audit_log` entry. | Done |
| `feature/trip-detail-booking` | `src/pages/TripDetail.tsx`, `src/components/trip/*`, `backend/app/routers/content.py` | Gallery, itinerary by day, a departures table with price, seats remaining and whether the flight is direct, a booking panel, similar trips, and the practical and policy detail including financial protection. An unknown slug returns 404 with a message that says where slugs come from, and the page renders a quiet not-found state rather than an error. Opening a trip from a search records a click event against its originating `searchId`. JSON-LD is emitted. | Done |

**Release acceptance:** each of the three worked queries returns relevant results and the chips the
overview claims, on both the AI and the heuristic path; facet counts agree with the result set on five
spot checks; the URL round-trips into a new tab; nothing in the review queue appears on `/search`.

### Release 5 — `release/5-admin-analytics` · Day 5, Wed 29 July

| Feature branch | Deliverable | Acceptance criteria | Status |
|---|---|---|---|
| `feature/admin-control-panel` | `backend/app/routers/admin.py`, `src/pages/Admin.tsx`, `src/components/admin/*` | Five tabs against real endpoints: search setup (searchable fields with weights, enabled filters, page size, lexical-fallback toggle), promotion (pin, boost, hide, with a scheduling window), synonyms, data-source health with a manual sync, and the review queue with approve and reject. Every mutation writes an `audit_log` entry, and every payload is validated in the router so a bad value returns 400 naming the problem rather than a 500. Pinning a trip moves it to the top of the next matching search and the result says `pinned in merchandising`; hiding one removes it; both are reversible. Adding a synonym makes the alternative term retrieve the same trips. The Appearance tab of the overview is deliberately absent and the UI says why. | Done |
| `feature/search-analytics` | `backend/app/routers/analytics.py`, `src/components/admin/{AnalyticsPanel,TimelineChart}.tsx` | One endpoint serves the whole tab over one window, so every tile describes the same moment. Four KPI tiles — searches, zero-result rate, click-through, conversion — plus a timeline, a top-queries table and a zero-result table. Charts follow the `dataviz` guidance: one hue per series from the token palette, at most three series, no gridline noise, axis labels with units, `tabular-nums` in tooltips. A click recorded on `/search` appears in CTR within the current window. The window is seeded and the panel says so. | Done |
| `feature/api-integrations` | `backend/app/main.py`, `backend/app/routers/{search,content,chat}.py`, `src/lib/api.ts`, `src/pages/Assistant.tsx` | Every route in the API contract implemented and consumed. Startup is unbreakable and talkative: it prints which chat provider won, which repository won and whether the index built, and none of the three is a precondition. `/chat` streams `ChatChunk` over SSE with the chunk order the Assistant renders against — parsed, trips, tokens, citations, done — and the assistant answers only from retrieved trips and one policy document, with citations, refusing to invent a price or a departure month. Stopping FastAPI leaves every screen working against the seeded catalogue with a **demo data** pill visible. | Done |
| `feature/seo-and-release-notes` | `src/lib/meta.ts`, `src/components/trip/structuredData.ts`, `docs/release-notes.md`, `README.md`, `backend/README.md` | Every route sets its own title and meta description. Filters are readable URL parameters and pagination is numbered. Trip structured data is emitted. Both READMEs get a working new-machine setup, the expected fallbacks and what is missing before a 1.0 install package. Release notes list what landed per release and what did not. SSR, the canonical allowlist and sitemaps are documented as the production delta rather than faked. | Done |

**Release acceptance:** the twenty POC acceptance criteria in `docs/scope-and-limitations.md` §7 all
pass; the degradation matrix is reproduced by hand — key removed, Postgres stopped, FastAPI stopped —
and the UI states which path it is on in each case.

---

## 2. Sprint task list

The four tasks the sprint was committed against, as framed at planning.

| # | Task | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | Review and update documentation | **Done** | `docs/doc-review.md` (27 findings), plus the four documents listed in its closing table | Three findings are resolved as *decisions required* rather than answered: A-01 search engine and its cost model, D-02 trade-pricing enforcement, C-01/C-02 multi-currency and multi-locale release scope. All three need the client before the next Release 3. |
| 2 | Design system architecture | **Done** | `docs/design-system.md`, `src/index.css`, `src/components/ui/*` (13 primitives), `docs/wireframes.md` | Delivered as code plus documentation. There is no Figma library — see the note under §3. |
| 3 | Define scope and limitations | **Done** | `docs/scope-and-limitations.md` | Fourteen limitations and twenty acceptance criteria. This is the document that closes finding G-01. |
| 4 | Research UI/UX prototypes | **Done** | `docs/reference/` reviewed in full — `styles.css`, `landing.tsx`, `index.tsx`, `discover.tsx`, `inspiration.tsx`, `Sidebar.tsx` — and the outcome recorded in `docs/design-system.md` | The reference was adopted rather than replaced: colour, type, spacing and polish are the only improvements on it. The interactive prototype is the running Vite application, which is a better artefact than a clickable mock-up but is not a substitute for a maintained design file. |

---

## 3. Two-day breakdown — design and database

The client-facing framing of the two heaviest days. Day 1 here is the design day and maps onto
Release 2; Day 2 is the database day and maps onto Release 3. Four subtasks each.

### Day 1 — Figma design

| # | Subtask | Definition of done | Status |
|---|---|---|---|
| 1.1 | Search-flow wireframes | The search journey wireframed end to end at desktop and mobile: entry, typing with predictive suggestions, the parsed chips beside the sentence, the facet rail with counts, the results grid, sort, numbered pagination, the zero-result state with suggestions, and the trip detail hand-off. Each state names what the traveller sees when the AI layer is unavailable. Delivered in `docs/wireframes.md`. | Done |
| 1.2 | Design system | Token table (colour, radius, spacing, shadow), the one-family type scale with the rule of a single `font-extrabold` element per viewport height, the component inventory with a usage rule per component, an explicit do-and-do-not list mirroring the design constraints, and accessibility notes covering contrast pairs, the focus ring and a 40 px minimum hit target. Every token exists in `src/index.css` under the same name. Delivered in `docs/design-system.md`. | Done |
| 1.3 | Core UI screens, desktop and mobile | All eight screens laid out at both breakpoints: Landing, Search, Discover, Inspiration, Trip detail, Assistant, Admin, 404. Each has a defined loading state that matches its final layout, an empty state and an error state. The side rail's collapse to bottom tabs is specified, not left to the build. | Done |
| 1.4 | Prototype and user flow | The three user flows drawn and walkable: traveller searches in natural language and books an enquiry; traveller browses inspiration into discovery; merchandiser pins a product and reads the effect in analytics. Every flow is walkable in the running application, and each has an entry point, a success state and a failure state. | Done |

**Honest note on 1.1–1.4.** These were produced as documented wireframes plus a coded design system,
not as a Figma file — there is no Figma library in this repository and no design file is referenced by
the build. What would fix it: a Figma library whose variables are generated from `src/index.css` so
the tokens cannot drift, with one page per screen at the two breakpoints and the component set
published as a shared library. Budgeted as a two-day design task in the next sprint.

### Day 2 — Database structure

| # | Subtask | Definition of done | Status |
|---|---|---|---|
| 2.1 | ER diagram | All 19 tables with primary keys, foreign keys and cardinalities, grouped into catalogue, ingestion, merchandising and analytics. Every relationship labelled. Reviewable by someone who has not read the code. Delivered in `docs/database-schema.md`. | Done |
| 2.2 | Database schema | `backend/sql/schema.sql` as plain DDL a DBA signs off, with `backend/app/models.py` declaring the same shape and the SQL treated as authoritative. uuid surrogate keys with natural keys as unique constraints, `numeric(10,2)` money, `timestamptz` timestamps, Postgres arrays for the facet fields, and check constraints only where they encode a rule the application cannot be trusted to remember. A table dictionary explains every table and every non-obvious column. | Done |
| 2.3 | Search data model | The retrieval shape: a stored generated `tsvector` over title, summary and description with a GIN index; GIN on the `themes`, `activities` and `audience` arrays so one index serves both the filter and the facet count; `pg_trgm` GIN on title for typo tolerance; btree on `price_from`, `duration_days` and `rating`; `months` as `smallint[]` so month filtering is numeric rather than a cast per row. Every index carries its reason. The semantic layer is documented as in-process for the POC with `pgvector` as the production path. | Done |
| 2.4 | API and database mapping | Every route in the API contract mapped to the tables it reads and writes, through one `Repo` protocol with `PostgresRepo` and `MemoryRepo` behind it. No router touches SQLAlchemy. Wire schemas are camelCase and mirror `src/types.ts` field for field. The unset-`DATABASE_URL` fallback is exercised and reported on `/health`, not assumed. | Done |

---

## 4. What did not land, and where it went

| Item | Reason | Landed in |
|---|---|---|
| Figma design file and published component library | Delivered as documented wireframes plus a coded design system instead; no design tool in the delivery chain this sprint | Next sprint, 2 days (see §3 note) |
| Automated tests and CI | Five days, and the acceptance criteria were written before there was code to test | Next sprint, first item — the twenty criteria in `docs/scope-and-limitations.md` §7 are the test plan |
| Measurement of `/search` at 5,000 trips | The seeded catalogue is 33 trips; the target is stated but unverified | Next sprint, with a generated catalogue |
| Unmerge of an incorrect auto-merge | A second data path with its own audit semantics | Production requirement, finding E-01 |
| Consent gating, trade pricing, margin ranking, SSR, multi-currency, multi-locale | Each is blocked on a client decision or is infrastructure, and all six are costed | `docs/architecture.md` §8, production delta |

---

## 5. Carry-in decisions for the next sprint

These block planning, not building, and each has a named owner in `docs/doc-review.md`.

| Decision | Blocks | Owner | Needed by |
|---|---|---|---|
| Search engine: Algolia, or Postgres FTS plus `pgvector` in the client's own database — with the cost model for each | The whole retrieval and security design, and the "no lock-in" claim | Solution Architect + Commercial Lead | Before the next Release 3 |
| Whether trade and agency pricing is in the first release | Whether search can be browser-direct at all, and therefore the SSR and key-minting design | Commercial Lead + Security Lead | Before the next Release 1 |
| Whether multi-currency and multi-locale are in the first release | The trip, price and translation schema, and the URL structure | Product Owner | Before the next Release 3 |
| The review-queue SLA and its owning role | Whether the ingestion pipeline needs ageing alerts and escalation in the first release | Head of Product Ops | Before the next Release 4 |
| The performance budget, signed | Acceptance of the search work | Client Product Owner + Tech Lead | Sprint planning |
