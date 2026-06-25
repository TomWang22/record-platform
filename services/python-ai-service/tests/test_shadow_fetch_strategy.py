"""T20.10W/T20.10Y — Shadow fetch strategy unit tests."""
from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.ai.rag_retrieval import (  # noqa: E402
    _collect_route_mode_shadow_rows,
    _merge_vector_rows,
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import (  # noqa: E402
    SHADOW_MIN_SOURCE_DIVERSITY,
    candidate_pool_is_sufficient,
    diversity_topup_source_types,
    needs_global_fallback,
    pool_diversity_satisfied,
    resolve_primary_source_type,
    resolve_shadow_fetch_strategy,
    source_type_quota_satisfied,
)


def _row(row_id: str, source_type: str) -> Dict[str, Any]:
    return {
        "id": row_id,
        "document_id": row_id,
        "chunk_index": 0,
        "content": f"{source_type} body",
        "checksum": "x",
        "source_refs": [],
        "source_type": source_type,
        "source_id": row_id,
        "owner_user_id": "u1",
        "visibility": "owner",
        "source_updated_at": None,
        "title": "t",
        "metadata": {},
        "score": 0.9,
    }


class TestShadowFetchStrategyResolution(unittest.TestCase):
    def test_obo_profile_primary_is_obo_offer_summary(self) -> None:
        scope = {"obo_offer_summary": 18, "listing": 20, "listing_revision": 5, "notification": 6}
        primary = resolve_primary_source_type(
            "obo_helper",
            ["obo", "owner_visible"],
            query="owner OBO summary",
            scope_by_type=scope,
        )
        self.assertEqual(primary, "obo_offer_summary")
        strategy = resolve_shadow_fetch_strategy(
            "obo_helper",
            ["obo", "owner_visible"],
            query="owner OBO summary",
            scope_by_type=scope,
        )
        self.assertEqual(strategy.fetch_strategy, "scoped_first")
        self.assertEqual(strategy.primary_source_type, "obo_offer_summary")
        self.assertIn("listing_revision", strategy.diversity_topup_source_types)
        self.assertIn("notification", strategy.diversity_topup_source_types)

    def test_listing_catalog_profile_primary_is_listing(self) -> None:
        scope = {"listing": 100, "listing_revision": 10}
        primary = resolve_primary_source_type(
            "seller_sales_summary",
            query="catalog listings seller performance",
            scope_by_type=scope,
        )
        self.assertEqual(primary, "listing")

    def test_notification_profile_primary_is_notification(self) -> None:
        scope = {"notification": 6, "listing": 100}
        primary = resolve_primary_source_type(
            "seller_sales_summary",
            query="notification alerts for seller",
            scope_by_type=scope,
        )
        self.assertEqual(primary, "notification")

    def test_generic_notification_topups_include_notification(self) -> None:
        scope = {"notification": 6, "listing": 10, "listing_revision": 4}
        topups = diversity_topup_source_types(
            "generic_rag",
            query="Summarize recent marketplace AI notifications",
            scope_by_type=scope,
        )
        self.assertEqual(topups[0], "notification")

    def test_generic_profile_uses_global_first(self) -> None:
        strategy = resolve_shadow_fetch_strategy(
            "generic_rag",
            query="marketplace",
            scope_by_type={"listing": 10},
        )
        self.assertEqual(strategy.fetch_strategy, "global_first")
        self.assertIsNone(strategy.primary_source_type)

    def test_typed_pool_sufficient_skips_global_fallback(self) -> None:
        scope = {"obo_offer_summary": 18}
        pool_by_type = {"obo_offer_summary": 8}
        self.assertTrue(
            candidate_pool_is_sufficient(
                8,
                8,
                pool_by_type=pool_by_type,
                profile="obo_helper",
                scope_by_type=scope,
                custom_hints=["obo"],
                query="offer",
                primary_source_type="obo_offer_summary",
            )
        )
        self.assertFalse(
            needs_global_fallback(
                8,
                8,
                pool_by_type=pool_by_type,
                profile="obo_helper",
                scope_by_type=scope,
                custom_hints=["obo"],
                query="offer",
                primary_source_type="obo_offer_summary",
            )
        )

    def test_typed_underfill_triggers_global_fallback(self) -> None:
        scope = {"obo_offer_summary": 18, "listing": 20}
        pool_by_type = {"obo_offer_summary": 2}
        self.assertTrue(
            needs_global_fallback(
                2,
                8,
                pool_by_type=pool_by_type,
                profile="obo_helper",
                scope_by_type=scope,
                custom_hints=["obo"],
                query="offer",
                primary_source_type="obo_offer_summary",
            )
        )

    def test_pool_diversity_satisfied(self) -> None:
        pool_by_type = {
            "obo_offer_summary": 3,
            "listing": 2,
            "listing_revision": 1,
            "notification": 1,
            "record": 1,
        }
        self.assertTrue(pool_diversity_satisfied(pool_by_type, SHADOW_MIN_SOURCE_DIVERSITY))


class TestShadowFetchExecution(unittest.TestCase):
    def test_obo_profile_runs_diversity_topups_when_count_sufficient(self) -> None:
        fetch_log: List[Optional[str]] = []
        fetch_limits: List[int] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            limit = kwargs.get("limit") or args[4] if len(args) > 4 else kwargs  # limit is kwarg
            fetch_log.append(source_type)
            if "limit" in kwargs:
                fetch_limits.append(kwargs["limit"])
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(8)]
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(3)]

        conn = AsyncMock()
        scope = {
            "obo_offer_summary": 18,
            "listing": 20,
            "listing_revision": 5,
            "notification": 6,
        }

        async def run() -> None:
            with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                rows, diag = await _collect_route_mode_shadow_rows(
                    conn,
                    filters=["c.embedding_vec IS NOT NULL"],
                    params=[],
                    vec_param=1,
                    resolved_profile="obo_helper",
                    shadow_custom_query_hints=["obo", "owner_visible"],
                    query="owner OBO summary",
                    max_chunks=8,
                    scope_by_type=scope,
                )
            types_in_pool = {row["source_type"] for row in rows}
            self.assertGreater(len(rows), 8)
            self.assertEqual(fetch_log[0], "obo_offer_summary")
            self.assertNotIn(None, fetch_log)
            self.assertTrue(diag["global_fetch_skipped"])
            self.assertIn("listing_revision", diag["diversity_topups_run"])
            self.assertIn("notification", diag["diversity_topups_run"])
            self.assertIn("listing_revision", types_in_pool)
            self.assertIn("notification", types_in_pool)

        asyncio.run(run())

    def test_duplicate_source_type_topup_skipped(self) -> None:
        fetch_log: List[Optional[str]] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            fetch_log.append(source_type)
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(8)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(2)]

        conn = AsyncMock()
        scope = {
            "obo_offer_summary": 18,
            "listing": 20,
            "listing_revision": 5,
            "notification": 6,
        }

        async def run() -> None:
            with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                _, diag = await _collect_route_mode_shadow_rows(
                    conn,
                    filters=["c.embedding_vec IS NOT NULL"],
                    params=[],
                    vec_param=1,
                    resolved_profile="obo_helper",
                    shadow_custom_query_hints=["obo", "owner_visible"],
                    query="owner OBO summary",
                    max_chunks=8,
                    scope_by_type=scope,
                )
            listing_fetches = [entry for entry in fetch_log if entry == "listing"]
            self.assertEqual(len(listing_fetches), 1)

        asyncio.run(run())

    def test_global_fallback_when_primary_and_topups_underfill(self) -> None:
        fetch_log: List[Optional[str]] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            fetch_log.append(source_type)
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(2)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(1)]

        conn = AsyncMock()
        scope = {
            "obo_offer_summary": 18,
            "listing": 20,
            "listing_revision": 5,
            "notification": 6,
        }

        async def run() -> None:
            with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                rows, diag = await _collect_route_mode_shadow_rows(
                    conn,
                    filters=["c.embedding_vec IS NOT NULL"],
                    params=[],
                    vec_param=1,
                    resolved_profile="obo_helper",
                    shadow_custom_query_hints=["obo"],
                    query="offer",
                    max_chunks=8,
                    scope_by_type=scope,
                )
            self.assertIn(None, fetch_log)
            self.assertFalse(diag["global_fetch_skipped"])
            self.assertGreaterEqual(len(rows), 8)

        asyncio.run(run())

    def test_generic_rag_notification_topup_before_global(self) -> None:
        fetch_log: List[Optional[str]] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            fetch_log.append(source_type)
            if source_type == "notification":
                return [_row(f"notif-{i}", "notification") for i in range(3)]
            if source_type is None:
                return [_row(f"lst-{i}", "listing") for i in range(8)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(2)]

        conn = AsyncMock()
        scope = {
            "notification": 6,
            "listing": 20,
            "listing_revision": 4,
            "obo_offer_summary": 5,
        }

        async def run() -> None:
            with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                rows, diag = await _collect_route_mode_shadow_rows(
                    conn,
                    filters=["c.embedding_vec IS NOT NULL"],
                    params=[],
                    vec_param=1,
                    resolved_profile="generic_rag",
                    shadow_custom_query_hints=None,
                    query="Summarize recent marketplace AI notifications",
                    max_chunks=8,
                    scope_by_type=scope,
                )
            self.assertEqual(fetch_log[0], "notification")
            types_in_pool = {row["source_type"] for row in rows}
            self.assertIn("notification", types_in_pool)
            self.assertIn("notification", diag["diversity_topups_run"])

        asyncio.run(run())

    def test_candidate_pool_deduped_before_return(self) -> None:
        rows = [
            _row("dup", "listing"),
            _row("dup", "listing"),
            _row("other", "notification"),
        ]
        merged = _merge_vector_rows(rows)
        self.assertEqual(len(merged), 2)

    def test_keyword_retrieval_import_unchanged(self) -> None:
        self.assertTrue(callable(retrieve_chunks))
        self.assertNotEqual(retrieve_chunks, retrieve_chunks_vector_shadow)


