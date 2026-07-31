"""Catalogue reads: destinations, one trip in full, guides, and nearby places.

Every handler goes through the repository, so the same code serves Postgres and
the in-memory seed catalogue without knowing which one answered.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repository import Repo, get_repo
from ..schemas import Destination, Guide, Place, TripDetail

router = APIRouter()

_PLACE_CATEGORIES = {"things-to-do", "restaurants", "stays"}


@router.get("/destinations", response_model=list[Destination])
async def destinations(repo: Repo = Depends(get_repo)) -> list[Destination]:
    return await repo.destinations()


@router.get("/trips/{slug}", response_model=TripDetail)
async def trip(slug: str, repo: Repo = Depends(get_repo)) -> TripDetail:
    detail = await repo.trip_by_slug(slug)
    if detail is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No trip with the slug '{slug}'. Slugs come from the search results "
                f"(POST /search returns trip.slug for every hit)."
            ),
        )
    return detail


@router.get("/guides", response_model=list[Guide])
async def guides(repo: Repo = Depends(get_repo)) -> list[Guide]:
    return await repo.guides()


@router.get("/places", response_model=list[Place])
async def places(
    q: str = Query("", max_length=120),
    category: str = Query(""),
    radius: float = Query(25.0, ge=1.0, le=500.0, description="miles from the map centre"),
    repo: Repo = Depends(get_repo),
) -> list[Place]:
    """The Discover screen's list. `radius` is measured against each place's
    precomputed distance from the destination centre — real geo-search against
    lat/lng would need PostGIS, which is on the roadmap, not in this POC."""
    if category and category not in _PLACE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown category '{category}'. Expected one of: "
                f"{', '.join(sorted(_PLACE_CATEGORIES))}, or omit it for everything."
            ),
        )
    return await repo.places(q.strip(), category, radius)
