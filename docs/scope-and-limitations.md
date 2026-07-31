# Scope and limitations — TravelIQ Search Engine POC

The boundary of this POC, the numbers it is measured against, and the things it deliberately does not
do. Read with `docs/architecture.md` (how it is built) and `docs/doc-review.md` (what the overview
document leaves open).

| | |
|---|---|
| Purpose of the POC | Prove that a traveller's sentence can drive an accurate, fast, explainable filtered result set, and that a marketing team can merchandise it without a developer. |
| Not the purpose | Being installable, multi-tenant, multi-market, transactional or production-secure. |
| Sprint | 5 days, one delivery team, 5 releases (`docs/sprint-plan.md`) |
| Dataset | Seeded travel catalogue — 33 trips across 23 destinations, 12 guides, 11 places, 4 policy documents. Same data in `src/mock/catalog.ts` and `backend/app/seed_data.py` so the front end degrades to a real search, not a stub. |
| Market | Single `en-GB` market, GBP prices, UK departure airports |

---

## 1. In scope

Mapped to the feature sections of `docs/TravelIQ-Search-Engine-Overview.docx`.

| Overview | In scope for the POC | Where it lives |
|---|---|---|
| §3.1 AI query understanding | One sentence to a structured `ParsedQuery`: destination, months, duration, budget, themes, activities, audience, climate, group size, direct flights. LLM strict-JSON extraction first, deterministic heuristics on failure or timeout, LRU cache on the normalised sentence, `source` and `confidence` on every parse. | `backend/app/nlq.py`, `src/mock/catalog.ts` (`localParse`) |
| §3.1 Keyword fallback | Every degradation path in the degradation matrix, and both indicators — `parsed.source` and `mode` — surfaced on the Search screen rather than hidden. | `backend/app/rag.py`, `src/components/search/*` |
| §3.2 Instant search and filtering | Live facet counts that agree with the result set, 250 ms debounce, out-of-order response guard, sort by relevance, price, rating and duration, numbered pagination, typo tolerance on the lexical path, predictive suggestions from `/suggest`. | `routers/search.py`, `src/pages/Search.tsx` |
| §3.2 Shareable URLs | Filters held in the query string, read on mount, written on change. Any result set is shareable and bookmarkable. | `src/pages/Search.tsx` |
| §3.2 Location search | POI proximity in miles with a radius control and category rails on `/discover`, with a static map. | `routers/content.py`, `src/pages/Discover.tsx` |
| §3.3 Unified catalogue | Normalise, match on four weighted signals, auto-merge at ≥ 0.86 honouring per-field source priority, review band 0.60–0.86, new trip below 0.60. Provenance kept on every trip. Audit entry per merge. | `backend/app/ingest.py`, `POST /ingest/{sourceKey}` |
| §3.4 Admin control panel | Search setup (searchable fields and weights, enabled filters, page size, fallback toggle), promotion (pin, boost, hide with scheduling), synonyms, data-source health with a manual sync, review queue with approve and reject, analytics. | `routers/admin.py`, `src/pages/Admin.tsx` |
| §3.5 Search analytics | Every search, impression, click and booking recorded against its `searchId`. Overview endpoint returns total searches, zero-result rate, CTR, conversion, top queries and a timeline. | `routers/analytics.py`, `src/components/admin/AnalyticsPanel.tsx` |
| §4 PostgreSQL | 19 tables, reviewable DDL, GIN `tsvector`, GIN on array facets, `pg_trgm` for typo tolerance, btree on price, duration and rating. Used when reachable, with a documented in-memory fallback. | `backend/sql/schema.sql`, `backend/app/models.py`, `docs/database-schema.md` |
| §6 Security | Documented in full against the POC in `docs/architecture.md` §6, with what is and is not implemented stated per line. Implemented: server-only credentials, audit log on every admin mutation, validated payloads, parameterised SQL, restricted CORS. | `docs/architecture.md` |
| §7 SEO | Documented in full, with the SSR gap stated. Implemented: per-route title and description, readable filter URLs, numbered pagination, trip structured data. | `docs/architecture.md` |
| Beyond the overview | A grounded streaming assistant on `/assistant` that answers only from retrieved trips and one policy document, with citations. It is how the retrieval layer is made inspectable. | `backend/app/chat.py`, `src/pages/Assistant.tsx` |

