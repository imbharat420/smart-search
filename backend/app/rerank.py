"""Reranking a retrieval shortlist with the chat model as a cross-encoder.

Cosine similarity in rag.py scores a query and a trip as two vectors embedded
independently, so nothing ever attends across both — "quiet" and "nightlife" get
averaged into one blended point instead of being weighed against each other. A
real cross-encoder does attend across both, which is exactly why it is more
precise, but shipping one means a new dependency and a model download. A chat
model scoring a short candidate list *is* a cross-encoder — a much larger and
slower one — and this app already has the provider chain in llm.py wired up with
fallback. So the precision is bought with one extra completion per chat turn,
over a SHORTLIST ONLY, never the catalogue.

The escape hatch, deliberately not built: if the catalogue ever grows to where
one completion per turn is a real cost or latency problem, `RERANK_BACKEND=local`
would swap in a local cross-encoder. Until then `llm` is strictly better — one
already-budgeted API call and no new package.

Every failure path here returns the candidates untouched, and `rerank` reports
whether the model actually answered so the caller can name the honest retrieval
mode the way rag.py's `mode` already does. That mirrors the three fallbacks this
codebase already ships (rag.py's lexical scoring, nlq.py's heuristic parse,
llm.py's provider chain): a new capability degrades to the existing behaviour, it
never breaks it.
"""
from __future__ import annotations

import asyncio
import calendar
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Iterator, Optional

from . import llm
from .config import settings
from .schemas import Trip

log = logging.getLogger("traveliq.rerank")

# Beyond thirty candidates the prompt costs more than the ordering is worth: the
# tail of a shortlist is already weak, and a longer list makes the model spend
# its attention discriminating between trips nobody will scroll to.
MAX_CANDIDATES = 30

_MAX_REASON = 120  # the reason is shown to travellers, not a debug field
# No "rating" alias on purpose: the candidate line prints the trip's own rating
# ("4.5/5 from 10 reviews"), so a `rating` key in a row is far more likely echoed
# input than a relevance judgement, and 4.5 read as a score would wreck the order.
_SCORE_KEYS = ("score", "relevance", "relevanceScore", "relevance_score", "value")
_ID_KEYS = ("id", "tripId", "trip_id", "trip")
_REASON_KEYS = ("reason", "why", "explanation", "note", "justification")


@dataclass(frozen=True)
class Ranked:
    trip: Trip
    score: float  # 0..1 from the model
    reason: str   # short, why it fits — goes straight into the reply's explanation


_SYSTEM_PROMPT = """You are a relevance judge for a UK tour operator's own trip catalogue.

Score how well each candidate trip answers the traveller's request, from 0.00 (wrong trip
entirely) to 1.00 (an excellent fit). Judge only from the candidate lines you are given —
never invent a price, month, duration or theme that is not printed there.

Weigh a stated hard requirement (budget, departure month, trip length, destination) far
above a general taste signal. Pace is a soft preference, never a filter: a packed pace
favours shorter trips with denser activity lists, a slow one favours longer trips with
fewer. Where a request pulls in two directions, prefer the trips that satisfy both halves
over the ones that split the difference.

Reply with ONE JSON array and nothing else: no prose, no explanation, no markdown fences.
[{"id":"trip-14","score":0.91,"reason":"November departures, under £2,000, direct flights"}]

Include every candidate exactly once, best first. Keep each reason under twelve words, in
British English, naming the fields that made the trip fit rather than praising it."""


def _months(months: list[int]) -> str:
    named = [calendar.month_abbr[m] for m in months if 1 <= m <= 12]
    return ", ".join(named) if named else "on request"


def _candidate_line(trip: Trip) -> str:
    """The same fields chat.py's `_build_context` shows the model, compressed to
    one line. Ranking on a smaller view than the answer is written from is how a
    reranker ends up promoting a trip the prose then cannot justify."""
    return (
        f"- [{trip.id}] {trip.title} | {trip.destination.name}, {trip.destination.country} | "
        f"{trip.durationDays} days | from £{trip.priceFrom:,.0f} | "
        f"{trip.rating}/5 from {trip.reviewCount} reviews | {trip.climate} climate | "
        f"departs {_months(trip.months)} | "
        f"{'direct flights' if trip.directFlights else 'connecting flights'} | "
        f"up to {trip.groupSizeMax} travellers\n"
        f"    themes: {', '.join(trip.themes) or 'none listed'}; "
        f"activities: {', '.join(trip.activities) or 'none listed'}; "
        f"suits: {', '.join(trip.audience) or 'anyone'}"
    )


