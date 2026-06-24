"""T20.10W — Shadow fetch strategy unit tests (Option A + B)."""
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
    retrieve_chunks,
    retrieve_chunks_vector_shadow,
)
from app.ai.shadow_profiles import (  # noqa: E402
    candidate_pool_is_sufficient,
    needs_global_fallback,
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
        scope = {"obo_offer_summary": 18, "listing": 20}
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
        self.assertNotIn("obo_offer_summary", strategy.extra_source_types)

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

    def test_source_type_quota_satisfied(self) -> None:
        scope = {"obo_offer_summary": 18, "listing": 20}
        satisfied = source_type_quota_satisfied(
            "obo_offer_summary",
            {"obo_offer_summary": 4},
            "obo_helper",
            8,
            scope,
            custom_hints=["obo"],
            query="offer",
        )
        self.assertTrue(satisfied)


class TestShadowFetchExecution(unittest.TestCase):
    def test_obo_profile_fetches_primary_before_global(self) -> None:
        fetch_log: List[Optional[str]] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            fetch_log.append(source_type)
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(8)]
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(3)]

        conn = AsyncMock()
        scope = {"obo_offer_summary": 18, "listing": 20, "listing_revision": 5}

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
            self.assertEqual(len(rows), 8)
            self.assertEqual(fetch_log[0], "obo_offer_summary")
            self.assertNotIn(None, fetch_log)
            self.assertTrue(diag["global_fetch_skipped"])
            self.assertIn("listing", diag["typed_fetches_skipped"])

        asyncio.run(run())

    def test_duplicate_per_type_fetch_skipped_after_global(self) -> None:
        fetch_log: List[Optional[str]] = []

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            fetch_log.append(source_type)
            if source_type is None:
                return [_row(f"lst-{i}", "listing") for i in range(8)]
            if source_type == "listing":
                return [_row(f"typed-lst-{i}", "listing") for i in range(3)]
            return [_row(f"{source_type}-{i}", source_type) for i in range(2)]

        conn = AsyncMock()
        scope = {
            "record": 10,
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
                    query="marketplace listing browse",
                    max_chunks=8,
                    scope_by_type=scope,
                )
            self.assertGreaterEqual(len(rows), 8)
            self.assertEqual(fetch_log[0], None)
            listing_fetches = [entry for entry in fetch_log if entry == "listing"]
            self.assertLessEqual(len(listing_fetches), 1)
            if "listing" in diag["typed_fetches_skipped"]:
                self.assertNotIn("listing", diag["typed_fetches_run"])

        asyncio.run(run())

    def test_keyword_retrieval_import_unchanged(self) -> None:
        self.assertTrue(callable(retrieve_chunks))
        self.assertNotEqual(retrieve_chunks, retrieve_chunks_vector_shadow)


class TestShadowFetchDiagnostics(unittest.TestCase):
    def test_route_mode_includes_fetch_strategy_diagnostics(self) -> None:
        conn = AsyncMock()
        conn.fetchval = AsyncMock(return_value=10)
        conn.fetch = AsyncMock(
            side_effect=[
                [{"source_type": "obo_offer_summary", "cnt": 18}, {"source_type": "listing", "cnt": 20}],
            ]
        )

        async def fake_fetch(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
            source_type = kwargs.get("extra_source_type")
            if source_type == "obo_offer_summary":
                return [_row(f"obo-{i}", "obo_offer_summary") for i in range(8)]
            if source_type is None:
                return [_row(f"global-{i}", "listing") for i in range(8)]
            return []

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


if __name__ == "__main__":
    unittest.main()
