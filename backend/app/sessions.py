"""Where the traveller's plan lives between chat turns.

chat.py has no memory today beyond replaying `messages[-8:]`: that window grows
with the conversation and it makes the model re-derive "so the budget was
mid-range, right?" out of scrollback on every single turn. This is the store
behind the explicit-state approach instead — one row per conversation holding one
`TripPlanState` — so a turn carries the plan (~100 tokens, and constant) rather
than the transcript.

Two implementations behind one Protocol, chosen at startup, following
repository.py exactly: a reachable DATABASE_URL gives `PostgresSessionStore`,
anything else gives `MemorySessionStore` and one log line saying why. That is not
a shortcut — config.py documents an unset DATABASE_URL as the POC fallback, and
the assistant has to keep planning on a laptop with nothing installed.

Neither `load` nor `save` ever raises. A database that goes away mid-conversation
should cost the traveller a re-confirmation, not their answer, so every failure
here degrades to an empty plan and a warning naming the reason.
"""
from __future__ import annotations

import logging
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Optional, Protocol

from pydantic import ValidationError
from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from . import db, models
from .config import settings
from .schemas import ChatSessionMeta, StoredMessage, TripPlanState

log = logging.getLogger("traveliq.sessions")

# Session ids are minted by the browser and never authenticated, so the key space
# belongs to whoever can open a tab. 500 concurrent plans is far more than a POC
# ever holds at once and small enough that the whole dict is a rounding error next
# to rag.py's embedding matrix.
MAX_SESSIONS = 500

# assistant_sessions.session_id is varchar(64) and the client mints a uuid4 (36
# characters), so anything longer is a client that invented its own scheme.
SESSION_ID_MAX = 64

# The transcript a returning traveller gets back, newest-first truncated: enough
# to re-read any real conversation, small enough that one hostile session cannot
# make /chat/history a memory problem. The full row set stays in Postgres; this
# caps what one load returns (and what the memory store holds per session).
MAX_TRANSCRIPT = 200

# assistant_sessions.title is varchar(120); GET /chat/sessions returns at most
# this many rows, newest first — beyond it the list stops being a list anyone
# scrolls and starts being an export.
TITLE_MAX = 120
MAX_LISTED = 100


def _usable(session_id: str) -> bool:
    """`sessionId` is optional on the wire (schemas.py's `ChatRequest`) and minted
    by the client, so both an absent id and an over-length one turn up in
    practice. Either is a stateless turn rather than an error: the assistant still
    answers, it just cannot remember. Checking the length here rather than letting
    varchar(64) reject it keeps a bad client out of the warning log every turn."""
    # `ChatRequest.sessionId` is `Optional[str]`, so None is what a caller passing
    # the field straight through hands us — and this gate runs before the
    # try/except in every method, so an AttributeError here would be the one way
    # load() and save() could still raise at their callers.
    if not isinstance(session_id, str) or not session_id.strip():
        return False
    return len(session_id) <= SESSION_ID_MAX


def _validated(stored: dict[str, Any], session_id: str) -> TripPlanState:
    """The stored JSON as a `TripPlanState`, or an empty plan if it no longer fits.

    Schema-drift guard: the blob was written by whichever deploy owned the
    conversation, and the plan's shape belongs to the assistant, so it moves
    whenever the conversational design does (that is exactly why models.py stores
    it as one JSONB column). A plan written before a rename must not raise a
    ValidationError up through /chat — the traveller starts the plan again, which
    is the same cost as a new tab.
    """
    try:
        return TripPlanState.model_validate(stored)
    except ValidationError as exc:
        log.warning(
            "stored plan for session %s no longer fits TripPlanState (%s); starting fresh",
            session_id,
            exc.error_count(),
        )
        return TripPlanState()


# --- The interface ---------------------------------------------------------

