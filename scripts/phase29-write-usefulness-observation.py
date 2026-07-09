#!/usr/bin/env python3
"""Write one usefulness KPI observation for Phase 29 matrix probes (official write path)."""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PY_AI_ROOT = REPO_ROOT / "services" / "python-ai-service"
sys.path.insert(0, str(PY_AI_ROOT))

ENABLE_ENV = {
    "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
    "AI_KPI_OBSERVABILITY_ENABLED": "1",
    "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
    "AI_KPI_ENVIRONMENT": "local",
    "POSTGRES_URL_PYTHON_AI": os.getenv(
        "POSTGRES_URL_PYTHON_AI",
        "postgresql://postgres:postgres@127.0.0.1:5440/python_ai",
    ),
}


def _reload() -> None:
    for k, v in ENABLE_ENV.items():
        os.environ[k] = v
    import app.ai.config as config
    import app.ai.kpi_observability as kpi_observability

    importlib.reload(config)
    importlib.reload(kpi_observability)


async def main() -> int:
    payload = json.loads(sys.argv[1])
    _reload()
    from app.ai.kpi_usefulness_observations import (
        build_usefulness_observation_payload,
        write_kpi_usefulness_observation,
    )
    import app.db as db_mod

    if db_mod._pool is not None:
        await db_mod._pool.close()
        db_mod._pool = None

    row = build_usefulness_observation_payload(
        protocol=payload["protocol"],
        response_pass=payload.get("response_pass", True),
        sentiment_pass=payload.get("sentiment_pass"),
        red_team_safety_pass=payload.get("red_team_safety_pass"),
        leakage_failures=payload.get("leakage_failures", 0),
        evidence_label=payload["evidence_label"],
        environment="local",
        workflow=payload.get("workflow", "phase28_controlled_matrix"),
        case_id=payload.get("case_id"),
        quality_score=payload.get("quality_score"),
    )
    obs_id = await write_kpi_usefulness_observation(row)
    if not obs_id:
        print("FAIL", file=sys.stderr)
        return 1
    print(str(obs_id))
    if db_mod._pool is not None:
        await db_mod._pool.close()
        db_mod._pool = None
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
