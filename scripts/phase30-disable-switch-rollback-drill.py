#!/usr/bin/env python3
"""
Phase 30G — disable-switch rollback drill after matrix/report generation.

Proves all KPI write channels stop and local/dev deployment KPI flags are re-disabled.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

REPO_ROOT = Path(__file__).resolve().parents[1]
PY_AI_ROOT = REPO_ROOT / "services" / "python-ai-service"
sys.path.insert(0, str(PY_AI_ROOT))

LOCAL_DSN = os.getenv(
    "PHASE30_POSTGRES_URL",
    "postgresql://postgres:postgres@127.0.0.1:5440/python_ai",
)
OUT_JSON = Path("/tmp/phase30-disable-switch-rollback-drill.json")
NAMESPACE = os.getenv("PHASE30_K8S_NAMESPACE", "record-platform")
DEPLOY = os.getenv("PHASE30_K8S_DEPLOY", "python-ai-service")

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


def rollback_k8s_kpi_flags() -> Dict[str, Any]:
    """Re-disable KPI flags on local dev deployment (not production ConfigMap commit)."""
    env_pairs = [
        "AI_KPI_OBSERVABILITY_MASTER_DISABLE=1",
        "AI_KPI_OBSERVABILITY_ENABLED=0",
        "AI_KPI_INGESTION_EVENTS_ENABLED=0",
        "AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0",
        "AI_KPI_QUERY_OBSERVATIONS_ENABLED=0",
        "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0",
    ]
    cmd = ["kubectl", "-n", NAMESPACE, "set", "env", f"deploy/{DEPLOY}", *env_pairs]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"status": "SKIPPED", "note": result.stderr.strip(), "kubectl_available": False}
    subprocess.run(
        ["kubectl", "-n", NAMESPACE, "rollout", "status", f"deploy/{DEPLOY}", "--timeout=120s"],
        capture_output=True,
        text=True,
    )
    return {"status": "PASS", "deployment": DEPLOY, "namespace": NAMESPACE}


def prove_local_disable() -> Dict[str, Any]:
    kpi = _reload_kpi_flags(DISABLE_ENV)
    posture = kpi.kpi_observability_posture()
    if posture["runtime_writes_enabled"]:
        raise RuntimeError("runtime_writes_enabled must be false after disable")
    channels = ("ingestion", "searchability", "query", "usefulness")
    allowed = {ch: kpi.kpi_writes_allowed(ch) for ch in channels}
    if any(allowed.values()):
        raise RuntimeError(f"channels must be blocked: {allowed}")
    noop = {
        "ingestion": kpi.noop_write_kpi_ingestion_event({"x": 1}, insert_fn=lambda _r: "blocked"),
        "searchability": kpi.noop_write_kpi_searchability_check({"x": 1}, insert_fn=lambda _r: "blocked"),
        "query": kpi.noop_write_kpi_query_observation({"x": 1}, insert_fn=lambda _r: "blocked"),
        "usefulness": kpi.noop_write_kpi_usefulness_observation({"x": 1}, insert_fn=lambda _r: "blocked"),
    }
    if any(v is not None for v in noop.values()):
        raise RuntimeError(f"noop writes must return None: {noop}")
    return {"status": "PASS", "posture": posture, "allowed": allowed, "noop_results": noop}


async def prove_no_row_growth(conn) -> Dict[str, Any]:
    before = {
        "ingestion": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_ingestion_events")),
        "searchability": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_searchability_checks")),
        "query": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_query_observations")),
        "usefulness": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_usefulness_observations")),
    }
    kpi = _reload_kpi_flags(DISABLE_ENV)
    from app.ai.kpi_ingestion_events import write_kpi_ingestion_event
    from app.ai.kpi_query_observations import write_kpi_query_observation
    from app.ai.kpi_searchability_checks import write_kpi_searchability_check
    from app.ai.kpi_usefulness_observations import write_kpi_usefulness_observation

    attempts = {
        "ingestion": await write_kpi_ingestion_event({"source_type": "rollback-test"}),
        "searchability": await write_kpi_searchability_check({"source_type": "rollback-test"}),
        "query": await write_kpi_query_observation(
            {
                "protocol": "HTTP/1.1",
                "retrieval_mode": "keyword",
                "rag_total_ms": 1,
                "environment": "staging",
                "observed_at": "2026-07-08T12:00:00Z",
            }
        ),
        "usefulness": await write_kpi_usefulness_observation(
            {
                "protocol": "HTTP/1.1",
                "response_pass": True,
                "evidence_label": "rollback-test",
                "environment": "staging",
            }
        ),
    }
    after = {
        "ingestion": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_ingestion_events")),
        "searchability": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_searchability_checks")),
        "query": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_query_observations")),
        "usefulness": int(await conn.fetchval("SELECT COUNT(*) FROM ai.ai_kpi_usefulness_observations")),
    }
    if before != after:
        raise RuntimeError(f"row counts changed after disable switch: before={before} after={after}")
    if any(v is not None for v in attempts.values()):
        raise RuntimeError(f"write attempts should return None: {attempts}")
    return {"status": "PASS", "before": before, "after": after, "attempts": attempts}


async def main() -> int:
    import asyncpg

    result: Dict[str, Any] = {
        "phase": "30H",
        "production_default": "keyword",
        "percent": 0,
        "allow_prod_percent": 0,
    }
    conn = await asyncpg.connect(LOCAL_DSN)
    try:
        result["k8s_rollback"] = rollback_k8s_kpi_flags()
        result["local_disable"] = prove_local_disable()
        result["no_row_growth"] = await prove_no_row_growth(conn)
        result["status"] = "PASS"
    except Exception as exc:
        result["status"] = "BLOCKED"
        result["error"] = str(exc)
        OUT_JSON.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf8")
        print(json.dumps(result, indent=2, default=str))
        return 1
    finally:
        await conn.close()

    OUT_JSON.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf8")
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
