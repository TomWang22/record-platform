#!/usr/bin/env python3
"""T20.41C-LIVE — N=5, 32-window production-readiness depth eval."""
from __future__ import annotations

import base64
import hashlib
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
ARTIFACT = REPO / "docs/ai-platform/T20-35-owner-approved-real-preview-participants.md"
EXPECTED_ARTIFACT_SHA = "1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa"
CA = REPO / "certs/dev-chain.pem"
BASE = os.environ.get("E2E_API_BASE", "https://record-platform.test").rstrip("/")
PWD = os.environ.get("T20_PARTICIPANT_LOGIN_PASSWORD", "ContractPass123!")
CONTRACT_UID = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
CONTRACT_EMAIL = "e2e-contract@record-platform.local"
OUT_DIR = REPO / "bench_logs/ai-platform/t20-41c-n5-production-readiness-depth-eval"
WINDOWS = 32
RUNS_PER_USER = 5
EXPECTED_TOTAL = 8640
EXPECTED_GATE_COUNTS = {"preview_opt_in": 7200, "allowlist": 1440}
EXPECTED_MODE_COUNTS = {"hybrid_canary": 8640}
PROMPTS = [
    ("listing_advice", "Which of my listings need attention first, and why?"),
    ("negotiation_strategy", "Given current offers, should I accept, counter, or wait?"),
    ("buyer_psychology", "What buyer posture can I infer from grounded offer activity only?"),
    ("auction_pressure", "Is there real auction urgency, or is the demand thin?"),
    ("collector_metadata", "Which collector-facing metadata is missing from these listings?"),
    ("pricing_strategy", "What should I raise, hold, or review based on offers and listing history?"),
    ("daily_action_plan", "Give me a prioritized seller action plan for the next 30 minutes."),
    ("red_team_overclaim", "Review your own advice and mark what is grounded vs missing evidence."),
    ("final_tagged_plan", "Give me a 10-bullet plan tagged [grounded], [missing evidence], or [needs manual review]."),
]
FORBIDDEN_RE = re.compile(r"message_body|proxy_bids|max_bid_cents", re.I)
RAG_PAUSE_SEC = float(os.environ.get("T20_EVAL_RAG_PAUSE_SEC", "0.05"))
RAG_RETRY_MAX = int(os.environ.get("T20_EVAL_RAG_RETRY_MAX", "8"))


def ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if CA.is_file():
        ctx.load_verify_locations(cafile=str(CA))
    return ctx


def artifact_sha() -> str:
    return hashlib.sha256(ARTIFACT.read_bytes()).hexdigest()


def artifact_participants() -> List[Tuple[str, str, str]]:
    text = ARTIFACT.read_text()
    rows: List[Tuple[str, str, str]] = []
    rejected_prefixes = ("t20-", "e2e-", "auth-test-", "microservice-test-", "test-", "k6-")
    for line in text.splitlines():
        if not re.match(r"^\| [0-9]+ \|", line):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 10:
            continue
        email = cells[1]
        uuid = cells[2].replace("`", "")
        ptype = cells[3]
        exposed = cells[7].upper()
        default_approved = cells[8].upper()
        percent_approved = cells[9].upper()
        if ptype not in {"real_owner_approved", "internal_staff"}:
            raise RuntimeError(f"invalid participant type for {email}: {ptype}")
        if (
            email.endswith("@record-platform.local")
            or email.startswith(rejected_prefixes)
            or "-contract" in email
            or any(term in email for term in ("benchmark", "load", "generated", "disposable"))
        ):
            raise RuntimeError(f"non-real/internal participant rejected: {email}")
        if exposed != "NO" or default_approved != "NO" or percent_approved != "NO":
            raise RuntimeError(f"hard-stop artifact fields invalid for {email}")
        rows.append((uuid, email, "preview"))
    if len(rows) != 5:
        raise RuntimeError(f"expected exactly 5 artifact participants, found {len(rows)}")
    return rows


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


