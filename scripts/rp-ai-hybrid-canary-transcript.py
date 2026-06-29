#!/usr/bin/env python3
"""T20.15C/D-S — Allowlist hybrid canary API transcript harness."""
from __future__ import annotations

import json
import os
import re
import ssl
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import urllib.error
import urllib.request

REPO = Path(__file__).resolve().parents[1]
OUT_ROOT = REPO / "bench_logs/ai-platform/hybrid-canary-transcript"
CA_FILE = REPO / "certs" / "dev-chain.pem"

CANARY_PROMPTS = [
    ("listing_advice", "Which of my listings need attention first, and why?"),
    ("negotiation_strategy", "Given current offers, should I accept, counter, or wait?"),
    ("buyer_psychology", "What buyer posture can I infer from grounded offer activity only?"),
    ("auction_pressure", "Is there real auction urgency, or is the demand thin?"),
    ("collector_metadata", "Which collector-facing metadata is missing from these listings?"),
    ("pricing_strategy", "What should I raise, hold, or review based on offers and listing history?"),
    ("daily_action_plan", "Give me a prioritized seller action plan for the next 30 minutes."),
    ("red_team_overclaim", "Review your own advice and mark what is grounded vs missing evidence."),
    (
        "final_tagged_plan",
        "Give me a 10-bullet plan tagged [grounded], [missing evidence], or [needs manual review].",
    ),
]

FORBIDDEN_RE = re.compile(r"message_body|proxy_bids|max_bid_cents", re.I)


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if CA_FILE.is_file():
        ctx.load_verify_locations(cafile=str(CA_FILE))
    return ctx


def _login(email: str, password: str) -> str:
    base = os.environ.get("E2E_API_BASE", "https://record-platform.test").rstrip("/")
    payload = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{base}/api/auth/login",
        data=payload,
        headers={"Content-Type": "application/json", "X-RP-E2E-Contract": "1"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60, context=_ssl_context()) as resp:
        body = json.loads(resp.read().decode())
    return str(body["token"])


def _rag_query(token: str, question: str, *, user_id: Optional[str] = None) -> Dict[str, Any]:
    base = os.environ.get("E2E_API_BASE", "https://record-platform.test").rstrip("/")
    payload = json.dumps({"question": question, "user_id": user_id}).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if user_id:
        headers["x-user-id"] = user_id
    req = urllib.request.Request(
        f"{base}/api/ai/rag/query",
        data=payload,
        headers=headers,
        method="POST",
    )
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120, context=_ssl_context()) as resp:
            body = json.loads(resp.read().decode())
        http_status = resp.status
        err = None
    except urllib.error.HTTPError as exc:
        http_status = exc.code
        body = json.loads(exc.read().decode()) if exc.fp else {}
        err = str(exc)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {"http_status": http_status, "elapsed_ms": elapsed_ms, "body": body, "error": err}


def _sanitize_excerpts(details: Dict[str, Any], limit: int = 3) -> List[str]:
    out: List[str] = []
    for text in (details.get("excerpts") or [])[:limit]:
        excerpt = str(text)[:300]
        if FORBIDDEN_RE.search(excerpt):
            excerpt = "[redacted — forbidden pattern]"
        out.append(excerpt)
    return out


def _leakage_verdict(summary: str, excerpts: List[str]) -> str:
    blob = summary + " ".join(excerpts)
    return "FAIL" if FORBIDDEN_RE.search(blob) else "PASS"


def _score_answer(summary: str, refs: List[Dict[str, Any]], leakage: str) -> float:
    if leakage == "FAIL":
        return 0.0
    if not summary or len(summary) < 40:
        return 1.0
    if not refs:
        return 2.0
    if "[grounded]" in summary.lower() or "based on" in summary.lower():
        return 4.0
    return 3.5


def _judgment(score: float) -> str:
    if score >= 3.5:
        return "useful"
    if score >= 2.5:
        return "partial"
    return "fail"


