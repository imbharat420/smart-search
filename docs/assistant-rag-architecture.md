# SmartSearch AI Travel Assistant — Master RAG Architecture & Conversational Design

This is a proposal, not an as-built doc — it says so wherever it departs from the code.
Every claim about *current* behaviour is read out of `backend/app/rag.py`, `nlq.py`,
`chat.py`, `ingest.py`, `models.py`, `schema.sql` and `src/types.ts`; every claim about
*proposed* behaviour is marked **NEW**. Nothing here is aspirational filler — each
proposal names the file it lands in and the existing thing it extends.

**Non-negotiable constraint, stated up front:** zero new third-party packages. Every
capability below — knowledge-graph traversal, cross-encoder-style reranking, explicit
JSON state, event-driven cache invalidation — is built from what's already a dependency
(SQLAlchemy, numpy, pydantic, the stdlib) or by reusing `llm.py`'s existing
multi-provider OpenAI-wire client one more time. Where an industry-standard approach
*would* normally reach for a new package (a graph database, a local cross-encoder
model), this doc says so explicitly and gives the zero-dependency substitute, plus the
condition under which the heavier option would become worth it.

"100% self-contained" is already true of this codebase in the sense that matters: every
provider in `providers.py` is an LLM/embedding *model* vendor (Groq, Gemini, etc.)
speaking one wire format through one client — never a travel API (no Amadeus, no
Sabre). All trip, destination, POI and policy data is the proprietary Postgres catalogue
in `schema.sql`. This plan keeps that property and closes the three gaps the brief
actually asks for: relational multi-hop reasoning, a relevance pass sharper than raw
cosine similarity, and conversational state that survives more than 8 messages.

---

## Section 1 — Fully Internal Agentic Architecture & RAG Strategy

### 1.1 What's already there

- **Retrieval** (`rag.py`): a `TripIndex` holds unit-normalised trip and policy
  embeddings **in-process as numpy arrays** (no pgvector — `schema.sql` leaves
  `CREATE EXTENSION vector` commented out as a future production path). Cosine
  similarity is a dot product, mapped to a display score through a per-provider
  `SimBand` calibration. When no embedding provider is configured, or a live query
  embed fails, or the vector width doesn't match, it drops to `_lexical_score` —
  weighted field overlap with prefix/substring fuzz for typos. `mode` on every
  response says which one answered.
- **Query understanding** (`nlq.py`): an AI layer (LLM, strict JSON, temperature 0)
  tried first, a pure-regex heuristic layer as the fallback that needs no API key.
  Output is `ParsedQuery` — destination, months, durationDays, maxPrice, themes,
  activities, audience, climate, groupSizeMax, directFlights, plus `source` and
  `confidence`. An LRU-ish cache and an 8-second deadline sit in front of it; `parse()`
  never raises.
- **Chat orchestration** (`chat.py`): per turn — parse → retrieve top trips + one
  policy → stream tokens from `llm.py`'s provider chain, grounded in a hand-built
  `CONTEXT:` block → emit citations → done. **There is no session store.** The only
  memory is `messages[-8:]`, a raw replay of the last few turns, re-sent in full on
  every request.
- **Entity resolution** (`ingest.py`): `match_score()` blends title/destination/
  duration/price similarity into one number; ≥0.86 auto-merges, 0.60–0.86 queues a
  `MergeCandidate` for human review, below that is a new trip. This is real, working
  fuzzy matching — but there is no explicit graph of relationships between
  destinations, trips, POIs and suppliers today. Destination is a nested dict per
  trip, resolved by slug in the repository layer.

### 1.2 Target pipeline

```
user turn
   │
   ▼
[state.merge]  ── explicit slot extraction (LLM tool call) merges into TripPlanState (§1.5.1)
   │
   ▼
[nlq.parse]  ── unchanged: AI-first, heuristic fallback, cached, deadline-bound
   │
   ▼
[candidate generation]  ── union of three sources, deduped by trip id  (§1.4)
   ├── vector search        (rag.py, unchanged)
   ├── lexical fallback     (rag.py, unchanged)
   └── graph traversal      (graph.py, NEW — multi-hop / relational questions)
   │
   ▼
[rerank]  ── LLM-as-cross-encoder over the ~20-30 candidates  (§1.4, NEW)
   │
   ▼
[context assembly]  ── state JSON + top-K reranked trips + one policy  (§1.5)
   │
   ▼
[generation]  ── llm.py provider chain, unchanged
   │
   ▼
[state.persist + event publish]  ── save TripPlanState, fire invalidation events (§1.5.2)
```