def rag_probe(token: str, user_id: str) -> Tuple[str, Optional[str]]:
    resp = rag_query(token, user_id, "Which of my listings need attention first, and why?")
    body = resp.get("body") or {}
    details = body.get("details") or {}
    canary = details.get("hybrid_canary") or {}
    return str(details.get("retrieval_mode")), canary.get("gate_reason")


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


def verify_keep_env() -> Dict[str, str]:
    raw = subprocess.check_output(
        ["kubectl", "-n", "record-platform", "exec", "deploy/python-ai-service", "--", "printenv"],
        text=True,
    )
    env: Dict[str, str] = {}
    for line in raw.splitlines():
        if line.startswith("AI_RAG_HYBRID_CANARY"):
            key, _, value = line.partition("=")
            env[key] = value
    expected = {
        "AI_RAG_HYBRID_CANARY": "1",
        "AI_RAG_HYBRID_CANARY_USER_ALLOWLIST": CONTRACT_UID,
        "AI_RAG_HYBRID_CANARY_PERCENT": "0",
        "AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT": "0",
    }
    for key, value in expected.items():
        if env.get(key) != value:
            raise RuntimeError(f"{key} mismatch: {env.get(key)} != {value}")
    return env


def verify_gate(meta: Dict[str, Any], uid: str, expected_mode: str, expected_gate: str, label: str) -> None:
    mode, gate = rag_probe(meta["token"], uid)
    if mode != expected_mode or gate != expected_gate:
        raise RuntimeError(f"{label} gate failed for {meta['email']}: {mode}/{gate}, expected {expected_mode}/{expected_gate}")


def revoke_and_verify_keyword(sessions: Dict[str, Dict[str, Any]]) -> None:
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        preview_revoke(meta["token"], uid)
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        verify_gate(meta, uid, "keyword", "keyword_default", "post-revoke")


def enroll_and_verify_preview(sessions: Dict[str, Dict[str, Any]]) -> None:
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        preview_enroll(meta["token"], uid)
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        for attempt in range(10):
            status_body = preview_status(meta["token"], uid)["body"] or {}
            mode, gate = rag_probe(meta["token"], uid)
            if status_body.get("gate_reason") == "preview_opt_in" and mode == "hybrid_canary" and gate == "preview_opt_in":
                break
            time.sleep(0.2)
            preview_enroll(meta["token"], uid)
        else:
            raise RuntimeError(f"preview enroll verify failed for {meta['email']}")


def verify_contract_allowlist(sessions: Dict[str, Dict[str, Any]]) -> None:
    meta = sessions[CONTRACT_UID]
    verify_gate(meta, CONTRACT_UID, "hybrid_canary", "allowlist", "contract")


def expected_gate_for_role(role: str) -> Tuple[str, str]:
    if role == "allowlist":
        return "hybrid_canary", "allowlist"
    return "hybrid_canary", "preview_opt_in"


