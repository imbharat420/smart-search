# SmartSearch API (FastAPI · RAG)

The real backend behind the SmartSearch frontend's `src/mock/api.ts`. Same request/
response shapes as the mock, so swapping the frontend over is a one-file change.

- **Retrieval**: embeddings over the 24-product catalog + 3 policy docs, ranked by
  cosine similarity. Falls back to lexical (substring + fuzzy) scoring when no
  embedding provider is set — or if the provider fails mid-session.
- **Chat**: retrieves relevant products + a policy, feeds them as grounded context
  to the model, and **streams** the reply token-by-token over SSE, then emits
  the products and citations as separate events.
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

## Contract

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /search` | `{ query, filters?: { category?, maxPrice?, inStockOnly? } }` | `SearchResult[]` |
| `POST /chat` | `{ messages: { role, content }[] }` | `text/event-stream` of `ChatChunk` (`{token}` / `{products}` / `{citations}` / `{done}`) |
| `GET /health` | — | `{ status, configured, indexed, products, chatProvider, chatModel, fallbacks, embedProvider }` |
| `GET /providers` | — | every registry entry with `configured`, resolved models, and where to get a key |

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