---

## 2. Out of scope

Nothing here is a surprise on the last day; each row says where it lands instead.

| Not in the POC | Reason | Where it goes |
|---|---|---|
| Authentication, roles, permissions, SSO, MFA | The POC demonstrates search behaviour; an auth flow would consume a day and prove nothing about search. `/admin` is open. | Production requirement, specified in `docs/architecture.md` §6 (finding D-01) |
| Payments, deposits, ATOL certificate issue, booking confirmation | Not a search concern. The booking panel raises a priced enquiry and confirms with a toast. | Separate workstream |
| Server-side rendering, canonical rules, sitemaps, `hreflang` | Needs a rendering tier and a caching layer, and the search-engine decision first. | Production delta (finding F-01) |
| Multi-currency | Requires amount plus currency on every price, per-market price lists and per-currency facet buckets — a schema change and a client decision. | Release scope decision (finding C-01) |
| Multi-language content and locale-scoped synonyms | Requires a locale-keyed translation table and a translation pipeline. `Synonym.market` is stored but not applied at query time. | Release scope decision (finding C-02) |
| Interactive map with live tiles on `/discover` | A tile provider is a key, a bill and a consent question. The map is a static image with plotted pins. | Production delta |
| Worker queue, webhook receivers, scheduled full sync, incremental index updates | Infrastructure. Ingestion runs synchronously in the request; the embedding index rebuilds at startup. | Production delta (finding B-03) |
| Unmerge of an incorrect auto-merge | A second data path with its own audit semantics. | Production requirement (finding E-01) |
| Learning-to-rank from click signals | The overview's "results improve automatically over time" has no specified mechanism or guardrails; a naive loop entrenches whatever is already top. POC ranking is deterministic and explainable. | Needs specification first (finding E-03) |
| A/B testing framework | Not reachable at POC traffic, and the metric definition is unresolved. | Needs specification first (finding E-04) |
| Consent gating of analytics | No consent platform is wired in. Events fire unconditionally and the analytics window is seeded. | Production requirement (finding D-04) |
| Trade and agency pricing tiers | Requires authenticated sessions and either a second index or a stripped public build. | Blocked on a client decision (finding D-02) |
| Margin-weighted ranking | Requires a precomputed opaque score and a consumer-facing ranking disclosure with legal sign-off. | Blocked on legal review (finding D-03) |
| Appearance tab (layout, fonts, spacing) | Free layout control invalidates the design system's accessibility and performance guarantees. | Constrained token version specified in `docs/design-system.md` (finding E-05) |
| Schema migrations and upgrade path | `schema.sql` creates from empty. Adequate for a POC, not for an install package. | Release 1.0 requirement (finding G-02) |
| Rate limiting, short-lived search keys, abuse detection | No public deployment, and throttling a demo makes it harder to demonstrate. | Production requirement (finding D-06) |
| Automated test suite, CI, load testing | Five days. Verification for this sprint is `npx tsc --noEmit`, a clean Python import, and the manual acceptance walk-through in §6. | Next sprint, first item |
| Monitoring, alerting, tracing, availability target | Degradation must be observable, not just graceful. Today it is only printed and reported on `/health`. | Production requirement (finding G-04) |

---

## 3. Assumptions

| # | Assumption | If it is wrong |
|---|---|---|
| A1 | The seeded catalogue is representative of the client's product shape — packaged multi-day holidays with a "from" price, departure months, a duration and a destination. | A dynamically packaged product (flight + hotel priced per date per party) breaks the price and availability model, and the facet buckets with it. Re-scope the data model. |
| A2 | One price per trip is sufficient for the POC (a "from" price, GBP). | Per-departure, per-party and per-board pricing changes ranking, facet buckets and every price the UI shows. |
| A3 | A single `en-GB` market with GBP and miles. | Multi-market is findings C-01 and C-02, both schema changes. |
| A4 | At least one LLM provider key is available for the AI-parse demonstration; nothing depends on it. | Everything still runs; the Search screen shows **Keyword fallback** throughout and the assistant is disabled. |
| A5 | PostgreSQL 16 is available via `backend/docker-compose.yml` for the database demonstration; nothing depends on it. | The POC runs on the in-memory catalogue and `/health` reports `db: "memory"`. |
| A6 | Feed records arrive as JSON with recognisable field names. `ingest.py` hunts aliases (`priceFrom`, `price_from`, `"Price From"`), but a genuinely foreign schema needs a connector. | One connector per source system, costed separately. |
| A7 | Catalogue scale for the POC is hundreds, not tens of thousands. Matching is quadratic and the embedding index is rebuilt whole. | Blocking and incremental indexing, in the production delta. |
| A8 | Search behaviour is judged on the three worked queries in §3.1 of the overview plus the 20-query benchmark set in §5. | Different benchmark queries need different synonym and hint tables; the tables are data, not code. |
| A9 | The design does not go beyond `docs/reference/` — colour, type, spacing and polish are the only permitted improvements. | Any new visual direction is a separate design engagement. |

