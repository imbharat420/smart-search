"""The admin control panel: search setup, synonyms, promotions, data sources and
the merge review queue.

Three rules hold across every route here. Each mutation writes an audit_log entry
through the repository, because these settings change what a traveller sees
without a deploy and "who turned the price filter off?" has to be answerable.
Each payload is checked here, so a bad value comes back as a 400 naming the
problem rather than as a 500 from the layer that trusted it. And each mutation
that changes what retrieval will do publishes an events.py event, because the
derived caches (nlq.py's parse cache, graph.py's adjacency) would otherwise serve
the old configuration until the process restarted — an edit that appears to save
and then does nothing is the worst of the three failure modes.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .. import events, tracing
from ..metrics import metrics
from ..repository import Repo, get_repo
from ..schemas import (
    AdminConfig,
    DataSource,
    MergeCandidate,
    Promotion,
    SearchFilters,
    Synonym,
    Trip,
)

log = logging.getLogger("traveliq.admin")

router = APIRouter()

PROMOTION_KINDS = ("pin", "boost", "hide")
MAX_WEIGHT = 10.0
MAX_RESULTS_PER_PAGE = 60  # search_config.results_per_page check constraint
_FALLBACK_ACTOR = "editor@traveliq.local"


def _actor(x_actor: Optional[str] = Header(default=None)) -> str:
    """Who to record in audit_log. Authentication is not implemented in the POC —
    until a session provider is wired in and users.role is read from it, an
    X-Actor header stands in for the signed-in editor."""
    return (x_actor or "").strip() or _FALLBACK_ACTOR


# --- Search setup ----------------------------------------------------------

def _validate_config(cfg: AdminConfig) -> None:
    seen: set[str] = set()
    for field in cfg.searchableFields:
        name = field.field.strip()
        if not name:
            raise HTTPException(status_code=400, detail="a searchable field needs a name")
        if name in seen:
            raise HTTPException(status_code=400, detail=f"'{name}' is listed twice")
        seen.add(name)
        if not 0 <= field.weight <= MAX_WEIGHT:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"weight for '{name}' must be between 0 and {MAX_WEIGHT:g}, "
                    f"got {field.weight:g}"
                ),
            )
    if not 1 <= cfg.resultsPerPage <= MAX_RESULTS_PER_PAGE:
        raise HTTPException(
            status_code=400,
            detail=f"resultsPerPage must be between 1 and {MAX_RESULTS_PER_PAGE}",
        )
    if not any(f.enabled for f in cfg.searchableFields):
        raise HTTPException(
            status_code=400, detail="at least one searchable field has to stay enabled"
        )
    # Names outside the domain are a warning rather than a 400: the panel is
    # allowed to describe a field the ranker does not read yet, and refusing the
    # save would strand a config the API itself handed out.
    stray_fields = [f.field for f in cfg.searchableFields if f.field not in Trip.model_fields]
    if stray_fields:
        log.warning("searchable field(s) not on Trip: %s", ", ".join(stray_fields))
    stray_filters = [f for f in cfg.enabledFilters if f not in SearchFilters.model_fields]
    if stray_filters:
        log.warning("filter(s) not on SearchFilters: %s", ", ".join(stray_filters))


@router.get("/admin/config", response_model=AdminConfig)
async def get_config(repo: Repo = Depends(get_repo)) -> AdminConfig:
    return await repo.config_get()


@router.put("/admin/config", response_model=AdminConfig)
async def put_config(
    cfg: AdminConfig,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> AdminConfig:
    _validate_config(cfg)
    saved = await repo.config_set(cfg)
    await repo.audit(
        actor,
        "config.update",
        {
            "resultsPerPage": saved.resultsPerPage,
            "fallbackToLexical": saved.fallbackToLexical,
            "enabledFilters": saved.enabledFilters,
            "weights": {f.field: f.weight for f in saved.searchableFields if f.enabled},
        },
    )
    return saved


# --- Synonyms --------------------------------------------------------------

class SynonymBody(BaseModel):
    """The panel posts Omit<Synonym, 'id'>, so the id is minted here. Everything
    else is optional at the type level and checked below, which is what keeps a
    typo in the form a readable 400 instead of a validation dump."""

    id: Optional[str] = None
    term: str = ""
    alternatives: list[str] = Field(default_factory=list)
    market: str = "en-GB"


@router.get("/admin/synonyms", response_model=list[Synonym])
async def get_synonyms(repo: Repo = Depends(get_repo)) -> list[Synonym]:
    return await repo.synonyms()


@router.post("/admin/synonyms", response_model=Synonym)
async def add_synonym(
    body: SynonymBody,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> Synonym:
    term = body.term.strip()
    if not term:
        raise HTTPException(status_code=400, detail="a synonym needs a term")
    alternatives = [a.strip() for a in body.alternatives if a and a.strip()]
    if not alternatives:
        raise HTTPException(
            status_code=400, detail=f"'{term}' needs at least one alternative to expand to"
        )
    if any(a.casefold() == term.casefold() for a in alternatives):
        raise HTTPException(status_code=400, detail="a term cannot be its own alternative")
    market = body.market.strip() or "en-GB"
    # synonyms(term, market) is unique in Postgres; catching it here keeps the
    # duplicate a 409 the panel can explain instead of an integrity error.
    existing = await repo.synonyms()
    if any(s.term.casefold() == term.casefold() and s.market == market for s in existing):
        raise HTTPException(status_code=409, detail=f"'{term}' already has a set for {market}")

    saved = await repo.synonym_add(
        Synonym(
            id=body.id or str(uuid.uuid4()),
            term=term,
            alternatives=alternatives,
            market=market,
        )
    )
    await repo.audit(
        actor,
        "synonym.add",
        {"id": saved.id, "term": saved.term, "alternatives": saved.alternatives,
         "market": saved.market},
    )
    events.bus.publish(events.SYNONYM_CHANGED, {"id": saved.id, "term": saved.term})
    return saved


@router.delete("/admin/synonyms/{sid}", response_model=list[Synonym])
async def delete_synonym(
    sid: str,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> list[Synonym]:
    """Returns what is left, so the table can redraw without a second round trip."""
    current = await repo.synonyms()
    doomed = next((s for s in current if s.id == sid), None)
    if doomed is None:
        raise HTTPException(status_code=404, detail=f"no synonym with id {sid}")
    await repo.synonym_delete(sid)
    await repo.audit(actor, "synonym.delete", {"id": sid, "term": doomed.term})
    events.bus.publish(events.SYNONYM_CHANGED, {"id": sid, "term": doomed.term})
    return [s for s in current if s.id != sid]


# --- Promotions ------------------------------------------------------------

class PromotionBody(BaseModel):
    """Omit<Promotion, 'id'> from the panel. `kind` is a plain string so an
    unknown value gets the 400 that names the three that work."""

    id: Optional[str] = None
    tripId: str = ""
    tripTitle: str = ""
    kind: str = ""
    weight: float = 1.0
    startsAt: Optional[str] = None
    endsAt: Optional[str] = None


@router.get("/admin/promotions", response_model=list[Promotion])
async def get_promotions(repo: Repo = Depends(get_repo)) -> list[Promotion]:
    return await repo.promotions()


@router.post("/admin/promotions", response_model=Promotion)
async def add_promotion(
    body: PromotionBody,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> Promotion:
    kind = body.kind.strip().lower()
    if kind not in PROMOTION_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"kind must be one of {', '.join(PROMOTION_KINDS)}, got '{body.kind}'",
        )
    if not 0 <= body.weight <= MAX_WEIGHT:
        raise HTTPException(
            status_code=400, detail=f"weight must be between 0 and {MAX_WEIGHT:g}"
        )
    trip_id = body.tripId.strip()
    if not trip_id:
        raise HTTPException(status_code=400, detail="a promotion needs a trip")
    if body.startsAt and body.endsAt and body.endsAt <= body.startsAt:
        raise HTTPException(status_code=400, detail="the promotion ends before it starts")

    # The trip must exist before we promote it, or the foreign key turns a typo
    # in the trip id into a 500. Slugs are accepted because that is what the
    # search screen has in its URL.
    trip = next((t for t in await repo.trips() if trip_id in (t.id, t.slug)), None)
    if trip is None:
        raise HTTPException(status_code=400, detail=f"no trip matches '{trip_id}'")

    saved = await repo.promotion_add(
        Promotion(
            id=body.id or str(uuid.uuid4()),
            tripId=trip.id,
            tripTitle=body.tripTitle.strip() or trip.title,
            kind=kind,
            weight=body.weight,
            startsAt=body.startsAt,
            endsAt=body.endsAt,
        )
    )
    await repo.audit(
        actor,
        "promotion.add",
        {"id": saved.id, "tripId": saved.tripId, "tripTitle": saved.tripTitle,
         "kind": saved.kind, "weight": saved.weight},
    )
    events.bus.publish(events.PROMOTION_CHANGED, {"id": saved.id, "tripId": saved.tripId})
    return saved


@router.delete("/admin/promotions/{pid}", response_model=list[Promotion])
async def delete_promotion(
    pid: str,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> list[Promotion]:
    current = await repo.promotions()
    doomed = next((p for p in current if p.id == pid), None)
    if doomed is None:
        raise HTTPException(status_code=404, detail=f"no promotion with id {pid}")
    await repo.promotion_delete(pid)
    await repo.audit(
        actor,
        "promotion.delete",
        {"id": pid, "tripId": doomed.tripId, "kind": doomed.kind},
    )
    events.bus.publish(events.PROMOTION_CHANGED, {"id": pid, "tripId": doomed.tripId})
    return [p for p in current if p.id != pid]


# --- Data sources ----------------------------------------------------------

@router.get("/admin/sources", response_model=list[DataSource])
async def get_sources(repo: Repo = Depends(get_repo)) -> list[DataSource]:
    return await repo.sources()


@router.post("/admin/sources/{key}/sync", response_model=DataSource)
async def sync_source(
    key: str,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> DataSource:
    """Kicks a feed by hand. The POC re-reads the seed payload for that source;
    a real sync calls the supplier API and hands the records to /ingest."""
    known = await repo.sources()
    if not any(s.key == key for s in known):
        raise HTTPException(
            status_code=404,
            detail=f"unknown source '{key}' (known: {', '.join(s.key for s in known) or 'none'})",
        )
    source = await repo.source_sync(key)
    await repo.audit(
        actor,
        "source.sync",
        {"key": key, "status": source.status, "recordCount": source.recordCount},
    )
    return source


# --- Review queue ----------------------------------------------------------

@router.get("/admin/review-queue", response_model=list[MergeCandidate])
async def get_review_queue(repo: Repo = Depends(get_repo)) -> list[MergeCandidate]:
    return await repo.review_queue()


async def _resolve(cid: str, approve: bool, repo: Repo, actor: str) -> MergeCandidate:
    """The queue only lists pending entries, so a second decision on the same id
    is a 404 rather than a silent re-approval."""
    if not any(c.id == cid for c in await repo.review_queue()):
        raise HTTPException(status_code=404, detail=f"no pending review-queue entry with id {cid}")
    candidate = await repo.review_resolve(cid, approve)
    await repo.audit(
        actor,
        "review.approve" if approve else "review.reject",
        {
            "id": cid,
            "score": candidate.score,
            "leftTitle": candidate.leftTitle,
            "rightTitle": candidate.rightTitle,
            "rightSource": candidate.rightSource,
            "reasons": candidate.reasons,
        },
    )
    if approve:
        # An approval merges a source record into a trip, so its copy — and
        # therefore its embedding and its graph edges — have moved. A rejection
        # changes nothing a traveller can see, so it publishes nothing.
        events.bus.publish(events.TRIP_CHANGED, {"candidateId": cid, "title": candidate.leftTitle})
    return candidate


@router.post("/admin/review-queue/{cid}/approve", response_model=MergeCandidate)
async def approve_review(
    cid: str,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> MergeCandidate:
    return await _resolve(cid, True, repo, actor)


@router.post("/admin/review-queue/{cid}/reject", response_model=MergeCandidate)
async def reject_review(
    cid: str,
    repo: Repo = Depends(get_repo),
    actor: str = Depends(_actor),
) -> MergeCandidate:
    return await _resolve(cid, False, repo, actor)


# --- Observability -----------------------------------------------------------

@router.get("/admin/observability")
def observability() -> dict:
    """The pipeline's own account of itself: whether traces are leaving for
    LangSmith and where, plus the in-process stage latencies and counters that
    metrics.py keeps. Read-only, so no audit entry and no event — this is the
    one admin surface that only ever describes the system.

    The same numbers are exposed at /metrics in Prometheus text format for
    scrapers; this JSON shape is for humans and the admin UI.
    """
    return {"tracing": tracing.status(), **metrics.snapshot()}
