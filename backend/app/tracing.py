"""LangSmith tracing for the assistant pipeline — over the plain REST ingest API.

Every chat turn becomes one LangSmith trace: a root `chat_turn` run whose children
are the pipeline stages exactly as docs/assistant-rag-architecture.md §1.2 draws
them — parse, plan merge, candidate retrieval, policy retrieval, rerank,
generation. Each child carries its real inputs and outputs (the retrieval mode,
the widened constraints, the rerank order and scores, the full prompt and reply),
so a bad answer can be walked back to the stage that caused it in the LangSmith
UI rather than reconstructed from logs.

Why not `pip install langsmith`: the zero-new-dependency rule (§0 of the doc).
The SDK is a convenience wrapper over the same `/runs/batch` ingest endpoint this
module posts to, and httpx — the SDK's own transport — already ships here as the
openai package's transport. What the SDK would add (background batching, retries)
is replaced by something simpler and honest about being a POC: one fire-and-forget
POST per turn, a bounded backlog, and a warn-once on failure. If tracing volume
ever outgrows that, `pip install langsmith` and swapping this module's internals
is the documented upgrade path; the Span/Trace surface chat.py codes against
would not change.

The degradation contract, same as everywhere else in this codebase: no
LANGSMITH_API_KEY means spans are still built (they are how chat.py times its
stages for metrics.py) but nothing is uploaded; an upload failure is logged once
and never surfaces into a request; a full backlog drops the trace, not the turn.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .config import settings

log = logging.getLogger("traveliq.tracing")

# LangSmith accepts these run types; the pipeline uses a stage-appropriate one so
# the UI renders token counts and prompts for "llm" runs and documents for
# "retriever" runs: chain | llm | retriever | tool | parser | prompt | embedding.

_CLIP = 4_000        # longest string sent for any one input/output field
_UPLOAD_TIMEOUT = 10.0
_MAX_PENDING = 32    # uploads in flight before new traces are dropped, not queued


def enabled() -> bool:
    return bool(settings.langsmith_api_key.strip())


def status() -> dict[str, Any]:
    """What /health and /admin/observability report — configured or not, and
    where traces go, without ever echoing the key."""
    return {
        "enabled": enabled(),
        "project": settings.langsmith_project if enabled() else None,
        "endpoint": settings.langsmith_endpoint if enabled() else None,
    }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _segment(at: datetime, run_id: uuid.UUID) -> str:
    """One dotted_order segment, the SDK's own format: compact timestamp + id.
    LangSmith sorts siblings and nests children by this string."""
    return at.strftime("%Y%m%dT%H%M%S%fZ") + str(run_id)


def _jsonable(value: Any, depth: int = 0) -> Any:
    """Clip and coerce so the upload can never fail on size or a stray object.
    Anything unexpected becomes its repr rather than an exception."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= _CLIP else value[: _CLIP - 1] + "…"
    if depth >= 4:
        return str(value)[:_CLIP]
    if isinstance(value, dict):
        return {str(k): _jsonable(v, depth + 1) for k, v in list(value.items())[:50]}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v, depth + 1) for v in list(value)[:50]]
    return str(value)[:_CLIP]


class Span:
    """One run in the tree. Created via Trace.child(); ended exactly once —
    a second end() is ignored so an error path and a finally can both try."""

    __slots__ = ("id", "name", "run_type", "start", "ended", "dotted",
                 "parent_id", "inputs", "outputs", "error", "metadata")

    def __init__(self, name: str, run_type: str, parent_dotted: str,
                 parent_id: Optional[uuid.UUID], inputs: Optional[dict] = None) -> None:
        self.id = uuid.uuid4()
        self.name = name
        self.run_type = run_type
        self.start = _now()
        self.ended: Optional[datetime] = None
        seg = _segment(self.start, self.id)
        self.dotted = f"{parent_dotted}.{seg}" if parent_dotted else seg
        self.parent_id = parent_id
        self.inputs = _jsonable(inputs or {})
        self.outputs: dict = {}
        self.error: Optional[str] = None
        self.metadata: dict = {}

    def end(self, outputs: Optional[dict] = None, error: Optional[str] = None,
            **metadata: Any) -> None:
        if self.ended is not None:
            return
        self.ended = _now()
        if outputs:
            self.outputs = _jsonable(outputs)
        self.error = error
        if metadata:
            self.metadata = _jsonable(metadata)

    @property
    def elapsed_ms(self) -> float:
        return ((self.ended or _now()) - self.start).total_seconds() * 1000


