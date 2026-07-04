#!/usr/bin/env python3
"""T20.25D — Opt-in hybrid preview live eval (local artifacts only)."""
from __future__ import annotations

import base64
import json
import os
import re
import ssl
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "bench_logs/ai-platform" / os.environ.get("T20_EVAL_OUT_DIR", "t20-25d-preview-eval")
CA = REPO / "certs/dev-chain.pem"
BASE = os.environ.get("E2E_API_BASE", "https://record-platform.test").rstrip("/")
PWD = "ContractPass123!"
CONTRACT_UID = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
DEFAULT_USERS: List[Tuple[str, str, str]] = [
    (CONTRACT_UID, "e2e-contract@record-platform.local", "allowlist"),
    ("00000040-0000-4000-8000-000000000000", "t20-15g-cohort0@record-platform.local", "preview"),
    ("0000002a-0000-4000-8000-000000000000", "t20-15k-cohort1@record-platform.local", "preview"),
    ("5a68fe88-c134-4166-b145-57534a3656b9", "buyer-contract@record-platform.local", "preview"),
    ("000001bc-0000-4000-8000-000000000000", "t20-15o-bucket10@record-platform.local", "preview"),
    ("00000002-0000-4000-8000-000000000000", "t20-15s-bucket20@record-platform.local", "preview"),
]
REAL_PARTICIPANT_36_USERS: List[Tuple[str, str, str]] = [
    (CONTRACT_UID, "e2e-contract@record-platform.local", "allowlist"),
    ("0dc268d0-a86f-4e12-8d10-9db0f1b735e0", "tom@example.com", "preview"),
    ("950a40b1-d12e-4839-aefd-0d353b90182a", "tw5126@example.com", "preview"),
    ("2901355e-7d04-4da1-b3a7-c22807326b94", "seed@example.com", "preview"),
]
PARTICIPANT_12_USERS: List[Tuple[str, str, str]] = [
    (CONTRACT_UID, "e2e-contract@record-platform.local", "allowlist"),
    ("00000040-0000-4000-8000-000000000000", "t20-15g-cohort0@record-platform.local", "preview"),
    ("0000002a-0000-4000-8000-000000000000", "t20-15k-cohort1@record-platform.local", "preview"),
    ("5a68fe88-c134-4166-b145-57534a3656b9", "buyer-contract@record-platform.local", "preview"),
    ("000001bc-0000-4000-8000-000000000000", "t20-15o-bucket10@record-platform.local", "preview"),
    ("00000002-0000-4000-8000-000000000000", "t20-15s-bucket20@record-platform.local", "preview"),
    ("b4ae4fcc-a2ad-4ec4-9ba6-81ea736bc018", "seller-contract@record-platform.local", "preview"),
    ("5f18a924-c607-47d6-b1f3-71087ba08d66", "bidder2-contract@record-platform.local", "preview"),
    ("2dbef265-5b37-40fb-acc1-aec84fd9b991", "bidder3-contract@record-platform.local", "preview"),
    ("0000003b-0000-4000-8000-000000000000", "t20-15s-bucket25@record-platform.local", "preview"),
    ("000000f4-0000-4000-8000-000000000000", "t20-15w-bucket30@record-platform.local", "preview"),
    ("0000017b-0000-4000-8000-000000000000", "t20-15w-bucket50@record-platform.local", "preview"),
]
USER_SETS: Dict[str, List[Tuple[str, str, str]]] = {
    "default": DEFAULT_USERS,
    "participant-12": PARTICIPANT_12_USERS,
    "real-participant-36": REAL_PARTICIPANT_36_USERS,
}


def users_from_env() -> List[Tuple[str, str, str]]:
    raw = os.environ.get("T20_EVAL_USERS_JSON")
    if raw:
        parsed = json.loads(raw)
        users: List[Tuple[str, str, str]] = []
        for row in parsed:
            uid = str(row["uuid"])
            email = str(row["email"])
            role = str(row["role"])
            users.append((uid, email, role))
        return users
    return USER_SETS.get(os.environ.get("T20_EVAL_USER_SET", "default"), DEFAULT_USERS)


