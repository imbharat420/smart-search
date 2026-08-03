"""KG-RAG over the relational catalogue — an adjacency index, not a graph database.

The catalogue already *is* a graph: trips sit in destinations, destinations share
a region, POIs cluster around destinations, trips share themes and a supplier.
Nothing here discovers new relationships; it just makes the ones the tables
already encode walkable in one place. A graph database would be a second storage
engine to run, back up and reason about for a few thousand nodes that a dict of
adjacency lists answers in microseconds, so the graph lives in process and is
rebuilt from `repository.py` rather than stored.

What this buys over pure vector search: a request like "near Positano but
quieter" has a relational half that an embedding averages away — the blended
vector lands somewhere generically central and the right trips were never in the
candidate set at all. Traversal narrows the candidate SET (siblings of Campania,
POIs around this destination, trips sharing these themes); `rag.py`'s embeddings
and lexical scoring then rank WITHIN it. Neither replaces the other, which is why
this module scores nothing and returns bare ids.

When to revisit the decision: past roughly 500k trip/POI nodes *and* traversal
routinely deeper than three hops, a rebuilt in-memory adjacency list stops being
the cheapest option and a real graph store starts paying for itself. This
catalogue is nowhere near either threshold, so that is a documented future
decision rather than a current one.

`build()` is idempotent — same trip ids, immediate return — because the caller is
startup *and* an invalidation event, and neither should pay for a rebuild it does
not need.
"""
from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from typing import Optional, Sequence

from .schemas import Destination, Place, Trip

log = logging.getLogger("traveliq.graph")

# --- Edge kinds ------------------------------------------------------------
# Strings rather than an enum: they cross the wire in the assistant's
# graph_traverse tool call, and a model emitting "SHARES_REGION" should not need
# to know a Python type exists.
EDGE_LOCATED_IN = "LOCATED_IN"      # trip -> destination
EDGE_HOSTS = "HOSTS"                # destination -> trip
EDGE_NEAR = "NEAR"                  # poi <-> destination
EDGE_SHARES_REGION = "SHARES_REGION"  # destination <-> destination
EDGE_TAGGED = "TAGGED"              # trip -> theme
EDGE_TAGGED_BY = "TAGGED_BY"        # theme -> trip
EDGE_SOURCED_FROM = "SOURCED_FROM"  # trip -> supplier

# --- Tunables --------------------------------------------------------------
# A POI is "near" a destination if it is within a comfortable day trip of its
# centre. Sixty miles is about ninety minutes by road: past that, telling a
# traveller a restaurant is near their destination misleads them, and the POI is
# almost certainly closer to a different destination anyway. It is also generous
# enough to catch the airport-adjacent and coastal-strip POIs whose coordinates
# sit well outside the city they belong to.
NEAR_RADIUS_MILES = 60.0

# Sibling edges are the one O(n^2) shape in here: every destination in a region
# linked to every other. Bucketing by region first makes it O(sum of bucket^2)
# rather than O(all destinations^2), and this cap bounds each bucket so one
# crowded region — a feed that files two hundred Tuscan villages under "Tuscany"
# — cannot turn the index into a million edges nobody reads. Twenty-four is more
# siblings than a single "somewhere near X but different" reply can ever use.
MAX_REGION_DEGREE = 24

# BFS fan-out multiplies per hop, so an unbounded `hops` from a caller (or from a
# model choosing the argument itself) is a way to walk the whole catalogue by
# accident. Four is one hop past anything the assistant asks for today, and
# needing more is precisely the signal that the capacity threshold in the module
# docstring has arrived.
TRAVERSE_MAX_HOPS = 4

_EARTH_RADIUS_MILES = 3958.8

_TRIP_PREFIX = "trip:"
_DEST_PREFIX = "dest:"
_THEME_PREFIX = "theme:"
_POI_PREFIX = "poi:"
_SUPPLIER_PREFIX = "supplier:"


# --- Nodes and edges -------------------------------------------------------

