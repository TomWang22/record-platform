#!/usr/bin/env python3
"""T20.15C — Allowlist hybrid canary API transcript harness."""
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
OUT_DIR = REPO / "bench_logs/ai-platform/hybrid-canary-transcript"
CA_FILE = REPO / "certs" / "dev-chain.pem"


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if CA_FILE.is_file():
        ctx.load_verify_locations(cafile=str(CA_FILE))
    return ctx

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


def _score_answer(summary: str, refs: List[Dict[str, Any]]) -> float:
    if not summary or len(summary) < 40:
        return 1.0
    if not refs:
        return 2.0
    if FORBIDDEN_RE.search(summary):
        return 0.0
    if "[grounded]" in summary.lower() or "based on" in summary.lower():
        return 4.0
    return 3.5


def _judgment(score: float) -> str:
    if score >= 3.5:
        return "useful"
    if score >= 2.5:
        return "partial"
    return "fail"


def main() -> int:
    email = os.environ.get("AI_CONTRACT_EMAIL", "e2e-contract@record-platform.local")
    password = os.environ.get("AI_CONTRACT_PASSWORD", "ContractPass123!")
    allow_user = os.environ.get(
        "CONTRACT_USER_ID",
        "2ed75568-7deb-4c29-91b0-6919f24a0c9f",
    )
    control_user = os.environ.get("HYBRID_CONTROL_USER_ID", "00000000-0000-0000-0000-000000000001")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_json = OUT_DIR / f"{ts}.json"
    out_md = OUT_DIR / f"{ts}.md"

    token = _login(email, password)
    rows: List[Dict[str, Any]] = []

    control = _rag_query(token, "What should I pay attention to as a seller today?", user_id=control_user)
    rows.append(
        {
            "case_id": "control_non_allowlisted",
            "prompt": "What should I pay attention to as a seller today?",
            "user_id": control_user,
            **control,
        }
    )

    for case_id, prompt in CANARY_PROMPTS:
        allow = _rag_query(token, prompt, user_id=allow_user)
        keyword_only = _rag_query(token, prompt, user_id=control_user)
        allow_body = allow.get("body") or {}
        kw_body = keyword_only.get("body") or {}
        allow_details = allow_body.get("details") or {}
        kw_details = kw_body.get("details") or {}
        canary = allow_details.get("hybrid_canary") or {}
        refs = allow_body.get("source_refs") or []
        summary = str(allow_body.get("summary") or "")
        score = _score_answer(summary, refs)
        rows.append(
            {
                "case_id": case_id,
                "prompt": prompt,
                "user_id": allow_user,
                "allowlisted": allow,
                "keyword_baseline": keyword_only,
                "score": score,
                "judgment": _judgment(score),
                "comparison": {
                    "answer_changed": summary != str(kw_body.get("summary") or ""),
                    "retrieval_mode_allow": allow_details.get("retrieval_mode"),
                    "retrieval_mode_keyword": kw_details.get("retrieval_mode"),
                    "hybrid_latency_delta_ms": (
                        (canary.get("hybrid_latency_ms") or 0) - (canary.get("keyword_latency_ms") or 0)
                        if canary
                        else None
                    ),
                },
            }
        )

    git_sha = subprocess.check_output(
        ["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], text=True
    ).strip()

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_sha": git_sha,
        "allowlisted_user_id": allow_user,
        "control_user_id": control_user,
        "cases": rows,
    }
    out_json.write_text(json.dumps(payload, indent=2))

    lines = [
        "# T20.15C hybrid canary API transcript",
        "",
        f"- Generated: {payload['generated_at']}",
        f"- SHA: `{git_sha}`",
        f"- Allowlisted user: `{allow_user}`",
        f"- Control user: `{control_user}`",
        "",
        "## Control (non-allowlisted)",
        "",
        f"- retrieval_mode: `{(control.get('body') or {}).get('details', {}).get('retrieval_mode')}`",
        f"- http: {control.get('http_status')}",
        "",
        "## Cases",
        "",
        "| case | retrieval_mode | hybrid_fallback | score | judgment | hybrid_ms | keyword_ms | pure_doc | anchored_doc |",
        "|---|---|:---:|:---:|:---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        if row.get("case_id") == "control_non_allowlisted":
            continue
        allow = row["allowlisted"]
        details = (allow.get("body") or {}).get("details") or {}
        canary = details.get("hybrid_canary") or {}
        lines.append(
            f"| {row['case_id']} | {details.get('retrieval_mode')} | {canary.get('hybrid_fallback')} | "
            f"{row.get('score')} | {row.get('judgment')} | {canary.get('hybrid_latency_ms')} | "
            f"{canary.get('keyword_latency_ms')} | {canary.get('pure_vector_doc_overlap')} | "
            f"{canary.get('anchored_doc_overlap')} |"
        )
    out_md.write_text("\n".join(lines) + "\n")
    print(f"Wrote {out_json}")
    print(f"Wrote {out_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