---

## 4. Constraints

| Constraint | Consequence |
|---|---|
| Five working days, one team, five releases | Depth over breadth on `/search`; everything else is complete but not deep. |
| No new dependencies beyond those already installed | Charts are recharts, icons are lucide-react, toasts are sonner, no animation library, no data-fetching library. Pages fetch with `useEffect` and a `cancelled` flag. |
| Runs on a laptop with nothing installed | Every external dependency needs a fallback, which is why the degradation matrix exists. This is a feature, not a workaround. |
| Free-tier LLM providers, rate-limited | Query vectors are cached, the parse is cached, embedding calls are batched, and `llm.py` chains providers so a 429 falls through rather than failing. |
| Vectors from different providers are not comparable | The embedding provider is pinned at index build time and does not fall through the chain. A width mismatch degrades that request to lexical. |
| No SSR tier | The SEO claim in §7 of the overview cannot be met in this POC. Stated, not glossed. |
| Design reference is frozen | `docs/reference/src/styles.css` tokens and layouts are the ceiling; only colour, type, spacing and polish improve on them. |
| Single process, no queue | Ingestion is synchronous and capped at 500 records per request. |

---

## 5. Non-functional targets

Only numbers that can be measured with what is built. `tookMs` is returned on every `SearchResponse`,
so the search budget is self-reporting.

### Performance

| Target | Budget | Measured how | Status |
|---|---|---|---|
| `/search` server time, heuristic parse, memory repository, 33 trips | p95 ≤ 60 ms | `tookMs` over the 20-query benchmark set | Met |
| `/search` server time, heuristic parse, Postgres, ≤ 5,000 trips | p95 ≤ 400 ms | `tookMs`, 20 queries x 10 runs | Target for Release 3; not yet measured at 5,000 rows |
| `/search` end to end with a live LLM parse, cache miss | p95 ≤ 1,400 ms | `tookMs` plus browser timing | Provider-dependent; free tiers observed 300–2,000 ms |
| `/search` end to end with a parse cache hit | p95 ≤ 250 ms | second identical query, `nlq.cache_stats()` confirms the hit | Met |
| NL parse hard ceiling before falling back | 8.0 s (`nlq_timeout`) | forced by unsetting every provider key or pointing at a dead host | Met |
| `/suggest` | p95 ≤ 120 ms | timed loop over 20 prefixes | Met |
| `/analytics/overview?days=30` | p95 ≤ 500 ms | timed, both repositories | Met |
| First contentful paint, `/search`, desktop cable | ≤ 1.2 s | Lighthouse, 3 runs, median | Met |
| Largest contentful paint, `/search` | ≤ 2.0 s | Lighthouse, 3 runs, median | Met |
| Initial JavaScript, gzipped | ≤ 300 kB | `vite build` output | Met |
| Search interaction on typing (debounce to first paint of results) | ≤ 400 ms perceived, skeletons on first load only | manual, throttled to Fast 3G | Met |

The overview's "well under a second" (§5.1) is only true on the cache-hit and heuristic paths. On a
cold LLM parse it is not, and no amount of tuning changes a language-model round trip. That is why
the budget is split and why the fallback indicator is on screen (finding B-01).

### Correctness and quality

