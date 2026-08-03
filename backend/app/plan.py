"""The six-slot trip plan: deterministic rules over TripPlanState, with zero IO.

No await, no provider call, no database — every function here is a pure function
of (state, patch) or (state, trips). That makes the whole slot-filling flow
trivially testable and means the same rules apply whether the caller is /chat, a
test, or a future voice surface. A merge can never fail because a provider was
rate-limited, because there is no provider to fail.

The design decision that buys that purity: `nlq.py` already extracts five of the
six slots (durationDays, maxPrice, themes, groupSizeMax, destination). So slot
extraction is NOT a second LLM round trip — it is a deterministic projection of
the ParsedQuery this turn already paid for, plus one small keyword pass for
`pace`, the only slot the parser has no notion of. Saving that round trip is the
whole reason this module has no IO in it.

Nothing here gates retrieval. `next_question` is a steer the caller may ignore,
and every question carries a skip that counts as a real answer — a traveller who
skips all six still gets trips, ranked on whatever is filled.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Optional, get_args

from . import nlq
from .schemas import (
    BudgetBand,
    Pace,
    ParsedQuery,
    PlanSlot,
    QuickReply,
    QuickReplyGroup,
    Trip,
    TripPlanState,
)

log = logging.getLogger("traveliq.plan")

# Widest funnel first: region and holiday type cut the catalogue hardest, so an
# answer to either is worth more than an answer to anything below it. `pace` only
# re-ranks (it has no catalogue column at all — see schemas.TripPlanState), so it
# is the one slot whose answer changes nothing about which trips are eligible,
# and it asks last.
SLOT_ORDER: tuple[PlanSlot, ...] = (
    "region",
    "holidayType",
    "duration",
    "budget",
    "groupSize",
    "pace",
)

# Skips and reversals on one slot before we stop asking about it. Three is the
# figure in docs/assistant-rag-architecture.md §3 Scenario C, and the point of a
# threshold is that loop-breaking is a system behaviour rather than something the
# model has to notice turn by turn.
SKIP_CEILING: int = 3
# Times we will put the same question at all. Lower than SKIP_CEILING on purpose:
# a skip does not fill the slot, so without this a skipped slot would stay at the
# front of the funnel and come round every turn until it hit SKIP_CEILING. Two
# means the traveller sees each question at most twice, however they answer.
ASK_CEILING: int = 2

_MAX_THEME_CHIPS = 5  # one chip row on a phone; more scrolls and reads as a form
_MAX_HOLIDAY_TYPES = 5  # a patch claiming twenty themes filters to nothing useful

# Band ceilings in £, matching the chip copy exactly (`Budget <£1k`, `Mid
# £1k-£3k`, `Luxury £3k+`). Luxury is None because it is a floor, not a ceiling:
# capping it would hide exactly the trips that were asked for.
_BAND_CEILING: dict[str, Optional[float]] = {"budget": 1000.0, "mid": 3000.0, "luxury": None}


# --- Region buckets --------------------------------------------------------
# The brief's "region" ("Europe", "Asia") is broader than `destinations.region`,
# which holds sub-national names like 'Tuscany' and 'Arctic Norway'. So it is a
# lookup table here rather than a column or a migration.

# Declaration order is chip order, so the region row renders the same every time.
_BUCKET_ORDER: tuple[str, ...] = ("Europe", "Asia", "Americas", "Africa & Middle East", "Oceania")

# Country -> bucket. The 18 countries actually in the catalogue come first; the
# rest are the remaining `nlq.py` `_DESTINATIONS` labels, so a destination added
# to the catalogue tomorrow buckets on day one instead of silently vanishing from
# the chips. A country missing from this map is left out of every bucket — see
# region_buckets, which says so out loud at debug level rather than swallowing it.
_COUNTRY_BUCKET: dict[str, str] = {
    # -- In the catalogue today --
    "Iceland": "Europe",
    "Norway": "Europe",
    "Finland": "Europe",
    "Sweden": "Europe",
    "Italy": "Europe",
    "Spain": "Europe",
    "Portugal": "Europe",
    "Greece": "Europe",
    "Switzerland": "Europe",
    "Japan": "Asia",
    "India": "Asia",
    "Indonesia": "Asia",
    "United States": "Americas",
    "Canada": "Americas",
    "Argentina": "Americas",
    "Morocco": "Africa & Middle East",
    "Tanzania": "Africa & Middle East",
    "New Zealand": "Oceania",
    # -- Known to nlq.py, not yet in the catalogue --
    "USA": "Americas",  # the label nlq.py's heuristic table emits for "usa"/"united states"
    "France": "Europe",
    "Croatia": "Europe",
    "Austria": "Europe",
    "Scotland": "Europe",
    "Canary Islands": "Europe",
    "Greenland": "Europe",  # geographically North America, sold out of Europe and Danish
    "Thailand": "Asia",
    "Vietnam": "Asia",
    "Maldives": "Asia",
    "Chile": "Americas",
    "Peru": "Americas",
    "Costa Rica": "Americas",
    "Kenya": "Africa & Middle East",
    "South Africa": "Africa & Middle East",
    "Egypt": "Africa & Middle East",
    "Turkey": "Africa & Middle East",  # straddles both; the bucket the brief offers for it
}

_BUCKET_BY_COUNTRY: dict[str, str] = {name.lower(): bucket for name, bucket in _COUNTRY_BUCKET.items()}

# Countries already reported as unbucketed. Worth saying once per process; saying
# it per request would drown a debug log for a catalogue that will never change.
_reported_unbucketed: set[str] = set()


def _normalise(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — the same shape of
    normalisation `nlq.py` does, so 'Africa & Middle East' and 'africa and middle
    east' are one bucket and 'action-packed' matches the key 'action packed'."""
    lowered = text.lower().replace("&", " and ").replace("’", "'")
    return re.sub(r"\s+", " ", re.sub(r"[^0-9a-z'\s]", " ", lowered)).strip()


