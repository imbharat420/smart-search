"""Grounded, streaming trip advice.

The order of the chunks is the contract the Assistant screen renders against:
the parsed query first (so the chips appear before any prose), then the trips it
retrieved (so the cards are there while the answer is still arriving), then the
tokens, then the citations, then done.

Everything the model says has to come from the trips and the one policy fed to it
as CONTEXT. The model itself comes from llm.py's provider chain, so a
rate-limited or down provider is retried on the next one instead of failing the
request.
"""
from __future__ import annotations

import calendar
from typing import AsyncGenerator, Optional

from . import llm, nlq
from .config import settings
from .rag import index
from .schemas import ChatChunk, Citation, Message, ParsedQuery, Trip

SYSTEM_PROMPT = (
    "You are TravelIQ, the trip-planning assistant for a UK tour operator. "
    "Answer ONLY from the TRIPS and POLICY in the CONTEXT below. Never invent a trip, "
    "price, duration, departure month, rating or policy detail that is not there. "
    "Prices are pounds sterling — write them as £1,240. Use British English. "
    "Name each trip by its exact title and cite its id in square brackets the first time you "
    "mention it, like [trip-14]; cite the policy id the same way when you answer a booking, "
    "cancellation, baggage or financial-protection question. "
    "Say why each trip fits what was asked — the month, the theme, the party, the budget, "
    "whether the flights are direct. "
    "If the context holds nothing suitable, say so plainly and suggest one way to widen the "
    "search (a different month, a higher budget, connecting flights). "
    "Keep it to a few sentences: the trips appear as cards beneath your reply."
)


def _months(months: list[int]) -> str:
    named = [calendar.month_abbr[m] for m in months if 1 <= m <= 12]
    return ", ".join(named) if named else "on request"


def _request_line(parsed: ParsedQuery) -> str:
    """The structured read of the traveller's sentence, so the model can explain
    a match in the same terms the chips on screen use."""
    bits: list[str] = []
    if parsed.destination:
        bits.append(f"destination {parsed.destination}")
    if parsed.months:
        bits.append(f"months {_months(parsed.months)}")
    if parsed.durationDays:
        bits.append(f"about {parsed.durationDays} days")
    if parsed.maxPrice:
        bits.append(f"budget up to £{parsed.maxPrice:,.0f}")
    if parsed.themes:
        bits.append("themes " + ", ".join(parsed.themes))
    if parsed.activities:
        bits.append("activities " + ", ".join(parsed.activities))
    if parsed.audience:
        bits.append("party " + ", ".join(parsed.audience))
    if parsed.climate:
        bits.append(f"{parsed.climate} climate")
    if parsed.groupSizeMax:
        bits.append(f"group of up to {parsed.groupSizeMax}")
    if parsed.directFlights:
        bits.append("direct flights only")
    return "; ".join(bits)


def _build_context(trips: list[Trip], policy: Optional[dict], parsed: ParsedQuery) -> str:
    parts: list[str] = []
    request = _request_line(parsed)
    if request:
        parts.append(f"REQUEST (read by the {parsed.source} query parser, may be incomplete):")
        parts.append(f"- {request}")
    if trips:
        parts.append("\nTRIPS:")
        for t in trips:
            flights = "direct flights" if t.directFlights else "connecting flights"
            status = "available" if t.available else "SOLD OUT for now"
            parts.append(
                f"- [{t.id}] {t.title} | {t.destination.name}, {t.destination.country} | "
                f"{t.durationDays} days | from £{t.priceFrom:,.0f} | "
                f"{t.rating}/5 from {t.reviewCount} reviews | {t.climate} climate | "
                f"departs {_months(t.months)} | {flights} | "
                f"up to {t.groupSizeMax} travellers | {status}\n"
                f"    themes: {', '.join(t.themes) or 'none listed'}; "
                f"activities: {', '.join(t.activities) or 'none listed'}; "
                f"suits: {', '.join(t.audience) or 'anyone'}\n"
                f"    {t.summary}"
            )
    if policy:
        parts.append("\nPOLICY:")
        parts.append(f"- [{policy['id']}] {policy['label']}: {policy['body']}")
    if not parts:
        parts.append("(no matching trips or policies were found)")
    return "\n".join(parts)


def _citations(trips: list[Trip], policy: Optional[dict]) -> list[Citation]:
    """Mirrors the context rather than the inline cards, so a bracketed id in the
    prose always resolves — even for a trip that did not get a card."""
    cites: list[Citation] = []
    if policy:
        cites.append(
            Citation(id=f"cite-{policy['id']}", label=policy["label"], sourceId=policy["id"])
        )
    for t in trips:
        cites.append(Citation(id=f"cite-{t.id}", label=t.title, sourceId=t.id))
    return cites


async def _stream_words(note: str) -> AsyncGenerator[ChatChunk, None]:
    """Deliver a canned message through the same token-by-token contract."""
    for word in note.split(" "):
        yield ChatChunk(token=word + " ")


async def stream_chat(
    messages: list[Message], trips: list[Trip]
) -> AsyncGenerator[ChatChunk, None]:
    last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")

    parsed = await nlq.parse(last_user)
    yield ChatChunk(parsed=parsed)

    retrieved, policy = await index.retrieve_for_chat(last_user, trips)
    grounded = retrieved[: settings.chat_top_k]
    inline = retrieved[: settings.inline_products]
    if inline:
        yield ChatChunk(trips=inline)

    if llm.chat_providers():
        context = _build_context(grounded, policy, parsed)
        oai_messages = [{"role": "system", "content": f"{SYSTEM_PROMPT}\n\nCONTEXT:\n{context}"}]
        # Carry a short window of history for follow-up questions.
        for m in messages[-8:]:
            role = m.role if m.role in ("user", "assistant") else "user"
            oai_messages.append({"role": role, "content": m.content})
        try:
            async for token in llm.stream_chat(oai_messages):
                yield ChatChunk(token=token)
        except llm.AllProvidersFailed as exc:
            # Every provider in the chain refused. Say so, but the retrieved trips
            # below still stand — the useful half of the answer survives.
            note = (
                f"Every model provider is unavailable right now ({exc}). "
                "The trips below are still the ones TravelIQ retrieved for that question."
            )
            async for chunk in _stream_words(note):
                yield chunk
    else:
        note = (
            "Chat needs an API key — " + llm.missing_key_hint() + " in backend/.env and restart "
            "the API. Search, filtering and the trips below all work without it, so this is the "
            "only feature waiting on a key."
        )
        async for chunk in _stream_words(note):
            yield chunk

    cites = _citations(grounded, policy)
    if cites:
        yield ChatChunk(citations=cites)

    yield ChatChunk(done=True)
