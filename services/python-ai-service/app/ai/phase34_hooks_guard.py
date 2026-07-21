"""Phase 34 — refuse unit-test / synthetic hooks in production runtime."""

from __future__ import annotations

import os
from typing import List, Mapping, Optional

FORCE_FLOOR_FIELDS = (
    "force_sold_floor",
    "force_watchlist_floor",
    "force_search_floor",
    "force_recommendation_floor",
    "force_analytics_floor",
    "force_negotiation_market_floor",
    "force_success_floor",
)


def unit_test_hooks_allowed(env: Optional[Mapping[str, str]] = None) -> bool:
    e = env if env is not None else os.environ
    return e.get("PHASE34_UNIT_TEST_HOOKS") == "1" or e.get("PHASE34_ALLOW_SYNTHETIC_SALES") == "1"


def _is_production(env: Mapping[str, str]) -> bool:
    if env.get("NODE_ENV") == "production":
        return True
    runtime = str(env.get("RP_RUNTIME_ENV") or env.get("ENVIRONMENT") or "").lower()
    return runtime == "production"


def assert_phase34_hooks_disabled_in_production(env: Optional[Mapping[str, str]] = None) -> None:
    e = env if env is not None else os.environ
    if not _is_production(e):
        return
    if e.get("PHASE34_UNIT_TEST_HOOKS") == "1" or e.get("PHASE34_ALLOW_SYNTHETIC_SALES") == "1":
        raise RuntimeError(
            "PHASE34_HOOKS_FORBIDDEN_IN_PRODUCTION: "
            f"PHASE34_UNIT_TEST_HOOKS={e.get('PHASE34_UNIT_TEST_HOOKS')!r} "
            f"PHASE34_ALLOW_SYNTHETIC_SALES={e.get('PHASE34_ALLOW_SYNTHETIC_SALES')!r}"
        )


def reject_force_floor_fields(body: Mapping[str, object], env: Optional[Mapping[str, str]] = None) -> List[str]:
    """Return force_* field names present on a live (non-hook) request body."""
    if unit_test_hooks_allowed(env):
        return []
    rejected: List[str] = []
    for key in FORCE_FLOOR_FIELDS:
        if key in body and body.get(key) is not None:
            rejected.append(key)
    return rejected
