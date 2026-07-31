"""TravelIQ API — the backend the React app in src/ talks to.

Startup is deliberately talkative and deliberately unbreakable. It reports which
LLM providers are wired up, which repository won (Postgres or the in-memory seed
catalogue) and whether the embedding index built — then serves the API either
way. None of those three is a precondition: an unset DATABASE_URL and a missing
embedding key are documented fallbacks (BUILD-CONTRACT section 5), so the POC
runs on a laptop with nothing installed.

Routes live in app/routers/*; this module only wires them together.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, llm
from .config import settings
from .providers import PROVIDERS
from .rag import index
from .repository import init_repo
from .routers import admin, analytics, chat, content, ingest, search
from .schemas import Health, Trip


@dataclass
class _Startup:
    """What the lifespan learned, so /health can answer from it instead of
    re-querying the database on every probe."""

    status: str = "ok"
    db: str = "memory"
    trips: int = 0


_startup = _Startup()


def _say(line: str) -> None:
    """Startup banner. print, not logging: uvicorn attaches handlers to its own
    loggers only, so an INFO record from "traveliq.*" would be swallowed by the
    root logger and the operator would never see which fallback they landed on."""
    print(f"[traveliq] {line}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    unknown = settings.unknown_provider_names()
    if unknown:
        _say(f"ignoring unknown provider name(s) {unknown} — valid: {', '.join(PROVIDERS)}")

    chain = llm.chat_providers()
    if chain:
        primary = chain[0]
        rest = ", ".join(p.name for p in chain[1:]) or "none"
        _say(f"chat: {primary.label} ({primary.chat_model}); fallback: {rest}")
    else:
        _say(f"no LLM key configured — chat disabled ({llm.missing_key_hint()})")

    trips: list[Trip] = []
    try:
        repo = await init_repo()
        trips = await repo.trips()
        _startup.db = repo.kind
        _startup.trips = len(trips)
        if repo.kind == "postgres":
            _say(f"catalogue: postgres, {len(trips)} trips — DATABASE_URL is set and reachable")
        else:
            reason = (
                "postgres is configured but unreachable"
                if settings.db_configured()
                else "DATABASE_URL is not set"
            )
            _say(f"catalogue: in-memory seed, {len(trips)} trips — {reason}")
    except Exception as exc:  # noqa: BLE001 — a broken repository must not stop the API booting
        _startup.status = "degraded"
        _say(f"repository init failed ({exc!r}); /health reports degraded and reads will error")

    try:
        await index.build(trips)
        if index.built and index.embed_provider:
            provider = index.embed_provider
            _say(
                f"embedded {len(trips)} trips + policies via "
                f"{provider.label} ({provider.embed_model})"
            )
        else:
            _say("no embedding provider — search uses the lexical fallback")
    except Exception as exc:  # noqa: BLE001 — a bad key or a network blip is not fatal
        _say(f"index build failed ({exc!r}); using the lexical fallback")

    yield

    await db.dispose()


app = FastAPI(title="TravelIQ API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Order matters: /search and the catalogue reads come before the admin surface so
# a future /admin prefix can never shadow a public path.
app.include_router(search.router)
app.include_router(content.router)
app.include_router(chat.router)
app.include_router(admin.router)
app.include_router(analytics.router)
app.include_router(ingest.router)


@app.get("/health", response_model=Health)
def health() -> Health:
    chain = llm.chat_providers()
    return Health(
        status=_startup.status,
        configured=bool(chain),  # any provider key present
        indexed=index.built,
        trips=_startup.trips,
        db=_startup.db,
        chatProvider=chain[0].name if chain else None,
        chatModel=chain[0].chat_model if chain else None,
        fallbacks=[p.name for p in chain[1:]],
        embedProvider=index.embed_provider.name if index.embed_provider else None,
    )


@app.get("/providers")
def providers():
    """Which providers the registry knows, and which are wired up — handy for
    checking a key landed without restarting into a failing chat."""
    configured = {p.name: p for p in llm.chat_providers()}
    return {
        "chain": list(configured),
        "primary": settings.llm_provider,
        "providers": [
            {
                "name": spec.name,
                "label": spec.label,
                "configured": spec.name in configured,
                "chatModel": settings.chat_model_for(spec.name),
                "embedModel": settings.embed_model_for(spec.name),
                "supportsEmbeddings": bool(settings.embed_model_for(spec.name)),
                "keyEnv": f"{spec.name.upper()}_API_KEY",
                "keyUrl": spec.key_url,
                "freeNote": spec.free_note,
            }
            for spec in PROVIDERS.values()
        ],
    }
