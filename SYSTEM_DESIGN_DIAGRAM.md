# Smart-Search System Design — Full Structure Diagram

> **Project**: Smart-Search (ShopSense semantic search POC + TravelIQ reference)
> **Date**: July 31, 2026
> **Stack**: Python/FastAPI backend, React/TypeScript frontend, PostgreSQL + pgvector

---

## 1. High-Level Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Landing    │  │   Search     │  │   Assistant  │  │   Discover   │    │
│  │    Page      │  │    Page      │  │    Page      │  │    Page      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Trip       │  │   Admin      │  │   Inspiration│  │   NotFound   │    │
│  │   Detail     │  │    Panel     │  │    Page      │  │    Page      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │  HTTP/REST (JSON)
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY / LOAD BALANCER                       │
│                          (Uvicorn / Gunicorn)                               │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND APPLICATION LAYER                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     FastAPI Application (main.py)                   │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │   │
│  │  │  Search      │  │  Chat        │  │  Admin       │  │  Content │ │   │
│  │  │  Router      │  │  Router      │  │  Router      │  │  Router  │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │   │
│  │  ┌──────────────┐  ┌──────────────┐                                │   │
│  │  │  Analytics   │  │  Ingest      │                                │   │
│  │  │  Router      │  │  Router      │                                │   │
│  │  └──────────────┘  └──────────────┘                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVICE & DATA LAYER                                │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Catalog     │  │  RAG Engine  │  │  NLQ Parser  │  │  Chat Engine │    │
│  │  Service     │  │  (rag.py)    │  │  (nlq.py)    │  │  (chat.py)   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  LLM / Chat  │  │  Embedding   │  │  Repository  │  │  Database    │    │
│  │  Provider    │  │  Provider    │  │  (repo.py)   │  │  (db.py)     │    │
│  │  (llm.py)    │  │  (embed.py)  │  │              │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA & MODEL LAYER                                    │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ PostgreSQL   │  │  pgvector    │  │  LLM Model   │  │  Embedding   │    │
│  │  (Catalog)   │  │  (Vector    │  │  (OpenAI /   │  │  (OpenAI /   │    │
│  │  Tables      │  │   Store)    │  │   Claude)    │  │   Sentence   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  │  Transformers)│    │
│                                                         └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Architecture (FastAPI)

```
backend/app/
├── main.py                  # FastAPI app factory, middleware, CORS, exception handlers
├── config.py                # Pydantic settings (env vars, API keys, timeouts, cache sizes)
├── db.py                    # SQLAlchemy engine, session factory, base declarative
├── models.py                # SQLAlchemy ORM models (Trip, TripVariant, TripImage, Tag, ...)
├── schemas.py               # Pydantic schemas (ParsedQuery, SearchResult, ChatRequest, ...)
├── repository.py            # Data access layer (queries, filters, pagination, vector search)
├── catalog.py               # Catalog service (trip filtering, scoring, facet computation)
├── rag.py                   # RAG engine (retrieval-augmented generation, context building)
├── nlq.py                   # Natural Language Query parser (AI layer + heuristic fallback)
├── chat.py                  # Chat engine (conversation state, message history, citations)
├── ingest.py                # Data ingestion pipeline (load, embed, index trips)
├── seed.py                  # Seed data loader (mock/seed trips for development)
├── llm.py                   # LLM abstraction layer (streaming chat, embedding providers)
├── embed.py                 # Embedding provider abstraction (OpenAI, SentenceTransformers)
│
├── routers/
│   ├── __init__.py
│   ├── search.py            # GET /search — keyword + vector + NLQ search endpoint
│   ├── chat.py              # POST /chat — assistant conversation endpoint
│   ├── admin.py             # GET/POST /admin — catalog management, synonyms, health
│   ├── analytics.py         # GET /analytics — search logs, query stats, popular filters
│   ├── content.py           # GET /content — static content, promotions, featured trips
│   └── ingest.py            # POST /ingest — trigger data ingestion pipeline
│
├── sql/
│   ├── schema.sql           # Database schema DDL (tables, columns, constraints)
│   └── indexes.sql          # Performance indexes (vector, text search, foreign keys)
```

### Backend Data Flow