# The ways a traveller (or a model filling the slot in free text) writes a bucket
# that is not its exact key. Deliberately shallow: this is a spelling table, not
# a geography — anything finer than these five buckets is the destination
# vocabulary's job, and nlq.py already owns that.
_BUCKET_ALIASES: dict[str, str] = {
    "europe": "Europe",
    "european": "Europe",
    "asia": "Asia",
    "asian": "Asia",
    "southeast asia": "Asia",
    "south east asia": "Asia",
    "far east": "Asia",
    "americas": "Americas",
    "america": "Americas",
    "north america": "Americas",
    "south america": "Americas",
    "latin america": "Americas",
    "africa": "Africa & Middle East",
    "middle east": "Africa & Middle East",
    "oceania": "Oceania",
    "australasia": "Oceania",
}

_BUCKET_BY_NORMALISED: dict[str, str] = {
    **{_normalise(alias): bucket for alias, bucket in _BUCKET_ALIASES.items()},
    **{_normalise(name): name for name in _BUCKET_ORDER},
}

# Longest key first, as everywhere else, so "south america" beats "america".
_BUCKET_TEXT_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(_BUCKET_BY_NORMALISED, key=len, reverse=True)) + r")\b"
)


def _canonical_bucket(value: str) -> Optional[str]:
    """A bucket key as spelled in _BUCKET_ORDER, or None if it is not one. The
    state's `region` is only useful downstream if it is a key the graph layer can
    resolve to countries, so anything else is rejected rather than stored — but a
    recognisable spelling of one ("southeast asia") is corrected, not thrown."""
    return _BUCKET_BY_NORMALISED.get(_normalise(value))


def _bucket_from_text(text: str) -> Optional[str]:
    """A bucket named outright in the sentence. Needed because no vocabulary
    anywhere else has one: nlq.py's `_DESTINATIONS` knows countries and cities,
    so "somewhere in Europe for 10 days" parses a duration and no place at all,
    and without this the assistant would go on to ask which part of the world.
    Negation is not handled ("anywhere but Europe" reads as Europe) — the same
    accepted limitation as pace_from_text, and a slot the traveller can correct."""
    match = _BUCKET_TEXT_RE.search(_normalise(text))
    return _BUCKET_BY_NORMALISED[match.group(1)] if match else None


