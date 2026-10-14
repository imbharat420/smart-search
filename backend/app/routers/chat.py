"""The chat endpoint — transport only.

app/chat.py decides what the chunks are; this module frames them as server-sent
events and makes sure a mid-stream exception arrives as a final chunk rather than
as a truncated response the browser cannot distinguish from a network drop.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from .. import sessions
from ..chat import stream_chat
from ..repository import Repo, get_repo
from ..schemas import (
    ChatChunk,
    ChatHistoryMessage,
    ChatHistoryResponse,
    ChatRequest,
    ChatSessionList,
    ChatSessionPatch,
    TripPlanState,
)

log = logging.getLogger("traveliq.chat")

log = logging.getLogger("traveliq.chat")
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
        except Exception:  # surface failure to the client without leaking internals
            log.exception("chat turn failed")
            err = ChatChunk(token="\n\n[assistant error: something went wrong generating a reply]", done=True)
            yield f"data: {json.dumps(err.model_dump(exclude_none=True))}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/chat/history", response_model=ChatHistoryResponse, response_model_exclude_none=True)
async def chat_history(
    sessionId: str = Query(min_length=1, max_length=64),
    repo: Repo = Depends(get_repo),
) -> ChatHistoryResponse:
    """The stored conversation for one session id, shaped for the Assistant screen.

    Trips come back as full catalogue objects — the store keeps only their ids
    (see chat.py's _save_transcript), so this is where a restored card picks up
    today's price rather than the one it had at chat time. The plan state rides
    on the response once rather than per message; the client hangs it on the
    newest reply, which is the only place PlanSummary is editable anyway.
    """
    stored = await sessions.store().history(sessionId)
    state = await sessions.store().load(sessionId)

    by_id = {trip.id: trip for trip in await repo.trips()} if stored else {}
    messages: list[ChatHistoryMessage] = []
    for entry in stored:
        payload = entry.payload or {}
        try:
            messages.append(
                ChatHistoryMessage(
                    role=entry.role,
                    content=entry.content,
                    trips=[by_id[i] for i in payload.get("tripIds", []) if i in by_id] or None,
                    citations=payload.get("citations") or None,
                    quickReplies=payload.get("quickReplies"),
                    parsed=payload.get("parsed"),
                    provider=payload.get("provider"),
                    model=payload.get("model"),
                )
            )
        except ValidationError as exc:
            # The payload blob's shape belongs to the assistant and moves with it
            # (the same drift _validated guards for the plan). A row written by an
            # older deploy keeps its words and drops its extras — never the thread.
            log.warning(
                "stored message for session %s no longer fits the wire shape (%s); "
                "returning its text without extras",
                sessionId,
                exc.error_count(),
            )
            messages.append(ChatHistoryMessage(role=entry.role, content=entry.content))

    return ChatHistoryResponse(
        sessionId=sessionId,
        messages=messages,
        # An untouched plan is indistinguishable from no plan; omit it so the
        # client does not render an empty panel on a conversation that never
        # moved a slot.
        state=state if state != TripPlanState() else None,
    )


# The chat list. Session ids are browser-minted and unauthenticated (see
# sessions.py), so like the /admin surface this lists every conversation the
# store holds — the POC has no notion of *whose* they are. Real accounts would
# scope all three of these routes by owner, which is a WHERE clause here and a
# login screen everywhere else.

@router.get("/chat/sessions", response_model=ChatSessionList, response_model_exclude_none=True)
async def chat_sessions() -> ChatSessionList:
    """Conversations with a stored transcript: pinned first, then most recent."""
    return ChatSessionList(sessions=await sessions.store().sessions_list())


@router.patch(
    "/chat/sessions/{session_id}",
    response_model=ChatSessionList,
    response_model_exclude_none=True,
)
async def patch_chat_session(
    body: ChatSessionPatch,
    session_id: str = Path(min_length=1, max_length=64),
) -> ChatSessionList:
    """Rename or pin one conversation, then return the refreshed list — the
    client redraws the drawer from it either way, so one round trip does both."""
    found = await sessions.store().set_meta(session_id, title=body.title, pinned=body.pinned)
    if not found:
        raise HTTPException(status_code=404, detail="unknown session")
    return ChatSessionList(sessions=await sessions.store().sessions_list())


@router.delete(
    "/chat/sessions/{session_id}",
    response_model=ChatSessionList,
    response_model_exclude_none=True,
)
async def delete_chat_session(
    session_id: str = Path(min_length=1, max_length=64),
) -> ChatSessionList:
    """Forget one conversation — plan and transcript both — and return what is
    left. Idempotent like the store's forget: deleting the already-deleted is a
    no-op, not an error."""
    await sessions.store().forget(session_id)
    return ChatSessionList(sessions=await sessions.store().sessions_list())
