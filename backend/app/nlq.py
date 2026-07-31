"""Query understanding: one traveller sentence in, a structured ParsedQuery out.

Two layers, tried in order. The AI layer asks the chat chain in llm.py for strict
JSON at temperature 0 and validates the reply against the wire model. The
heuristic layer is a pure keyword/regex extractor that needs no network and no
API key — it is what answers when the model is slow, rate-limited or absent,
which the brief treats as a documented fallback rather than an error. `parse`
therefore never raises: the worst case is a heuristic parse flagged
`source="heuristic"`, and the Search screen shows that distinction openly.

Repeated queries come back from a small LRU keyed on the normalised sentence, so
the second search for the same phrase costs nothing.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import OrderedDict
from datetime import date
from typing import Iterable, Optional, TypeVar

from pydantic import ValidationError

from . import llm
from .config import settings
from .schemas import ParsedQuery

log = logging.getLogger("traveliq.nlq")

T = TypeVar("T")

# --- Vocabulary ------------------------------------------------------------
# Everything below is what makes the no-API-key path usable. It is deliberately
# hand-written rather than learned: a traveller typing "next winter" or "under
# £1200" should get the same answer every time, model or no model.

_MONTHS: dict[str, int] = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

# Northern-hemisphere seasons — this POC sells from a UK market, so "next
# winter" means the aurora season, not the southern one.
_SEASONS: dict[str, tuple[int, ...]] = {
    "next winter": (11, 12, 1, 2, 3),
    "this winter": (11, 12, 1, 2, 3),
    "winter sun": (11, 12, 1, 2),
    "winter": (11, 12, 1, 2, 3),
    "next summer": (6, 7, 8),
    "this summer": (6, 7, 8),
    "summer holidays": (7, 8),
    "school holidays": (7, 8),
    "summer": (6, 7, 8),
    "next spring": (3, 4, 5),
    "spring": (3, 4, 5),
    "next autumn": (9, 10, 11),
    "autumn": (9, 10, 11),
    "fall": (9, 10, 11),
    "christmas": (12,),
    "xmas": (12,),
    "new year": (12, 1),
    "easter": (3, 4),
    "half term": (2, 5, 10),
    "shoulder season": (4, 5, 9, 10),
    "off season": (11, 1, 2),
}

_THEMES: dict[str, str] = {
    "northern lights": "Northern Lights",
    "aurora borealis": "Northern Lights",
    "aurora": "Northern Lights",
    "beach": "Beach",
    "beaches": "Beach",
    "seaside": "Beach",
    "coastal": "Beach",
    "island hopping": "Beach",
    "city break": "City break",
    "city breaks": "City break",
    "wildlife": "Wildlife",
    "safari": "Wildlife",
    "culture": "Culture",
    "cultural": "Culture",
    "heritage": "Culture",
    "history": "Culture",
    "historic": "Culture",
    "temples": "Culture",
    "museums": "Culture",
    "ruins": "Culture",
    "food and wine": "Food and wine",
    "foodie": "Food and wine",
    "food": "Food and wine",
    "cuisine": "Food and wine",
    "gastronomy": "Food and wine",
    "wine": "Food and wine",
    "adventure": "Adventure",
    "adrenaline": "Adventure",
    "expedition": "Adventure",
    "wellness": "Wellness",
    "spa": "Wellness",
    "retreat": "Wellness",
    "ski": "Ski",
    "ski holiday": "Ski",
    "rail journey": "Rail journey",
    "scenic train": "Rail journey",
    "train journey": "Rail journey",
    "by rail": "Rail journey",
    "road trip": "Road trip",
    "self drive": "Road trip",
}

_ACTIVITIES: dict[str, str] = {
    "walking": "Walking",
    "walk": "Walking",
    "walks": "Walking",
    "hiking": "Walking",
    "hike": "Walking",
    "trekking": "Walking",
    "trek": "Walking",
    "rambling": "Walking",
    "diving": "Diving",
    "dive": "Diving",
    "scuba": "Diving",
    "snorkelling": "Diving",
    "snorkeling": "Diving",
    "snorkel": "Diving",
    "skiing": "Skiing",
    "snowboarding": "Skiing",
    "cross country skiing": "Skiing",
    "cycling": "Cycling",
    "cycle": "Cycling",
    "biking": "Cycling",
    "mountain biking": "Cycling",
    "kayaking": "Kayaking",
    "kayak": "Kayaking",
    "canoeing": "Kayaking",
    "paddling": "Kayaking",
    "food tour": "Food tour",
    "street food": "Food tour",
    "cooking class": "Food tour",
    "wine tasting": "Food tour",
    "whale watching": "Wildlife watching",
    "wildlife watching": "Wildlife watching",
    "birdwatching": "Wildlife watching",
    "game drives": "Wildlife watching",
    "game drive": "Wildlife watching",
    "photography": "Photography",
    "photo tour": "Photography",
    "yoga": "Yoga",
    "surfing": "Surfing",
    "surf": "Surfing",
    "sailing": "Sailing",
    "boat trip": "Sailing",
    "dog sledding": "Dog sledding",
    "husky sledding": "Dog sledding",
    "husky": "Dog sledding",
    "hot springs": "Hot springs",
    "thermal baths": "Hot springs",
}

_AUDIENCE: dict[str, str] = {
    "family": "Family",
    "families": "Family",
    "kids": "Family",
    "children": "Family",
    "child": "Family",
    "toddler": "Family",
    "toddlers": "Family",
    "teenagers": "Family",
    "couple": "Couples",
    "couples": "Couples",
    "honeymoon": "Couples",
    "romantic": "Couples",
    "anniversary": "Couples",
    "my partner": "Couples",
    "my wife": "Couples",
    "my husband": "Couples",
    "two of us": "Couples",
    "solo": "Solo",
    "on my own": "Solo",
    "by myself": "Solo",
    "alone": "Solo",
    "single traveller": "Solo",
    "small group": "Small groups",
    "small groups": "Small groups",
    "group tour": "Small groups",
    "guided group": "Small groups",
    "adventurous": "Adventure",
    "thrill seekers": "Adventure",
}

_DESTINATIONS: dict[str, str] = {
    "iceland": "Iceland",
    "reykjavik": "Iceland",
    "norway": "Norway",
    "tromso": "Norway",
    "tromsø": "Norway",
    "lofoten": "Norway",
    "finland": "Finland",
    "lapland": "Finland",
    "rovaniemi": "Finland",
    "sweden": "Sweden",
    "greenland": "Greenland",
    "italy": "Italy",
    "amalfi": "Italy",
    "positano": "Italy",
    "tuscany": "Italy",
    "dolomites": "Italy",
    "sicily": "Italy",
    "rome": "Italy",
    "japan": "Japan",
    "kyoto": "Japan",
    "tokyo": "Japan",
    "canada": "Canada",
    "banff": "Canada",
    "rockies": "Canada",
    "alberta": "Canada",
    "usa": "USA",
    "united states": "USA",
    "moab": "USA",
    "utah": "USA",
    "california": "USA",
    "argentina": "Argentina",
    "patagonia": "Argentina",
    "chile": "Chile",
    "peru": "Peru",
    "machu picchu": "Peru",
    "switzerland": "Switzerland",
    "swiss alps": "Switzerland",
    "grindelwald": "Switzerland",
    "austria": "Austria",
    "indonesia": "Indonesia",
    "bali": "Indonesia",
    "new zealand": "New Zealand",
    "queenstown": "New Zealand",
    "morocco": "Morocco",
    "marrakech": "Morocco",
    "sahara": "Morocco",
    "spain": "Spain",
    "mallorca": "Spain",
    "andalusia": "Spain",
    "portugal": "Portugal",
    "madeira": "Portugal",
    "algarve": "Portugal",
    "azores": "Portugal",
    "greece": "Greece",
    "crete": "Greece",
    "santorini": "Greece",
    "croatia": "Croatia",
    "france": "France",
    "provence": "France",
    "scotland": "Scotland",
    "highlands": "Scotland",
    "isle of skye": "Scotland",
    "canary islands": "Canary Islands",
    "tenerife": "Canary Islands",
    "lanzarote": "Canary Islands",
    "costa rica": "Costa Rica",
    "kenya": "Kenya",
    "tanzania": "Tanzania",
    "serengeti": "Tanzania",
    "south africa": "South Africa",
    "cape town": "South Africa",
    "thailand": "Thailand",
    "vietnam": "Vietnam",
    "india": "India",
    "kerala": "India",
    "rajasthan": "India",
    "maldives": "Maldives",
    "egypt": "Egypt",
    "turkey": "Turkey",
}

_MILD_WORDS = ("not too hot", "mild", "temperate", "cooler")
_COLD_WORDS = (
    "cold", "snow", "snowy", "arctic", "aurora", "northern lights", "ice", "icy",
    "freezing", "polar", "glacier", "winter",
)
_WARM_WORDS = ("warm", "hot", "sunny", "sunshine", "sun", "tropical", "balmy", "heat")

# Vague budget language mapped onto per-person GBP ceilings. These bands are a
# UK-market rule of thumb; deriving them from the catalogue's own price
# percentiles per destination is what would make them real.
_BUDGET_HINTS: dict[str, float] = {
    "not too expensive": 1500.0,
    "budget friendly": 1200.0,
    "good value": 1500.0,
    "affordable": 1200.0,
    "bargain": 900.0,
    "cheap": 900.0,
    "mid range": 2500.0,
}

_NUMBER_WORDS: dict[str, int] = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "fourteen": 14, "twenty": 20,
}

_FIXED_DURATIONS: dict[str, int] = {
    "long weekend": 4,
    "weekend": 3,
    "fortnight": 14,
}


def _alternation(keys: Iterable[str]) -> re.Pattern[str]:
    """One regex per vocabulary table, longest key first so "city break" wins
    over "city" and "march" over "mar"."""
    ordered = sorted(keys, key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(k) for k in ordered) + r")\b")


_MONTH_RE = _alternation(_MONTHS)
_SEASON_RE = _alternation(_SEASONS)
_THEME_RE = _alternation(_THEMES)
_ACTIVITY_RE = _alternation(_ACTIVITIES)
_AUDIENCE_RE = _alternation(_AUDIENCE)
_DESTINATION_RE = _alternation(_DESTINATIONS)

_MONTH_NAMES = "|".join(sorted(_MONTHS, key=len, reverse=True))
_MONTH_RANGE_RE = re.compile(
    rf"\b({_MONTH_NAMES})\b\s*(?:to|till|until|through|-|–)\s*\b({_MONTH_NAMES})\b"
)

_BUDGET_RE = re.compile(
    r"(?:under|below|less than|no more than|max(?:imum)?|up to|within|budget(?:\s+of)?|around|about)"
    r"\s*(?:£|gbp\s*)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b"
)
_PRICE_RE = re.compile(r"£\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b")
_DURATION_RE = re.compile(
    r"\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|twenty)"
    r"[\s-]*(days?|nights?|weeks?)\b"
)
_DIRECT_RE = re.compile(r"\b(direct(?:\s+flights?)?|non[\s-]?stop|no stopovers?|no changes)\b")
_GROUP_RE = re.compile(
    r"(?:group|party|family)\s+of\s+(\d{1,2})"
    r"|(?:for|with)\s+(\d{1,2})(?!\s*(?:day|night|week|hour|k\b))"
    r"|(\d{1,2})\s*(?:people|persons|adults|travellers|travelers|guests|of\s+us)"
)

_SCORED_FIELDS = (
    "destination", "months", "durationDays", "maxPrice", "themes", "activities",
    "audience", "climate", "groupSizeMax", "directFlights",
)


# --- Small utilities -------------------------------------------------------

def _dedupe(values: Iterable[T]) -> list[T]:
    out: list[T] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def _normalise(query: str) -> str:
    """Lowercase, de-punctuate and collapse whitespace. Also the cache key, so
    "Iceland in November?" and "iceland in november" are one query."""
    text = query.lower().replace("’", "'")
    text = re.sub(r"[^0-9a-z£.,'\-/\sÀ-ɏ]", " ", text)
    # Commas and full stops survive between digits ("£1,200", "1.5k") and nowhere
    # else, so stray punctuation can't split the cache key.
    text = re.sub(r"[.,](?!\d)|(?<!\d)[.,]", " ", text)
    return re.sub(r"\s+", " ", text).strip(" .,")


def _amount(digits: str, thousands: Optional[str]) -> float:
    value = float(digits.replace(",", ""))
    return value * 1000 if thousands else value


def _confidence(parsed: ParsedQuery) -> float:
    """How much of the sentence we actually understood. The AI layer starts
    higher because it reads intent the tables cannot."""
    filled = sum(1 for field in _SCORED_FIELDS if getattr(parsed, field) not in (None, []))
    if not filled:
        return 0.1
    base = 0.5 if parsed.source == "ai" else 0.32
    return round(min(0.97, base + 0.09 * filled), 2)


# --- Heuristic layer -------------------------------------------------------

def _months(text: str) -> list[int]:
    found: list[int] = []
    for start, end in _MONTH_RANGE_RE.findall(text):
        first, last = _MONTHS[start], _MONTHS[end]
        span = [((first - 1 + step) % 12) + 1 for step in range((last - first) % 12 + 1)]
        found.extend(span)
    found.extend(_MONTHS[name] for name in _MONTH_RE.findall(text))
    for season in _SEASON_RE.findall(text):
        found.extend(_SEASONS[season])
    # Order of appearance, not numeric order: "next winter" should read
    # November to March in the UI, not January to December.
    return _dedupe(found)


def _budget(text: str) -> Optional[float]:
    match = _BUDGET_RE.search(text)
    if match:
        return _amount(match.group(1), match.group(2))
    match = _PRICE_RE.search(text)
    if match:
        return _amount(match.group(1), match.group(2))
    for phrase, cap in _BUDGET_HINTS.items():
        if phrase in text:
            return cap
    return None


def _duration(text: str) -> Optional[int]:
    for phrase, days in _FIXED_DURATIONS.items():
        if phrase in text:
            return days
    match = _DURATION_RE.search(text)
    if not match:
        return None
    raw, unit = match.group(1), match.group(2)
    count = int(raw) if raw.isdigit() else _NUMBER_WORDS.get(raw, 1)
    if unit.startswith("week"):
        return min(60, count * 7)
    if unit.startswith("night"):
        # A seven-night holiday is sold as an eight-day trip.
        return min(60, count + 1)
    return min(60, count)


def _climate(text: str) -> Optional[str]:
    if "winter sun" in text:
        return "warm"
    for climate, words in (("mild", _MILD_WORDS), ("cold", _COLD_WORDS), ("warm", _WARM_WORDS)):
        if any(re.search(rf"\b{re.escape(word)}\b", text) for word in words):
            return climate
    return None


def _group_size(text: str) -> Optional[int]:
    match = _GROUP_RE.search(text)
    if not match:
        return None
    digits = next((g for g in match.groups() if g), None)
    if digits is None:
        return None
    size = int(digits)
    # Above thirty it is far more likely to be a price or a year than a party.
    return size if 1 <= size <= 30 else None


def parse_heuristic(query: str) -> ParsedQuery:
    """Keyword and regex extraction — pure, synchronous, no network. This is the
    documented fallback and the only layer that runs without an API key."""
    text = _normalise(query)
    if not text:
        return ParsedQuery(source="heuristic", confidence=0.0)

    fields: dict[str, object] = {}
    destinations = _dedupe(_DESTINATIONS[name] for name in _DESTINATION_RE.findall(text))
    if destinations:
        fields["destination"] = destinations[0]
    months = _months(text)
    if months:
        fields["months"] = months
    duration = _duration(text)
    if duration:
        fields["durationDays"] = duration
    budget = _budget(text)
    if budget:
        fields["maxPrice"] = budget
    themes = _dedupe(_THEMES[name] for name in _THEME_RE.findall(text))
    if themes:
        fields["themes"] = themes
    activities = _dedupe(_ACTIVITIES[name] for name in _ACTIVITY_RE.findall(text))
    if activities:
        fields["activities"] = activities
    audience = _dedupe(_AUDIENCE[name] for name in _AUDIENCE_RE.findall(text))
    if audience:
        fields["audience"] = audience
    climate = _climate(text)
    if climate:
        fields["climate"] = climate
    group = _group_size(text)
    if group:
        fields["groupSizeMax"] = group
    if _DIRECT_RE.search(text):
        fields["directFlights"] = True

    parsed = ParsedQuery(source="heuristic", **fields)
    parsed.confidence = _confidence(parsed)
    return parsed


# --- AI layer --------------------------------------------------------------

_SYSTEM_PROMPT = """You convert a traveller's sentence into JSON filters for a trip search.

