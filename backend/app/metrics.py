"""In-process pipeline metrics — the monitoring half of the observability pair.

tracing.py answers "what happened inside THIS turn" (a run tree in LangSmith);
this module answers "how is the pipeline doing overall" without any external
service at all: per-stage latency distributions and a handful of named counters,
held in memory and read back through /admin/observability (JSON) and /metrics
(Prometheus text exposition, hand-rendered — no prometheus_client, same
zero-new-dependency rule as everything else).

Stage names are the trace span names, deliberately: the p95 you see in Grafana
and the slow run you open in LangSmith describe the same stage by the same name.

Everything here is approximate on purpose. Percentiles come from a bounded ring
of recent observations rather than a streaming sketch, counts reset on restart,
and there is no locking — the API runs one event loop and dict/deque operations
are atomic under it. A POC that needed durable metrics would point Prometheus at
/metrics and let it do the keeping.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Optional

_RING = 256  # recent latencies kept per stage for the percentile estimates


class _Stage:
    __slots__ = ("count", "errors", "total_ms", "max_ms", "recent")

    def __init__(self) -> None:
        self.count = 0
        self.errors = 0
        self.total_ms = 0.0
        self.max_ms = 0.0
        self.recent: deque[float] = deque(maxlen=_RING)


def _percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile over a sorted copy — plenty for a ring of 256."""
    ordered = sorted(values)
    rank = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[rank]


class Metrics:
    def __init__(self) -> None:
        self._stages: dict[str, _Stage] = {}
        self._counters: dict[str, int] = {}

    # --- Recording ---------------------------------------------------------

    def observe(self, stage: str, ms: float, error: bool = False) -> None:
        entry = self._stages.setdefault(stage, _Stage())
        entry.count += 1
        entry.total_ms += ms
        entry.max_ms = max(entry.max_ms, ms)
        entry.recent.append(ms)
        if error:
            entry.errors += 1

    def increment(self, counter: str, by: int = 1) -> None:
        self._counters[counter] = self._counters.get(counter, 0) + by

    def reset(self) -> None:
        """Test hook — module-level singletons and asserting counts do not mix."""
        self._stages.clear()
        self._counters.clear()

    # --- Reading -----------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        stages: dict[str, dict[str, float | int]] = {}
        for name, s in sorted(self._stages.items()):
            recent = list(s.recent)
            stages[name] = {
                "count": s.count,
                "errors": s.errors,
                "avgMs": round(s.total_ms / s.count, 1) if s.count else 0.0,
                "p50Ms": round(_percentile(recent, 0.50), 1) if recent else 0.0,
                "p95Ms": round(_percentile(recent, 0.95), 1) if recent else 0.0,
                "maxMs": round(s.max_ms, 1),
            }
        return {"counters": dict(sorted(self._counters.items())), "stages": stages}

    def prometheus(self) -> str:
        """The same numbers in Prometheus text exposition format, so a scraper
        (Prometheus, Grafana Alloy, Datadog agent) needs no adapter."""
        lines = [
            "# HELP traveliq_counter_total Named pipeline counters.",
            "# TYPE traveliq_counter_total counter",
        ]
        for name, value in sorted(self._counters.items()):
            lines.append(f'traveliq_counter_total{{name="{name}"}} {value}')
        lines += [
            "# HELP traveliq_stage_count Completed observations per pipeline stage.",
            "# TYPE traveliq_stage_count counter",
        ]
        for name, s in sorted(self._stages.items()):
            lines.append(f'traveliq_stage_count{{stage="{name}"}} {s.count}')
        lines += [
            "# HELP traveliq_stage_errors Failed observations per pipeline stage.",
            "# TYPE traveliq_stage_errors counter",
        ]
        for name, s in sorted(self._stages.items()):
            lines.append(f'traveliq_stage_errors{{stage="{name}"}} {s.errors}')
        lines += [
            "# HELP traveliq_stage_latency_ms Stage latency statistics over recent turns.",
            "# TYPE traveliq_stage_latency_ms gauge",
        ]
        for name, stats in self.snapshot()["stages"].items():
            for stat in ("avgMs", "p50Ms", "p95Ms", "maxMs"):
                label = stat[:-2].lower()  # avgMs -> avg
                lines.append(
                    f'traveliq_stage_latency_ms{{stage="{name}",stat="{label}"}} {stats[stat]}'
                )
        return "\n".join(lines) + "\n"


metrics = Metrics()