@dataclass(frozen=True)
class Edge:
    """One directed relationship. `label` is carried so a traversal can be
    explained in a reply — "Praiano, also in Campania" reads like an answer,
    "dest:praiano" reads like a stack trace."""

    kind: str
    target: str
    label: str = ""


# Namespaced ids, because a trip id and a destination id must never collide in
# one dict — seed ids ('trip-01', 'dest-01') happen not to, but uuid primary keys
# from Postgres carry no type at all. Helpers rather than f-strings at every call
# site, so the prefixes are declared once and the reverse mapping below stays
# honest.

def trip_node(trip_id: str) -> str:
    return f"{_TRIP_PREFIX}{trip_id}"


def dest_node(slug: str) -> str:
    return f"{_DEST_PREFIX}{slug}"


def theme_node(name: str) -> str:
    return f"{_THEME_PREFIX}{name}"


def poi_node(poi_id: str) -> str:
    return f"{_POI_PREFIX}{poi_id}"


def supplier_node(key: str) -> str:
    return f"{_SUPPLIER_PREFIX}{key}"


def _bare(node: str, prefix: str) -> Optional[str]:
    """The id back out of a namespaced node, or None if it is not that kind —
    callers that ask for destination slugs should get nothing rather than a
    mangled trip id."""
    return node[len(prefix) :] if node.startswith(prefix) else None