USERS: List[Tuple[str, str, str]] = users_from_env()
PROMPTS = [
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
WINDOWS = int(os.environ.get("T20_25D_WINDOWS", "2"))
RUNS_PER_USER = int(os.environ.get("T20_25D_RUNS", "5"))
PER_WINDOW_RESET = os.environ.get("T20_PER_WINDOW_RESET", "") == "1"
RAG_PAUSE_SEC = float(os.environ.get("T20_EVAL_RAG_PAUSE_SEC", "0"))
RAG_RETRY_MAX = int(os.environ.get("T20_EVAL_RAG_RETRY_MAX", "8"))


def ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if CA.is_file():
        ctx.load_verify_locations(cafile=str(CA))
    return ctx


def login(email: str) -> str:
    payload = json.dumps({"email": email, "password": PWD}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=payload,
        headers={"Content-Type": "application/json", "X-RP-E2E-Contract": "1"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60, context=ssl_ctx()) as resp:
        return str(json.loads(resp.read())["token"])


def jwt_sub(token: str) -> str:
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    return str(payload["sub"])


def api_json(method: str, path: str, token: str, user_id: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-user-id": user_id,
    }
    data = json.dumps(body or {}).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120, context=ssl_ctx()) as resp:
            parsed = json.loads(resp.read())
            return {"http_status": resp.status, "elapsed_ms": (time.perf_counter() - start) * 1000.0, "body": parsed}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() if exc.fp else "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"error": raw}
        return {"http_status": exc.code, "elapsed_ms": (time.perf_counter() - start) * 1000.0, "body": parsed}


def preview_revoke(token: str, user_id: str) -> Dict[str, Any]:
    return api_json("POST", "/api/ai/rag/preview/revoke", token, user_id)


def preview_enroll(token: str, user_id: str) -> Dict[str, Any]:
    return api_json("POST", "/api/ai/rag/preview/enroll", token, user_id)


def preview_status(token: str, user_id: str) -> Dict[str, Any]:
    return api_json("GET", "/api/ai/rag/preview/status", token, user_id)


def rag_query(token: str, user_id: str, question: str) -> Dict[str, Any]:
    last: Dict[str, Any] = {}
    for attempt in range(RAG_RETRY_MAX):
        if RAG_PAUSE_SEC > 0 and attempt == 0:
            time.sleep(RAG_PAUSE_SEC)
        last = api_json("POST", "/api/ai/rag/query", token, user_id, {"question": question, "user_id": user_id})
        status = last.get("http_status")
        if status == 429 and attempt + 1 < RAG_RETRY_MAX:
            time.sleep(min(2.0, 0.1 * (2**attempt)))
            continue
        return last
    return last


def score_answer(summary: str, refs: List[Any], leakage: str) -> float:
    if leakage == "FAIL":
        return 0.0
    if not summary or len(summary) < 40:
        return 1.0
    if not refs:
        return 2.0
    if "[grounded]" in summary.lower() or "based on" in summary.lower():
        return 4.0
    return 3.5


def pctl(vals: List[float], p: float) -> Optional[float]:
    if not vals:
        return None
    s = sorted(vals)
    i = max(0, min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1)))))
    return s[i]


def rag_gate_reason(token: str, user_id: str) -> Optional[str]:
    resp = api_json(
        "POST",
        "/api/ai/rag/query",
        token,
        user_id,
        {"question": "Which of my listings need attention first, and why?", "user_id": user_id},
    )
    details = (resp.get("body") or {}).get("details") or {}
    canary = details.get("hybrid_canary") or {}
    return canary.get("gate_reason")


