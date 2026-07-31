"""The unified product catalogue: normalise, match, merge.

The same holiday reaches us three times — once from the CMS with the editorial
copy and the photography, once from a supplier feed with the real price and the
departure dates, once from an enrichment job with the rating and the review
count — under three different titles and three different field names. This
module turns each raw record into the Trip shape, scores it against what we
already hold, and then does exactly one of three things with it.

Uncertain matches are never published automatically. A score at or above
AUTO_MERGE is merged unattended; anything from REVIEW_FLOOR up to that becomes a
MergeCandidate and waits for an editor in the admin review queue; anything below
REVIEW_FLOOR is treated as a brand-new trip. That is the safe way round: a
duplicate on the results page is embarrassing and a human can fix it in a
minute, whereas a silently overwritten price is a mis-sold holiday.

Merging is expressed as a pure function (`merge_fields`) rather than hidden
inside the pipeline so the caller can re-run it inside its own transaction and
commit the merged row and its audit entry together.
"""
from __future__ import annotations

import html
import logging
import re
import uuid
from collections.abc import Callable
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from typing import Any, Optional

from .config import settings
from .schemas import IngestResult, MergeCandidate, Trip

log = logging.getLogger("traveliq.ingest")

# Frozen in the build contract. config.py can move them per deployment
# (AUTO_MERGE_THRESHOLD / REVIEW_FLOOR in .env) — these are the defaults.
AUTO_MERGE = 0.86
REVIEW_FLOOR = 0.60

# Per-field source priority, lowest number wins a contested field. The CMS owns
# how a trip reads, the supplier owns what it costs and when it goes, enrichment
# owns what travellers thought of it. Rows in field_priority_rules override this.
# `destination` is deliberately absent from every source: a feed sends a name,
# not a resolved destination row, so it may fill a gap but never win a contest.
DEFAULT_FIELD_PRIORITY: dict[str, dict[str, int]] = {
    "cms": {
        "title": 10,
        "summary": 10,
        "description": 10,
        "imageUrl": 10,
        "gallery": 10,
        "themes": 20,
        "activities": 20,
        "audience": 20,
        "badges": 20,
        "climate": 40,
        "priceFrom": 70,
        "months": 70,
        "available": 70,
        "rating": 70,
        "reviewCount": 70,
    },
    "supplier": {
        "priceFrom": 10,
        "months": 10,
        "available": 10,
        "departures": 10,
        "supplier": 10,
        "durationDays": 20,
        "directFlights": 20,
        "groupSizeMax": 20,
        "title": 70,
        "summary": 70,
        "description": 70,
        "gallery": 70,
        "rating": 70,
        "reviewCount": 70,
    },
    "enrichment": {
        "rating": 10,
        "reviewCount": 10,
        "climate": 20,
        "themes": 40,
        "activities": 40,
        "title": 90,
        "summary": 90,
        "description": 90,
        "priceFrom": 90,
    },
}

# Weights for the four match signals. They sum to 1, and any signal missing on
# either side drops out with its weight redistributed over the rest.
_W_TITLE = 0.50
_W_DESTINATION = 0.25
_W_DURATION = 0.15
_W_PRICE = 0.10

_DESTINATION_FLOOR = 0.40  # below this the two records are somewhere else entirely
_DIFFERENT_DESTINATION_CAP = 0.55  # ... and then they can never reach the review band

_NEUTRAL_PRIORITY = 100  # no rule for this source and field: it only fills gaps
_DEFAULT_GROUP_SIZE = 16
_MAX_DURATION_DAYS = 60  # trips.duration_days check constraint

# id, slug and provenance are the record's identity, not its content. A slug in
# particular is immutable once published: an inbound rename would break the
# trip's URL and its search-engine history, and a redirect table is the fix.
_NEVER_MERGED = frozenset({"id", "slug", "externalId", "sources"})

_CANDIDATE_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://traveliq.local/merge-candidates")