def _distance_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle miles. `repository.py` has the same eight lines as
    `_distance_miles`, but it is private to that module and importing another
    module's underscore-prefixed helper is a worse dependency than repeating the
    arithmetic — this module would then break when the repository refactors
    something it never advertised."""
    phi1, phi2 = radians(lat1), radians(lat2)
    a = (
        sin((phi2 - phi1) / 2) ** 2
        + cos(phi1) * cos(phi2) * sin(radians(lng2 - lng1) / 2) ** 2
    )
    return round(2 * _EARTH_RADIUS_MILES * asin(sqrt(a)), 1)


class CatalogueGraph:
    """Adjacency lists over the catalogue, built once and dropped on
    invalidation.

    Everything is a plain dict of lists, and every list keeps insertion order, so
    a traversal from the same node with the same arguments returns the same ids
    in the same order on every request. That matters more than it sounds: a set
    anywhere in here would make the assistant's answer to one question change
    between two identical asks.
    """

    def __init__(self) -> None:
        self.built = False
        self._adj: dict[str, list[Edge]] = {}
        # Country is a filter dimension, not something worth traversing through:
        # a country node would put every trip in Italy two hops from every other
        # one and drown the sibling edges that carry the actual meaning. So the
        # country lookup is a plain index beside the adjacency instead.
        self._trips_by_country: dict[str, list[str]] = {}
        # Rank tie-breaks resolve on catalogue order rather than on whatever
        # order a dict happened to fill in.
        self._trip_order: dict[str, int] = {}
        self._built_ids: list[str] = []
        self._counts: dict[str, int] = {}

    # -- Build -------------------------------------------------------------

    def _link(self, source: str, kind: str, target: str, label: str = "") -> None:
        self._adj.setdefault(source, []).append(Edge(kind=kind, target=target, label=label))

    def build(self, trips: list[Trip], destinations: list[Destination], places: list[Place]) -> None:
        """Rebuild the whole index from the catalogue as it stands.

        The trip ids are the version marker, exactly as in `rag.py`'s
        `TripIndex.build`: an unchanged catalogue means an unchanged graph, so a
        second call costs a list comparison. It is a full rebuild rather than a
        patch because the whole thing is a few thousand appends — cheaper to
        redo than to work out which edges an edited trip invalidated.
        """
        ids = [t.id for t in trips]
        if not trips or (self.built and ids == self._built_ids):
            return

        # Marked unbuilt for the duration: if anything below raises (a malformed
        # trip from an ingest, say) the half-filled adjacency must not be left
        # looking valid — `built` False plus empty `_built_ids` means the next
        # call rebuilds instead of returning early on a broken index.
        self.built = False
        self._built_ids = []
        self._adj = {}
        self._trips_by_country = {}
        self._trip_order = {}

        # Destinations from the catalogue query, plus any nested on a trip that
        # the query did not return — a trip ingested since the last destinations
        # read would otherwise sit on an edge pointing at a node that does not
        # exist.
        known: dict[str, Destination] = {}
        for dest in [*destinations, *(t.destination for t in trips)]:
            known.setdefault(dest.slug, dest)

        suppliers: set[str] = set()
        for position, trip in enumerate(trips):
            node = trip_node(trip.id)
            self._trip_order[trip.id] = position
            dest = trip.destination
            self._link(node, EDGE_LOCATED_IN, dest_node(dest.slug), dest.name)
            self._link(dest_node(dest.slug), EDGE_HOSTS, node, trip.title)
            country = dest.country.strip()
            if country:
                self._trips_by_country.setdefault(country.lower(), []).append(trip.id)

            for theme in trip.themes:
                label = theme.strip()
                if not label:
                    continue
                self._link(node, EDGE_TAGGED, theme_node(label), label)
                self._link(theme_node(label), EDGE_TAGGED_BY, node, trip.title)

            supplier = trip.supplier.strip()
            if supplier:
                # One direction only. "What else does this supplier sell" has no
                # caller yet; the reverse edge goes in when something asks.
                self._link(node, EDGE_SOURCED_FROM, supplier_node(supplier), supplier)
                suppliers.add(supplier)

        self._link_siblings(list(known.values()))
        pois = self._link_pois(places, list(known.values()))

        # Nodes are counted over sources *and* targets, not just adjacency keys:
        # a supplier is a pure sink (SOURCED_FROM is one-way), so keys alone
        # report a node total that excludes the very suppliers counted below.
        node_ids = set(self._adj)
        node_ids.update(edge.target for edges in self._adj.values() for edge in edges)

        self._built_ids = ids
        self._counts = {
            "nodes": len(node_ids),
            "edges": sum(len(edges) for edges in self._adj.values()),
            "trips": len(trips),
            "destinations": len(known),
            # Distinct themes rather than tag count: "we carry 12 themes" is the
            # useful health number, not how many times they were applied.
            "themes": sum(1 for node in node_ids if node.startswith(_THEME_PREFIX)),
            "pois": pois,
            "suppliers": len(suppliers),
        }
        self.built = True
        log.info(
            "catalogue graph: %d nodes, %d edges over %d trips, %d destinations, %d POIs",
            self._counts["nodes"],
            self._counts["edges"],
            len(trips),
            len(known),
            pois,
        )

    def _link_siblings(self, destinations: list[Destination]) -> None:
        """SHARES_REGION, both ways, bucketed by region and capped per node.

        The seed catalogue has one destination per `region` value — 'Campania',
        'Tuscany', 'Arctic Norway' are each held by exactly one place — so a
        strict region index would be empty and the "somewhere near X but
        different" hop this exists for would return nothing at all. Where a
        region has no siblings the destination is therefore linked to its
        country's other destinations instead, under the same edge kind with a
        label that says which relationship was used. That is deliberately a
        looser hop than the name promises, and the label is how a reply stays
        honest about it: 'also in Italy' rather than 'also in Campania'.
        """
        by_region: dict[str, list[Destination]] = {}
        by_country: dict[str, list[Destination]] = {}
        for dest in destinations:
            region = dest.region.strip().lower()
            if region:
                by_region.setdefault(region, []).append(dest)
            country = dest.country.strip().lower()
            if country:
                by_country.setdefault(country, []).append(dest)

        for dest in destinations:
            peers = by_region.get(dest.region.strip().lower(), [])
            same_region = [p for p in peers if p.slug != dest.slug]
            if same_region:
                for peer in same_region[:MAX_REGION_DEGREE]:
                    self._link(
                        dest_node(dest.slug),
                        EDGE_SHARES_REGION,
                        dest_node(peer.slug),
                        f"{peer.name}, also in {peer.region}",
                    )
                continue
            country_peers = by_country.get(dest.country.strip().lower(), [])
            for peer in [p for p in country_peers if p.slug != dest.slug][:MAX_REGION_DEGREE]:
                self._link(
                    dest_node(dest.slug),
                    EDGE_SHARES_REGION,
                    dest_node(peer.slug),
                    f"{peer.name}, also in {peer.country}",
                )

    def _link_pois(self, places: list[Place], destinations: list[Destination]) -> int:
        """NEAR, from each POI to its single nearest destination.

        `Place` carries no destinationId on the wire — the column exists in
        Postgres but the schema drops it on the way out — so proximity is the
        only link available, and the nearest centre within NEAR_RADIUS_MILES is
        it. Nearest rather than all-within-radius, because a POI belongs to one
        place in a reply; two destinations both claiming the same museum reads as
        a bug.

        Stored both directions under the one kind: "what is around this
        destination" is the question the assistant actually asks (and Scenario D
        in the architecture doc traverses NEAR from a destination), and the
        constant list has no separate reverse kind to put it under.

        The scan is every POI against every destination. A few thousand against a
        few hundred is microseconds; a spatial grid or PostGIS is what would fix
        it if POIs ever reached the millions, and at that point the whole
        module's capacity threshold has been passed anyway.
        """
        linked = 0
        for place in places:
            nearest: Optional[Destination] = None
            best = NEAR_RADIUS_MILES
            for dest in destinations:
                miles = _distance_miles(place.lat, place.lng, dest.lat, dest.lng)
                if miles > NEAR_RADIUS_MILES:
                    continue
                # A tie goes to the first destination in catalogue order, so one
                # POI equidistant from two centres does not change hands between
                # two builds of the same data.
                if nearest is None or miles < best:
                    nearest, best = dest, miles
            if nearest is None:
                # An orphan POI is normal, not an error: the seed carries POIs for
                # cities the trip catalogue does not sell yet. It stays out of the
                # graph rather than being attached to something 400 miles away.
                log.debug(
                    "POI %s (%s) has no destination within %.0f miles; left unlinked",
                    place.id,
                    place.name,
                    NEAR_RADIUS_MILES,
                )
                continue
            self._link(
                poi_node(place.id),
                EDGE_NEAR,
                dest_node(nearest.slug),
                f"{best:g} miles from {nearest.name}",
            )
            self._link(
                dest_node(nearest.slug),
                EDGE_NEAR,
                poi_node(place.id),
                f"{place.name} ({place.type}), {best:g} miles out",
            )
            linked += 1
        return linked

    def drop(self) -> None:
        """Forget everything; the next `build()` rebuilds from scratch.

        This is the invalidation half of the contract — `events.py` calls it when
        a trip merges or an admin edits the catalogue. Dropping rather than
        patching means a stale graph is impossible by construction, and the cost
        is one rebuild on the next request.
        """
        self._adj = {}
        self._trips_by_country = {}
        self._trip_order = {}
        self._built_ids = []
        self._counts = {}
        self.built = False
        log.info("catalogue graph dropped; it rebuilds on the next build() call")

    @property
    def stats(self) -> dict[str, int]:
        """Counts for /health. Zeroes rather than an empty dict before a build,
        so the health payload has the same shape either way."""
        if not self._counts:
            return {
                "nodes": 0, "edges": 0, "trips": 0, "destinations": 0,
                "themes": 0, "pois": 0, "suppliers": 0,
            }
        return dict(self._counts)

    # -- Traversal ---------------------------------------------------------

    def neighbours(self, node: str, kinds: Optional[Sequence[str]] = None) -> list[Edge]:
        """Edges out of `node`, in build order. An unknown node is an empty list
        rather than a KeyError: callers pass ids that came from a parse or a
        model, and a typo should narrow nothing, not fail a search."""
        edges = self._adj.get(node, ())
        if kinds is None:
            return list(edges)
        wanted = set(kinds)
        return [edge for edge in edges if edge.kind in wanted]

    def traverse(
        self,
        start: str,
        edge_kinds: Sequence[str],
        hops: int = 2,
        limit: Optional[int] = None,
    ) -> list[str]:
        """BFS. Returns node ids in discovery order, excluding `start`.

        Deterministic all the way down — the queue is a deque, every adjacency
        list keeps build order, and the `seen` set only ever answers membership
        questions, never iterated — so the same question gives the same answer
        twice. `hops` is clamped to TRAVERSE_MAX_HOPS.
        """
        # `limit` is checked before the walk as well as during it: it arrives as
        # "how many candidates do I still have room for", which is legitimately
        # zero, and appending first then testing would hand back one node more
        # than the caller asked for.
        if hops <= 0 or not edge_kinds or (limit is not None and limit <= 0):
            return []
        depth_cap = min(hops, TRAVERSE_MAX_HOPS)
        if hops > TRAVERSE_MAX_HOPS:
            log.debug("traverse asked for %d hops; capped at %d", hops, TRAVERSE_MAX_HOPS)

        kinds = tuple(edge_kinds)
        seen = {start}
        found: list[str] = []
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        while queue:
            node, depth = queue.popleft()
            if depth >= depth_cap:
                continue
            for edge in self.neighbours(node, kinds):
                if edge.target in seen:
                    continue
                seen.add(edge.target)
                found.append(edge.target)
                if limit is not None and len(found) >= limit:
                    return found
                queue.append((edge.target, depth + 1))
        return found

    # -- The questions callers actually ask --------------------------------

    def trips_in_countries(self, countries: Sequence[str]) -> list[str]:
        """Trip ids whose destination country is in this set.

        This backs the region-bucket chip. A bucket ('Europe', 'Asia') is a SET of
        countries, and `ParsedQuery.destination` is a single string, so a chip
        cannot go through the parse without losing most of itself — which is why
        `chat.py` calls this instead of pushing 'Europe' into a field built for
        'Italy'. Order is bucket order then catalogue order, so the first trips
        offered for 'Europe' are stable rather than whichever country hashed
        first.
        """
        out: list[str] = []
        seen: set[str] = set()
        for country in countries:
            for trip_id in self._trips_by_country.get(country.strip().lower(), ()):
                if trip_id not in seen:
                    seen.add(trip_id)
                    out.append(trip_id)
        return out

    def sibling_destinations(self, slug: str) -> list[str]:
        """Destination slugs sharing the sub-national region — the 'somewhere
        near X but different' hop. Falls back to the same country where the
        region has no siblings; see `_link_siblings` for why that is honest
        rather than sloppy."""
        return [
            bare
            for bare in (
                _bare(edge.target, _DEST_PREFIX)
                for edge in self.neighbours(dest_node(slug), (EDGE_SHARES_REGION,))
            )
            if bare
        ]

    def trips_sharing_themes(self, trip_id: str, limit: int = 12) -> list[str]:
        """Other trip ids tagged with this trip's themes, most themes in common
        first. This is the 'more like this one' hop — deliberately unscored, so
        `rag.py` decides which of the siblings is actually the better answer."""
        start = trip_node(trip_id)
        shared: dict[str, int] = {}
        for theme_edge in self.neighbours(start, (EDGE_TAGGED,)):
            for trip_edge in self.neighbours(theme_edge.target, (EDGE_TAGGED_BY,)):
                if trip_edge.target == start:
                    continue
                bare = _bare(trip_edge.target, _TRIP_PREFIX)
                if bare:
                    shared[bare] = shared.get(bare, 0) + 1
        ranked = sorted(
            shared,
            key=lambda other: (-shared[other], self._trip_order.get(other, len(self._trip_order))),
        )
        return ranked[: max(0, limit)]


# One index per process, mirroring `rag.py`'s `index`: the graph is a cache of
# the catalogue, and a second copy of it would only be a second thing to
# invalidate.
graph = CatalogueGraph()