class SessionStore(Protocol):
    """What chat.py depends on. Structural rather than inherited, for the same
    reason as repository.py's `Repo`: the two implementations are checked against
    it by the type checker and neither has to know the other exists."""

    kind: str

    async def load(self, session_id: str) -> TripPlanState: ...
    async def save(self, session_id: str, state: TripPlanState) -> None: ...
    async def forget(self, session_id: str) -> None: ...
    # The transcript, same never-raise contract as the plan: a failed append costs
    # one turn of history, a failed history read costs a fresh-looking thread —
    # never the answer itself.
    async def append_messages(self, session_id: str, entries: list[StoredMessage]) -> None: ...
    async def history(self, session_id: str) -> list[StoredMessage]: ...
    # The chat list: conversations that have a transcript, pinned first then most
    # recent. set_meta returns False for an unknown session so the router can 404;
    # ensure_title only ever fills an empty label, so a rename is never overwritten
    # by the next turn.
    async def sessions_list(self) -> list[ChatSessionMeta]: ...
    async def set_meta(
        self, session_id: str, *, title: Optional[str] = None, pinned: Optional[bool] = None
    ) -> bool: ...
    async def ensure_title(self, session_id: str, title: str) -> None: ...


# --- In-memory ------------------------------------------------------------

class MemorySessionStore:
    """Plans held in process, bounded and least-recently-used first out.

    It forgets on restart, and two uvicorn workers mean two dicts — a traveller's
    plan would then depend on which worker answered. That is the honest limit of
    it, and the reason Postgres is preferred whenever there is one.
    """

    kind: str = "memory"

    def __init__(self) -> None:
        self._plans: "OrderedDict[str, TripPlanState]" = OrderedDict()
        # Transcripts, bounded the same two ways the Postgres store is bounded by
        # MAX_TRANSCRIPT: at most MAX_SESSIONS conversations, each keeping only
        # its newest MAX_TRANSCRIPT messages.
        self._messages: "OrderedDict[str, list[StoredMessage]]" = OrderedDict()
        # Chat-list metadata (title, pinned, last activity), keyed and evicted
        # alongside _messages — a conversation with no transcript has no row in
        # the list, so the two must live and die together.
        self._meta: dict[str, dict[str, Any]] = {}

    async def load(self, session_id: str) -> TripPlanState:
        held = self._plans.get(session_id)
        if held is None:
            return TripPlanState()
        self._plans.move_to_end(session_id)
        # A deep copy on the way out and again on the way in, so a caller that
        # mutates the plan it was handed cannot edit the stored one behind
        # save()'s back. The Postgres store rebuilds from JSON every time and so
        # behaves this way by construction; the two must not differ here.
        return held.model_copy(deep=True)

    async def save(self, session_id: str, state: TripPlanState) -> None:
        if not _usable(session_id):
            return
        self._plans[session_id] = state.model_copy(deep=True)
        self._plans.move_to_end(session_id)
        # Unbounded, this dict is a memory leak an anonymous visitor can drive:
        # one loop minting fresh session ids grows it forever, because nothing
        # ever tells us a conversation ended. Evicting oldest-first costs the
        # least-recently-active conversation its plan, which is the cheapest
        # thing in this process to lose — the same shape as nlq.py's parse cache.
        while len(self._plans) > MAX_SESSIONS:
            self._plans.popitem(last=False)

    async def forget(self, session_id: str) -> None:
        self._plans.pop(session_id, None)
        self._messages.pop(session_id, None)
        self._meta.pop(session_id, None)

    async def append_messages(self, session_id: str, entries: list[StoredMessage]) -> None:
        if not _usable(session_id) or not entries:
            return
        held = self._messages.setdefault(session_id, [])
        # Copies in, copies out, like the plans above: the caller keeps mutating
        # its payload dicts after the turn and the record must not move with it.
        held.extend(entry.model_copy(deep=True) for entry in entries)
        del held[:-MAX_TRANSCRIPT]
        self._messages.move_to_end(session_id)
        meta = self._meta.setdefault(session_id, {"title": None, "pinned": False})
        meta["updated"] = datetime.now(timezone.utc)
        while len(self._messages) > MAX_SESSIONS:
            evicted, _ = self._messages.popitem(last=False)
            self._meta.pop(evicted, None)

    async def history(self, session_id: str) -> list[StoredMessage]:
        held = self._messages.get(session_id)
        if not held:
            return []
        self._messages.move_to_end(session_id)
        return [entry.model_copy(deep=True) for entry in held]

    async def sessions_list(self) -> list[ChatSessionMeta]:
        rows = [
            ChatSessionMeta(
                sessionId=session_id,
                title=meta.get("title"),
                pinned=bool(meta.get("pinned")),
                updatedAt=updated.isoformat() if (updated := meta.get("updated")) else None,
                # Two rows per turn, so the pair count is the turn count.
                turnCount=len(self._messages.get(session_id, [])) // 2,
            )
            for session_id, meta in self._meta.items()
            if self._messages.get(session_id)
        ]
        # Pinned first, newest first within each group — two stable sorts, the
        # tie-breaker applied first.
        rows.sort(key=lambda r: r.updatedAt or "", reverse=True)
        rows.sort(key=lambda r: not r.pinned)
        return rows[:MAX_LISTED]

    async def set_meta(
        self, session_id: str, *, title: Optional[str] = None, pinned: Optional[bool] = None
    ) -> bool:
        meta = self._meta.get(session_id)
        if meta is None:
            return False
        if title is not None:
            meta["title"] = title.strip()[:TITLE_MAX]
        if pinned is not None:
            meta["pinned"] = pinned
        return True

    async def ensure_title(self, session_id: str, title: str) -> None:
        meta = self._meta.get(session_id)
        if meta is not None and not meta.get("title"):
            meta["title"] = title.strip()[:TITLE_MAX] or None


