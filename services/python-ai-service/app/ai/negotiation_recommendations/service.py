"""Phase 33D service adapter — calls deterministic Node engines (fail closed).

Authorization runs before engine invocation for negotiation. Unauthorized
thread scenarios return structured HTTP 200 refusal (Contract A) without
spawning the Node engine. Genuine engine failures map to HTTP 500, not 422.
"""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any, Dict, Optional, Set

from fastapi import HTTPException

from app.ai.repo_paths import resolve_repo_root

from . import error_taxonomy as err
from .prompts import PROMPT_TEMPLATES

REPO_ROOT = resolve_repo_root()
RUNNER = REPO_ROOT / "scripts" / "ai-platform" / "run-phase33d-capability.mjs"

_UNAUTHORIZED_MODES = frozenset(
    {
        "unauthorized_thread",
        "cross_user_thread",
        "cross_user_thread_attempt",
        "deleted_thread",
        "missing_thread",
        "wrong_thread",
        "wrong_user",
    }
)


def _negotiation_is_unauthorized(payload: Dict[str, Any]) -> bool:
    """Mirror scripts/lib/phase33d-negotiation.mjs authorizeThread + mode fixtures."""
    mode = str(payload.get("mode") or payload.get("capability_mode") or "").strip()
    if payload.get("unauthorized_thread") is True:
        return True
    if mode in _UNAUTHORIZED_MODES:
        return True
    principal = (
        payload.get("requesting_principal_fixture")
        or payload.get("principal_id")
        or payload.get("principal_fixture")
    )
    thread = payload.get("thread") if isinstance(payload.get("thread"), dict) else {}
    thread_id = (
        thread.get("thread_id")
        or payload.get("authorized_thread_id")
        or payload.get("conversation_or_session_id")
        or payload.get("thread_id")
    )
    participants: Set[str] = set(thread.get("participant_principals") or [])
    if not principal or not thread_id:
        return True
    if participants and principal not in participants:
        return True
    if thread.get("owner_cross_user_attempt") is True:
        return True
    return False


