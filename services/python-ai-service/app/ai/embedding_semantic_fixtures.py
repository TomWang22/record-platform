"""Phase 33F fixture-shaped embeddings + semantic-search handlers (no production writes)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def analyze_embedding_metadata(body: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic embedding metadata fixture — no production embedding writes."""
    principal = str(body.get("principal_id") or body.get("principal_fixture") or "principal_a")
    mode = str(body.get("mode") or body.get("capability_mode") or "lineage_validation")
    content_hash = f"fixture-{mode}-deadbeef01"
    return {
        "embedding_model_version": "fixture-embed-v1",
        "chunking_strategy_version": "fixture-chunk-v1",
        "content_hash": content_hash,
        "dimension": 8,
        "normalization": "l2",
        "owner_scope": principal,
        "source_lineage": {
            "content_hash": content_hash,
            "source_system": "phase33f-fixture",
            "transform_version": "1",
            "owner_scope": principal,
        },
        "deletion_propagation": "verified",
        "reembedding_policy": "fixture_only",
        "evidence": [
            {
                "evidence_id": f"emb-{mode}",
                "source_type": "public_metadata",
                "source_id": "fixture-source-1",
                "retrieved_at": _now(),
                "summary": "Deterministic fixture embedding metadata; no production write.",
            }
        ],
        "confidence": 0.7,
        "limitations": [
            {
                "code": "fixture_only",
                "message": "Embedding generation is fixture-shaped; production writes disabled.",
                "severity": "info",
            }
        ],
        "data_freshness": _now(),
        "methodology": "deterministic_fixture",
        "sample_size": 1,
        "abstention_reason": None,
        "authorization_scope": "authenticated_market",
    }


def analyze_semantic_search(body: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic semantic/hybrid search fixture — keyword remains production default."""
    retrieval_mode = str(
        body.get("retrieval_mode")
        or body.get("mode")
        or body.get("capability_mode")
        or "keyword"
    )
    if "hybrid" in retrieval_mode:
        mode = "hybrid"
    elif "semantic" in retrieval_mode:
        mode = "semantic"
    else:
        mode = "keyword"
    query_id = str(body.get("query_id") or body.get("seed") or "fixture-query-1")
    return {
        "mode": mode,
        "query_id": str(query_id),
        "results": [
            {
                "entity_id": "fixture-release-1",
                "rank": 1,
                "score": 0.81,
                "reason_codes": ["fixture_match", mode],
            }
        ],
        "retrieval_metrics": {
            "mode": mode,
            "fixture": True,
            "production_default": "keyword",
        },
        "owner_scope_isolation": True,
        "evidence": [
            {
                "evidence_id": f"sem-{mode}",
                "source_type": "public_metadata",
                "source_id": "fixture-corpus-1",
                "retrieved_at": _now(),
                "summary": "Deterministic fixture retrieval result; no production vector default.",
            }
        ],
        "confidence": 0.65,
        "limitations": [
            {
                "code": "fixture_retrieval",
                "message": "Semantic/hybrid remain fixture/staging until separately approved.",
                "severity": "warning",
            }
        ],
        "data_freshness": _now(),
        "methodology": "deterministic_fixture",
        "sample_size": 1,
        "abstention_reason": None,
        "authorization_scope": "authenticated_market",
    }