# --- Postgres -------------------------------------------------------------

class PostgresSessionStore:
    """The durable store: one `assistant_sessions` row per conversation, upserted
    once a turn. Every method opens one transaction through `db.session()` and
    closes it before returning, exactly as `PostgresRepo` does."""

    kind: str = "postgres"

    async def load(self, session_id: str) -> TripPlanState:
        if not _usable(session_id):
            return TripPlanState()
        try:
            async with db.session() as s:
                stored = await s.scalar(
                    select(models.AssistantSession.state).where(
                        models.AssistantSession.session_id == session_id
                    )
                )
        except Exception as exc:  # noqa: BLE001 — an unreachable database costs the plan, never the answer
            log.warning(
                "could not load session %s (%s); the turn runs on an empty plan",
                session_id,
                exc,
            )
            return TripPlanState()
        if not stored:
            # An unknown session id is the ordinary first turn, not a miss worth
            # logging: the client mints the id before it has ever spoken to us.
            return TripPlanState()
        return _validated(stored, session_id)

    async def save(self, session_id: str, state: TripPlanState) -> None:
        if not _usable(session_id):
            return
        values = {
            # exclude_none, so an untouched slot is absent from the JSON rather
            # than an explicit null — the blob reads as "what we know" and stays
            # small enough to eyeball in psql.
            "state": state.model_dump(exclude_none=True),
            # Clamped rather than trusted: ck_assistant_sessions_turn_count would
            # reject a negative counter and take the whole save down with it, and
            # a nonsense turn number is not worth losing the plan over.
            "turn_count": max(0, state.turnCount),
        }
        stmt = (
            pg_insert(models.AssistantSession)
            .values(session_id=session_id, **values)
            .on_conflict_do_update(
                index_elements=["session_id"],
                # One statement rather than select-then-insert: two turns of the
                # same conversation can overlap (a retried request, a second tab)
                # and the loser of that race must update the row, not fail on the
                # unique constraint. onupdate= does not reach an ON CONFLICT SET
                # clause — repository.py's config_set hit the same thing — so
                # updated_at is set here or the column never moves.
                set_={**values, "updated_at": func.now()},
            )
        )
        try:
            async with db.session() as s:
                await s.execute(stmt)
        except Exception as exc:  # noqa: BLE001 — a dropped save is a slightly older plan, not a broken turn
            log.warning(
                "could not save session %s (%s); the next turn resumes from the last stored plan",
                session_id,
                exc,
            )

    async def forget(self, session_id: str) -> None:
        if not _usable(session_id):
            return
        try:
            async with db.session() as s:
                await s.execute(
                    delete(models.AssistantSession).where(
                        models.AssistantSession.session_id == session_id
                    )
                )
                await s.execute(
                    delete(models.AssistantMessage).where(
                        models.AssistantMessage.session_id == session_id
                    )
                )
        except Exception as exc:  # noqa: BLE001 — "start again" must succeed for the traveller either way
            log.warning(
                "could not forget session %s (%s); the stale plan is still on record",
                session_id,
                exc,
            )

    async def append_messages(self, session_id: str, entries: list[StoredMessage]) -> None:
        if not _usable(session_id) or not entries:
            return
        try:
            async with db.session() as s:
                # max(seq)+1 in the same transaction that inserts. Two overlapping
                # turns of one session could mint the same seq — there is no unique
                # constraint on purpose, because a duplicated ordinal misorders one
                # pair of messages at worst, and created_at still tie-breaks reads.
                next_seq = await s.scalar(
                    select(func.coalesce(func.max(models.AssistantMessage.seq), 0) + 1).where(
                        models.AssistantMessage.session_id == session_id
                    )
                )
                s.add_all(
                    models.AssistantMessage(
                        session_id=session_id,
                        seq=(next_seq or 1) + offset,
                        role=entry.role,
                        content=entry.content,
                        payload=entry.payload,
                    )
                    for offset, entry in enumerate(entries)
                )
        except Exception as exc:  # noqa: BLE001 — a dropped append costs one turn of history, not the turn
            log.warning(
                "could not append %d message(s) for session %s (%s); the transcript skips this turn",
                len(entries),
                session_id,
                exc,
            )

    async def history(self, session_id: str) -> list[StoredMessage]:
        if not _usable(session_id):
            return []
        try:
            async with db.session() as s:
                rows = (
                    await s.execute(
                        select(
                            models.AssistantMessage.role,
                            models.AssistantMessage.content,
                            models.AssistantMessage.payload,
                        )
                        .where(models.AssistantMessage.session_id == session_id)
                        # Newest first plus limit keeps the *tail* of a long
                        # conversation — the end is what the traveller resumes from.
                        .order_by(
                            models.AssistantMessage.seq.desc(),
                            models.AssistantMessage.created_at.desc(),
                        )
                        .limit(MAX_TRANSCRIPT)
                    )
                ).all()
        except Exception as exc:  # noqa: BLE001 — an unreachable database looks like a fresh thread, never a 500
            log.warning(
                "could not load history for session %s (%s); the thread starts fresh on screen",
                session_id,
                exc,
            )
            return []
        return [
            StoredMessage(role=role, content=content, payload=payload or {})
            for role, content, payload in reversed(rows)
        ]

    async def sessions_list(self) -> list[ChatSessionMeta]:
        try:
            async with db.session() as s:
                rows = (
                    await s.execute(
                        select(
                            models.AssistantSession.session_id,
                            models.AssistantSession.title,
                            models.AssistantSession.pinned,
                            models.AssistantSession.updated_at,
                            models.AssistantSession.turn_count,
                        )
                        # Only conversations with a transcript: a plan row alone
                        # (a turn that saved state before this table existed, or a
                        # failed append) would list as an empty, untitled chat.
                        .where(
                            exists().where(
                                models.AssistantMessage.session_id
                                == models.AssistantSession.session_id
                            )
                        )
                        .order_by(
                            models.AssistantSession.pinned.desc(),
                            models.AssistantSession.updated_at.desc(),
                        )
                        .limit(MAX_LISTED)
                    )
                ).all()
        except Exception as exc:  # noqa: BLE001 — no list is a closed drawer, not a broken screen
            log.warning("could not list sessions (%s); the chat list shows empty", exc)
            return []
        return [
            ChatSessionMeta(
                sessionId=session_id,
                title=title,
                pinned=bool(pinned),
                updatedAt=updated_at.isoformat() if updated_at else None,
                turnCount=turn_count or 0,
            )
            for session_id, title, pinned, updated_at, turn_count in rows
        ]

    async def set_meta(
        self, session_id: str, *, title: Optional[str] = None, pinned: Optional[bool] = None
    ) -> bool:
        if not _usable(session_id):
            return False
        values: dict[str, Any] = {}
        if title is not None:
            values["title"] = title.strip()[:TITLE_MAX]
        if pinned is not None:
            values["pinned"] = pinned
        if not values:
            return True
        try:
            async with db.session() as s:
                result = await s.execute(
                    update(models.AssistantSession)
                    .where(models.AssistantSession.session_id == session_id)
                    .values(**values)
                )
                return bool(result.rowcount)
        except Exception as exc:  # noqa: BLE001 — a lost rename/pin is retryable by its owner
            log.warning("could not update metadata for session %s (%s)", session_id, exc)
            return False

    async def ensure_title(self, session_id: str, title: str) -> None:
        if not _usable(session_id):
            return
        cleaned = title.strip()[:TITLE_MAX]
        if not cleaned:
            return
        try:
            async with db.session() as s:
                # Fills the label exactly once: the WHERE keeps a traveller's
                # rename from being overwritten by every subsequent turn.
                await s.execute(
                    update(models.AssistantSession)
                    .where(
                        models.AssistantSession.session_id == session_id,
                        models.AssistantSession.title.is_(None),
                    )
                    .values(title=cleaned)
                )
        except Exception as exc:  # noqa: BLE001 — an unlabelled chat still lists, by its date
            log.warning("could not title session %s (%s)", session_id, exc)


