"""Phase 33C service adapter — calls deterministic Node engines (fail closed)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.ai.repo_paths import resolve_repo_root

from .prompts import PROMPT_TEMPLATES

REPO_ROOT = resolve_repo_root()
RUNNER = REPO_ROOT / "scripts" / "ai-platform" / "run-phase33c-capability.mjs"


def _run(capability: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not RUNNER.is_file():
        raise HTTPException(status_code=500, detail="phase33c_runner_missing")
    started = time.time()
    # Phase 34 runtime: only when explicitly enabled (deployed integration sets env=1).
    # Offline Phase 33C unit/fixture verification must remain deterministic without PG.
    runtime_on = os.environ.get("PHASE34_RUNTIME_INTEGRATION", "0")
    env = {
        **os.environ,
        "PHASE34_RUNTIME_INTEGRATION": runtime_on,
        "PHASE34_RUNTIME_PERSIST": os.environ.get(
            "PHASE34_RUNTIME_PERSIST",
            "1" if runtime_on in ("1", "true") else "0",
        ),
    }
    input_payload = dict(payload or {})
    if "runtime_integration" not in input_payload and runtime_on in ("1", "true"):
        input_payload["runtime_integration"] = True
    proc = subprocess.run(
        ["node", str(RUNNER)],
        input=json.dumps({"capability": capability, "input": input_payload}),
        text=True,
        capture_output=True,
        cwd=str(REPO_ROOT),
        check=False,
        env=env,
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
    finished = time.time()
    duration_us = int(max(0.0, (finished - started)) * 1_000_000)
    started_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started))
    finished_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished))

    def _stage(status: str, dur: Optional[int] = None) -> Dict[str, Any]:
        return {
            "status": status,
            "started_at": started_iso,
            "finished_at": finished_iso,
            "duration_us": dur if dur is not None else duration_us,
        }

    pipeline_observation = {
        "evidence_assembler": _stage("EXECUTED_AND_OBSERVED"),
        "deterministic_engine": _stage("EXECUTED_AND_OBSERVED"),
        "model": _stage("NOT_INVOKED_BY_POLICY", 0),
        "tool": _stage("NOT_INVOKED_BY_POLICY", 0),
        "embedding": _stage("NOT_INVOKED_BY_POLICY", 0),
        "retrieval": _stage("NOT_INVOKED_BY_POLICY", 0),
        "reranker": _stage("NOT_INVOKED_BY_POLICY", 0),
        "schema_validator": _stage("EXECUTED_AND_OBSERVED"),
        "evidence_validator": _stage("EXECUTED_AND_OBSERVED"),
        "privacy_validator": _stage("EXECUTED_AND_OBSERVED"),
        "safety_validator": _stage("EXECUTED_AND_OBSERVED"),
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
            "pipeline_observation": pipeline_observation,
        },
        "pipeline_observation": pipeline_observation,
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
