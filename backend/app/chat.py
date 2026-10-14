"""Grounded, streaming trip advice, over an explicit conversational plan.

The order of the chunks is the contract the Assistant screen renders against:
the parsed query first (so the chips appear before any prose), then the plan state
(so the summary panel updates immediately), then the trips it retrieved (so the
cards are there while the answer is still arriving), then the quick replies the
turn is asking with, then the tokens, then the citations, then done.

Everything the model says has to come from the trips and the one policy fed to it
as CONTEXT. The model itself comes from llm.py's provider chain, so a
rate-limited or down provider is retried on the next one instead of failing the
request.

What this module adds over a stateless question-and-answer:

  * **A plan, not a transcript.** plan.py holds six slots — duration, budget,
    region, holiday type, pace, group size — merged from every turn and persisted
    by sessions.py. The model is handed that one line instead of eight turns of
    scrollback, so "actually make it Asia" is a field write rather than a
    contradiction it has to notice and resolve. The dialogue window that remains
    (`assistant_history_turns`) carries tone and "what did I just say", nothing more.
  * **Candidate generation, then reranking.** rag.py's search produces a shortlist;
    graph.py narrows it first when the plan names a region, because a region is a
    set of countries and no single embedding expresses one; rerank.py then orders
    the shortlist with the chat model, which attends to query and candidate
    together in a way two independently embedded vectors cannot.
  * **A question that never gates an answer.** plan.next_question only ever
    returns copy. Retrieval has already run by the time it is consulted, so a
    traveller who skips all six slots still gets trips.

Every one of those degrades rather than fails: no session id means an empty plan,
an unbuilt graph means the unrestricted pool, a rerank that times out means the
retrieval order, and no provider at all still returns the cards. Those are the
same fallbacks rag.py, nlq.py and llm.py already document, and for the same
reason — the useful half of an answer is worth more than a clean error.
"""
from __future__ import annotations

import asyncio
import calendar
import logging
from typing import Any, AsyncGenerator, Optional

from . import events, graph, llm, nlq, plan, rerank, sessions, tracing
from .config import settings
from .metrics import metrics
from .rag import index, policy_by_keyword as rag_policy_keyword
from .schemas import (
    ChatChunk,
    Citation,
    Message,
    ParsedQuery,
    Promotion,
    QuickReplyGroup,
    StoredMessage,
    Synonym,
    Trip,
    TripPlanState,
)

log = logging.getLogger("traveliq.chat")

