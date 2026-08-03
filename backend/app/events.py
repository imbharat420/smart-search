"""In-process publish/subscribe, so a stale cache is a signal rather than a restart.

Three caches in this app can drift from the catalogue behind them: rag.py's
`TripIndex` (embeddings built once from the trips it was handed), graph.py's
adjacency cache, and nlq.py's parse cache (whose heuristic vocabulary is fed by
the synonyms table an admin can edit). Today the only invalidation any of them
has is a process restart.

A broker (Redis pub/sub, a queue) would be a new external system to run, back up
and reason about for a signal that never leaves this process — the publisher and
every subscriber live in the same interpreter. So this is a dict of callbacks
instead, which is the whole implementation.

Deliberately synchronous: subscribers are cache drops — clearing a dict, marking
an index dirty — not IO. An async handler would mean the bus had to know about
the running event loop (and what to do when published from a thread with no
loop), which is complexity nothing here needs yet. If a subscriber ever does
need to await, it should schedule that itself rather than make the bus async.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Callable

log = logging.getLogger("traveliq.events")

Handler = Callable[[dict], None]

# Names live here rather than as literals at each call site: a publisher and a
# subscriber that disagree by one character fail silently and forever, and that
# is exactly the bug an invalidation bus must not have.
TRIP_CHANGED = "trip.changed"                   # merged or admin-edited -> re-embed it, drop its graph edges
PROMOTION_CHANGED = "promotion.changed"         # nothing caches promotions today; reserved so admin.py can fire it
SYNONYM_CHANGED = "synonym.changed"             # synonyms feed nlq.py's vocabulary -> clear its parse cache
CATALOGUE_RELOADED = "catalogue.reloaded"       # wholesale change -> rebuild every derived cache
SESSION_SLOT_CHANGED = "session.slot_changed"   # a plan slot moved -> drop that session's candidate cache


class EventBus:
    """Fan-out to handlers registered for one event name. No wildcards, no
    ordering guarantees beyond registration order, no history — a subscriber
    that registers late has missed what already happened."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, event: str, handler: Handler) -> None:
        self._handlers[event].append(handler)

    def publish(self, event: str, payload: dict | None = None) -> None:
        """Notify every subscriber. Never raises: a publish sits inside a request
        that has already succeeded (an ingest merge, an admin write), so a
        handler that blows up must not turn a completed write into a 500."""
        body = payload or {}
        # Snapshot the list, and `.get` rather than index the defaultdict so
        # publishing an event nobody listens for does not grow the dict. The
        # copy matters: a handler that subscribes (or clears) while the fan-out
        # is in flight would otherwise mutate the very list being iterated, and
        # appending to a live list iterator visits the new entry — a handler
        # that re-subscribes itself would loop for as long as it keeps doing so.
        # Registrations made during a publish take effect from the next one.
        for handler in tuple(self._handlers.get(event, ())):
            try:
                handler(body)
            except Exception as exc:  # noqa: BLE001 — invalidation is best-effort housekeeping
                # One bad subscriber must not stop the others: the caches are
                # independent, so a failed graph drop is no reason to leave
                # nlq.py's parse cache stale as well. Worst case is the old
                # behaviour — a cache that stays warm until the next restart.
                log.warning(
                    "subscriber %s failed handling %s (%s); other subscribers still ran",
                    getattr(handler, "__qualname__", handler),
                    event,
                    exc,
                )

    def clear(self) -> None:
        """Drop every registration. For tests — module-level subscriptions would
        otherwise leak from one test into the next."""
        self._handlers.clear()


# One bus per process, imported rather than constructed, the same way rag.py
# exposes `index`.
bus = EventBus()
