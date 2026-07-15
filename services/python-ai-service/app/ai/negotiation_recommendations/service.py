"""Phase 33D service adapter — calls deterministic Node engines (fail closed)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException

from .prompts import PROMPT_TEMPLATES

REPO_ROOT = Path(__file__).resolve().parents[5]
RUNNER = REPO_ROOT / "scripts" / "ai-platform" / "run-phase33d-capability.mjs"


def _run(capability: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not RUNNER.is_file():
        raise HTTPException(status_code=500, detail="phase33d_runner_missing")
    proc = subprocess.run(
        ["node", str(RUNNER)],
        input=json.dumps({"capability": capability, "input": payload}),
        text=True,
        capture_output=True,
        cwd=str(REPO_ROOT),
        check=False,
    )
    if proc.stderr:
        sys.stderr.write(f"phase33d:{capability}: {proc.stderr[:500]}\n")
    try:
        body = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="phase33d_invalid_engine_output") from exc
    if proc.returncode != 0 or body.get("status") != "PASS":
        detail = body.get("error") or "phase33d_engine_failed"
        if body.get("diagnostics", {}).get("unauthorized_thread"):
            raise HTTPException(status_code=403, detail="unauthorized_thread")
        if body.get("schema_violations"):
            raise HTTPException(status_code=422, detail="schema_invalid_response")
        raise HTTPException(status_code=422, detail=str(detail))
    result = body.get("result") or {}
    prompt_meta = {
        **PROMPT_TEMPLATES.get(capability, {}),
        "capability": capability,
        "schema_version": (body.get("envelope") or {}).get("schema_version"),
        "participant_side": result.get("participant_side"),
        "message_count": (result.get("thread_scope") or {}).get("visible_message_count"),
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
            "automatic_send_allowed": False,
            "retrieval_mode": "keyword_metadata",
        },
        "prompt": prompt_meta,
    }


def analyze_negotiation(body: Dict[str, Any]) -> Dict[str, Any]:
    return _run("negotiation_assistance", body)


def analyze_recommendations(body: Dict[str, Any]) -> Dict[str, Any]:
    return _run("recommendations", body)