```
User Request
    │
    ▼
┌─────────────────────────────────────┐
│  Router (search.py / chat.py etc.)  │
│  ┌─────────────────────────────┐    │
│  │  Parse & Validate Request   │    │
│  │  (Pydantic schemas)         │    │
│  └─────────────────────────────┘    │
    │
    ▼
┌─────────────────────────────────────┐
│  Service Layer                       │
│  ┌─────────────────────────────┐    │
│  │  catalog.py                 │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Apply Filters       │   │    │
│  │  │ (destination, dates, │   │    │
│  │  │  price, themes, ...) │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Compute Facets      │   │    │
│  │  │ (available filters) │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Score & Rank        │   │    │
│  │  │ (relevance, price,  │   │    │
│  │  │  ratings, ...)       │   │    │
│  │  └─────────────────────┘   │    │
│  └─────────────────────────────┘    │
│                                      │
│  ┌─────────────────────────────┐    │
│  │  nlq.py                     │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Cache Lookup        │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌──────────┬──────────┐  │    │
│  │  │  AI Layer │ Heuristic│  │    │
│  │  │ (LLM)     │ (Regex)  │  │    │
│  │  └──────────┴──────────┘  │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ ParsedQuery         │   │    │
│  │  │ (structured filters)│   │    │
│  │  └─────────────────────┘   │    │
│  └─────────────────────────────┘    │
│                                      │
│  ┌─────────────────────────────┐    │
│  │  rag.py                     │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Retrieve Context    │   │    │
│  │  │ (vector search)     │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Build LLM Prompt    │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Stream Response     │   │    │
│  │  └─────────────────────┘   │    │
│  └─────────────────────────────┘    │
│                                      │
│  ┌─────────────────────────────┐    │
│  │  chat.py                    │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Conversation State    │   │    │
│  │  │ (per session)        │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Manage Citations    │   │    │
│  │  └─────────────────────┘   │    │
│  └─────────────────────────────┘    │
    │
    ▼
┌─────────────────────────────────────┐
│  Repository Layer (repository.py)   │
│  ┌─────────────────────────────┐    │
│  │  SQLAlchemy Queries         │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ SQL Filters         │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Vector Similarity   │   │    │
│  │  │ (pgvector)          │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Pagination          │   │    │
│  │  └─────────────────────┘   │    │
│  └─────────────────────────────┘    │
    │
    ▼
┌─────────────────────────────────────┐
│  Data Layer                        │
│  ┌─────────────────────────────┐    │
│  │  PostgreSQL + pgvector      │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Trip Tables          │   │    │
│  │  │ (trips, variants,    │   │    │
│  │  │  images, tags)       │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Vector Embeddings    │   │    │
│  │  │ (trip_embeddings)    │   │    │
│  │  └─────────────────────┘   │    │
│  │  ┌─────────────────────┐   │    │
│  │  │ Search Logs          │   │    │
│  │  │ (analytics)          │   │    │
│  │  └─────────────────────┘   │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
    │
    ▼
Response (JSON)
```

---

## 3. Database Schema & Model Relationships

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                 │
│                        (PostgreSQL + pgvector)                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│     trips        │      │  trip_variants   │      │    trip_images   │
├──────────────────┤      ├──────────────────┤      ├──────────────────┤
│ id (PK)          │◄────►│ trip_id (FK)     │      │ trip_id (FK)     │
│ title            │      │ id (PK)          │      │ id (PK)          │
│ slug             │      │ variant_name     │      │ url              │
│ description      │      │ price            │      │ alt_text         │
│ destination      │      │ currency         │      │ position         │
│ duration_days    │      │ departure_months │      └──────────────────┘
│ departure_date   │      │ group_size_max   │
│ min_price        │      │ inclusions       │
│ max_price        │      │ exclusions       │
│ rating           │      │ itinerary        │
│ review_count     │      │ accommodation    │
│ operator_name    │      │ transport        │
│ operator_rating  │      │ activities       │
│ highlights       │      │ themes           │
│ full_description │      │ tags             │
│ embedding        │      │ embedding        │
│ created_at       │      │ created_at       │
│ updated_at       │      │ updated_at       │
└──────────────────┘      └──────────────────┘

┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│      tags        │      │ trip_tags        │      │  search_logs     │
├──────────────────┤      ├──────────────────┤      ├──────────────────┤
│ id (PK)          │      │ trip_id (FK)     │      │ id (PK)          │
│ name             │      │ tag_id (FK)      │      │ query_text       │
│ category         │      └──────────────────┘      │ parsed_query     │
│ created_at       │                                │ result_count     │
└──────────────────┘                                │ response_time_ms │
                                                    │ user_session     │
┌──────────────────┐                                │ created_at       │
│  synonyms        │                                └──────────────────┘
├──────────────────┤
│ id (PK)          │
│ term             │
│ synonym          │
│ created_at       │
└──────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Vector Embeddings (pgvector)                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  trip_embeddings table                                             │   │
│  │  ┌────────────┬─────────────────────────────────────────────────┐  │   │
│  │  │ trip_id    │ embedding (vector<1536>)                        │  │   │
│  │  │ (FK)       │ (OpenAI text-embedding-3-small)               │  │   │
│  │  └────────────┴─────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │  Similarity Search:                                                │   │
│  │  SELECT * FROM trips ORDER BY embedding <=> query_vector LIMIT 10  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Model Types (SQLAlchemy ORM → Pydantic Schemas)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MODEL / SCHEMA MAPPING                             │
└─────────────────────────────────────────────────────────────────────────────┘

