"""`python -m app.load_makemytrip` — load the PromptCloud MakeMyTrip crawl into the catalogue.

Turns `marketing_sample_for_makemytrip_com-travel__20190901_20190930__30k_data.csv`
(30k crawled rows, ~2,250 distinct packages once the per-departure-city duplicates
collapse) into destinations, a supplier, trips, media and departures — written with
the same `_Table`/`_upsert` machinery and deterministic ids `app.seed` uses, so the
load is idempotent: run it twice and the rows refresh instead of duplicating.

Why not POST the rows to /ingest: that endpoint classifies feed records against the
catalogue and writes source_records plus the merge review queue — it never publishes
a new trip (see repository.ingest_records). Bulk catalogue loading is a seed-shaped
job, so this script is a sibling of app/seed.py rather than an API client.

What the mapping does and does not invent, stated plainly:

  * **Real, taken from the CSV**: title, itinerary, places covered, sightseeing,
    hotels, nights (durationDays = sum of "2N" segments + 1), package type, start
    city, airline, per-person price, travel date.
  * **Converted**: INR -> GBP at the 2019 rate (~0.0095), rounded to £5 — the
    catalogue is single-currency GBP. Most packages land £60-£400, so the loaded
    data skews budget; that is the honest conversion, not a scaling.
  * **Derived**: themes/activities/audience from keyword tables over the title,
    places and sightseeing text, emitting ONLY the vocabulary the seed catalogue
    already uses — so facets, chips and theme boosts keep working. Climate from a
    destination table (Himalayan cold, coastal/SE-Asian warm, mild otherwise).
    months = the crawl's travel month ±1 (the data is a Sep-Oct 2019 crawl, so
    months cluster Aug-Nov; queries for spring will lean on the original seed).
  * **Synthetic, deterministic, and only where the UI needs a value**: rating from
    the package's own hotel ratings where present (else hash-seeded 3.8-4.6),
    reviewCount and groupSizeMax hash-seeded, images picked per-theme from a small
    curated Unsplash set. Departures come from repository.departures_for, the same
    generator the seed catalogue uses.

The embedding index only builds at API startup (main.py), so after loading:
restart the backend to re-embed. 1000+ trips on a free-tier embedding key can take
a few minutes or rate-limit — search falls back to lexical until the build lands.

Usage:
    python -m app.load_makemytrip --dry-run
    python -m app.load_makemytrip                 # 1000 packages
    python -m app.load_makemytrip --rows 250 --csv path/to/file.csv
    python -m app.load_makemytrip --reset-source  # drop previously loaded MMT trips first
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import logging
import re
from collections import Counter
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

from sqlalchemy import delete, select

from . import db, models
from .config import settings
from .repository import seed_uuid
from .schemas import Trip
from .seed import _Table, _num, _slug, _upsert, _departure_rows, _media_rows, _trip_rows

log = logging.getLogger("traveliq.load_makemytrip")

SOURCE_KEY = "makemytrip"
DEFAULT_CSV = "marketing_sample_for_makemytrip_com-travel__20190901_20190930__30k_data.csv"
INR_TO_GBP = 0.0095  # ~the Sep 2019 rate, matching the crawl window

_NIGHTS_RE = re.compile(r"(\d+)\s*N\b", re.IGNORECASE)
_DATE_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{4})")
_HOTEL_RATING_RE = re.compile(r":\s*(\d\.\d)")

# --- Destination knowledge ---------------------------------------------------
# country + approximate centre for every primary destination the crawl actually
# contains (117 across the 2,252 deduped packages). Unlisted names default to
# India at (0, 0); the load report counts how many rows took that fallback so a
# new crawl slice cannot silently ship a pile of unmappable destinations.

_DEST: dict[str, tuple[str, float, float]] = {
    # India — hills and mountains
    "Shimla": ("India", 31.104, 77.173), "Manali": ("India", 32.243, 77.189),
    "Kullu": ("India", 31.958, 77.109), "Dalhousie": ("India", 32.536, 75.971),
    "Dharamshala": ("India", 32.219, 76.323), "Kasauli": ("India", 30.898, 76.965),
    "Parwanoo": ("India", 30.837, 76.961), "Chail": ("India", 30.968, 77.189),
    "Kasol": ("India", 32.010, 77.315), "Mussoorie": ("India", 30.459, 78.066),
    "Nainital": ("India", 29.380, 79.454), "Ranikhet": ("India", 29.641, 79.432),
    "Leh": ("India", 34.152, 77.577), "Srinagar": ("India", 34.084, 74.797),
    "Gulmarg": ("India", 34.048, 74.380), "Pahalgam": ("India", 34.010, 75.315),
    "Patnitop": ("India", 33.083, 75.318), "Katra": ("India", 32.992, 74.932),
    "Gangtok": ("India", 27.339, 88.607), "Pelling": ("India", 27.300, 88.240),
    "Namchi": ("India", 27.166, 88.364), "Darjeeling": ("India", 27.036, 88.263),
    "Kalimpong": ("India", 27.060, 88.470), "Siliguri": ("India", 26.727, 88.395),
    "Shillong": ("India", 25.578, 91.893), "Guwahati": ("India", 26.144, 91.736),
    "Ooty": ("India", 11.406, 76.695), "Kodaikanal": ("India", 10.238, 77.489),
    "Munnar": ("India", 10.089, 77.060), "Coorg": ("India", 12.337, 75.807),
    "Wayanad": ("India", 11.685, 76.132), "Chikmangalur": ("India", 13.316, 75.772),
    "Mount Abu": ("India", 24.593, 72.715),
    # India — coast and backwaters
    "Goa": ("India", 15.300, 74.086), "Gokarna": ("India", 14.550, 74.318),
    "Ganpatipule": ("India", 17.145, 73.266), "Cochin": ("India", 9.932, 76.267),
    "Allepey": ("India", 9.498, 76.339), "Kumarakom": ("India", 9.618, 76.428),
    "Kovalam": ("India", 8.402, 76.978), "Kovalam and Poovar": ("India", 8.402, 76.978),
    "Varkala": ("India", 8.737, 76.716), "Kanyakumari": ("India", 8.088, 77.538),
    "Rameshwaram": ("India", 9.288, 79.313), "Pondicherry": ("India", 11.913, 79.814),
    "Mahabalipuram": ("India", 12.620, 80.192), "Port Blair": ("India", 11.667, 92.736),
    "Thekkady": ("India", 9.603, 77.160),
    # India — cities, culture, wildlife
    "Jaipur": ("India", 26.912, 75.787), "Udaipur": ("India", 24.586, 73.712),
    "Jodhpur": ("India", 26.238, 73.024), "Jaisalmer": ("India", 26.912, 70.912),
    "Bikaner": ("India", 28.023, 73.312), "Pushkar": ("India", 26.490, 74.551),
    "Ajmer": ("India", 26.449, 74.640), "Alwar": ("India", 27.553, 76.635),
    "Chittorgarh": ("India", 24.880, 74.630), "Ranthambhore": ("India", 26.017, 76.503),
    "New Delhi": ("India", 28.614, 77.209), "Agra": ("India", 27.177, 78.008),
    "Mathura": ("India", 27.492, 77.674), "Amritsar": ("India", 31.634, 74.872),
    "Chandigarh": ("India", 30.733, 76.779), "Haridwar": ("India", 29.946, 78.164),
    "Rishikesh": ("India", 30.087, 78.268), "Corbett": ("India", 29.530, 78.774),
    "Mumbai": ("India", 19.076, 72.878), "Nasik": ("India", 19.997, 73.790),
    "Shirdi": ("India", 19.766, 74.477), "Aurangabad": ("India", 19.876, 75.343),
    "Ahmedabad": ("India", 23.023, 72.571), "Bangalore": ("India", 12.972, 77.594),
    "Mysore": ("India", 12.296, 76.639), "Hassan": ("India", 13.005, 76.103),
    "Chennai": ("India", 13.083, 80.270), "Madurai": ("India", 9.925, 78.120),
    "Tanjore": ("India", 10.787, 79.138), "Tiruchirapally": ("India", 10.790, 78.705),
    "Tirupati": ("India", 13.629, 79.419), "Kaziranga": ("India", 26.577, 93.171),
    "Nameri": ("India", 26.939, 92.881), "Bandipur": ("India", 11.757, 76.628),
    # Sri Lanka
    "Colombo": ("Sri Lanka", 6.927, 79.861), "Kandy": ("Sri Lanka", 7.291, 80.636),
    "Bentota": ("Sri Lanka", 6.426, 79.996), "Negombo": ("Sri Lanka", 7.209, 79.836),
    "Nuwara Eliya": ("Sri Lanka", 6.949, 80.789), "Sigiriya": ("Sri Lanka", 7.957, 80.760),
    "Dambulla": ("Sri Lanka", 7.874, 80.651), "Anuradhapura": ("Sri Lanka", 8.311, 80.404),
    "Yala": ("Sri Lanka", 6.372, 81.517), "Galle": ("Sri Lanka", 6.053, 80.221),
    # Southeast and East Asia
    "Singapore": ("Singapore", 1.352, 103.820), "Kuala Lumpur": ("Malaysia", 3.139, 101.687),
    "Langkawi": ("Malaysia", 6.350, 99.800), "Penang": ("Malaysia", 5.417, 100.330),
    "Genting": ("Malaysia", 3.423, 101.793), "Kota Kinabalu": ("Malaysia", 5.980, 116.073),
    "Bangkok": ("Thailand", 13.756, 100.502), "Pattaya": ("Thailand", 12.924, 100.882),
    "Phuket": ("Thailand", 7.880, 98.392), "Krabi town": ("Thailand", 8.086, 98.906),
    "Bali": ("Indonesia", -8.409, 115.189), "Kuta": ("Indonesia", -8.723, 115.172),
    "Hong Kong": ("Hong Kong", 22.319, 114.169),
    # South Asia and the Gulf
    "Kathmandu": ("Nepal", 27.717, 85.324), "Thimpu": ("Bhutan", 27.472, 89.639),
    "Phuentsholing": ("Bhutan", 26.851, 89.388), "Dubai": ("United Arab Emirates", 25.204, 55.271),
    "Abu Dhabi": ("United Arab Emirates", 24.454, 54.377), "Sharjah": ("United Arab Emirates", 25.346, 55.421),
    "Mauritius": ("Mauritius", -20.348, 57.552),
    # Long haul
    "Paris": ("France", 48.857, 2.352), "Prague": ("Czech Republic", 50.076, 14.437),
    "Copenhagen": ("Denmark", 55.676, 12.568), "Moscow": ("Russia", 55.756, 37.617),
    "Christchurch": ("New Zealand", -43.532, 172.636), "Queenstown": ("New Zealand", -45.031, 168.663),
}

# --- Derivation tables ---------------------------------------------------------
# Values on the right are EXACTLY the seed catalogue's vocabulary (seed_data.TRIPS),
# so /search facets, the assistant's theme chips and rag.py's agreement boosts all
# keep working over the loaded rows. A keyword with no confident mapping maps to
# nothing — a missing theme costs a boost, a wrong theme poisons a facet.

_THEME_KEYWORDS: list[tuple[str, str]] = [
    (r"beach|island|goa\b|andaman|port blair|kovalam|varkala|langkawi|phuket|krabi|"
     r"pattaya|bali|kuta|bentota|negombo|mauritius|gokarna|ganpatipule|penang", "Beach"),
    (r"safari|wildlife|national park|tiger|corbett|ranthambhore|kaziranga|bandipur|"
     r"yala|sanctuary|elephant", "Wildlife"),
    (r"temple|palace|fort|heritage|monastery|museum|cathedral|church|mosque|"
     r"amritsar|madurai|tirupati|shirdi|haridwar|pushkar|ajmer|mathura|tanjore|"
     r"mahabalipuram|anuradhapura|sigiriya|dambulla|agra|jaipur|udaipur|chittorgarh", "Culture"),
    (r"trek|hik(e|ing)|valley|solang|rohtang|glacier|peak|mountain pass", "Walking & hiking"),
    (r"ayurved|spa|wellness|yoga|meditation|hot spring", "Wellness"),
    (r"singapore|dubai|kuala lumpur|bangkok|hong kong|paris|prague|moscow|"
     r"copenhagen|city tour|city break", "City break"),
    (r"toy train|rail", "Rail journeys"),
]

_ACTIVITY_KEYWORDS: list[tuple[str, str]] = [
    (r"trek|hik(e|ing)|walk", "Walking"),
    (r"safari|wildlife|national park|sanctuary", "Wildlife watching"),
    (r"photo", "Photography"),
    (r"snorkel", "Snorkelling"),
    (r"scuba|diving", "Diving"),
    (r"kayak", "Kayaking"),
    (r"cycling|bicycle", "Cycling"),
    (r"toy train|rail", "Rail travel"),
    (r"hot spring", "Hot springs"),
]

_AUDIENCE_KEYWORDS: list[tuple[str, str]] = [
    (r"honeymoon|romantic|couple", "Couples"),
    (r"famil(y|ies)|kids", "Family"),
    (r"group tour|group departure", "Small groups"),
    (r"adventure|trek|rafting|ski", "Adventure"),
]

_COLD = {"Shimla", "Manali", "Kullu", "Leh", "Gulmarg", "Pahalgam", "Srinagar", "Darjeeling",
         "Gangtok", "Pelling", "Namchi", "Kalimpong", "Dalhousie", "Dharamshala", "Kasol",
         "Mussoorie", "Nainital", "Ranikhet", "Thimpu", "Phuentsholing", "Moscow", "Copenhagen",
         "Prague", "Christchurch", "Queenstown", "Patnitop", "Katra", "Chail", "Kasauli"}
_WARM_COUNTRIES = {"Singapore", "Malaysia", "Thailand", "Indonesia", "Sri Lanka",
                   "United Arab Emirates", "Mauritius", "Hong Kong"}
_WARM_HINTS = re.compile(r"beach|island|goa|kovalam|allepey|cochin|pondicherry|andaman|"
                         r"port blair|chennai|madurai|kanyakumari", re.IGNORECASE)

# Curated Unsplash heroes keyed by theme, hash-rotated so cards do not all repeat
# one photo. Same host and URL shape the seed catalogue already uses.
_IMAGES: dict[str, list[str]] = {
    "Beach": [
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=80",
        "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=80",
    ],
    "Wildlife": [
        "https://images.unsplash.com/photo-1549366021-9f761d450615?w=900&q=80",
        "https://images.unsplash.com/photo-1456926631375-92c8ce872def?w=900&q=80",
    ],
    "Culture": [
        "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=80",
        "https://images.unsplash.com/photo-1477587458883-47145ed94245?w=900&q=80",
    ],
    "Walking & hiking": [
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=80",
        "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=80",
    ],
    "City break": [
        "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=80",
        "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=900&q=80",
    ],
    "": [  # no confident theme — generic travel
        "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=900&q=80",
        "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=900&q=80",
    ],
}


def _hash(text: str) -> int:
    """Deterministic across runs and machines — hash() is salted per process."""
    return int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)


def _matches(patterns: list[tuple[str, str]], text: str) -> list[str]:
    out: list[str] = []
    for pattern, value in patterns:
        if value not in out and re.search(pattern, text, re.IGNORECASE):
            out.append(value)
    return out


def _dedupe_places(raw: str) -> list[str]:
    """'Gangtok|Lachung|Gangtok|Darjeeling' -> the distinct stops, order kept."""
    return list(dict.fromkeys(p.strip() for p in raw.split("|") if p.strip()))


def _package_id(row: dict[str, str]) -> str:
    """The crawl repeats each package once per departure city; the URL's id param
    is the stable handle that collapses them (2,252 distinct in the 30k rows)."""
    query = parse_qs(urlparse(row.get("Page Url") or "").query)
    if query.get("id", [""])[0]:
        return query["id"][0]
    return (row.get("Uniq Id") or "")[:12]


def _months_around(travel_date: str) -> list[int]:
    """The travel month ±1, wrapped. The crawl window is Sep-Oct 2019, so this is
    honest about what the data says rather than inventing a year-round schedule."""
    match = _DATE_RE.match(travel_date.strip())
    if not match:
        return []
    month = int(match.group(2))
    if not 1 <= month <= 12:
        return []
    return sorted({(month - 2) % 12 + 1, month, month % 12 + 1})


def _rating(row: dict[str, str], pid: str) -> float:
    found = [float(m) for m in _HOTEL_RATING_RE.findall(row.get("Hotel Details") or "")]
    if found:
        return max(3.0, min(5.0, round(sum(found) / len(found), 1)))
    return round(3.8 + (_hash(f"rating|{pid}") % 9) / 10, 1)  # 3.8-4.6


def map_row(row: dict[str, str]) -> Optional[dict[str, Any]]:
    """One CSV row -> one Trip-shaped dict, or None when the row lacks the three
    fields nothing can stand in for: a title, a parsable itinerary, a price."""
    title = (row.get("Package Name") or "").strip()
    nights = [int(n) for n in _NIGHTS_RE.findall(row.get("Itinerary") or "")]
    try:
        price_inr = float((row.get("Per Person Price") or "").replace(",", ""))
    except ValueError:
        price_inr = 0.0
    if not title or not nights or price_inr <= 0:
        return None

    pid = _package_id(row)
    places = _dedupe_places(row.get("Places Covered") or row.get("Destination") or "")
    if not places:
        return None
    primary = places[0]
    country, lat, lng = _DEST.get(primary, ("India", 0.0, 0.0))

    sightseeing = [s.strip() for s in (row.get("Sightseeing Places Covered") or "").split("|") if s.strip()]
    haystack = " ".join([title, " ".join(places), " ".join(sightseeing)])
    themes = _matches(_THEME_KEYWORDS, haystack)[:3]
    price_gbp = max(45.0, round(price_inr * INR_TO_GBP / 5) * 5)

    package_type = (row.get("Package Type") or "").strip() or "Standard"
    start_city = (row.get("Start City") or "").strip()
    airline = (row.get("Airline") or "").strip()
    stops = (row.get("Flight Stops") or "").strip()
    duration = sum(nights) + 1
    route = " – ".join(places)

    summary_bits = [f"{duration}-day {package_type.lower()} package covering {route}"]
    if start_city:
        summary_bits.append(f"from {start_city}")
    if sightseeing:
        summary_bits.append(f"including {', '.join(sightseeing[:3])}")
    summary = ", ".join(summary_bits) + "."

    description_lines = [f"Itinerary: {row.get('Itinerary', '').strip()}."]
    if sightseeing:
        description_lines.append(f"Sightseeing: {' | '.join(sightseeing)}.")
    hotels = [h.split(":")[0].strip() for h in (row.get("Hotel Details") or "").split("|") if h.split(":")[0].strip()]
    if hotels:
        description_lines.append(f"Stays: {', '.join(dict.fromkeys(hotels))}.")
    if airline:
        description_lines.append(f"Flights with {airline}.")
    if (row.get("Meals") or "").strip():
        description_lines.append(f"Meals: {row['Meals'].strip()}.")
    description_lines.append(f"Travel style: {package_type}.")

    if primary in _COLD:
        climate = "cold"
    elif country in _WARM_COUNTRIES or _WARM_HINTS.search(haystack):
        climate = "warm"
    else:
        climate = "mild"

    theme_key = themes[0] if themes and themes[0] in _IMAGES else ""
    heroes = _IMAGES[theme_key]
    slug = f"mmt-{pid}-{_slug(title, limit=70)}"
    dest_slug = _slug(primary, limit=120)

    return {
        "id": slug,  # the DB id is seed_uuid('trip', slug); this feeds the pydantic model only
        "slug": slug,
        "title": title,
        "summary": summary,
        "description": " ".join(description_lines),
        "destination": {
            "id": str(seed_uuid("destination", dest_slug)),
            "slug": dest_slug,
            "name": primary,
            "country": country,
            "region": "",
            "lat": lat,
            "lng": lng,
            "imageUrl": heroes[_hash(f"dest|{dest_slug}") % len(heroes)],
        },
        "themes": themes,
        "activities": _matches(_ACTIVITY_KEYWORDS, haystack)[:3],
        "audience": _matches(_AUDIENCE_KEYWORDS, haystack)[:2],
        "durationDays": min(30, duration),
        "priceFrom": price_gbp,
        "currency": "GBP",
        "rating": _rating(row, pid),
        "reviewCount": 24 + _hash(f"reviews|{pid}") % 456,
        "climate": climate,
        "months": _months_around(row.get("Travel Date") or ""),
        "directFlights": bool(airline) and not re.search(r"[1-9]", stops),
        "groupSizeMax": (6, 8, 12, 16, 20)[_hash(f"group|{pid}") % 5],
        "available": True,
        "imageUrl": heroes[_hash(f"trip|{pid}") % len(heroes)],
        "gallery": [],
        "supplier": "MakeMyTrip",
        "sources": [SOURCE_KEY],
    }


def select_packages(path: Path, target: int) -> list[dict[str, Any]]:
    """Read the crawl, collapse duplicates, and pick `target` packages spread
    round-robin across destinations — 1000 straight off the top would be 60%
    Munnar and Shimla, which is a narrow test of 'wide areas'."""
    by_destination: dict[str, list[dict[str, Any]]] = {}
    seen: set[str] = set()
    read = 0
    with path.open(encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            read += 1
            pid = _package_id(row)
            if not pid or pid in seen:
                continue
            mapped = map_row(row)
            if mapped is None:
                continue
            seen.add(pid)
            by_destination.setdefault(mapped["destination"]["name"], []).append(mapped)

    for packages in by_destination.values():
        packages.sort(key=lambda p: p["slug"])
    order = sorted(by_destination, key=lambda name: (-len(by_destination[name]), name))

    picked: list[dict[str, Any]] = []
    round_index = 0
    while len(picked) < target:
        took = False
        for name in order:
            packages = by_destination[name]
            if round_index < len(packages):
                picked.append(packages[round_index])
                took = True
                if len(picked) >= target:
                    break
        if not took:  # every destination exhausted before the target
            break
        round_index += 1

    log.info("read %d rows -> %d distinct usable packages -> selected %d across %d destinations",
             read, len(seen), len(picked), len({p["destination"]["slug"] for p in picked}))
    return picked


# --- Row building (reusing app.seed's builders and upsert) --------------------

def build_tables(mapped: list[dict[str, Any]]) -> list[_Table]:
    trips = [Trip.model_validate(record) for record in mapped]

    destinations: dict[str, dict[str, Any]] = {}
    for trip in trips:
        d = trip.destination
        destinations.setdefault(d.slug, {
            "id": seed_uuid("destination", d.slug),
            "slug": d.slug,
            "name": d.name,
            "country": d.country,
            "region": d.region,
            "lat": _num(d.lat, 6),
            "lng": _num(d.lng, 6),
            "image_url": d.imageUrl,
        })

    supplier = {
        "id": seed_uuid("supplier", SOURCE_KEY),
        "key": SOURCE_KEY,
        "name": "MakeMyTrip (PromptCloud crawl)",
        "kind": "supplier",
        "status": "healthy",
        "last_sync_at": None,
        "record_count": len(trips),
        "contact_email": f"feeds+{SOURCE_KEY}@traveliq.local",
    }

    return [
        _Table("destinations", models.Destination, list(destinations.values()), ["slug"]),
        _Table("suppliers", models.Supplier, [supplier], ["key"]),
        _Table("trips", models.Trip, _trip_rows(trips, {SOURCE_KEY}), ["slug"]),
        _Table("trip_media", models.TripMedia, _media_rows(trips), ["trip_id", "url"]),
        _Table("trip_departures", models.TripDeparture, _departure_rows(trips), ["trip_id", "departure_date"]),
    ]


async def _reset_source() -> None:
    """Remove every trip this loader owns (matched by supplier), children first.
    Destinations stay — they are shared and harmless."""
    supplier_id = seed_uuid("supplier", SOURCE_KEY)
    async with db.session() as s:
        owned = select(models.Trip.id).where(models.Trip.supplier_id == supplier_id)
        await s.execute(delete(models.TripDeparture).where(models.TripDeparture.trip_id.in_(owned)))
        await s.execute(delete(models.TripMedia).where(models.TripMedia.trip_id.in_(owned)))
        result = await s.execute(delete(models.Trip).where(models.Trip.supplier_id == supplier_id))
        log.info("--reset-source: removed %d previously loaded trips", result.rowcount or 0)


def _report(mapped: list[dict[str, Any]], tables: list[_Table]) -> None:
    themes = Counter(t for p in mapped for t in p["themes"])
    unmapped = sum(1 for p in mapped if p["destination"]["lat"] == 0 and p["destination"]["lng"] == 0)
    prices = sorted(p["priceFrom"] for p in mapped)
    months = Counter(m for p in mapped for m in p["months"])
    log.info("themes: %s", dict(themes.most_common()) or "none derived")
    log.info("price GBP: min £%.0f  median £%.0f  max £%.0f",
             prices[0], prices[len(prices) // 2], prices[-1])
    log.info("months covered: %s", sorted(months) or "none")
    if unmapped:
        log.warning("%d packages have a destination with no coordinates (not in _DEST)", unmapped)
    for table in tables:
        log.info("  %-16s %6d rows", table.name, len(table.rows))


async def _run(csv_path: Path, rows: int, dry_run: bool, reset_source: bool) -> int:
    if not csv_path.exists():
        log.error("CSV not found: %s", csv_path)
        return 2

    mapped = select_packages(csv_path, rows)
    if not mapped:
        log.error("nothing usable in the CSV — is it the PromptCloud MakeMyTrip export?")
        return 2
    tables = build_tables(mapped)
    _report(mapped, tables)

    if dry_run:
        log.info("--dry-run: nothing written")
        return 0

    if not settings.db_configured():
        log.error("DATABASE_URL is not set. This loader writes the catalogue tables directly "
                  "(POST /ingest cannot publish new trips), so it needs Postgres. "
                  "The in-memory catalogue cannot be loaded from outside the API process.")
        return 2
    try:
        if not await db.ping():
            log.error("cannot reach postgres at %s — is the container up?",
                      settings.database_url.rsplit("@", 1)[-1])
            return 3
        await db.create_all()
        if reset_source:
            await _reset_source()
        async with db.session() as s:
            for table in tables:
                # asyncpg caps a statement at 32,767 bind parameters; 6,000
                # departure rows in one multi-VALUES insert is past it. app.seed
                # never gets near the limit, so the chunking lives here.
                rows = table.rows
                step = max(1, 30_000 // max(1, len(rows[0]) if rows else 1))
                for start in range(0, len(rows), step):
                    await _upsert(s, _Table(table.name, table.model, rows[start : start + step], table.conflict))
    finally:
        await db.dispose()

    log.info("wrote %d rows across %d tables", sum(len(t.rows) for t in tables), len(tables))
    log.info("NOW RESTART THE API: the embedding index builds at startup (main.py), so the "
             "new trips retrieve lexically until it re-embeds. ~%d trips on a free-tier "
             "embedding key can take a few minutes.", len(mapped))
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.load_makemytrip",
        description="Load the PromptCloud MakeMyTrip crawl into the TravelIQ catalogue.",
    )
    parser.add_argument("--csv", type=Path,
                        default=Path(__file__).resolve().parents[2] / DEFAULT_CSV,
                        help=f"path to the crawl CSV (default: repo root / {DEFAULT_CSV})")
    parser.add_argument("--rows", type=int, default=1000,
                        help="distinct packages to load (default 1000; ~2,250 exist)")
    parser.add_argument("--dry-run", action="store_true",
                        help="map and report without touching the database")
    parser.add_argument("--reset-source", action="store_true",
                        help="delete previously loaded MakeMyTrip trips first (destinations stay)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="[load_makemytrip] %(message)s")
    return asyncio.run(_run(args.csv, max(1, args.rows), args.dry_run, args.reset_source))


if __name__ == "__main__":
    raise SystemExit(main())
