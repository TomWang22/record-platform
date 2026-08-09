#!/usr/bin/env python3
"""Causal clock-offset interval analysis for AM residual sub-hops (no new load).

Authoritative ownership remains outside-AM transport/queue. One-way BEFORE_AM
promotion requires hard lower bounds after intersecting per-window δ intervals.

δ = AM_clock - GW_clock
pre_true  = pre_raw  - δ >= 0  => δ <= pre_raw
post_true = post_raw + δ >= 0  => δ >= -post_raw
=> each request constrains δ ∈ [-post_raw, pre_raw]
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

MARKER = "rp_h3_residual_obs"


@dataclass(frozen=True)
class CorrelatedHop:
    observation_id: str
    timestamp_s: float
    pre_am_raw_ms: float
    post_am_raw_ms: float
    upstream_duration_ms: float | None
    am_handler_ms: float | None
    transport_gap_ms: float | None


@dataclass(frozen=True)
class ClockWindow:
    bucket: int
    count: int
    delta_lower_ms: float
    delta_upper_ms: float
    feasible: bool
    width_ms: float


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).astimezone(timezone.utc)
    except ValueError:
        return None


def ms_between(a: datetime | None, b: datetime | None) -> float | None:
    if a is None or b is None:
        return None
    return (b - a).total_seconds() * 1000.0


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = quantile * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def summarize(values: list[float]) -> dict[str, Any]:
    return {
        "count": len(values),
        "min_ms": min(values) if values else None,
        "p50_ms": percentile(values, 0.50),
        "p95_ms": percentile(values, 0.95),
        "p99_ms": percentile(values, 0.99),
        "max_ms": max(values) if values else None,
    }


def clock_offset_interval(
    pre_am_raw_ms: float,
    post_am_raw_ms: float,
) -> tuple[float, float]:
    """Return the clock-offset interval allowed by transport causality."""
    return -post_am_raw_ms, pre_am_raw_ms


def build_clock_windows(
    records: Iterable[CorrelatedHop],
    *,
    window_s: int = 1,
) -> list[ClockWindow]:
    """Intersect causal clock-offset intervals in short time windows."""
    grouped: dict[int, list[CorrelatedHop]] = defaultdict(list)

    for record in records:
        bucket = int(math.floor(record.timestamp_s / window_s) * window_s)
        grouped[bucket].append(record)

    windows: list[ClockWindow] = []

    for bucket in sorted(grouped):
        rows = grouped[bucket]
        lower = max(
            clock_offset_interval(row.pre_am_raw_ms, row.post_am_raw_ms)[0]
            for row in rows
        )
        upper = min(
            clock_offset_interval(row.pre_am_raw_ms, row.post_am_raw_ms)[1]
            for row in rows
        )
        feasible = lower <= upper
        windows.append(
            ClockWindow(
                bucket=bucket,
                count=len(rows),
                delta_lower_ms=lower,
                delta_upper_ms=upper,
                feasible=feasible,
                width_ms=(upper - lower) if feasible else float("nan"),
            )
        )

    return windows


def pre_am_true_bounds(
    *,
    pre_am_raw_ms: float,
    delta_lower_ms: float,
    delta_upper_ms: float,
) -> tuple[float, float]:
    """Return clock-safe lower/upper bounds for true pre-AM transport."""
    if delta_lower_ms > delta_upper_ms:
        raise ValueError("clock-offset interval is infeasible")

    lower = max(0.0, pre_am_raw_ms - delta_upper_ms)
    upper = max(0.0, pre_am_raw_ms - delta_lower_ms)
    return lower, upper


def post_am_true_bounds(
    *,
    post_am_raw_ms: float,
    delta_lower_ms: float,
    delta_upper_ms: float,
) -> tuple[float, float]:
    """Return clock-safe lower/upper bounds for true post-AM transport."""
    if delta_lower_ms > delta_upper_ms:
        raise ValueError("clock-offset interval is infeasible")

    lower = max(0.0, post_am_raw_ms + delta_lower_ms)
    upper = max(0.0, post_am_raw_ms + delta_upper_ms)
    return lower, upper


def classify_directionality(
    *,
    slow_records: Iterable[CorrelatedHop],
    windows: Iterable[ClockWindow],
    proof_threshold_ms: float = 750.0,
    window_s: int = 1,
) -> dict[str, object]:
    """Promote BEFORE_AM only when hard clock-safe bounds support it."""
    window_by_bucket = {window.bucket: window for window in windows}

    proved_pre_am = 0
    usable = 0
    infeasible = 0
    lower_bounds: list[float] = []
    upper_bounds: list[float] = []

    for record in slow_records:
        bucket = int(math.floor(record.timestamp_s / window_s) * window_s)
        window = window_by_bucket.get(bucket)

        if window is None or not window.feasible:
            infeasible += 1
            continue

        usable += 1
        lower, upper = pre_am_true_bounds(
            pre_am_raw_ms=record.pre_am_raw_ms,
            delta_lower_ms=window.delta_lower_ms,
            delta_upper_ms=window.delta_upper_ms,
        )
        lower_bounds.append(lower)
        upper_bounds.append(upper)

        if lower >= proof_threshold_ms:
            proved_pre_am += 1

    # Hard fail-closed: any infeasible tail record blocks population-level
    # BEFORE_AM promotion. "Infeasible" means clock-model/timestamp-semantics
    # inconsistency in the causal δ intersection — not merely skew magnitude.
    promotion = usable > 0 and proved_pre_am == usable and infeasible == 0

    return {
        "classification": (
            "GATEWAY_CLIENT_OR_NETWORK_QUEUE_BEFORE_AM_PROVED"
            if promotion
            else "HIGH_CONFIDENCE_NOT_YET_CLOCK_SAFE"
        ),
        "before_am_promoted": promotion,
        "proof_threshold_ms": proof_threshold_ms,
        "usable_slow_records": usable,
        "infeasible_or_unbounded_records": infeasible,
        "infeasible_means": "CLOCK_MODEL_OR_TIMESTAMP_SEMANTICS_INCONSISTENT",
        "slow_records_meeting_hard_lower_bound": proved_pre_am,
        "pre_am_clock_safe_lower_bound_min_ms": (
            min(lower_bounds) if lower_bounds else None
        ),
        "pre_am_clock_safe_lower_bound_max_ms": (
            max(lower_bounds) if lower_bounds else None
        ),
        "pre_am_clock_safe_lower_bound_distribution": summarize(lower_bounds),
        "pre_am_clock_safe_upper_bound_distribution": summarize(upper_bounds),
    }


def may_promote_before_am(
    *,
    usable_slow_records: int,
    infeasible_or_unbounded_records: int,
    slow_records_meeting_hard_lower_bound: int,
) -> bool:
    """Fail-closed promotion gate used by classifiers and regression tests."""
    if infeasible_or_unbounded_records > 0:
        return False
    if usable_slow_records <= 0:
        return False
    return slow_records_meeting_hard_lower_bound == usable_slow_records


def last_event_time(events: list[dict[str, Any]], event_name: str) -> datetime | None:
    matches = [e for e in events if e.get("event") == event_name]
    if not matches:
        return None
    return parse_utc(matches[-1].get("at_utc"))


def last_duration(events: list[dict[str, Any]], event_name: str) -> float | None:
    matches = [
        e
        for e in events
        if e.get("event") == event_name
        and isinstance(e.get("duration_ms"), (int, float))
    ]
    if not matches:
        return None
    return float(matches[-1]["duration_ms"])


def read_events(path: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("marker") == MARKER:
                events.append(event)
    return events


def load_correlated_hops(
    gateway_log: Path,
    auction_log: Path,
) -> list[CorrelatedHop]:
    by_id: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for event in read_events(gateway_log) + read_events(auction_log):
        oid = event.get("observation_id")
        if not oid:
            continue
        by_id[str(oid)][str(event.get("service"))].append(event)

    hops: list[CorrelatedHop] = []
    for observation_id, services in by_id.items():
        gw = services.get("api-gateway", [])
        am = services.get("auction-monitor", [])

        gw_up_start = last_event_time(gw, "upstream_start")
        gw_up_end = last_event_time(gw, "upstream_end")
        am_in = last_event_time(am, "request_in")
        am_out = last_event_time(am, "request_out")
        if None in (gw_up_start, gw_up_end, am_in, am_out):
            continue

        pre_raw = ms_between(gw_up_start, am_in)
        post_raw = ms_between(am_out, gw_up_end)
        if pre_raw is None or post_raw is None:
            continue

        upstream = last_duration(gw, "upstream_end")
        am_handler = last_duration(am, "request_out")
        gap = (
            float(upstream) - float(am_handler)
            if upstream is not None and am_handler is not None
            else None
        )

        hops.append(
            CorrelatedHop(
                observation_id=observation_id,
                timestamp_s=gw_up_start.timestamp(),
                pre_am_raw_ms=float(pre_raw),
                post_am_raw_ms=float(post_raw),
                upstream_duration_ms=upstream,
                am_handler_ms=am_handler,
                transport_gap_ms=gap,
            )
        )
    return hops


def analyze(
    hops: list[CorrelatedHop],
    *,
    window_s: int,
    proof_threshold_ms: float,
    slow_count: int,
) -> dict[str, Any]:
    windows = build_clock_windows(hops, window_s=window_s)
    feasible = [w for w in windows if w.feasible]
    infeasible = [w for w in windows if not w.feasible]

    # Per-request bounds using that request's window intersection.
    window_by_bucket = {w.bucket: w for w in windows}
    all_pre_lower: list[float] = []
    all_pre_upper: list[float] = []
    all_post_lower: list[float] = []
    all_post_upper: list[float] = []
    per_request_usable = 0
    per_request_infeasible = 0

    for hop in hops:
        bucket = int(math.floor(hop.timestamp_s / window_s) * window_s)
        window = window_by_bucket.get(bucket)
        if window is None or not window.feasible:
            per_request_infeasible += 1
            continue
        per_request_usable += 1
        pre_lo, pre_hi = pre_am_true_bounds(
            pre_am_raw_ms=hop.pre_am_raw_ms,
            delta_lower_ms=window.delta_lower_ms,
            delta_upper_ms=window.delta_upper_ms,
        )
        post_lo, post_hi = post_am_true_bounds(
            post_am_raw_ms=hop.post_am_raw_ms,
            delta_lower_ms=window.delta_lower_ms,
            delta_upper_ms=window.delta_upper_ms,
        )
        all_pre_lower.append(pre_lo)
        all_pre_upper.append(pre_hi)
        all_post_lower.append(post_lo)
        all_post_upper.append(post_hi)

    slow = sorted(
        hops,
        key=lambda h: (
            float(h.upstream_duration_ms)
            if h.upstream_duration_ms is not None
            else float(h.transport_gap_ms or 0.0)
        ),
        reverse=True,
    )[: max(0, slow_count)]

    slow_verdict = classify_directionality(
        slow_records=slow,
        windows=windows,
        proof_threshold_ms=proof_threshold_ms,
        window_s=window_s,
    )

    # Also evaluate all records meeting transport_gap >= proof threshold.
    gap_slow = [
        h
        for h in hops
        if isinstance(h.transport_gap_ms, (int, float))
        and float(h.transport_gap_ms) >= proof_threshold_ms
    ]
    gap_slow_verdict = classify_directionality(
        slow_records=gap_slow,
        windows=windows,
        proof_threshold_ms=proof_threshold_ms,
        window_s=window_s,
    )

    feasible_widths = [w.width_ms for w in feasible]
    feasible_delta_lower = [w.delta_lower_ms for w in feasible]
    feasible_delta_upper = [w.delta_upper_ms for w in feasible]

    return {
        "schema": "am-residual-h3-clock-safe-intervals/v1",
        "correlated_request_count": len(hops),
        "window_s": window_s,
        "proof_threshold_ms": proof_threshold_ms,
        "windows": {
            "total": len(windows),
            "feasible_count": len(feasible),
            "infeasible_count": len(infeasible),
            "infeasible_means": "CLOCK_MODEL_OR_TIMESTAMP_SEMANTICS_INCONSISTENT",
            "feasible_rate": (len(feasible) / len(windows)) if windows else None,
            "request_count_in_feasible_windows": sum(w.count for w in feasible),
            "request_count_in_infeasible_windows": sum(w.count for w in infeasible),
            "feasible_delta_lower_ms": summarize(feasible_delta_lower),
            "feasible_delta_upper_ms": summarize(feasible_delta_upper),
            "feasible_width_ms": summarize(feasible_widths),
            "infeasible_examples": [
                {
                    "bucket": w.bucket,
                    "count": w.count,
                    "delta_lower_ms": w.delta_lower_ms,
                    "delta_upper_ms": w.delta_upper_ms,
                    "reason": "CLOCK_MODEL_OR_TIMESTAMP_SEMANTICS_INCONSISTENT",
                }
                for w in infeasible[:20]
            ],
        },
        "per_request_bounds": {
            "usable_count": per_request_usable,
            "infeasible_count": per_request_infeasible,
            "pre_am_clock_safe_lower_ms": summarize(all_pre_lower),
            "pre_am_clock_safe_upper_ms": summarize(all_pre_upper),
            "post_am_clock_safe_lower_ms": summarize(all_post_lower),
            "post_am_clock_safe_upper_ms": summarize(all_post_upper),
            "pre_am_lower_ge_proof_threshold_count": sum(
                1 for v in all_pre_lower if v >= proof_threshold_ms
            ),
        },
        "top_slow_by_upstream": slow_verdict,
        "transport_gap_ge_threshold": {
            "count": len(gap_slow),
            **gap_slow_verdict,
        },
        "preserved_ownership": {
            "gateway_to_auction_monitor_external_gap": (
                "PROVED_PRIMARY_RESIDUAL_OWNER"
            ),
            "auction_monitor_process_local_ttfb": "RULED_OUT_AS_PRIMARY",
            "caddy_chase": "CLOSED",
            "gateway_client_or_network_queue_before_am": (
                "HIGH_CONFIDENCE_NOT_YET_CLOCK_SAFE"
            ),
        },
        "corrections": {
            "abs_max_negative_post_is": "LOWER_BOUND_ON_DELTA_NOT_UPPER_UNCERTAINTY",
            "pre_raw_plus_post_raw_given_post_nonneg_is": "UPPER_BOUND_ON_PRE_TRUE",
            "do_not_use": [
                "pre_raw - abs(max_negative_post) as guaranteed lower bound",
                "pre_raw + min(0, post_raw) as guaranteed lower bound",
            ],
        },
        "new_load_executed": False,
        "promotion_allowed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway-log", type=Path, required=True)
    parser.add_argument("--auction-log", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--window-s", type=int, default=1)
    parser.add_argument("--proof-threshold-ms", type=float, default=750.0)
    parser.add_argument("--slow-count", type=int, default=40)
    args = parser.parse_args()

    hops = load_correlated_hops(args.gateway_log, args.auction_log)
    result = analyze(
        hops,
        window_s=args.window_s,
        proof_threshold_ms=args.proof_threshold_ms,
        slow_count=args.slow_count,
    )

    # Also emit 5s windows for sensitivity.
    result_5s = analyze(
        hops,
        window_s=5,
        proof_threshold_ms=args.proof_threshold_ms,
        slow_count=args.slow_count,
    )
    result["sensitivity_window_5s"] = {
        "windows": result_5s["windows"],
        "per_request_bounds": result_5s["per_request_bounds"],
        "top_slow_by_upstream": result_5s["top_slow_by_upstream"],
        "transport_gap_ge_threshold": result_5s["transport_gap_ge_threshold"],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
