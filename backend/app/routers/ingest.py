"""POST /ingest/{sourceKey} — the way records enter the unified catalogue.

In production this is driven by CMS and supplier webhooks, with a scheduled full
sync overnight as the safety net for whatever a webhook dropped.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from .. import events
from ..repository import Repo, get_repo
from ..schemas import IngestRequest, IngestResult

log = logging.getLogger("traveliq.ingest.api")

router = APIRouter()

# One batch, one request body, one match pass over the catalogue. Bigger feeds
# page through this endpoint; a stream would need a job queue and a progress
# resource, which the POC does not have.
MAX_RECORDS = 500


@router.post("/ingest/{sourceKey}", response_model=IngestResult)
async def ingest(
    sourceKey: str,
    req: IngestRequest,
    repo: Repo = Depends(get_repo),
) -> IngestResult:
    """Normalise, match and classify a batch. Anything the matcher is unsure of
    lands in the admin review queue instead of on the results page."""
    known = await repo.sources()
    if not any(s.key == sourceKey for s in known):
        raise HTTPException(
            status_code=404,
            detail=(
                f"unknown source '{sourceKey}' — register it under /admin/sources first "
                f"(known: {', '.join(s.key for s in known) or 'none'})"
            ),
        )
    if len(req.records) > MAX_RECORDS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"{len(req.records)} records in one call; the limit is {MAX_RECORDS}. "
                "Split the feed into batches of that size."
            ),
        )

    result = await repo.ingest_records(sourceKey, req.records)
    await repo.audit(
        f"feed:{sourceKey}",
        "ingest.run",
        {
            "received": result.received,
            "merged": result.merged,
            "queued": result.queued,
            # 'rejected' means rejected as a match: these become new trips.
            "newTrips": result.rejected,
        },
    )
    log.info(
        "ingest %s: merged=%d queued=%d new=%d of %d",
        sourceKey,
        result.merged,
        result.queued,
        result.rejected,
        result.received,
    )
    # A batch that only queued candidates changed nothing a traveller retrieves, so
    # it publishes nothing — the derived caches are worth dropping only when the
    # catalogue itself moved.
    if result.merged or result.rejected:
        events.bus.publish(
            events.CATALOGUE_RELOADED,
            {"source": sourceKey, "merged": result.merged, "newTrips": result.rejected},
        )
    return result
