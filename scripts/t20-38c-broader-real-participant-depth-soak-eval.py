#!/usr/bin/env python3
"""T20.38C — Broader real-participant depth soak (24 windows, artifact-gated)."""
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
PARTICIPANTS = [
    ("2ed75568-7deb-4c29-91b0-6919f24a0c9f", "e2e-contract@record-platform.local", "allowlist"),
    ("0dc268d0-a86f-4e12-8d10-9db0f1b735e0", "tom@example.com", "preview"),
    ("950a40b1-d12e-4839-aefd-0d353b90182a", "tw5126@example.com", "preview"),
    ("2901355e-7d04-4da1-b3a7-c22807326b94", "seed@example.com", "preview"),
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


def main() -> int:
    os.environ["T20_EVAL_USER_SET"] = "real-participant-36"
    os.environ["T20_EVAL_OUT_DIR"] = "t20-38c-broader-real-participant-depth-eval"
    os.environ["T20_25D_WINDOWS"] = "24"
    os.environ["T20_25D_RUNS"] = "5"
    os.environ["T20_PER_WINDOW_RESET"] = "1"
    os.environ["T20_EVAL_RAG_PAUSE_SEC"] = "0.05"
    os.environ["T20_EVAL_RAG_RETRY_MAX"] = "8"

    sessions_pre = {uid: {"email": email, "role": role, "token": login(email)} for uid, email, role in PARTICIPANTS}
    print("=== pre-eval revoke all preview enrollments ===")
    for uid, meta in sessions_pre.items():
        if meta["role"] == "allowlist":
            continue
        api("POST", "/api/ai/rag/preview/revoke", meta["token"], uid)

    subprocess.run([sys.executable, str(REPO / "scripts/t20-25d-opt-in-preview-eval.py")], check=True, cwd=REPO)

    sessions = {uid: {"email": email, "role": role, "token": login(email)} for uid, email, role in PARTICIPANTS}
    print("=== post-eval revoke all preview enrollments ===")
    for uid, meta in sessions.items():
        if meta["role"] == "allowlist":
            continue
        api("POST", "/api/ai/rag/preview/revoke", meta["token"], uid)

    print("=== post-revoke keyword_default probes ===")
    for uid, meta in sessions.items():
        mode, gate = rag_probe(meta["token"], uid)
        if meta["role"] == "allowlist":
            assert mode == "hybrid_canary" and gate == "allowlist", f"contract: {mode}/{gate}"
        else:
            assert mode == "keyword" and gate == "keyword_default", f"participant {meta['email']}: {mode}/{gate}"
        print(meta["email"], mode, gate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