def region_buckets(trips: list[Trip]) -> dict[str, list[str]]:
    """Bucket key -> the country names present in THIS catalogue.

    Computed from live trips rather than hardcoded so a bucket with no trips
    behind it never becomes a chip that returns nothing — 'Oceania' is a real
    option only while a New Zealand trip is on sale. Countries absent from
    _COUNTRY_BUCKET are left out of every bucket, which is a documented gap and
    not a silent one: each is named once at debug level.
    """
    found: dict[str, list[str]] = {}
    for trip in trips:
        country = trip.destination.country.strip()
        bucket = _BUCKET_BY_COUNTRY.get(country.lower())
        if bucket is None:
            if country and country not in _reported_unbucketed:
                _reported_unbucketed.add(country)
                log.debug("%s is in the catalogue but in no region bucket; add it to plan._COUNTRY_BUCKET", country)
            continue
        countries = found.setdefault(bucket, [])
        if country not in countries:
            countries.append(country)
    for countries in found.values():
        countries.sort()
    return {bucket: found[bucket] for bucket in _BUCKET_ORDER if bucket in found}


def _bucket_for_destination(name: str, trips: list[Trip]) -> Optional[str]:
    """Which bucket a parsed destination falls in. Four tries, cheapest first: a
    country name; a bucket name (an AI parse will happily answer 'Europe' to a
    question about where); nlq.py's own destination vocabulary, which already
    knows Positano is Italy — parse_heuristic is pure and synchronous, so
    borrowing it costs a few regexes and keeps this module IO-free; and finally
    the live catalogue, for a destination the vocabulary has not heard of."""
    direct = _BUCKET_BY_COUNTRY.get(name.strip().lower())
    if direct:
        return direct
    bucket = _canonical_bucket(name)
    if bucket:
        return bucket
    label = nlq.parse_heuristic(name).destination
    if label:
        by_label = _BUCKET_BY_COUNTRY.get(label.lower())
        if by_label:
            return by_label
    needle = _normalise(name)
    if not needle:
        return None
    # Whole words only. A bare substring test lets a one- or two-letter parse ("a",
    # "us") match the middle of any slug or region and silently pin the region slot
    # to the wrong continent, which chat.py's _region_pool then filters on.
    whole_word = re.compile(rf"\b{re.escape(needle)}\b")
    for trip in trips:
        d = trip.destination
        haystack = _normalise(f"{d.slug} {d.name} {d.region} {d.country}")
        if whole_word.search(haystack):
            return _BUCKET_BY_COUNTRY.get(d.country.strip().lower())
    return None


# --- Pace ------------------------------------------------------------------
# The one slot nlq.py has no notion of, so it gets the same treatment its
# vocabulary tables get: a hand-written keyword map, deliberately not learned, so
# "mostly downtime" means the same thing every time with or without an API key.

_PACE_WORDS: dict[str, Pace] = {
    "relaxed": "slow",
    "relaxing": "slow",
    "slow": "slow",
    "slow and easy": "slow",
    "chilled": "slow",
    "chill": "slow",
    "downtime": "slow",
    "unwind": "slow",
    "laid back": "slow",
    "take it easy": "slow",
    "easy pace": "slow",
    "packed": "packed",
    "action packed": "packed",
    "jam packed": "packed",
    "action": "packed",
    "see everything": "packed",
    "whistle stop": "packed",
    "busy": "packed",
    "fast paced": "packed",
    "lots to do": "packed",
    "balanced": "balanced",
    # "balance" on its own is deliberately absent: in a tour operator's chat the
    # commonest sentence containing it is "when is the balance due?", which is a
    # payment question, and reading a pace out of it made chat.py treat a
    # booking-conditions turn as a planning one and ask a non-sequitur back.
    "mix of": "balanced",
    "bit of both": "balanced",
    "some of both": "balanced",
}

# Longest key first so "action packed" beats "action" and "slow and easy" beats
# "slow" — the same reason nlq.py sorts its alternations by length.
_PACE_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(_PACE_WORDS, key=len, reverse=True)) + r")\b"
)


def pace_from_text(text: str) -> Optional[Pace]:
    """Read a pace preference out of a raw sentence, or None.

    First match wins, which is wrong for a negated phrase ("not too packed" reads
    as packed). Living with that is deliberate: pace is a soft rerank signal with
    no catalogue column behind it, so a wrong read costs a little ordering, never
    a dropped trip — and the traveller can say it again.
    """
    match = _PACE_RE.search(_normalise(text))
    return _PACE_WORDS[match.group(1)] if match else None


# --- Slots -----------------------------------------------------------------