# --- Selection ------------------------------------------------------------

_store: Optional[SessionStore] = None


async def init_store() -> SessionStore:
    """Pick the session store and remember it. Called once from main.py's
    lifespan, alongside `init_repo()` and after it: `init_repo` is what runs
    `db.create_all()`, so the assistant_sessions table exists by the time the
    first turn reads it."""
    global _store
    _store = await _choose_store()
    return _store


async def _choose_store() -> SessionStore:
    if not settings.db_configured():
        log.info("DATABASE_URL is not set; assistant plans are held in process")
        return MemorySessionStore()
    try:
        if not await db.ping():
            log.warning(
                "postgres is configured but unreachable; assistant plans are held in process"
            )
            return MemorySessionStore()
        return PostgresSessionStore()
    except Exception as exc:  # noqa: BLE001 — degrade to memory, never fail startup
        log.warning("postgres session store unavailable (%s); holding plans in process", exc)
        return MemorySessionStore()


def store() -> SessionStore:
    """The process-wide store, resolved once and cached.

    Unlike repository.py's `get_repo`, an uninitialised store falls back to memory
    instead of raising. A router without a catalogue has nothing to answer with,
    but a chat turn without a *plan store* still has a perfectly good answer in
    it — so an import path that never ran the lifespan (a test, a script calling
    chat.py directly) should cost one warning and a forgetful assistant, not a
    500 on every turn.
    """
    global _store
    if _store is None:
        log.warning(
            "init_store() has not run — main.py's lifespan awaits it at startup; "
            "holding assistant plans in process for now"
        )
        _store = MemorySessionStore()
    return _store
