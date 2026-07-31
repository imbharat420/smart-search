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
    trips = await repo.trips()

    async def event_stream():
        try:
            async for chunk in stream_chat(req.messages, trips):
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
