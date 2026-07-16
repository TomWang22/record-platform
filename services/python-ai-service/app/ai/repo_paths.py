"""Resolve monorepo root for Phase 33 Node capability runners.

Works both in the monorepo checkout (…/services/python-ai-service/app/ai/…)
and in the container image (/app/app/ai/…) when scripts are copied to /app/scripts.
"""

from __future__ import annotations

import os
from pathlib import Path

_RUNNER_REL = Path("scripts") / "ai-platform" / "run-phase33c-capability.mjs"


def resolve_repo_root(start: Path | None = None) -> Path:
    env = (os.environ.get("PHASE33_REPO_ROOT") or os.environ.get("RECORD_PLATFORM_ROOT") or "").strip()
    if env:
        return Path(env).resolve()

    here = (start or Path(__file__)).resolve()
    for parent in (here, *here.parents):
        if (parent / _RUNNER_REL).is_file():
            return parent

    # Last resort: container WORKDIR when scripts are absent (fail-closed at call time).
    return Path("/app")