# Which state fields each slot owns. `budget` owns two because a band and a
# figure are two ways of answering one question.
_SLOT_FIELDS: dict[PlanSlot, tuple[str, ...]] = {
    "duration": ("durationDays",),
    "budget": ("budgetBand", "maxPrice"),
    "region": ("region",),
    "holidayType": ("holidayType",),
    "pace": ("pace",),
    "groupSize": ("groupSize",),
}

_FIELD_SLOT: dict[str, PlanSlot] = {
    field_name: slot for slot, names in _SLOT_FIELDS.items() for field_name in names
}


def _band_for(price: float) -> BudgetBand:
    """Which band a stated figure falls in. Boundaries are inclusive at the top
    because a maxPrice is a ceiling: £1,000 is satisfied by the budget shelf, so
    that is the band it belongs to."""
    if price <= 1000:
        return "budget"
    if price <= 3000:
        return "mid"
    return "luxury"


def budget_ceiling(state: TripPlanState) -> Optional[float]:
    """The £ figure retrieval should filter on, or None for no cap.

    An explicit maxPrice wins — a traveller who said "around £2,500" gave a
    sharper answer than a chip could. Otherwise the band's ceiling, and `luxury`
    has none by design (see _BAND_CEILING).
    """
    if state.maxPrice:
        return state.maxPrice
    return _BAND_CEILING.get(state.budgetBand or "")


def _answer(state: TripPlanState, slot: PlanSlot) -> Any:
    """The comparable answer held for a slot: what the question asked for, not
    every field it touches. Budget compares as its band, so sharpening £2,400 to
    £2,500 is a refinement rather than a change of mind."""
    if slot == "budget":
        return state.budgetBand or (_band_for(state.maxPrice) if state.maxPrice else None)
    if slot == "holidayType":
        return frozenset(state.holidayType or ())
    return getattr(state, _SLOT_FIELDS[slot][0])


def _is_answered(value: Any) -> bool:
    return bool(value) if isinstance(value, frozenset) else value is not None


def _is_reversal(before: Any, after: Any) -> bool:
    """Whether a new value contradicts the one already held. Two themes that
    overlap ('Beach' -> 'Beach, Culture') are the traveller adding detail; a set
    with nothing in common is them changing their mind."""
    if not _is_answered(before) or before == after:
        return False
    if isinstance(before, frozenset) and isinstance(after, frozenset):
        return not (before & after)
    return True


def filled(state: TripPlanState) -> list[PlanSlot]:
    """The slots that hold an answer, in funnel order."""
    return [slot for slot in SLOT_ORDER if _is_answered(_answer(state, slot))]


def changed_slots(before: TripPlanState, after: TripPlanState) -> list[PlanSlot]:
    """Which slots moved between two states, in funnel order.

    Lives here rather than in the caller because the slot-to-field mapping is this
    module's business — chat.py publishing `session.slot_changed` should not have to
    know that `budget` is two fields, or that holidayType compares as a set.
    """
    return [slot for slot in SLOT_ORDER if _answer(before, slot) != _answer(after, slot)]


def missing(state: TripPlanState) -> list[PlanSlot]:
    """The slots with no answer yet, in funnel order. A skipped slot is in here —
    a skip is a complete answer to the question but not a value to retrieve on."""
    known = set(filled(state))
    return [slot for slot in SLOT_ORDER if slot not in known]


def exhausted(state: TripPlanState, slot: PlanSlot) -> bool:
    """True when this slot has hit either ceiling and we stop asking about it.

    The loop-break rule as a threshold rather than a judgement the model makes
    turn by turn. The brief's second half — "two turns without it firming up" —
    is covered by ASK_CEILING instead of a per-slot turn stamp, because a slot we
    have already put twice is one we have already given two turns.
    """
    return (
        state.skipCounts.get(slot, 0) >= SKIP_CEILING
        or state.askedCounts.get(slot, 0) >= ASK_CEILING
    )


# --- Patch coercion --------------------------------------------------------
# A patch arrives from the browser (ChatRequest.slotPatch) as well as from
# patch_from_parsed, so every value is validated here. Same rule as nlq.py's
# _clean_payload: a bad value loses its field, never the whole merge.

