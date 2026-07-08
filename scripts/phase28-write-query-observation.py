#!/usr/bin/env python3
"""Write one query KPI observation for Phase 28 matrix probes (official write path)."""
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
    "AI_KPI_QUERY_OBSERVATIONS_ENABLED": "1",
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
    from app.ai.kpi_query_observations import write_kpi_query_observation
    import app.db as db_mod

    if db_mod._pool is not None:
        await db_mod._pool.close()
        db_mod._pool = None

    obs_id = await write_kpi_query_observation(payload)
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
