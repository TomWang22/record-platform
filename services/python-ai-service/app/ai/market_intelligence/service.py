"""Phase 33C service adapter — calls deterministic Node engines (fail closed)."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.ai.repo_paths import resolve_repo_root

from .prompts import PROMPT_TEMPLATES

REPO_ROOT = resolve_repo_root()
RUNNER = REPO_ROOT / "scripts" / "ai-platform" / "run-phase33c-capability.mjs"


def _run(capability: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not RUNNER.is_file():
        raise HTTPException(status_code=500, detail="phase33c_runner_missing")
    proc = subprocess.run(
        ["node", str(RUNNER)],
        input=json.dumps({"capability": capability, "input": payload}),
        text=True,
        capture_output=True,
        cwd=str(REPO_ROOT),
        check=False,
    )
    if proc.stderr:
        # Diagnostics only; never private payloads in logs beyond capability id.
        sys.stderr.write(f"phase33c:{capability}: {proc.stderr[:500]}\n")
    try:
        body = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="phase33c_invalid_engine_output") from exc
    if proc.returncode != 0 or body.get("status") != "PASS":
        detail = body.get("error") or "phase33c_engine_failed"
        # Client errors for authorization/validation shaped failures
        if "unauthorized" in str(detail).lower() or body.get("diagnostics", {}).get(
            "unauthorized_watchlist"
        ):
            raise HTTPException(status_code=403, detail="unauthorized_watchlist")
        if body.get("schema_violations"):
            raise HTTPException(status_code=422, detail="schema_invalid_response")
        raise HTTPException(status_code=422, detail=str(detail))
    prompt_meta = {
        **PROMPT_TEMPLATES.get(capability, {}),
        "capability": capability,
        "retrieval_mode": "keyword_metadata",
        "evidence_count": len((body.get("result") or {}).get("evidence") or []),
        "model_configuration": "deterministic_code_only_summarization_optional",
    }
    return {
        "status": "PASS",
        "capability": capability,
        "envelope": body.get("envelope"),
        "result": body.get("result"),
        "diagnostics": {
            **(body.get("diagnostics") or {}),
            "production_writes": False,
            "retrieval_mode": "keyword_metadata",
        },
        "prompt": prompt_meta,
    }


def analyze_scarcity(body: Dict[str, Any]) -> Dict[str, Any]:
    return _run("scarcity", body)


def analyze_valuation(body: Dict[str, Any]) -> Dict[str, Any]:
    return _run("valuation", body)


def analyze_auction(body: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(body)
    payload.setdefault("analysis_mode", "single_auction")
    return _run("auction_intelligence", payload)


def analyze_watchlist_temperature(body: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(body)
    payload["analysis_mode"] = "watchlist_batch"
    return _run("auction_intelligence", payload)