def _structured_unauthorized_negotiation(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Contract A: HTTP 200 structured refusal without invoking the Node engine."""
    side = payload.get("participant_side") or payload.get("requesting_side") or "buyer"
    thread = payload.get("thread") if isinstance(payload.get("thread"), dict) else {}
    thread_id = (
        thread.get("thread_id")
        or payload.get("authorized_thread_id")
        or payload.get("conversation_or_session_id")
        or payload.get("thread_id")
    )
    reason_codes = [err.UNAUTHORIZED_THREAD]
    if not payload.get("participant_side") and not payload.get("requesting_side"):
        reason_codes.append("MISSING_PARTICIPANT_SIDE")
    subject = payload.get("subject") if isinstance(payload.get("subject"), dict) else {}
    if not subject.get("listing_id") and not subject.get("release_id") and not payload.get("listing_id"):
        reason_codes.append("MISSING_LISTING_OR_SUBJECT")
    reason_codes.append("NO_RELIABLE_MARKET_EVIDENCE")
    # Dedupe while preserving order
    seen: Set[str] = set()
    ordered = []
    for code in reason_codes:
        if code not in seen:
            seen.add(code)
            ordered.append(code)

    limitations = [
        {
            "code": "ADVISORY_ONLY",
            "message": "Reply drafts are advisory; automatic_send_allowed remains false",
            "severity": "info",
        },
        {
            "code": "ABSTAINED",
            "message": ",".join(ordered),
            "severity": "blocking",
        },
    ]
    confidence = 0.197
    reply_drafts = {
        "concise": "I should not advise further until market or thread context is clearer.",
        "friendly": "Thanks — I need clearer authorized context before drafting a reply.",
        "firm": "No advisory reply until evidence/authorization requirements are met.",
    }
    result = {
        "participant_side": side if side in ("buyer", "seller") else "buyer",
        "authorized_thread_scope": thread_id or "none",
        "thread_scope": {
            "thread_id": thread_id,
            "authorized": False,
            "visible_message_count": 0,
            "excluded_message_count": 0,
        },
        "counterparty_signals": [],
        "stated_objectives": [],
        "inferred_objectives": [],
        "market_context": {
            "currency": payload.get("currency") or "USD",
            "asking_price": payload.get("asking_price"),
            "valuation_fair": 0,
            "sold_vs_asking": "sold_preferred",
            "phase33c_valuation_abstained": True,
        },
        "supported_price_range": {
            "currency": payload.get("currency") or "USD",
            "low": 0,
            "high": 0,
        },
        "recommended_anchor": 0,
        "recommended_target": 0,
        "walk_away_guidance": 0,
        "concession_plan": [],
        "risk_flags": ["WEAK_MARKET_EVIDENCE", "CONDITION_UNCERTAIN"],
        "reply_drafts": reply_drafts,
        "auto_send": False,
        "automatic_send_allowed": False,
        "impersonation": False,
        "cross_user_thread_retrieval": False,
        "memory_labels": ["conversation_only", "session", "external_market_evidence"],
        "evidence": [],
        "confidence": confidence,
        "limitations": limitations,
        "data_freshness": None,
        "methodology": "phase33d_deterministic_negotiation_v1",
        "sample_size": 0,
        "abstention_reason": ",".join(ordered),
        "authorization_scope": "none",
    }
    envelope = {
        "capability": "negotiation_assistance",
        "schema_version": "phase33d-negotiation-1",
        "subject": subject,
        "requesting_side": payload.get("participant_side") or payload.get("requesting_side"),
        "authorization_scope": {"thread_id": thread_id, "authorized": False},
        "generated_at": "2026-07-15T18:00:00.000Z",
        "data_freshness": {"status": "missing", "as_of": None},
        "evidence": [],
        "confidence": confidence,
        "limitations": limitations,
        "abstention": {"abstained": True, "reason_codes": ordered},
        "automatic_send_allowed": False,
        "summary": "Abstaining from negotiation advice due to authorization, safety, or evidence limits.",
        "inferred_detail": [],
    }
    prompt_meta = {
        **PROMPT_TEMPLATES.get("negotiation_assistance", {}),
        "capability": "negotiation_assistance",
        "schema_version": "phase33d-negotiation-1",
        "participant_side": result["participant_side"],
        "message_count": 0,
        "evidence_count": 0,
        "retrieval_mode": "keyword_metadata",
        "model_configuration_id": "deterministic_code_only_summarization_optional",
    }
    return {
        "status": "PASS",
        "capability": "negotiation_assistance",
        "envelope": envelope,
        "result": result,
        "diagnostics": {
            "unauthorized_thread": True,
            "auto_send_violations": 0,
            "impersonation_violations": 0,
            "fabricated_leverage": 0,
            "unsafe_tactic_compliance": 0,
            "deleted_message_influence": 0,
            "excluded_messages": [],
            "excluded_evidence": [],
            "confidence_factors": {
                "exact_pressing_certainty": 0.35,
                "comparable_count_score": 0,
                "evidence_diversity": 0,
                "freshness_ratio": 0,
                "condition_confidence": 0.3,
                "market_depth_score": 0,
                "price_dispersion_penalty": 1,
                "source_agreement": 0.2,
                "authorized_availability": 0,
            },
            "retrieval_mode": "keyword_metadata",
            "production_mutations": False,
            "refused_unsafe": [],
            "production_writes": False,
            "automatic_send_allowed": False,
            "engine_invoked": False,
            "reason_code": err.UNAUTHORIZED_THREAD,
        },
        "prompt": prompt_meta,
    }


def _raise_engine_failure(capability: str, body: Dict[str, Any], *, returncode: int) -> None:
    """Map engine failures to the stable public taxonomy (never user-facing exception text)."""
    if body.get("schema_violations"):
        raise HTTPException(status_code=422, detail=err.SCHEMA_INVALID_RESPONSE)
    # Unauthorized should have been short-circuited before spawn; if the engine still
    # reports it with a usable PASS-shaped body we never reach here. FAIL+unauthorized
    # is an internal inconsistency → 500, not a client 422/403.
    public = err.ENGINE_INTERNAL_FAILURE
    if returncode < 0:
        public = err.ENGINE_TEMPORARILY_UNAVAILABLE
        raise HTTPException(status_code=503, detail=public)
    # Log internal detail only
    internal = body.get("error") or "phase33d_engine_failed"
    sys.stderr.write(f"phase33d:{capability}:engine_failure public={public} internal={internal!s}\n")
    raise HTTPException(status_code=500, detail=public)


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
        _raise_engine_failure(capability, body, returncode=proc.returncode)
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
            "engine_invoked": True,
        },
        "prompt": prompt_meta,
    }


def _normalize_negotiation_result(result: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure customer UI fields exist (draft_reply/strategy) without inventing numbers."""
    out = dict(result or {})
    drafts = out.get("reply_drafts") if isinstance(out.get("reply_drafts"), dict) else {}
    draft = (
        out.get("draft_reply")
        or out.get("reply_draft")
        or drafts.get("primary")
        or drafts.get("friendly")
        or drafts.get("concise")
        or ""
    )
    out["draft_reply"] = draft
    out["reply_draft"] = draft
    if not out.get("strategy"):
        plan = out.get("concession_plan")
        if isinstance(plan, list) and plan:
            out["strategy"] = str(plan[0])
        elif out.get("summary"):
            out["strategy"] = str(out["summary"])
    return out


def analyze_negotiation(body: Dict[str, Any]) -> Dict[str, Any]:
    """Authorize first; invoke engine only for authorized negotiation requests."""
    if _negotiation_is_unauthorized(body):
        unauthorized = _structured_unauthorized_negotiation(body)
        unauthorized["result"] = _normalize_negotiation_result(unauthorized.get("result") or {})
        return unauthorized
    out = _run("negotiation_assistance", body)
    out["result"] = _normalize_negotiation_result(out.get("result") or {})
    return out


def analyze_recommendations(body: Dict[str, Any]) -> Dict[str, Any]:
    return _run("recommendations", body)