Every stage left unmarked is the existing code, called from the same place it's called
today. The new stages are additive wrappers, not rewrites.

### 1.3 KG-RAG over the relational schema, not a graph database

The catalogue already *is* a graph — `destinations 1:N trips`, `destinations 1:N pois`,
`trips 1:N trip_media/trip_departures`, `trips N:1 suppliers`, plus the implicit edges
"trips that share a theme" and "destinations that share a region." A dedicated graph
database (Neo4j, a triple store) would be a new external system to operate, back up and
reason about for a dataset that is, realistically, tens of thousands of trips and a few
thousand destinations/POIs — well within what a handful of indexed SQL joins answer in
single-digit milliseconds.

**Proposal: `backend/app/graph.py` (NEW)** — a thin adjacency-list builder over
`repository.py` queries, cached in memory and invalidated by the event bus (§1.5.2), not
a new storage engine:

| Node type | Source table | Edge type | Direction | Backing query |
| --- | --- | --- | --- | --- |
| `Destination` | `destinations` | `LOCATED_IN` | Trip → Destination | `trip.destination_id` |
| `Poi` | `pois` | `NEAR` | Poi → Destination | `poi.destination_id` |
| `Destination` | `destinations` | `SHARES_REGION` | Destination ↔ Destination | same `region` value |
| `Theme`/`Activity` | `trips.themes[]` / `.activities[]` | `TAGGED` | Trip → Theme/Activity | array membership |
| `Supplier` | `suppliers` | `SOURCED_FROM` | Trip → Supplier | `trip.supplier_id` |

```python
# backend/app/graph.py — sketch, no new dependency
@dataclass(frozen=True)
class Edge:
    kind: str        # 'LOCATED_IN' | 'NEAR' | 'SHARES_REGION' | 'TAGGED' | 'SOURCED_FROM'
    target_id: str
    target_kind: str

class CatalogueGraph:
    """Adjacency built once from repository.py, rebuilt only on invalidation events."""
    def traverse(self, start_id: str, edge_kinds: list[str], hops: int = 2) -> list[str]:
        ...  # BFS over an in-memory dict[str, list[Edge]] — plain Python, O(hops * fan-out)
```

This is what makes **Scenario D** (contradictory intent) and multi-hop questions like
*"somewhere near Positano but quieter"* tractable: a pure vector search treats "near
Positano" and "quieter" as one blended embedding and loses the relational constraint;
`graph.traverse(positano_id, ["SHARES_REGION"], hops=1)` returns sibling destinations in
Campania first, and *then* vector/lexical scoring ranks those specifically by "quiet."
Graph traversal narrows the candidate *set*; embeddings and lexical scoring rank
*within* it. Neither replaces the other.

**When to reconsider a real graph store:** if the catalogue grows past roughly 500k
trips/POIs *and* traversal depth needs to exceed 2–3 hops routinely, in-memory BFS over
a rebuilt adjacency list stops being the cheapest option. That is a capacity threshold
this catalogue is nowhere near, so it's a documented future decision, not a current one.

### 1.4 Reranking pipeline — LLM-as-cross-encoder, not a new model dependency

A real cross-encoder (`sentence-transformers`) scores a query and a candidate together
in one forward pass, which is more precise than cosine similarity between two
independently-embedded vectors because it can attend across both. That precision gain
is genuinely valuable — the`rag.py` scoring today is base similarity plus a handful of
hand-tuned additive boosts (`_agreements`, promotion weights), which is a heuristic
patch, not a learned relevance judgement.

The zero-dependency way to get the *cross-encoder property* — query and candidate
jointly attended, not independently embedded — is to hand the same job to the LLM
that's already wired up in `llm.py`, since a chat model scoring a short list *is* a
cross-encoder, just a much larger and slower one:

