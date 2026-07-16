"""Phase 33E service adapter — deterministic Node engines (fail closed)."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any, Dict

from fastapi import HTTPException

from app.ai.repo_paths import resolve_repo_root

from .prompts import PROMPT_TEMPLATES

REPO_ROOT = resolve_repo_root()
RUNNER = REPO_ROOT / "scripts" / "ai-platform" / "run-phase33e-capability.mjs"


def _run(capability: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not RUNNER.is_file():
        raise HTTPException(status_code=500, detail="phase33e_runner_missing")
    proc = subprocess.run(
        ["node", str(RUNNER)],
        input=json.dumps({"capability": capability, "input": payload}),
        text=True,
        capture_output=True,
        cwd=str(REPO_ROOT),
        check=False,
    )
    if proc.stderr:
        sys.stderr.write(f"phase33e:{capability}: {proc.stderr[:500]}\n")
    try:
        body = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="phase33e_invalid_engine_output") from exc
    if proc.returncode != 0 or body.get("status") != "PASS":
        detail = body.get("error") or "phase33e_engine_failed"
        diags = body.get("diagnostics") or {}
        if "unauthorized" in str(detail).lower() or "UNAUTHORIZED" in str(
            (body.get("envelope") or {}).get("abstention", {}).get("reason_codes")
        ):
            raise HTTPException(status_code=403, detail="unauthorized_scope")
        if body.get("schema_violations"):
            raise HTTPException(status_code=422, detail="schema_invalid_response")
        if diags.get("cross_user_leakage"):
            raise HTTPException(status_code=403, detail="cross_user_refused")
        raise HTTPException(status_code=422, detail=str(detail))
    result = body.get("result") or {}
    prompt_meta = {
        **PROMPT_TEMPLATES.get(capability, {}),
        "capability": capability,
        "schema_version": (body.get("envelope") or {}).get("schema_version"),
        "analytics_mode": result.get("analytics_mode"),
        "memory_classes_used": result.get("memory_classes_used"),
        "recalled_item_count": len(result.get("recalled_items") or []),
        "evidence_count": len(result.get("evidence") or []),
        "retrieval_mode": "keyword_metadata",
        "model_configuration_id": "deterministic_code_only_summarization_optional",
    }
    return {
        "status": "PASS",
        "capability": capability,
        "envelope": body.get("envelope"),
        "result": result,
        "diagnostics": {
            **(body.get("diagnostics") or {}),
            "production_writes": False,
            "production_db_migration": False,
            "retrieval_mode": "keyword_metadata",
        },
        "prompt": prompt_meta,
    }


def analyze_market_analytics(body: Dict[str, Any]) -> Dict[str, Any]:
    return _run("market_analytics", body)


def resolve_memory(body: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(body)
    payload["operation"] = "resolve"
    return _run("multi_turn_memory", payload)


def forget_memory(body: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(body)
    payload["operation"] = "forget"
    return _run("multi_turn_memory", payload)