SQLAlchemy Models (models.py)              Pydantic Schemas (schemas.py)
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│  Trip                            │─────►│  TripRead / TripDetail           │
│  ├── id: UUID                    │      │  ├── id: UUID                    │
│  ├── title: str                  │      │  ├── title: str                  │
│  ├── destination: str            │      │  ├── destination: str            │
│  ├── duration_days: int          │      │  ├── duration_days: int          │
│  ├── min_price / max_price       │      │  ├── min_price / max_price       │
│  ├── rating: float               │      │  ├── rating: float               │
│  ├── embedding: Vector           │      │  └── (no embedding)              │
│  └── ...                          │      │                                   │
│                                    │      │  TripVariantRead                 │
│  TripVariant                      │─────►│  ├── variant_name: str            │
│  ├── price: float                │      │  ├── price: float                │
│  ├── departure_months: list[int] │      │  ├── departure_months: list[int] │
│  ├── inclusions: list[str]       │      │  ├── inclusions: list[str]       │
│  └── ...                          │      │  └── ...                          │
│                                    │      │                                   │
│  TripImage                        │─────►│  TripImageRead                   │
│  ├── url: str                    │      │  ├── url: str                    │
│  ├── alt_text: str               │      │  ├── alt_text: str               │
│  └── ...                          │      │  └── ...                          │
│                                    │      │                                   │
│  Tag                              │─────►│  TagRead                         │
│  ├── name: str                   │      │  ├── name: str                   │
│  ├── category: str               │      │  ├── category: str               │
│  └── ...                          │      │  └── ...                          │
│                                    │      │                                   │
│  Synonym                          │─────►│  SynonymRead                     │
│  ├── term: str                   │      │  ├── term: str                   │
│  ├── synonym: str                │      │  ├── synonym: str                │
│  └── ...                          │      │  └── ...                          │
│                                    │      │                                   │
│  SearchLog                        │─────►│  (internal only)                  │
└──────────────────────────────────┘      └──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  NLQ ParsedQuery Schema (schemas.py)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ParsedQuery                                                                 │
│  ├── source: Literal["ai", "heuristic"]                                    │
│  ├── confidence: float (0.0 - 0.97)                                        │
│  ├── destination: Optional[str]                                            │
│  ├── months: list[int]                                                     │
│  ├── durationDays: Optional[int]                                           │
│  ├── maxPrice: Optional[float]                                             │
│  ├── themes: list[str]                                                     │
│  ├── activities: list[str]                                                 │
│  ├── audience: list[str]                                                   │
│  ├── climate: Optional[str]                                                │
│  ├── groupSizeMax: Optional[int]                                           │
│  └── directFlights: Optional[bool]                                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Search & Chat Request/Response Schemas                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  SearchRequest                                                               │
│  ├── query: str                                                            │
│  ├── filters: Optional[dict]                                               │
│  ├── limit: int                                                            │
│  └── offset: int                                                           │
│                                                                            │
│  SearchResponse                                                            │
│  ├── results: list[TripRead]                                              │
│  ├── facets: dict[str, list]                                              │
│  ├── total: int                                                           │
│  ├── parsed_query: Optional[ParsedQuery]                                  │
│  └── took_ms: int                                                         │
│                                                                            │
│  ChatRequest                                                               │
│  ├── message: str                                                        │
│  ├── session_id: str                                                      │
│  └── context: Optional[dict]                                              │
│                                                                            │
│  ChatResponse                                                              │
│  ├── response: str                                                        │
│  ├── citations: list[Citation]                                            │
│  ├── session_id: str                                                      │
│  └── done: bool                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Vector Store & Embedding Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VECTOR STORE & EMBEDDING ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Source Data     │
│  ┌─────────────┐ │
│  │ Trip Title  │ │
│  │ Description │ │
│  │ Highlights  │ │
│  │ Full Text   │ │
│  └─────────────┘ │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Embedding       │
│  Provider        │
│  ┌─────────────┐ │
│  │ OpenAI      │ │
│  │ text-embed- │ │
│  │ ding-3-small│ │
│  │ (1536 dim)  │ │
│  └─────────────┘ │
│  ┌─────────────┐ │
│  │ Sentence    │ │
│  │ Transformers│ │
│  │ (fallback)  │ │
│  └─────────────┘ │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Vector Storage  │
│  (pgvector)      │
│  ┌─────────────┐ │
│  │ trip_em-    │ │
│  │ beddings    │ │
│  │ table       │ │
│  │             │ │
│  │ trip_id →   │ │
│  │ vector      │ │
│  └─────────────┘ │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Similarity      │
│  Search          │
│  ┌─────────────┐ │
│  │ Cosine      │ │
│  │ Distance    │ │
│  │ (L2 / Inner │ │
│  │  Product)   │ │
│  └─────────────┘ │
│  ┌─────────────┐ │
│  │ HNSW Index  │ │
│  │ (optional)  │ │
│  └─────────────┘ │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Search Results  │
│  ┌─────────────┐ │
│  │ Ranked by   │ │
│  │ similarity  │ │
│  │ score       │ │
│  └─────────────┘ │
└──────────────────┘
```

### LLM & Model Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LLM / MODEL ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  LLM Provider Abstraction (llm.py)                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐         │
│  │  OpenAI Provider            │  │  Anthropic Provider         │         │
│  │                             │  │                             │         │
│  │  Model: gpt-4o              │  │  Model: claude-3-5-sonnet   │         │
│  │  Model: gpt-3.5-turbo       │  │  Model: claude-3-5-haiku    │         │
│  │                             │  │                             │         │
│  │  Use: Chat, NLQ parsing     │  │  Use: Chat, NLQ parsing     │         │
│  └─────────────────────────────┘  └─────────────────────────────┘         │
│                                                                             │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐         │
│  │  Ollama Provider          │  │  Local Provider             │         │
│  │                             │  │                             │         │
│  │  Model: llama3, phi3       │  │  Model: (custom)            │         │
│  │                             │  │                             │         │
│  │  Use: Development only      │  │  Use: Custom deployment     │         │
│  └─────────────────────────────┘  └─────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Embedding Provider Abstraction (embed.py)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐         │
│  │  OpenAI Embeddings        │  │  Sentence Transformers      │         │
│  │                             │  │                             │         │
│  │  Model: text-embedding-     │  │  Model: all-MiniLM-L6-v2   │         │
│  │  3-small (1536 dim)         │  │  Model: all-mpnet-base-v2   │         │
│  │                             │  │                             │         │
│  │  Use: Production embeddings │  │  Use: Offline/fallback      │         │
│  └─────────────────────────────┘  └─────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Model Usage Matrix                                                        │
├──────────────────┬──────────────────┬──────────────────┬──────────────────┤
│  Component       │  Primary Model   │  Fallback Model  │  Local Only?     │
├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
│  NLQ Parsing     │  GPT-4o / Claude │  Heuristic Regex │  Yes (fallback)  │
│  Chat Assistant  │  GPT-4o / Claude │  Heuristic      │  No               │
│  Embeddings      │  text-embed-3-s  │  Sentence-BERT  │  Yes (fallback)  │
│  RAG Retrieval   │  Vector Sim.     │  Keyword Search │  Yes             │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

---

## 5. Frontend Architecture (React/TypeScript)

```
src/
├── App.tsx                    # Main app component, routing, theme provider
├── index.css                  # Global styles (Tailwind + custom CSS)
├── types.ts                   # All TypeScript interfaces (Trip, Variant, Filters, etc.)
│
├── lib/
│   ├── api.ts                 # Axios HTTP client with interceptors, typed endpoints
│   ├── format.ts              # Formatting utilities (currency, dates, durations)
│   ├── meta.ts                # SEO metadata helpers
│   └── utils.ts               # General utilities (classnames, date helpers)
│
├── mock/
│   ├── catalog.ts             # Mock trip catalog data
│   ├── policies.ts            # Mock travel policies
│   ├── guides.ts              # Mock inspiration guides
│   ├── places.ts              # Mock place/destination data
│   └── admin.ts               # Mock admin data
│
├── pages/
│   ├── Landing.tsx            # Homepage with hero, featured, how-it-works
│   ├── Search.tsx             # Search results page with filters & facets
│   ├── Assistant.tsx          # AI chat assistant page
│   ├── Discover.tsx           # Destination/discovery map & browsing
│   ├── Inspiration.tsx        # Guide/inspiration content
│   ├── TripDetail.tsx         # Individual trip detail page
│   ├── Admin.tsx              # Admin panel (catalog, analytics, synonyms)
│   └── NotFound.tsx           # 404 page
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx       # Main layout wrapper
│   │   ├── BottomTabs.tsx     # Mobile bottom navigation
│   │   ├── SideRail.tsx       # Desktop sidebar navigation
│   │   └── SiteFooter.tsx     # Footer component
│   │
│   ├── ui/
│   │   ├── badge.tsx          # Badge component
│   │   ├── button.tsx         # Button component
│   │   ├── card.tsx           # Card component
│   │   ├── chip.tsx           # Chip/tag component
│   │   ├── empty.tsx          # Empty state component
│   │   ├── input.tsx          # Input field
│   │   ├── select.tsx         # Select dropdown
│   │   ├── sheet.tsx          # Slide-over panel
│   │   ├── skeleton.tsx       # Loading skeleton
│   │   ├── slider.tsx         # Range slider
│   │   ├── stars.tsx          # Star rating display
│   │   ├── switch.tsx         # Toggle switch
│   │   └── tabs.tsx           # Tabs component
│   │
│   ├── search/
│   │   ├── SearchBar.tsx      # Search input with NLQ support
│   │   ├── FacetRail.tsx      # Filter facets sidebar
│   │   ├── ResultGrid.tsx     # Results grid layout
│   │   ├── ResultCard.tsx     # Individual result card
│   │   ├── SortSelect.tsx     # Sort options dropdown
│   │   ├── Pagination.tsx     # Pagination controls
│   │   ├── ParsedChips.tsx    # Parsed filter chips display
│   │   ├── ZeroResults.tsx    # No results state
│   │   └── constraints.ts     # Search constraint types
│   │
│   ├── chat/
│   │   ├── Composer.tsx       # Chat input composer
│   │   ├── ChatBubble.tsx     # Message bubble component
│   │   ├── CitationPills.tsx  # Source citation display
│   │   ├── ModelPill.tsx      # LLM model indicator
│   │   ├── ParsedSummary.tsx  # Parsed query summary
│   │   ├── DiscoveryRails.tsx # Suggested discovery rails
│   │   ├── InlineTripCard.tsx # Inline trip card in chat
│   │   ├── SuggestedPrompts.tsx # Quick prompt suggestions
│   │   └── parsedFilters.ts   # Filter parsing utilities
│   │
│   ├── discover/
│   │   ├── MapPanel.tsx       # Interactive map
│   │   ├── PlaceCard.tsx      # Place/destination card
│   │   ├── PlaceRail.tsx      # Horizontal place rail
│   │   ├── PlaceSheet.tsx     # Place detail sheet
│   │   └── LocationField.tsx  # Location search field
│   │
│   ├── trip/
│   │   ├── TripHeader.tsx     # Trip header section
│   │   ├── TripGallery.tsx    # Image gallery
│   │   ├── TripItinerary.tsx  # Itinerary display
│   │   ├── TripPractical.tsx  # Practical info section
│   │   ├── TripIncluded.tsx   # Inclusions/exclusions
│   │   ├── BookingBar.tsx     # Booking CTA bar
│   │   ├── BookingPanel.tsx   # Booking form panel
│   │   ├── SimilarTrips.tsx   # Similar trips carousel
│   │   └── structuredData.ts  # Structured data helpers
│   │
│   ├── inspiration/
│   │   ├── GuideCard.tsx      # Guide/article card
│   │   ├── GuideFilterSheet.tsx # Guide filter panel
│   │   ├── GuideTagRow.tsx    # Tag filter row
│   │   ├── TagToggle.tsx      # Tag toggle button
│   │   └── guideFilters.ts    # Filter logic
│   │
│   ├── landing/
│   │   ├── Hero.tsx           # Hero section
│   │   ├── FeaturedIn.tsx     # Press/features section
│   │   ├── HowItWorks.tsx     # How it works section
│   │   ├── ItineraryCard.tsx  # Featured itinerary card
│   │   ├── LandingNav.tsx     # Landing navigation
│   │   ├── PopularItineraries.tsx # Popular trips rail
│   │   └── PocCoverage.tsx    # POC coverage section
│   │
│   └── admin/
│       ├── AdminSection.tsx   # Admin section wrapper
│       ├── AnalyticsPanel.tsx # Analytics dashboard
│       ├── PromotionBoard.tsx # Promotion management
│       ├── ReviewQueue.tsx    # Content review queue
│       ├── SearchSetup.tsx    # Search configuration
│       ├── SynonymTable.tsx   # Synonym management table
│       ├── TabPanel.tsx       # Tab panel component
│       ├── TimelineChart.tsx  # Analytics timeline chart
│       ├── SourceHealth.tsx   # Data source health
│       └── relativeTime.ts    # Relative time formatting
│
└── components/ (legacy - deleted)
    ├── ChatMessageBubble.tsx  # [DELETED]
    ├── ChatView.tsx           # [DELETED]
    ├── EmptyState.tsx         # [DELETED]
    ├── FilterRow.tsx          # [DELETED]
    ├── ProductCard.tsx        # [DELETED]
    ├── ProductGrid.tsx        # [DELETED]
    ├── RelevanceChip.tsx      # [DELETED]
    ├── SearchView.tsx         # [DELETED]
    ├── SkeletonCard.tsx       # [DELETED]
    ├── SlideOver.tsx          # [DELETED]
    ├── StarRating.tsx         # [DELETED]
    └── TopBar.tsx             # [DELETED]
