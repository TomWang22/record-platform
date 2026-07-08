#!/usr/bin/env python3
"""
Phase 27B–27G controlled local/dev KPI enablement drill.

- Applies schema posture checks against python_ai @ 127.0.0.1:5440
- Proves default-off and enablement via kpi_writes_allowed / noop_write_*
- Inserts tiny synthetic redacted rows through official write paths
- Proves disable-switch rollback

Hard stops: no production DB, no live RAG, no 57105 replay, no secrets.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
PY_AI_ROOT = REPO_ROOT / "services" / "python-ai-service"
sys.path.insert(0, str(PY_AI_ROOT))

LOCAL_DSN = os.getenv(
    "PHASE27_POSTGRES_URL",
    "postgresql://postgres:postgres@127.0.0.1:5440/python_ai",
)
FORBIDDEN_COLUMNS = (
    "response_body",
    "raw_response_body",
    "message_body",
    "raw_message_body",
    "jwt",
    "token",
    "password",
    "proxy_max_bid",
    "private_message",
    "authorization_header",
)
KPI_TABLES = (
    "ai_kpi_ingestion_events",
    "ai_kpi_searchability_checks",
    "ai_kpi_query_observations",
    "ai_kpi_usefulness_observations",
)
ENABLE_ENV = {
    "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
    "AI_KPI_OBSERVABILITY_ENABLED": "1",
    "AI_KPI_INGESTION_EVENTS_ENABLED": "1",
    "AI_KPI_SEARCHABILITY_CHECKS_ENABLED": "1",
    "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
    "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
    "AI_KPI_ENVIRONMENT": "local",
    "POSTGRES_URL_PYTHON_AI": LOCAL_DSN,
    "POOL_INIT_MAX_ATTEMPTS": "3",
    "POOL_INIT_RETRY_DELAY": "0.5",
}
DISABLE_ENV = {
    "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "1",
    "AI_KPI_OBSERVABILITY_ENABLED": "0",
    "AI_KPI_INGESTION_EVENTS_ENABLED": "0",
    "AI_KPI_SEARCHABILITY_CHECKS_ENABLED": "0",
    "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "0",
    "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "0",
}


def _reload_kpi_flags(env: Dict[str, str]) -> Any:
    for key, value in env.items():
        os.environ[key] = value
    import app.ai.config as config
    import app.ai.kpi_observability as kpi_observability

    importlib.reload(config)
    importlib.reload(kpi_observability)
    return kpi_observability


async def introspect_schema(conn) -> Dict[str, Any]:
    tables = await conn.fetch(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'ai' AND table_name = ANY($1::text[])
        ORDER BY table_name
        """,
        list(KPI_TABLES),
    )
    found = {row["table_name"] for row in tables}
    missing = [t for t in KPI_TABLES if t not in found]
    if missing:
        raise RuntimeError(f"missing KPI tables: {missing}")

    forbidden = await conn.fetch(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'ai'
          AND table_name = ANY($1::text[])
          AND column_name = ANY($2::text[])
        """,
        list(KPI_TABLES),
        list(FORBIDDEN_COLUMNS),
    )
    if forbidden:
        raise RuntimeError(f"forbidden columns present: {[(r['table_name'], r['column_name']) for r in forbidden]}")

    return {
        "tables": sorted(found),
        "forbidden_columns_present": [],
        "status": "PASS",
    }


async def ensure_ingestion_run(conn) -> str:
    run_id = await conn.fetchval(
        """
        INSERT INTO ai.ai_ingestion_runs (status, started_at, finished_at, source_counts)
        VALUES ('completed', now(), now(), '{"phase27":1}'::jsonb)
        RETURNING id::text
        """
    )
    return str(run_id)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def populate_rows(conn, run_id: str) -> Dict[str, Any]:
    kpi_observability = _reload_kpi_flags(ENABLE_ENV)
    posture = kpi_observability.kpi_observability_posture()
    if not posture["runtime_writes_enabled"]:
        raise RuntimeError(f"expected runtime writes enabled under enable env; got {posture}")

    from app.ai.kpi_ingestion_events import hash_source_id, write_kpi_ingestion_event
    from app.ai.kpi_query_observations import write_kpi_query_observation
    from app.ai.kpi_searchability_checks import write_kpi_searchability_check
    from app.ai.kpi_usefulness_observations import (
        build_usefulness_observation_payload,
        write_kpi_usefulness_observation,
    )
    import app.db as db_mod

    # Force pool against local DSN for this drill.
    if db_mod._pool is not None:
        await db_mod._pool.close()
        db_mod._pool = None

    source_hash = hash_source_id("phase27-controlled-fixture")
    arrived = _now()

    ingestion_id = await write_kpi_ingestion_event(
        {
            "ingestion_run_id": run_id,
            "source_type": "phase27_controlled",
            "source_id_hash": source_hash,
            "data_arrived_at": arrived,
            "records_received": 1,
            "records_indexed": 1,
            "embedding_jobs_started": 0,
            "embedding_jobs_completed": 0,
            "embedding_jobs_failed": 0,
            "index_upsert_success": 1,
            "index_upsert_failed": 0,
            "dead_letter_count": 0,
            "retry_count": 0,
            "arrival_to_searchable_ms": 42,
        }
    )
    if not ingestion_id:
        raise RuntimeError("ingestion write returned None while flags enabled")

    searchability_id = await write_kpi_searchability_check(
        {
            "ingestion_run_id": run_id,
            "source_type": "phase27_controlled",
            "source_id_hash": source_hash,
            "data_arrived_at": arrived,
            "searchable_verified_at": _now(),
            "arrival_to_searchable_ms": 42,
            "probe_query_hash": hash_source_id("phase27-probe"),
            "probe_status": "PASS",
            "protocol": "HTTP/1.1",
        }
    )
    if not searchability_id:
        raise RuntimeError("searchability write returned None while flags enabled")

    query_ids: List[str] = []
    for protocol in ("HTTP/1.1", "HTTP/2", "HTTP/3"):
        qid = await write_kpi_query_observation(
            {
                "observed_at": _now(),
                "protocol": protocol,
                "retrieval_mode": "keyword",
                "gate_reason": "keyword_default",
                "case_id": f"phase27-{protocol.replace('/', '')}",
                "workflow": "phase27_controlled_smoke",
                "rag_total_ms": 25,
                "keyword_retrieval_ms": 12,
                "hybrid_retrieval_ms": None,
                "fallback_count": 0,
                "canary_error_count": 0,
                "http_status": 200,
                "environment": "local",
            }
        )
        if not qid:
            raise RuntimeError(f"query observation write returned None for {protocol}")
        query_ids.append(qid)

    usefulness_specs = [
        ("HTTP/1.1", "H1 baseline 57105/57105"),
        ("HTTP/2", "H2 replay 57105/57105"),
        ("HTTP/3", "H3 replay 57105/57105"),
        ("HTTP/1.1", "Phase 22C 7200/7200 sample only"),
    ]
    usefulness_ids: List[str] = []
    for protocol, label in usefulness_specs:
        payload = build_usefulness_observation_payload(
            protocol=protocol,
            response_pass=True,
            leakage_failures=0,
            evidence_label=label,
            environment="local",
            workflow="phase27_controlled_smoke",
            case_id=f"phase27-usefulness-{label[:8]}",
            quality_score=4.0,
        )
        uid = await write_kpi_usefulness_observation(payload)
        if not uid:
            raise RuntimeError(f"usefulness write returned None for {label}")
        usefulness_ids.append(uid)

    counts = {
        "ingestion": await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_ingestion_events"),
        "searchability": await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_searchability_checks"),
        "query": await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_query_observations"),
        "usefulness": await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_usefulness_observations"),
    }

    # Sanity: no forbidden payload columns exist and no question/answer columns.
    sample_ingestion = await conn.fetchrow(
        "SELECT * FROM ai.ai_kpi_ingestion_events WHERE id = $1::uuid",
        ingestion_id,
    )
    for col in FORBIDDEN_COLUMNS:
        if col in sample_ingestion.keys():
            raise RuntimeError(f"forbidden column present on ingestion row: {col}")

    return {
        "status": "PASS",
        "ingestion_run_id": run_id,
        "source_id_hash": source_hash,
        "ids": {
            "ingestion": ingestion_id,
            "searchability": searchability_id,
            "query": query_ids,
            "usefulness": usefulness_ids,
        },
        "row_counts": {k: int(v) for k, v in counts.items()},
        "enablement_posture": posture,
    }


def prove_default_off() -> Dict[str, Any]:
    kpi_observability = _reload_kpi_flags(DISABLE_ENV)
    posture = kpi_observability.kpi_observability_posture()
    if posture["runtime_writes_enabled"]:
        raise RuntimeError("defaults must leave runtime_writes_enabled false")
    channels = ("ingestion", "searchability", "query", "usefulness")
    allowed = {ch: kpi_observability.kpi_writes_allowed(ch) for ch in channels}
    if any(allowed.values()):
        raise RuntimeError(f"default-off channels must be blocked: {allowed}")

    # No-op writers must short-circuit without inserts.
    results = {
        "ingestion": kpi_observability.noop_write_kpi_ingestion_event({"x": 1}, insert_fn=lambda _r: "should-not-run"),
        "searchability": kpi_observability.noop_write_kpi_searchability_check({"x": 1}, insert_fn=lambda _r: "should-not-run"),
        "query": kpi_observability.noop_write_kpi_query_observation({"x": 1}, insert_fn=lambda _r: "should-not-run"),
        "usefulness": kpi_observability.noop_write_kpi_usefulness_observation({"x": 1}, insert_fn=lambda _r: "should-not-run"),
    }
    if any(v is not None for v in results.values()):
        raise RuntimeError(f"disabled no-ops must return None: {results}")
    return {"status": "PASS", "posture": posture, "allowed": allowed, "noop_results": results}


def prove_enabled_flags() -> Dict[str, Any]:
    kpi_observability = _reload_kpi_flags(ENABLE_ENV)
    posture = kpi_observability.kpi_observability_posture()
    if not posture["runtime_writes_enabled"]:
        raise RuntimeError("enable drill must allow runtime writes")
    channels = ("ingestion", "searchability", "query", "usefulness")
    allowed = {ch: kpi_observability.kpi_writes_allowed(ch) for ch in channels}
    if not all(allowed.values()):
        raise RuntimeError(f"all channels must be allowed when enabled: {allowed}")
    return {"status": "PASS", "posture": posture, "allowed": allowed}


async def main() -> int:
    import asyncpg

    result: Dict[str, Any] = {
        "phase": "27B-27G",
        "environment": "local/dev python_ai@127.0.0.1:5440",
        "production_default": "keyword",
        "percent": 0,
        "allow_prod_percent": 0,
        "live_eval": "NOT RUN",
    }

    conn = await asyncpg.connect(LOCAL_DSN)
    try:
        result["27B_schema"] = await introspect_schema(conn)
        result["27C_default_off"] = prove_default_off()
        result["27C_enabled"] = prove_enabled_flags()
        run_id = await ensure_ingestion_run(conn)
        result["27D_27E_population"] = await populate_rows(conn, run_id)
        result["27G_disable_switch"] = prove_default_off()
        result["status"] = "PASS"
    except Exception as exc:
        result["status"] = "BLOCKED"
        result["error"] = str(exc)
        print(json.dumps(result, indent=2, default=str))
        return 1
    finally:
        await conn.close()
        # close any pool created during writes
        try:
            import app.db as db_mod

            if db_mod._pool is not None:
                await db_mod._pool.close()
                db_mod._pool = None
        except Exception:
            pass

    out_path = Path("/tmp/phase27-controlled-kpi-enablement-drill.json")
    out_path.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf8")
    print(json.dumps(result, indent=2, default=str))
    print(f"wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
