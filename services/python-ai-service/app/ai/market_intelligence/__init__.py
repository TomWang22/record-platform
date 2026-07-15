"""Phase 33C market intelligence — structured scarcity/valuation/auction services.

Deterministic numeric aggregation and authorization live in the Node engines.
These Python adapters invoke that single implementation for route consistency.
"""

from .service import (
    analyze_auction,
    analyze_scarcity,
    analyze_valuation,
    analyze_watchlist_temperature,
)

__all__ = [
    "analyze_scarcity",
    "analyze_valuation",
    "analyze_auction",
    "analyze_watchlist_temperature",
]