def _messages(query: str, plan_line: str, candidates: list[Trip]) -> list[dict]:
    parts = [f"REQUEST: {query.strip() or '(nothing stated — rank on general quality)'}"]
    if plan_line.strip():
        # Built by plan.summary_line(); passed in as text on purpose, so this
        # module stays a ranking function with no knowledge of slots.
        parts.append(f"WHAT THE TRAVELLER HAS TOLD US SO FAR: {plan_line.strip()}")
    parts.append("CANDIDATES:")
    parts.extend(_candidate_line(t) for t in candidates)
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(parts)},
    ]


async def _complete(messages: list[dict]) -> str:
    """llm.py only exposes a streaming entry point, so collect the stream here —
    the same shape nlq.py uses to get JSON out of a chat model."""
    parts: list[str] = []
    async for token in llm.stream_chat(messages, temperature=0.0):
        parts.append(token)
    return "".join(parts)


# --- Defensive parsing -----------------------------------------------------
# The reply is JSON by instruction only. Everything below assumes the model
# ignored part of that instruction, because over six providers some of them will.

def _array_end(text: str, start: int) -> Optional[int]:
    """Index of the `]` closing the `[` at `start`, or None. Quoted spans are
    skipped rather than counted: a reason like "under £2,000] all in" would
    otherwise close the array early and cost the whole rerank."""
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        char = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return i
    return None


def _arrays(text: str) -> Iterator[list]:
    """Every complete JSON array in the reply, in the order they start. Bracket
    counting also reaches the array inside `{"results": [...]}`, so an object
    wrapper costs nothing, and json.loads catches any place the counting got it
    wrong (a stray `[` inside prose, say) instead of trusting it."""
    for start, char in enumerate(text):
        if char != "[":
            continue
        end = _array_end(text, start)
        if end is None:
            continue
        try:
            payload = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, list):
            yield payload


def _rows(reply: str) -> Optional[list]:
    """The first array that actually holds rows. Not simply the first array: a
    model wrapping its answer in an object often prints something else first
    (`{"months":[11,12],"results":[...]}`), and taking that one would throw away
    a perfectly good rerank."""
    text = re.sub(r"```(?:json)?", " ", reply).strip()
    for rows in _arrays(text):
        if any(isinstance(row, (dict, str)) for row in rows):
            return rows
    return None


