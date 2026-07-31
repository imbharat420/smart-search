"""Search, predictive suggestions, and the interaction events analytics feed on.

The pipeline is kept visible in one function: understand the sentence (nlq),
retrieve and rank (rag), page, log, respond. Ranking and facet counting happen
over the whole result set before paging, so the counts in the facet rail match
what a traveller actually gets by clicking through.
"""
from __future__ import annotations

import logging
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import nlq
from ..config import settings
from ..rag import index
from ..repository import Repo, get_repo
from ..schemas import EventRequest, ParsedQuery, SearchRequest, SearchResponse

log = logging.getLogger("traveliq.search")

router = APIRouter()

_SORTS = {"relevance", "price-asc", "price-desc", "rating", "duration"}
_EVENT_TYPES = {"impression", "click", "booking"}
_MAX_PAGE_SIZE = 48  # without a cap, one request could page the whole catalogue

# The three sentences the brief uses as examples. They always return something,
# which makes them a reliable escape hatch out of a dead-end query.
_EXAMPLE_QUERIES = (
    "northern lights trip for a family next winter, not too expensive",
    "7 day walking holiday in italy with small groups",
    "somewhere warm in november under 1200 direct flights",
)


@router.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest, repo: Repo = Depends(get_repo)) -> SearchResponse:
    started = time.perf_counter()

    parsed = await nlq.parse(req.query)
    trips = await repo.trips()
    promotions = await repo.promotions()
    synonyms = await repo.synonyms()

    sort = req.sort if req.sort in _SORTS else "relevance"
    if sort != req.sort:
        log.warning("unknown sort %r; ranking by relevance instead", req.sort)

    results, facets, mode = await index.search(
        req.query, parsed, req.filters, trips, promotions, synonyms, sort=sort
    )

    page_size = max(1, min(_MAX_PAGE_SIZE, req.pageSize or settings.search_page_size))
    page = max(1, req.page)
    start = (page - 1) * page_size
    window = results[start : start + page_size]

    # Timed before the write: tookMs is what the traveller waited for, not what
    # the analytics insert cost.
    took_ms = int((time.perf_counter() - started) * 1000)
    try:
        search_id = await repo.log_search(req.query, parsed, req.filters, len(results), took_ms, mode)
    except Exception as exc:  # noqa: BLE001 — analytics must never take a search down with it
        log.warning("log_search failed (%s); responding with an unlogged searchId", exc)
        search_id = f"unlogged-{uuid4().hex[:8]}"

    return SearchResponse(
        searchId=search_id,
        results=window,
        total=len(results),
        page=page,
        pageSize=page_size,
        facets=facets,
        parsed=parsed,
        tookMs=took_ms,
        mode=mode,
        suggestions=None if results else await _zero_result_suggestions(req.query, parsed, repo),
    )


@router.get("/suggest")
async def suggest(
    q: str = Query("", max_length=120), repo: Repo = Depends(get_repo)
) -> dict[str, list[str]]:
    """Type-ahead over destinations, themes and previous searches. Deliberately
    dumb and fast — the sentence-level understanding happens in /search."""
    return {"suggestions": await repo.suggestions(q.strip())}


@router.post("/events")
async def events(req: EventRequest, repo: Repo = Depends(get_repo)) -> dict[str, bool]:
    """Impression, click and booking beacons. Every one carries the searchId it
    came from, which is what makes CTR and conversion per search term possible."""
    if req.type not in _EVENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown event type '{req.type}'. Expected one of: {', '.join(sorted(_EVENT_TYPES))}.",
        )
    await repo.log_event(req)
    return {"ok": True}


async def _zero_result_suggestions(query: str, parsed: ParsedQuery, repo: Repo) -> list[str]:
    """Queries worth trying when nothing matched: the same request with one
    constraint dropped first, then the catalogue's own type-ahead, then the
    known-good examples."""
    theme = parsed.themes[0] if parsed.themes else None
    activity = parsed.activities[0] if parsed.activities else None
    subject = parsed.destination or theme or activity

    candidates: list[str] = []
    if subject:
        if parsed.maxPrice:
            candidates.append(f"{subject} at any budget")
        if parsed.months:
            candidates.append(f"{subject} any time of year")
        if parsed.directFlights:
            candidates.append(f"{subject} with connecting flights")
        if parsed.destination and (theme or activity):
            candidates.append(f"{theme or activity} anywhere")
    candidates.extend(await repo.suggestions(query.strip()))
    candidates.extend(_EXAMPLE_QUERIES)

    seen: set[str] = set()
    unique: list[str] = []
    for candidate in candidates:
        key = candidate.strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(candidate.strip())
    return unique[:5]