```

### Frontend Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND COMPONENT HIERARCHY                              │
└─────────────────────────────────────────────────────────────────────────────┘

App.tsx
├── Router (React Router v6)
│   ├── /
│   │   └── Landing.tsx
│   │       ├── LandingNav.tsx
│   │       ├── Hero.tsx
│   │       ├── FeaturedIn.tsx
│   │       ├── HowItWorks.tsx
│   │       ├── PopularItineraries.tsx
│   │       │   └── ItineraryCard.tsx
│   │       └── PocCoverage.tsx
│   │
│   ├── /search
│   │   └── Search.tsx
│   │       ├── SearchBar.tsx
│   │       │   └── ParsedChips.tsx
│   │       ├── FacetRail.tsx
│   │       ├── SortSelect.tsx
│   │       ├── ResultGrid.tsx
│   │       │   └── ResultCard.tsx
│   │       ├── Pagination.tsx
│   │       └── ZeroResults.tsx
│   │
│   ├── /assistant
│   │   └── Assistant.tsx
│   │       ├── ChatBubble.tsx (list)
│   │       │   ├── CitationPills.tsx
│   │       │   ├── ParsedSummary.tsx
│   │       │   ├── ModelPill.tsx
│   │       │   └── InlineTripCard.tsx
│   │       ├── SuggestedPrompts.tsx
│   │       └── Composer.tsx
│   │
│   ├── /discover
│   │   └── Discover.tsx
│   │       ├── LocationField.tsx
│   │       ├── MapPanel.tsx
│   │       ├── PlaceRail.tsx
│   │       │   └── PlaceCard.tsx
│   │       └── PlaceSheet.tsx
│   │
│   ├── /inspiration
│   │   └── Inspiration.tsx
│   │       ├── GuideFilterSheet.tsx
│   │       │   ├── GuideTagRow.tsx
│   │       │   │   └── TagToggle.tsx
│   │       │   └── GuideCard.tsx
│   │       └── GuideCard.tsx
│   │
│   ├── /trip/:id
│   │   └── TripDetail.tsx
│   │       ├── TripHeader.tsx
│   │       ├── TripGallery.tsx
│   │       ├── TripItinerary.tsx
│   │       ├── TripPractical.tsx
│   │       ├── TripIncluded.tsx
│   │       ├── BookingBar.tsx
│   │       │   └── BookingPanel.tsx
│   │       └── SimilarTrips.tsx
│   │
│   ├── /admin
│   │   └── Admin.tsx
│   │       ├── AdminSection.tsx
│   │       │   ├── AnalyticsPanel.tsx
│   │       │   │   ├── TimelineChart.tsx
│   │     │   │   └── SourceHealth.tsx
│   │       │       ├── PromotionBoard.tsx
│   │       │       ├── ReviewQueue.tsx
│   │       │       ├── SearchSetup.tsx
│   │       │       └── SynonymTable.tsx
│   │       └── TabPanel.tsx
│   │
│   └── *
│       └── NotFound.tsx
│
├── AppShell.tsx (layout)
│   ├── SideRail.tsx (desktop nav)
│   ├── BottomTabs.tsx (mobile nav)
│   └── SiteFooter.tsx
│
└── UI Provider Components
    ├── ThemeProvider
    ├── QueryClientProvider (React Query)
    └── Sheet/Modal providers
```