class TestShadowFetchDiagnostics(unittest.TestCase):
    def test_route_mode_includes_fetch_strategy_diagnostics(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            side_effect=[
                [
                    {"source_type": "obo_offer_summary", "cnt": 18},
                    {"source_type": "listing", "cnt": 20},
                    {"source_type": "listing_revision", "cnt": 5},
                    {"source_type": "notification", "cnt": 6},
                ],
            ]
        )

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(8)]
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(2)]

        async def run() -> Dict[str, Any]:
            with patch("app.ai.rag_retrieval._call_ollama_embed", AsyncMock(return_value=[0.1] * 768)):
                with patch("app.ai.rag_retrieval._fetch_vector_rows", AsyncMock(side_effect=fake_fetch)):
                    return await retrieve_chunks_vector_shadow(
                        conn,
                        query="owner OBO summary",
                        user_id="u1",
                        route_shadow_profile="obo_helper",
                        shadow_custom_query_hints=["obo", "owner_visible"],
                        include_diagnostics=True,
                    )

        result = asyncio.run(run())
        debug = result["shadow_diagnostics"]["debug"]
        self.assertEqual(debug["fetch_strategy"], "scoped_first")
        self.assertEqual(debug["primary_source_type"], "obo_offer_summary")
        self.assertIn("candidate_fetch_ms", debug)
        self.assertIn("diversity_topups_run", debug)
        self.assertIn("source_types_before_rerank", debug)
        self.assertIn("source_types_after_rerank", debug)


if __name__ == "__main__":
    unittest.main()
