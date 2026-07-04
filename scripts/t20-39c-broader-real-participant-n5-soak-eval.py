#!/usr/bin/env python3
"""T20.39C — Broader real-participant N=5 soak (artifact-gated)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Tuple

REPO = Path(__file__).resolve().parents[1]
ARTIFACT = REPO / "docs/ai-platform/T20-35-owner-approved-real-preview-participants.md"
EXPECTED_ARTIFACT_SHA = "1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa"
CA = REPO / "certs/dev-chain.pem"
BASE = os.environ.get("E2E_API_BASE", "https://record-platform.test").rstrip("/")
PWD = os.environ.get("T20_PARTICIPANT_LOGIN_PASSWORD", "ContractPass123!")
CONTRACT_UID = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
CONTRACT_EMAIL = "e2e-contract@record-platform.local"
OUT_DIR = REPO / "bench_logs/ai-platform/t20-39c-broader-real-participant-n5-eval"


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
    for line in text.splitlines():
        if not re.match(r"^\| [0-9]+ \|", line):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        email = cells[1]
        uuid = cells[2].replace("`", "")
        ptype = cells[3]
        if ptype not in {"real_owner_approved", "internal_staff"}:
            raise RuntimeError(f"invalid participant type for {email}: {ptype}")
        if email.endswith("@record-platform.local") or email.startswith(("t20-", "e2e-")) or "-contract" in email:
            raise RuntimeError(f"staging/test participant rejected: {email}")
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


def api(method: str, path: str, token: str, user_id: str, body: dict | None = None) -> dict:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-user-id": user_id,
    }
    data = json.dumps(body or {}).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120, context=ssl_ctx()) as resp:
            return {"http_status": resp.status, "body": json.loads(resp.read())}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() if exc.fp else "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"error": raw}
        return {"http_status": exc.code, "body": parsed}


def rag_probe(token: str, user_id: str) -> tuple[str, str | None]:
    body = api(
        "POST",
        "/api/ai/rag/query",
        token,
        user_id,
        {"question": "Which of my listings need attention first, and why?", "user_id": user_id},
    )["body"]
    details = body.get("details") or {}
    canary = details.get("hybrid_canary") or {}
    return str(details.get("retrieval_mode")), canary.get("gate_reason")


def latest_summary() -> Path:
    candidates = sorted(OUT_DIR.glob("*/summary.json"), key=lambda p: p.stat().st_mtime)
    if not candidates:
        raise RuntimeError(f"no summary.json found under {OUT_DIR}")
    return candidates[-1]


def validate_summary(path: Path) -> Dict[str, Any]:
    payload = json.loads(path.read_text())
    summary = payload["summary"]
    cases = payload["cases"]
    expected_total = 4320
    expected_gate_counts = {"preview_opt_in": 3600, "allowlist": 720}

    if summary["cases_total"] != expected_total:
        raise RuntimeError(f"cases_total mismatch: {summary['cases_total']} != {expected_total}")
    if summary["http200"] != expected_total:
        raise RuntimeError(f"HTTP 200 mismatch: {summary['http200']} != {expected_total}")
    if summary["fallback_count"] != 0:
        raise RuntimeError(f"fallback_count must be 0, got {summary['fallback_count']}")
    if summary["final_tagged_plan_fallback"] != 0:
        raise RuntimeError("final_tagged_plan fallback must be 0")
    if float(summary["avg_score"]) < 3.5:
        raise RuntimeError(f"avg_score too low: {summary['avg_score']}")
    if float(summary["worst_score"]) < 3.0:
        raise RuntimeError(f"worst_score too low: {summary['worst_score']}")
    if summary["hybrid_p95"] is not None and float(summary["hybrid_p95"]) > 3000:
        raise RuntimeError(f"hybrid_p95 too high: {summary['hybrid_p95']}")
    if summary["gate_reason_counts"] != expected_gate_counts:
        raise RuntimeError(f"gate counts mismatch: {summary['gate_reason_counts']}")
    if summary["canary_errors"] != 0:
        raise RuntimeError(f"canary_errors must be 0, got {summary['canary_errors']}")
    if not summary["leakage_pass"]:
        raise RuntimeError("leakage failed")
    keyword_default = sum(1 for case in cases if case.get("gate_reason") == "keyword_default")
    if keyword_default:
        raise RuntimeError(f"keyword_default during matrix must be 0, got {keyword_default}")
    return summary


def main() -> int:
    current_sha = artifact_sha()
    if current_sha != EXPECTED_ARTIFACT_SHA:
        raise RuntimeError(f"artifact freshness mismatch: {current_sha} != {EXPECTED_ARTIFACT_SHA}")

    participants = artifact_participants()
    users = [(CONTRACT_UID, CONTRACT_EMAIL, "allowlist"), *participants]
    user_payload = [{"uuid": uid, "email": email, "role": role} for uid, email, role in users]

    os.environ["T20_EVAL_USER_SET"] = "real-participant-39-n5"
    os.environ["T20_EVAL_USERS_JSON"] = json.dumps(user_payload)
    os.environ["T20_EVAL_OUT_DIR"] = "t20-39c-broader-real-participant-n5-eval"
    os.environ["T20_25D_WINDOWS"] = "16"
    os.environ["T20_25D_RUNS"] = "5"
    os.environ["T20_PER_WINDOW_RESET"] = "1"
    os.environ["T20_EVAL_RAG_PAUSE_SEC"] = "0.05"
    os.environ["T20_EVAL_RAG_RETRY_MAX"] = "8"

    sessions_pre = {uid: {"email": email, "role": role, "token": login(email)} for uid, email, role in users}
    print("=== pre-eval revoke all preview enrollments ===")
    for uid, meta in sessions_pre.items():
        if meta["role"] == "allowlist":
            continue
        api("POST", "/api/ai/rag/preview/revoke", meta["token"], uid)
        mode, gate = rag_probe(meta["token"], uid)
        if mode != "keyword" or gate != "keyword_default":
            raise RuntimeError(f"pre-enroll keyword_default failed for {meta['email']}: {mode}/{gate}")
        print(meta["email"], mode, gate)

    subprocess.run([sys.executable, str(REPO / "scripts/t20-25d-opt-in-preview-eval.py")], check=True, cwd=REPO)

    summary_path = latest_summary()
    summary = validate_summary(summary_path)

    sessions = {uid: {"email": email, "role": role, "token": login(email)} for uid, email, role in users}
    print("=== post-eval revoke all preview enrollments ===")
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        api("POST", "/api/ai/rag/preview/revoke", meta["token"], uid)

    print("=== post-revoke keyword_default probes ===")
    for uid, meta in sessions.items():
        mode, gate = rag_probe(meta["token"], uid)
        if meta["role"] == "allowlist":
            if mode != "hybrid_canary" or gate != "allowlist":
                raise RuntimeError(f"contract: {mode}/{gate}")
        elif mode != "keyword" or gate != "keyword_default":
            raise RuntimeError(f"participant {meta['email']}: {mode}/{gate}")
        print(meta["email"], mode, gate)

    print(json.dumps({"summary_path": str(summary_path), "summary": summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

