#!/usr/bin/env python3
"""T20.26C — UI-design readiness live preview smoke (270 cases)."""
from __future__ import annotations

import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CA = REPO / "certs/dev-chain.pem"
BASE = os.environ.get("E2E_API_BASE", "https://record-platform.test").rstrip("/")
PWD = "ContractPass123!"
CONTRACT_UID = "2ed75568-7deb-4c29-91b0-6919f24a0c9f"
USERS = [
    (CONTRACT_UID, "e2e-contract@record-platform.local", "allowlist"),
    ("00000040-0000-4000-8000-000000000000", "t20-15g-cohort0@record-platform.local", "preview"),
    ("0000002a-0000-4000-8000-000000000000", "t20-15k-cohort1@record-platform.local", "preview"),
    ("5a68fe88-c134-4166-b145-57534a3656b9", "buyer-contract@record-platform.local", "preview"),
    ("000001bc-0000-4000-8000-000000000000", "t20-15o-bucket10@record-platform.local", "preview"),
    ("00000002-0000-4000-8000-000000000000", "t20-15s-bucket20@record-platform.local", "preview"),
]


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
    body = api("POST", "/api/ai/rag/query", token, user_id, {
        "question": "Which of my listings need attention first, and why?",
        "user_id": user_id,
    })["body"]
    details = body.get("details") or {}
    canary = details.get("hybrid_canary") or {}
    return str(details.get("retrieval_mode")), canary.get("gate_reason")


def revoke_all() -> None:
    for uid, email, role in USERS:
        if role == "allowlist":
            continue
        tok = login(email)
        api("POST", "/api/ai/rag/preview/revoke", tok, uid)


def main() -> int:
    print("=== revoke all existing enrollments ===")
    revoke_all()

    sessions = {uid: {"email": email, "role": role, "token": login(email)} for uid, email, role in USERS}

    print("=== pre-enroll probes ===")
    for uid, meta in sessions.items():
        mode, gate = rag_probe(meta["token"], uid)
        print(meta["email"], "status", api("GET", "/api/ai/rag/preview/status", meta["token"], uid)["body"])
        print(meta["email"], "rag", mode, gate)

    print("=== enroll 5 cohort users ===")
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        print(uid, api("POST", "/api/ai/rag/preview/enroll", meta["token"], uid))

    print("=== post-enroll probes ===")
    for uid, meta in sessions.items():
        mode, gate = rag_probe(meta["token"], uid)
        print(meta["email"], mode, gate)

    env = subprocess.check_output(
        ["kubectl", "-n", "record-platform", "get", "deployment", "python-ai-service",
         "-o", "jsonpath={range .spec.template.spec.containers[0].env[*]}{.name}={.value}{\"\\n\"}{end}"],
        text=True,
    )
    print("=== env hybrid keys ===")
    for line in env.splitlines():
        if "HYBRID" in line or "RAG_HYBRID" in line:
            print(line)

    os.environ["T20_25D_WINDOWS"] = "1"
    subprocess.run([sys.executable, str(REPO / "scripts/t20-25d-opt-in-preview-eval.py")], check=True, cwd=REPO)

    print("=== post-eval revoke all ===")
    revoke_all()

    print("=== post-revoke probes ===")
    for uid, meta in sessions.items():
        mode, gate = rag_probe(meta["token"], uid)
        print(meta["email"], mode, gate)

    return 0


if __name__ == "__main__":
    sys.exit(main())
