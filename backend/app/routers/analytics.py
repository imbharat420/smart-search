"""Search analytics: what travellers asked for, what came back empty, and what
they did next.

One endpoint, because every tile and chart on the admin panel's analytics tab is
computed from the same window over search_queries and search_events — splitting
it would mean four round trips describing one moment.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..repository import Repo, get_repo
from ..schemas import AnalyticsOverview

router = APIRouter()

MIN_DAYS = 1
MAX_DAYS = 365  # a year of search history is the most the panel ever plots


@router.get("/analytics/overview", response_model=AnalyticsOverview)
async def overview(
    days: int = Query(default=30, description="window in days, clamped to 1..365"),
    repo: Repo = Depends(get_repo),
) -> AnalyticsOverview:
    """The window is clamped rather than rejected: a dashboard asking for 3650
    days wants everything we have, and a 422 in a KPI tile tells nobody anything."""
    window = max(MIN_DAYS, min(MAX_DAYS, days))
    return await repo.analytics_overview(window)