def _pick(row: dict, keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _as_score(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(str(value).strip().rstrip("%"))
    except ValueError:
        return None
    # Asked for 0.00-1.00, models still answer 0-100 often enough to matter, and
    # a value above 1 is far more likely a percentage than a runaway weight.
    if number > 1.0:
        number /= 100.0
    return round(min(1.0, max(0.0, number)), 4)


def _positional(position: int, total: int) -> float:
    """A score from the row's place in the reply. The prompt asks for best first,
    so position is a real signal whenever an explicit number is missing."""
    return round(max(0.0, 1.0 - position / max(1, total)), 4)


def _as_reason(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = re.sub(r"\s+", " ", value).strip(" .;-")
    return text[:_MAX_REASON]


def _scored(rows: list, candidates: list[Trip]) -> list[Ranked]:
    """Rows the model returned, matched onto the shortlist. Ids are matched
    case-insensitively and anything not in the shortlist is dropped — a model
    that invents a trip id must not be able to invent a trip."""
    by_id = {t.id.lower(): t for t in candidates}
    seen: set[str] = set()
    out: list[Ranked] = []
    for position, row in enumerate(rows):
        if isinstance(row, str):
            # Some models drop the objects and return a bare ordered id list.
            # Position is then the only signal, so honour it as the score.
            row = {"id": row, "score": _positional(position, len(rows))}
        if not isinstance(row, dict):
            continue
        raw_id = _pick(row, _ID_KEYS)
        if not isinstance(raw_id, str):
            continue
        trip = by_id.get(raw_id.strip().lower())
        if trip is None or trip.id in seen:
            continue
        score = _as_score(_pick(row, _SCORE_KEYS))
        if score is None:
            # An id with no usable score still carries the ordering — the same
            # signal a bare-string row carries. Dropping the row instead would
            # discard a whole valid rerank (ids, reasons and all) over one
            # missing field, which is the opposite of parsing defensively.
            score = _positional(position, len(rows))
        seen.add(trip.id)
        out.append(Ranked(trip=trip, score=score, reason=_as_reason(_pick(row, _REASON_KEYS))))
    return out


def _with_forgotten(ranked: list[Ranked], candidates: list[Trip]) -> list[Ranked]:
    """Anything the model omitted goes on the END in its original relative order.
    A rerank reorders a shortlist; it is not allowed to delete from one, so a
    trip retrieval found can never disappear because a model ran out of tokens.
    Their reason stays empty: the model never judged them, and writing a reason
    on its behalf would be a fabrication in traveller-facing copy."""
    judged = {r.trip.id for r in ranked}
    return [*ranked, *(Ranked(trip=t, score=0.0, reason="") for t in candidates if t.id not in judged)]


def _unranked(candidates: list[Trip], limit: Optional[int]) -> tuple[list[Ranked], bool]:
    """Stage-A ordering, untouched, with the flag saying no rerank happened.

    Always the FULL candidate list, never the MAX_CANDIDATES shortlist: the cap
    exists to bound a prompt, and no prompt was answered here. Handing back fewer
    trips because a provider timed out would make a failure visible as missing
    results, which is exactly the degradation this module is meant to avoid."""
    return [Ranked(trip=t, score=0.0, reason="") for t in candidates][:limit], False


# --- Entry point -----------------------------------------------------------

async def rerank(
    query: str,
    plan_line: str,
    candidates: list[Trip],
    *,
    limit: Optional[int] = None,
) -> tuple[list[Ranked], bool]:
    """Reorder a shortlist. Returns (ranked, reranked) — the bool says whether the
    model actually answered, so the caller can report the honest retrieval mode
    the way rag.py's `mode` already does rather than implying a rerank that did
    not happen. Never raises."""
    if not candidates:
        return [], False
    if not settings.rerank_enabled:
        log.debug("rerank disabled; keeping the retrieval order for %d candidates", len(candidates))
        return _unranked(candidates, limit)
    if not llm.chat_providers():
        log.debug("no chat provider configured; keeping the retrieval order")
        return _unranked(candidates, limit)

    shortlist = candidates[:MAX_CANDIDATES]
    if len(candidates) > MAX_CANDIDATES:
        # Silent truncation reads as "ranked everything" when it did not, and the
        # dropped ids are the only way to tell that from a genuine ordering.
        log.debug(
            "rerank capped at %d candidates; dropped %s",
            MAX_CANDIDATES,
            ", ".join(t.id for t in candidates[MAX_CANDIDATES:]),
        )

    try:
        reply = await asyncio.wait_for(
            _complete(_messages(query, plan_line, shortlist)),
            timeout=settings.rerank_timeout,
        )
    except asyncio.TimeoutError:
        log.info(
            "rerank exceeded its %.1fs budget; keeping the retrieval order",
            settings.rerank_timeout,
        )
        return _unranked(candidates, limit)
    except Exception as exc:  # noqa: BLE001 — the retrieval order is a complete answer
        log.warning("rerank failed (%s); keeping the retrieval order", exc)
        return _unranked(candidates, limit)

    rows = _rows(reply)
    if rows is None:
        log.warning("rerank reply held no JSON array; keeping the retrieval order")
        return _unranked(candidates, limit)

    ranked = _scored(rows, shortlist)
    if not ranked:
        # An array arrived but nothing in it matched the shortlist, which is the
        # same situation as no reply at all — do not claim a rerank for it.
        log.warning("rerank scored none of the %d candidates; keeping the retrieval order", len(shortlist))
        return _unranked(candidates, limit)

    # Sort here rather than trusting the reply's order: the score is what was
    # asked for, and the original position breaks ties so equal scores keep the
    # retrieval order instead of shuffling between turns.
    order = {t.id: i for i, t in enumerate(shortlist)}
    ranked.sort(key=lambda r: (-r.score, order[r.trip.id]))
    log.info("reranked %d of %d candidates, top score %.2f", len(ranked), len(shortlist), ranked[0].score)
    return _with_forgotten(ranked, shortlist)[:limit], True