```python
# backend/app/rerank.py — sketch, reuses llm.py's existing client, NEW file
RERANK_PROMPT = """Score each candidate's relevance to the traveller's request, 0.00-1.00.
Request: {query}
State: {state_json}
Candidates:
{numbered_candidate_lines}
Return ONLY a JSON array: [{{"id": "trip-14", "score": 0.91, "reason": "direct flights, matches budget"}}, ...]"""

async def rerank(query: str, state: TripPlanState, candidates: list[Trip]) -> list[RankedTrip]:
    # One non-streaming completion, temperature 0, against the FIRST configured
    # chat provider — reuses llm.chat_providers()/client_for(), no new client.
    ...
```

- **Scope**: only the top ~20–30 candidates from vector+lexical+graph generation are
  reranked — never the whole catalogue. This keeps the added latency to one short
  completion call, not one call per trip.
- **Fallback**: if the rerank call errors or times out, keep the Stage-A ordering
  unchanged. This is the same philosophy already in the codebase three times over
  (`rag.py`'s lexical fallback, `nlq.py`'s heuristic fallback, `llm.py`'s provider
  chain) — a new capability degrades to the existing behaviour, it never breaks it.
- **Latency**: `chat.py` already streams the inline trip cards *before* the prose
  reply finishes (parsed → trips → tokens → citations → done). Reranking slots into
  that same gap: candidates are generated, reranked, then the top-K reranked set is
  what gets sent as the `trips` chunk and as `CONTEXT` — the user still sees cards
  early, they're just the *reranked* cards instead of the raw-similarity ones.
- **Escape hatch, off by default**: `RERANK_BACKEND=llm` (default) vs. `local` — a
  config switch, not built now, that would call a local `sentence-transformers`
  cross-encoder if the catalogue ever grows large enough that one LLM call per chat
  turn becomes a real cost or latency problem. Until then, `llm` is strictly better:
  it costs one already-budgeted API call and adds no dependency.

### 1.5 Context window strategy

#### 1.5.1 Explicit State Tracking (JSON over History)

`chat.py`'s `messages[-8:]` re-sends raw prose every turn. That's the wrong unit of
memory for a slot-filling flow: it grows unbounded with conversation length, it makes
the model re-derive "so the budget was mid-range, right?" from scrollback every time,
and a user who changes their mind on turn 6 leaves a contradiction sitting in the
context the model has to notice and resolve itself.

**Proposal: `TripPlanState`, a small explicit JSON object, replaces most of the history
replay.**

```python
# backend/app/schemas.py — additive, NEW model
class TripPlanState(BaseModel):
    durationDays: Optional[int] = None
    budgetBand: Optional[Literal["budget", "mid", "luxury"]] = None
    maxPrice: Optional[float] = None          # explicit number, if given instead of a band
    region: Optional[str] = None              # bucket key, e.g. "Europe" — see §2
    holidayType: Optional[list[str]] = None   # maps straight onto Trip.themes vocabulary
    pace: Optional[Literal["slow", "balanced", "packed"]] = None   # NEW signal, no catalogue change — see below
    groupSize: Optional[int] = None
    skipCounts: dict[str, int] = Field(default_factory=dict)   # per-slot skip/loop tracking
    turnCount: int = 0
    lastUpdatedSlot: Optional[str] = None
```