---

## 6. Data Flow Diagrams

### 6.1 Search Flow (Keyword + Vector + NLQ)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SEARCH DATA FLOW                                         │
└─────────────────────────────────────────────────────────────────────────────┘

User
 │
 │  1. "Northern lights in Iceland under £1500 next winter"
 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: Search.tsx                                                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SearchBar.tsx                                                      │   │
│  │  ┌─────────────────────────────┐                                     │   │
│  │  │  User types query           │                                     │   │
│  │  └─────────────────────────────┘                                     │   │
│  │  ┌─────────────────────────────┐                                     │   │
│  │  │  Debounced API call         │                                     │   │
│  │  │  → /api/search?query=...    │                                     │   │
│  │  └─────────────────────────────┘                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
 │
 │  HTTP GET /api/search?query=...
 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Backend: routers/search.py                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. Parse query with nlq.py                                        │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Cache Lookup (LRU)                                      │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  AI Layer (LLM) — strict JSON at temp=0                  │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Heuristic Fallback (regex/keyword)                     │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  ParsedQuery (structured filters)                         │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  2. Build search filters                                              │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  destination = "Iceland"                                 │  │   │
│  │  │  │  months = [11, 12, 1, 2, 3]                              │  │   │
│  │  │  │  maxPrice = 1500                                         │  │   │
│  │  │  │  themes = ["Northern Lights"]                            │  │   │
│  │  │  │  climate = "cold"                                        │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  3. Execute search via repository.py                                 │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  SQL Filters (WHERE clauses)                             │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Vector Similarity (pgvector)                            │  │   │
│  │  │  │  ORDER BY embedding <=> query_vector                    │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Combine: keyword + vector + NLQ                         │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Paginate (LIMIT/OFFSET)                                 │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  4. Compute facets via catalog.py                                  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Available destinations, price ranges, themes, etc.      │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  5. Score & rank results                                             │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Relevance score (text match + vector sim)               │  │   │
│  │  │  │  Price tier, rating, popularity                          │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  6. Return JSON response                                             │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  {results: [...], facets: {...}, total: N,              │  │   │
│  │  │  │   parsed_query: {...}, took_ms: N}                       │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
 │
 │  HTTP 200 OK (JSON)
 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: ResultGrid.tsx + FacetRail.tsx                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Display results in grid                                            │   │