# Every alias a feed has been seen to use, in canonical form: lowercased with
# punctuation removed, so priceFrom / price_from / "Price From" all land here.
_ALIASES: dict[str, tuple[str, ...]] = {
    "externalId": ("externalid", "id", "code", "reference", "sku", "productid", "tripid"),
    "slug": ("slug", "handle", "urlkey", "seoslug"),
    "title": ("title", "name", "tripname", "productname", "headline", "displayname"),
    "summary": ("summary", "shortdescription", "teaser", "strapline", "subtitle", "excerpt"),
    "description": ("description", "longdescription", "overview", "body", "details", "copy"),
    "destination": ("destination", "destinationname", "location", "place", "country", "region"),
    "country": ("country", "countryname", "countrycode"),
    "region": ("region", "area", "continent", "subregion"),
    "lat": ("lat", "latitude"),
    "lng": ("lng", "lon", "long", "longitude"),
    "themes": ("themes", "theme", "categories", "category", "tags", "collections"),
    "activities": ("activities", "activity", "experiences", "whatsincluded"),
    "audience": ("audience", "audiences", "suitablefor", "travellertype", "travelertype"),
    "durationDays": ("durationdays", "duration", "days", "lengthdays", "tripdays", "lengthofstay"),
    "nights": ("nights", "numnights", "lengthnights"),
    "priceFrom": (
        "pricefrom", "price", "fromprice", "leadinprice", "adultprice", "priceperperson", "amount",
    ),
    "currency": ("currency", "currencycode"),
    "rating": ("rating", "averagerating", "reviewscore", "score"),
    "reviewCount": ("reviewcount", "reviews", "numreviews", "reviewstotal"),
    "climate": ("climate", "weather"),
    "months": ("months", "departuremonths", "availablemonths", "season"),
    "directFlights": ("directflights", "direct", "nonstop"),
    "groupSizeMax": ("groupsizemax", "maxgroupsize", "groupsize", "capacity", "maxtravellers"),
    "available": ("available", "isavailable", "onsale", "instock", "bookable"),
    "imageUrl": ("imageurl", "image", "heroimage", "mainimage", "thumbnail"),
    "gallery": ("gallery", "images", "photos", "media"),
    "supplier": ("supplier", "operator", "brand", "vendor"),
    "badges": ("badges", "labels", "flags"),
    "departures": ("departures", "departuredates", "dates", "availability"),
    "date": ("date", "departuredate", "startdate", "traveldate", "departson"),
    "seatsLeft": ("seatsleft", "seats", "availableseats", "spacesleft", "remaining"),
    "updatedAt": ("updatedat", "modifiedat", "lastmodified", "receivedat", "timestamp"),
    "sourceKey": ("sourcekey", "source", "supplierkey", "feed"),
    "fieldName": ("fieldname", "field"),
    "priority": ("priority", "rank", "order"),
    "conditions": ("conditions", "condition", "when"),
}

# Feeds that wrap the payload rather than sending it flat. Outer keys win.
_WRAPPER_KEYS = ("attributes", "fields", "data", "product", "trip")

_MONTH_NAMES = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

_SEASON_MONTHS = {
    "winter": (11, 12, 1, 2, 3),
    "spring": (3, 4, 5),
    "summer": (6, 7, 8),
    "autumn": (9, 10, 11),
    "fall": (9, 10, 11),
}

_AUDIENCE_SYNONYMS = {
    "family": "Family", "families": "Family", "familyfriendly": "Family", "children": "Family",
    "couple": "Couples", "couples": "Couples", "honeymoon": "Couples", "romantic": "Couples",
    "solo": "Solo", "solotraveller": "Solo", "solotraveler": "Solo", "singles": "Solo",
    "smallgroup": "Small groups", "smallgroups": "Small groups", "group": "Small groups",
    "groups": "Small groups", "grouptour": "Small groups",
    "adventure": "Adventure", "adventurous": "Adventure", "active": "Adventure",
}

_CLIMATES = {
    "warm": "warm", "hot": "warm", "tropical": "warm", "sunny": "warm",
    "mild": "mild", "temperate": "mild", "moderate": "mild",
    "cold": "cold", "cool": "cold", "arctic": "cold", "polar": "cold", "snowy": "cold",
}

_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
    "%d %b %Y", "%d %B %Y", "%b %d %Y", "%B %d, %Y",
)

_TITLE_STOPWORDS = {
    "the", "a", "an", "and", "of", "in", "on", "at", "to", "for", "with", "from", "by",
    "day", "days", "night", "nights", "tour", "tours", "trip", "trips", "holiday",
    "holidays", "break", "breaks", "escape", "escapes", "experience", "adventure",
}


def _thresholds() -> tuple[float, float]:
    """The live thresholds — the constants above are the contract defaults and
    .env may move them for a market that wants a stricter or looser matcher."""
    return (
        settings.auto_merge_threshold or AUTO_MERGE,
        settings.review_floor or REVIEW_FLOOR,
    )