def _as_int(value: Any, low: int, high: int) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def _as_float(value: Any, low: float, high: float) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(str(value).replace(",", "").replace("£", ""))
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def _as_choice(value: Any, allowed: tuple[str, ...]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    lowered = value.strip().lower()
    return lowered if lowered in allowed else None


def _as_themes(value: Any) -> Optional[list[str]]:
    """Trip.themes vocabulary, as a list even when one theme arrives bare. Labels
    are kept verbatim: rag.py matches them loosely, so 'Food and wine' typed as
    'food & wine' still lands on the right trips."""
    raw = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip() and item.strip() not in out:
            out.append(item.strip()[:40])
    return out[:_MAX_HOLIDAY_TYPES] or None


def _coerce(key: str, value: Any) -> Any:
    if key == "durationDays":
        return _as_int(value, 1, 60)
    if key == "maxPrice":
        return _as_float(value, 1.0, 1_000_000.0)
    if key == "budgetBand":
        return _as_choice(value, get_args(BudgetBand))
    if key == "pace":
        return _as_choice(value, get_args(Pace))
    if key == "groupSize":
        return _as_int(value, 1, 40)
    if key == "holidayType":
        return _as_themes(value)
    if key == "region":
        # Only a real bucket key is stored: the graph layer resolves `region` to a
        # country set, and a value it cannot resolve would filter to nothing.
        return _canonical_bucket(value) if isinstance(value, str) else None
    return None


def merge(state: TripPlanState, patch: dict[str, Any]) -> TripPlanState:
    """Apply a patch and return a NEW state.

    The input is never mutated: the caller still needs the pre-merge value to diff
    against (chat.py publishes `session.slot_changed` off that diff).

    The rules, and why each one is the rule:
      * A later answer always wins, field by field. This is what makes "actually,
        make it Asia" work without the model having to resolve a contradiction it
        spotted in scrollback.
      * Unknown or unusable keys are ignored rather than raising. A patch can
        arrive straight from the browser and must not be able to 500 /chat.
      * {"skip": "<slot>"} is the skip sentinel: it sets no value, increments
        skipCounts[slot] and is treated as a complete answer to the question.
      * {"asked": "<slot>"} increments askedCounts[slot] — the caller records the
        question it actually put, since next_question is read-only.
      * {"clear": "<slot>"} empties a slot and RESETS its counters. A patch cannot
        clear a slot by sending None (an absent answer must never wipe a known one —
        see patch_from_parsed), so removing one is its own explicit sentinel. The
        counters reset because clearing is the traveller asking to answer it again,
        and a slot that had been skipped twice would otherwise be un-re-askable.
      * A value that contradicts the one already held is a reversal and increments
        skipCounts too, so flip-flopping trips the same ceiling as skipping.
      * Changing `region` marks `budget` unconfirmed when a budget was already
        set: the same money buys a very different trip in Asia than in Norway. It
        is flagged, never erased — a stale answer beats no answer, and the
        assistant re-confirms it in one line instead of asking from scratch.
      * Setting a slot clears it from `unconfirmed`; answering is confirming.
      * maxPrice and budgetBand stay consistent, in both directions: see below.

    turnCount is deliberately not touched. Several patches can land in one turn
    (a chip tap plus the sentence it was typed alongside), so counting turns is
    the caller's job, not the merge's.
    """
    if not isinstance(patch, dict) or not patch:
        return state.model_copy(deep=True)

    data = state.model_dump()
    skips = dict(state.skipCounts)
    asked = dict(state.askedCounts)
    applied: set[str] = set()          # state fields this patch actually wrote
    answered: set[PlanSlot] = set()    # slots that gained a value

    skipped = patch.get("skip")
    if isinstance(skipped, str) and skipped in _SLOT_FIELDS:
        skips[skipped] = skips.get(skipped, 0) + 1

    put = patch.get("asked")
    if isinstance(put, str) and put in _SLOT_FIELDS:
        asked[put] = asked.get(put, 0) + 1

    cleared = patch.get("clear")
    if isinstance(cleared, str) and cleared in _SLOT_FIELDS:
        for field_name in _SLOT_FIELDS[cleared]:
            data[field_name] = None
        skips.pop(cleared, None)
        asked.pop(cleared, None)

    for key, raw in patch.items():
        if key in ("skip", "asked", "clear"):
            continue
        slot = _FIELD_SLOT.get(key)
        if slot is None:
            log.debug("ignoring unknown plan patch key %r", key)
            continue
        value = _coerce(key, raw)
        if value is None:
            log.debug("ignoring unusable value for %s: %r", key, raw)
            continue
        data[key] = value
        applied.add(key)
        answered.add(slot)

    # A stated figure always names its band, so retrieval, the chips and the
    # summary line agree about which shelf the traveller is on.
    if "maxPrice" in applied:
        data["budgetBand"] = _band_for(data["maxPrice"])
    elif "budgetBand" in applied:
        cap = data.get("maxPrice")
        if cap and _band_for(cap) != data["budgetBand"]:
            # A band arriving on its own is the newer answer, so a figure that
            # contradicts it goes rather than sitting there under-cutting it. A
            # band alone leaves maxPrice None — budget_ceiling derives the cap.
            data["maxPrice"] = None

    merged = TripPlanState.model_validate(data)
    for slot in answered:
        if _is_reversal(_answer(state, slot), _answer(merged, slot)):
            skips[slot] = skips.get(slot, 0) + 1

    unconfirmed = list(state.unconfirmed)
    # `state.region` must already hold something: this is the "changing" rule, and
    # going from no region at all to a first one invalidates nothing — the budget
    # was never agreed against a different continent. Without that guard the very
    # common "£2,500pp" then "somewhere in Europe" order flags a budget nobody has
    # contradicted, and the assistant re-confirms it for no reason.
    if "region" in answered and state.region and state.region != merged.region and _is_answered(_answer(state, "budget")):
        if "budget" not in unconfirmed:
            unconfirmed.append("budget")
    # Answering confirms; skipping does not, so a skipped slot keeps its flag. A
    # cleared slot drops it too — there is no longer a value to re-confirm.
    unconfirmed = [slot for slot in unconfirmed if slot not in answered and slot != cleared]

    return merged.model_copy(
        update={"skipCounts": skips, "askedCounts": asked, "unconfirmed": unconfirmed}, deep=True
    )


def patch_from_parsed(parsed: ParsedQuery, text: str, trips: list[Trip]) -> dict[str, Any]:
    """Project an `nlq.py` parse, plus the raw sentence, into a state patch.

    This is the whole reason the module is pure: five of the six slots are
    already sitting in the ParsedQuery the turn paid for, so reading them out is
    a projection rather than a second LLM call. Only `pace` needs the raw
    sentence, because the parser has no field for it.

    Anything the parse left empty is omitted — an absent key must never overwrite
    a known slot with None, or a follow-up sentence that mentions no budget would
    wipe the budget given two turns ago.
    """
    patch: dict[str, Any] = {}
    if parsed.durationDays:
        patch["durationDays"] = parsed.durationDays
    if parsed.maxPrice:
        # Both keys, because the patch is a contract in its own right: a caller that
        # inspects or logs it (or a test written against the brief's Scenario A
        # `update_trip_state({... budgetBand: "mid", maxPrice: 2500 ...})`) should see
        # the band, not have to re-derive it. merge recomputes the same value from
        # maxPrice anyway, so the two can never disagree.
        patch["maxPrice"] = parsed.maxPrice
        patch["budgetBand"] = _band_for(parsed.maxPrice)
    if parsed.themes:
        patch["holidayType"] = list(parsed.themes)
    if parsed.groupSizeMax:
        patch["groupSize"] = parsed.groupSizeMax
    bucket = _bucket_for_destination(parsed.destination, trips) if parsed.destination else None
    # "somewhere in Europe" names a region and no destination, so nlq.py returns
    # nothing for it — the sentence itself is the only place that answer exists.
    if bucket is None:
        bucket = _bucket_from_text(text)
    if bucket:
        patch["region"] = bucket
    pace = pace_from_text(text)
    if pace:
        patch["pace"] = pace
    return patch


# --- The questions ---------------------------------------------------------
# All six prompts and their chip copy live in this one table, because the copy is
# content: a writer should be able to edit the whole conversation in one place
# without reading a single function. Wording is from
# docs/assistant-rag-architecture.md §2.


@dataclass(frozen=True)
class _Question:
    """One slot's copy. `chips` is empty for the two slots whose options come from
    the live catalogue instead of the table (see _region_chips, _theme_chips) —
    hardcoding those would offer chips that return nothing."""

    prompt: str
    skip_label: str
    skip_value: str
    chips: tuple[tuple[str, str, dict[str, Any]], ...] = ()


_QUESTIONS: dict[PlanSlot, _Question] = {
    "region": _Question(
        prompt="Any part of the world calling you, or should I surprise you?",
        skip_label="Surprise me!",
        skip_value="Surprise me — anywhere is fine",
    ),
    "holidayType": _Question(
        prompt=(
            "What's the shape of the trip — beach and relax, culture and cities, "
            "wildlife, something active?"
        ),
        skip_label="Skip — open to anything",
        skip_value="I'm open to anything",
    ),
    "duration": _Question(
        prompt="How long are you thinking? A long weekend, a proper week, or something longer?",
        skip_label="Skip — any length",
        skip_value="Any length is fine",
        # Each chip sets the midpoint of the band it names; rag.py widens a parsed
        # length into a band again, so a midpoint is the honest single number.
        chips=(
            ("Weekend (2-4d)", "A long weekend", {"durationDays": 3}),
            ("1 week", "About a week", {"durationDays": 7}),
            ("10-14 days", "10 to 14 days", {"durationDays": 12}),
            ("2+ weeks", "Two weeks or more", {"durationDays": 16}),
        ),
    ),
    "budget": _Question(
        prompt="What kind of budget should I work with?",
        skip_label="Skip — show me a range",
        skip_value="Show me a range",
        # A band with no figure is enough to retrieve on (budget_ceiling turns it
        # into a cap), so no chip pretends to know a precise number.
        chips=(
            ("Budget <£1k", "Budget — under £1,000", {"budgetBand": "budget"}),
            ("Mid £1k-£3k", "Mid-range — £1,000 to £3,000", {"budgetBand": "mid"}),
            ("Luxury £3k+", "Luxury — £3,000 and up", {"budgetBand": "luxury"}),
        ),
    ),
    "groupSize": _Question(
        prompt="Who's coming along?",
        skip_label="Skip — just me for now",
        skip_value="Just me for now",
        # Numbers, not audience labels: the catalogue has a hard groupSizeMax
        # column, and nlq.py reads the audience tag off the sentence anyway.
        chips=(
            ("Solo", "Just me", {"groupSize": 1}),
            ("Couple", "The two of us", {"groupSize": 2}),
            ("Family", "A family of four", {"groupSize": 4}),
            ("Small group (5+)", "A small group of us", {"groupSize": 6}),
        ),
    ),
    "pace": _Question(
        prompt="Want every day packed with things to do, an easy balance, or mostly downtime?",
        skip_label="Skip — you decide",
        skip_value="You decide",
        chips=(
            ("Packed", "Packed days, please", {"pace": "packed"}),
            ("Balanced", "A balanced mix", {"pace": "balanced"}),
            ("Slow & easy", "Slow and easy", {"pace": "slow"}),
        ),
    ),
}


def _region_chips(trips: list[Trip]) -> list[QuickReply]:
    """One chip per bucket the catalogue can actually fill."""
    return [
        QuickReply(label=bucket, value=bucket, patch={"region": bucket})
        for bucket in region_buckets(trips)
    ]


def _theme_chips(trips: list[Trip]) -> list[QuickReply]:
    """The commonest themes actually on sale, not a hardcoded list — the chips
    have to be answerable, and the vocabulary is whatever ingest last loaded."""
    counts: Counter[str] = Counter(theme for trip in trips for theme in trip.themes)
    ordered = sorted(counts, key=lambda theme: (-counts[theme], theme))
    return [
        QuickReply(label=theme, value=theme, patch={"holidayType": [theme]})
        for theme in ordered[:_MAX_THEME_CHIPS]
    ]


def _group(slot: PlanSlot, trips: list[Trip]) -> Optional[QuickReplyGroup]:
    question = _QUESTIONS[slot]
    if slot == "region":
        options = _region_chips(trips)
    elif slot == "holidayType":
        options = _theme_chips(trips)
    else:
        options = [QuickReply(label=label, value=value, patch=patch) for label, value, patch in question.chips]
    if not options:
        # Only reachable for the two catalogue-driven slots, and only with nothing
        # loaded. A question with no chips behind it is not worth asking.
        return None
    return QuickReplyGroup(
        slot=slot,
        prompt=question.prompt,
        options=options,
        # Every question carries a skip, and its patch is the sentinel rather
        # than an empty dict, so a skip is recorded as an answer instead of
        # reading like a turn where nothing happened.
        skip=QuickReply(label=question.skip_label, value=question.skip_value, patch={"skip": slot}),
    )


def next_question(state: TripPlanState, trips: list[Trip]) -> Optional[QuickReplyGroup]:
    """The next slot worth asking about, or None when the assistant should stop
    asking and just answer.

    CRITICAL: this is only ever a steer. Retrieval runs on every turn regardless
    of what this returns — a traveller who skips all six still gets trips, ranked
    on rating and promotions the way rag.py already handles an empty parse. The
    question rides alongside an answer, it never gates one. That is the brief's
    "always optional" rule, and it is enforced here by this function having no
    way to block anything: it returns copy, not control flow.

    None means every slot is either filled or exhausted (see `exhausted`), which
    is also the cue for the loop-break line — pair it with `summary_line`.

    Read-only: the caller records the question it put with
    `merge(state, {"asked": slot})`, so a state written by /chat and a state
    written by a test go through the same code path.
    """
    for slot in missing(state):
        if exhausted(state, slot):
            continue
        group = _group(slot, trips)
        if group is not None:
            return group
    return None


def to_parsed(state: TripPlanState, parsed: ParsedQuery, trips: list[Trip]) -> ParsedQuery:
    """Fold the accumulated plan into THIS turn's ParsedQuery, so a budget given
    three turns ago still constrains the search now.

    The live parse wins every field it filled: the traveller's current sentence is
    more specific than their remembered plan, and treating it otherwise is how an
    assistant ends up arguing with someone who just changed their mind. Returns a
    new ParsedQuery; `parsed` is not mutated.

    `region` maps to nothing on purpose. It is a country SET and
    ParsedQuery.destination is a single string, so jamming a bucket in there gives
    rag.py's `_mentions_destination` the needle "europe" to look for in a trip's
    slug, name, country and region — which matches no trip in the catalogue and
    silently empties the result set. Region filtering belongs in chat.py via the
    graph layer, which can expand a bucket into its countries. `pace` maps to
    nothing for the same class of reason: there is no catalogue column for it, so
    it stays a rerank signal (see schemas.TripPlanState).

    `trips` is accepted but unused — it is here because expanding a region is the
    obvious next thing to want from this function, and it would need the
    catalogue to do it.
    """
    updates: dict[str, Any] = {}
    if parsed.durationDays is None and state.durationDays:
        updates["durationDays"] = state.durationDays
    if parsed.maxPrice is None:
        ceiling = budget_ceiling(state)
        if ceiling:
            updates["maxPrice"] = ceiling
    if not parsed.themes and state.holidayType:
        updates["themes"] = list(state.holidayType)
    if parsed.groupSizeMax is None and state.groupSize:
        updates["groupSizeMax"] = state.groupSize
    return parsed.model_copy(update=updates, deep=True)


# --- Readable summary ------------------------------------------------------

_BAND_LABEL: dict[str, str] = {
    "budget": "budget under £1,000",
    "mid": "mid £1k-£3k",
    "luxury": "luxury £3k+",
}

_PACE_LABEL: dict[str, str] = {
    "slow": "easy pace",
    "balanced": "balanced pace",
    "packed": "packed days",
}


def _money(amount: float) -> str:
    return f"£{amount:,.0f}"


def summary_line(state: TripPlanState) -> str:
    """One readable line of the plan so far — 'about 10 days; mid £1k-£3k; Europe;
    Beach; easy pace; 4 travellers'.

    Used twice: as the compact plan in the model's context, and as the loop-break
    message when `next_question` gives up ("here's what I have, moving on").
    British English and £ formatting, because it is traveller-facing both times.
    Empty string when nothing is set — the caller then has nothing to say and
    should say nothing.
    """
    parts: list[str] = []
    if state.durationDays:
        parts.append(f"about {state.durationDays} days")
    if state.maxPrice:
        # An explicit figure reads better than the band it implies, and it is what
        # retrieval is actually filtering on (see budget_ceiling).
        parts.append(f"up to {_money(state.maxPrice)}")
    elif state.budgetBand:
        parts.append(_BAND_LABEL[state.budgetBand])
    if state.region:
        parts.append(state.region)
    if state.holidayType:
        parts.append(", ".join(state.holidayType))
    if state.pace:
        parts.append(_PACE_LABEL[state.pace])
    if state.groupSize:
        parts.append(f"{state.groupSize} traveller" if state.groupSize == 1 else f"{state.groupSize} travellers")
    return "; ".join(parts)