# The persona name is TravelIQ because that is what the UI says on screen
# (src/pages/Assistant.tsx). docs/assistant-rag-architecture.md §4 writes the same
# prompt as "SmartSearch" — swapping it is this one string plus the frontend copy.
SYSTEM_PROMPT = (
    "You are TravelIQ, the trip-planning assistant for a UK tour operator. "
    "You have access ONLY to this operator's own catalogue, retrieved for you and given "
    "below as CONTEXT. You have no internet access and there are no external travel APIs "
    "in this system. "
    "Answer ONLY from the TRIPS and POLICY in the CONTEXT. Never invent a trip, "
    "price, duration, departure month, rating or policy detail that is not there. "
    "Prices are pounds sterling — write them as £1,240. Use British English. "
    "Name each trip by its exact title, and cite its id in square brackets immediately after "
    "the title the first time you mention it, like 'Lofoten Explorer [trip-14]'; cite the "
    "policy id the same way when you answer a booking, cancellation, baggage or "
    "financial-protection question. The app renders each bracketed id as a small numbered "
    "source marker, so never write an id outside square brackets and never refer to a trip "
    "by its id in prose — the title is the name, the bracket is the citation. "
    "Say why each trip fits what was asked — the month, the theme, the party, the budget, "
    "whether the flights are direct — in the traveller's own terms rather than generic praise. "
    "\n\n"
    "PLAN. The CONTEXT may carry a PLAN line: the six things you are tracking about this "
    "trip so far. Treat it as already established — never re-ask for something it holds. "
    "A slot marked (worth re-confirming) should be checked in one short clause, not asked "
    "from scratch. "
    "\n\n"
    "IMPOSSIBLE REQUESTS. If what was asked cannot be met by the catalogue — a budget too "
    "low for the destination, a duration too short for the route — never say it is "
    "impossible and never argue from general knowledge. Acknowledge the intent warmly, show "
    "what the retrieved trips actually cost or take, and offer one concrete alternative from "
    "the CONTEXT as a choice rather than a substitution you have already made for them. "
    "\n\n"
    "CONTRADICTIONS. If the request pulls two ways at once — quiet but lively, remote but "
    "connected — say in one sentence how you are reconciling it, then answer for both halves "
    "rather than averaging them away. Invite a correction if you may have read it backwards. "
    "\n\n"
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


def _plan_line(state: TripPlanState) -> str:
    """The plan as one line, with any stale slot flagged so the model re-confirms
    it in a clause instead of asking again from nothing."""
    line = plan.summary_line(state)
    if not line:
        return ""
    if state.unconfirmed:
        line += f" (worth re-confirming: {', '.join(state.unconfirmed)})"
    return line


def _turn_directive(state: TripPlanState, question: Optional[QuickReplyGroup]) -> str:
    """What this turn should do about asking, decided here rather than left to the
    model's judgement — that is what makes the loop-break a rule.

    Three cases: there is a question worth putting, there is nothing left worth
    asking (so say so and move on), or the plan is complete and needs no comment.
    """
    if question is not None:
        return (
            f"NEXT QUESTION: after your answer, ask about the traveller's "
            f"{question.slot} in one short sentence — the sense of "
            f'"{question.prompt}", in your own words. Tappable options and a skip are '
            "already on screen beneath your reply, so do NOT list them in prose and do "
            "not invent options of your own."
        )
    if plan.missing(state):
        # Every remaining slot hit its ceiling: the traveller has skipped or
        # reversed enough times that asking again would be the loop the brief
        # names. Commit to what we have and say we are doing so.
        return (
            "NEXT QUESTION: none — stop asking. The traveller has skipped or changed "
            "these enough times that asking again would go in circles. Say in one short "
            "sentence that you are going ahead with what you have, summarise the plan "
            "back to them, and leave the door open for them to narrow it."
        )
    return "NEXT QUESTION: none — the plan is complete. Do not ask for more preferences."


def _build_context(
    trips: list[Trip],
    policy: Optional[dict],
    parsed: ParsedQuery,
    state: TripPlanState,
    directive: str,
    widened: list[str],
) -> str:
    parts: list[str] = []
    plan_line = _plan_line(state)
    if plan_line:
        parts.append("PLAN (established over the conversation — do not re-ask for these):")
        parts.append(f"- {plan_line}")
    request = _request_line(parsed)
    if request:
        parts.append(f"\nREQUEST (read by the {parsed.source} query parser, may be incomplete):")
        parts.append(f"- {request}")
    if widened:
        # Named explicitly so the reply can own the compromise. Without this the
        # model would present a 7-day trip as the answer to "ten days" and look
        # like it had not been listening.
        parts.append(
            "\nWIDENED: nothing in the catalogue matched every requirement, so the trips below "
            f"are without {' and without '.join(widened)}. Say so plainly in your reply — name "
            "what you had to stretch and offer to narrow it a different way."
        )
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
    if not trips and not policy:
        parts.append("(no matching trips or policies were found)")
    parts.append(f"\n{directive}")
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


# --- Plan state ------------------------------------------------------------

async def _load_state(session_id: Optional[str]) -> TripPlanState:
    """The plan so far. No session id means a fresh one every turn, which is
    exactly how /chat behaved before state existed — a client that does not send
    one loses the memory, not the answer."""
    if not session_id:
        return TripPlanState()
    return await sessions.store().load(session_id)


def _advance(
    state: TripPlanState,
    parsed: ParsedQuery,
    text: str,
    trips: list[Trip],
    slot_patch: Optional[dict[str, Any]],
) -> TripPlanState:
    """Fold this turn into the plan.

    Two patches, in this order and for this reason: what the sentence said, then
    what a chip tap said. The tap is exact — it carries the slot value rather than
    a label the parser would have to read back — so it goes last and wins any
    field they both touch.
    """
    merged = plan.merge(state, plan.patch_from_parsed(parsed, text, trips))
    if slot_patch:
        merged = plan.merge(merged, slot_patch)
    # turnCount is the caller's job precisely because of the two-patch case above:
    # one turn, two merges, one increment.
    return merged.model_copy(update={"turnCount": merged.turnCount + 1})


def _announce_changes(
    before: TripPlanState, after: TripPlanState, session_id: Optional[str]
) -> list[str]:
    """Publish the slots this turn moved and return them.

    Anything caching per-session candidates needs to know its answer is stale.
    Nothing subscribes today — the value is that the signal exists at the moment
    the change is known, rather than having to be reconstructed later from a diff
    nobody kept. The return value is used locally to tell a planning turn from a
    booking-conditions one.
    """
    moved = plan.changed_slots(before, after)
    if moved and session_id:
        events.bus.publish(events.SESSION_SLOT_CHANGED, {"sessionId": session_id, "slots": moved})
    return list(moved)


async def _save_state(session_id: Optional[str], state: TripPlanState) -> None:
    if session_id:
        await sessions.store().save(session_id, state)


async def _save_transcript(
    session_id: Optional[str],
    *,
    question: str,
    reply: str,
    trips: list[Trip],
    citations: list[Citation],
    quick_replies: Optional[QuickReplyGroup],
    parsed: Optional[ParsedQuery],
    served: dict[str, str],
) -> None:
    """The turn as the traveller saw it, into the session store: their question
    and the reply, with everything the reply carried (trip cards as ids, the
    citation list, the chips, which provider answered) in one payload blob.
    Written once per turn next to _save_state, and like it, never raising — the
    store already downgrades every failure to a warning."""
    if not session_id or not question:
        return
    payload: dict[str, Any] = {}
    if trips:
        # Ids only: /chat/history re-reads the catalogue, so a reprice or a title
        # edit shows current data instead of a copy frozen at chat time.
        payload["tripIds"] = [t.id for t in trips]
    if citations:
        payload["citations"] = [c.model_dump() for c in citations]
    if quick_replies:
        payload["quickReplies"] = quick_replies.model_dump(exclude_none=True)
    if parsed:
        payload["parsed"] = parsed.model_dump(exclude_none=True)
    if served.get("provider"):
        payload["provider"] = served["provider"]
        if served.get("model"):
            payload["model"] = served["model"]
    await sessions.store().append_messages(
        session_id,
        [
            StoredMessage(role="user", content=question),
            StoredMessage(role="assistant", content=reply, payload=payload),
        ],
    )
    # First turn labels the chat with the traveller's own words — ensure_title
    # only fills an empty label, so later turns and renames are never clobbered.
    await sessions.store().ensure_title(session_id, _chat_title(question))


def _chat_title(question: str) -> str:
    """A list label from the opening question: one line, tidy length. Word-boundary
    truncation because 'Northern lights trip for a fam…' reads worse than one word
    fewer. The traveller can rename it; this is just a sensible default."""
    one_line = " ".join(question.split())
    if len(one_line) <= 60:
        return one_line
    cut = one_line[:60]
    head, _, _ = cut.rpartition(" ")
    return f"{head or cut}…"


# --- Retrieval -------------------------------------------------------------

def _region_pool(state: TripPlanState, trips: list[Trip]) -> list[Trip]:
    """Narrow the candidate pool to the plan's region, via the graph.

    This is the one thing a vector search genuinely cannot do for us: a region is
    a SET of countries, and ParsedQuery.destination is a single string, so there
    is no query text that means "anywhere in Asia" (see plan.to_parsed for the
    trap that follows from trying). The graph holds a country index, so expanding
    the bucket and filtering by id is exact.

    Falls back to the full catalogue whenever the narrowing would empty it — an
    unbuilt graph, a bucket with no trips — because a dead end is worse than a
    loose match, and rag.py's ranking will push the wrong continent down anyway.
    """
    if not state.region:
        return trips
    countries = plan.region_buckets(trips).get(state.region)
    if not countries:
        return trips
    wanted = set(graph.graph.trips_in_countries(countries))
    pool = [t for t in trips if t.id in wanted]
    if not pool:
        log.debug("region %s narrowed the pool to nothing; searching the full catalogue", state.region)
        return trips
    return pool


def _retrieval_query(text: str, slot_patch: Optional[dict[str, Any]], state: TripPlanState) -> str:
    """The text to retrieve on, which is not always what the traveller "said".

    A tapped chip puts its own label in the transcript — "Surprise me!", "Luxury
    £3k+", "Skip — any length". Those are interface copy, not search terms, and
    handing one to rag.py is actively harmful: with no constraints to fall back on
    it gates every trip below the relevance floor and returns nothing, so tapping a
    chip would empty the results. The plan is the real query for those turns, and
    an empty string when the plan is empty too — rag.py reads that as browsing and
    ranks on the catalogue's own quality signal, which is exactly right for
    "surprise me".
    """
    if slot_patch:
        return plan.summary_line(state)
    return text


# Which ParsedQuery field each relaxable constraint lives on, so a widening can
# clear it. Keyed by rag.py's `_Constraint.field`, which is also its facet key.
_RELAXABLE: dict[str, str] = {
    "destination": "destination",
    "month": "months",
    "maxPrice": "maxPrice",
    "duration": "durationDays",
    "climate": "climate",
    "directOnly": "directFlights",
    "groupSize": "groupSizeMax",
}

# How many constraints we will drop before giving up. Two, because past that the
# answer stops resembling the question — better to return nothing and say so than
# to quietly answer something else.
_MAX_WIDENINGS = 2


async def _search(
    query: str,
    parsed: ParsedQuery,
    pool: list[Trip],
    promotions: list[Promotion],
    synonyms: list[Synonym],
) -> tuple[list[Trip], str]:
    results, _, mode = await index.search(query, parsed, None, pool, promotions, synonyms)
    return [r.trip for r in results], mode


async def _candidates(
    query: str,
    parsed: ParsedQuery,
    state: TripPlanState,
    trips: list[Trip],
    promotions: list[Promotion],
    synonyms: list[Synonym],
) -> tuple[list[Trip], str, list[str]]:
    """The shortlist to rerank, the retrieval mode, and anything that had to be
    widened to fill it.

    The constraints rag.py builds are conjunctive, so a rich sentence — "family of
    four, beach, Italy, ten days, under £2,500" — can easily describe a trip the
    catalogue does not sell and come back with nothing. /search answers that with
    `suggestions()` and lets the traveller click; a conversation cannot, so this
    does the relaxing itself: drop the constraint costing the most results, search
    again, and hand the labels to the model so the reply says which requirement it
    had to stretch. Answering the question that was nearly asked, and admitting it,
    beats a dead end — that is the brief's "never say impossible" rule with a
    retrieval mechanism behind it rather than just a tone of voice.
    """
    effective = plan.to_parsed(state, parsed, trips)
    pool = _region_pool(state, trips)
    found, mode = await _search(query, effective, pool, promotions, synonyms)

    widened: list[str] = []
    while not found and len(widened) < _MAX_WIDENINGS:
        options = [r for r in index.relaxations(effective, None, pool) if r.field in _RELAXABLE]
        if not options:
            break
        best = options[0]  # relaxations() is already sorted by how many trips it returns
        effective = effective.model_copy(update={_RELAXABLE[best.field]: None})
        widened.append(best.label)
        found, mode = await _search(query, effective, pool, promotions, synonyms)
        log.info("no match; widened by dropping %s -> %d trips", best.field, len(found))

    if not found:
        # Nothing matched and there was no constraint left to drop, which is the
        # "somewhere nice" case: the sentence carries no requirement to relax, and
        # its words ("nice", "surprise me") appear in no trip, so the relevance
        # floor gates the whole catalogue. An empty query is how rag.py is told this
        # is browsing rather than searching — it then ranks on rating, review count
        # and live promotions, which is exactly the "here's what's popular right
        # now" answer a vague request deserves. Not recorded as a widening: nothing
        # was given up, so there is nothing for the reply to apologise for.
        found, mode = await _search("", effective, pool, promotions, synonyms)
        log.info("query carried no retrievable signal; browsing by rating -> %d trips", len(found))

    return found[: settings.rerank_candidates], mode, widened


def _is_policy_turn(query: str, moved: list[str]) -> bool:
    """Is this a booking-conditions question rather than a planning one?

    Asking "and what's your budget?" after "how much is the deposit?" is the kind
    of non-sequitur that makes an assistant feel automated, so the plan question is
    suppressed for these turns.

    The test is the keyword hit rather than the parse. An earlier version asked
    whether the parser had read anything about a trip out of the sentence, and that
    failed in practice: the AI layer returns a theme and a confidence for "what is
    your cancellation policy?" often enough that the suppression never fired. The
    words in the sentence do not have that problem.

    A turn that does both — "10 days in Iceland, and what's the deposit?" — moved a
    slot, so it keeps its question. That is the right way round to be wrong: the
    cost of asking one question too many is much lower than the cost of derailing a
    policy answer.
    """
    return rag_policy_keyword(query) is not None and not moved


# --- Entry point -----------------------------------------------------------

async def stream_chat(
    messages: list[Message],
    trips: list[Trip],
    *,
    promotions: Optional[list[Promotion]] = None,
    synonyms: Optional[list[Synonym]] = None,
    session_id: Optional[str] = None,
    slot_patch: Optional[dict[str, Any]] = None,
) -> AsyncGenerator[ChatChunk, None]:
    last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")

    # One trace per turn, its children the §1.2 pipeline stages by name. The spans
    # are also the stage timers for metrics.py, so they are built whether or not a
    # LangSmith key is configured; only the upload is conditional (tracing.py).
    turn = tracing.start_trace(
        "chat_turn",
        inputs={"question": last_user, "slotPatch": slot_patch},
        metadata={"sessionId": session_id, "historyMessages": len(messages)},
        tags=["assistant"],
    )
    metrics.increment("chat_turns")
    turn_error: Optional[str] = None
    reply_parts: list[str] = []
    grounded: list[Trip] = []
    state: Optional[TripPlanState] = None
    # Filled by the on_provider callback below; hoisted so the transcript save at
    # the end of the turn can record who answered even on the no-provider paths.
    served: dict[str, str] = {}

    try:
        span = turn.child("nlq.parse", "parser", inputs={"text": last_user})
        before = await _load_state(session_id)
        parsed = await nlq.parse(last_user)
        span.end(
            outputs={"request": _request_line(parsed) or None},
            source=parsed.source,
            confidence=parsed.confidence,
        )
        metrics.observe("nlq.parse", span.elapsed_ms)
        yield ChatChunk(parsed=parsed)

        span = turn.child("plan.merge", "chain", inputs={"slotPatch": slot_patch})
        state = _advance(before, parsed, last_user, trips, slot_patch)
        moved = _announce_changes(before, state, session_id)
        span.end(outputs={"plan": plan.summary_line(state) or None, "movedSlots": moved})
        metrics.observe("plan.merge", span.elapsed_ms)
        yield ChatChunk(state=state)

        query = _retrieval_query(last_user, slot_patch, state)

        async def _retrieve() -> tuple[list[Trip], str, list[str]]:
            span = turn.child(
                "retrieve", "retriever",
                inputs={"query": query, "plan": plan.summary_line(state) or None},
            )
            shortlist, mode, widened = await _candidates(
                query, parsed, state, trips, promotions or [], synonyms or []
            )
            span.end(
                outputs={"candidates": [t.title for t in shortlist], "mode": mode, "widened": widened},
                region=state.region,
            )
            metrics.observe("retrieve", span.elapsed_ms)
            return shortlist, mode, widened

        async def _policy() -> Optional[dict]:
            # The policy lookup keeps the traveller's actual words: it is a keyword and
            # embedding match over four documents, so a chip label simply matches none of
            # them, which is the right answer for a turn that is not asking about policy.
            span = turn.child("policy.retrieve", "retriever", inputs={"query": last_user})
            found = await index.retrieve_policy(last_user)
            span.end(outputs={"policy": found["label"] if found else None})
            metrics.observe("policy.retrieve", span.elapsed_ms)
            return found

        # Neither depends on the other's result, so run them concurrently —
        # this used to be two sequential awaits on the critical path.
        (shortlist, mode, widened), policy = await asyncio.gather(_retrieve(), _policy())
        if widened:
            metrics.increment("widened_turns")
        if not shortlist:
            metrics.increment("zero_result_turns")

        # Reranking runs before the cards go out rather than after. Sending the
        # similarity order first and then reordering it would make the cards visibly
        # reshuffle under the reader, which is worse than the second or two this costs
        # — and the parsed chips and plan panel have already rendered by now, so the
        # screen is not idle while it happens.
        span = turn.child(
            "rerank", "llm",
            inputs={"query": query, "plan": plan.summary_line(state) or None,
                    "shortlist": len(shortlist)},
        )
        ranked, reranked = await rerank.rerank(
            query, plan.summary_line(state), shortlist, limit=settings.chat_top_k
        )
        span.end(
            outputs={
                "served": reranked,
                "order": [
                    {"title": r.trip.title, "score": r.score, "reason": r.reason} for r in ranked
                ],
            },
        )
        metrics.observe("rerank", span.elapsed_ms, error=not reranked and settings.rerank_enabled)
        metrics.increment("rerank_served" if reranked else "rerank_fallback")

        grounded = [r.trip for r in ranked]
        inline = grounded[: settings.inline_products]
        if inline:
            yield ChatChunk(trips=inline)
        log.info(
            "chat turn %d: %d candidates (%s%s) -> %d grounded, rerank=%s",
            state.turnCount,
            len(shortlist),
            mode,
            f", widened: {'; '.join(widened)}" if widened else "",
            len(grounded),
            "on" if reranked else "off",
        )

        if _is_policy_turn(last_user, moved):
            question = None
            metrics.increment("policy_turns")
        else:
            question = plan.next_question(state, trips)
        if question is not None:
            # Record the question we actually put, so a slot asked twice trips the
            # ceiling even when the traveller answered something else both times.
            state = plan.merge(state, {"asked": question.slot})
            yield ChatChunk(quickReplies=question)

        if llm.chat_providers():
            context = _build_context(
                grounded, policy, parsed, state, _turn_directive(state, question), widened
            )
            oai_messages = [{"role": "system", "content": f"{SYSTEM_PROMPT}\n\nCONTEXT:\n{context}"}]
            # A short window of raw dialogue, for tone and "what did I just say". The
            # plan above is the memory — this used to be eight turns and the model had
            # to re-derive the plan from them on every request.
            for m in messages[-settings.assistant_history_turns :]:
                role = m.role if m.role in ("user", "assistant") else "user"
                oai_messages.append({"role": role, "content": m.content})

            span = turn.child("llm.generate", "llm", inputs={"messages": oai_messages})
            try:
                async for token in llm.stream_chat(
                    oai_messages,
                    on_provider=lambda p: served.update(provider=p.name, model=p.chat_model),
                ):
                    reply_parts.append(token)
                    yield ChatChunk(token=token)
            except llm.AllProvidersFailed as exc:
                # Every provider in the chain refused. Say so, but the retrieved trips
                # below still stand — the useful half of the answer survives.
                span.end(error=str(exc))
                metrics.observe("llm.generate", span.elapsed_ms, error=True)
                metrics.increment("provider_chain_exhausted")
                note = (
                    f"Every model provider is unavailable right now ({exc}). "
                    "The trips below are still the ones TravelIQ retrieved for that question."
                )
                async for chunk in _stream_words(note):
                    yield chunk
                # Into the record too: a restored thread must read the way the
                # turn actually went, outage note and all.
                reply_parts.append(note)
            else:
                span.end(outputs={"reply": "".join(reply_parts)}, **served)
                metrics.observe("llm.generate", span.elapsed_ms)
                if served.get("provider"):
                    metrics.increment(f"served_by.{served['provider']}")
        else:
            metrics.increment("chat_turns_without_key")
            note = (
                "Chat needs an API key — " + llm.missing_key_hint() + " in backend/.env and restart "
                "the API. Search, filtering and the trips below all work without it, so this is the "
                "only feature waiting on a key."
            )
            async for chunk in _stream_words(note):
                yield chunk
            reply_parts.append(note)

        # After the tokens, so it names the provider that actually finished the
        # reply — the chain can move providers mid-turn only between requests,
        # never mid-stream.
        if served.get("provider"):
            yield ChatChunk(provider=served["provider"], model=served.get("model"))

        cites = _citations(grounded, policy)
        if cites:
            yield ChatChunk(citations=cites)

        # Last, and after the reply: a turn whose generation failed has still moved the
        # plan, and losing that would make the traveller repeat themselves.
        await _save_state(session_id, state)
        await _save_transcript(
            session_id,
            question=last_user,
            reply="".join(reply_parts),
            trips=inline,
            citations=cites,
            quick_replies=question,
            parsed=parsed,
            served=served,
        )

        yield ChatChunk(done=True)
    except GeneratorExit:
        # The browser went away mid-stream. Still a trace worth keeping — a spike
        # of these is a latency problem wearing a different hat.
        turn_error = "client disconnected mid-stream"
        metrics.increment("chat_client_disconnects")
        raise
    except Exception as exc:
        turn_error = f"{type(exc).__name__}: {exc}"
        metrics.increment("chat_turn_errors")
        if state is not None:
            # The plan already moved before this turn failed; save it so the
            # traveller doesn't have to repeat themselves on retry.
            try:
                await _save_state(session_id, state)
            except Exception:
                log.exception("failed to persist plan state after turn error")
        raise
    finally:
        turn.finish(
            outputs={"reply": "".join(reply_parts), "trips": [t.title for t in grounded]},
            error=turn_error,
        )
        metrics.observe("chat_turn", turn.root.elapsed_ms, error=turn_error is not None)