│  │  Show facets in sidebar                                             │   │
│  │  Show parsed query chips                                            │   │
│  │  Show pagination controls                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Chat/Assistant Flow (RAG)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CHAT / RAG DATA FLOW                                     │
└─────────────────────────────────────────────────────────────────────────────┘

User
 │
 │  1. "What's the best trip for a family in December?"
 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: Assistant.tsx                                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Composer.tsx                                                       │   │
│  │  ┌─────────────────────────────┐                                     │   │
│  │  │  User types message         │                                     │   │
│  │  └─────────────────────────────┘                                     │   │
│  │  ┌─────────────────────────────┐                                     │   │
│  │  │  POST /api/chat             │                                     │   │
│  │  │  {message, session_id}      │                                     │   │
│  │  └─────────────────────────────┘                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
 │
 │  HTTP POST /api/chat
 │  {message: "...", session_id: "abc123"}
 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Backend: routers/chat.py                                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. Load conversation history                                       │   │
│  │  │  (from session store / database)                                │   │
│  │  └──────────────────────────────────────────────────────────────────┘   │
│  │                                                                         │   │
│  │  2. Parse user intent with nlq.py                                     │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  ParsedQuery (destination, months, audience, ...)         │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  3. Retrieve relevant trips via rag.py                                │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  a) Generate embedding for query                         │  │   │
│  │  │  │     → embed.py → OpenAI/SentenceTransformers            │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  b) Vector similarity search in pgvector                 │  │   │
│  │  │  │     → ORDER BY embedding <=> query_vector               │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  c) Apply NLQ filters (destination, months, ...)         │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  d) Rank by similarity + relevance score                 │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │  └────────────────────────────────────────────────────────────────┘   │
│  │                                                                         │   │
│  │  4. Build LLM prompt via rag.py                                       │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  System prompt + conversation history +                  │  │   │
│  │  │  │  retrieved context (trip data)                           │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  5. Stream response from LLM via llm.py                               │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  OpenAI / Anthropic streaming API                        │  │   │
│  │  │  │  → token-by-token response                               │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  6. Extract citations via chat.py                                     │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Map response text to source trips                       │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  7. Save conversation to history                                    │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  Store in database or session store                        │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                                                                         │   │
│  │  8. Return streaming JSON response                                  │   │
│  │  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  │  {response: "...", citations: [...], session_id: "..."}   │  │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
 │
 │  HTTP 200 (streaming JSON)
 │  {response: "...", citations: [...]}
 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: ChatBubble.tsx                                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Stream response tokens                                             │   │