| Target | Threshold | Measured how |
|---|---|---|
| Facet-count accuracy | 100%. A facet showing *n* must return exactly *n* results when clicked, on every facet of every dimension. | For each facet value on the 20-query set, apply it and compare `total`. Guaranteed structurally: counts are computed over the same relevant set the page is sliced from, each facet excluding its own dimension. |
| Parse field accuracy, AI path | ≥ 90% field-level exact match on the 20-query benchmark set | Compare `ParsedQuery` against hand-labelled expectations |
| Parse field accuracy, heuristic path | ≥ 75% field-level exact match on the same set | Same, with every provider key unset |
| Three worked queries from §3.1 | Every field the overview claims is extracted, is extracted, on both paths | Manual, and they are the three examples `/search` offers on a zero-result page |
| Zero-result rate on the benchmark set | ≤ 8% of queries | Count `total == 0` responses |
| Zero-result recovery | Every zero-result response carries ≥ 3 suggestions, and at least one of them returns results | Follow each suggestion and assert `total > 0` |
| Auto-merge false positives | 0 on the 30-record ingest fixture | Labelled fixture, assert every merge is a true pair |
| Review-band rate | ≤ 20% of inbound records on the same fixture | `IngestResult.queued / received` |
| Records in different destinations | Never auto-merged, whatever their titles | Structural: capped at 0.55, below `REVIEW_FLOOR` for the pair |
| Ranking explainability | Every result carries at least one `matchedOn` reason when the query names a constraint the trip satisfies; every promoted result says so | Inspect responses across the benchmark set |
| Index freshness, POC | Ingested trips are searchable immediately on the lexical path, and semantically after the next restart | `POST /ingest` then `POST /search`; a known gap, see finding B-03 |
| Index freshness, production target | p95 webhook to searchable ≤ 60 s | Not measurable in the POC |

### Accessibility, resilience, compatibility

| Target | Threshold | Measured how |
|---|---|---|
| Contrast | ≥ 4.5:1 body text, ≥ 3:1 large text and UI boundaries, on all 8 screens | Token pairs checked once in `docs/design-system.md`; brand yellow is never a text colour on white |
| Keyboard | The whole search journey — type, parse, remove a chip, change a facet, sort, page, open a trip — completes without a mouse, with a visible focus ring at every stop | Manual keyboard walk-through |
| Hit targets | ≥ 40 px on every interactive control | Manual, and enforced by the `ui/` primitives |
| Screen reader | Facet counts, the parse-source indicator and the result count are announced; the results region is a live region | Manual with NVDA |
| Degradation | Every row of the degradation matrix in `docs/architecture.md` §5 reproduced by hand, and the UI states which path it is on | Unset a key, stop Postgres, stop FastAPI |
| Motion | No transition longer than 250 ms; no scroll-jacking, parallax, canvas or animation library | Code review |
| Browsers | Current Chrome, Edge, Firefox and Safari; responsive from 360 px to 1920 px | Manual at 360, 768, 1280, 1920 |
| Reliability | No unhandled exception reaches the traveller; a failed read renders an empty state with a retry | Manual fault injection |

Not measured in this POC, and stated as such: availability, throughput under concurrency, cost per
thousand searches, and behaviour above 5,000 trips.

---

## 6. POC limitations — the honest list

These are the sentences to read out before a demonstration.

1. **No authentication anywhere.** `/admin` is open to anyone who reaches the port. The `X-Actor`
   header on admin mutations is attribution for the audit log, not identity.
2. **No payments and no booking.** The booking panel is a priced enquiry that ends in a toast. No
   ATOL certificate is issued and no package classification field exists.
3. **The map on `/discover` is a static image** with pins plotted over it. A tile provider would fix
   it; the radius filtering and distance sorting behind it are real.
4. **No server-side rendering,** so the central SEO claim in §7 of the overview is not met. Filters
   are in readable URLs, pagination is numbered and metadata is per route, which is the groundwork.
5. **Single market: `en-GB`, GBP, miles.** No currency model, no locale dimension, no `hreflang`.
   `Synonym.market` is stored and not applied.
6. **Analytics are seeded.** The 30-day window in the admin panel is generated data with real
   searches appended as you use the POC. There is no consent gate, so every event is recorded.
7. **The embedding index is built at startup only.** A trip ingested at runtime is scored lexically
   until the process restarts.
8. **Ingestion is synchronous, 500 records maximum per request,** and every inbound record is scored
   against the whole catalogue. Correct at 33 trips; quadratic at 20,000.