def reset_window_enrollments(sessions: Dict[str, Dict[str, Any]]) -> None:
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        preview_revoke(meta["token"], uid)
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        preview_enroll(meta["token"], uid)
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        for attempt in range(10):
            status_gate = (preview_status(meta["token"], uid)["body"] or {}).get("gate_reason")
            rag_gate = rag_gate_reason(meta["token"], uid)
            if status_gate == "preview_opt_in" and rag_gate == "preview_opt_in":
                break
            time.sleep(0.2)
            preview_enroll(meta["token"], uid)
        else:
            raise RuntimeError(f"preview enroll verify failed for {meta['email']}")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = OUT / ts
    run_dir.mkdir(parents=True, exist_ok=True)

    sessions: Dict[str, Dict[str, Any]] = {}
    for uid, email, role in USERS:
        token = login(email)
        assert jwt_sub(token) == uid, f"JWT mismatch for {email}"
        sessions[uid] = {"email": email, "role": role, "token": token}

    status_before: Dict[str, Any] = {}
    for uid, meta in sessions.items():
        status_before[uid] = preview_status(meta["token"], uid)["body"]

    enroll_results: Dict[str, Any] = {}
    if not PER_WINDOW_RESET:
        for uid, meta in sessions.items():
            if meta["role"] == "allowlist":
                continue
            enroll_results[uid] = preview_enroll(meta["token"], uid)

    status_after: Dict[str, Any] = {}
    if not PER_WINDOW_RESET:
        for uid, meta in sessions.items():
            status_after[uid] = preview_status(meta["token"], uid)["body"]

    cases: List[Dict[str, Any]] = []
    for window in range(1, WINDOWS + 1):
        if PER_WINDOW_RESET:
            reset_window_enrollments(sessions)
            if window == 1:
                for uid, meta in sessions.items():
                    status_after[uid] = preview_status(meta["token"], uid)["body"]
        for uid, meta in sessions.items():
            for run in range(1, RUNS_PER_USER + 1):
                for case_id, question in PROMPTS:
                    resp = rag_query(meta["token"], uid, question)
                    body = resp.get("body") or {}
                    details = body.get("details") or {}
                    canary = details.get("hybrid_canary") or {}
                    refs = body.get("source_refs") or []
                    summary = str(body.get("summary") or "")
                    blob = summary + json.dumps(details)
                    leakage = "FAIL" if FORBIDDEN_RE.search(blob) else "PASS"
                    score = score_answer(summary, refs, leakage)
                    cases.append(
                        {
                            "window": window,
                            "run": run,
                            "case_id": case_id,
                            "user_id": uid,
                            "email": meta["email"],
                            "role": meta["role"],
                            "http_status": resp.get("http_status"),
                            "elapsed_ms": resp.get("elapsed_ms"),
                            "retrieval_mode": details.get("retrieval_mode"),
                            "gate_reason": canary.get("gate_reason"),
                            "preview_opt_in": canary.get("preview_opt_in"),
                            "hybrid_fallback": canary.get("hybrid_fallback"),
                            "hybrid_fallback_reason": canary.get("hybrid_fallback_reason"),
                            "keyword_latency_ms": canary.get("keyword_latency_ms"),
                            "hybrid_latency_ms": canary.get("hybrid_latency_ms"),
                            "source_refs_count": len(refs),
                            "quality_score": score,
                            "leakage_verdict": leakage,
                            "canary_error": canary.get("canary_error"),
                        }
                    )

    http200 = sum(1 for c in cases if c.get("http_status") == 200)
    fallback = sum(1 for c in cases if c.get("retrieval_mode") == "keyword_fallback_from_hybrid")
    scores = [float(c["quality_score"]) for c in cases]
    hy = [float(c["hybrid_latency_ms"]) for c in cases if c.get("hybrid_latency_ms") is not None]
    kw = [float(c["keyword_latency_ms"]) for c in cases if c.get("keyword_latency_ms") is not None]
    gate_counts: Dict[str, int] = {}
    mode_counts: Dict[str, int] = {}
    for c in cases:
        gate_counts[c.get("gate_reason") or "unknown"] = gate_counts.get(c.get("gate_reason") or "unknown", 0) + 1
        mode_counts[c.get("retrieval_mode") or "unknown"] = mode_counts.get(c.get("retrieval_mode") or "unknown", 0) + 1

    final_cases = [c for c in cases if c["case_id"] == "final_tagged_plan"]
    final_fallback = sum(1 for c in final_cases if c.get("hybrid_fallback"))

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True).strip(),
        "windows": WINDOWS,
        "runs_per_user": RUNS_PER_USER,
        "users": len(USERS),
        "cases_total": len(cases),
        "http200": http200,
        "fallback_count": fallback,
        "fallback_rate_pct": round(100.0 * fallback / len(cases), 3) if cases else None,
        "final_tagged_plan_fallback": final_fallback,
        "avg_score": round(statistics.mean(scores), 3) if scores else None,
        "worst_score": min(scores) if scores else None,
        "hybrid_p50": pctl(hy, 50),
        "hybrid_p95": pctl(hy, 95),
        "keyword_p50": pctl(kw, 50),
        "keyword_p95": pctl(kw, 95),
        "gate_reason_counts": gate_counts,
        "retrieval_mode_counts": mode_counts,
        "canary_errors": sum(1 for c in cases if c.get("canary_error")),
        "leakage_pass": all(c.get("leakage_verdict") == "PASS" for c in cases),
        "status_before": status_before,
        "status_after": status_after,
        "enroll_results": enroll_results,
        "per_user_http200": {
            uid: sum(1 for c in cases if c["user_id"] == uid and c.get("http_status") == 200) for uid in sessions
        },
    }
    (run_dir / "summary.json").write_text(json.dumps({"summary": summary, "cases": cases}, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"Wrote {run_dir / 'summary.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