│  │  Display citations as pills                                         │   │
│  │  Render inline trip cards                                           │   │
│  │  Show model indicator (GPT-4o, Claude, etc.)                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Full System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FULL SYSTEM FLOW (Request → Response)                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         USER INTERACTION                            │   │
│  │                                                                     │   │
│  │  Landing Page → Search → Assistant → Discover → Trip Detail        │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      FRONTEND (React/TS)                            │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │  Pages       │  │  Components   │  │  lib/api.ts  │              │   │
│  │  │  (Routes)    │  │  (UI Tree)   │  │  (Axios)     │              │   │
│  │  └──────────────┘  └──────────────┘  └──────┬───────┘              │   │
│  │                                               │                      │   │
│  └───────────────────────────────────────────────┼──────────────────────┘   │
└─────────────────────────────────────────────┬─────┴──────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      BACKEND (FastAPI)                             │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Routers                                                      │   │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │   │
│  │  │  │ /search      │  │ /chat        │  │ /admin       │       │   │   │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘       │   │   │
│  │  │  ┌──────────────┐  ┌──────────────┐                           │   │   │
│  │  │  │ /analytics   │  │ /ingest      │                           │   │   │
│  │  │  └──────────────┘  └──────────────┘                           │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Services                                                     │   │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │   │
│  │  │  │ catalog.py   │  │ rag.py       │  │ nlq.py       │       │   │   │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘       │   │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │   │
│  │  │  │ chat.py      │  │ llm.py       │  │ embed.py     │       │   │   │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘       │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Data Access                                                  │   │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │   │
│  │  │  │ repository   │  │ db.py        │  │ models.py    │       │   │   │
│  │  │  │ .py          │  │              │  │              │       │   │   │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘       │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      DATA & MODELS                                  │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │   │
│  │  │ PostgreSQL   │  │ pgvector     │  │ LLM Provider │  │ Embedding│ │   │
│  │  │ (trips,      │  │ (embeddings) │  │ (OpenAI/     │  │ Provider │ │   │
│  │  │  variants,   │  │              │  │  Anthropic)  │  │ (OpenAI/ │ │   │
│  │  │  tags, etc.) │  │              │  │              │  │  SBERT)  │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      RESPONSE FLOW                                  │   │
│  │                                                                     │   │
│  │  Data → Repository → Service → Router → Frontend → User           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. External Integrations & Services

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL INTEGRATIONS & SERVICES                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  LLM / AI Services                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  OpenAI API                                                   │   │   │
│  │  │  • GPT-4o (chat)                                              │   │   │
│  │  │  • text-embedding-3-small (embeddings)                        │   │   │
│  │  │  • gpt-3.5-turbo (fallback)                                   │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Anthropic API                                                │   │   │
│  │  │  • Claude-3-5-sonnet (chat)                                   │   │   │
│  │  │  • Claude-3-5-haiku (lightweight chat)                       │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Ollama (local)                                              │   │   │
│  │  │  • llama3, phi3                                              │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Embedding Services                                                 │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  OpenAI Embeddings                                          │   │   │
│  │  │  • text-embedding-3-small (1536 dim)                        │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Sentence Transformers (offline)                           │   │   │
│  │  │  • all-MiniLM-L6-v2                                        │   │   │
│  │  │  • all-mpnet-base-v2                                       │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Database                                                           │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  PostgreSQL                                                 │   │   │
│  │  │  • trips table                                              │   │   │
│  │  │  • trip_variants table                                      │   │   │
│  │  │  • trip_images table                                        │   │   │
│  │  │  • tags table                                               │   │   │
│  │  │  • synonyms table                                           │   │   │
│  │  │  • search_logs table                                        │   │   │
│  │  │  • trip_embeddings (pgvector)                               │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Frontend Build & Deployment                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Vite (build tool)                                           │   │   │
│  │  │  • TypeScript compilation                                    │   │   │
│  │  │  • Tailwind CSS                                              │   │   │
│  │  │  • React optimization                                        │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  React Query (data fetching)                                 │   │   │
│  │  │  • Cache management                                        │   │   │
│  │  │  • Background refetch                                      │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Configuration & Environment

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONFIGURATION & ENVIRONMENT                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Backend Configuration (config.py)                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Database Settings                                                  │   │
│  │  • DATABASE_URL (PostgreSQL connection string)                      │   │
│  │  • DB_POOL_SIZE, DB_MAX_OVERFLOW                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  LLM Settings                                                   │ │   │
│  │  │  • OPENAI_API_KEY                                             │   │   │
│  │  │  • ANTHROPIC_API_KEY                                          │   │   │
│  │  │  • DEFAULT_MODEL (gpt-4o, claude-3-5-sonnet)                  │   │   │
│  │  │  • EMBEDDING_MODEL (text-embedding-3-small)                   │   │   │
│  │  │  • NLQ_TIMEOUT (default: 5.0s)                                │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Cache Settings                                                 │ │   │
│  │  │  • NLQ_CACHE_SIZE (default: 256)                                │   │   │
│  │  │  • CACHE_TTL (default: 3600s)                                 │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Search Settings                                                │ │   │
│  │  │  • DEFAULT_RESULTS_PER_PAGE (default: 20)                     │   │   │
│  │  │  • MAX_RESULTS_PER_PAGE (default: 100)                        │   │   │
│  │  │  • VECTOR_SIMILARITY_THRESHOLD (default: 0.7)                 │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  CORS & Security                                                │ │   │
│  │  │  • ALLOWED_ORIGINS (frontend URLs)                            │   │   │
│  │  │  • API_KEY_HEADER                                             │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend Configuration                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Environment Variables (.env)                                        │   │
│  │  • VITE_API_BASE_URL (backend API endpoint)                        │   │
│  │  • VITE_APP_NAME                                                   │   │
│  │  • VITE_DEFAULT_PAGE_SIZE                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Vite Config (vite.config.ts)                                   │ │   │
│  │  │  • Server proxy for /api                                       │   │   │
│  │  │  • Build optimization                                        │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Tailwind Config (tailwind.config.js)                           │ │   │
│  │  │  • Custom color palette                                        │   │   │
│  │  │  • Breakpoint settings                                       │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Deployment & Infrastructure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT & INFRASTRUCTURE                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Deployment Architecture                                            │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │  Frontend    │  │  Backend     │  │  Database    │              │   │
│  │  │  (Static)    │  │  (FastAPI)   │  │  (Postgres)  │              │   │
│  │  │             │  │             │  │             │              │   │
│  │  │  • Vite      │  │  • Uvicorn   │  │  • PostgreSQL  │              │   │
│  │  │  • S3/CDN   │  │  • Gunicorn  │  │  • pgvector   │              │   │
│  │  │  • SPA       │  │  • Docker     │  │  • Backups    │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │  Load        │  │  Reverse     │  │  External    │              │   │
│  │  │  Balancer    │  │  Proxy       │  │  Services    │              │   │
│  │  │             │  │             │  │             │              │   │
│  │  │  • AWS ALB  │  │  • Nginx     │  │  • OpenAI API  │              │   │
│  │  │  • CDN      │  │  • SSL/TLS  │  │  • Anthropic   │              │   │
│  │  │             │  │             │  │    API         │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Key Design Decisions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    KEY DESIGN DECISIONS                                     │
└─────────────────────────────────────────────────────────────────────────────┘