9. **No unmerge.** An incorrect auto-merge is recorded in `audit_log` but cannot be reversed in the
   product.
10. **Nothing persists without Postgres.** With `DATABASE_URL` unset, admin edits, promotions,
    synonyms and logged searches live for the process lifetime. `/health` says `db: "memory"`.
11. **Raw query text is stored indefinitely with no scrubbing** — acceptable for a seeded POC,
    a DPIA item before any real traffic (finding D-05).
12. **No automated tests and no CI.** Verification is `npx tsc --noEmit`, a clean Python import, and
    the walk-through in §7.
13. **The Appearance tab of the admin panel is not built,** and the admin UI says so rather than
    showing a dead tab.
14. **Search is unauthenticated and unthrottled.** Do not expose this build to the internet.

Every one of these is visible in the product or in this document. None of them is disguised as
working.

---

## 7. Acceptance criteria — calling this POC done

The POC is complete when all of the following pass. Each is a check somebody can perform in front of
the client.

| # | Criterion | How it is checked |
|---|---|---|
| 1 | `npx tsc --noEmit` passes with no errors, and every backend module imports cleanly. | Run both. |
| 2 | `uv run uvicorn app.main:app` starts with no `.env`, no `DATABASE_URL` and no API key, and prints which fallback it landed on for chat, catalogue and index. | Start it on a clean machine. |
| 3 | With `docker compose up` and `python -m app.seed`, `/health` reports `db: "postgres"` and the trip count, and the same searches return the same results as the in-memory run. | Compare the two runs on the benchmark set. |
| 4 | The three worked queries from §3.1 of the overview each return relevant results and show the chips the overview claims — theme, audience, date window, budget; duration, activity, destination, group size; climate, month, maximum price, direct flights. | Type all three on `/search`. |
| 5 | Each of those three queries also works with every provider key removed, showing **Keyword fallback** and still returning relevant results. | Unset the keys and repeat. |
| 6 | Facet counts agree with the result set: pick any five facet values across three dimensions, apply each, and `total` equals the count shown. | Manual, five values. |
| 7 | A search's filters survive a copy of the URL into a new tab, and the chips, facets, sort and page all restore. | Copy and paste the URL. |
| 8 | A zero-result search offers at least three suggestions, and following the first one returns results. | Search for something absurd. |
| 9 | Pagination is numbered, every page is reachable, and the last page is not empty. | Page to the end. |
| 10 | Opening a trip records a click event against the originating `searchId`, and that click appears in the analytics CTR within the current window. | Search, click, open `/admin` analytics. |
| 11 | Pinning a trip in the admin panel moves it to the top of the next matching search, and the result says `pinned in merchandising`. Hiding one removes it. Both are reversible. | Pin, search, unpin. |
| 12 | Adding a synonym makes the alternative term retrieve the same trips (for example `aurora` retrieving `Northern Lights`). | Add and search. |
| 13 | `POST /ingest/{sourceKey}` with the 30-record fixture returns non-zero `merged` and `queued`, the queued items appear in the review queue with human-readable reasons, and approving one applies the merge with an audit entry. | Post the fixture, work the queue. |
| 14 | No record in the review queue is ever visible on `/search` before it is approved. | Search for the queued title. |
| 15 | Stopping FastAPI mid-session leaves every screen working against the seeded catalogue, with the **demo data** pill visible. | Kill the server, keep clicking. |
| 16 | The whole search journey completes with the keyboard only, with a visible focus ring at every stop. | Keyboard walk-through. |
| 17 | Every screen renders correctly at 360 px and 1920 px, with the side rail collapsing to bottom tabs on mobile. | Resize. |
| 18 | Every page sets its own `<title>` and meta description, and the trip page emits JSON-LD. | View source on each route. |
| 19 | The assistant answers only from retrieved trips and one policy document, cites them, and refuses to invent a price or a departure month. | Ask it for a trip that does not exist, and for a cancellation charge. |
| 20 | The five documents in `docs/` describe what was built, including the fourteen limitations in §6 and the unresolved decisions in `docs/doc-review.md`. | Read them against the running product. |

Sign-off is by the delivery lead and the client product owner together, against this table.
