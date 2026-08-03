"""The chat endpoint — transport only.

app/chat.py decides what the chunks are; this module frames them as server-sent
events and makes sure a mid-stream exception arrives as a final chunk rather than
as a truncated response the browser cannot distinguish from a network drop.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..chat import stream_chat
from ..repository import Repo, get_repo
from ..schemas import ChatChunk, ChatRequest

router = APIRouter()


@router.post("/chat")
async def chat(req: ChatRequest, repo: Repo = Depends(get_repo)) -> StreamingResponse:
    # Read the catalogue before the response starts: a repository failure here is
    # a plain 500, which is far easier to debug than a stream that opens and dies.
    #
    # Promotions come along because a trip an editor has hidden must not be
    # recommended by the assistant either — retrieve_for_chat used to pass an empty
    # list, which meant merchandising applied on /search but not in conversation.
    # Synonyms come along for the same reason /search expands them: "aurora" should
    # reach the Northern Lights trips here too.
    trips = await repo.trips()
    promotions = await repo.promotions()
    synonyms = await repo.synonyms()

    async def event_stream():
        try:
            async for chunk in stream_chat(
                req.messages,
                trips,
                promotions=promotions,
                synonyms=synonyms,
                session_id=req.sessionId,
                slot_patch=req.slotPatch,
            ):
                payload = json.dumps(chunk.model_dump(exclude_none=True))
                yield f"data: {payload}\n\n"
        except Exception as exc:  # surface errors to the client as a final chunk
            err = ChatChunk(token=f"\n\n[assistant error: {exc}]", done=True)
            yield f"data: {json.dumps(err.model_dump(exclude_none=True))}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
