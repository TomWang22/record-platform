#!/usr/bin/env python3
"""Write query + usefulness KPI rows for one Phase 30 matrix probe."""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "python-ai-service"))

ENABLE_ENV = {
    "AI_KPI_OBSERVABILITY_MASTER_DISABLE": "0",
    "AI_KPI_OBSERVABILITY_ENABLED": "1",
    "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
    "AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED": "1",
    "AI_KPI_ENVIRONMENT": "staging",
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
    data = json.loads(sys.argv[1])
    _reload()
    from app.ai.kpi_query_observations import write_kpi_query_observation
    from app.ai.kpi_usefulness_observations import (
        build_usefulness_observation_payload,
        write_kpi_usefulness_observation,
    )
    import app.db as db_mod

    if db_mod._pool is not None:
        await db_mod._pool.close()
        db_mod._pool = None

    qid = await write_kpi_query_observation(data["query"])
    uid = None
    if data.get("usefulness"):
        row = build_usefulness_observation_payload(**data["usefulness"])
        uid = await write_kpi_usefulness_observation(row)
    if not qid:
        return 1
    print(json.dumps({"query_id": str(qid), "usefulness_id": str(uid) if uid else None}))
    if db_mod._pool is not None:
        await db_mod._pool.close()
        db_mod._pool = None
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