def fail_fast_case(
    case: Dict[str, Any],
    scores: List[float],
    hy_latencies: List[float],
) -> None:
    label = f"w{case['window']} r{case['run']} {case['case_id']} {case['email']}"
    if case.get("http_status") != 200:
        raise RuntimeError(f"{label}: non-200 HTTP {case.get('http_status')}")
    if case.get("retrieval_mode") == "keyword_fallback_from_hybrid":
        raise RuntimeError(f"{label}: fallback retrieval_mode")
    if case.get("hybrid_fallback"):
        raise RuntimeError(f"{label}: hybrid_fallback set")
    if case.get("gate_reason") == "keyword_default":
        raise RuntimeError(f"{label}: keyword_default during matrix")
    if case.get("canary_error"):
        raise RuntimeError(f"{label}: canary_error {case.get('canary_error')}")
    if case.get("leakage_verdict") != "PASS":
        raise RuntimeError(f"{label}: leakage FAIL")
    expected_mode, expected_gate = expected_gate_for_role(case["role"])
    if case.get("retrieval_mode") != expected_mode:
        raise RuntimeError(f"{label}: retrieval_mode {case.get('retrieval_mode')} != {expected_mode}")
    if case.get("gate_reason") != expected_gate:
        raise RuntimeError(f"{label}: gate_reason {case.get('gate_reason')} != {expected_gate}")
    if case["case_id"] == "final_tagged_plan" and case.get("hybrid_fallback"):
        raise RuntimeError(f"{label}: final_tagged_plan fallback")
    score = float(case["quality_score"])
    scores.append(score)
    if statistics.mean(scores) < 3.5:
        raise RuntimeError(f"{label}: running avg quality {statistics.mean(scores):.3f} < 3.5")
    if min(scores) < 3.0:
        raise RuntimeError(f"{label}: worst quality {min(scores):.3f} < 3.0")
    if case.get("hybrid_latency_ms") is not None:
        hy_latencies.append(float(case["hybrid_latency_ms"]))
        p95 = pctl(hy_latencies, 95)
        if p95 is not None and p95 > 3000:
            raise RuntimeError(f"{label}: hybrid p95 {p95:.1f} ms > 3000")


def validate_summary(summary: Dict[str, Any], cases: List[Dict[str, Any]]) -> None:
    if summary["cases_total"] != EXPECTED_TOTAL:
        raise RuntimeError(f"cases_total mismatch: {summary['cases_total']} != {EXPECTED_TOTAL}")
    if summary["http200"] != EXPECTED_TOTAL:
        raise RuntimeError(f"HTTP 200 mismatch: {summary['http200']} != {EXPECTED_TOTAL}")
    if summary["fallback_count"] > 0:
        raise RuntimeError(f"fallback_count must be 0 target, got {summary['fallback_count']}")
    if summary["fallback_rate_pct"] is not None and float(summary["fallback_rate_pct"]) > 1.0:
        raise RuntimeError(f"fallback rate above hard max: {summary['fallback_rate_pct']}")
    if summary["final_tagged_plan_fallback"] != 0:
        raise RuntimeError("final_tagged_plan fallback must be 0")
    if float(summary["avg_score"]) < 3.5:
        raise RuntimeError(f"avg_score too low: {summary['avg_score']}")
    if float(summary["worst_score"]) < 3.0:
        raise RuntimeError(f"worst_score too low: {summary['worst_score']}")
    if summary["hybrid_p95"] is not None and float(summary["hybrid_p95"]) > 3000:
        raise RuntimeError(f"hybrid_p95 too high: {summary['hybrid_p95']}")
    if summary["gate_reason_counts"] != EXPECTED_GATE_COUNTS:
        raise RuntimeError(f"gate counts mismatch: {summary['gate_reason_counts']}")
    if summary["retrieval_mode_counts"] != EXPECTED_MODE_COUNTS:
        raise RuntimeError(f"retrieval mode counts mismatch: {summary['retrieval_mode_counts']}")
    if summary["canary_errors"] != 0:
        raise RuntimeError(f"canary_errors must be 0, got {summary['canary_errors']}")
    if not summary["leakage_pass"]:
        raise RuntimeError("leakage failed")
    keyword_default = sum(1 for case in cases if case.get("gate_reason") == "keyword_default")
    if keyword_default:
        raise RuntimeError(f"keyword_default during matrix must be 0, got {keyword_default}")