1. TWO-LAYER NLQ PARSING
   • AI Layer: LLM-based parsing with strict JSON output (temperature=0)
   • Heuristic Layer: Regex/keyword fallback (no API key needed)
   • LRU cache for repeated queries

2. HYBRID SEARCH
   • Keyword filters (SQL WHERE clauses) for structured fields
   • Vector similarity (pgvector) for semantic matching
   • Combined scoring for final ranking

3. RAG ARCHITECTURE
   • Retrieval: vector similarity + NLQ filters
   • Augmented Generation: LLM with retrieved context
   • Citations: source trip mapping for transparency

4. RESILIENT FALLBACKS
   • LLM → Heuristic (NLQ parsing)
   • OpenAI → Sentence Transformers (embeddings)
   • No single point of failure for search quality

5. FRONTEND ARCHITECTURE
   • Component-based design with shared UI primitives
   • React Query for data fetching and caching
   • Tailwind CSS for styling
   • TypeScript for type safety

6. DATABASE DESIGN
   • PostgreSQL with pgvector extension
   • Normalized schema (trips, variants, images, tags)
   • Vector embeddings stored alongside relational data
   • Search logs for analytics and improvement
```

---

## 12. File Inventory Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FILE INVENTORY SUMMARY                                   │
└─────────────────────────────────────────────────────────────────────────────┘

BACKEND FILES (backend/app/):
┌─────────────────────────────────────────────────────────────────────────────┐
│  Core: main.py, config.py, db.py, models.py, schemas.py, repository.py     │
│  Services: catalog.py, rag.py, nlq.py, chat.py, llm.py, embed.py           │
│  Data: ingest.py, seed.py                                                  │
│  Routers: search.py, chat.py, admin.py, analytics.py, content.py, ingest.py│
│  SQL: schema.sql, indexes.sql                                              │
└─────────────────────────────────────────────────────────────────────────────┘

FRONTEND FILES (src/):
┌─────────────────────────────────────────────────────────────────────────────┐
│  Core: App.tsx, index.css, types.ts                                        │
│  Lib: api.ts, format.ts, meta.ts, utils.ts                                 │
│  Mock: catalog.ts, policies.ts, guides.ts, places.ts, admin.ts            │
│  Pages: Landing.tsx, Search.tsx, Assistant.tsx, Discover.tsx,             │
│         Inspiration.tsx, TripDetail.tsx, Admin.tsx, NotFound.tsx          │
│  Components: 50+ component files across 10 directories                     │
│  UI: 11 base UI primitives (badge, button, card, chip, etc.)               │
└─────────────────────────────────────────────────────────────────────────────┘

DOCUMENTATION (docs/):
┌─────────────────────────────────────────────────────────────────────────────┐
│  architecture.md, design-system.md, doc-review.md,                      │
│  release-notes.md, scope-and-limitations.md, sprint-plan.md             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

This document provides a complete structural overview of the Smart-Search system, covering all layers from user interaction through backend services to data storage and external integrations. The diagrams illustrate data flow, component relationships, model types, and architectural decisions.
