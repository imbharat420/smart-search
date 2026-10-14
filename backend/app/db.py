"""Async engine and session plumbing for Postgres.

Every function here is safe to call with no DATABASE_URL set: the engine is
never created, `ping()` returns False and `create_all()` no-ops. That is the
documented POC fallback — repository.py sees a False ping and hands back the
in-memory catalogue instead, so `uvicorn app.main:app` works on a laptop with
nothing installed. The engine itself is built lazily on first use rather than at
import time, so `import app.db` costs nothing and settings can still change in
tests before the first connection.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import settings
from .models import Base

log = logging.getLogger("traveliq.db")

_engine: Optional[AsyncEngine] = None
_sessions: Optional[async_sessionmaker[AsyncSession]] = None


def engine() -> Optional[AsyncEngine]:
    """The process-wide engine, or None when no DATABASE_URL is configured."""
    global _engine, _sessions
    if not settings.db_configured():
        return None
    if _engine is None:
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_pool_size,
            # A dev machine sleeps and Postgres drops the connection; without
            # pre_ping the first query after waking fails instead of retrying.
            pool_pre_ping=True,
            pool_recycle=1800,
        )
        _sessions = async_sessionmaker(_engine, expire_on_commit=False)
        log.info("postgres engine ready (pool_size=%d)", settings.db_pool_size)
    return _engine


@asynccontextmanager
async def session() -> AsyncIterator[AsyncSession]:
    """One transaction per block: commit on clean exit, roll back on anything
    else. Raises if there is no database — callers hold a Repo whose `kind`
    already told them which world they are in, so reaching here without a DSN is
    a bug rather than a condition to handle."""
    if engine() is None or _sessions is None:
        raise RuntimeError("DATABASE_URL is not set; use the in-memory repository instead")
    async with _sessions() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


async def ping() -> bool:
    """Is Postgres configured *and* reachable? Never raises — an unreachable
    database is a fallback condition, not an error."""
    eng = engine()
    if eng is None:
        return False
    try:
        async with eng.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception as exc:  # noqa: BLE001 — degrade to the in-memory catalogue
        log.warning("postgres unreachable (%s); falling back to the seed catalogue", exc)
        return False
    return True


async def create_all() -> bool:
    """Create any missing tables from models.py. Returns False when there is no
    database to create them in. This is the convenience path used by
    `python -m app.seed`; sql/schema.sql is the reviewable artefact and the two
    are kept in step by hand."""
    eng = engine()
    if eng is None:
        return False
    # In its own transaction, not folded into the DDL below: on managed Postgres
    # the role often cannot create extensions, and a failed CREATE EXTENSION
    # would poison the transaction that creates the tables.
    try:
        async with eng.begin() as conn:
            await conn.exec_driver_sql("create extension if not exists pg_trgm")
    except Exception as exc:  # noqa: BLE001 — only the trigram index needs it
        log.warning("could not create pg_trgm (%s); typo tolerance will be unavailable", exc)

    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # create_all adds missing *tables*, never missing *columns* — so the few
    # columns added to a table after its first deploy are ensured here by hand,
    # idempotently. A real migration tool is overkill while this list is short;
    # keep it in step with sql/schema.sql like everything else in models.py.
    try:
        async with eng.begin() as conn:
            for ddl in (
                "alter table assistant_sessions add column if not exists title varchar(120)",
                "alter table assistant_sessions add column if not exists pinned boolean not null default false",
            ):
                await conn.exec_driver_sql(ddl)
    except Exception as exc:  # noqa: BLE001 — an old schema still serves everything but the chat list
        log.warning("could not ensure assistant_sessions columns (%s)", exc)

    log.info("schema ensured for %d tables", len(Base.metadata.tables))
    return True


async def dispose() -> None:
    """Close the pool. Called from main.py's lifespan on shutdown."""
    global _engine, _sessions
    if _engine is not None:
        await _engine.dispose()
        log.info("postgres pool disposed")
    _engine = None
    _sessions = None