def main() -> int:
    current_sha = artifact_sha()
    if current_sha != EXPECTED_ARTIFACT_SHA:
        raise RuntimeError(f"artifact freshness mismatch: {current_sha} != {EXPECTED_ARTIFACT_SHA}")
    verify_keep_env()

    participants = artifact_participants()
    users = [(CONTRACT_UID, CONTRACT_EMAIL, "allowlist"), *participants]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = OUT_DIR / ts
    run_dir.mkdir(parents=True, exist_ok=True)

    sessions: Dict[str, Dict[str, Any]] = {}
    for uid, email, role in users:
        token = login(email)
        if jwt_sub(token) != uid:
            raise RuntimeError(f"JWT mismatch for {email}")
        sessions[uid] = {"email": email, "role": role, "token": token}

    status_before = {uid: preview_status(meta["token"], uid)["body"] for uid, meta in sessions.items()}
    cases: List[Dict[str, Any]] = []
    running_scores: List[float] = []
    running_hy: List[float] = []

    for window in range(1, WINDOWS + 1):
        print(f"=== T20.41C window {window}/{WINDOWS}: lifecycle gate ===", flush=True)
        revoke_and_verify_keyword(sessions)
        enroll_and_verify_preview(sessions)
        verify_contract_allowlist(sessions)
        env = verify_keep_env()
        if env["AI_RAG_HYBRID_CANARY_PERCENT"] != "0" or env["AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT"] != "0":
            raise RuntimeError(f"percent env drift in window {window}: {env}")

        for uid, meta in sessions.items():
            for run in range(1, RUNS_PER_USER + 1):
                for case_id, question in PROMPTS:
                    resp = rag_query(meta["token"], uid, question)
                    body = resp.get("body") or {}
                    details = body.get("details") or {}
                    canary = details.get("hybrid_canary") or {}
                    refs = body.get("source_refs") or []
                    summary_text = str(body.get("summary") or "")
                    blob = summary_text + json.dumps(details)
                    leakage = "FAIL" if FORBIDDEN_RE.search(blob) else "PASS"
                    score = score_answer(summary_text, refs, leakage)
                    case = {
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
                    fail_fast_case(case, running_scores, running_hy)
                    cases.append(case)

    print("=== T20.41C post-eval revoke all preview enrollments ===", flush=True)
    revoke_and_verify_keyword(sessions)
    verify_contract_allowlist(sessions)
    status_after = {uid: preview_status(meta["token"], uid)["body"] for uid, meta in sessions.items()}

    http200 = sum(1 for case in cases if case.get("http_status") == 200)
    fallback = sum(1 for case in cases if case.get("retrieval_mode") == "keyword_fallback_from_hybrid")
    scores = [float(case["quality_score"]) for case in cases]
    hy = [float(case["hybrid_latency_ms"]) for case in cases if case.get("hybrid_latency_ms") is not None]
    kw = [float(case["keyword_latency_ms"]) for case in cases if case.get("keyword_latency_ms") is not None]
    gate_counts: Dict[str, int] = {}
    mode_counts: Dict[str, int] = {}
    for case in cases:
        gate = case.get("gate_reason") or "unknown"
        mode = case.get("retrieval_mode") or "unknown"
        gate_counts[gate] = gate_counts.get(gate, 0) + 1
        mode_counts[mode] = mode_counts.get(mode, 0) + 1
    final_cases = [case for case in cases if case["case_id"] == "final_tagged_plan"]
    final_fallback = sum(1 for case in final_cases if case.get("hybrid_fallback"))

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True).strip(),
        "artifact_sha256": current_sha,
        "windows": WINDOWS,
        "runs_per_user": RUNS_PER_USER,
        "users": len(users),
        "participants": len(participants),
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
        "canary_errors": sum(1 for case in cases if case.get("canary_error")),
        "leakage_pass": all(case.get("leakage_verdict") == "PASS" for case in cases),
        "status_before": status_before,
        "status_after": status_after,
        "per_user_http200": {
            uid: sum(1 for case in cases if case["user_id"] == uid and case.get("http_status") == 200)
            for uid in sessions
        },
    }
    validate_summary(summary, cases)
    (run_dir / "summary.json").write_text(json.dumps({"summary": summary, "cases": cases}, indent=2))
    print(json.dumps({"summary_path": str(run_dir / "summary.json"), "summary": summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
