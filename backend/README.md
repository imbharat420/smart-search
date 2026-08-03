# SmartSearch API (FastAPI · RAG)

The real backend behind the SmartSearch frontend's `src/mock/api.ts`. Same request/
response shapes as the mock, so swapping the frontend over is a one-file change.

- **Retrieval**: embeddings over the 24-product catalog + 3 policy docs, ranked by
  cosine similarity. Falls back to lexical (substring + fuzzy) scoring when no
  embedding provider is set — or if the provider fails mid-session.
- **Chat**: retrieves relevant products + a policy, feeds them as grounded context
  to the model, and **streams** the reply token-by-token over SSE, then emits
  the products and citations as separate events.
- **A plan, not a transcript**: the assistant tracks six parameters across the
  conversation — duration, budget, region, holiday type, pace, group size — as one
  explicit JSON object rather than re-reading them out of scrollback each turn. It
  asks at most one question per turn, always with tappable options and always with a
  skip, and stops asking once a slot has been skipped or reversed enough times.
  See [Assistant](#assistant-the-six-slot-plan) below and
  [docs/assistant-rag-architecture.md](../docs/assistant-rag-architecture.md).
- **Any of six providers, with fallback**: five have free tiers. A 429 or outage on
  one is retried on the next, so free-tier limits don't surface to the user.

## Providers

| Provider | `*_API_KEY` | Free? | Default chat model | Embeddings | Get a key |
| --- | --- | --- | --- | --- | --- |
| Groq | `GROQ_API_KEY` | ✅ free, very fast | `llama-3.3-70b-versatile` | — | [console.groq.com/keys](https://console.groq.com/keys) |
| Cerebras | `CEREBRAS_API_KEY` | ✅ free daily allowance | `llama-3.3-70b` | — | [cloud.cerebras.ai](https://cloud.cerebras.ai/) |
| Google Gemini | `GEMINI_API_KEY` | ✅ free tier | `gemini-2.5-flash` | `gemini-embedding-001` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| NVIDIA NIM | `NVIDIA_API_KEY` | ✅ free credits | `meta/llama-3.3-70b-instruct` | `nvidia/nv-embedqa-e5-v5` | [build.nvidia.com](https://build.nvidia.com/) |
| Z.AI | `ZAI_API_KEY` | ✅ GLM flash free | `glm-4.5-flash` | `embedding-3` | [z.ai API keys](https://z.ai/manage-apikey/apikey-list) |
| OpenAI | `OPENAI_API_KEY` | paid | `gpt-4o-mini` | `text-embedding-3-small` | [platform.openai.com](https://platform.openai.com/api-keys) |

Every one of them speaks the OpenAI wire format, so there's a single client and no
extra dependencies — see [app/providers.py](app/providers.py) for the registry and
[app/llm.py](app/llm.py) for the chain.

**Set at least one key.** Set two or three and rate limits become invisible:

```dotenv
GROQ_API_KEY=gsk_...          # primary
GEMINI_API_KEY=AIza...        # fallback — and the one that serves embeddings
LLM_PROVIDER=auto             # or pin: groq | cerebras | gemini | nvidia | zai | openai
LLM_FALLBACK=groq,cerebras,gemini,nvidia,zai,openai
```

- `LLM_PROVIDER=auto` uses the first provider in `LLM_FALLBACK` that has a key;
  naming one puts it first and keeps the rest as fallback.
- Providers without a key are skipped, so the chain default is safe to leave alone.
- Groq and Cerebras are chat-only. `/search` uses the first *embedding-capable*
  provider with a key; with none, it stays on lexical scoring.
- Model ids move fast — override any of them with `GROQ_CHAT_MODEL`,
  `GEMINI_EMBED_MODEL`, etc. See [.env.example](.env.example) for the full list.

**How fallback behaves:** a provider that fails before its first token is skipped
silently and the next is tried. One that dies *mid-reply* surfaces as an error
instead — restarting would duplicate text already rendered in the browser. If the
whole chain is exhausted, `/chat` says so in plain language and still returns the
retrieved product cards.

> Embedding vectors from different providers aren't comparable, so the provider
> that builds the index at startup is pinned for query embeddings too. Each
> embedding family also has its own similarity range, so the relevance
> calibration ships per provider (`EMBED_SIM_*` to override).

## Assistant: the six-slot plan

`POST /chat` is a planning conversation, not a stateless question-and-answer. Per turn:

```
state.load ─ parse ─ candidates ─ rerank ─ context ─ stream ─ state.save
              │         │           │
              │         │           └─ rerank.py: the chat model scores a ≤30 shortlist,
              │         │              attending to query and candidate together. Falls
              │         │              back to the retrieval order on any failure.
              │         └─ rag.py, narrowed by graph.py when the plan names a region,
              │            then widened if the constraints matched nothing (below).
              └─ nlq.py, unchanged — it already reads five of the six slots
```

- **State** lives in `plan.py` (the rules — pure, no IO) and `sessions.py` (the storage —
  Postgres, or in-process when `DATABASE_URL` is unset). The browser mints a `sessionId`
  and sends it with each turn; without one the turn still answers, it just has no memory.
- **Chips.** The response carries `quickReplies` for at most one slot per turn. Tapping one
  sends the chip's `patch` back verbatim, so a tap never depends on the parser re-reading
  its own label. Every question carries a skip, and a skip is a complete answer.
- **Loop-breaking is a threshold, not a judgement.** Three skips or reversals on a slot, or
  two askings of it, and the assistant stops asking and commits to what it has.
- **Widening.** The filters are conjunctive, so a rich sentence can describe a trip the
  catalogue does not sell. Rather than dead-ending, chat drops the constraint costing the
  most results (up to two) and tells the model what it stretched, so the reply says so.
- **Zero new dependencies.** The graph is an in-memory adjacency index over the existing
  tables, not a graph database; the reranker is the chat model already in `llm.py`, not a
  local cross-encoder. Both trade-offs, and when to revisit them, are in the design doc.

`/health` reports each of these so a degraded mode is visible without reading logs:
`sessionStore`, `graphNodes`, `graphEdges`, `rerank`.

```dotenv
RERANK_ENABLED=true            # false keeps the plain similarity order
RERANK_TIMEOUT=12.0            # then it keeps the similarity order too
RERANK_CANDIDATES=24           # shortlist size handed to the reranker
ASSISTANT_HISTORY_TURNS=4      # raw dialogue turns sent alongside the plan
```

## Contract

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /search` | `{ query, filters?: { category?, maxPrice?, inStockOnly? } }` | `SearchResult[]` |
| `POST /chat` | `{ messages: { role, content }[], sessionId?, slotPatch? }` | `text/event-stream` of `ChatChunk` (`{parsed}` / `{state}` / `{trips}` / `{quickReplies}` / `{token}` / `{citations}` / `{done}`, in that order) |
| `GET /health` | — | `{ status, configured, indexed, products, chatProvider, chatModel, fallbacks, embedProvider, sessionStore, graphNodes, graphEdges, rerank, tracing, tracingProject }` |
| `GET /providers` | — | every registry entry with `configured`, resolved models, and where to get a key |
| `GET /metrics` | — | pipeline stage latencies and counters, Prometheus text exposition |
| `GET /admin/observability` | — | the same numbers as JSON, plus LangSmith tracing status |

`sessionId` and `slotPatch` are both optional and additive: a client that sends neither
behaves exactly as it did before the plan existed.

## Observability: LangSmith tracing + pipeline metrics

Set `LANGSMITH_API_KEY` (smith.langchain.com → Settings → API Keys) and every chat
turn becomes one LangSmith trace: a root `chat_turn` run whose children are the
pipeline stages by name — `nlq.parse`, `plan.merge`, `retrieve`, `policy.retrieve`,
`rerank`, `llm.generate` — each carrying its real inputs and outputs: the parse
source and confidence, the plan line and the slots the turn moved, the retrieval
mode and any widened constraints, the rerank order with scores and reasons, the
full prompt and reply, and which provider actually served the generation. A bad
answer is walked back to the stage that caused it in the LangSmith UI instead of
being reconstructed from logs.

```
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=traveliq-assistant                      # optional, the default
# LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com   # EU / self-hosted
```

No SDK is installed for this (the zero-new-dependency rule): `app/tracing.py`
posts to LangSmith's `/runs/batch` REST ingest endpoint through httpx, which
already ships as the openai package's transport. Uploads are fire-and-forget
after the response, so tracing never adds latency to a turn; an upload failure is
logged once and never surfaces to a traveller; no key means nothing leaves the
process. Client disconnects are traced too — the run that was in flight when the
browser went away is marked, which makes a spike of abandonments diagnosable.

Alongside the traces, `app/metrics.py` keeps in-process counters and per-stage
latency distributions (count/errors/avg/p50/p95/max), under the same stage names
the traces use, readable two ways:

- `GET /admin/observability` — JSON for humans and the admin UI: tracing status,
  counters (`chat_turns`, `widened_turns`, `zero_result_turns`, `rerank_served`,
  `served_by.groq`, `chat_client_disconnects`, …) and the stage latency table.
- `GET /metrics` — the same numbers in Prometheus text exposition format, so
  Prometheus or a Grafana agent scrapes it with no adapter and no extra package.

`/health` reports `tracing` and `tracingProject` the same way it reports
`rerank`: off is a documented mode, never silently broken.

## Run

Using **uv** (matches the other POCs):

```bash
cd backend
cp .env.example .env          # add one free key, e.g. GROQ_API_KEY
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Or plain **pip / venv**:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add one free key, e.g. GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Health check: `curl localhost:8000/health` · provider status: `curl localhost:8000/providers`.

Startup prints the resolved chain, e.g.:

```
[smartsearch] chat: Groq (llama-3.3-70b-versatile); fallback: gemini, openai
[smartsearch] embedded 24 products + policies via Google Gemini (gemini-embedding-001)
```

> With no key at all the server still starts: `/search` works via the lexical
> fallback, and `/chat` returns a friendly "not configured" message instead of
> calling a model.

## Point the frontend at it

From the repo root:

```bash
mv src/mock/api.real.ts src/mock/api.ts      # swap mock -> real (same `api` shape)
echo 'VITE_API_URL=http://localhost:8000' > .env.local
npm run dev
```

No component changes are required — the UI only ever imports `{ api }` from
`src/mock/api.ts`.

## Try it without the frontend

```bash
curl -s localhost:8000/search -H 'content-type: application/json' \
  -d '{"query":"waterproof jacket under $100 for hiking"}' | jq

curl -N localhost:8000/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"What is good for rainy hikes?"}]}'
```