# --- Reading whatever the feed sent ----------------------------------------

def _canon(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _reader(raw: dict) -> Callable[[str], Any]:
    """A tolerant getter over one raw record: `read("priceFrom")` finds `price`,
    `price_from`, `leadInPrice` or `amount`, whichever the feed actually sent."""
    flat: dict[str, Any] = {}
    for key, value in raw.items():
        if _canon(key) in _WRAPPER_KEYS and isinstance(value, dict):
            flat.update({_canon(k): v for k, v in value.items()})
    flat.update({_canon(k): v for k, v in raw.items()})

    def read(name: str) -> Any:
        for alias in _ALIASES.get(name, (_canon(name),)):
            value = flat.get(alias)
            if value is not None and value != "":
                return value
        return None

    return read


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(value))  # descriptions arrive as HTML often enough
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _iter_values(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return list(value)
    if isinstance(value, dict):
        return [value]
    if isinstance(value, str):
        return [part for part in re.split(r"[,;|]", value) if part.strip()]
    return [value]


def _dict_text(item: dict) -> str:
    read = _reader(item)
    for name in ("title", "slug"):
        text = _clean_text(read(name))
        if text:
            return text
    return ""


def _string_list(value: Any) -> list[str]:
    """Themes, activities and badges, de-duplicated with their order kept.

    Casing is left alone unless the feed shouted or whispered the whole value —
    mapping a supplier's vocabulary onto our taxonomy is the synonyms table's
    job, not a guess here."""
    out: list[str] = []
    for item in _iter_values(value):
        text = _dict_text(item) if isinstance(item, dict) else _clean_text(item)
        if not text:
            continue
        if text.islower() or text.isupper():
            text = text.capitalize()
        if text not in out:
            out.append(text)
    return out


def _url_list(value: Any) -> list[str]:
    out: list[str] = []
    for item in _iter_values(value):
        if isinstance(item, dict):
            read = _reader(item)
            url = _clean_text(read("imageUrl") or item.get("url") or item.get("src"))
        else:
            url = _clean_text(item)
        if url and url not in out:
            out.append(url)
    return out


def _coerce_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", str(value or "").replace(" ", ""))
    return float(match.group(0).replace(",", "")) if match else None


def _coerce_price(value: Any) -> Optional[float]:
    """'£1,299 pp', Decimal('1299.00') and 1299 all mean the same thing. A
    negative price is a feed error, not a discount, so it reads as missing."""
    price = _coerce_float(value)
    if price is None or price < 0:
        return None
    return round(price, 2)


def _coerce_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else None


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    token = _canon(value)
    if token in ("true", "yes", "y", "1", "available", "onsale", "instock", "bookable", "on"):
        return True
    if token in ("false", "no", "n", "0", "unavailable", "soldout", "offsale", "off"):
        return False
    return default


def _coerce_rating(value: Any) -> float:
    rating = _coerce_float(value)
    if rating is None:
        return 0.0
    # Feeds publish ratings out of 5, out of 10 and out of 100. Anything above 5
    # is one of the other two scales, so bring it back to ours.
    if rating > 10:
        rating /= 20
    elif rating > 5:
        rating /= 2
    return round(min(5.0, max(0.0, rating)), 2)


def _coerce_duration(days: Any, nights: Any) -> int:
    """Travelling days. 0 means the feed did not say, which merge_fields then
    treats as a gap rather than as a duration of nothing."""
    value = _coerce_int(days)
    if value is not None and "night" in str(days).lower():
        value += 1  # the feed labelled its nights as days
    if value is None:
        count = _coerce_int(nights)
        # A seven-night holiday is eight travelling days, and feeds mix the two
        # freely — this off-by-one is what makes a duration filter feel broken.
        value = count + 1 if count is not None else None
    if value is None:
        return 0
    return max(1, min(_MAX_DURATION_DAYS, value))


def _coerce_climate(value: Any) -> str:
    token = _canon(value)
    # 'mild' is the neutral answer; enrichment normally supplies the real one.
    return _CLIMATES.get(token, "mild")


def _coerce_audience(value: Any) -> list[str]:
    out: list[str] = []
    for item in _iter_values(value):
        text = _dict_text(item) if isinstance(item, dict) else _clean_text(item)
        mapped = _AUDIENCE_SYNONYMS.get(_canon(text))
        if mapped and mapped not in out:
            out.append(mapped)
    return out


def _coerce_months(value: Any) -> list[int]:
    months: set[int] = set()
    for item in _iter_values(value):
        if isinstance(item, bool):
            continue
        if isinstance(item, (int, float)):
            months.add(int(item))
            continue
        token = _canon(item)
        if token in _SEASON_MONTHS:
            months.update(_SEASON_MONTHS[token])
            continue
        named = _MONTH_NAMES.get(token[:9]) or _MONTH_NAMES.get(token[:3])
        months.add(named or _coerce_int(item) or 0)
    return sorted(m for m in months if 1 <= m <= 12)


def _coerce_date(value: Any) -> Optional[str]:
    """An ISO yyyy-mm-dd string, or None when nothing in the value looks like a
    date. Handles ISO, UK dd/mm/yyyy, '12 Nov 2026' and epoch seconds or ms."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = float(value) / 1000 if float(value) > 1e11 else float(value)
        return datetime.fromtimestamp(seconds, tz=timezone.utc).date().isoformat()
    text = _clean_text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    log.debug("unparsed date %r", text)
    return None


def _coerce_departures(value: Any, prefix: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for item in _iter_values(value):
        if isinstance(item, dict):
            read = _reader(item)
            iso = _coerce_date(read("date"))
            price = _coerce_price(read("priceFrom")) or 0.0
            seats = _coerce_int(read("seatsLeft")) or 0
            direct = _coerce_bool(read("directFlights"), default=False)
        else:
            iso, price, seats, direct = _coerce_date(item), 0.0, 0, False
        if not iso or iso in seen:
            continue
        seen.add(iso)
        # Stable id: the same departure re-synced must not become a second row.
        out.append(
            {"id": f"{prefix}-{iso}", "date": iso, "price": price, "seatsLeft": seats,
             "direct": direct}
        )
    return sorted(out, key=lambda d: d["date"])


def _slugify(text: str, limit: int = 160) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", _clean_text(text).lower()).strip("-")
    return slug[:limit].rstrip("-")


def _destination_dict(value: Any, country: Any, region: Any) -> dict:
    name = ""
    slug = ""
    image = ""
    lat = 0.0
    lng = 0.0
    if isinstance(value, dict):
        read = _reader(value)
        name = _clean_text(read("title"))
        slug = _slugify(_clean_text(read("slug")) or name, limit=120)
        image = _clean_text(read("imageUrl"))
        lat = _coerce_float(read("lat")) or 0.0
        lng = _coerce_float(read("lng")) or 0.0
        country = _clean_text(read("country")) or _clean_text(country)
        region = _clean_text(read("region")) or _clean_text(region)
    else:
        name = _clean_text(value)
        slug = _slugify(name, limit=120)
        country = _clean_text(country)
        region = _clean_text(region)
    return {
        "id": "",
        "slug": slug,
        "name": name,
        "country": country or name,
        "region": region,
        # Coordinates the feed omitted stay at 0. The repository resolves the
        # destination row by slug, and its real lat/lng is what reaches the wire.
        "lat": lat,
        "lng": lng,
        "imageUrl": image,
    }


def _as_dict(value: dict | Trip) -> dict:
    return value.model_dump() if isinstance(value, Trip) else dict(value)


def _destination_name(value: Any) -> str:
    if isinstance(value, dict):
        read = _reader(value)
        return _canon(_clean_text(read("title")) or _clean_text(read("country")))
    return _canon(_clean_text(value))


# --- Normalising -----------------------------------------------------------

def normalise_record(raw: dict, source_key: str) -> dict:
    """One raw feed record in the Trip shape, with `departures` and `externalId`
    riding along for the repository to write to their own tables.

    Missing keys become the neutral value rather than an error: a sparse
    enrichment record that carries only a title and a rating still has to be
    matchable against the catalogue, and refusing the whole batch because one
    supplier renamed a column is not a useful failure mode."""
    read = _reader(raw)
    title = _clean_text(read("title"))
    external_id = _clean_text(read("externalId"))
    slug = _slugify(_clean_text(read("slug")) or title or f"{source_key}-{external_id}")
    departures = _coerce_departures(read("departures"), prefix=external_id or slug or source_key)

    price = _coerce_price(read("priceFrom"))
    if price is None:
        lead_in = [d["price"] for d in departures if d["price"] > 0]
        price = min(lead_in) if lead_in else None

    months = _coerce_months(read("months"))
    if not months:
        months = sorted({int(d["date"][5:7]) for d in departures})

    return {
        "externalId": external_id,
        "slug": slug,
        "title": title,
        "summary": _clean_text(read("summary")),
        "description": _clean_text(read("description")),
        "destination": _destination_dict(read("destination"), read("country"), read("region")),
        "themes": _string_list(read("themes")),
        "activities": _string_list(read("activities")),
        "audience": _coerce_audience(read("audience")),
        "durationDays": _coerce_duration(read("durationDays"), read("nights")),
        "priceFrom": price if price is not None else 0.0,
        # Single-currency POC: a second currency needs a rates table and a
        # display currency per market, not a per-trip string.
        "currency": "GBP",
        "rating": _coerce_rating(read("rating")),
        "reviewCount": _coerce_int(read("reviewCount")) or 0,
        "climate": _coerce_climate(read("climate")),
        "months": months,
        "directFlights": _coerce_bool(read("directFlights"), default=False),
        "groupSizeMax": _coerce_int(read("groupSizeMax")) or _DEFAULT_GROUP_SIZE,
        "available": _coerce_bool(read("available"), default=True),
        "imageUrl": _clean_text(read("imageUrl")),
        "gallery": _url_list(read("gallery")),
        "supplier": _clean_text(read("supplier")) or source_key,
        "badges": _string_list(read("badges")),
        "sources": [source_key],
        "departures": departures,
        "updatedAt": _coerce_date(read("updatedAt")) or "",
    }


# --- Matching --------------------------------------------------------------

def _title_tokens(title: str) -> set[str]:
    words = re.sub(r"[^a-z0-9\s]", " ", title.lower()).split()
    return {w for w in words if len(w) > 1 and w not in _TITLE_STOPWORDS}


def _title_similarity(left: str, right: str) -> float:
    """Sequence similarity over the sorted, de-noised token sets, blended with
    plain token overlap so word order and product nouns ('7 Day Tour of ...')
    do not decide whether two holidays are the same holiday."""
    a, b = _title_tokens(left), _title_tokens(right)
    if not a or not b:
        return 0.0
    overlap = len(a & b) / len(a | b)
    ratio = SequenceMatcher(None, " ".join(sorted(a)), " ".join(sorted(b))).ratio()
    return round(0.6 * ratio + 0.4 * overlap, 4)


def _destination_component(left: Any, right: Any) -> tuple[Optional[float], str]:
    a, b = _destination_name(left), _destination_name(right)
    if not a or not b:
        return None, "destination unknown on one side"
    if a == b:
        return 1.0, "same destination"
    if a in b or b in a:
        return 0.85, f"destination overlaps ({a.title()} / {b.title()})"
    ratio = round(SequenceMatcher(None, a, b).ratio(), 3)
    if ratio >= 0.7:
        return ratio, f"destination similar ({a.title()} / {b.title()})"
    return ratio, f"different destination ({a.title()} / {b.title()})"


def _duration_component(left: Any, right: Any) -> tuple[Optional[float], str]:
    a, b = _coerce_int(left), _coerce_int(right)
    if not a or not b:
        return None, "duration unknown on one side"
    gap = abs(a - b)
    if gap == 0:
        return 1.0, "same duration"
    if gap == 1:
        return 0.85, "duration within 1 day"
    if gap == 2:
        return 0.5, "duration within 2 days"
    return 0.0, f"duration differs by {gap} days"


def _price_component(left: Any, right: Any) -> tuple[Optional[float], str]:
    a, b = _coerce_price(left), _coerce_price(right)
    if not a or not b:
        return None, "price unknown on one side"
    delta = abs(a - b) / max(a, b)
    percent = round(delta * 100)
    if delta <= 0.05:
        return 1.0, f"price within {percent}%"
    if delta <= 0.15:
        return 0.6, f"price within {percent}%"
    if delta <= 0.30:
        return 0.3, f"price differs by {percent}%"
    return 0.0, f"price differs by {percent}%"


def match_score(left: dict | Trip, right: dict | Trip) -> tuple[float, list[str]]:
    """How likely it is that two records describe the same holiday, and why.

    The reasons are what an editor reads in the review queue, so they are
    written for a person: "title 0.93", "same destination", "duration within
    1 day". Works on raw feed records as well as normalised ones, because
    `_reader` does the alias hunting either way."""
    a, b = _reader(_as_dict(left)), _reader(_as_dict(right))
    reasons: list[str] = []
    parts: list[tuple[float, float]] = []

    title = _title_similarity(_clean_text(a("title")), _clean_text(b("title")))
    parts.append((_W_TITLE, title))
    reasons.append(f"title {title:.2f}")

    destination, reason = _destination_component(a("destination"), b("destination"))
    reasons.append(reason)
    if destination is not None:
        parts.append((_W_DESTINATION, destination))

    duration, reason = _duration_component(a("durationDays"), b("durationDays"))
    reasons.append(reason)
    if duration is not None:
        parts.append((_W_DURATION, duration))

    price, reason = _price_component(a("priceFrom"), b("priceFrom"))
    reasons.append(reason)
    if price is not None:
        parts.append((_W_PRICE, price))

    weight = sum(w for w, _ in parts)
    score = sum(w * v for w, v in parts) / weight if weight else 0.0
    if destination is not None and destination < _DESTINATION_FLOOR:
        # Two holidays in different countries are not the same holiday however
        # closely their titles rhyme, so this pair can never auto-merge.
        score = min(score, _DIFFERENT_DESTINATION_CAP)
    return round(score, 3), reasons


def _best_match(record: dict, catalogue: list[dict]) -> tuple[Optional[int], float, list[str]]:
    """The closest existing trip. Scoring the whole catalogue is fine at POC
    scale; production blocks on destination and a pg_trgm index on title first
    so a 50k-row feed does not become 50k x 20k comparisons."""
    best_index: Optional[int] = None
    best_score = 0.0
    best_reasons: list[str] = []
    for i, existing in enumerate(catalogue):
        score, reasons = match_score(existing, record)
        if score > best_score:
            best_index, best_score, best_reasons = i, score, reasons
    return best_index, best_score, best_reasons


# --- Merging ---------------------------------------------------------------

def _source_kind(source_key: str) -> str:
    key = _canon(source_key)
    if "cms" in key or "contentful" in key or "editorial" in key:
        return "cms"
    if "enrich" in key or "review" in key:
        return "enrichment"
    return "supplier"


def _effective_rules(rules: Optional[list[dict]]) -> list[dict]:
    """field_priority_rules rows in one shape, whichever casing they arrive in."""
    out: list[dict] = []
    for rule in rules or []:
        read = _reader(rule)
        source = _clean_text(read("sourceKey"))
        field = _clean_text(read("fieldName"))
        if not source or not field:
            continue
        conditions = read("conditions")
        out.append(
            {
                "sourceKey": source,
                "fieldName": field,
                "priority": _coerce_int(read("priority")) or _NEUTRAL_PRIORITY,
                "conditions": conditions if isinstance(conditions, dict) else {},
            }
        )
    return out


def _conditions_met(conditions: dict, record: dict) -> bool:
    only_if = conditions.get("onlyIf")
    if isinstance(only_if, dict):
        for key, expected in only_if.items():
            if record.get(key) != expected:
                return False
    max_age = conditions.get("maxAgeHours")
    stamp = _coerce_date(_reader(record)("updatedAt"))
    if max_age and stamp:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(stamp).replace(
            tzinfo=timezone.utc
        )
        if age.total_seconds() / 3600 > float(max_age):
            return False
    # A record with no timestamp cannot fail maxAgeHours. Making the rule
    # enforceable means the feed sending receivedAt with every payload.
    return True


def _priority(source_key: str, field: str, rules: list[dict], record: dict) -> int:
    kind = _source_kind(source_key)
    for wanted in (source_key, kind):
        for rule in rules:
            if rule["sourceKey"] == wanted and rule["fieldName"] == field:
                if not _conditions_met(rule["conditions"], record):
                    return _NEUTRAL_PRIORITY
                return rule["priority"]
    return DEFAULT_FIELD_PRIORITY.get(kind, {}).get(field, _NEUTRAL_PRIORITY)


def _is_empty(value: Any) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, (list, dict, tuple, set)) and not value:
        return True
    # 0 means "the feed did not say" for every number on a trip: a real holiday
    # has a price, a duration, a group size. Booleans are excluded on purpose —
    # `available: false` is an answer, not a gap.
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0:
        return True
    return False


def _ordered_union(first: list[str], second: list[str]) -> list[str]:
    out = list(first)
    for item in second:
        if item and item not in out:
            out.append(item)
    return out


def merge_fields(base: dict, incoming: dict, source_key: str, rules: list[dict]) -> dict:
    """Fold an incoming record into an existing trip under the field-priority
    rules: the source with the lowest priority number for a field wins it.

    Two things the rules never get a vote on. An empty incoming value never
    overwrites a real one, and an empty existing value is always filled — a gap
    is not a conflict. Provenance goes into `sources`, which is what the result
    card and the trip page read to say where each trip came from.

    Per-field provenance would let this compare the incoming claim against the
    source that actually wrote the field last; with only the `sources` list to
    hand we take the strongest claim any of the trip's existing sources has,
    which is conservative in the right direction. A `trip_field_sources` table
    is what would make it exact."""
    effective = _effective_rules(rules)  # idempotent, so raw DB rows are fine here
    merged = dict(base)
    base_sources = [s for s in (base.get("sources") or []) if s]
    won: list[str] = []

    for field, value in incoming.items():
        if field in _NEVER_MERGED or _is_empty(value):
            continue
        current = merged.get(field)
        if _is_empty(current):
            merged[field] = value
            won.append(field)
            continue
        incoming_priority = _priority(source_key, field, effective, incoming)
        held = min(
            (_priority(source, field, effective, base) for source in base_sources),
            default=_NEUTRAL_PRIORITY,
        )
        if incoming_priority < held:
            merged[field] = value
            won.append(field)

    merged["sources"] = _ordered_union(base_sources, [source_key])
    if won:
        log.debug("%s won %s on %s", source_key, ", ".join(won), base.get("slug", "?"))
    return merged


# --- The pipeline ----------------------------------------------------------

def _candidate(
    base: dict, record: dict, source_key: str, score: float, reasons: list[str]
) -> MergeCandidate:
    left_source = next((s for s in (base.get("sources") or []) if s), "catalogue")
    identity = f"{source_key}:{record.get('externalId') or record['slug']}:{base.get('slug', '')}"
    return MergeCandidate(
        # Deterministic, so a re-sync updates the same queue entry instead of
        # filling the review queue with copies of one decision.
        id=str(uuid.uuid5(_CANDIDATE_NS, identity)),
        leftTitle=base.get("title", ""),
        rightTitle=record.get("title", ""),
        leftSource=left_source,
        rightSource=source_key,
        score=score,
        reasons=reasons,
        status="pending",
    )


async def run_ingest(
    source_key: str,
    records: list[dict],
    existing: list[Trip],
    rules: list[dict] | None = None,
) -> tuple[IngestResult, list[MergeCandidate]]:
    """Classify a batch of feed records against the catalogue.

    `merged` are the records confident enough to fold into an existing trip
    unattended, `queued` are the ones an editor has to decide on, and `rejected`
    counts records rejected *as matches* — they are new trips, not discarded
    data. Nothing in the queued band is published until somebody approves it.

    What comes back is the classification and the review queue, not a new
    catalogue: persisting a merge belongs to the caller, which re-runs
    `merge_fields` inside its own transaction so the row and its audit entry
    commit together. The merge happens here too, against a working copy, because
    a batch that carries the same holiday twice has to collapse into one trip.

    Async because the repository awaits it and a Postgres-backed caller will do
    its reads and writes here; the matching itself is pure and synchronous."""
    auto_merge, review_floor = _thresholds()
    effective = _effective_rules(rules)
    # Records are matched against a growing copy of the catalogue so two feeds
    # of the same holiday inside one batch collapse into one trip.
    catalogue = [_as_dict(trip) for trip in existing]
    result = IngestResult(received=len(records))
    candidates: list[MergeCandidate] = []
    unusable = 0

    for raw in records:
        record = normalise_record(raw, source_key)
        if not record["title"]:
            unusable += 1
            result.rejected += 1
            continue
        index, score, reasons = _best_match(record, catalogue)
        if index is not None and score >= auto_merge:
            catalogue[index] = merge_fields(catalogue[index], record, source_key, effective)
            result.merged += 1
        elif index is not None and score >= review_floor:
            candidates.append(_candidate(catalogue[index], record, source_key, score, reasons))
            result.queued += 1
        else:
            catalogue.append(record)
            result.rejected += 1

    if unusable:
        log.warning(
            "%s: %d record(s) carried no usable title and were not published", source_key, unusable
        )
    log.info(
        "ingest %s: received=%d merged=%d queued=%d new=%d",
        source_key,
        result.received,
        result.merged,
        result.queued,
        result.rejected,
    )
    return result, candidates