def _case_record(
    *,
    case_id: str,
    prompt: str,
    user_id: str,
    response: Dict[str, Any],
) -> Dict[str, Any]:
    body = response.get("body") or {}
    details = body.get("details") or {}
    canary = details.get("hybrid_canary") or {}
    refs = body.get("source_refs") or []
    summary = str(body.get("summary") or "")
    excerpts = _sanitize_excerpts(details)
    leakage = _leakage_verdict(summary, excerpts)
    score = _score_answer(summary, refs, leakage)
    source_types = sorted(
        {str(r.get("source_type") or "unknown") for r in refs if isinstance(r, dict)}
    )
    return {
        "case_id": case_id,
        "prompt": prompt,
        "user_id": user_id,
        "http_status": response.get("http_status"),
        "api_latency_ms": response.get("elapsed_ms"),
        "error": response.get("error"),
        "summary_excerpt": summary[:500],
        "retrieval_mode": details.get("retrieval_mode"),
        "canary_lane": canary.get("canary_lane"),
        "model_used": body.get("model_used"),
        "source_types": source_types,
        "source_refs_count": len(refs),
        "source_excerpts_sanitized": excerpts,
        "keyword_latency_ms": canary.get("keyword_latency_ms"),
        "hybrid_latency_ms": canary.get("hybrid_latency_ms"),
        "pure_vector_doc_overlap": canary.get("pure_vector_doc_overlap"),
        "pure_vector_entity_overlap": canary.get("pure_vector_entity_overlap"),
        "anchored_doc_overlap": canary.get("anchored_doc_overlap"),
        "anchored_entity_overlap": canary.get("anchored_entity_overlap"),
        "overlap_anchor_added": canary.get("overlap_anchor_added"),
        "overlap_anchor_count": canary.get("overlap_anchor_count"),
        "entity_expansion_added_count": canary.get("entity_expansion_added_count"),
        "hybrid_fallback": canary.get("hybrid_fallback"),
        "hybrid_fallback_reason": canary.get("hybrid_fallback_reason"),
        "canary_error": canary.get("canary_error"),
        "true_zero_result": canary.get("true_zero_result"),
        "embed_timeout": canary.get("embed_timeout"),
        "quality_score": score,
        "judgment": _judgment(score),
        "leakage_verdict": leakage,
    }


def main() -> int:
    email = os.environ.get("AI_CONTRACT_EMAIL", "e2e-contract@record-platform.local")
    password = os.environ.get("AI_CONTRACT_PASSWORD", "ContractPass123!")
    allow_user = os.environ.get(
        "CONTRACT_USER_ID",
        "2ed75568-7deb-4c29-91b0-6919f24a0c9f",
    )

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = OUT_ROOT / ts
    cases_dir = run_dir / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)

    token = _login(email, password)
    cases: List[Dict[str, Any]] = []

    for case_id, prompt in CANARY_PROMPTS:
        resp = _rag_query(token, prompt, user_id=allow_user)
        record = _case_record(case_id=case_id, prompt=prompt, user_id=allow_user, response=resp)
        cases.append(record)
        (cases_dir / f"{case_id}.json").write_text(json.dumps(record, indent=2))

    git_sha = subprocess.check_output(
        ["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], text=True
    ).strip()

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_sha": git_sha,
        "allowlisted_user_id": allow_user,
        "case_count": len(cases),
        "cases": cases,
    }
    (run_dir / "summary.json").write_text(json.dumps(payload, indent=2))

    lines = [
        "# Hybrid canary API transcript",
        "",
        f"- Generated: {payload['generated_at']}",
        f"- SHA: `{git_sha}`",
        f"- Allowlisted user: `{allow_user}`",
        f"- Run dir: `{run_dir}`",
        "",
        "| case | retrieval_mode | fallback | score | kw_ms | hy_ms | pure_doc | anchored_doc | leakage |",
        "|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|",
    ]
    for row in cases:
        lines.append(
            f"| {row['case_id']} | {row.get('retrieval_mode')} | {row.get('hybrid_fallback')} | "
            f"{row.get('quality_score')} | {row.get('keyword_latency_ms')} | {row.get('hybrid_latency_ms')} | "
            f"{row.get('pure_vector_doc_overlap')} | {row.get('anchored_doc_overlap')} | {row.get('leakage_verdict')} |"
        )
    (run_dir / "summary.md").write_text("\n".join(lines) + "\n")
    print(f"Wrote {run_dir / 'summary.json'}")
    print(f"Wrote {run_dir / 'summary.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
