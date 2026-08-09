#!/usr/bin/env python3
"""Regression: BEFORE_AM must not promote while infeasible tail records remain."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "analyze_am_subhop_clock_safe",
    REPO / "scripts/performance/analyze-am-subhop-clock-safe.py",
)
assert _spec and _spec.loader
mod = importlib.util.module_from_spec(_spec)
# Python 3.9 dataclasses require the module to be registered before exec.
import sys

sys.modules[_spec.name] = mod
_spec.loader.exec_module(mod)

CorrelatedHop = mod.CorrelatedHop
ClockWindow = mod.ClockWindow
classify_directionality = mod.classify_directionality
may_promote_before_am = mod.may_promote_before_am


def _hop(i: int, *, t: float, pre: float, post: float) -> CorrelatedHop:
    return CorrelatedHop(
        observation_id=f"obs-{i}",
        timestamp_s=t,
        pre_am_raw_ms=pre,
        post_am_raw_ms=post,
        upstream_duration_ms=pre + post + 10.0,
        am_handler_ms=10.0,
        transport_gap_ms=pre + post,
    )


class BeforeAmPromotionGuardTests(unittest.TestCase):
    def test_may_promote_rejects_any_infeasible_tail(self):
        self.assertFalse(
            may_promote_before_am(
                usable_slow_records=381,
                infeasible_or_unbounded_records=563,
                slow_records_meeting_hard_lower_bound=119,
            )
        )

    def test_may_promote_rejects_partial_hard_lower_bounds(self):
        self.assertFalse(
            may_promote_before_am(
                usable_slow_records=381,
                infeasible_or_unbounded_records=0,
                slow_records_meeting_hard_lower_bound=119,
            )
        )

    def test_may_promote_requires_full_usable_coverage(self):
        self.assertTrue(
            may_promote_before_am(
                usable_slow_records=10,
                infeasible_or_unbounded_records=0,
                slow_records_meeting_hard_lower_bound=10,
            )
        )

    def test_classify_blocks_promotion_when_infeasible_tail_remains(self):
        # One feasible 1s window and one infeasible window; slow set spans both.
        windows = [
            ClockWindow(
                bucket=100,
                count=2,
                delta_lower_ms=0.0,
                delta_upper_ms=50.0,
                feasible=True,
                width_ms=50.0,
            ),
            ClockWindow(
                bucket=101,
                count=2,
                delta_lower_ms=200.0,
                delta_upper_ms=10.0,
                feasible=False,
                width_ms=float("nan"),
            ),
        ]
        slow = [
            _hop(1, t=100.2, pre=900.0, post=20.0),  # usable; lower = 900-50=850
            _hop(2, t=101.2, pre=900.0, post=20.0),  # infeasible window
        ]
        result = classify_directionality(
            slow_records=slow,
            windows=windows,
            proof_threshold_ms=750.0,
            window_s=1,
        )
        self.assertEqual(
            result["classification"],
            "HIGH_CONFIDENCE_NOT_YET_CLOCK_SAFE",
        )
        self.assertFalse(result["before_am_promoted"])
        self.assertEqual(result["usable_slow_records"], 1)
        self.assertEqual(result["infeasible_or_unbounded_records"], 1)
        self.assertEqual(
            result["infeasible_means"],
            "CLOCK_MODEL_OR_TIMESTAMP_SEMANTICS_INCONSISTENT",
        )
        self.assertFalse(
            may_promote_before_am(
                usable_slow_records=int(result["usable_slow_records"]),
                infeasible_or_unbounded_records=int(
                    result["infeasible_or_unbounded_records"]
                ),
                slow_records_meeting_hard_lower_bound=int(
                    result["slow_records_meeting_hard_lower_bound"]
                ),
            )
        )

    def test_classify_promotes_only_when_all_slow_records_are_feasible_and_bounded(
        self,
    ):
        windows = [
            ClockWindow(
                bucket=200,
                count=2,
                delta_lower_ms=0.0,
                delta_upper_ms=20.0,
                feasible=True,
                width_ms=20.0,
            ),
        ]
        slow = [
            _hop(1, t=200.1, pre=900.0, post=10.0),
            _hop(2, t=200.5, pre=880.0, post=15.0),
        ]
        result = classify_directionality(
            slow_records=slow,
            windows=windows,
            proof_threshold_ms=750.0,
            window_s=1,
        )
        self.assertEqual(
            result["classification"],
            "GATEWAY_CLIENT_OR_NETWORK_QUEUE_BEFORE_AM_PROVED",
        )
        self.assertTrue(result["before_am_promoted"])
        self.assertEqual(result["infeasible_or_unbounded_records"], 0)
        self.assertEqual(result["usable_slow_records"], 2)
        self.assertEqual(result["slow_records_meeting_hard_lower_bound"], 2)

    def test_frozen_terminal_artifact_does_not_claim_before_am_proved(self):
        path = (
            REPO
            / "reports/performance/live-evidence"
            / "packet-a-am-residual-h3-observation-001"
            / "TERMINAL_AM_SUBHOP_CLASSIFICATION.json"
        )
        self.assertTrue(path.is_file(), "terminal freeze artifact missing")
        import json

        doc = json.loads(path.read_text(encoding="utf-8"))
        cls = doc["CURRENT_CLASSIFICATION"]
        self.assertEqual(
            cls["gateway_to_auction_monitor_external_gap"],
            "PROVED_PRIMARY_RESIDUAL_OWNER",
        )
        self.assertEqual(
            cls["gateway_client_or_network_queue_before_am"],
            "HIGH_CONFIDENCE_NOT_YET_CLOCK_SAFE",
        )
        self.assertEqual(
            cls["one_way_pre_vs_post_directionality"],
            "UNRESOLVED_WITH_CURRENT_CROSS_POD_CLOCKS",
        )
        self.assertFalse(doc.get("before_am_promoted", False))
        support = cls["pre_am_clock_safe_support"]
        self.assertEqual(support["status"], "PARTIAL_POSITIVE_EVIDENCE")
        # Population-level promotion must remain blocked by infeasible coverage.
        self.assertFalse(
            may_promote_before_am(
                usable_slow_records=int(support["usable_transport_gap_ge_750"]),
                infeasible_or_unbounded_records=int(
                    support["excluded_infeasible_transport_gap_ge_750"]
                ),
                slow_records_meeting_hard_lower_bound=int(
                    support["hard_pre_am_lower_bound_ge_750"]
                ),
            )
        )


if __name__ == "__main__":
    unittest.main()