- **Where it lives**: a new table, `assistant_sessions(id, session_id text unique,
  state jsonb, updated_at)` — one row per conversation, following the exact pattern
  `search_config` already uses ("one row the app edits at runtime, not a settings
  file"). When `settings.db_configured()` is false, it falls back to an in-memory dict
  keyed by session id, mirroring the existing memory-catalogue fallback in `config.py`
  — no new operational dependency either way.
- **`sessionId` on the wire**: one additive, optional field on `ChatRequest` (currently
  just `messages: Message[]` in `schemas.py`/`types.ts`). Client generates it once with
  `crypto.randomUUID()` and keeps it in `sessionStorage`; nothing else about the
  `/chat` contract changes.
- **What actually gets sent to the LLM per turn**: `TripPlanState` (compact, ~100
  tokens) + the last 2 turns of raw dialogue for conversational tone, not 8. The state
  *is* the memory; the short window is just for "what did I just say" continuity. This
  is strictly smaller than today's payload and doesn't grow with conversation length.
- **Slot extraction as a tool call, not prose parsing**: the model calls
  `update_trip_state(patch)` (§1.6) whenever it reads a slot value out of free text,
  before the retrieval step runs. This is the direct mechanism behind "answer out of
  order / several at once / change a previous answer" in the brief — it's a merge into
  one object, not a rewrite of conversation history.
- **Why `pace` gets no catalogue column**: `trips` has no "pace" field and adding one
  means a migration plus backfilling 24+ existing rows with a judgement call nobody
  has made. Instead, `pace` lives only in `TripPlanState` and is used as a **soft
  rerank signal**, not a hard filter: the rerank prompt (§1.4) is told the traveller's
  pace preference and asked to prefer trips whose `duration_days` and activity density
  fit it. Wrong on the margins is fine for a soft signal; wrong on the margins for a
  filter would silently drop good trips. If pace search proves valuable enough to
  justify a schema change later, that's a clean follow-up, not a blocker now.

#### 1.5.2 Event-Driven Invalidation

Three caches now exist that can go stale: the embedding index (`rag.py`'s `TripIndex`),
the graph adjacency cache (§1.3), and `nlq.py`'s query-parse cache (which depends on
`synonyms`). None of them currently have an invalidation story beyond "the process
restarted." Rather than a message broker, this needs one in-process pub/sub —
stdlib-only:

```python
# backend/app/events.py — NEW, ~20 lines, no dependency
class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[Callable[[dict], None]]] = defaultdict(list)
    def subscribe(self, event: str, fn: Callable[[dict], None]) -> None:
        self._subs[event].append(fn)
    def publish(self, event: str, payload: dict) -> None:
        for fn in self._subs[event]:
            fn(payload)

bus = EventBus()
```

| Event | Raised where (one line added) | Invalidates |
| --- | --- | --- |
| `trip.merged` / `trip.updated` | `ingest.py`, after a merge or an admin edit | `TripIndex` re-embeds *that trip only* (not a full rebuild); graph adjacency cache drops the affected node's edges |
| `promotion.changed` / `synonym.changed` | `routers/admin.py`, after a write | `nlq.py` cache cleared (synonyms feed the heuristic table); graph cache untouched |
| `search_config.changed` | `routers/admin.py` | rerank rubric weights, if config-driven, re-read on next call |
| `session.slot_changed` | `chat.py`, inside `update_trip_state` | drops that session's *cached candidate list* so the next retrieval recomputes under the new slot value, and marks dependent slots `unconfirmed` (kept, not erased) — e.g. changing `region` after a `budgetBand` was suggested doesn't wipe the budget, it flags it for a one-line re-confirmation rather than a silent stale assumption |

This is what turns "the model happened to notice the user changed their mind" into a
deterministic system behaviour: a slot change is an event, and everything that depended
on the old value is told about it explicitly.

### 1.6 Internal tools (function-calling surface)

| Tool | Backs onto | Signature | Used for |
| --- | --- | --- | --- |
| `update_trip_state` | `assistant_sessions` (NEW) | `(patch: dict) -> TripPlanState` | every turn, before retrieval — slot merge |
| `query_internal_destinations` | `repository.list_destinations` + region-bucket lookup (NEW, §2) | `(region?, country?, theme?) -> Destination[]` | "what's in Southeast Asia" style browsing |
| `search_proprietary_trips` | `rag.TripIndex.search` | `(parsed: ParsedQuery, state: TripPlanState) -> SearchResult[]` | the main retrieval call |
| `graph_traverse` | `graph.CatalogueGraph.traverse` (NEW, §1.3) | `(start_id, edge_kinds[], hops) -> str[]` | multi-hop / relational questions, Scenario D |
| `rerank_candidates` | `rerank.rerank` (NEW, §1.4) | `(query, state, candidates) -> RankedTrip[]` | sharpening the final grounded set |
| `get_pois_near` | `repository` pois query (existing table, new accessor) | `(destination_id, category?) -> Poi[]` | backs the "near me" flow already in `ShareLocationPrompt.tsx`/`nearMe.ts` |
| `get_policy` | `rag.TripIndex`'s existing `_best_policy_lexical`/embedding path | `(topic: str) -> Policy` | booking/cancellation/baggage/ATOL questions |

Every tool either wraps an existing function unchanged or is a small new module
(`graph.py`, `rerank.py`, `events.py`) that itself wraps existing repository/LLM
plumbing. Nothing here introduces a second retrieval stack.

---

## Section 2 — The Conversational Flow & UI Matrix

Five of the six parameters map onto fields the catalogue already has
(`duration_days`, `price_from`, `destination`/`region`, `themes`, `group_size_max`);
only **Pace** is new, and it's state-only (§1.5.1), not a schema change. **Region** in
the brief's sense ("Europe", "Southeast Asia") is broader than the `destinations.region`
column (which holds sub-national names like "Tuscany", "Arctic Norway" per
`seed_data.py`) — so this adds one small constant, `REGION_BUCKETS: dict[str,
list[str]]` mapping a bucket name to the `destination.country` values already parsed by
`nlq.py`'s `_DESTINATIONS` table. No migration; it's a lookup table in Python.

| Parameter | System prompt | Quick-reply chips | Skip / Surprise-me | Backend extraction |
| --- | --- | --- | --- | --- |
| **Duration** | "How long are you thinking? A long weekend, a proper week, or something longer?" | `Weekend (2-4d)` · `1 week` · `10-14 days` · `2+ weeks` | `Skip — any length` | Maps straight to `ParsedQuery.durationDays` (a chip sets a midpoint; free text goes through `nlq.py` unchanged) → merged into `TripPlanState.durationDays` via `update_trip_state` |
| **Budget** | "What kind of budget should I work with?" | `Budget <£1k` · `Mid £1k-£3k` · `Luxury £3k+` | `Skip — show me a range` | Chip sets `TripPlanState.budgetBand`; free text ("around two grand") goes through `nlq.py`'s existing budget heuristic into `maxPrice`. Both are optional — a band alone is enough to retrieve |
| **Region** | "Any part of the world calling you, or should I surprise you?" | `Europe` · `Asia` · `Americas` · `Africa & Middle East` | `Surprise me!` | Chip → `REGION_BUCKETS[bucket]` → country list → `query_internal_destinations(country=...)`; free text ("somewhere near Italy") goes through `nlq.py`'s `_DESTINATIONS` table unchanged into `ParsedQuery.destination` |
| **Holiday type** | "What's the shape of the trip — beach and relax, culture and cities, wildlife, something active?" | `Beach` · `Culture` · `Wildlife` · `Adventure` · `Food & wine` | `Skip — open to anything` | Chips are literally `Trip.themes` vocabulary from `nlq.py`'s `_THEMES` table (`Beach`, `Culture`, `Wildlife`, `Adventure`, `Food and wine`, …) → `TripPlanState.holidayType`, passed straight through to `ParsedQuery.themes` |
| **Pace** | "Want every day packed with things to do, a easy balance, or mostly downtime?" | `Packed` · `Balanced` · `Slow & easy` | `Skip — you decide` | `TripPlanState.pace` only (§1.5.1) — a soft rerank signal, never a hard filter, so a skip costs nothing in result quality |
| **Group size** | "Who's coming along?" | `Solo` · `Couple` · `Family` · `Small group (5+)` | `Skip — just me for now` | Chip → an `Audience`-shaped hint into `ParsedQuery.audience` *and* a numeric ceiling into `TripPlanState.groupSize` → `ParsedQuery.groupSizeMax`, since the catalogue has both an audience tag and a hard `group_size_max` column |

Every chip row is rendered alongside a free-text input in the same turn — the brief's
"hybrid chat + buttons" — using the same chip-rendering component `ParsedSummary.tsx`
already ships (it currently renders parsed-field chips after the fact; this reuses the
same `Chip` primitive to render them *as prompts*, before the answer, which is a
presentational change, not a new component).

---

## Section 3 — Exhaustive Scenario Handling Playbook

### Scenario A — The Over-Sharer

> **User:** "Hi! We're a family of 4, budget around £2500 each, looking for something
> beachy in Europe for 10 days, fairly relaxed pace, sometime this summer."

**AI:**
> "Perfect — that's everything I need. Family of 4, beach and relax in Europe, around
> £2,500pp, 10 days, easy pace, summer. Let me see what's available…"

`update_trip_state({groupSize: 4, budgetBand: "mid", maxPrice: 2500, region: "Europe",
holidayType: ["Beach"], pace: "slow", durationDays: 10})` fires once, in full, then
straight to `search_proprietary_trips` — **no re-asking of already-answered slots.**
The chips still render afterward (via `ParsedSummary.tsx`), so the user can see and
correct anything that was misread, but the assistant does not walk back through
questions it already has answers to.

### Scenario B — The Impossible Budget

> **User:** "I have a $50 budget for a 7-day luxury trip to Dubai."

**AI:**
> "I love an ambitious target! $50 won't stretch to a week in Dubai even at our most
> flexible rates — but I don't want to just say no. I can either look for the very
> cheapest 7-day Dubai trips we carry so you can see the real floor, or point you at a
> similarly luxe-feeling destination that's dramatically cheaper this time of year.
> Which sounds more useful?"
> `[See cheapest Dubai options]` `[Show a cheaper alternative]` `[Both]`

Mechanically: `maxPrice=50` and `region`/destination = Dubai both get stored in state
as given — **never silently overridden**. The model never says "impossible"; it runs
`search_proprietary_trips` with the *stated* budget first (this is what confirms zero
or near-zero results honestly), then offers `query_internal_destinations(region=...,
theme=["Luxury"])` for cheaper look-alike destinations only as an explicit second option
the user opts into. The constraint is validated against real catalogue data, not
asserted from general knowledge.

### Scenario C — The Loop / Repeated Skip

> User clicks `Surprise me!` on Region, then changes their mind and clicks `Europe`,
> then `Skip`, then types "actually maybe Asia?" — three changes in one exchange.

Each change is a legitimate `update_trip_state` call, and `skipCounts.region`
increments on each skip/reversal. **Loop-break rule:** once `skipCounts[slot] >= 3` *or*
`turnCount - lastUpdatedSlot's turn > 2` without a firm answer on that slot, the
assistant stops asking and commits to the best signal it has:

**AI:**
> "I'll stop pestering you about the region — based on everything else you've told me,
> here's what I found across Europe and Asia both. Say the word if you want me to
> narrow it to one."

This runs `search_proprietary_trips` with the region slot left broad (both buckets, or
unset) rather than blocking on an answer — the brief's "gracefully break the loop,
summarize what it has, and move forward" implemented as a hard threshold on
`skipCounts`, not a vibe the model has to infer turn by turn.

### Scenario D — The Contradiction

> **User:** "I want a quiet, secluded nightlife experience in a busy city centre."

**AI:**
> "That's a fun combination — I'm reading that as: you want a lively centre to have
> options after dark, but somewhere to actually stay that's calm rather than right on
> top of the noise. Let me look for city-break trips with strong nightlife nearby but a
> quieter home base — tell me if I've got that backwards."

Mechanically, this is exactly what §1.3's graph layer is for: `search_proprietary_trips`
retrieves City-break/Nightlife-themed candidates first (the "busy city centre" half),
then `graph_traverse(candidate_destination_id, ["SHARES_REGION", "NEAR"], hops=1)`
pulls in POIs/sub-areas tagged as quieter within the same destination, and the rerank
step (§1.4) is explicitly told both halves of the intent and asked to score trips whose
description or POI mix satisfies *both* rather than either. A pure embedding search
would average "quiet" and "nightlife" into a bland, generically-central result — the
graph narrows to the right city first, then reranking resolves the tension within it.

### Scenario E — Vague Intent

> **User:** "I just want to go somewhere nice."

**AI:**
> "Happy to just show you some good options. Quick chips if you want to steer it, or
> I'll go with our best all-round trips right now:"
> `[Beach]` `[City break]` `[Adventure]` `[Surprise me completely]`

If the user picks nothing further within one turn, the assistant does **not** loop —
it calls `search_proprietary_trips` with an empty/near-empty `ParsedQuery`, which
`rag.py` already handles today (its ranking falls back to rating, review count and
active promotions when no request signal exists), and presents those as "here's what's
popular right now" rather than forcing slot-filling on someone who explicitly doesn't
want to be asked.

---

## Section 4 — Master System Prompt

This extends, rather than replaces, the tone and citation contract already shipped in
`chat.py`'s `SYSTEM_PROMPT` (British English, `£` formatting, `[trip-14]` bracket
citations) — it adds the state-tracking, tool-calling, skip-loop and graceful-correction
rules the brief asks for. The persona name below is written as the brief's
**SmartSearch**; the shipped constant currently says "TravelIQ" — swapping it is a
one-line rename in `chat.py`, not part of this architecture.