class Trace:
    """The run tree for one turn. Always constructed — spans double as the stage
    timers for metrics.py — but finish() only uploads when a key is configured."""

    def __init__(self, name: str, inputs: Optional[dict] = None,
                 metadata: Optional[dict] = None, tags: Optional[list[str]] = None) -> None:
        self.root = Span(name, "chain", "", None, inputs)
        if metadata:
            self.root.metadata = _jsonable(metadata)
        self.tags = tags or []
        self.spans: list[Span] = [self.root]

    def child(self, name: str, run_type: str, inputs: Optional[dict] = None) -> Span:
        span = Span(name, run_type, self.root.dotted, self.root.id, inputs)
        self.spans.append(span)
        return span

    def finish(self, outputs: Optional[dict] = None, error: Optional[str] = None) -> None:
        # A stage that never reached its own end() inherits the turn's error —
        # visible in the UI as the run that was in flight when the turn died.
        for span in self.spans[1:]:
            if span.ended is None:
                span.end(error=error or "never completed")
        self.root.end(outputs=outputs, error=error)
        if enabled():
            _schedule([self._run_dict(span) for span in self.spans])

    def _run_dict(self, span: Span) -> dict:
        return {
            "id": str(span.id),
            "trace_id": str(self.root.id),
            "parent_run_id": str(span.parent_id) if span.parent_id else None,
            "dotted_order": span.dotted,
            "name": span.name,
            "run_type": span.run_type,
            "start_time": span.start.isoformat(),
            "end_time": (span.ended or _now()).isoformat(),
            "inputs": span.inputs,
            "outputs": span.outputs,
            "error": span.error,
            "session_name": settings.langsmith_project,
            "tags": self.tags if span is self.root else [],
            "extra": {"metadata": span.metadata} if span.metadata else {},
        }


def start_trace(name: str, inputs: Optional[dict] = None, metadata: Optional[dict] = None,
                tags: Optional[list[str]] = None) -> Trace:
    return Trace(name, inputs, metadata, tags)


# --- Upload ------------------------------------------------------------------

_client: Any = None
_pending: set[asyncio.Task] = set()
_warned = False


def _http():
    global _client
    if _client is None:
        import httpx  # already installed: it is the openai SDK's transport

        _client = httpx.AsyncClient(
            base_url=settings.langsmith_endpoint.rstrip("/"),
            headers={"x-api-key": settings.langsmith_api_key.strip()},
            timeout=_UPLOAD_TIMEOUT,
        )
    return _client


def _schedule(runs: list[dict]) -> None:
    """Fire-and-forget: tracing must never add latency to a turn, so the POST
    rides the event loop after the response and a full backlog drops the trace."""
    if len(_pending) >= _MAX_PENDING:
        log.debug("tracing backlog full (%d uploads in flight); dropping a trace", len(_pending))
        return
    try:
        task = asyncio.get_running_loop().create_task(_post(runs))
    except RuntimeError:  # no running loop (sync test harness) — drop, never raise
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _post(runs: list[dict]) -> None:
    global _warned
    try:
        resp = await _http().post("/runs/batch", json={"post": runs})
        if resp.status_code >= 400:
            _warn_once(f"LangSmith answered {resp.status_code}: {resp.text[:200]}")
        elif _warned:
            _warned = False
            log.info("LangSmith uploads recovered")
    except Exception as exc:  # noqa: BLE001 — observability must not break the app
        _warn_once(f"LangSmith upload failed: {exc!r}")


def _warn_once(message: str) -> None:
    """First failure at WARNING so the operator sees it, repeats at DEBUG so a
    wrong key does not write one warning per chat turn forever."""
    global _warned
    log.log(logging.DEBUG if _warned else logging.WARNING, "%s", message)
    _warned = True


async def aclose() -> None:
    """Shutdown: give in-flight uploads a moment, then close the client."""
    if _pending:
        await asyncio.wait(set(_pending), timeout=5)
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