Reply with ONE JSON object and nothing else: no prose, no explanation, no markdown fences.

Allowed keys — omit any key the sentence does not support. Never guess, never emit null.
  destination    string: a country, region or city, e.g. "Italy", "Iceland"
  months         array of integers 1-12: the departure months the sentence implies
  durationDays   integer: total trip length in days
  maxPrice       number: per-person budget ceiling in GBP
  themes         array from: Northern Lights, Beach, City break, Wildlife, Culture,
                 Food and wine, Adventure, Wellness, Ski, Rail journey, Road trip
  activities     array from: Walking, Diving, Skiing, Cycling, Kayaking, Food tour,
                 Wildlife watching, Photography, Yoga, Surfing, Sailing, Dog sledding
  audience       array from: Family, Couples, Solo, Small groups, Adventure
  climate        exactly one of: warm, mild, cold
  groupSizeMax   integer: how many people are travelling
  directFlights  true only when direct or non-stop flights are asked for

Today is {today}. Read seasons from a UK, northern-hemisphere market: winter is
11,12,1,2,3; spring 3,4,5; summer 6,7,8; autumn 9,10,11. Northern lights implies
climate cold; "somewhere warm" implies climate warm. Vague budget language such as
"not too expensive" maps to maxPrice 1500."""

_FEW_SHOTS: tuple[tuple[str, str], ...] = (
    (
        "northern lights trip for a family next winter, not too expensive",
        '{"months":[11,12,1,2,3],"themes":["Northern Lights"],"audience":["Family"],'
        '"climate":"cold","maxPrice":1500}',
    ),
    (
        "7 day walking holiday in italy with small groups",
        '{"destination":"Italy","durationDays":7,"activities":["Walking"],'
        '"audience":["Small groups"]}',
    ),
    (
        "somewhere warm in november under 1200 direct flights",
        '{"months":[11],"climate":"warm","maxPrice":1200,"directFlights":true}',
    ),
)


def _messages(query: str, reminder: Optional[str] = None) -> list[dict]:
    system = _SYSTEM_PROMPT.format(today=date.today().isoformat())
    if reminder:
        system = f"{system}\n\n{reminder}"
    out: list[dict] = [{"role": "system", "content": system}]
    for example, answer in _FEW_SHOTS:
        out.append({"role": "user", "content": example})
        out.append({"role": "assistant", "content": answer})
    out.append({"role": "user", "content": query})
    return out


async def _complete(messages: list[dict]) -> str:
    """llm.py only exposes a streaming entry point, so collect the stream here."""
    parts: list[str] = []
    async for token in llm.stream_chat(messages, temperature=0.0):
        parts.append(token)
    return "".join(parts)


def _extract_json(reply: str) -> Optional[dict]:
    """Pull the first complete JSON object out of a reply that may be fenced or
    prefixed with a sentence. Brace counting is enough for a flat filter object
    and json.loads catches anything it gets wrong."""
    text = re.sub(r"```(?:json)?", " ", reply).strip()
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    payload = json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
                return payload if isinstance(payload, dict) else None
    return None


def _as_int(value: object, low: int, high: int) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def _as_float(value: object, low: float, high: float) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(str(value).replace(",", "").replace("£", ""))
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def _as_labels(value: object, table: dict[str, str]) -> list[str]:
    raw = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            continue
        label = item.strip()
        out.append(table.get(label.lower(), label))
    return _dedupe(out)


def _clean_payload(raw: dict) -> dict:
    """Keep only keys we recognise, in the shapes ParsedQuery accepts. A model
    that invents a key or an out-of-range value loses that field, not the whole
    parse."""
    out: dict[str, object] = {}
    destination = raw.get("destination")
    if isinstance(destination, str) and destination.strip():
        out["destination"] = destination.strip()[:60]

    months = raw.get("months")
    if isinstance(months, list):
        cleaned = _dedupe(m for m in (_as_int(v, 1, 12) for v in months) if m is not None)
        if cleaned:
            out["months"] = cleaned

    duration = _as_int(raw.get("durationDays"), 1, 60)
    if duration:
        out["durationDays"] = duration
    price = _as_float(raw.get("maxPrice"), 50.0, 100_000.0)
    if price:
        out["maxPrice"] = price

    for key, table in (("themes", _THEMES), ("activities", _ACTIVITIES), ("audience", _AUDIENCE)):
        labels = _as_labels(raw.get(key), table)
        if labels:
            out[key] = labels

    climate = raw.get("climate")
    if isinstance(climate, str) and climate.strip().lower() in ("warm", "mild", "cold"):
        out["climate"] = climate.strip().lower()

    group = _as_int(raw.get("groupSizeMax"), 1, 40)
    if group:
        out["groupSizeMax"] = group
    if raw.get("directFlights") is True:
        out["directFlights"] = True
    return out


async def _parse_with_llm(query: str) -> Optional[ParsedQuery]:
    """Ask the chat chain for JSON filters. Returns None on any failure so the
    caller can fall back — a search must not wait on a sulking provider."""
    if not llm.chat_providers():
        return None

    loop = asyncio.get_running_loop()
    deadline = loop.time() + settings.nlq_timeout
    reminder: Optional[str] = None

    for attempt in (1, 2):
        remaining = deadline - loop.time()
        if remaining < 0.5:
            return None
        try:
            reply = await asyncio.wait_for(_complete(_messages(query, reminder)), timeout=remaining)
        except asyncio.TimeoutError:
            log.info("nlq parse exceeded its %.1fs budget; using heuristics", settings.nlq_timeout)
            return None
        except Exception as exc:  # noqa: BLE001 — heuristics cover every failure
            log.warning("nlq parse attempt %d failed: %s", attempt, exc)
            return None

        payload = _extract_json(reply)
        if payload is not None:
            try:
                parsed = ParsedQuery.model_validate({**_clean_payload(payload), "source": "ai"})
            except ValidationError as exc:
                log.warning("nlq parse produced an invalid ParsedQuery: %s", exc)
            else:
                parsed.confidence = _confidence(parsed)
                return parsed

        # One retry, with the failure named — models that wrap JSON in prose
        # usually comply the second time.
        reminder = (
            "Your previous reply was not a bare JSON object. Reply with the JSON object only, "
            "starting with { and ending with }."
        )

    return None


# --- Cache -----------------------------------------------------------------

_cache: "OrderedDict[str, ParsedQuery]" = OrderedDict()
_hits = 0
_misses = 0


def _cache_get(key: str) -> Optional[ParsedQuery]:
    global _hits, _misses
    hit = _cache.get(key)
    if hit is None:
        _misses += 1
        return None
    _cache.move_to_end(key)
    _hits += 1
    return hit.model_copy(deep=True)


def _cache_put(key: str, parsed: ParsedQuery) -> None:
    _cache[key] = parsed.model_copy(deep=True)
    _cache.move_to_end(key)
    while len(_cache) > max(1, settings.nlq_cache_size):
        _cache.popitem(last=False)


def cache_stats() -> dict:
    return {"size": len(_cache), "hits": _hits, "misses": _misses}


# --- Entry point -----------------------------------------------------------

async def parse(query: str) -> ParsedQuery:
    """Cache, then the AI layer, then heuristics. Never raises."""
    text = query.strip()
    if not text:
        return ParsedQuery(source="heuristic", confidence=0.0)

    key = _normalise(text)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    parsed = await _parse_with_llm(text)
    if parsed is None:
        parsed = parse_heuristic(text)
    _cache_put(key, parsed)
    return parsed