```text
You are SmartSearch, the trip-planning assistant for a UK tour operator. You have
access ONLY to this operator's own catalogue, retrieved for you through internal tools —
you have no access to the open internet and no external travel APIs exist in this
system. Never invent a trip, price, duration, departure month, rating or policy detail
that wasn't handed to you by a tool. Prices are pounds sterling, written as £1,240.
Use British English.

STATE. You track six things about the traveller across the whole conversation, held as
one JSON object (not conversation history): duration, budget, region, holiday type,
pace, group size. On every turn, before doing anything else, call update_trip_state with
whatever new or changed values you can read from the traveller's message — even partial,
even several at once, even out of order, even if it contradicts something said earlier
(a new answer always wins; state is merged, not appended to). Never ask for a slot that
is already filled unless the traveller is clearly changing it.

TOOLS. Use query_internal_destinations to browse by region/country/theme,
search_proprietary_trips as your main retrieval call, graph_traverse when a request has
a relational shape ("near X but not X", "similar to Y but cheaper"), rerank_candidates
to sharpen a candidate list before you answer from it, get_pois_near for "what's nearby"
questions, and get_policy for booking, cancellation, baggage or financial-protection
questions. Always retrieve before answering a factual question about the catalogue —
never answer from memory of an earlier turn's results if the state has changed since.

HYBRID UI. Every question you ask must be answerable by free text or by a short set of
chips you're rendering alongside it — never make chips the only way to answer. Every
question must carry an explicit skip option ("Skip", "Surprise me!", or equivalent) that
is a real, complete answer, not a stall.

LOOP-BREAKING. If a slot has been skipped or changed back and forth three times, or two
full turns have passed without it firming up, stop asking about it. Say plainly that
you're moving forward with your best read of it, then call search_proprietary_trips
with whatever you have. A traveller should never be asked the same question a fourth
time.

GRACEFUL CORRECTION. If a request is unrealistic against the actual catalogue (a budget
too low for a destination, a duration too short for a route), never say it's impossible
and never argue from general knowledge. Validate the traveller's intent warmly, retrieve
the real numbers for what they asked (so the constraint is demonstrated, not asserted),
and offer one concrete alternative drawn from an actual tool result — a cheaper
destination, a shorter trip, a different season. Always phrase the alternative as a
choice, not a substitution you've already made for them.

CONTRADICTIONS. If a request pulls in two directions at once (quiet vs. lively, remote
vs. connected), say back in one sentence how you're reconciling it, then retrieve and
rerank for both halves rather than averaging them away. If you're unsure you've read the
tension correctly, say so and invite a correction — don't guess silently.

GROUNDING & CITATIONS. Answer only from what your tools returned this turn. Name each
trip by its exact title and cite its id in square brackets the first time you mention
it, like [trip-14]; cite a policy id the same way for booking/cancellation/baggage
questions. Say why each trip fits — the month, the theme, the party, the budget, whether
flights are direct — in the traveller's own terms, not generic praise. If nothing
retrieved is suitable, say so plainly and suggest one concrete way to widen the search.

LENGTH. Keep it to a few sentences. The trips render as cards beneath your reply — you
are the explanation, not the list.
```

---

### Summary of net-new surface area

Everything above adds up to four small new modules and one additive schema change —
nothing that touches the existing retrieval, parsing or provider-fallback code paths,
and no new third-party dependency:

- `backend/app/graph.py` — in-memory adjacency over existing tables (§1.3)
- `backend/app/rerank.py` — one more prompt template against the existing `llm.py` client (§1.4)
- `backend/app/events.py` — a ~20-line pub/sub bus (§1.5.2)
- `TripPlanState` model + `assistant_sessions` table + `ChatRequest.sessionId` — the state layer (§1.5.1)
